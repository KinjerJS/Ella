/**
 * Locates the JDKs installed on this machine and picks the right one per Minecraft
 * version. Ella spans 1.8.9 to 26.2, which needs Java 8 through 21, so "just use
 * JAVA_HOME" is never sufficient.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { requiredJavaVersion } from '../shared/version.ts';

const execFileAsync = promisify(execFile);

export interface JavaRuntime {
  /** Path to `java` (or `java.exe`). */
  path: string;
  /** Path to `javaw.exe` on Windows — launches without a console window. */
  javawPath?: string;
  major: number;
  /** Full version string as reported by the runtime, e.g. `21.0.3`. */
  version: string;
  /** Where this runtime was found, for display in the UI. */
  origin: 'JAVA_HOME' | 'PATH' | 'known-location' | 'minecraft-runtime' | 'user';
}

const isWindows = process.platform === 'win32';
const exe = (name: string): string => (isWindows ? `${name}.exe` : name);

/**
 * Parses the output of `java -version`, which goes to **stderr**, not stdout.
 *
 * Two formats exist:
 *   java version "1.8.0_202"     → legacy, major is the second component
 *   openjdk version "21.0.3"     → modern, major is the first component
 */
export function parseJavaVersion(output: string): { major: number; version: string } | null {
  const match = /version "([^"]+)"/.exec(output);
  if (!match) return null;

  const version = match[1];
  const components = version.split(/[._\-+]/).map(Number);
  if (components.length === 0 || Number.isNaN(components[0])) return null;

  // `1.8.0_202` means Java 8; anything else leads with its major version.
  const major = components[0] === 1 ? (components[1] ?? 0) : components[0];
  if (!Number.isFinite(major) || major <= 0) return null;

  return { major, version };
}

async function probe(javaPath: string, origin: JavaRuntime['origin']): Promise<JavaRuntime | null> {
  try {
    // `java -version` writes to stderr on every known distribution.
    const { stderr, stdout } = await execFileAsync(javaPath, ['-version'], { timeout: 10_000 });
    const parsed = parseJavaVersion(stderr || stdout);
    if (!parsed) return null;

    const javawPath = path.join(path.dirname(javaPath), exe('javaw'));
    const hasJavaw = await access(javawPath, constants.X_OK).then(() => true, () => false);

    return {
      path: javaPath,
      javawPath: hasJavaw ? javawPath : undefined,
      major: parsed.major,
      version: parsed.version,
      origin,
    };
  } catch {
    return null;
  }
}

/** Install roots that hold one directory per JDK. */
function searchRoots(): string[] {
  const home = os.homedir();
  if (isWindows) {
    return [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft\\jdk',
      'C:\\Program Files\\Amazon Corretto',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files (x86)\\Java',
      path.join(home, 'AppData', 'Roaming', '.minecraft', 'runtime'),
      path.join(home, '.jdks'),
    ];
  }
  return [
    '/usr/lib/jvm',
    '/Library/Java/JavaVirtualMachines',
    path.join(home, '.jdks'),
    path.join(home, '.sdkman', 'candidates', 'java'),
  ];
}

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Collects plausible `java` paths under an install root.
 *
 * The scan is targeted rather than a blind recursive walk: it only ever looks for a
 * `bin/` directory at a known offset. A general walk produces hundreds of candidates,
 * and probing those means spawning hundreds of `java -version` processes, which thrashes
 * the machine badly enough that the probes themselves start timing out.
 *
 * Layouts handled:
 *   <root>/<jdk>/bin/java                        normal install root
 *   <root>/<jdk>/Contents/Home/bin/java          macOS bundle
 *   <root>/<name>/<platform>/<name>/bin/java     Mojang's runtime directory
 */
