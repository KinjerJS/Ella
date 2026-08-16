/**
 * Installs everything a version needs to launch: the client jar, its libraries, the
 * asset index and objects, and the extracted native binaries.
 */

import { readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { AssetIndex, VersionJson } from './types.ts';
import {
  downloadAll,
  downloadFile,
  isUpToDate,
  type DownloadTask,
  type ProgressCallback,
  type DownloadError,
} from './download.ts';
import { resolveLibraries } from './libraries.ts';
import { resolveVersionJson } from './manifest.ts';
import {
  assetIndexesDir,
  assetObjectsDir,
  assetsVirtualDir,
  ensureDir,
  librariesDir,
  nativesDir,
  versionJar,
} from '../paths.ts';

const RESOURCES_BASE = 'https://resources.download.minecraft.net';
const MAVEN_CENTRAL = 'https://libraries.minecraft.net/';

export interface InstallResult {
  version: VersionJson;
  failures: DownloadError[];
}

export interface InstallOptions {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  /** Skip asset download. Useful when only the classpath is needed. */
  skipAssets?: boolean;
}

/**
 * Asset objects live under `objects/<first two hex chars>/<full hash>`, deduplicated
 * across every installed version.
 */
const assetObjectPath = (hash: string): string =>
  path.join(assetObjectsDir(), hash.slice(0, 2), hash);

export async function installVersion(
  id: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const version = await resolveVersionJson(id);
  const tasks: DownloadTask[] = [];

  // --- client jar ---------------------------------------------------------
  const client = version.downloads?.client;
  if (client) {
    tasks.push({
      url: client.url,
      destination: versionJar(version.id),
      sha1: client.sha1,
      size: client.size,
      label: `${version.id}.jar`,
    });
  }

  // --- libraries and natives ---------------------------------------------
  const { classpath, natives } = resolveLibraries(version, librariesDir());

  for (const library of [...classpath, ...natives]) {
    if (library.download?.url) {
      tasks.push({
        url: library.download.url,
        destination: library.path,
        sha1: library.download.sha1,
        size: library.download.size,
        label: library.name,
      });
    } else if (library.repositoryUrl) {
      // Forge-style entries give a repository base instead of a direct url.
      const relative = path.relative(librariesDir(), library.path).split(path.sep).join('/');
      tasks.push({
        url: library.repositoryUrl.replace(/\/?$/, '/') + relative,
        destination: library.path,
        label: library.name,
      });
    } else if (!(await isUpToDate(library.path))) {
      // No url anywhere: try Mojang's own repository before giving up. Some legacy
      // version files rely on the launcher knowing this default.
      const relative = path.relative(librariesDir(), library.path).split(path.sep).join('/');
      tasks.push({ url: MAVEN_CENTRAL + relative, destination: library.path, label: library.name });
    }
  }

  // --- asset index and objects -------------------------------------------
  let assetIndex: AssetIndex | undefined;
  let assetIndexId: string | undefined;

  if (!options.skipAssets && version.assetIndex) {
    assetIndexId = version.assetIndex.id;
    const indexPath = path.join(assetIndexesDir(), `${assetIndexId}.json`);
    await ensureDir(assetIndexesDir());
    await downloadFile(
      {
        url: version.assetIndex.url,
        destination: indexPath,
        sha1: version.assetIndex.sha1,
        label: `assets/${assetIndexId}`,
      },
      options.signal,
    );

    assetIndex = JSON.parse(await readFile(indexPath, 'utf8')) as AssetIndex;
    for (const [name, object] of Object.entries(assetIndex.objects)) {
      tasks.push({
        url: `${RESOURCES_BASE}/${object.hash.slice(0, 2)}/${object.hash}`,
        destination: assetObjectPath(object.hash),
        sha1: object.hash,
        size: object.size,
        label: name,
      });
    }
  }

  const { failures } = await downloadAll(tasks, {
    concurrency: 12,
    onProgress: options.onProgress,
    signal: options.signal,
  });

  // --- post-processing ----------------------------------------------------
  await extractNatives(version, natives.map((n) => ({ path: n.path, exclude: n.exclude })));

  if (assetIndex && assetIndexId && (assetIndex.virtual || assetIndex.map_to_resources)) {
    await materialiseVirtualAssets(assetIndex, assetIndexId);
  }

  return { version, failures };
}

/**
 * Extracts native archives into a per-version directory.
 *
 * The directory is cleared first: leftovers from a previous version of the same id are a
 * classic source of "the game crashes with an UnsatisfiedLinkError" reports.
 */
async function extractNatives(
  version: VersionJson,
  archives: Array<{ path: string; exclude: string[] }>,
): Promise<void> {
  const target = nativesDir(version.id);
  await rm(target, { recursive: true, force: true });
  await ensureDir(target);

  for (const archive of archives) {
    let zip: AdmZip;
    try {
      zip = new AdmZip(archive.path);
    } catch {
      // A missing archive is already reported as a download failure.
      continue;
    }

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (archive.exclude.some((prefix) => entry.entryName.startsWith(prefix))) continue;

      // Flatten: the game looks for libraries directly in java.library.path.
      const destination = path.join(target, path.basename(entry.entryName));
      await writeFile(destination, entry.getData());
    }
  }
}

/**
 * Older asset indexes are "virtual": the game expects files laid out by their logical
 * name rather than by hash. Copies rather than symlinks, because creating symlinks on
 * Windows needs elevation that a launcher should not require.
 */
async function materialiseVirtualAssets(index: AssetIndex, indexId: string): Promise<void> {
  const root = assetsVirtualDir(indexId);

  for (const [name, object] of Object.entries(index.objects)) {
    const destination = path.join(root, ...name.split('/'));
    if (await isUpToDate(destination, object.hash, object.size)) continue;
    await ensureDir(path.dirname(destination));
    await copyFile(assetObjectPath(object.hash), destination).catch(() => {
      // Missing source is already surfaced through download failures.
    });
  }
}
