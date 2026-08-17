/**
 * What moving a project from one Minecraft version to another does to the files in it.
 *
 * Most of a resource pack is version-independent, and deliberately so: an element's
 * geometry, its UVs, its display transforms and a project's references to its *own*
 * textures have read the same way from 1.8 to 1.21. Two things have not, and both fail
 * silently — the game loads the file, reports nothing, and draws the wrong thing:
 *
 *   - **A `parent` overrides the model's own geometry below 1.9.** The model renders as
 *     whatever it inherits from. See model-compat.ts for why, in full.
 *   - **Vanilla's texture folders were renamed in 1.13.** `textures/blocks` became
 *     `textures/block` and `textures/items` became `textures/item`, so a model that borrows
 *     a vanilla texture — `minecraft:blocks/stone`, which is what Blockbench writes when
 *     you pick one on 1.12 — resolves on one side of that line and shows the missing-texture
 *     checkerboard on the other.
 *
 * A project's own textures are deliberately left alone. A resource pack may keep them under
 * any folder it likes: the model's reference *is* the path, and Ella always writes
 * `<namespace>:block/<id>` with a file to match, which resolves identically on every
 * version. "Fixing" those to follow vanilla's rename would break the one thing that already
 * works everywhere.
 *
 * Everything here is pure. Reading the files and writing them back is main/version-change.ts.
 */

import { baseVersionOf, isAtLeast, isBelow } from './version.ts';
import {
  findParentTrap,
  withoutParent,
  PARENT_OVERRIDES_ELEMENTS_BELOW,
} from './model-compat.ts';

/** The release that renamed vanilla's `textures/blocks` and `textures/items` folders. */
export const VANILLA_FOLDER_RENAME = '1.13';

export type CompatIssueId = 'parentOverridesGeometry' | 'vanillaTextureFolder';

