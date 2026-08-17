import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  inspectModel,
  migrateModel,
  retargetVanillaTexture,
  vanillaTextureFolders,
  versionChangeNotes,
  isVersionChange,
  type VersionFacts,
} from '../src/shared/version-compat.ts';
import { planVersionChange, applyVersionChange } from '../src/main/version-change.ts';
import { createProject, createEntry, loadProject } from '../src/main/project.ts';
import { setDataRoot } from '../src/main/paths.ts';

let workspace: string;

test.before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-compat-'));
  setDataRoot(workspace);
});

test.after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Vanilla texture folders
// ---------------------------------------------------------------------------

test('vanilla texture folders follow the 1.13 rename', () => {
  assert.deepEqual(vanillaTextureFolders('1.12.2'), { block: 'blocks', item: 'items' });
  assert.deepEqual(vanillaTextureFolders('1.13'), { block: 'block', item: 'item' });
  assert.deepEqual(vanillaTextureFolders('1.21.1'), { block: 'block', item: 'item' });
});

test('a modded version id is read as the release it is built on', () => {
  // `1.12.2-forge-14.23.5.2859` does not parse as a version, and an unparseable id sorts
  // after every release — which would answer "yes" to "is this at least 1.13?".
  assert.deepEqual(vanillaTextureFolders('1.12.2-forge-14.23.5.2859'), {
    block: 'blocks',
    item: 'items',
  });
});

test('retargets a vanilla texture across the rename, in both directions', () => {
  assert.equal(retargetVanillaTexture('minecraft:blocks/stone', '1.21.1'), 'minecraft:block/stone');
  assert.equal(retargetVanillaTexture('minecraft:block/stone', '1.12.2'), 'minecraft:blocks/stone');
  assert.equal(retargetVanillaTexture('minecraft:items/apple', '1.21.1'), 'minecraft:item/apple');
  assert.equal(retargetVanillaTexture('minecraft:item/apple', '1.12.2'), 'minecraft:items/apple');
});

test('an unqualified reference is vanilla, and keeps its spelling', () => {
  // Minecraft resolves a bare path against `minecraft`, so this is the same mistake — and
  // adding a namespace the author did not write would be a second, unrelated change.
  assert.equal(retargetVanillaTexture('blocks/stone', '1.21.1'), 'block/stone');
});

test('leaves a reference that already suits the version alone', () => {
  assert.equal(retargetVanillaTexture('minecraft:block/stone', '1.21.1'), null);
  assert.equal(retargetVanillaTexture('minecraft:blocks/stone', '1.12.2'), null);
});

test("never touches a pack's own textures", () => {
  // A resource pack may lay its own namespace out however it likes: the reference *is* the
  // path. Rewriting these would break the one spelling that works on every version.
  assert.equal(retargetVanillaTexture('myproject:block/ruby', '1.12.2'), null);
  assert.equal(retargetVanillaTexture('myproject:blocks/ruby', '1.21.1'), null);
});

test('leaves texture variables alone', () => {
  assert.equal(retargetVanillaTexture('#all', '1.12.2'), null);
});

test('ignores vanilla paths outside the renamed folders', () => {
  assert.equal(retargetVanillaTexture('minecraft:entity/creeper/creeper', '1.12.2'), null);
  assert.equal(retargetVanillaTexture('minecraft:stone', '1.21.1'), null);
});

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

const CUBE_WITH_PARENT = {
  parent: 'block/cube_all',
  textures: { all: 'myproject:block/ruby' },
  elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }],
};

test('a parent over own geometry is only a problem below 1.9', () => {
  assert.deepEqual(
    inspectModel(CUBE_WITH_PARENT, '1.8.9').map((issue) => issue.id),
    ['parentOverridesGeometry'],
  );
  assert.deepEqual(inspectModel(CUBE_WITH_PARENT, '1.12.2'), []);
});

test('a parent with no geometry of its own is never a problem', () => {
  // The ordinary `cube_all` case, and Ella's own slot redirects.
  const model = { parent: 'block/cube_all', textures: { all: 'x' } };
  assert.deepEqual(inspectModel(model, '1.8.9'), []);
});

