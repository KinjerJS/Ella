/**
 * Bringing a model JSON made elsewhere into a project — as a new entry, or over an entry's
 * existing model.
 *
 * The JSON is the easy half. What makes an import work or not is its textures: a model
 * lifted out of another pack still points at that pack's namespace, and a reference to an
 * image this project does not have is the one shape that stops a model loading at all. So
 * the images are looked for beside the file, copied in under the names Ella gives an
 * entry's textures, and the references rewritten to them. That naming is what lets
 * duplicating and the texture panel treat an imported entry like any other.
 *
 * What cannot be found is still made loadable, with a placeholder, and reported — the
 * import should never leave the author with a model that silently shows nothing.
 */

import { readFile, writeFile, copyFile, mkdir, stat, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  assetPath,
  defaultModelOutput,
  type EllaProject,
  type ProjectEntry,
} from '../shared/project.ts';
import type { EntryKind, LocaleMap } from '../shared/protocol.ts';
import { ProjectError, prepareEntry, saveProject } from './project.ts';
import { placeholderTexturePng } from './pack.ts';
import { stashFiles, restoreStash } from './trash.ts';

type ModelJson = Record<string, unknown>;

const PARTICLE_KEY = 'particle';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFile = (target: string): Promise<boolean> =>
  stat(target).then((s) => s.isFile(), () => false);

const absolute = (root: string, relative: string): string =>
  path.join(root, ...relative.split('/'));

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Reads a file and checks it is a Minecraft model.
 *
 * The two JSON files most often picked by mistake are named here rather than rejected as
 * "not a model": a blockstate sits right next to the model it points at, and a Blockbench
 * project is JSON too. Each needs a different next step, and the message is where that
 * step goes.
 */
