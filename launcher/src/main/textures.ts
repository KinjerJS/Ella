/**
 * Texture variables of a model.
 *
 * A Minecraft model maps names to texture references:
 *
 *   "textures": { "0": "proj:block/lamp", "particle": "proj:block/lamp" }
 *
 * Faces then refer to them as `#0`. The name `particle` is special: it is not drawn on a
 * face, it is the texture the game uses for break and step particles.
 *
 * The model JSON is the single source of truth here, deliberately. Blockbench rewrites it
 * on every save, so a copy of this list in project.json would drift the moment the author
 * touched the model.
 */

import { readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { EllaProject, ProjectEntry } from '../shared/project.ts';
import { placeholderTexturePng } from './pack.ts';
import { ProjectError, writeProjectFile, type TextureInfo } from './project.ts';

/** The variable Minecraft reads for break and step particles. */
export const PARTICLE_KEY = 'particle';

export interface TextureVariable {
  /** The name faces refer to, e.g. `0` or `all`. */
  key: string;
  /** The resource reference, e.g. `proj:block/lamp`. */
  reference: string;
  /** Project-relative PNG path, or null when the reference is outside this project. */
  relativePath: string | null;
  exists: boolean;
  dataUri: string | null;
  width: number | null;
  height: number | null;
  /** True when this variable also feeds the particle texture. */
  isParticle: boolean;
  /** True when `key` is literally `particle` rather than a drawable variable. */
  isParticleSlot: boolean;
  /** Faces in the model that use this variable. */
  usedByFaces: string[];
}

interface ModelJson {
  textures?: Record<string, string>;
  elements?: Array<{ faces?: Record<string, { texture?: string }> }>;
  [key: string]: unknown;
}

const modelPath = (root: string, entry: ProjectEntry): string =>
  path.join(root, ...entry.model.output.split('/'));

async function readModel(root: string, entry: ProjectEntry): Promise<ModelJson> {
  try {
    return JSON.parse(await readFile(modelPath(root, entry), 'utf8')) as ModelJson;
  } catch (error) {
    throw new ProjectError(
      'BAD_MODEL_JSON',
      `Cannot read the model for "${entry.id}": ${String(error)}`,
    );
  }
}

/**
 * Writes the model back, preserving key order and formatting style.
 *
 * Two spaces and a trailing newline: the file is co-owned with Blockbench and with git,
 * and a formatting flip-flop on every save would bury the real change in noise.
 */
async function writeModel(root: string, entry: ProjectEntry, model: ModelJson): Promise<void> {
  await writeFile(modelPath(root, entry), `${JSON.stringify(model, null, 2)}\n`, 'utf8');
}

/**
 * Resolves a texture reference to a project-relative path.
 *
 * Returns null for references outside this project — `minecraft:block/stone` is perfectly
 * valid in a model, but there is no file here for Ella to manage.
 */
export function resolveReference(project: EllaProject, reference: string): string | null {
  if (reference.startsWith('#')) return null; // an alias for another variable

  const [namespace, rest] = reference.includes(':')
    ? reference.split(':', 2)
    : ['minecraft', reference];

  if (namespace !== project.namespace) return null;
  return `pack/assets/${namespace}/textures/${rest}.png`;
}

/** The reference Ella generates for a new texture on an entry. */
export const referenceFor = (project: EllaProject, entry: ProjectEntry, name: string): string =>
  `${project.namespace}:${entry.kind}/${name}`;

function pngDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24 || data.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

async function describe(
  root: string,
  relativePath: string | null,
): Promise<Pick<TextureVariable, 'exists' | 'dataUri' | 'width' | 'height'>> {
  if (!relativePath) return { exists: false, dataUri: null, width: null, height: null };

  let data: Buffer;
  try {
    data = await readFile(path.join(root, ...relativePath.split('/')));
  } catch {
    return { exists: false, dataUri: null, width: null, height: null };
  }

  const dimensions = pngDimensions(data);
  return {
    exists: true,
    dataUri:
      data.length <= MAX_PREVIEW_BYTES
        ? `data:image/png;base64,${data.toString('base64')}`
        : null,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

/** Which model faces reference each texture variable. */
function faceUsage(model: ModelJson): Record<string, string[]> {
  const usage: Record<string, string[]> = {};

  for (const element of model.elements ?? []) {
    for (const [face, definition] of Object.entries(element.faces ?? {})) {
      const reference = definition?.texture;
      if (typeof reference !== 'string' || !reference.startsWith('#')) continue;
      const key = reference.slice(1);
      (usage[key] ??= []).push(face);
    }
  }

  return usage;
}

export async function listTextures(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
): Promise<TextureVariable[]> {
  const model = await readModel(root, entry);
  const textures = model.textures ?? {};
  const usage = faceUsage(model);
  const particleReference = textures[PARTICLE_KEY];

  return Promise.all(
    Object.entries(textures).map(async ([key, reference]) => {
      const relativePath = resolveReference(project, reference);
      return {
        key,
        reference,
        relativePath,
        ...(await describe(root, relativePath)),
        // A variable "is the particle texture" when particle points at the same file,
        // which is how vanilla models express it rather than by naming a variable.
        isParticle: key !== PARTICLE_KEY && reference === particleReference,
        isParticleSlot: key === PARTICLE_KEY,
        usedByFaces: usage[key] ?? [],
      };
    }),
  );
}

const KEY_PATTERN = /^[a-z0-9_]+$/;

/**
 * Adds a texture variable and creates a placeholder PNG for it.
 *
 * The placeholder matters: a variable pointing at a missing file makes the whole model
 * fail to load, so an empty one would be worse than no variable at all.
 */
export async function addTexture(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
  key: string,
): Promise<TextureVariable[]> {
  if (!KEY_PATTERN.test(key)) {
    throw new ProjectError('INVALID_TEXTURE_KEY', `Texture name must match [a-z0-9_]+, got "${key}"`);
  }

  const model = await readModel(root, entry);
  model.textures ??= {};

  if (key in model.textures) {
    throw new ProjectError('DUPLICATE_TEXTURE_KEY', `The model already has a texture "${key}"`);
  }

  const name = key === PARTICLE_KEY ? `${entry.id}_particle` : `${entry.id}_${key}`;
  const reference = referenceFor(project, entry, name);

  model.textures[key] = reference;
  await writeModel(root, entry, model);

  const relativePath = resolveReference(project, reference);
  if (relativePath) await writeProjectFile(root, relativePath, placeholderTexturePng());

  return listTextures(root, project, entry);
}

/**
 * Removes a texture variable.
 *
 * The PNG is kept by default: the variable is one line of JSON to restore, the image is
 * not. Faces still pointing at the removed variable are reported so the caller can warn
 * rather than silently producing a model that will not load.
 */
export interface RemovedTexture {
  key: string;
  reference: string;
  /** True when removing it also cleared the model's `particle` entry. */
  wasParticle: boolean;
}

export async function removeTexture(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
  key: string,
  options: { deleteFile?: boolean } = {},
): Promise<{
  textures: TextureVariable[];
  orphanedFaces: string[];
  removed: RemovedTexture;
}> {
  const model = await readModel(root, entry);
  const textures = model.textures ?? {};

  if (!(key in textures)) {
    throw new ProjectError('UNKNOWN_TEXTURE_KEY', `The model has no texture "${key}"`);
  }

  const reference = textures[key];
  const orphanedFaces = faceUsage(model)[key] ?? [];

  delete textures[key];

  // A particle entry pointing at the removed file would outlive it.
  const wasParticle = key !== PARTICLE_KEY && textures[PARTICLE_KEY] === reference;
  if (wasParticle) delete textures[PARTICLE_KEY];

  model.textures = textures;
  await writeModel(root, entry, model);

  if (options.deleteFile) {
    const relativePath = resolveReference(project, reference);
    // Only if nothing else still points at it.
    const stillUsed = Object.values(textures).includes(reference);
    if (relativePath && !stillUsed) {
      await rm(path.join(root, ...relativePath.split('/')), { force: true });
    }
  }

  return {
    textures: await listTextures(root, project, entry),
    orphanedFaces,
    removed: { key, reference, wasParticle },
  };
}

/**
 * Puts a removed texture variable back, particle entry included.
 *
 * Only the model JSON is rewritten, which is the whole of what {@link removeTexture} does
 * when the image is kept — and the editor never deletes it. A variable whose file really
 * was deleted is not restorable here, and is reported as such rather than restored as a
 * reference to nothing, which is the one shape that stops a model loading at all.
 */
export async function restoreTexture(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
  removed: RemovedTexture,
): Promise<TextureVariable[]> {
  const relativePath = resolveReference(project, removed.reference);
  if (relativePath && !(await fileExists(path.join(root, ...relativePath.split('/'))))) {
    throw new ProjectError(
      'TEXTURE_FILE_GONE',
      `The image "${removed.reference}" points at was deleted, so the variable cannot be restored`,
    );
  }

  const model = await readModel(root, entry);
  model.textures ??= {};
  model.textures[removed.key] = removed.reference;
  if (removed.wasParticle) model.textures[PARTICLE_KEY] = removed.reference;

  await writeModel(root, entry, model);
  return listTextures(root, project, entry);
}

const fileExists = (target: string): Promise<boolean> =>
  stat(target).then((entry) => entry.isFile(), () => false);

/** Points the `particle` variable at the same file as `key`, or clears it. */
export async function setParticleTexture(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
  key: string | null,
): Promise<TextureVariable[]> {
  const model = await readModel(root, entry);
  const textures = model.textures ?? {};

  if (key === null) {
    delete textures[PARTICLE_KEY];
  } else {
    if (!(key in textures)) {
      throw new ProjectError('UNKNOWN_TEXTURE_KEY', `The model has no texture "${key}"`);
    }
    textures[PARTICLE_KEY] = textures[key];
  }

  model.textures = textures;
  await writeModel(root, entry, model);
  return listTextures(root, project, entry);
}

/** Replaces the PNG a variable points at. */
export async function importTextureFor(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
  key: string,
  sourcePath: string,
): Promise<TextureVariable[]> {
  const model = await readModel(root, entry);
  const reference = (model.textures ?? {})[key];

  if (!reference) {
    throw new ProjectError('UNKNOWN_TEXTURE_KEY', `The model has no texture "${key}"`);
  }

  const relativePath = resolveReference(project, reference);
  if (!relativePath) {
    throw new ProjectError(
      'EXTERNAL_TEXTURE',
      `"${reference}" is outside this project, so Ella cannot replace it`,
    );
  }

  const data = await readFile(sourcePath);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length <= 8 || !signature.every((byte, index) => data[index] === byte)) {
    throw new ProjectError('NOT_A_PNG', `${sourcePath} is not a PNG image`);
  }
  if (!pngDimensions(data)) {
    throw new ProjectError('BAD_PNG', `${sourcePath} has no readable image header`);
  }

  await writeProjectFile(root, relativePath, data);
  return listTextures(root, project, entry);
}