export interface CompatIssue {
  id: CompatIssueId;
  /** True when {@link migrateModel} can rewrite the model itself. */
  fixable: boolean;
  /** Values for the message describing it. */
  detail: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Vanilla texture references
// ---------------------------------------------------------------------------

/** Folder each era wants, keyed by the name the other era used. */
const FOLDER_FOR: Record<'modern' | 'legacy', Record<string, string>> = {
  modern: { blocks: 'block', items: 'item' },
  legacy: { block: 'blocks', item: 'items' },
};

const eraOf = (target: string): 'modern' | 'legacy' =>
  isAtLeast(baseVersionOf(target), VANILLA_FOLDER_RENAME) ? 'modern' : 'legacy';

/** The folders vanilla keeps its block and item textures in, on a given version. */
export function vanillaTextureFolders(target: string): { block: string; item: string } {
  return eraOf(target) === 'modern'
    ? { block: 'block', item: 'item' }
    : { block: 'blocks', item: 'items' };
}

/**
 * The same texture reference written the way `target` expects it, or null when it already
 * is — or when it is not a vanilla block/item texture at all.
 *
 * `#name` is a reference to another texture variable rather than to a file, and anything
 * outside the `minecraft` namespace belongs to a pack that decides its own layout.
 */
export function retargetVanillaTexture(reference: string, target: string): string | null {
  if (reference.startsWith('#')) return null;

  const colon = reference.indexOf(':');
  // An unqualified reference means vanilla, which is exactly the case that needs fixing.
  const namespace = colon === -1 ? 'minecraft' : reference.slice(0, colon);
  const location = colon === -1 ? reference : reference.slice(colon + 1);
  if (namespace !== 'minecraft') return null;

  const slash = location.indexOf('/');
  if (slash === -1) return null;

  const wanted = FOLDER_FOR[eraOf(target)][location.slice(0, slash)];
  if (!wanted) return null;

  const rewritten = `${wanted}/${location.slice(slash + 1)}`;
  return colon === -1 ? rewritten : `minecraft:${rewritten}`;
}

/** Every texture variable in a model whose vanilla reference is written for the wrong era. */
function staleVanillaTextures(
  model: unknown,
  target: string,
): Array<{ key: string; from: string; to: string }> {
  const textures = (model as { textures?: unknown }).textures;
  if (typeof textures !== 'object' || textures === null) return [];

  const stale: Array<{ key: string; from: string; to: string }> = [];
  for (const [key, value] of Object.entries(textures as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const retargeted = retargetVanillaTexture(value, target);
    if (retargeted) stale.push({ key, from: value, to: retargeted });
  }
  return stale;
}

// ---------------------------------------------------------------------------
// Inspection and migration
// ---------------------------------------------------------------------------

/** Everything about one model that would go wrong on `target`. */
export function inspectModel(model: unknown, target: string): CompatIssue[] {
  if (typeof model !== 'object' || model === null) return [];

  const issues: CompatIssue[] = [];
  const version = baseVersionOf(target);

  const trap = findParentTrap(model);
  if (trap && isBelow(version, PARENT_OVERRIDES_ELEMENTS_BELOW)) {
    issues.push({ id: 'parentOverridesGeometry', fixable: true, detail: { parent: trap.parent } });
  }

  const stale = staleVanillaTextures(model, version);
  if (stale.length > 0) {
    // One issue per model rather than per reference: they are the same mistake made once,
    // they are fixed in the same pass, and a row each would bury the rest of the report.
    // `count` carries the rest, so the UI can say how many without listing them.
    issues.push({
      id: 'vanillaTextureFolder',
      fixable: true,
      detail: { count: stale.length, reference: stale[0].from, expected: stale[0].to },
    });
  }

  return issues;
}

/**
 * Rewrites a model so it renders on `target`, returning a new object.
 *
 * Both rewrites are safe in either direction and on any version: dropping a parent leaves a
 * model that already had its own geometry self-contained, and a vanilla texture reference
 * has exactly one correct spelling per era. That is what makes offering this at launch
 * reasonable rather than reckless — nothing here is a guess about intent.
 */
export function migrateModel(
  model: Record<string, unknown>,
  target: string,
): { model: Record<string, unknown>; applied: CompatIssueId[] } {
  let next = model;
  const applied: CompatIssueId[] = [];

  for (const issue of inspectModel(model, target)) {
    if (!issue.fixable) continue;

    if (issue.id === 'parentOverridesGeometry') {
      next = withoutParent(next);
      applied.push(issue.id);
    }

    if (issue.id === 'vanillaTextureFolder') {
      const textures = { ...(next.textures as Record<string, string>) };
      for (const { key, to } of staleVanillaTextures(next, baseVersionOf(target))) {
        textures[key] = to;
      }
      next = { ...next, textures };
      applied.push(issue.id);
    }
  }

  return { model: next, applied };
}

// ---------------------------------------------------------------------------
// Consequences that are not about the project's files
// ---------------------------------------------------------------------------

export type CompatNoteId =
  | 'notInstalled'
  | 'noAdapter'
  | 'plannedAdapter'
  | 'javaMissing'
  | 'losesLiveEditing';

export interface CompatNote {
  id: CompatNoteId;
  detail: Record<string, string | number>;
}

/** The part of a version summary these notes are drawn from. */
export interface VersionFacts {
  id: string;
  installed: boolean;
  adapterStatus: 'built' | 'planned' | null;
  javaAvailable: boolean;
  requiredJava: number;
}

/**
 * What launching `to` costs, beyond the files. Every note is a warning — one that was not
 * would have no business in a confirmation dialog.
 *
 * `from` is the version the project is bound to, and is only used to say what is being
 * given up: losing live editing matters far more to someone who had it a moment ago than
 * to someone who never did.
 */
export function versionChangeNotes(from: VersionFacts | null, to: VersionFacts): CompatNote[] {
  const notes: CompatNote[] = [];

  if (!to.installed) {
    notes.push({ id: 'notInstalled', detail: { version: to.id } });
  }

  if (to.adapterStatus === null) {
    notes.push({ id: 'noAdapter', detail: { version: to.id } });
  } else if (to.adapterStatus === 'planned') {
    notes.push({ id: 'plannedAdapter', detail: { version: to.id } });
  }

  if (from?.adapterStatus === 'built' && to.adapterStatus !== 'built') {
    notes.push({ id: 'losesLiveEditing', detail: { from: from.id, to: to.id } });
  }

  if (!to.javaAvailable) {
    notes.push({ id: 'javaMissing', detail: { version: to.id, java: to.requiredJava } });
  }

  return notes;
}

/**
 * Whether launching `to` is a version change worth stopping for.
 *
 * An unbound project is not: the first launch is what binds it, and asking someone to
 * confirm a change away from nothing would be a dialog with no decision in it.
 */
export const isVersionChange = (from: string | null, to: string): boolean =>
  from !== null && from !== to;
