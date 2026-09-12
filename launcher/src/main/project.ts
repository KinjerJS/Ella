/**
 * Project persistence and entry management.
 */

import { readFile, writeFile, rename, readdir, mkdir, rm, stat, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  PROJECT_FORMAT_VERSION,
  PROJECT_MANIFEST,
  emptyProject,
  withDefaults,
  isValidIdentifier,
  nextFreeSlot,
  defaultModelOutput,
  assetPath,
  blockTexturePath,
  itemTexturePath,
  duplicateIdFor,
  duplicateDisplayName,
  type EllaProject,
  type ModelSource,
  type ProjectEntry,
} from '../shared/project.ts';
import type { EntryKind, LocaleMap } from '../shared/protocol.ts';
import { defaultsFor } from '../shared/settings-schema.ts';
import { findParentTrap, withoutParent } from '../shared/model-compat.ts';
import { projectsDir, projectDir, ensureDir } from './paths.ts';
import { stashFiles, restoreStash } from './trash.ts';
import {
  defaultBlockModel,
  defaultItemModel,
  placeholderTexturePng,
  writeSlotNamespace,
  writeEntrySlot,
  HIGHEST_KNOWN_PACK_FORMAT,
} from './pack.ts';

export class ProjectError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
  }
}

const manifestPath = (root: string): string => path.join(root, PROJECT_MANIFEST);

/** Reads and validates a project manifest. */
export async function loadProject(root: string): Promise<EllaProject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath(root), 'utf8'));
  } catch (error) {
    throw new ProjectError('PROJECT_UNREADABLE', `Cannot read project at ${root}: ${String(error)}`);
  }

  const project = parsed as EllaProject;
  if (typeof project !== 'object' || project === null || !Array.isArray(project.entries)) {
    throw new ProjectError('PROJECT_MALFORMED', `Malformed project manifest at ${root}`);
  }
  if (project.formatVersion > PROJECT_FORMAT_VERSION) {
    throw new ProjectError(
      'PROJECT_TOO_NEW',
      `Project format v${project.formatVersion} is newer than this build supports ` +
        `(v${PROJECT_FORMAT_VERSION})`,
    );
  }

  return withDefaults(project);
}

/** Writes the manifest atomically. */
export async function saveProject(root: string, project: EllaProject): Promise<void> {
  await ensureDir(root);
  const temporary = `${manifestPath(root)}.tmp`;
  await writeFile(temporary, JSON.stringify(project, null, 2), 'utf8');
  await rename(temporary, manifestPath(root));
}

export interface ProjectSummary {
  name: string;
  namespace: string;
  root: string;
  entryCount: number;
  /** The version it is authored against, so the list can say so before it is opened. */
  targetVersion: string | null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureDir(projectsDir());
  const entries = await readdir(projectsDir(), { withFileTypes: true });

