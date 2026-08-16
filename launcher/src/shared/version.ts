/**
 * Minecraft version parsing and ordering.
 *
 * Two numbering schemes are in play:
 *   - legacy releases: `1.8.9`, `1.12.2`, `1.21.11`
 *   - year-based releases (2026 onwards): `26.1`, `26.2`
 *   - snapshots: `25w21a` (year/week) and `26.3-snapshot-6`
 *
 * The schemes order correctly against each other by plain numeric comparison of the
 * leading component, because every legacy release starts with `1` and every year-based
 * one starts with a two-digit year. Snapshot ordering is best-effort: it is accurate
 * enough to pick a Java runtime and an adapter, which is all it is used for.
 */

export interface ParsedVersion {
  raw: string;
  /** Base release numbers only — never includes the prerelease counter. */
  parts: number[];
  /** Snapshots and pre-releases sort *before* the release of the same number. */
  prerelease: boolean;
  /** Ordering among prereleases of the same base version. */
  prereleaseNumber: number;
  kind: 'release' | 'snapshot' | 'unknown';
}

const RELEASE_RE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const WEEK_SNAPSHOT_RE = /^(\d{2})w(\d{1,2})([a-z])$/i;
const NAMED_SNAPSHOT_RE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?[-_](?:pre|rc|snapshot)[-_]?(\d+)?$/i;

export function parseVersion(raw: string): ParsedVersion {
  const id = raw.trim();

  const release = RELEASE_RE.exec(id);
  if (release) {
    return {
      raw: id,
      parts: release.slice(1).filter((p) => p !== undefined).map(Number),
      prerelease: false,
      prereleaseNumber: 0,
      kind: 'release',
    };
  }

  // `25w21a` — year, week, then the letter as a within-week tiebreaker. These have no
  // matching release, so their parts fully define them and `prerelease` stays false.
  const week = WEEK_SNAPSHOT_RE.exec(id);
  if (week) {
    return {
      raw: id,
      parts: [Number(week[1]), Number(week[2]), week[3].toLowerCase().charCodeAt(0) - 97],
      prerelease: false,
      prereleaseNumber: 0,
      kind: 'snapshot',
    };
  }

  // `26.3-snapshot-6`, `1.21.2-pre3` — a prerelease *of* the base version, so the counter
  // is kept out of `parts` to stop it outranking the release it precedes.
  const named = NAMED_SNAPSHOT_RE.exec(id);
  if (named) {
    return {
      raw: id,
      parts: named.slice(1, 4).filter((p) => p !== undefined).map(Number),
      prerelease: true,
      prereleaseNumber: named[4] ? Number(named[4]) : 0,
      kind: 'snapshot',
    };
  }

  return { raw: id, parts: [], prerelease: false, prereleaseNumber: 0, kind: 'unknown' };
}

/** Returns <0 if `a` is older than `b`, 0 if equal, >0 if newer. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);

  // Unknown versions sort last but stay stable relative to each other.
  if (pa.kind === 'unknown' || pb.kind === 'unknown') {
    if (pa.kind === pb.kind) return pa.raw.localeCompare(pb.raw);
    return pa.kind === 'unknown' ? 1 : -1;
  }

  const len = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }

  // Same base numbers: a prerelease precedes the matching release.
  if (pa.prerelease !== pb.prerelease) return pa.prerelease ? -1 : 1;
  if (pa.prerelease && pb.prerelease) {
    const diff = pa.prereleaseNumber - pb.prereleaseNumber;
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export const isAtLeast = (version: string, min: string): boolean =>
  compareVersions(version, min) >= 0;

export const isBelow = (version: string, max: string): boolean =>
  compareVersions(version, max) < 0;

/** Inclusive lower bound, exclusive upper bound. `max` omitted means unbounded. */
export function isInRange(version: string, min: string, max?: string): boolean {
  if (compareVersions(version, min) < 0) return false;
  return max === undefined || compareVersions(version, max) < 0;
}

// ---------------------------------------------------------------------------
// Java runtime selection
// ---------------------------------------------------------------------------

/**
 * Minimum Java major version each Minecraft release requires. Ordered newest first;
 * the first matching range wins.
 *
 * Sources: Mojang bumped the bundled runtime at 1.17 (Java 16), 1.18 (Java 17) and
 * 1.20.5 (Java 21). Versions below 1.17 run on Java 8.
 */
