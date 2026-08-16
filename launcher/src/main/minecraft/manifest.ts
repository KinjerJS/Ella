/**
 * Version manifest access and version-file resolution.
 */

import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ManifestEntry, VersionJson, VersionManifest } from './types.ts';
import { fetchJson, downloadFile } from './download.ts';
import { versionJson, versionDir, versionsDir, cacheDir, ensureDir } from '../paths.ts';
import { mergeInherited } from './libraries.ts';
import { adapterFor, compareVersions, isSupported } from '../../shared/version.ts';

export const MANIFEST_URL =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

/** Manifest is refetched when the cached copy is older than this. */
const MANIFEST_TTL_MS = 60 * 60 * 1000;

const manifestCachePath = (): string => path.join(cacheDir(), 'version_manifest_v2.json');

/**
 * Loads the manifest, preferring a fresh cached copy.
 *
 * A stale cache is still returned when the network is unavailable — being offline should
 * degrade Ella to "you can launch what you already installed", not break it entirely.
 */
export async function loadManifest(force = false): Promise<VersionManifest> {
  const cachePath = manifestCachePath();
  await ensureDir(path.dirname(cachePath));

  if (!force) {
    try {
      const stats = await stat(cachePath);
      if (Date.now() - stats.mtimeMs < MANIFEST_TTL_MS) {
        return JSON.parse(await readFile(cachePath, 'utf8')) as VersionManifest;
      }
    } catch {
      // No usable cache; fall through to the network.
    }
  }

  try {
    const manifest = await fetchJson<VersionManifest>(MANIFEST_URL);
    await writeFile(cachePath, JSON.stringify(manifest), 'utf8');
    return manifest;
  } catch (error) {
    try {
      return JSON.parse(await readFile(cachePath, 'utf8')) as VersionManifest;
    } catch {
      throw error;
    }
  }
}

export interface VersionSummary extends ManifestEntry {
  /** Whether the client jar is already present locally. */
  installed: boolean;
  /** Which Ella adapter covers it, or null when unsupported. */
  adapter: ReturnType<typeof adapterFor>;
  supported: boolean;
}

/** Manifest entries, newest first, annotated with Ella's own support information. */
export async function listVersions(
  options: { includeSnapshots?: boolean; force?: boolean } = {},
): Promise<VersionSummary[]> {
  const manifest = await loadManifest(options.force);

  const entries = manifest.versions.filter(
    (entry) => options.includeSnapshots || entry.type === 'release',
  );

  const summaries = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      installed: await stat(versionJson(entry.id)).then(
        (s) => s.isFile(),
        () => false,
      ),
      adapter: adapterFor(entry.id),
      supported: isSupported(entry.id),
    })),
  );

  return summaries.sort((a, b) => compareVersions(b.id, a.id));
}

/**
 * Installed versions, read from disk alone.
 *
 * Deliberately does not touch the manifest: the quick-launch control has to populate
 * instantly and keep working with no network, and everything it needs is already in the
 * version files on disk.
 *
 * Forge version directories are filtered out — they are an implementation detail of an
 * install, not something to offer as a separate choice.
 */
export async function listInstalledVersions(): Promise<VersionSummary[]> {
  let entries;
  try {
    entries = await readdir(versionsDir(), { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries: VersionSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    let version: VersionJson;
    try {
      version = await readLocalVersionJson(entry.name);
    } catch {
      continue;
    }
    // A version file that inherits from another is a modded overlay, not a base version.
    if (version.inheritsFrom) continue;

    summaries.push({
      id: entry.name,
      type: (version.type as ManifestEntry['type']) ?? 'release',
      url: '',
      time: version.time ?? '',
      releaseTime: version.releaseTime ?? '',
      sha1: '',
      complianceLevel: 0,
      installed: true,
      adapter: adapterFor(entry.name),
      supported: isSupported(entry.name),
    });
  }

  return summaries.sort((a, b) => compareVersions(b.id, a.id));
}

/** Downloads a version file if it is not already cached locally. */
export async function ensureVersionJson(id: string): Promise<VersionJson> {
  const localPath = versionJson(id);

  try {
    return JSON.parse(await readFile(localPath, 'utf8')) as VersionJson;
  } catch {
    // Not cached yet.
  }

  const manifest = await loadManifest();
  const entry = manifest.versions.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`Unknown Minecraft version: ${id}`);
  }

  await ensureDir(versionDir(id));
  await downloadFile({ url: entry.url, destination: localPath, sha1: entry.sha1 });
  return JSON.parse(await readFile(localPath, 'utf8')) as VersionJson;
}

/** Reads a version file already on disk, without consulting the manifest. */
export async function readLocalVersionJson(id: string): Promise<VersionJson> {
  return JSON.parse(await readFile(versionJson(id), 'utf8')) as VersionJson;
}

const MAX_INHERITANCE_DEPTH = 8;

/**
 * Resolves a version file, following `inheritsFrom` until a vanilla base is reached.
 *
 * Forge writes a version file that layers onto vanilla, and the chain is followed rather
 * than assumed to be one level deep because installers have historically nested further.
 * The depth cap turns a malformed chain into a clear error instead of a hang.
 */
export async function resolveVersionJson(id: string, depth = 0): Promise<VersionJson> {
  if (depth > MAX_INHERITANCE_DEPTH) {
    throw new Error(`inheritsFrom chain too deep starting at ${id}`);
  }

  // Prefer a local file: modded versions exist only on disk, never in the manifest.
  let version: VersionJson;
  try {
    version = await readLocalVersionJson(id);
  } catch {
    version = await ensureVersionJson(id);
  }

  if (!version.inheritsFrom) return version;

  const parent = await resolveVersionJson(version.inheritsFrom, depth + 1);
  return mergeInherited(version, parent);
}