  const summaries: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(projectsDir(), entry.name);
    try {
      const project = await loadProject(root);
      summaries.push({
        name: project.name,
        namespace: project.namespace,
        root,
        entryCount: project.entries.length,
        targetVersion: project.targetVersion,
      });
    } catch {
      // A directory that is not a project is simply not listed.
    }
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createProject(
  name: string,
  namespace: string,
  targetVersion: string | null = null,
): Promise<{ project: EllaProject; root: string }> {
  if (!isValidIdentifier(namespace)) {
    throw new ProjectError(
      'INVALID_NAMESPACE',
      `Namespace must match [a-z0-9_]+, got "${namespace}"`,
    );
  }

  const root = projectDir(namespace);
  if (await stat(root).then(() => true, () => false)) {
    throw new ProjectError('PROJECT_EXISTS', `A project already exists at ${root}`);
  }

  const project = { ...emptyProject(name, namespace), targetVersion };

  await ensureDir(path.join(root, 'sources'));
  await ensureDir(path.join(root, 'pack', 'assets', namespace));
  await saveProject(root, project);
  await writeSlotNamespace(root, project, HIGHEST_KNOWN_PACK_FORMAT);

  return { project, root };
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/**
 * Renames a project and/or its namespace.
 *
 * The namespace is load-bearing: it names the asset directory, appears in every texture
 * reference inside the model files, and becomes the registry namespace on export. So a
 * namespace change moves `pack/assets/<old>` and rewrites those references.
 *
 * The project *directory* is deliberately left alone. It is named after the namespace at
 * creation, but nothing reads it — `listProjects` reads each `project.json` — and renaming
 * a directory that a file watcher is bound to is a good way to lose changes for no gain.
 */
export async function updateProjectInfo(
  root: string,
  project: EllaProject,
  changes: { name?: string; namespace?: string; targetVersion?: string | null },
): Promise<EllaProject> {
  const name = changes.name?.trim() ?? project.name;
  const namespace = changes.namespace?.trim() ?? project.namespace;

  if (name.length === 0) {
    throw new ProjectError('INVALID_NAME', 'Project name cannot be empty');
  }
  if (!isValidIdentifier(namespace)) {
    throw new ProjectError(
      'INVALID_NAMESPACE',
      `Namespace must match [a-z0-9_]+, got "${namespace}"`,
    );
  }

  let entries = project.entries;

  if (namespace !== project.namespace) {
    const from = path.join(root, 'pack', 'assets', project.namespace);
    const to = path.join(root, 'pack', 'assets', namespace);

    if (await stat(to).then(() => true, () => false)) {
      throw new ProjectError(
        'NAMESPACE_EXISTS',
        `An asset directory named "${namespace}" already exists in this project`,
      );
    }

    if (await stat(from).then((s) => s.isDirectory(), () => false)) {
      await rename(from, to);
    }

    // Entry model paths embed the namespace, and so do the texture references inside
    // the model files. Leaving either behind produces a pack that loads but shows the
    // missing texture, which is far harder to trace than a failure.
    entries = project.entries.map((entry) => ({
      ...entry,
      model: {
        ...entry.model,
        path: entry.model.path.replace(`/assets/${project.namespace}/`, `/assets/${namespace}/`),
        output: entry.model.output.replace(`/assets/${project.namespace}/`, `/assets/${namespace}/`),
      },
    }));

    await rewriteNamespaceReferences(root, namespace, project.namespace, entries);
  }

  const updated: EllaProject = {
    ...project,
    name,
    namespace,
    entries,
    // Undefined means "leave it alone"; null is a deliberate unbinding, so the two cannot
    // collapse into a single `??`.
    targetVersion:
      changes.targetVersion === undefined ? project.targetVersion : changes.targetVersion,
  };

  await saveProject(root, updated);
  return updated;
}

/** Rewrites `oldNamespace:` prefixes inside each entry's model JSON. */
async function rewriteNamespaceReferences(
  root: string,
  namespace: string,
  oldNamespace: string,
  entries: ProjectEntry[],
): Promise<void> {
  for (const entry of entries) {
    const target = path.join(root, ...entry.model.output.split('/'));

    let content: string;
    try {
      content = await readFile(target, 'utf8');
    } catch {
      continue;
    }

    // The colon is part of the search term, so renaming `myproj` cannot corrupt a
    // reference to an unrelated `myproject` — the substring simply does not match.
    const rewritten = content.split(`${oldNamespace}:`).join(`${namespace}:`);
    if (rewritten !== content) await writeFile(target, rewritten, 'utf8');
  }
}

export interface ProjectFootprint {
  entryCount: number;
  bytes: number;
  /** Files under `pack/` that are the author's own work, not generated plumbing. */
  authoredFiles: number;
}

async function directorySize(target: string): Promise<{ bytes: number; files: number }> {
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }

  let bytes = 0;
  let files = 0;
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      const nested = await directorySize(child);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      bytes += await stat(child).then((s) => s.size, () => 0);
      files++;
    }
  }
  return { bytes, files };
}

/**
 * What deleting a project would destroy.
 *
 * The authored-file count deliberately excludes the generated `ella` slot namespace, so
 * the confirmation reflects work that cannot be regenerated rather than a number
 * dominated by plumbing.
 */
export async function measureProject(root: string, project: EllaProject): Promise<ProjectFootprint> {
  const total = await directorySize(root);
  const authored = await directorySize(path.join(root, 'pack', 'assets', project.namespace));
  const sources = await directorySize(path.join(root, 'sources'));

  return {
    entryCount: project.entries.length,
    bytes: total.bytes,
    authoredFiles: authored.files + sources.files,
  };
}

