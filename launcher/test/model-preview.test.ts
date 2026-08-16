import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModel,
  project,
  faceGeometry,
  screenBounds,
  drawOrder,
  FACE_SHADE,
} from '../src/shared/model-preview.ts';

const CUBE = { from: [0, 0, 0], to: [16, 16, 16], faces: {} };

test('parses a model with explicit elements', () => {
  const parsed = parseModel({
    elements: [{ from: [0, 0, 6], to: [9, 10, 8], faces: { north: { uv: [0, 0, 9, 10] } } }],
    textures: { '0': 'proj:block/x' },
  });

  assert.equal(parsed?.elements.length, 1);
  assert.deepEqual(parsed?.elements[0].to, [9, 10, 8]);
  assert.equal(parsed?.textures['0'], 'proj:block/x');
});

test('a model with no elements falls back to a full cube', () => {
  // Inheriting block/cube_all means the shape comes from the parent; drawing nothing
  // would misrepresent a block that renders perfectly well in game.
  const parsed = parseModel({ parent: 'block/cube_all', textures: { all: 'x' } });
  assert.equal(parsed?.elements.length, 1);
  assert.deepEqual(parsed?.elements[0].from, [0, 0, 0]);
  assert.deepEqual(parsed?.elements[0].to, [16, 16, 16]);
});

test('rejects things that are not models', () => {
  assert.equal(parseModel(null), null);
  assert.equal(parseModel('nope'), null);
  assert.equal(parseModel(42), null);
});

test('skips elements missing their bounds rather than throwing', () => {
  const parsed = parseModel({ elements: [{ faces: {} }, { from: [0, 0, 0], to: [1, 1, 1] }] });
  assert.equal(parsed?.elements.length, 1);
});

test('projection puts the vertical axis on screen y', () => {
  // Raising y must move the point up the screen, never sideways.
  const [x0, y0] = project(0, 0, 0, 1);
  const [x1, y1] = project(0, 16, 0, 1);
  assert.equal(x1, x0);
  assert.ok(y1 < y0, 'higher in model space is higher on screen');
});

test('projection separates the two horizontal axes', () => {
  const [ax] = project(16, 0, 0, 1);
  const [bx] = project(0, 0, 16, 1);
  assert.ok(ax > 0 && bx < 0, 'x and z fan out in opposite directions');
});

test('face geometry spans the face from its origin', () => {
  const geometry = faceGeometry(CUBE, 'up', 1);
  // A 16-unit face at scale 1 must have edges of non-zero length.
  assert.ok(Math.hypot(...geometry.edgeU) > 0);
  assert.ok(Math.hypot(...geometry.edgeV) > 0);
});

test('screen bounds cover the whole model', () => {
  const model = parseModel({ elements: [CUBE] })!;
  const bounds = screenBounds(model, 4);

  assert.ok(bounds.width > 0 && bounds.height > 0);
  assert.ok(bounds.minX < bounds.maxX);
  assert.ok(bounds.minY < bounds.maxY);
});

test('bounds scale linearly, so fitting to a canvas is a single division', () => {
  const model = parseModel({ elements: [CUBE] })!;
  const small = screenBounds(model, 1);
  const large = screenBounds(model, 3);

  assert.ok(Math.abs(large.width - small.width * 3) < 1e-9);
});

test('draw order is back to front', () => {
  const model = parseModel({
    elements: [
      { from: [0, 0, 0], to: [4, 4, 4], faces: {} },
      { from: [12, 12, 12], to: [16, 16, 16], faces: {} },
    ],
  })!;

  const order = drawOrder(model, 1);
  const depths = order.map((f) => f.geometry.depth);

  for (let i = 1; i < depths.length; i++) {
    assert.ok(depths[i] >= depths[i - 1], 'depths must be non-decreasing');
  }
});

test('every visible face of every element is drawn', () => {
  const model = parseModel({
    elements: [CUBE, { from: [0, 0, 0], to: [8, 8, 8], faces: {} }],
  })!;
  // Three visible faces per box under an isometric camera.
  assert.equal(drawOrder(model, 1).length, 6);
});

test('shading distinguishes the three visible faces', () => {
  // Identical shading would make a cube read as a flat hexagon.
  const values = Object.values(FACE_SHADE);
  assert.equal(new Set(values).size, values.length);
  assert.equal(FACE_SHADE.up, 1, 'the lit face is unshaded');
});
