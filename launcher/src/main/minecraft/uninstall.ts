/**
 * Removing an installed version.
 *
 * The rule that shapes this file: **libraries and asset objects are shared between
 * versions and are never deleted here.** They are content-addressed and deduplicated, so
 * removing one version's copy would break every other version that references the same
 * file. Reclaiming that space needs a garbage collection pass across all versions, which
 * is a different operation from uninstalling one.
 *
 * The instance directory holds worlds, screenshots and options. It survives by default
 * and is only removed on an explicit, separate opt-in.
 */

import { rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  versionDir,
  versionsDir,
  nativesDir,
  instanceDir,
} from '../paths.ts';
import { findForgeVersionId } from './forge.ts';

export interface UninstallOptions {
  /**
   * Also delete the instance directory — worlds, options, screenshots and the mods
   * folder. Off by default: this is the only irreplaceable data Ella manages.
   */
  removeInstanceData?: boolean;
}

export interface UninstallResult {
  /** Paths actually deleted. */
  removed: string[];
  /** Paths deliberately left in place, with the reason, for display. */
  kept: Array<{ path: string; reason: 'shared' | 'user-data' }>;
}

const exists = (target: string): Promise<boolean> =>
  stat(target).then(() => true, () => false);

async function removeIfPresent(target: string, removed: string[]): Promise<void> {
  if (!(await exists(target))) return;
  await rm(target, { recursive: true, force: true });
  removed.push(target);
}

export class VersionInUseError extends Error {
  constructor(versionId: string) {
    super(`Minecraft ${versionId} is currently running`);
    this.name = 'VersionInUseError';
  }
}

/**
 * Uninstalls a version's own files: its version directory, its extracted natives, and any
 * Forge version installed alongside it.
 */
export async function uninstallVersion(
  versionId: string,
  options: UninstallOptions = {},
): Promise<UninstallResult> {
  const removed: string[] = [];
  const kept: UninstallResult['kept'] = [];

  await removeIfPresent(versionDir(versionId), removed);
  await removeIfPresent(nativesDir(versionId), removed);

  // The Forge version file is a separate directory that only makes sense alongside the
  // vanilla version it inherits from, so it goes too.
  const forgeVersionId = await findForgeVersionId(versionId);
  if (forgeVersionId) {
    await removeIfPresent(versionDir(forgeVersionId), removed);
    await removeIfPresent(nativesDir(forgeVersionId), removed);
  }

  const instance = instanceDir(versionId);
  if (options.removeInstanceData) {
    await removeIfPresent(instance, removed);
  } else if (await exists(instance)) {
    kept.push({ path: instance, reason: 'user-data' });
  }

  return { removed, kept };
}

/** Versions present on disk, whether or not the manifest still lists them. */
export async function listInstalledVersionIds(): Promise<string[]> {
  try {
    const entries = await readdir(versionsDir(), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

export interface InstallFootprint {
  versionBytes: number;
  instanceBytes: number;
  hasInstance: boolean;
}

async function directorySize(target: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(child);
    } else {
      total += await stat(child).then((s) => s.size, () => 0);
    }
  }
  return total;
}

/**
 * How much an uninstall would actually reclaim, so the confirmation can be specific
 * rather than asking the user to take it on trust.
 */
export async function measureInstall(versionId: string): Promise<InstallFootprint> {
  const forgeVersionId = await findForgeVersionId(versionId);

  const versionBytes =
    (await directorySize(versionDir(versionId))) +
    (await directorySize(nativesDir(versionId))) +
    (forgeVersionId ? await directorySize(versionDir(forgeVersionId)) : 0);

  const instance = instanceDir(versionId);
  const hasInstance = await exists(instance);

  return {
    versionBytes,
    instanceBytes: hasInstance ? await directorySize(instance) : 0,
    hasInstance,
  };
}