/**
 * Deletes a project directory and everything in it.
 *
 * Irreversible and unconditional: unlike deleting a single entry, there is no version of
 * this that keeps the models, so the confirmation has to carry the whole weight.
 */
export async function deleteProject(root: string): Promise<void> {
  const resolved = path.resolve(root);

  // Refuse anything outside the projects directory. This function takes a path and
  // deletes it recursively; a caller mistake must not be able to reach arbitrary files.
  const projectsRoot = path.resolve(projectsDir());
  if (!resolved.startsWith(projectsRoot + path.sep)) {
    throw new ProjectError(
      'PROJECT_OUTSIDE_ROOT',
      `Refusing to delete ${resolved}: it is not inside the projects directory`,
    );
  }
  if (resolved === projectsRoot) {
    throw new ProjectError('PROJECT_OUTSIDE_ROOT', 'Refusing to delete the projects directory');
  }

  // Confirm it really is a project rather than an unrelated directory.
  await loadProject(resolved);
  await rm(resolved, { recursive: true, force: true });
}

export interface CreateEntryOptions {
  id: string;
  kind: EntryKind;
  displayName: LocaleMap;
  /** Bind to a slot immediately. Defaults to the lowest free one. */
  slot?: number | null;
}

/**
 * Validates a new entry and allocates its slot, without writing anything.
 *
 * Shared by everything that adds an entry, so the rules for identifiers and slots cannot
 * differ between creating one from scratch and importing one.
 */
export function prepareEntry(project: EllaProject, options: CreateEntryOptions): ProjectEntry {
  if (!isValidIdentifier(options.id)) {
    throw new ProjectError('INVALID_ID', `Identifier must match [a-z0-9_]+, got "${options.id}"`);
  }
  if (project.entries.some((existing) => existing.id === options.id)) {
    throw new ProjectError('DUPLICATE_ID', `An entry named "${options.id}" already exists`);
  }

  const slot = options.slot === undefined ? nextFreeSlot(project, options.kind) : options.slot;
  if (options.slot === undefined && slot === null) {
    throw new ProjectError(
      'SLOT_POOL_FULL',
      `No free ${options.kind} slot; the pool holds ${project.slotPool[options.kind]}`,
    );
  }

  const output = defaultModelOutput(project.namespace, options);

  return {
    id: options.id,
    kind: options.kind,
    displayName: options.displayName,
    slot,
    model: {
      // Blockbench edits vanilla model JSON natively, so the authoring file and the file
      // the game loads are the same one. That removes a conversion step, and with it a
      // whole class of "it looks right in Blockbench but wrong in game" bugs.
      // `bbmodel` and `obj` sources keep a separate path; see docs/project-format.md.
      source: 'json',
      path: output,
      output,
    },
    settings: defaultsFor(options.kind),
  };
}

/**
 * Adds an entry and writes its starting files: a cube (or sprite) model and a
 * placeholder texture, so the block is visible in game before any Blockbench work.
 */
export async function createEntry(
  root: string,
  project: EllaProject,
  options: CreateEntryOptions,
): Promise<{ project: EllaProject; entry: ProjectEntry }> {
  const entry = prepareEntry(project, options);
  const texture = `${project.namespace}:${options.kind}/${options.id}`;

  const updated: EllaProject = { ...project, entries: [...project.entries, entry] };

  await writeProjectFile(
    root,
    entry.model.output,
    options.kind === 'block'
      ? defaultBlockModel(texture)
      : defaultItemModel(texture, false),
  );

  const texturePath =
    options.kind === 'block'
      ? blockTexturePath(project.namespace, options.id)
      : itemTexturePath(project.namespace, options.id);
  await writeProjectFile(root, texturePath, placeholderTexturePng());

  await saveProject(root, updated);
  return { project: updated, entry };
}

