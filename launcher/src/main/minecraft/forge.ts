/**
 * Forge resolution and installation.
 *
 * Ella runs the official Forge installer in headless mode rather than reimplementing it.
 * That matters most from 1.13 onwards, where installation is not just unpacking files:
 * the installer runs binary patch and deobfuscation processors, and reproducing those
 * would mean tracking changes to a toolchain that is not ours.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fetchJson, downloadFile } from './download.ts';
import { ensureDir, getDataRoot, versionsDir, cacheDir } from '../paths.ts';
import { selectJavaFor } from '../java-runtime.ts';
import { compareVersions } from '../../shared/version.ts';

const PROMOTIONS_URL =
  'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';

interface Promotions {
  promos: Record<string, string>;
}

export interface ForgeBuild {
  minecraftVersion: string;
  /** Forge build number, e.g. `14.23.5.2859`. */
  forgeVersion: string;
  /** Full artifact version as it appears in Maven paths. */
  artifactVersion: string;
  channel: 'recommended' | 'latest';
  installerUrl: string;
}

/**
 * Some 1.7–1.12 artifacts carry a duplicated Minecraft version suffix. The pattern is
 * historical rather than principled, so the version list is explicit.
 */
const DOUBLE_SUFFIX_VERSIONS = new Set(['1.7.10', '1.8.9', '1.9', '1.9.4', '1.10.2', '1.11', '1.11.2']);

function artifactVersionFor(mcVersion: string, forgeVersion: string): string {
  const base = `${mcVersion}-${forgeVersion}`;
  return DOUBLE_SUFFIX_VERSIONS.has(mcVersion) ? `${base}-${mcVersion}` : base;
}

/**
 * Finds the Forge build for a Minecraft version, preferring the recommended one.
 *
 * `recommended` is deliberately the default: for a tool whose job is to render models
 * predictably, a stable build matters more than the newest one.
 */
export async function resolveForgeBuild(
  mcVersion: string,
  channel: 'recommended' | 'latest' = 'recommended',
): Promise<ForgeBuild> {
  const promotions = await fetchJson<Promotions>(PROMOTIONS_URL);

  const preferred = promotions.promos[`${mcVersion}-${channel}`];
  const fallback = promotions.promos[`${mcVersion}-${channel === 'recommended' ? 'latest' : 'recommended'}`];
  const forgeVersion = preferred ?? fallback;

  if (!forgeVersion) {
    throw new Error(`Forge has no published build for Minecraft ${mcVersion}`);
  }

  const artifactVersion = artifactVersionFor(mcVersion, forgeVersion);

  return {
    minecraftVersion: mcVersion,
    forgeVersion,
    artifactVersion,
    channel: preferred ? channel : channel === 'recommended' ? 'latest' : 'recommended',
    installerUrl:
      `${FORGE_MAVEN}/${artifactVersion}/forge-${artifactVersion}-installer.jar`,
  };
}

/** The version id the Forge installer creates under `versions/`. */
export function forgeVersionId(build: ForgeBuild): string {
  // Legacy installers name it `<mc>-forge<mc>-<forge>`; modern ones `<mc>-forge-<forge>`.
  return compareVersions(build.minecraftVersion, '1.13') < 0
    ? `${build.minecraftVersion}-forge${build.artifactVersion}`
    : `${build.minecraftVersion}-forge-${build.forgeVersion}`;
}

/**
 * The installer refuses to run without a launcher profile file, and writes its new
 * profile into it. A minimal valid document is enough.
 */
async function ensureLauncherProfiles(root: string): Promise<void> {
  const file = path.join(root, 'launcher_profiles.json');
  const exists = await stat(file).then((s) => s.isFile(), () => false);
  if (exists) return;

  await writeFile(
    file,
    JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2),
    'utf8',
  );
}

/**
 * Finds whichever version directory the installer actually produced.
 *
 * Installer naming has changed more than once, so rather than trusting
 * {@link forgeVersionId} the directory listing is checked for anything mentioning both
 * the Minecraft version and `forge`.
 */
/**
 * The installed Forge version id for a Minecraft version, or null when Forge is not
 * installed for it. Used at launch time to pick the right version file.
 */
export async function findForgeVersionId(mcVersion: string): Promise<string | null> {
  return findInstalledForgeVersion(mcVersion, new Set());
}

async function findInstalledForgeVersion(
  mcVersion: string,
  before: Set<string>,
): Promise<string | null> {
  const entries = await readdir(versionsDir(), { withFileTypes: true }).catch(() => []);

  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !before.has(name))
    .filter((name) => name.includes('forge') && name.includes(mcVersion));

  if (candidates.length > 0) return candidates[0];

  // Nothing new appeared: the version may already have been installed previously.
  const existing = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.includes('forge') && name.includes(mcVersion));

  return existing[0] ?? null;
}

export interface ForgeInstallResult {
  build: ForgeBuild;
  /** The version id to launch. */
  versionId: string;
}

export async function installForge(
  mcVersion: string,
  options: { channel?: 'recommended' | 'latest'; onLog?: (line: string) => void } = {},
): Promise<ForgeInstallResult> {
  const build = await resolveForgeBuild(mcVersion, options.channel);
  const root = getDataRoot();

  await ensureDir(versionsDir());
  await ensureLauncherProfiles(root);

  const installerPath = path.join(
    await ensureDir(path.join(cacheDir(), 'forge')),
    `forge-${build.artifactVersion}-installer.jar`,
  );
  await downloadFile({ url: build.installerUrl, destination: installerPath });

  const before = new Set(
    (await readdir(versionsDir(), { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  // The installer must run on a JVM the target version supports; a 1.12.2 installer on
  // Java 21 fails in ways that are hard to read.
  const java = await selectJavaFor(mcVersion);

  await runInstaller(java.path, installerPath, root, options.onLog);

  const versionId = await findInstalledForgeVersion(mcVersion, before);
  if (!versionId) {
    throw new Error(
      `The Forge installer reported success but produced no version directory for ${mcVersion}`,
    );
  }

  return { build, versionId };
}

function runInstaller(
  javaPath: string,
  installerPath: string,
  targetRoot: string,
  onLog?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      javaPath,
      ['-jar', installerPath, '--installClient', targetRoot],
      { cwd: targetRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const output: string[] = [];
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) {
          const trimmed = line.trimEnd();
          if (!trimmed) continue;
          output.push(trimmed);
          onLog?.(trimmed);
        }
      });
    }

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      // The installer's own output is far more informative than an exit code, so it is
      // carried into the error rather than discarded.
      reject(
        new Error(
          `Forge installer exited with code ${code}:\n${output.slice(-15).join('\n')}`,
        ),
      );
    });
  });
}

/** Copies an adapter jar into a version's mods directory. */
export async function installAdapterJar(
  instanceModsDirectory: string,
  adapterJarPath: string,
): Promise<string> {
  await ensureDir(instanceModsDirectory);
  const destination = path.join(instanceModsDirectory, path.basename(adapterJarPath));
  await writeFile(destination, await readFile(adapterJarPath));
  return destination;
}
