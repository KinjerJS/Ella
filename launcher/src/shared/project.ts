/**
 * Ella project format v1 — see docs/project-format.md.
 *
 * A project is a directory, not an archive: Blockbench opens files inside it directly and
 * it diffs cleanly under version control. Only export produces a zip.
 */

import type { EntryKind, LocaleMap } from './protocol.ts';

export const PROJECT_FORMAT_VERSION = 1;
export const PROJECT_MANIFEST = 'project.json';

export type ModelSourceKind = 'json' | 'bbmodel' | 'obj';

export interface ModelSource {
  source: ModelSourceKind;
  /** Project-relative path to the authoring file. */
  path: string;
  /** Project-relative path to the vanilla JSON the game actually loads. */
  output: string;
}

export interface ProjectEntry {
  id: string;
  kind: EntryKind;
  displayName: LocaleMap;
  /** Runtime slot index, or null when unbound. Never referenced by an export. */
  slot: number | null;
  model: ModelSource;
  settings: Record<string, unknown>;
}

export interface EllaProject {
  formatVersion: number;
  name: string;
  namespace: string;
  /**
   * The Minecraft version this project is authored against, or null until a launch binds
   * one. It is what the launcher preselects when the project is opened, and what a launch
   * on any other version is checked against — see shared/version-compat.ts.
   */
  targetVersion: string | null;
  slotPool: Record<EntryKind, number>;
  entries: ProjectEntry[];
}

/**
 * Fills in a manifest read from disk.
 *
 * `targetVersion` replaced a `targetVersions` array that nothing ever read or wrote past
 * creation. Projects written before the change carry the array, so its first entry is
 * adopted rather than discarded: it was the version the author picked when they created
 * the project, which is exactly what the field now means.
 */
export function withDefaults(project: EllaProject): EllaProject {
  if (typeof project.targetVersion === 'string' || project.targetVersion === null) {
    return project;
  }

  const legacy = (project as { targetVersions?: unknown }).targetVersions;
  const adopted = Array.isArray(legacy) && typeof legacy[0] === 'string' ? legacy[0] : null;

  return { ...project, targetVersion: adopted };
}

// ---------------------------------------------------------------------------
// Identifier rules
// ---------------------------------------------------------------------------

/** Minecraft resource locations accept only these characters in a path segment. */
export const IDENTIFIER_PATTERN = /^[a-z0-9_]+$/;

export function isValidIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value) && value.length <= 64;
}

/**
 * Converts arbitrary text into a usable identifier. Used to prefill the id field from a
 * display name, never to silently rewrite something the user typed.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    // Strip combining marks so "Épée dorée" yields "epee_doree" rather than losing the
    // accented letters entirely. Written as escapes so it does not depend on file encoding.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export function emptyProject(name: string, namespace: string): EllaProject {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name,
    namespace,
    targetVersion: null,
    slotPool: { block: 128, item: 128 },
    entries: [],
  };
}

// ---------------------------------------------------------------------------
// Paths inside a project
// ---------------------------------------------------------------------------

/** All generated paths are POSIX-style: they end up inside a resource pack. */
export const packRoot = 'pack';

export const assetPath = (namespace: string, ...segments: string[]): string =>
  [packRoot, 'assets', namespace, ...segments].join('/');

export const blockstatePath = (namespace: string, id: string): string =>
  assetPath(namespace, 'blockstates', `${id}.json`);

export const blockModelPath = (namespace: string, id: string): string =>
  assetPath(namespace, 'models', 'block', `${id}.json`);

export const itemModelPath = (namespace: string, id: string): string =>
  assetPath(namespace, 'models', 'item', `${id}.json`);

export const blockTexturePath = (namespace: string, id: string): string =>
  assetPath(namespace, 'textures', 'block', `${id}.png`);

export const itemTexturePath = (namespace: string, id: string): string =>
  assetPath(namespace, 'textures', 'item', `${id}.png`);

export const langPath = (namespace: string, locale: string): string =>
  assetPath(namespace, 'lang', `${locale}.json`);

export const sourcePath = (id: string, extension: string): string =>
  `sources/${id}.${extension}`;

/** The model output path a given entry kind writes to. */
export function defaultModelOutput(namespace: string, entry: Pick<ProjectEntry, 'id' | 'kind'>): string {
  return entry.kind === 'block'
    ? blockModelPath(namespace, entry.id)
    : itemModelPath(namespace, entry.id);
}

// ---------------------------------------------------------------------------
// Translation keys
// ---------------------------------------------------------------------------

/**
 * The translation keys an exported entry answers to, newest convention first.
 *
 * Shown in the editor so the connection between the identifier and the in-game name is
 * visible: the id is not just a filename, it is what a mod would pass to
 * `setTranslationKey`. Both conventions are listed because Ella's range needs both — see
 * `buildLangFiles` in main/pack.ts.
 */
export function translationKeysFor(
  namespace: string,
  entry: Pick<ProjectEntry, 'id' | 'kind'>,
): { modern: string; legacy: string } {
  const legacyPrefix = entry.kind === 'block' ? 'tile' : 'item';
  return {
    modern: `${entry.kind}.${namespace}.${entry.id}`,
    legacy: `${legacyPrefix}.${namespace}.${entry.id}.name`,
  };
}

/** The registry name an export produces for an entry. */
export const registryNameFor = (namespace: string, id: string): string => `${namespace}:${id}`;

// ---------------------------------------------------------------------------
// Slot allocation
// ---------------------------------------------------------------------------

/** Registry name of a pool slot. Zero-padded so names sort naturally. */
export const slotRegistryName = (kind: EntryKind, slot: number): string =>
  `ella:${kind}_${String(slot).padStart(3, '0')}`;

/**
 * Finds the lowest free slot for a kind. Returns null when the pool is exhausted, which
 * the UI reports as "restart the game to free slots" rather than failing silently.
 */
export function nextFreeSlot(project: EllaProject, kind: EntryKind): number | null {
  const taken = new Set(
    project.entries.filter((entry) => entry.kind === kind && entry.slot !== null)
      .map((entry) => entry.slot as number),
  );

  const size = project.slotPool[kind];
  for (let slot = 0; slot < size; slot++) {
    if (!taken.has(slot)) return slot;
  }
  return null;
}
