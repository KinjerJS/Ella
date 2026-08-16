/**
 * Library resolution: which jars go on the classpath, and which archives hold native
 * binaries that must be extracted before launch.
 */

import path from 'node:path';
import type { DownloadInfo, Library, VersionJson } from './types.ts';
import { matchesRules, currentOs, type OsInfo } from './rules.ts';

/**
 * Converts a Maven coordinate to its repository-relative path.
 *
 * Accepts `group:artifact:version`, an optional `:classifier`, and an optional `@ext`
 * suffix. Forge's version files use all three — for example
 * `net.minecraftforge:forge:1.12.2-14.23.5.2859:universal@jar`.
 */
export function mavenToPath(name: string): string {
  const [coordinate, extension = 'jar'] = name.split('@');
  const parts = coordinate.split(':');
  if (parts.length < 3) {
    throw new Error(`Malformed Maven coordinate: ${name}`);
  }

  const [group, artifact, version, classifier] = parts;
  const fileName = classifier
    ? `${artifact}-${version}-${classifier}.${extension}`
    : `${artifact}-${version}.${extension}`;

  return path.join(...group.split('.'), artifact, version, fileName);
}

/** The natives classifier for this OS, with `${arch}` expanded. */
function nativeClassifier(library: Library, osInfo: OsInfo): string | undefined {
  const template = library.natives?.[osInfo.name];
  if (!template) return undefined;
  const bits = osInfo.arch === 'x86' ? '32' : '64';
  return template.replace('${arch}', bits);
}

export interface ResolvedLibrary {
  name: string;
  /** Absolute path the jar should live at. */
  path: string;
  /** Download metadata, when the version file provides it. */
  download?: DownloadInfo;
  /** Maven base url for entries that give only a repository. */
  repositoryUrl?: string;
}

export interface ResolvedNative extends ResolvedLibrary {
  /** Entries to skip when extracting, typically `META-INF/`. */
  exclude: string[];
}

export interface ResolvedLibraries {
  classpath: ResolvedLibrary[];
  natives: ResolvedNative[];
}

/**
 * Splits a version's libraries into classpath entries and native archives.
 *
 * Modern versions (1.19+) ship natives as ordinary classpath artifacts with an
 * OS-specific rule instead of a `natives` block, so both mechanisms are handled: an
 * entry with a `natives` map is treated as an archive to extract, everything else that
 * passes its rules goes on the classpath.
 */
export function resolveLibraries(
  version: VersionJson,
  librariesRoot: string,
  osInfo: OsInfo = currentOs(),
): ResolvedLibraries {
  const classpath: ResolvedLibrary[] = [];
  const natives: ResolvedNative[] = [];
  const seen = new Set<string>();

  for (const library of version.libraries) {
    if (!matchesRules(library.rules, {}, osInfo)) continue;

    const classifier = nativeClassifier(library, osInfo);

    if (classifier) {
      const download = library.downloads?.classifiers?.[classifier];
      // A declared classifier with no matching download means this OS has no natives
      // for that library, which is normal — skip rather than fail the launch.
      if (!download) continue;

      natives.push({
        name: library.name,
        path: path.join(librariesRoot, download.path ?? mavenToPath(`${library.name}:${classifier}`)),
        download,
        exclude: library.extract?.exclude ?? ['META-INF/'],
      });
      continue;
    }

    const artifact = library.downloads?.artifact;
    const relative = artifact?.path ?? mavenToPath(library.name);
    const absolute = path.join(librariesRoot, relative);

    // The same coordinate can appear more than once once Forge's file is merged in;
    // the first occurrence wins so the overriding file is not shadowed.
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    classpath.push({
      name: library.name,
      path: absolute,
      download: artifact,
      repositoryUrl: library.url,
    });
  }

  return { classpath, natives };
}

/**
 * Merges a modded version file onto the vanilla one it inherits from.
 *
 * The child's libraries come first: Forge deliberately overrides some vanilla libraries,
 * and Java resolves duplicate classes by classpath order, so losing that order breaks the
 * launch in ways that are painful to diagnose.
 */
export function mergeInherited(child: VersionJson, parent: VersionJson): VersionJson {
  /*
   * Only synthesize `arguments` when at least one side actually has it.
   *
   * Producing `{ game: [], jvm: [] }` for two legacy version files looks harmless but is
   * not: an empty array is truthy, so callers testing `version.arguments?.jvm` conclude
   * the file uses the modern argument format and skip the legacy path that supplies
   * `-cp`. The result is a launch with no classpath at all, which surfaces as
   * "Could not find or load main class" — a long way from the cause.
   */
  const hasArguments = Boolean(parent.arguments || child.arguments);
  const mergedArguments = hasArguments
    ? {
        game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
        jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])],
      }
    : undefined;

  return {
    ...parent,
    ...child,
    libraries: [...child.libraries, ...parent.libraries],
    arguments: mergedArguments,
    // A child that declares no arguments at all must not lose the parent's legacy string.
    minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
    // Follows nested inheritance down to the vanilla version that owns the client jar.
    ellaBaseVersionId: parent.ellaBaseVersionId ?? parent.id,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    assets: child.assets ?? parent.assets,
    downloads: child.downloads ?? parent.downloads,
    javaVersion: child.javaVersion ?? parent.javaVersion,
    inheritsFrom: undefined,
  };
}