test('reports a vanilla texture written for the other era', () => {
  const model = { textures: { all: 'minecraft:blocks/stone' } };
  const [issue] = inspectModel(model, '1.21.1');

  assert.equal(issue.id, 'vanillaTextureFolder');
  assert.equal(issue.fixable, true);
  assert.equal(issue.detail.reference, 'minecraft:blocks/stone');
  assert.equal(issue.detail.expected, 'minecraft:block/stone');
});

test('several stale references in one model are one finding', () => {
  // They are the same mistake made once and fixed in one pass; a row each would bury the
  // rest of the report.
  const model = {
    textures: { a: 'minecraft:blocks/stone', b: 'minecraft:blocks/dirt', c: '#a' },
  };
  const issues = inspectModel(model, '1.21.1');

  assert.equal(issues.length, 1);
  assert.equal(issues[0].detail.count, 2);
});

test('a model that is right for the version has nothing to report', () => {
  const model = { textures: { all: 'myproject:block/ruby' }, elements: [] };
  assert.deepEqual(inspectModel(model, '1.8.9'), []);
  assert.deepEqual(inspectModel(model, '1.21.1'), []);
});

test('rejects things that are not models rather than throwing', () => {
  assert.deepEqual(inspectModel(null, '1.12.2'), []);
  assert.deepEqual(inspectModel('nope', '1.12.2'), []);
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

test('migrating to 1.8 drops the parent that would override the geometry', () => {
  const { model, applied } = migrateModel(CUBE_WITH_PARENT, '1.8.9');

  assert.deepEqual(applied, ['parentOverridesGeometry']);
  assert.equal('parent' in model, false);
  assert.deepEqual(model.elements, CUBE_WITH_PARENT.elements, 'the geometry survives');
});

test('migrating rewrites vanilla texture references', () => {
  const source = { textures: { all: 'minecraft:blocks/stone', own: 'myproject:block/ruby' } };
  const { model } = migrateModel(source, '1.21.1');

  assert.deepEqual(model.textures, {
    all: 'minecraft:block/stone',
    own: 'myproject:block/ruby',
  });
});

test('migration leaves the input untouched', () => {
  const source = { parent: 'block/cube_all', elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] };
  migrateModel(source, '1.8.9');
  assert.equal(source.parent, 'block/cube_all');
});

test('migrating twice changes nothing the second time', () => {
  // The dialog can be answered more than once over a project's life; a migration that
  // drifted on each pass would rewrite files for no reason and dirty every diff.
  const first = migrateModel({ textures: { all: 'minecraft:blocks/stone' } }, '1.21.1');
  const second = migrateModel(first.model, '1.21.1');

  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.model, first.model);
});

test('a model can need both fixes at once', () => {
  const source = {
    parent: 'block/cube_all',
    textures: { all: 'minecraft:block/stone' },
    elements: [{ from: [0, 0, 0], to: [16, 16, 16] }],
  };
  const { applied } = migrateModel(source, '1.8.9');

  assert.deepEqual(applied.sort(), ['parentOverridesGeometry', 'vanillaTextureFolder']);
});

// ---------------------------------------------------------------------------
// Consequences beyond the files
// ---------------------------------------------------------------------------

const facts = (over: Partial<VersionFacts>): VersionFacts => ({
  id: '1.12.2',
  installed: true,
  adapterStatus: 'built',
  javaAvailable: true,
  requiredJava: 8,
  ...over,
});

test('a version with no adapter is called out', () => {
  const notes = versionChangeNotes(null, facts({ id: '1.19.2', adapterStatus: null }));
  assert.deepEqual(notes.map((note) => note.id), ['noAdapter']);
});

test('losing live editing is its own note', () => {
  // Told apart from "this version cannot live-edit" on purpose: it matters far more to
  // someone who had it a moment ago.
  const notes = versionChangeNotes(
    facts({ id: '1.12.2' }),
    facts({ id: '1.19.2', adapterStatus: null }),
  );
  assert.deepEqual(notes.map((note) => note.id), ['noAdapter', 'losesLiveEditing']);
});

test('moving between two live-editing versions says nothing', () => {
  assert.deepEqual(versionChangeNotes(facts({}), facts({ id: '1.21.1' })), []);
});

test('a missing Java runtime is reported with the version it is for', () => {
  const notes = versionChangeNotes(null, facts({ id: '1.21.1', javaAvailable: false, requiredJava: 21 }));
  assert.deepEqual(notes.map((note) => note.id), ['javaMissing']);
  assert.equal(notes[0].detail.java, 21);
});

