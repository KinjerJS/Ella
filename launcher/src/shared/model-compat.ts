/**
 * Cross-version model compatibility checks.
 *
 * One divergence matters enough to have its own module, because it is silent, it only
 * shows up in game, and it looks like Ella losing the model rather than like a model
 * problem.
 *
 * **A model that declares `parent` has its own `elements` ignored on 1.8.x.**
 *
 * `ModelBlock.getElements()` on 1.8.9 reads, in full:
 *
 * ```java
 * return this.hasParent() ? this.parent.getElements() : this.elements;
 * ```
 *
 * with `hasParent()` being nothing more than `parent != null`. The parent wins
 * unconditionally. That is why vanilla 1.8.9's own `block/cube.json` declares no parent at
 * all and inlines its elements — the file only gained `"parent": "block/block"` in 1.9,
 * when the semantics flipped to "the child's elements win if it has any".
 *
 * So a model carrying both — which is exactly what Blockbench writes when you add geometry
 * to a model that started as `block/cube_all` — renders as its parent on 1.8.x. With the
 * texture keys Blockbench also rewrites, the parent's `#all` no longer resolves either, so
 * the result is a full cube in the missing-texture checkerboard: the model appears not to
 * have loaded, when in fact it loaded and was overruled.
 */

export interface ParentTrap {
  /** The parent that will win over the model's own geometry. */
  parent: string;
  /** How many elements are being discarded, for a message worth reading. */
  elementCount: number;
}

/** The versions whose loader lets a parent override the child's geometry. */
export const PARENT_OVERRIDES_ELEMENTS_BELOW = '1.9';

/**
 * Reports a model that will render as its parent instead of as itself.
 *
 * Returns null for the two shapes that are always fine: a model with a parent and no
 * geometry of its own (the normal `cube_all` case, and Ella's own slot redirects), and a
 * self-contained model with no parent.
 */
export function findParentTrap(model: unknown): ParentTrap | null {
  if (typeof model !== 'object' || model === null) return null;

  const candidate = model as { parent?: unknown; elements?: unknown };
  if (typeof candidate.parent !== 'string' || candidate.parent.length === 0) return null;
  if (!Array.isArray(candidate.elements) || candidate.elements.length === 0) return null;

  return { parent: candidate.parent, elementCount: candidate.elements.length };
}

/**
 * Removes the parent, leaving the model self-contained.
 *
 * Dropping it is the whole fix and it costs nothing: a model with its own elements never
 * needed the parent for geometry, and on every version from 1.9 onwards the parent's
 * geometry was already being ignored. Texture variables resolve against the model's own
 * map, which Blockbench has written by the time there are elements to resolve them for.
 *
 * Returns a new object; the input is left alone.
 */
export function withoutParent(model: Record<string, unknown>): Record<string, unknown> {
  const { parent: _dropped, ...rest } = model;
  return rest;
}