export async function updateEntry(
  root: string,
  project: EllaProject,
  id: string,
  patch: Partial<Pick<ProjectEntry, 'displayName' | 'settings' | 'slot' | 'model'>>,
): Promise<{ project: EllaProject; entry: ProjectEntry }> {
  const index = project.entries.findIndex((entry) => entry.id === id);
  if (index === -1) throw new ProjectError('UNKNOWN_ENTRY', `No entry named "${id}"`);

  const entry: ProjectEntry = {
    ...project.entries[index],
    ...patch,
    // Settings patch merges rather than replaces, so a partial update from the editor
    // cannot wipe fields it did not render.
    settings: patch.settings
      ? { ...project.entries[index].settings, ...patch.settings }
      : project.entries[index].settings,
  };

  const entries = [...project.entries];
  entries[index] = entry;
  const updated = { ...project, entries };

  await saveProject(root, updated);
  return { project: updated, entry };
}

/**
 * Renames an entry, moving the files that carry its id in their path.
 *
 * The id is not cosmetic: it appears in the model path, the texture path, the registry
 * name an export produces and the translation key derived from it. Renaming is therefore
 * a move across several files rather than an edit of one field, which is why it is a
 * distinct operation and not part of {@link updateEntry}.
 *
 * Files are moved rather than copied, and the manifest is written last: if a move fails
 * the project still describes what is actually on disk.
 */
export async function renameEntry(
  root: string,
  project: EllaProject,
  id: string,
  newId: string,
): Promise<{ project: EllaProject; entry: ProjectEntry }> {
  const index = project.entries.findIndex((candidate) => candidate.id === id);
  if (index === -1) throw new ProjectError('UNKNOWN_ENTRY', `No entry named "${id}"`);

  if (!isValidIdentifier(newId)) {
    throw new ProjectError('INVALID_ID', `Identifier must match [a-z0-9_]+, got "${newId}"`);
  }
  if (newId === id) return { project, entry: project.entries[index] };
  if (project.entries.some((candidate) => candidate.id === newId)) {
    throw new ProjectError('DUPLICATE_ID', `An entry named "${newId}" already exists`);
  }

  const entry = project.entries[index];
  const renamed: ProjectEntry = {
    ...entry,
    id: newId,
    model: {
      ...entry.model,
      path: entry.model.path.split('/').map((s) => (s === `${id}.json` ? `${newId}.json` : s)).join('/'),
      output: defaultModelOutput(project.namespace, { id: newId, kind: entry.kind }),
    },
  };

  const moves: Array<[string, string]> = [
    [entry.model.output, renamed.model.output],
    [textureRelativePath(project, entry), textureRelativePath(project, renamed)],
  ];
  // An authoring file distinct from the output (a .bbmodel, later an .obj) moves too.
  if (entry.model.path !== entry.model.output) {
    moves.push([entry.model.path, renamed.model.path]);
  }

  for (const [from, to] of moves) {
    if (from === to) continue;
    const source = path.join(root, ...from.split('/'));
    const destination = path.join(root, ...to.split('/'));

    // A missing source is not fatal: the entry may never have had that file.
    if (!(await stat(source).then((s) => s.isFile(), () => false))) continue;

    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
  }

  const entries = [...project.entries];
  entries[index] = renamed;
  const updated = { ...project, entries };

  await saveProject(root, updated);
  return { project: updated, entry: renamed };
}

export interface DuplicateEntryOptions {
  /** The copy's identifier. Omitted, the next free one in the series: `lamp_1`, `lamp_2`… */
  id?: string;
  /** Omitted, the source's names, numbered like the identifier when it carries a counter. */
  displayName?: LocaleMap;
}

export interface DuplicatedEntry {
  project: EllaProject;
  entry: ProjectEntry;
  /** Project-relative paths of every file the copy wrote, so it can be taken back. */
  files: string[];
}

interface PlannedCopy {
  from: string;
  to: string;
  /** Written instead of the source's bytes, when the file needed rewriting. */
  content?: string;
}

interface DuplicatePlan {
  model: ModelSource;
  copies: PlannedCopy[];
  /** The first destination that already exists, or null when nothing would be overwritten. */
  blocked: string | null;
}

