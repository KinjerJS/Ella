import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_FIELDS,
  ITEM_FIELDS,
  defaultsFor,
  checkSettings,
  isFieldAvailable,
  isOptionAvailable,
  fieldsFor,
} from '../src/shared/settings-schema.ts';
import { CAPABILITIES } from '../src/shared/protocol.ts';

test('defaults are complete for both kinds', () => {
  for (const kind of ['block', 'item'] as const) {
    const defaults = defaultsFor(kind);
    for (const field of fieldsFor(kind)) {
      assert.ok(field.key in defaults, `${kind}.${field.key} has no default`);
    }
  }
});

test('default settings raise no warnings', () => {
  assert.deepEqual(checkSettings('block', defaultsFor('block')), []);
  assert.deepEqual(checkSettings('item', defaultsFor('item')), []);
});

test('flags a transparent render layer that still occludes neighbours', () => {
  // The single most common mistake: cutout set, but the block still culls its
  // neighbours' faces, so it renders as if it were solid.
  const warnings = checkSettings('block', {
    ...defaultsFor('block'),
    renderLayer: 'cutout',
    opaque: true,
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].messageKey, 'warning.transparentButOpaque');
  assert.deepEqual(warnings[0].fix, { opaque: false });
});

test('flags the inverse mistake too', () => {
  const warnings = checkSettings('block', {
    ...defaultsFor('block'),
    renderLayer: 'solid',
    opaque: false,
  });
  assert.equal(warnings[0].messageKey, 'warning.nonOpaqueSolidLayer');
});

test('applying the offered fix clears the warning', () => {
  const settings = { ...defaultsFor('block'), renderLayer: 'translucent', opaque: true };
  const [warning] = checkSettings('block', settings);
  assert.deepEqual(checkSettings('block', { ...settings, ...warning.fix }), []);
});

test('flags a custom hitbox on a full cube', () => {
  const warnings = checkSettings('block', {
    ...defaultsFor('block'),
    collision: 'custom',
    fullCube: true,
  });
  assert.ok(warnings.some((w) => w.messageKey === 'warning.customHitboxFullCube'));
});

test('flags an inverted hitbox', () => {
  const warnings = checkSettings('block', {
    ...defaultsFor('block'),
    collision: 'custom',
    fullCube: false,
    hitbox: [8, 0, 0, 4, 16, 16],
  });
  assert.ok(warnings.some((w) => w.messageKey === 'warning.invalidHitbox'));
});

test('items are not subjected to block rules', () => {
  assert.deepEqual(checkSettings('item', { renderLayer: 'cutout', opaque: true }), []);
});

test('capability gating disables rather than silently drops', () => {
  const hitbox = BLOCK_FIELDS.find((f) => f.key === 'hitbox')!;
  assert.equal(isFieldAvailable(hitbox, []), false);
  assert.equal(isFieldAvailable(hitbox, ['hitbox.custom']), true);

  const renderLayer = BLOCK_FIELDS.find((f) => f.key === 'renderLayer')!;
  assert.equal(isFieldAvailable(renderLayer, []), true, 'render layer itself is universal');
});

test('render layer options gate individually', () => {
  const renderLayer = BLOCK_FIELDS.find((f) => f.key === 'renderLayer')!;
  assert.equal(renderLayer.type, 'enum');
  if (renderLayer.type !== 'enum') return;

  const solid = renderLayer.options.find((o) => o.value === 'solid')!;
  const mipped = renderLayer.options.find((o) => o.value === 'cutout_mipped')!;

  assert.equal(isOptionAvailable(solid, []), true, 'solid works everywhere');
  assert.equal(isOptionAvailable(mipped, []), false);
  assert.equal(isOptionAvailable(mipped, ['render_layer.cutout_mipped']), true);
});

test('every capability referenced by the schema is a declared one', () => {
  const declared = new Set<string>(CAPABILITIES);
  for (const field of [...BLOCK_FIELDS, ...ITEM_FIELDS]) {
    if (field.capability) {
      assert.ok(declared.has(field.capability), `undeclared capability ${field.capability}`);
    }
    if (field.type === 'enum') {
      for (const option of field.options) {
        if (option.capability) {
          assert.ok(declared.has(option.capability), `undeclared ${option.capability}`);
        }
      }
    }
  }
});

test('field keys are unique within a kind', () => {
  for (const kind of ['block', 'item'] as const) {
    const keys = fieldsFor(kind).map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, `duplicate key in ${kind} fields`);
  }
});

test('visibleWhen references a field that exists', () => {
  for (const kind of ['block', 'item'] as const) {
    const keys = new Set(fieldsFor(kind).map((f) => f.key));
    for (const field of fieldsFor(kind)) {
      if (field.visibleWhen) {
        assert.ok(keys.has(field.visibleWhen.key), `${field.key} points at a missing field`);
      }
    }
  }
});
