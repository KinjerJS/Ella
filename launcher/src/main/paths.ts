/**
 * Filesystem layout.
 *
 * Ella keeps its own Minecraft data root rather than writing into `.minecraft`. Sharing
 * the user's real installation would mean our slot-pool mod and generated resource packs
 * showing up in their normal game, and a bad export could damage worlds they care about.
 *
 * The root is resolved once at startup so the rest of the code never needs Electron,
 * which keeps every module here testable outside the app.
 */

import path from 'node:path';
import os from 'node:os';
import { mkdir } from 'node:fs/promises';

let dataRoot: string | null = null;

/** Called once from the main process with Electron's userData path. */
export function setDataRoot(root: string): void {
  dataRoot = path.resolve(root);
}

export function getDataRoot(): string {
  if (dataRoot) return dataRoot;
  // Fallback for tests and CLI use, mirroring where Electron would put userData.
  const home = os.homedir();
  return process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Ella')
    : path.join(home, '.ella');
}

/** Shared Minecraft assets — versions, libraries and asset objects are deduplicated here. */
export const versionsDir = (): string => path.join(getDataRoot(), 'versions');
export const versionDir = (id: string): string => path.join(versionsDir(), id);
export const versionJar = (id: string): string => path.join(versionDir(id), `${id}.jar`);
export const versionJson = (id: string): string => path.join(versionDir(id), `${id}.json`);

export const librariesDir = (): string => path.join(getDataRoot(), 'libraries');
export const assetsDir = (): string => path.join(getDataRoot(), 'assets');
export const assetIndexesDir = (): string => path.join(assetsDir(), 'indexes');
export const assetObjectsDir = (): string => path.join(assetsDir(), 'objects');
/** Pre-1.7 layouts want assets laid out by name instead of by hash. */
export const assetsVirtualDir = (index: string): string =>
  path.join(assetsDir(), 'virtual', index);

export const nativesDir = (id: string): string => path.join(getDataRoot(), 'natives', id);

/**
 * One game directory per version. Keeping them separate means a mod jar built for 1.12.2
 * can never be picked up by a 1.21 launch, which is exactly the kind of failure that
 * wastes an afternoon.
 */
export const instancesDir = (): string => path.join(getDataRoot(), 'instances');
export const instanceDir = (id: string): string => path.join(instancesDir(), id);
export const instanceModsDir = (id: string): string => path.join(instanceDir(id), 'mods');

export const projectsDir = (): string => path.join(getDataRoot(), 'projects');
export const projectDir = (name: string): string => path.join(projectsDir(), name);

export const configFile = (): string => path.join(getDataRoot(), 'config.json');
export const cacheDir = (): string => path.join(getDataRoot(), 'cache');

/** Where the adapter jars shipped with the app are staged before injection. */
export const adaptersDir = (): string => path.join(getDataRoot(), 'adapters');

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Creates the directories the app expects to exist on every run. */
export async function ensureLayout(): Promise<void> {
  await Promise.all(
    [
      versionsDir(),
      librariesDir(),
      assetIndexesDir(),
      assetObjectsDir(),
      instancesDir(),
      projectsDir(),
      cacheDir(),
      adaptersDir(),
    ].map(ensureDir),
  );
}
