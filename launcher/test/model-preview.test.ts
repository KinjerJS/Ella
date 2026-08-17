import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModel,
  project,
  faceGeometry,
  screenBounds,
  drawOrder,
  visibleFaces,
  viewRadius,
  fitScale,
  modelCentre,
  turn,
  DEFAULT_VIEW,
  MAX_PITCH,
  FACE_SHADE,
  type ViewAngles,
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

test('shading distinguishes the faces visible at once', () => {
  // Identical shading would make a cube read as a flat hexagon. Opposite faces may share a
  // shade — vanilla gives them one — because no camera sees both.
  const shades = visibleFaces(DEFAULT_VIEW).map((face) => FACE_SHADE[face]);
  assert.equal(new Set(shades).size, shades.length);
  assert.equal(FACE_SHADE.up, 1, 'the lit face is unshaded');
});

test('the default view sees the top, south and east faces', () => {
  assert.deepEqual(visibleFaces(DEFAULT_VIEW).sort(), ['east', 'south', 'up']);
});

test('turning half way round shows the opposite faces', () => {
  const behind = turn(DEFAULT_VIEW, Math.PI, 0);
  assert.deepEqual(visibleFaces(behind).sort(), ['north', 'up', 'west']);
});

test('looking from below swaps the top face for the bottom one', () => {
  const under = turn(DEFAULT_VIEW, 0, -2 * DEFAULT_VIEW.pitch);
  assert.ok(visibleFaces(under).includes('down'));
  assert.ok(!visibleFaces(under).includes('up'));
});

test('a face seen exactly edge-on is not drawn', () => {
  // At yaw 0 the camera is square on to the south face, so east and west are slivers.
  const faces = visibleFaces({ yaw: 0, pitch: DEFAULT_VIEW.pitch });
  assert.deepEqual(faces.sort(), ['south', 'up']);
});

test('pitch cannot go past straight up or straight down', () => {
  assert.equal(turn(DEFAULT_VIEW, 0, 10).pitch, MAX_PITCH);
  assert.equal(turn(DEFAULT_VIEW, 0, -10).pitch, -MAX_PITCH);
});

test('yaw is free to wind past a full turn', () => {
  // Clamping it would make a drag stick at an arbitrary angle mid-gesture.
  const spun = turn(DEFAULT_VIEW, 4 * Math.PI, 0);
  assert.ok(Math.abs(spun.yaw - DEFAULT_VIEW.yaw - 4 * Math.PI) < 1e-9);
});

test('every visible face of every element is drawn, at any angle', () => {
  const model = parseModel({ elements: [CUBE, { from: [0, 0, 0], to: [8, 8, 8], faces: {} }] })!;
  const view = turn(DEFAULT_VIEW, 0.7, -0.2);

  assert.equal(drawOrder(model, 1, view).length, visibleFaces(view).length * 2);
});

test('draw order stays back to front after a rotation', () => {
  const model = parseModel({
    elements: [
      { from: [0, 0, 0], to: [4, 4, 4], faces: {} },
      { from: [12, 12, 12], to: [16, 16, 16], faces: {} },
    ],
  })!;

  for (const yaw of [0, 1, 2, 3, 4, 5]) {
    const order = drawOrder(model, 1, { yaw, pitch: 0.3 });
    const depths = order.map((face) => face.geometry.depth);

    for (let i = 1; i < depths.length; i++) {
      assert.ok(depths[i] >= depths[i - 1], `depths must be non-decreasing at yaw ${yaw}`);
    }
  }
});

test('no face is ever drawn mirrored', () => {
  // A face is textured by mapping the unit square onto (edgeU, edgeV); if that pair winds
  // the wrong way round, the texture comes out flipped. Invisible on a fixed camera, and
  // glaring the moment the model can be turned.
  for (const view of samples()) {
    for (const face of visibleFaces(view)) {
      const { edgeU, edgeV } = faceGeometry(CUBE, face, 1, view);
      const determinant = edgeU[0] * edgeV[1] - edgeU[1] * edgeV[0];

      assert.ok(determinant > 0, `${face} is mirrored at yaw ${view.yaw}, pitch ${view.pitch}`);
    }
  }
});

test('a face and its opposite are not mirror images of each other', () => {
  // Both textures are read left to right, so their screen u axes must point opposite ways —
  // the bug you only notice once the model can turn.
  const east = faceGeometry(CUBE, 'east', 1);
  const west = faceGeometry(CUBE, 'west', 1);

  assert.ok(east.edgeU[0] * west.edgeU[0] + east.edgeU[1] * west.edgeU[1] < 0);

  const north = faceGeometry(CUBE, 'north', 1);
  const south = faceGeometry(CUBE, 'south', 1);

  assert.ok(north.edgeU[0] * south.edgeU[0] + north.edgeU[1] * south.edgeU[1] < 0);
});

test('the model turns about its own centre', () => {
  const model = parseModel({ elements: [{ from: [4, 0, 4], to: [12, 6, 12], faces: {} }] })!;
  assert.deepEqual(modelCentre(model), [8, 3, 8]);
});

test('the fitted size does not change as the model turns', () => {
  // A preview that swells and shrinks mid-drag reads as broken, so the fit has to hold the
  // model at every angle rather than at the current one.
  const model = parseModel({ elements: [CUBE] })!;
  const scale = fitScale(model, 100);

  for (const view of samples()) {
    const bounds = screenBounds(model, scale, view);
    assert.ok(bounds.width <= 100 && bounds.height <= 100, 'the model never leaves the canvas');
  }
});

test('the fit is tight enough to be worth the canvas', () => {
  const model = parseModel({ elements: [CUBE] })!;
  const scale = fitScale(model, 100);
  const widest = Math.max(...samples().map((view) => screenBounds(model, scale, view).height));

  assert.ok(widest > 80, 'some angle fills most of the canvas');
});

test('a flat model fits as well as a bulky one', () => {
  const plate = parseModel({ elements: [{ from: [0, 0, 7], to: [16, 16, 9], faces: {} }] })!;
  assert.ok(viewRadius(plate) < viewRadius(parseModel({ elements: [CUBE] })!));
});

function samples(): ViewAngles[] {
  const views: ViewAngles[] = [];
  for (let yaw = 0; yaw < 12; yaw++) {
    for (let pitch = -3; pitch <= 3; pitch++) {
      views.push({ yaw: (yaw * Math.PI) / 6, pitch: (pitch * MAX_PITCH) / 3 });
    }
  }
  return views;
}