export async function readModelFile(file: string): Promise<ModelJson> {
  const name = path.basename(file);

  let parsed: unknown;
  try {
    // Some Windows editors write a byte-order mark, which JSON.parse refuses.
    parsed = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''));
  } catch (error) {
    throw new ProjectError('BAD_MODEL_JSON', `${name} is not valid JSON: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) {
    throw new ProjectError('NOT_A_MODEL', `${name} is not a Minecraft model`);
  }
  if ('variants' in parsed || 'multipart' in parsed) {
    throw new ProjectError(
      'NOT_A_MODEL',
      `${name} is a blockstate, not a model — import the model file it points at`,
    );
  }
  if (isRecord(parsed.meta) && 'format_version' in parsed.meta) {
    throw new ProjectError(
      'NOT_A_MODEL',
      `${name} is a Blockbench project — export it from Blockbench as a Java Block/Item model first`,
    );
  }
  if (!('parent' in parsed) && !('elements' in parsed) && !('textures' in parsed)) {
    throw new ProjectError(
      'NOT_A_MODEL',
      `${name} has no parent, elements or textures, so it is not a Minecraft model`,
    );
  }

  return parsed;
}

/**
 * Whether a model is a block's or an item's, as far as the file can tell.
 *
 * Only a suggestion — a sword with elements is an item, and nothing in its JSON says so —
 * which is why the import form lets the author change it before anything is written.
 */
export function inferModelKind(file: string, model: ModelJson): EntryKind {
  // Inside a pack, the folder is the answer: models/item/ or models/block/ (plural pre-1.13).
  const segments = file.split(/[\\/]/);
  const models = segments.lastIndexOf('models');
  if (models !== -1 && models < segments.length - 2) {
    const folder = segments[models + 1];
    if (folder === 'item' || folder === 'items') return 'item';
    if (folder === 'block' || folder === 'blocks') return 'block';
  }

  if (typeof model.parent === 'string') {
    const parent = model.parent.slice(model.parent.indexOf(':') + 1);
    if (parent.startsWith('item/') || parent.startsWith('builtin/')) return 'item';
    if (parent.startsWith('block/')) return 'block';
  }

  // A flat sprite: layered textures and no geometry of its own.
  if (!('elements' in model) && isRecord(model.textures) && 'layer0' in model.textures) {
    return 'item';
  }
  return 'block';
}

/** A display name from a file name: `ruby_lamp.json` → `Ruby Lamp`. */
export function nameFromFile(file: string): string {
  // Split by hand: path.basename only knows the separator of the platform it runs on.
  const fileName = file.split(/[\\/]/).pop() ?? file;
  const base = fileName.slice(0, fileName.length - path.extname(fileName).length);
  const words = base.split(/[\s_.-]+/).filter(Boolean);
  return words.length > 0
    ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
    : base;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface ModelImportSummary {
  /** Images found beside the file and copied into the project. */
  imported: number;
  /** References left pointing at Minecraft's own textures. */
  vanilla: number;
  /** References nothing could be found for, each now backed by a placeholder. */
  missing: string[];
  /** A parent this project cannot supply, which stops the model loading; null when fine. */
  missingParent: string | null;
}

export interface ModelImportPlan {
  /** Project-relative path the model is written to. */
  output: string;
  /** The model as it will be written, texture references rewritten. */
  content: string;
  /** Images to copy in: an absolute source and a project-relative destination. */
  copies: Array<{ from: string; to: string }>;
  /** Project-relative PNGs to create for references nothing could be found for. */
  placeholders: string[];
  summary: ModelImportSummary;
}

/** Splits `ns:path`; a bare path is Minecraft's, as the game reads it. */
function splitReference(reference: string): { namespace: string; rest: string } {
  const colon = reference.indexOf(':');
  return colon === -1
    ? { namespace: 'minecraft', rest: reference }
    : { namespace: reference.slice(0, colon), rest: reference.slice(colon + 1) };
}

/** The `assets` directory a file sits under, when it is inside a pack's `models/` folder. */
function assetsRootOf(file: string): string | null {
  let directory = path.dirname(file);
  for (;;) {
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    if (path.basename(directory) === 'models' && path.basename(path.dirname(parent)) === 'assets') {
      return path.dirname(parent);
    }
    directory = parent;
  }
}

/**
 * Finds the image a texture reference means, relative to the model that holds it.
 *
 * Inside a pack that is `assets/<ns>/textures/<path>.png`. A loose Blockbench export has no
 * such structure, so the file's own folder is tried too — with the reference's path, then
 * with its last segment alone, which covers a model saved next to its PNGs.
 */
async function findImage(file: string, reference: string): Promise<string | null> {
  const { namespace, rest } = splitReference(reference);
  // Resource locations cannot climb out of their pack, and neither may this lookup.
  if (rest.split('/').includes('..')) return null;

  const candidates: string[] = [];
  const assets = assetsRootOf(file);
  if (assets) candidates.push(`${path.join(assets, namespace, 'textures', ...rest.split('/'))}.png`);

  const directory = path.dirname(file);
  candidates.push(
    `${path.join(directory, ...rest.split('/'))}.png`,
    path.join(directory, `${path.posix.basename(rest)}.png`),
  );

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * Works out everything an import of `file` as `target` would write, without writing it.
 *
 * Images are named the way the texture panel names them: the first drawable one is the
 * entry's own (`lamp`, the one its card previews), the others `lamp_<key>`, and a particle
 * image nothing draws with `lamp_particle`. Numeric keys — Blockbench's `0`, `1` — become
 * `lamp_tex0`, because `lamp_1` is what a duplicate of `lamp` is called.
 */
export async function planModelImport(
  root: string,
  project: EllaProject,
  file: string,
  model: ModelJson,
  target: Pick<ProjectEntry, 'id' | 'kind'>,
): Promise<ModelImportPlan> {
  const output = defaultModelOutput(project.namespace, target);
  const textureFile = (name: string): string =>
    assetPath(project.namespace, 'textures', target.kind, `${name}.png`);

  const copies: ModelImportPlan['copies'] = [];
  const placeholders: string[] = [];
  const missing: string[] = [];
  const vanilla = new Set<string>();

  const names = new Set<string>();
  const claim = (key: string): string => {
    const slug = key.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const base =
      key === PARTICLE_KEY
        ? `${target.id}_particle`
        : names.size === 0
          ? target.id
          : `${target.id}_${/^\d+$/.test(slug) ? `tex${slug}` : slug}`;
    let name = base;
    for (let counter = 2; names.has(name); counter++) name = `${base}${counter}`;
    names.add(name);
    return name;
  };

  // One image referenced by several keys — a face texture doubling as the particle — is
  // copied once, and both keys point at the one copy.
  const byImage = new Map<string, string>();
  const byMissing = new Map<string, string>();

  const resolve = async (key: string, reference: unknown): Promise<unknown> => {
    if (typeof reference !== 'string' || reference.startsWith('#')) return reference;

    const image = await findImage(file, reference);
    if (image) {
      let next = byImage.get(image);
      if (!next) {
        const name = claim(key);
        next = `${project.namespace}:${target.kind}/${name}`;
        byImage.set(image, next);
        // Re-importing a model that already lives here can find an image in its own place.
        if (path.resolve(image) === absolute(root, textureFile(name))) return next;

        copies.push({ from: image, to: textureFile(name) });
        // An animated texture without its .mcmeta renders as a tall strip, not as an error.
        if (await isFile(`${image}.mcmeta`)) {
          copies.push({ from: `${image}.mcmeta`, to: `${textureFile(name)}.mcmeta` });
        }
      }
      return next;
    }

    const { namespace, rest } = splitReference(reference);
    // Vanilla textures always live in a folder (`block/stone`); a bare `ruby` is a custom
    // texture whose image simply was not found.
    if (namespace === 'minecraft' && rest.includes('/')) {
      vanilla.add(reference);
      return reference;
    }
    if (
      namespace === project.namespace &&
      (await isFile(absolute(root, assetPath(namespace, 'textures', `${rest}.png`))))
    ) {
      return reference;
    }

    let next = byMissing.get(reference);
    if (!next) {
      const name = claim(key);
      next = `${project.namespace}:${target.kind}/${name}`;
      byMissing.set(reference, next);
      missing.push(reference);
      placeholders.push(textureFile(name));
    }
    return next;
  };

  let content: ModelJson = model;
  if (isRecord(model.textures)) {
    const entries = Object.entries(model.textures);
    const resolved = new Map<string, unknown>();
    // Drawable keys first, so the entry's own name goes to an image a face uses rather than
    // to the particle, whatever order the file lists them in.
    for (const [key, reference] of entries) {
      if (key !== PARTICLE_KEY) resolved.set(key, await resolve(key, reference));
    }
    for (const [key, reference] of entries) {
      if (key === PARTICLE_KEY) resolved.set(key, await resolve(key, reference));
    }
    content = { ...model, textures: Object.fromEntries(entries.map(([key]) => [key, resolved.get(key)])) };
  }

  let missingParent: string | null = null;
  if (typeof model.parent === 'string') {
    const { namespace, rest } = splitReference(model.parent);
    const inProject =
      namespace === project.namespace &&
      (await isFile(absolute(root, assetPath(namespace, 'models', `${rest}.json`))));
    if (namespace !== 'minecraft' && !inProject) missingParent = model.parent;
  }

  return {
    output,
    content: `${JSON.stringify(content, null, 2)}\n`,
    copies,
    placeholders,
    summary: { imported: byImage.size, vanilla: vanilla.size, missing, missingParent },
  };
}

/**
 * Writes a plan. Placeholders never replace a file that exists: over an entry that already
 * has its own image under that name, the author's image is the better stand-in.
 *
 * @returns the project-relative paths written
 */
async function writePlan(root: string, plan: ModelImportPlan): Promise<string[]> {
  const written: string[] = [];
  const write = async (relative: string, action: (target: string) => Promise<void>) => {
    const target = absolute(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await action(target);
    written.push(relative);
  };

  try {
    await write(plan.output, (target) => writeFile(target, plan.content, 'utf8'));
    for (const copy of plan.copies) {
      await write(copy.to, (target) => copyFile(copy.from, target));
    }
    for (const placeholder of plan.placeholders) {
      if (await isFile(absolute(root, placeholder))) continue;
      await write(placeholder, (target) => writeFile(target, placeholderTexturePng()));
    }
  } catch (error) {
    await Promise.all(written.map((relative) => rm(absolute(root, relative), { force: true })));
    throw error;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Importing
// ---------------------------------------------------------------------------

export interface ImportModelOptions {
  id: string;
  kind: EntryKind;
  displayName: LocaleMap;
}

export interface ImportedEntry {
  project: EllaProject;
  entry: ProjectEntry;
  /** Project-relative paths of every file written, so the import can be taken back. */
  files: string[];
  summary: ModelImportSummary;
}

/**
 * Adds an entry whose model is the given file.
 *
 * Like a duplicate, it never lands on files already there: an entry deleted with its files
 * kept leaves them under its old id, and they are the author's work.
 */
export async function importModelAsEntry(
  root: string,
  project: EllaProject,
  file: string,
  options: ImportModelOptions,
): Promise<ImportedEntry> {
  const model = await readModelFile(file);
  const entry = prepareEntry(project, options);
  const plan = await planModelImport(root, project, file, model, entry);

  for (const relative of [plan.output, ...plan.copies.map((copy) => copy.to)]) {
    if (await isFile(absolute(root, relative))) {
      throw new ProjectError(
        'ENTRY_FILES_EXIST',
        `"${relative}" already exists; rename or remove it before using "${entry.id}"`,
      );
    }
  }

  const files = await writePlan(root, plan);
  const updated: EllaProject = { ...project, entries: [...project.entries, entry] };
  await saveProject(root, updated);

  return { project: updated, entry, files, summary: plan.summary };
}

export interface ReplacedModel {
  files: string[];
  /** The trash stash holding every file the import overwrote. See main/trash.ts. */
  stash: string;
  summary: ModelImportSummary;
}

/**
 * Replaces an entry's model with the given file.
 *
 * Everything overwritten — the model, and any of the entry's images an imported one takes
 * the name of — is moved into a stash first, so {@link undoReplaceModel} can put it back.
 * Images the old model used and the new one does not are left where they are: they are the
 * author's, and a stray file costs less than a lost one.
 */
export async function replaceEntryModel(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
  file: string,
): Promise<ReplacedModel> {
  const model = await readModelFile(file);
  const plan = await planModelImport(root, project, file, model, entry);

  const stash = `model-${entry.id}-${randomUUID().slice(0, 8)}`;
  await stashFiles(root, stash, [plan.output, ...plan.copies.map((copy) => copy.to)]);

  let files: string[];
  try {
    files = await writePlan(root, plan);
  } catch (error) {
    await restoreStash(root, stash);
    throw error;
  }

  return { files, stash, summary: plan.summary };
}

/** Takes a model replacement back: the imported files aside, the overwritten ones restored. */
export async function undoReplaceModel(root: string, replaced: ReplacedModel): Promise<void> {
  // Moved rather than deleted, like every removal the editor offers: they may have been
  // saved over in Blockbench since. restoreStash never overwrites, so they go first.
  await stashFiles(root, `${replaced.stash}-undone`, replaced.files);
  await restoreStash(root, replaced.stash);
}