async function candidatesUnder(root: string): Promise<string[]> {
  const found: string[] = [];

  for (const jdk of await listDirectories(root)) {
    found.push(path.join(jdk, 'bin', exe('java')));
    found.push(path.join(jdk, 'Contents', 'Home', 'bin', exe('java')));

    // Mojang nests two extra levels; descend only to look for `bin/java`.
    for (const platform of await listDirectories(jdk)) {
      found.push(path.join(platform, 'bin', exe('java')));
      for (const inner of await listDirectories(platform)) {
        found.push(path.join(inner, 'bin', exe('java')));
      }
    }
  }

  return found;
}

/** Runs `task` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

let cache: JavaRuntime[] | null = null;

/** Scans for installed runtimes. Result is cached; pass `force` to rescan. */
export async function discoverJavaRuntimes(force = false): Promise<JavaRuntime[]> {
  if (cache && !force) return cache;

  const candidates = new Map<string, JavaRuntime['origin']>();

  if (process.env.JAVA_HOME) {
    candidates.set(path.join(process.env.JAVA_HOME, 'bin', exe('java')), 'JAVA_HOME');
  }

  for (const root of searchRoots()) {
    const origin = root.includes('.minecraft') ? 'minecraft-runtime' : 'known-location';
    for (const candidate of await candidatesUnder(root)) {
      if (!candidates.has(candidate)) candidates.set(candidate, origin);
    }
  }

  // Drop candidates that do not exist before spawning anything — a filesystem check is
  // orders of magnitude cheaper than starting a JVM.
  const existing: Array<[string, JavaRuntime['origin']]> = [];
  await Promise.all(
    [...candidates].map(async ([javaPath, origin]) => {
      if (await access(javaPath, constants.F_OK).then(() => true, () => false)) {
        existing.push([javaPath, origin]);
      }
    }),
  );

  // `java` from PATH has no filesystem path to check, so it is added after the filter.
  existing.push([exe('java'), 'PATH']);

  const probed = await mapLimit(existing, 4, ([javaPath, origin]) => probe(javaPath, origin));

  // Deduplicate: the same JDK is often reachable through several paths.
  const byIdentity = new Map<string, JavaRuntime>();
  for (const runtime of probed) {
    if (!runtime) continue;
    const identity = `${runtime.major}:${runtime.version}`;
    const existing = byIdentity.get(identity);
    // Prefer a real filesystem path over the bare `java` resolved from PATH.
    if (!existing || (existing.origin === 'PATH' && runtime.origin !== 'PATH')) {
      byIdentity.set(identity, runtime);
    }
  }

  cache = [...byIdentity.values()].sort((a, b) => a.major - b.major);
  return cache;
}

/**
 * Note: this codebase avoids TypeScript syntax that needs more than type stripping
 * (parameter properties, enums, namespaces, decorators) so `node --test` can run the
 * sources directly with no build step.
 */
export class NoSuitableJavaError extends Error {
  required: number;
  mcVersion: string;
  available: number[];

  constructor(required: number, mcVersion: string, available: number[]) {
    super(
      `Minecraft ${mcVersion} requires Java ${required}, but only ` +
        `${available.length > 0 ? `Java ${available.join(', ')}` : 'no runtime'} was found`,
    );
    this.name = 'NoSuitableJavaError';
    this.required = required;
    this.mcVersion = mcVersion;
    this.available = available;
  }
}

/**
 * Picks a runtime for a Minecraft version.
 *
 * Exact major match is strongly preferred: old Minecraft versions genuinely break on
 * newer Java (1.12.2 will not start on Java 17+, and Forge's legacy launch wrapper is
 * worse still), so a newer runtime is only accepted for versions that require 17 or
 * above, where forward compatibility holds in practice.
 */
export async function selectJavaFor(mcVersion: string): Promise<JavaRuntime> {
  const required = requiredJavaVersion(mcVersion);
  const runtimes = await discoverJavaRuntimes();

  const exact = runtimes.find((r) => r.major === required);
  if (exact) return exact;

  if (required >= 17) {
    const newer = runtimes.filter((r) => r.major > required).sort((a, b) => a.major - b.major)[0];
    if (newer) return newer;
  }

  throw new NoSuitableJavaError(required, mcVersion, runtimes.map((r) => r.major));
}