const JAVA_REQUIREMENTS: Array<{ min: string; java: number }> = [
  { min: '1.20.5', java: 21 },
  { min: '1.18', java: 17 },
  { min: '1.17', java: 16 },
  { min: '0', java: 8 },
];

/**
 * Strips a modded suffix from a version id: `1.12.2-forge-14.23.5.2859` → `1.12.2`.
 *
 * Loaders conventionally prefix their version id with the Minecraft version, so the
 * leading release is recoverable. This matters because an unparseable id sorts *after*
 * every known release, and code that asks "is this at least X?" would answer yes for
 * every X — picking the newest Java for the oldest game.
 *
 * Returns the input unchanged when it already parses, or when nothing usable leads it.
 */
export function baseVersionOf(versionId: string): string {
  if (parseVersion(versionId).kind !== 'unknown') return versionId;
  const leading = /^(\d+(?:\.\d+){0,2})(?:[-_]|$)/.exec(versionId.trim());
  return leading ? leading[1] : versionId;
}

export function requiredJavaVersion(mcVersion: string): number {
  const base = baseVersionOf(mcVersion);

  // An id that still does not parse gets the oldest runtime rather than the newest.
  // Being wrong towards Java 8 fails loudly and early; being wrong towards Java 21 fails
  // deep inside a legacy launcher with an unrelated-looking cast error.
  if (parseVersion(base).kind === 'unknown') return 8;

  for (const { min, java } of JAVA_REQUIREMENTS) {
    if (isAtLeast(base, min)) return java;
  }
  return 8;
}

// ---------------------------------------------------------------------------
// Adapter selection
// ---------------------------------------------------------------------------

export type AdapterId = 'forge-1.8.9' | 'forge-1.12.2' | 'forge-mid' | 'forge-modern';

export interface AdapterCoverage {
  id: AdapterId;
  /** Inclusive lower bound. */
  min: string;
  /** Exclusive upper bound. */
  max: string;
  /**
   * `built` means a jar exists and the range was checked against a real toolchain.
   * `planned` means the bucket is designed for but has no jar yet.
   */
  status: 'built' | 'planned';
}

/**
 * Which Minecraft versions each adapter actually covers.
 *
 * These ranges must match the version range each adapter declares to its loader
 * (`mods.toml` on modern Forge, `mcmod.info` on 1.12.2). If they drift, the launcher
 * offers a version the game then refuses to load the mod on — which is exactly the
 * failure this table exists to prevent.
 *
 * Ranges are narrow on purpose. A bucket is *designed* to span a group of versions, but
 * an adapter only claims the versions it has been compiled against: Forge changed the
 * block properties and item component APIs inside every one of these spans, so
 * "compiles for 1.21.1" says nothing about 1.21.11.
 */
export const ADAPTERS: AdapterCoverage[] = [
  { id: 'forge-1.8.9', min: '1.8', max: '1.9', status: 'planned' },
  { id: 'forge-1.12.2', min: '1.12', max: '1.13', status: 'built' },
  { id: 'forge-mid', min: '1.16', max: '1.20.2', status: 'planned' },
  { id: 'forge-modern', min: '1.21.1', max: '1.21.2', status: 'built' },
];

/** The adapter covering a version, whether or not its jar exists yet. */
export function adapterCoverageFor(mcVersion: string): AdapterCoverage | null {
  return ADAPTERS.find((entry) => isInRange(mcVersion, entry.min, entry.max)) ?? null;
}

/**
 * The adapter jar that serves a version, or null when none does.
 *
 * Only returns adapters that are actually built: a `planned` bucket must not make the
 * launcher behave as though live editing will work.
 */
export function adapterFor(mcVersion: string): AdapterId | null {
  const coverage = adapterCoverageFor(mcVersion);
  return coverage?.status === 'built' ? coverage.id : null;
}

/** The floor: JSON models did not exist before 1.8, so there is nothing to test below it. */
export const MINIMUM_SUPPORTED_VERSION = '1.8';

export const isSupported = (mcVersion: string): boolean => adapterFor(mcVersion) !== null;
