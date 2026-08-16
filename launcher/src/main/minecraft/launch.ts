/**
 * Builds a launch command line and starts the game.
 *
 * Two argument formats are supported because both are still in use across Ella's range:
 * the flat `minecraftArguments` string (1.12.2 and older) and the structured `arguments`
 * object with rules (1.13+).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Argument, VersionJson } from './types.ts';
import { matchesRules } from './rules.ts';
import { resolveLibraries } from './libraries.ts';
import { resolveVersionJson } from './manifest.ts';
import {
  assetsDir,
  assetsVirtualDir,
  ensureDir,
  instanceDir,
  librariesDir,
  nativesDir,
  versionJar,
} from '../paths.ts';
import { selectJavaFor, type JavaRuntime } from '../java-runtime.ts';
import { DEFAULT_PORT } from '../../shared/protocol.ts';

export const LAUNCHER_NAME = 'Ella';
export const LAUNCHER_VERSION = '0.1.0';

/**
 * Derives the UUID Minecraft itself uses for offline players: an RFC 4122 version 3
 * UUID over `OfflinePlayer:<name>`. Matching it means worlds keep the same player data
 * whether launched from Ella or elsewhere.
 */
export function offlineUuid(username: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // version 3
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = hash.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export interface LaunchOptions {
  /** Version file to launch — a Forge version id once Forge is installed. */
  versionId: string;
  /**
   * Game directory key, defaulting to `versionId`.
   *
   * Kept separate so a vanilla launch and its Forge counterpart share one instance: the
   * mods folder, worlds and options belong to the Minecraft version, not to whether Forge
   * happens to be installed.
   */
  instanceId?: string;
  username?: string;
  /** Maximum heap in megabytes. */
  maxMemoryMb?: number;
  minMemoryMb?: number;
  /** Extra JVM arguments, appended after the generated ones. */
  extraJvmArgs?: string[];
  /** Ella IPC settings handed to the in-game mod. */
  ella?: { port: number; workspace: string; token: string };
  width?: number;
  height?: number;
}

/** Expands `${placeholder}` tokens, leaving unknown ones untouched for easier debugging. */
function expand(template: string, values: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** Flattens a structured argument list, dropping entries whose rules do not match. */
function collectArguments(
  args: Argument[] | undefined,
  values: Record<string, string>,
  features: Record<string, boolean>,
): string[] {
  const out: string[] = [];
  for (const argument of args ?? []) {
    if (typeof argument === 'string') {
      out.push(expand(argument, values));
      continue;
    }
    if (!matchesRules(argument.rules, features)) continue;
    const value = Array.isArray(argument.value) ? argument.value : [argument.value];
    out.push(...value.map((entry) => expand(entry, values)));
  }
  return out;
}

export interface LaunchCommand {
  java: JavaRuntime;
  args: string[];
  gameDirectory: string;
  version: VersionJson;
}

export async function buildLaunchCommand(options: LaunchOptions): Promise<LaunchCommand> {
  const version = await resolveVersionJson(options.versionId);
  const username = options.username ?? 'Dev';
  const gameDirectory = instanceDir(options.instanceId ?? options.versionId);
  await ensureDir(gameDirectory);

  /*
   * The vanilla id, not the modded one, decides the Java version, the client jar path and
   * the natives directory. `inheritsFrom` is cleared by the merge, so reading it here
   * would silently fall back to the modded id — which parses as unknown, sorts as newer
   * than every known release, and lands on the newest runtime. On 1.12.2 that means Java
   * 21 running launchwrapper, which fails with a ClassCastException a long way from here.
   */
  const clientJarVersion = version.ellaBaseVersionId ?? version.id;

  const java = await selectJavaFor(clientJarVersion);

  const { classpath } = resolveLibraries(version, librariesDir());
  // The client jar goes last so library overrides win, which is what Forge relies on.
  const classpathEntries = [
    ...classpath.map((entry) => entry.path),
    versionJar(clientJarVersion),
  ];

  const assetIndexId = version.assetIndex?.id ?? version.assets ?? 'legacy';
  const isVirtual = assetIndexId === 'legacy' || assetIndexId === 'pre-1.6';

  const values: Record<string, string> = {
    auth_player_name: username,
    auth_uuid: offlineUuid(username),
    // Offline play needs a syntactically valid but meaningless token.
    auth_access_token: '0',
    auth_session: '0',
    user_type: 'legacy',
    user_properties: '{}',
    version_name: version.id,
    version_type: version.type ?? 'release',
    game_directory: gameDirectory,
    assets_root: assetsDir(),
    assets_index_name: assetIndexId,
    // Legacy versions read loose assets from this directory instead of the hashed store.
    game_assets: isVirtual ? assetsVirtualDir(assetIndexId) : assetsDir(),
    // Natives are extracted when the vanilla version is installed, so they live under
    // its id rather than the modded one.
    natives_directory: nativesDir(clientJarVersion),
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: classpathEntries.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: librariesDir(),
    resolution_width: String(options.width ?? 1280),
    resolution_height: String(options.height ?? 720),
  };

  const features = { has_custom_resolution: options.width !== undefined };

  // --- JVM arguments ------------------------------------------------------
  const jvmArgs: string[] = [];

  // Length, not presence: an empty array would otherwise be read as "modern format" and
  // skip the legacy branch, launching with no classpath at all.
  if (version.arguments?.jvm && version.arguments.jvm.length > 0) {
    jvmArgs.push(...collectArguments(version.arguments.jvm, values, features));
  } else {
    // Pre-1.13 version files carry no JVM arguments; supply the essentials ourselves.
    jvmArgs.push(`-Djava.library.path=${values.natives_directory}`);
    jvmArgs.push('-cp', values.classpath);
  }

  jvmArgs.unshift(`-Xmx${options.maxMemoryMb ?? 2048}M`);
  if (options.minMemoryMb) jvmArgs.unshift(`-Xms${options.minMemoryMb}M`);

  if (options.ella) {
    jvmArgs.push(
      `-Della.port=${options.ella.port}`,
      `-Della.workspace=${options.ella.workspace}`,
      `-Della.token=${options.ella.token}`,
    );
  }

  jvmArgs.push(...(options.extraJvmArgs ?? []));

  // --- game arguments -----------------------------------------------------
  // Same reasoning as the JVM branch: a merged legacy version can carry an empty
  // `arguments.game`, and the flat string is the real source in that case.
  const gameArgs = version.minecraftArguments
    ? version.minecraftArguments.split(' ').filter(Boolean).map((arg) => expand(arg, values))
    : collectArguments(version.arguments?.game, values, features);

  if (gameArgs.length === 0) {
    throw new Error(
      `Version ${version.id} produced no game arguments; its version file may be incomplete`,
    );
  }

  return {
    java,
    args: [...jvmArgs, version.mainClass, ...gameArgs],
    gameDirectory,
    version,
  };
}

export interface RunningGame {
  process: ChildProcess;
  versionId: string;
  command: LaunchCommand;
}

/**
 * Starts the game.
 *
 * `java` is used rather than `javaw` on purpose: the console handle is what lets Ella
 * stream the game's stdout into the editor, which is how model-loading errors surface
 * without the user opening latest.log.
 */
export async function launchGame(options: LaunchOptions): Promise<RunningGame> {
  const command = await buildLaunchCommand(options);

  const child = spawn(command.java.path, command.args, {
    cwd: command.gameDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  return { process: child, versionId: options.versionId, command };
}

export const defaultEllaPort = (): number => DEFAULT_PORT;