/**
 * Copies an entry under a new identifier, with a model, textures and settings of its own.
 *
 * A copy still pointing at its source's texture would be a trap: importing an image for one
 * would repaint both. So the textures the entry owns are copied along and the model's
 * references rewritten to match. "Owns" follows the names Ella gives textures — `lamp`,
 * `lamp_side` — so a texture shared under a name of its own stays shared, which is how the
 * author set it up.
 *
 * Existing files are never overwritten. An entry deleted with its files kept leaves them
 * under its old id, and a copy landing on that id must not bury them: an unnamed copy moves
 * on to the next number, a named one is refused.
 */
export async function duplicateEntry(
  root: string,
  project: EllaProject,
  id: string,
  options: DuplicateEntryOptions = {},
): Promise<DuplicatedEntry> {
  const index = project.entries.findIndex((candidate) => candidate.id === id);
  if (index === -1) throw new ProjectError('UNKNOWN_ENTRY', `No entry named "${id}"`);
  const source = project.entries[index];

  if (options.id !== undefined) {
    if (!isValidIdentifier(options.id)) {
      throw new ProjectError('INVALID_ID', `Identifier must match [a-z0-9_]+, got "${options.id}"`);
    }
    if (project.entries.some((candidate) => candidate.id === options.id)) {
      throw new ProjectError('DUPLICATE_ID', `An entry named "${options.id}" already exists`);
    }
  }

  const slot = nextFreeSlot(project, source.kind);
  if (slot === null) {
    throw new ProjectError(
      'SLOT_POOL_FULL',
      `No free ${source.kind} slot; the pool holds ${project.slotPool[source.kind]}`,
    );
  }

  const taken = new Set(project.entries.map((candidate) => candidate.id));
  let newId: string;
  let plan: DuplicatePlan;
  for (;;) {
    newId = options.id ?? duplicateIdFor(id, (candidate) => taken.has(candidate));
    plan = await planDuplicate(root, project, source, newId);
    if (plan.blocked === null) break;

    if (options.id !== undefined) {
      throw new ProjectError(
        'ENTRY_FILES_EXIST',
        `"${plan.blocked}" already exists; rename or remove it before using "${newId}"`,
      );
    }
    taken.add(newId);
  }

  const files: string[] = [];
  try {
    for (const copy of plan.copies) {
      const from = path.join(root, ...copy.from.split('/'));
      const to = path.join(root, ...copy.to.split('/'));
      await mkdir(path.dirname(to), { recursive: true });

      // Exclusive either way, so a file that appeared since the plan was checked still wins.
      if (copy.content === undefined) await copyFile(from, to, constants.COPYFILE_EXCL);
      else await writeFile(to, copy.content, { encoding: 'utf8', flag: 'wx' });
      files.push(copy.to);
    }
  } catch (error) {
    // The manifest is written last, so nothing would ever list — or clean up — half a copy.
    await Promise.all(
      files.map((relative) => rm(path.join(root, ...relative.split('/')), { force: true })),
    );
    throw error;
  }

  const entry: ProjectEntry = {
    ...source,
    id: newId,
    displayName: options.displayName ?? duplicateDisplayName(source, newId),
    slot,
    model: plan.model,
    settings: structuredClone(source.settings),
  };

  // Beside its source rather than at the bottom, and after the copies already made from it,
  // so a series reads in order.
  const base = source.id.replace(/_\d+$/, '');
  let position = index + 1;
  while (
    position < project.entries.length &&
    project.entries[position].id.startsWith(`${base}_`) &&
    /^\d+$/.test(project.entries[position].id.slice(base.length + 1))
  ) {
    position++;
  }

  const entries = [...project.entries];
  entries.splice(position, 0, entry);
  const updated = { ...project, entries };

  await saveProject(root, updated);
  return { project: updated, entry, files };
}

