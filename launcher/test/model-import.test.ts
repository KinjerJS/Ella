import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProject, createEntry, loadProject, ProjectError } from '../src/main/project.ts';
import {
  readModelFile,
  inferModelKind,
  nameFromFile,
  importModelAsEntry,
  replaceEntryModel,
  undoReplaceModel,
} from '../src/main/model-import.ts';
import { placeholderTexturePng } from '../src/main/pack.ts';
import { setDataRoot } from '../src/main/paths.ts';

let workspace: string;

const exists = (target: string): Promise<boolean> =>
  stat(target).then(() => true, () => false);

test.beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-import-'));
  setDataRoot(workspace);
});

test.afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** Writes files under the workspace, creating folders; strings are written as UTF-8. */
async function put(files: Record<string, string | Buffer>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(workspace, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

const png = (label: string): Buffer => Buffer.concat([placeholderTexturePng(), Buffer.from(label)]);

async function readJson(root: string, relative: string) {
  return JSON.parse(await readFile(path.join(root, ...relative.split('/')), 'utf8'));
}

/** A model inside another pack, with a face texture doubling as the particle. */
async function packModel(): Promise<string> {
  await put({
    'other/assets/shop/models/block/ruby_lamp.json': JSON.stringify({
      parent: 'block/block',
      textures: {
        particle: 'shop:block/ruby_glass',
        '0': 'shop:block/ruby_glass',
        base: 'shop:block/lamp_base',
        stone: 'block/stone',
      },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }],
    }),
    'other/assets/shop/textures/block/ruby_glass.png': png('glass'),
    'other/assets/shop/textures/block/ruby_glass.png.mcmeta': '{"animation":{}}',
    'other/assets/shop/textures/block/lamp_base.png': png('base'),
  });
  return path.join(workspace, 'other/assets/shop/models/block/ruby_lamp.json');
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('reads a model, byte-order mark and all', async () => {
  await put({ 'm.json': '\uFEFF{"parent":"block/cube_all"}' });
  assert.deepEqual(await readModelFile(path.join(workspace, 'm.json')), { parent: 'block/cube_all' });
});

test('names the JSON files most often picked by mistake', async () => {
  await put({
    'blockstate.json': '{"variants":{"":{"model":"x"}}}',
    'project.json': '{"meta":{"format_version":"4.5"},"elements":[]}',
    'lang.json': '{"block.x.y":"Y"}',
    'broken.json': '{"parent":',
  });

  const rejects = (file: string, code: string, pattern: RegExp) =>
    assert.rejects(readModelFile(path.join(workspace, file)), (error: ProjectError) => {
      assert.equal(error.code, code);
      assert.match(error.message, pattern);
      return true;
    });

  await rejects('blockstate.json', 'NOT_A_MODEL', /blockstate/);
  await rejects('project.json', 'NOT_A_MODEL', /Blockbench project/);
  await rejects('lang.json', 'NOT_A_MODEL', /not a Minecraft model/);
  await rejects('broken.json', 'BAD_MODEL_JSON', /not valid JSON/);
});

test('infers the kind from the pack folder, then the parent, then the shape', () => {
  assert.equal(inferModelKind('/p/assets/x/models/item/sword.json', { elements: [] }), 'item');
  assert.equal(inferModelKind('/p/assets/x/models/blocks/old.json', {}), 'block');
  assert.equal(inferModelKind('/loose/gem.json', { parent: 'item/generated' }), 'item');
  assert.equal(inferModelKind('/loose/gem.json', { parent: 'minecraft:block/cube_all' }), 'block');
  assert.equal(inferModelKind('/loose/gem.json', { textures: { layer0: 'x' } }), 'item');
  assert.equal(inferModelKind('/loose/thing.json', { elements: [] }), 'block');
});

test('a display name comes from the file name', () => {
  assert.equal(nameFromFile('/a/ruby_lamp.json'), 'Ruby Lamp');
  assert.equal(nameFromFile('C:\\models\\big-oak.door.json'), 'Big Oak Door');
});

// ---------------------------------------------------------------------------
// Importing as a new entry
// ---------------------------------------------------------------------------

test('an imported model brings its images under the entry’s names', async () => {
  const file = await packModel();
  const { project, root } = await createProject('P', 'proj');

  const { project: updated, entry, summary, files } = await importModelAsEntry(root, project, file, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  assert.deepEqual((await loadProject(root)).entries.map((e) => e.id), ['lamp']);
  assert.equal(updated.entries[0].slot, entry.slot);

  const model = await readJson(root, entry.model.output);
  // The first drawable image is the entry's own, the particle shares it rather than being
  // copied twice, and vanilla references are left alone.
  assert.deepEqual(model.textures, {
    particle: 'proj:block/lamp',
    '0': 'proj:block/lamp',
    base: 'proj:block/lamp_base',
    stone: 'block/stone',
  });
  assert.equal(model.parent, 'block/block');
  assert.equal(model.elements.length, 1);

  assert.deepEqual(summary, { imported: 2, vanilla: 1, missing: [], missingParent: null });
  assert.deepEqual(
    (await readFile(path.join(root, 'pack/assets/proj/textures/block/lamp.png'))).subarray(-5).toString(),
    'glass',
  );
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/block/lamp.png.mcmeta')), true);
  assert.equal(files.length, 4, 'model, two images and one animation file');
});

test('a loose export finds the images saved beside it', async () => {
  await put({
    'loose/gem.json': JSON.stringify({ parent: 'item/generated', textures: { layer0: 'item/gem' } }),
    'loose/gem.png': png('gem'),
  });
  const { project, root } = await createProject('P', 'proj');

  const { entry, summary } = await importModelAsEntry(root, project, path.join(workspace, 'loose/gem.json'), {
    id: 'gem', kind: 'item', displayName: { en: 'Gem' },
  });

  assert.equal((await readJson(root, entry.model.output)).textures.layer0, 'proj:item/gem');
  assert.equal(summary.imported, 1);
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/item/gem.png')), true);
});

test('an image nothing could be found for becomes a placeholder, and is reported', async () => {
  // A reference to a missing file is what stops a model loading at all.
  await put({
    'loose/odd.json': JSON.stringify({
      textures: { '0': 'shop:block/nowhere', '1': 'ruby', side: '#0' },
      elements: [],
    }),
  });
  const { project, root } = await createProject('P', 'proj');

  const { entry, summary } = await importModelAsEntry(root, project, path.join(workspace, 'loose/odd.json'), {
    id: 'odd', kind: 'block', displayName: { en: 'Odd' },
  });

  const model = await readJson(root, entry.model.output);
  // Numeric keys do not produce `odd_1`, which is what a duplicate of `odd` is called.
  assert.deepEqual(model.textures, { '0': 'proj:block/odd', '1': 'proj:block/odd_tex1', side: '#0' });
  assert.deepEqual(summary.missing, ['shop:block/nowhere', 'ruby']);
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/block/odd_tex1.png')), true);
});

test('a parent the project cannot supply is reported', async () => {
  await put({
    'loose/a.json': JSON.stringify({ parent: 'shop:block/base_lamp' }),
    'loose/b.json': JSON.stringify({ parent: 'minecraft:block/cube_all' }),
  });
  const { project, root } = await createProject('P', 'proj');

  const a = await importModelAsEntry(root, project, path.join(workspace, 'loose/a.json'), {
    id: 'a', kind: 'block', displayName: { en: 'A' },
  });
  const b = await importModelAsEntry(root, a.project, path.join(workspace, 'loose/b.json'), {
    id: 'b', kind: 'block', displayName: { en: 'B' },
  });

  assert.equal(a.summary.missingParent, 'shop:block/base_lamp');
  assert.equal(b.summary.missingParent, null);
});

test('importing refuses an invalid id, a taken id, or files already on disk', async () => {
  const file = await packModel();
  const { project: empty, root } = await createProject('P', 'proj');
  const { project } = await createEntry(root, empty, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  const code = (expected: string) => (error: ProjectError) => {
    assert.equal(error.code, expected);
    return true;
  };

  await assert.rejects(
    importModelAsEntry(root, project, file, { id: 'Bad', kind: 'block', displayName: { en: 'B' } }),
    code('INVALID_ID'),
  );
  await assert.rejects(
    importModelAsEntry(root, project, file, { id: 'lamp', kind: 'block', displayName: { en: 'L' } }),
    code('DUPLICATE_ID'),
  );

  const orphan = path.join(root, 'pack/assets/proj/models/block/kept.json');
  await mkdir(path.dirname(orphan), { recursive: true });
  await writeFile(orphan, 'authored');
  await assert.rejects(
    importModelAsEntry(root, project, file, { id: 'kept', kind: 'block', displayName: { en: 'K' } }),
    code('ENTRY_FILES_EXIST'),
  );
  assert.equal(await readFile(orphan, 'utf8'), 'authored');
});

// ---------------------------------------------------------------------------
// Replacing an entry's model
// ---------------------------------------------------------------------------

test('replacing a model overwrites it and its images, and undo puts them back', async () => {
  const file = await packModel();
  const { project: empty, root } = await createProject('P', 'proj');
  const { project, entry } = await createEntry(root, empty, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  const modelFile = path.join(root, ...entry.model.output.split('/'));
  const textureFile = path.join(root, 'pack/assets/proj/textures/block/lamp.png');
  const modelBefore = await readFile(modelFile, 'utf8');
  const textureBefore = await readFile(textureFile);

  const replaced = await replaceEntryModel(root, project, entry, file);
  assert.equal((await readJson(root, entry.model.output)).textures.base, 'proj:block/lamp_base');
  assert.notDeepEqual(await readFile(textureFile), textureBefore);

  await undoReplaceModel(root, replaced);
  assert.equal(await readFile(modelFile, 'utf8'), modelBefore);
  assert.deepEqual(await readFile(textureFile), textureBefore);
  assert.equal(
    await exists(path.join(root, 'pack/assets/proj/textures/block/lamp_base.png')),
    false,
    'an image only the import brought is taken away again',
  );
});

test('a placeholder never replaces an image the entry already has', async () => {
  await put({ 'loose/bare.json': JSON.stringify({ textures: { all: 'shop:block/gone' }, elements: [] }) });
  const { project: empty, root } = await createProject('P', 'proj');
  const { project, entry } = await createEntry(root, empty, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  const textureFile = path.join(root, 'pack/assets/proj/textures/block/lamp.png');
  await writeFile(textureFile, png('painted'));

  const { summary } = await replaceEntryModel(root, project, entry, path.join(workspace, 'loose/bare.json'));

  assert.deepEqual(summary.missing, ['shop:block/gone']);
  assert.equal((await readFile(textureFile)).subarray(-7).toString(), 'painted');
  assert.equal((await readJson(root, entry.model.output)).textures.all, 'proj:block/lamp');
});

test('re-importing an entry’s own model file is harmless', async () => {
  const { project: empty, root } = await createProject('P', 'proj');
  const { project, entry } = await createEntry(root, empty, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });
  const own = path.join(root, ...entry.model.output.split('/'));
  const before = await readJson(root, entry.model.output);

  await replaceEntryModel(root, project, entry, own);
  assert.deepEqual(await readJson(root, entry.model.output), before);
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/block/lamp.png')), true);
});
