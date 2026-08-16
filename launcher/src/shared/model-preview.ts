/**
 * Isometric preview of a Minecraft block model.
 *
 * A block model is a list of axis-aligned boxes with a texture region per face, so an
 * exact isometric render needs no 3D engine: each visible face is a parallelogram, and a
 * canvas affine transform maps the texture rectangle onto it.
 *
 * Only the three faces an isometric camera can see are drawn — up, south and east — which
 * is what makes the result read as a block rather than a flat sprite.
 *
 * Known limits, deliberate rather than accidental:
 *   - element rotations are ignored (vanilla allows one 22.5° step per element)
 *   - no lighting beyond a fixed shade per face direction
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

/** Faces an isometric view can see, drawn back to front. */
const VISIBLE_FACES = ['up', 'south', 'east'] as const;
export type VisibleFace = (typeof VISIBLE_FACES)[number];

/**
 * Fixed shade per face, standing in for Minecraft's own directional lighting. The values
 * match vanilla's relative face brightness closely enough to read correctly.
 */
const FACE_SHADE: Record<VisibleFace, number> = {
  up: 1,
  south: 0.8,
  east: 0.6,
};

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

/** Projects model space (0..16, y up) to 2D isometric screen space. */
export function project(x: number, y: number, z: number, scale: number): [number, number] {
  // Standard 2:1 isometric: x and z fan out sideways, y is vertical.
  return [(x - z) * scale * 0.866, (x + z) * scale * 0.5 - y * scale];
}

interface FaceCorners {
  /** Screen-space quad, ordered to match the texture's top-left, top-right, bottom-left. */
  origin: [number, number];
  edgeU: [number, number];
  edgeV: [number, number];
  depth: number;
}

/**
 * Screen-space geometry for one face of one box.
 *
 * `edgeU` and `edgeV` span the face from `origin`, which is exactly what an affine
 * texture map needs.
 */
export function faceGeometry(
  element: { from: number[]; to: number[] },
  face: VisibleFace,
  scale: number,
): FaceCorners {
  const [x1, y1, z1] = element.from;
  const [x2, y2, z2] = element.to;

  const at = (x: number, y: number, z: number): [number, number] => project(x, y, z, scale);

  switch (face) {
    case 'up':
      return {
        origin: at(x1, y2, z1),
        edgeU: sub(at(x2, y2, z1), at(x1, y2, z1)),
        edgeV: sub(at(x1, y2, z2), at(x1, y2, z1)),
        depth: y2 + (x1 + z1) * 0.001,
      };
    case 'south':
      return {
        origin: at(x1, y2, z2),
        edgeU: sub(at(x2, y2, z2), at(x1, y2, z2)),
        edgeV: sub(at(x1, y1, z2), at(x1, y2, z2)),
        depth: z2 + (x1 + y1) * 0.001,
      };
    case 'east':
      return {
        origin: at(x2, y2, z1),
        edgeU: sub(at(x2, y2, z2), at(x2, y2, z1)),
        edgeV: sub(at(x2, y1, z1), at(x2, y2, z1)),
        depth: x2 + (y1 + z1) * 0.001,
      };
  }
}

const sub = (a: [number, number], b: [number, number]): [number, number] => [
  a[0] - b[0],
  a[1] - b[1],
];

/** Bounding box of a model in screen space, used to centre and fit the drawing. */
export function screenBounds(model: ParsedModel, scale: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const element of model.elements) {
    const [x1, y1, z1] = element.from;
    const [x2, y2, z2] = element.to;

    for (const x of [x1, x2]) {
      for (const y of [y1, y2]) {
        for (const z of [z1, z2]) {
          const [sx, sy] = project(x, y, z, scale);
          minX = Math.min(minX, sx);
          minY = Math.min(minY, sy);
          maxX = Math.max(maxX, sx);
          maxY = Math.max(maxY, sy);
        }
      }
    }
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Draw order: far faces first, so nearer boxes paint over them. */
export function drawOrder(model: ParsedModel, scale: number) {
  const faces: Array<{ element: ParsedModel['elements'][number]; face: VisibleFace; geometry: FaceCorners }> = [];

  for (const element of model.elements) {
    for (const face of VISIBLE_FACES) {
      faces.push({ element, face, geometry: faceGeometry(element, face, scale) });
    }
  }

  return faces.sort((a, b) => a.geometry.depth - b.geometry.depth);
}

export { FACE_SHADE, VISIBLE_FACES };