/** Which files a copy of `source` named `newId` needs, and whether any of them is taken. */
async function planDuplicate(
  root: string,
  project: EllaProject,
  source: ProjectEntry,
  newId: string,
): Promise<DuplicatePlan> {
  const output = defaultModelOutput(project.namespace, { id: newId, kind: source.kind });
  const model: ModelSource = {
    ...source.model,
    output,
    path:
      source.model.path === source.model.output
        ? output
        : path.posix.join(
            path.posix.dirname(source.model.path),
            `${newId}${path.posix.extname(source.model.path)}`,
          ),
  };

  // `rest` is a reference without its namespace, `block/lamp_side`; the file name keeps
  // whatever followed the source's id.
  const textureFile = (rest: string): string =>
    assetPath(project.namespace, 'textures', `${rest}.png`);
  const renamedRest = (rest: string): string => {
    const slash = rest.lastIndexOf('/');
    return `${rest.slice(0, slash + 1)}${newId}${rest.slice(slash + 1 + source.id.length)}`;
  };

  const prefix = `${project.namespace}:`;
  const references = new Map<string, string>();
  const textureCopies: PlannedCopy[] = [];
  const addTexture = (rest: string): void => {
    if (references.has(`${prefix}${rest}`)) return;
    const to = renamedRest(rest);
    references.set(`${prefix}${rest}`, `${prefix}${to}`);
    textureCopies.push(
      { from: textureFile(rest), to: textureFile(to) },
      // An animated texture without its .mcmeta renders as a tall strip, not as an error.
      { from: `${textureFile(rest)}.mcmeta`, to: `${textureFile(to)}.mcmeta` },
    );
  };

  // The texture textureRelativePath names, which the cards preview even when the model has
  // stopped referencing it.
  addTexture(`${source.kind}/${source.id}`);

  let parsed: Record<string, unknown> | null = null;
  try {
    const text = await readFile(path.join(root, ...source.model.output.split('/')), 'utf8');
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Missing or malformed: copied as it is, and validateForExport reports it on both.
  }

  const textures = parsed?.textures;
  let content: string | undefined;
  if (textures && typeof textures === 'object') {
    for (const reference of Object.values(textures)) {
      if (typeof reference !== 'string' || !reference.startsWith(prefix)) continue;
      const rest = reference.slice(prefix.length);
      if (textureOwner(project, rest.slice(rest.lastIndexOf('/') + 1)) === source.id) {
        addTexture(rest);
      }
    }

    let changed = false;
    const rewritten = Object.fromEntries(
      Object.entries(textures).map(([key, reference]) => {
        const next = typeof reference === 'string' ? references.get(reference) : undefined;
        if (next) changed = true;
        return [key, next ?? reference];
      }),
    );
    // Untouched otherwise: this is the author's file, and a byte copy is the faithful one.
    if (changed) content = `${JSON.stringify({ ...parsed, textures: rewritten }, null, 2)}\n`;
  }

  const candidates: PlannedCopy[] = [{ from: source.model.output, to: output, content }];
  if (source.model.path !== source.model.output) {
    candidates.push({ from: source.model.path, to: model.path });
  }
  candidates.push(...textureCopies);

  const copies: PlannedCopy[] = [];
  let blocked: string | null = null;
  for (const copy of candidates) {
    // A file the source never had is not copied, so whatever sits at its destination is fine.
    if (!(await fileExists(root, copy.from))) continue;
    if (blocked === null && (await pathExists(root, copy.to))) blocked = copy.to;
    copies.push(copy);
  }

  return { model, copies, blocked };
}

/**
 * The entry a texture file belongs to by Ella's naming: `lamp_side` is `lamp`'s.
 *
 * The longest identifier wins, so with both `lamp` and `lamp_post` in the project,
 * `lamp_post_side` is `lamp_post`'s and a copy of `lamp` leaves it alone.
 */
function textureOwner(project: EllaProject, name: string): string | null {
  let owner: string | null = null;
  for (const { id } of project.entries) {
    if ((name === id || name.startsWith(`${id}_`)) && id.length > (owner?.length ?? 0)) {
      owner = id;
    }
  }
  return owner;
}

const fileExists = (root: string, relative: string): Promise<boolean> =>
  stat(path.join(root, ...relative.split('/'))).then((s) => s.isFile(), () => false);

const pathExists = (root: string, relative: string): Promise<boolean> =>
  stat(path.join(root, ...relative.split('/'))).then(() => true, () => false);

/** The stash a deleted entry's files wait in. See main/trash.ts. */
export const entryStash = (id: string): string => `entry-${id}`;

