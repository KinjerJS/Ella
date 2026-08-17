/**
 * Orthographic preview of a Minecraft block model, from any camera angle.
 *
 * A block model is a list of axis-aligned boxes with a texture region per face, so an
 * exact render needs no 3D engine: each face is a parallelogram on screen, and a canvas
 * affine transform maps the texture rectangle onto it.
 *
 * The camera is described by two angles — `yaw` around the vertical axis and `pitch` for
 * its elevation — so the preview can be turned. Only the faces whose outward normal points
 * at the camera are drawn, which is what makes the result read as a solid block rather
 * than a flat sprite. The default view is the isometric one this preview has always used.
 *
 * Known limits, deliberate rather than accidental:
 *   - element rotations are ignored (vanilla allows one 22.5° step per element)
 *   - no lighting beyond vanilla's fixed shade per face direction
 *   - a model with no `elements` of its own falls back to a full cube, which is what
 *     inheriting `block/cube_all` amounts to
 */

/** A face's texture reference and UV window, as written in a model. */
interface ModelFace {
  texture?: string;
  uv?: number[];
}

interface ModelElement {
  from?: number[];
  to?: number[];
  faces?: Record<string, ModelFace>;
}

export interface ParsedModel {
  elements: Required<ModelElement>[];
  textures: Record<string, string>;
}

type Vec3 = [number, number, number];

/** The six faces of a box. */
const FACES = ['up', 'down', 'north', 'south', 'east', 'west'] as const;
export type Face = (typeof FACES)[number];

/** Outward normal per face, in model space: x east, y up, z south. */
const FACE_NORMAL: Record<Face, Vec3> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
};

/**
 * Shade per face, standing in for Minecraft's own directional lighting. The values are
 * vanilla's: brightness depends on which way a face points, not on where the camera is, so
 * turning the model shades the newly revealed faces the same way the game would.
 */
const FACE_SHADE: Record<Face, number> = {
  up: 1,
  down: 0.5,
  north: 0.8,
  south: 0.8,
  east: 0.6,
  west: 0.6,
};

/** Camera angles, in radians. */
export interface ViewAngles {
  /** Rotation about the vertical axis. At 0 the camera faces the model's south side. */
  yaw: number;
  /** Camera elevation. Positive looks down on the model, negative looks up at it. */
  pitch: number;
}

/**
 * The isometric view: yaw 45°, pitch 35.26°. Chosen so the three visible faces are equal
 * on screen, which is the angle Minecraft's own inventory render uses.
 */
export const DEFAULT_VIEW: ViewAngles = { yaw: Math.PI / 4, pitch: Math.atan(Math.SQRT1_2) };

/** Straight down and straight up: past these the model would turn inside out. */
export const MAX_PITCH = Math.PI / 2;

/**
 * Uniform zoom baked into the projection, picked so the default view reproduces the plain
 * 2:1 isometric formula this preview used before it could rotate.
 */
const VIEW_SCALE = Math.sqrt(1.5);

/** Fraction of the canvas the model is allowed to fill. The rest is breathing room. */
const FIT_MARGIN = 0.92;

/** Projects model space (0..16, y up) to 2D screen space under the given camera. */
export function project(
  x: number,
  y: number,
  z: number,
  scale: number,
  view: ViewAngles = DEFAULT_VIEW,
): [number, number] {
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const cosPitch = Math.cos(view.pitch);
  const sinPitch = Math.sin(view.pitch);
  const k = scale * VIEW_SCALE;

  // Yaw turns the two horizontal axes into a screen-right component and a depth component;
  // pitch then trades that depth against height for the vertical screen axis.
  return [
    (x * cosYaw - z * sinYaw) * k,
    ((x * sinYaw + z * cosYaw) * sinPitch - y * cosPitch) * k,
  ];
}

/** Unit vector pointing from the model towards the camera. */
export function viewVector(view: ViewAngles = DEFAULT_VIEW): Vec3 {
  const cosPitch = Math.cos(view.pitch);
  return [Math.sin(view.yaw) * cosPitch, Math.sin(view.pitch), Math.cos(view.yaw) * cosPitch];
}

/**
 * The faces the camera can see. A face exactly edge-on is left out: it would be drawn as a
 * zero-width sliver, and the face behind it says the same thing better.
 */
export function visibleFaces(view: ViewAngles = DEFAULT_VIEW): Face[] {
  const towardsCamera = viewVector(view);
  return FACES.filter((face) => dot(FACE_NORMAL[face], towardsCamera) > 1e-6);
}

/** Applies a rotation to a view, keeping pitch within the range that stays right-side up. */
export function turn(view: ViewAngles, yawDelta: number, pitchDelta: number): ViewAngles {
  return {
    yaw: view.yaw + yawDelta,
    pitch: Math.min(MAX_PITCH, Math.max(-MAX_PITCH, view.pitch + pitchDelta)),
  };
}

export function parseModel(raw: unknown): ParsedModel | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const model = raw as { elements?: ModelElement[]; textures?: Record<string, string> };

  const textures = model.textures ?? {};

  // No elements means the shape comes from a parent — in practice `block/cube_all`, so a
  // full cube is the honest stand-in rather than drawing nothing.
  const source: ModelElement[] =
    Array.isArray(model.elements) && model.elements.length > 0
      ? model.elements
      : [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }];

  const elements = source
    .filter((element) => Array.isArray(element.from) && Array.isArray(element.to))
    .map((element) => ({
      from: element.from as number[],
      to: element.to as number[],
      faces: element.faces ?? {},
    }));

  return elements.length > 0 ? { elements, textures } : null;
}

interface FaceCorners {
  /** Screen-space quad, ordered to match the texture's top-left, top-right, bottom-left. */
  origin: [number, number];
  edgeU: [number, number];
  edgeV: [number, number];
  depth: number;
}

