/**
 * Locating the Ella adapter jar for a Minecraft version.
 *
 * In a packaged build the jars ship inside the app's resources. During development they
 * sit in each adapter's Gradle output, so both locations are searched — otherwise every
 * change to an adapter would need a packaging step before it could be tested.
 */

import { readdir, stat, copyFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterFor, type AdapterId } from '../shared/version.ts';
import { adaptersDir, ensureDir, instanceModsDir } from './paths.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Gradle output directory for an adapter, relative to the repository root. */
const ADAPTER_BUILD_DIRS: Record<AdapterId, string> = {
  'forge-1.8.9': 'mod/adapters/forge-1.8.9/build/libs',
  'forge-1.12.2': 'mod/adapters/forge-1.12.2/build/libs',
  'forge-mid': 'mod/adapters/forge-mid/build/libs',
  'forge-modern': 'mod/adapters/forge-modern/build/libs',
};

/** Candidate roots, most specific first. */
function searchRoots(): string[] {
  return [
    // Packaged: resources/adapters next to the app bundle.
    path.join(process.resourcesPath ?? '', 'adapters'),
    // Staged by a previous run.
    adaptersDir(),
    // Development: walk up out of out/main to the repository root.
    path.resolve(here, '../../..'),
    path.resolve(here, '../../../..'),
  ].filter(Boolean);
}

const isFile = (target: string): Promise<boolean> =>
  stat(target).then((s) => s.isFile(), () => false);

/**
 * Finds the built jar for an adapter.
 *
 * Gradle produces both `<name>.jar` and `<name>-dev.jar`; the dev jar is deobfuscated and
 * will not load in a normal game, so it is explicitly excluded rather than left to
 * whichever the directory listing happens to return first.
 */
async function findJarIn(directory: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return null;
  }

  const candidates = entries
    .filter((name) => name.endsWith('.jar'))
    .filter((name) => !name.endsWith('-dev.jar'))
    .filter((name) => !name.endsWith('-sources.jar'))
    .sort();

  if (candidates.length === 0) return null;
  return path.join(directory, candidates[candidates.length - 1]);
}

export async function findAdapterJar(mcVersion: string): Promise<string | null> {
  const adapter = adapterFor(mcVersion);
  if (!adapter) return null;

  for (const root of searchRoots()) {
    // A jar staged directly under the adapters directory.
    const flat = path.join(root, `${adapter}.jar`);
    if (await isFile(flat)) return flat;

    const built = await findJarIn(path.join(root, ADAPTER_BUILD_DIRS[adapter]));
    if (built) return built;

    const staged = await findJarIn(path.join(root, adapter));
    if (staged) return staged;
  }

  return null;
}

export class AdapterMissingError extends Error {
  mcVersion: string;
  adapter: AdapterId | null;

  constructor(mcVersion: string, adapter: AdapterId | null) {
    super(
      adapter
        ? `The ${adapter} adapter jar has not been built yet (run its Gradle build)`
        : `No Ella adapter covers Minecraft ${mcVersion}`,
    );
    this.name = 'AdapterMissingError';
    this.mcVersion = mcVersion;
    this.adapter = adapter;
  }
}

/**
 * Copies the adapter jar into an instance's mods directory, replacing any older Ella jar.
 */
export async function installAdapter(mcVersion: string, instanceId: string): Promise<string> {
  const jar = await findAdapterJar(mcVersion);
  if (!jar) throw new AdapterMissingError(mcVersion, adapterFor(mcVersion));

  const modsDirectory = await ensureDir(instanceModsDir(instanceId));
  await removeStaleEllaJars(modsDirectory, path.basename(jar));

  const destination = path.join(modsDirectory, path.basename(jar));
  await copyFile(jar, destination);
  return destination;
}

/**
 * Deletes Ella jars other than the one being installed.
 *
 * Two Ella jars in one mods folder means two mods declaring the same mod id, which Forge
 * rejects with an error that does not obviously point back here. Only files this tool
 * produced are touched — anything else in the folder belongs to the user.
 */
async function removeStaleEllaJars(modsDirectory: string, keep: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(modsDirectory);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name === keep) continue;
    if (!/^ella-.*\.jar$/i.test(name)) continue;
    await rm(path.join(modsDirectory, name), { force: true });
  }
}

export type AdapterCheck =
  | { status: 'current'; path: string }
  | { status: 'installed'; path: string }
  | { status: 'updated'; path: string }
  | { status: 'unavailable'; reason: string };

async function sha1Of(file: string): Promise<string | null> {
  try {
    return createHash('sha1').update(await readFile(file)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Makes sure the instance holds the current adapter jar, and says what it had to do.
 *
 * Called before every launch rather than only at install time, for two reasons: a mods
 * folder can be emptied or edited between sessions, and rebuilding an adapter during
 * development should reach the game without a reinstall step.
 */
export async function ensureAdapterInstalled(
  mcVersion: string,
  instanceId: string,
): Promise<AdapterCheck> {
  const adapter = adapterFor(mcVersion);
  if (!adapter) {
    return {
      status: 'unavailable',
      reason: `No Ella adapter is built for Minecraft ${mcVersion}`,
    };
  }

  const source = await findAdapterJar(mcVersion);
  if (!source) {
    return {
      status: 'unavailable',
      reason: `The ${adapter} jar has not been built yet (run its Gradle build)`,
    };
  }

  const modsDirectory = await ensureDir(instanceModsDir(instanceId));
  const destination = path.join(modsDirectory, path.basename(source));

  const [installedHash, sourceHash] = await Promise.all([
    sha1Of(destination),
    sha1Of(source),
  ]);

  if (installedHash !== null && installedHash === sourceHash) {
    await removeStaleEllaJars(modsDirectory, path.basename(source));
    return { status: 'current', path: destination };
  }

  const wasPresent = installedHash !== null;
  await removeStaleEllaJars(modsDirectory, path.basename(source));
  await copyFile(source, destination);

  return { status: wasPresent ? 'updated' : 'installed', path: destination };
}