export interface DeletedEntry {
  project: EllaProject;
  entry: ProjectEntry;
  /** Where it sat in the list, so restoring it does not send it to the bottom. */
  index: number;
}

export async function deleteEntry(
  root: string,
  project: EllaProject,
  id: string,
  options: { deleteFiles?: boolean } = {},
): Promise<DeletedEntry> {
  const index = project.entries.findIndex((candidate) => candidate.id === id);
  if (index === -1) throw new ProjectError('UNKNOWN_ENTRY', `No entry named "${id}"`);

  const entry = project.entries[index];
  const updated = {
    ...project,
    entries: project.entries.filter((candidate) => candidate.id !== id),
  };

  if (options.deleteFiles) {
    // Textures and Blockbench sources are the author's work; only removed when the caller
    // explicitly asks, and even then moved aside rather than destroyed, so the undo the
    // editor offers afterwards has something to put back.
    await stashFiles(root, entryStash(id), [
      entry.model.output,
      entry.model.path,
      textureRelativePath(project, entry),
    ]);
  }

  await saveProject(root, updated);
  return { project: updated, entry, index };
}

/**
 * Puts a deleted entry back, files and all.
 *
 * The slot is not restored blindly: an entry created in the meantime may have taken it, and
 * two entries on one slot is a live-editing bug that would outlast this session. A taken
 * slot is exchanged for the next free one, and a full pool leaves the entry unbound —
 * recoverable by restarting the game, unlike a corrupted binding.
 */
export async function restoreEntry(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
  index: number,
): Promise<{ project: EllaProject; entry: ProjectEntry }> {
  if (project.entries.some((candidate) => candidate.id === entry.id)) {
    throw new ProjectError('DUPLICATE_ID', `An entry named "${entry.id}" already exists`);
  }

  const taken = new Set(
    project.entries
      .filter((candidate) => candidate.kind === entry.kind && candidate.slot !== null)
      .map((candidate) => candidate.slot as number),
  );

  const slot =
    entry.slot !== null && !taken.has(entry.slot) ? entry.slot : nextFreeSlot(project, entry.kind);

  const restored: ProjectEntry = { ...entry, slot };
  const entries = [...project.entries];
  entries.splice(Math.min(index, entries.length), 0, restored);

  // Files first: a manifest that lists an entry whose model is still in the trash would
  // describe a project that does not exist.
  await restoreStash(root, entryStash(entry.id));

  const updated = { ...project, entries };
  await saveProject(root, updated);
  return { project: updated, entry: restored };
}

/** Rebuilds the slot namespace after any change that affects bindings or names. */
export async function syncPack(
  root: string,
  project: EllaProject,
  packFormat: number,
): Promise<void> {
  await writeSlotNamespace(root, project, packFormat);
}

/**
 * Rewrites one entry's slot after a change that cannot affect any other slot.
 *
 * See {@link writeEntrySlot} for why a settings change qualifies.
 */