interface Box {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
}

/**
 * The three model-space corners that frame a face's texture: its origin, then the far end
 * of the texture's u axis and of its v axis.
 *
 * The choice per face is vanilla's own UV convention — looking straight at a face, u runs
 * right and v runs down. Getting this wrong is invisible on a fixed camera but obvious once
 * the model turns, because a face and its opposite would then mirror each other.
 */
const FACE_CORNERS: Record<Face, (box: Box) => [Vec3, Vec3, Vec3]> = {
  up: ({ x1, y2, z1, x2, z2 }) => [
    [x1, y2, z1],
    [x2, y2, z1],
    [x1, y2, z2],
  ],
  down: ({ x1, y1, z1, x2, z2 }) => [
    [x1, y1, z2],
    [x2, y1, z2],
    [x1, y1, z1],
  ],
  north: ({ x1, y1, z1, x2, y2 }) => [
    [x2, y2, z1],
    [x1, y2, z1],
    [x2, y1, z1],
  ],
  south: ({ x1, y1, x2, y2, z2 }) => [
    [x1, y2, z2],
    [x2, y2, z2],
    [x1, y1, z2],
  ],
  east: ({ y1, z1, x2, y2, z2 }) => [
    [x2, y2, z2],
    [x2, y2, z1],
    [x2, y1, z2],
  ],
  west: ({ x1, y1, z1, y2, z2 }) => [
    [x1, y2, z1],
    [x1, y2, z2],
    [x1, y1, z1],
  ],
};

/**
 * Screen-space geometry for one face of one box.
 *
 * `edgeU` and `edgeV` span the face from `origin`, which is exactly what an affine texture
 * map needs. `depth` measures how near the camera the face is, for the draw order.
 */
export function faceGeometry(
  element: { from: number[]; to: number[] },
  face: Face,
  scale: number,
  view: ViewAngles = DEFAULT_VIEW,
): FaceCorners {
  const [origin, uEnd, vEnd] = FACE_CORNERS[face](boxOf(element));

  const projected = (point: Vec3): [number, number] =>
    project(point[0], point[1], point[2], scale, view);

  const screenOrigin = projected(origin);

  return {
    origin: screenOrigin,
    edgeU: sub(projected(uEnd), screenOrigin),
    edgeV: sub(projected(vEnd), screenOrigin),
    // The face's centre is the midpoint of the u-v diagonal; how far along the view
    // direction it sits is what orders one face against another.
    depth: dot(midpoint(uEnd, vEnd), viewVector(view)),
  };
}

/** Draw order: far faces first, so nearer boxes paint over them. */
export function drawOrder(
  model: ParsedModel,
  scale: number,
  view: ViewAngles = DEFAULT_VIEW,
): Array<{ element: ParsedModel['elements'][number]; face: Face; geometry: FaceCorners }> {
  const faces: Array<{
    element: ParsedModel['elements'][number];
    face: Face;
    geometry: FaceCorners;
  }> = [];

  for (const element of model.elements) {
    for (const face of visibleFaces(view)) {
      faces.push({ element, face, geometry: faceGeometry(element, face, scale, view) });
    }
  }

  return faces.sort((a, b) => a.geometry.depth - b.geometry.depth);
}

/** Bounding box of a model in screen space, under one camera angle. */
export function screenBounds(model: ParsedModel, scale: number, view: ViewAngles = DEFAULT_VIEW) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const corner of corners(model)) {
    const [sx, sy] = project(corner[0], corner[1], corner[2], scale, view);
    minX = Math.min(minX, sx);
    minY = Math.min(minY, sy);
    maxX = Math.max(maxX, sx);
    maxY = Math.max(maxY, sy);
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Model-space centre of the whole model: the point a rotation turns about. */
export function modelCentre(model: ParsedModel): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const corner of corners(model)) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], corner[axis]);
      max[axis] = Math.max(max[axis], corner[axis]);
    }
  }

  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/**
 * Screen-space radius, at scale 1, that holds the model whichever way it is turned.
 *
 * Fitting to the bounding box of the current angle instead would be tighter, but the model
 * would then swell and shrink as it rotates, which reads as the preview being broken. The
 * projection is an orthographic view of a rigid rotation, so the sphere around the model
 * projects to a circle of this radius at every angle.
 */
export function viewRadius(model: ParsedModel): number {
  const centre = modelCentre(model);
  let radius = 0;

  for (const corner of corners(model)) {
    radius = Math.max(radius, Math.hypot(...sub3(corner, centre)));
  }

  return radius * VIEW_SCALE;
}

/** Scale that fits the model to a square canvas of `size`, at any camera angle. */
export function fitScale(model: ParsedModel, size: number): number {
  return (size * FIT_MARGIN) / Math.max(viewRadius(model) * 2, 1);
}

function* corners(model: ParsedModel): Generator<Vec3> {
  for (const element of model.elements) {
    const [x1, y1, z1] = element.from;
    const [x2, y2, z2] = element.to;

    for (const x of [x1, x2]) {
      for (const y of [y1, y2]) {
        for (const z of [z1, z2]) {
          yield [x, y, z];
        }
      }
    }
  }
}

const boxOf = (element: { from: number[]; to: number[] }): Box => ({
  x1: element.from[0],
  y1: element.from[1],
  z1: element.from[2],
  x2: element.to[0],
  y2: element.to[1],
  z2: element.to[2],
});

const sub = (a: [number, number], b: [number, number]): [number, number] => [
  a[0] - b[0],
  a[1] - b[1],
];

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const midpoint = (a: Vec3, b: Vec3): Vec3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export { FACE_SHADE, FACES };
