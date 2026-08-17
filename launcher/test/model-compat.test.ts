import test from 'node:test';
import assert from 'node:assert/strict';
import { findParentTrap, withoutParent } from '../src/shared/model-compat.ts';
import { defaultBlockModel } from '../src/main/pack.ts';

/*
 * The failure these guard, in full.
 *
 * 1.8.9's ModelBlock.getElements() is `hasParent() ? parent.getElements() : elements`,
 * with hasParent() being `parent != null`. The parent wins outright — which is why vanilla
 * 1.8.9's own block/cube.json declares no parent and inlines its elements, and only gained
 * `"parent": "block/block"` in 1.9 once the child started winning.
 *
 * Blockbench keeps whatever parent it finds. A model that starts as `cube_all` and then
 * gains geometry therefore renders in game as a plain cube in the missing-texture
 * checkerboard: the author's shapes are discarded, and the parent's `#all` no longer
 * resolves because Blockbench rewrote the texture keys.
 */

const BLOCKBENCH_OUTPUT = {
  format_version: '1.21.11',
  parent: 'block/cube_all',
  textures: { 0: 'proj:block/thing', particle: 'proj:block/thing' },
  elements: [{ from: [0, 5, 7], to: [9, 7, 9], faces: {} }],
};

test('a parent over the model’s own geometry is reported', () => {
  const trap = findParentTrap(BLOCKBENCH_OUTPUT);
  assert.deepEqual(trap, { parent: 'block/cube_all', elementCount: 1 });
});

test('inheriting geometry is normal and not reported', () => {
  // The everyday case: no elements of its own, so the parent is doing its job.
  assert.equal(findParentTrap({ parent: 'block/cube_all', textures: { all: 'a:b' } }), null);
  // Ella's own slot redirect is exactly this shape and must never be flagged.
  assert.equal(findParentTrap({ parent: 'proj:block/thing' }), null);
});

test('a self-contained model is not reported', () => {
  assert.equal(findParentTrap({ elements: [{ from: [0, 0, 0], to: [16, 16, 16] }] }), null);
});

test('malformed input is not mistaken for a trap', () => {
  for (const value of [null, undefined, 'model', 42, [], {}]) {
    assert.equal(findParentTrap(value), null, `${JSON.stringify(value)} should be ignored`);
  }
  // An empty elements array means the parent still supplies the geometry.
  assert.equal(findParentTrap({ parent: 'block/cube_all', elements: [] }), null);
  assert.equal(findParentTrap({ parent: '', elements: [{}] }), null);
});

test('the fix removes only the parent', () => {
  const fixed = withoutParent(BLOCKBENCH_OUTPUT);

  assert.equal('parent' in fixed, false);
  assert.equal(findParentTrap(fixed), null, 'the fixed model must not trip the check again');
  assert.deepEqual(fixed.elements, BLOCKBENCH_OUTPUT.elements);
  assert.deepEqual(fixed.textures, BLOCKBENCH_OUTPUT.textures);
  assert.equal(fixed.format_version, '1.21.11', 'unrelated keys Blockbench needs stay');
  assert.equal('parent' in BLOCKBENCH_OUTPUT, true, 'the input is not mutated');
});

test('the generated starting model cannot inherit the trap', () => {
  // A new block starts self-contained precisely so Blockbench has no parent to keep.
  const model = JSON.parse(defaultBlockModel('proj:block/thing'));

  assert.equal('parent' in model, false);
  assert.ok(model.elements.length > 0, 'it has to draw something on its own');
  assert.equal(findParentTrap(model), null);

  // Still a full cube, which is what inheriting from cube_all used to provide.
  assert.deepEqual(model.elements[0].from, [0, 0, 0]);
  assert.deepEqual(model.elements[0].to, [16, 16, 16]);
  assert.equal(model.textures.all, 'proj:block/thing');
  assert.equal(model.textures.particle, 'proj:block/thing', 'break particles need a texture');
});