export async function syncEntryPack(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
): Promise<void> {
  await writeEntrySlot(root, project, entry);
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

export interface TextureInfo {
  /** Absolute path on disk. */
  path: string;
  /** Project-relative path, as written into the model. */
  relativePath: string;
  exists: boolean;
  /** True while the file is still the generated checkerboard. */
  isPlaceholder: boolean;
  /** `data:` URI for previewing, or null when the file is missing or too large. */
  dataUri: string | null;
  width: number | null;
  height: number | null;
}

/** Previews are inlined into the renderer, so keep them small. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

const placeholderDigest = (): string =>
  createHash('sha1').update(placeholderTexturePng()).digest('hex');

/** Reads width and height from a PNG's IHDR chunk. */
function pngDimensions(data: Buffer): { width: number; height: number } | null {
  // 8-byte signature, 4-byte length, "IHDR", then two big-endian 32-bit values.
  if (data.length < 24) return null;
  if (data.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

export function textureRelativePath(project: EllaProject, entry: ProjectEntry): string {
  return entry.kind === 'block'
    ? blockTexturePath(project.namespace, entry.id)
    : itemTexturePath(project.namespace, entry.id);
}

export async function readTextureInfo(
  root: string,
  project: EllaProject,
  entry: ProjectEntry,
): Promise<TextureInfo> {
  const relativePath = textureRelativePath(project, entry);
  const absolute = path.join(root, ...relativePath.split('/'));

  let data: Buffer | null = null;
  try {
    data = await readFile(absolute);
  } catch {
    return {
      path: absolute,
      relativePath,
      exists: false,
      isPlaceholder: false,
      dataUri: null,
      width: null,
      height: null,
    };
  }

  const dimensions = pngDimensions(data);
  const digest = createHash('sha1').update(data).digest('hex');

  return {
    path: absolute,
    relativePath,
    exists: true,
    // Knowing the texture is still the generated one is worth surfacing: it is the
    // difference between "not started" and "looks wrong".
    isPlaceholder: digest === placeholderDigest(),
    dataUri:
      data.length <= MAX_PREVIEW_BYTES
        ? `data:image/png;base64,${data.toString('base64')}`
        : null,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

/*
 * Importing a texture lives in main/textures.ts, which works against the model's texture
 * variables rather than assuming one image per entry. `readTextureInfo` stays because the
 * card previews need the entry's primary texture without parsing the model.
 */

/** Everything the renderer needs to draw a preview of one entry. */
export interface EntryPreview {
  id: string;
  /** Parsed model JSON, or null when it is missing or unreadable. */
  model: unknown | null;
  textureDataUri: string | null;
  textureWidth: number | null;
  textureHeight: number | null;
}

/**
 * Collects preview data for every entry in one call.
 *
 * Batched deliberately: a card grid needs all of them at once, and a round trip per entry
 * would make opening the project view visibly slow once a project has a few dozen blocks.
 */
export async function readEntryPreviews(
  root: string,
  project: EllaProject,
): Promise<EntryPreview[]> {
  return Promise.all(
    project.entries.map(async (entry) => {
      const texture = await readTextureInfo(root, project, entry);

      let model: unknown | null = null;
      try {
        model = JSON.parse(
          await readFile(path.join(root, ...entry.model.output.split('/')), 'utf8'),
        );
      } catch {
        // A missing or malformed model is shown as "no preview" rather than an error:
        // validateForExport is where that gets reported properly.
      }

      return {
        id: entry.id,
        model,
        textureDataUri: texture.dataUri,
        textureWidth: texture.width,
        textureHeight: texture.height,
      };
    }),
  );
}

/**
 * Removes the `parent` from an entry's model, so its own geometry is what renders.
 *
 * See {@link findParentTrap} for why this is needed at all. The rewrite is deliberately
 * minimal — one key removed, everything else untouched, two-space JSON like Blockbench
 * writes — because this is the author's file and the next Blockbench save has to see
 * something it recognises.
 *
 * @returns the parent that was removed and the file as it was, or null when there was
 *          nothing to fix. The original is returned rather than kept aside because it is
 *          what lets the editor offer to take the rewrite back.
 */
export async function removeModelParent(
  root: string,
  entry: ProjectEntry,
): Promise<{ parent: string; original: string } | null> {
  const file = path.join(root, ...entry.model.output.split('/'));

  let original: string;
  let model: Record<string, unknown>;
  try {
    original = await readFile(file, 'utf8');
    model = JSON.parse(original) as Record<string, unknown>;
  } catch (error) {
    throw new ProjectError(
      'BAD_MODEL',
      `Could not read the model for "${entry.id}": ${(error as Error).message}`,
    );
  }

  const trap = findParentTrap(model);
  if (!trap) return null;

  await writeFile(file, `${JSON.stringify(withoutParent(model), null, 2)}\n`, 'utf8');
  return { parent: trap.parent, original };
}

/** Writes an entry's model file back verbatim. The inverse of a rewrite Ella made. */
export async function writeModelFile(
  root: string,
  entry: ProjectEntry,
  content: string,
): Promise<void> {
  await writeFile(path.join(root, ...entry.model.output.split('/')), content, 'utf8');
}

export async function writeProjectFile(
  root: string,
  relative: string,
  content: string | Buffer,
): Promise<string> {
  const target = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

export async function readProjectFile(root: string, relative: string): Promise<Buffer> {
  return readFile(path.join(root, ...relative.split('/')));
}