test('an unbound project is not a version change', () => {
  assert.equal(isVersionChange(null, '1.12.2'), false);
  assert.equal(isVersionChange('1.12.2', '1.12.2'), false);
  assert.equal(isVersionChange('1.12.2', '1.8.9'), true);
});

// ---------------------------------------------------------------------------
// Against a project on disk
// ---------------------------------------------------------------------------

async function projectWithModel(namespace: string, model: unknown) {
  const { project, root } = await createProject('P', namespace, '1.12.2');
  const created = await createEntry(root, project, {
    id: 'ruby',
    kind: 'block',
    displayName: { en: 'Ruby' },
  });

  const file = path.join(root, ...created.entry.model.output.split('/'));
  await writeFile(file, JSON.stringify(model, null, 2), 'utf8');

  return { project: created.project, root, file };
}

test('planning reads the models as they are on disk', async () => {
  const { project, root } = await projectWithModel('planned', {
    textures: { all: 'minecraft:blocks/stone' },
  });

  const plan = await planVersionChange(root, project, '1.21.1');

  assert.equal(plan.from, '1.12.2');
  assert.equal(plan.needsConfirmation, true);
  assert.equal(plan.fixable, 1);
  assert.deepEqual(plan.findings.map((finding) => finding.entryId), ['ruby']);
});

test('planning a launch on the project\'s own version asks for nothing', async () => {
  const { project, root } = await projectWithModel('samever', {
    textures: { all: 'minecraft:blocks/stone' },
  });

  const plan = await planVersionChange(root, project, '1.12.2');
  assert.equal(plan.needsConfirmation, false);
  assert.deepEqual(plan.findings, []);
});

test('a missing model file is not reported as a version problem', async () => {
  // validateForExport already reports it properly; a second diagnosis for the same file
  // would only compete with the first.
  const { project, root, file } = await projectWithModel('nomodel', { textures: {} });
  await rm(file);

  const plan = await planVersionChange(root, project, '1.21.1');
  assert.deepEqual(plan.findings, []);
});

test('applying without migrating rebinds the project and leaves the files alone', async () => {
  const { project, root, file } = await projectWithModel('nomigrate', {
    textures: { all: 'minecraft:blocks/stone' },
  });
  const before = await readFile(file, 'utf8');

  const result = await applyVersionChange(root, project, '1.21.1', { migrate: false });

  assert.deepEqual(result.migrated, []);
  assert.equal(result.project.targetVersion, '1.21.1');
  assert.equal((await loadProject(root)).targetVersion, '1.21.1');
  assert.equal(await readFile(file, 'utf8'), before);
});

test('applying with migration rewrites the models and rebinds', async () => {
  const { project, root, file } = await projectWithModel('migrate', {
    textures: { all: 'minecraft:blocks/stone' },
  });

  const result = await applyVersionChange(root, project, '1.21.1', { migrate: true });

  assert.deepEqual(result.migrated, ['ruby']);
  const written = JSON.parse(await readFile(file, 'utf8')) as { textures: Record<string, string> };
  assert.equal(written.textures.all, 'minecraft:block/stone');

  // And the project is now clean for the version it is bound to.
  const plan = await planVersionChange(root, result.project, '1.21.1');
  assert.deepEqual(plan.findings, []);
});

test('a migrated model keeps the formatting Blockbench writes', async () => {
  // These are the author's files; the next save has to see something it recognises rather
  // than a diff of the whole document.
  const { project, root, file } = await projectWithModel('formatting', {
    textures: { all: 'minecraft:blocks/stone' },
  });

  await applyVersionChange(root, project, '1.21.1', { migrate: true });
  const written = await readFile(file, 'utf8');

  assert.match(written, /^\{\n {2}"textures"/, 'two-space indentation');
  assert.match(written, /\n$/, 'trailing newline');
});

test('a project bound to nothing adopts the version it is applied to', async () => {
  const { project, root } = await createProject('Fresh', 'freshproj');
  assert.equal(project.targetVersion, null);

  const result = await applyVersionChange(root, project, '1.12.2', { migrate: false });
  assert.equal(result.project.targetVersion, '1.12.2');
});
