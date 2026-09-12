import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createProject,
  createEntry,
  duplicateEntry,
  updateEntry,
  loadProject,
  ProjectError,
} from '../src/main/project.ts';
import { addTexture } from '../src/main/textures.ts';
import { setDataRoot } from '../src/main/paths.ts';
import {
  duplicateIdFor,
  duplicateDisplayName,
  type ProjectEntry,
} from '../src/shared/project.ts';

let workspace: string;

const exists = (target: string): Promise<boolean> =>
  stat(target).then(() => true, () => false);

test.beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-duplicate-'));
  setDataRoot(workspace);
});

test.afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function seed() {
  const { project, root } = await createProject('P', 'proj');
  const { project: updated, entry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp', fr: 'Lampe' },
  });
  return { root, project: updated, entry };
}

const readModel = async (root: string, entry: ProjectEntry) =>
  JSON.parse(await readFile(path.join(root, ...entry.model.output.split('/')), 'utf8')) as {
    textures: Record<string, string>;
  };

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

test('an unnamed duplicate is numbered from 1', () => {
  assert.equal(duplicateIdFor('lamp', () => false), 'lamp_1');
});

test('the counter skips identifiers already taken', () => {
  const taken = new Set(['lamp_1', 'lamp_2']);
  assert.equal(duplicateIdFor('lamp', (id) => taken.has(id)), 'lamp_3');
});

test('duplicating a numbered copy continues its series', () => {
  // The editor follows each copy, so repeated duplicates start from the last one made.
  assert.equal(duplicateIdFor('lamp_1', () => false), 'lamp_2');
  assert.equal(duplicateIdFor('lamp_9', (id) => id === 'lamp_10'), 'lamp_11');
});

test('the counter is never cut off by the identifier length limit', () => {
  const long = 'a'.repeat(64);
  const id = duplicateIdFor(long, () => false);
  assert.equal(id.length, 64);
  assert.match(id, /_1$/);
});

test('display names are numbered like the identifier', () => {
  const lamp = { id: 'lamp', displayName: { en: 'Lamp', fr: 'Lampe' } };
  assert.deepEqual(duplicateDisplayName(lamp, 'lamp_1'), { en: 'Lamp 1', fr: 'Lampe 1' });

  const copy = { id: 'lamp_1', displayName: { en: 'Lamp 1' } };
  assert.deepEqual(duplicateDisplayName(copy, 'lamp_2'), { en: 'Lamp 2' });
});

test('a number that belongs to the name is kept', () => {
  const stage = { id: 'stage_two', displayName: { en: 'Stage 2' } };
  assert.deepEqual(duplicateDisplayName(stage, 'stage_two_1'), { en: 'Stage 2 1' });
});

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

test('duplicating without a name spams lamp_1, lamp_2, lamp_3', async () => {
  const { root, project } = await seed();

  let current = project;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await duplicateEntry(root, current, 'lamp');
    current = result.project;
    ids.push(result.entry.id);
  }

  assert.deepEqual(ids, ['lamp_1', 'lamp_2', 'lamp_3']);
  // Kept beside the source, in order, rather than interleaved.
  assert.deepEqual(current.entries.map((e) => e.id), ['lamp', 'lamp_1', 'lamp_2', 'lamp_3']);
  assert.deepEqual(
    (await loadProject(root)).entries.map((e) => e.id),
    ['lamp', 'lamp_1', 'lamp_2', 'lamp_3'],
  );
});

test('the copy has its own model, texture, slot and settings', async () => {
  const { root, project } = await seed();
  const { project: patched } = await updateEntry(root, project, 'lamp', {
    settings: { lightLevel: 12, hitbox: [0, 0, 0, 16, 8, 16] },
  });

  const { entry, files } = await duplicateEntry(root, patched, 'lamp');
  const source = patched.entries[0];

  assert.equal(entry.kind, 'block');
  assert.notEqual(entry.slot, source.slot);
  assert.deepEqual(entry.settings, source.settings);
  assert.deepEqual(entry.displayName, { en: 'Lamp 1', fr: 'Lampe 1' });

  assert.equal(entry.model.output, 'pack/assets/proj/models/block/lamp_1.json');
  assert.equal(await exists(path.join(root, 'pack/assets/proj/models/block/lamp_1.json')), true);
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/block/lamp_1.png')), true);
  assert.deepEqual(files.sort(), [
    'pack/assets/proj/models/block/lamp_1.json',
    'pack/assets/proj/textures/block/lamp_1.png',
  ]);

  // Copied, not moved.
  assert.equal(await exists(path.join(root, 'pack/assets/proj/models/block/lamp.json')), true);
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/block/lamp.png')), true);
});

test('the copy points at its own textures, not the source’s', async () => {
  // Otherwise importing an image for one would repaint both.
  const { root, project, entry: lamp } = await seed();
  await addTexture(root, project, lamp, 'side');

  const { entry } = await duplicateEntry(root, project, 'lamp', { id: 'blue_lamp' });
  const model = await readModel(root, entry);

  assert.equal(model.textures.all, 'proj:block/blue_lamp');
  assert.equal(model.textures.particle, 'proj:block/blue_lamp');
  assert.equal(model.textures.side, 'proj:block/blue_lamp_side');
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/block/blue_lamp_side.png')), true);

  const original = await readModel(root, lamp);
  assert.equal(original.textures.side, 'proj:block/lamp_side');
});

test('textures shared under their own name, or owned by another entry, stay shared', async () => {
  const { root, project, entry: lamp } = await seed();
  const { project: withPost } = await createEntry(root, project, {
    id: 'lamp_post', kind: 'block', displayName: { en: 'Lamp post' },
  });

  const file = path.join(root, ...lamp.model.output.split('/'));
  const model = JSON.parse(await readFile(file, 'utf8'));
  model.textures.glass = 'proj:block/common_glass';
  model.textures.pole = 'proj:block/lamp_post';
  model.textures.stone = 'minecraft:block/stone';
  await writeFile(file, JSON.stringify(model), 'utf8');

  const { entry } = await duplicateEntry(root, withPost, 'lamp');
  const copy = await readModel(root, entry);

  assert.equal(copy.textures.glass, 'proj:block/common_glass');
  assert.equal(copy.textures.pole, 'proj:block/lamp_post');
  assert.equal(copy.textures.stone, 'minecraft:block/stone');
  assert.equal(copy.textures.all, 'proj:block/lamp_1');
});

test('an item is duplicated into item paths', async () => {
  const { project, root } = await createProject('P', 'proj');
  const { project: withItem } = await createEntry(root, project, {
    id: 'ruby', kind: 'item', displayName: { en: 'Ruby' },
  });

  const { entry } = await duplicateEntry(root, withItem, 'ruby');
  assert.equal(entry.kind, 'item');
  assert.equal(await exists(path.join(root, 'pack/assets/proj/models/item/ruby_1.json')), true);
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/item/ruby_1.png')), true);
  assert.equal((await readModel(root, entry)).textures.layer0, 'proj:item/ruby_1');
});

test('a named duplicate takes the id and names it is given', async () => {
  const { root, project } = await seed();
  const { entry } = await duplicateEntry(root, project, 'lamp', {
    id: 'ruby_lamp',
    displayName: { en: 'Ruby lamp' },
  });

  assert.equal(entry.id, 'ruby_lamp');
  assert.deepEqual(entry.displayName, { en: 'Ruby lamp' });
});

test('rejects an invalid or taken identifier without writing anything', async () => {
  const { root, project } = await seed();

  await assert.rejects(duplicateEntry(root, project, 'lamp', { id: 'Bad Name' }), (e: ProjectError) => {
    assert.equal(e.code, 'INVALID_ID');
    return true;
  });
  await assert.rejects(duplicateEntry(root, project, 'lamp', { id: 'lamp' }), (e: ProjectError) => {
    assert.equal(e.code, 'DUPLICATE_ID');
    return true;
  });
  await assert.rejects(duplicateEntry(root, project, 'nope'), (e: ProjectError) => {
    assert.equal(e.code, 'UNKNOWN_ENTRY');
    return true;
  });

  assert.equal((await loadProject(root)).entries.length, 1);
});

test('files left behind by a deleted entry are never overwritten', async () => {
  const { root, project } = await seed();
  const orphan = path.join(root, 'pack/assets/proj/models/block/lamp_1.json');
  await mkdir(path.dirname(orphan), { recursive: true });
  await writeFile(orphan, 'authored', 'utf8');

  // Unnamed, the copy moves on to the next number.
  const { entry } = await duplicateEntry(root, project, 'lamp');
  assert.equal(entry.id, 'lamp_2');
  assert.equal(await readFile(orphan, 'utf8'), 'authored');

  // Named, it is refused.
  await assert.rejects(duplicateEntry(root, project, 'lamp', { id: 'lamp_1' }), (e: ProjectError) => {
    assert.equal(e.code, 'ENTRY_FILES_EXIST');
    return true;
  });
  assert.equal(await readFile(orphan, 'utf8'), 'authored');
});

test('a full pool refuses the copy', async () => {
  const { project, root } = await createProject('P', 'proj');
  const small = { ...project, slotPool: { block: 1, item: 1 } };
  const { project: full } = await createEntry(root, small, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  await assert.rejects(duplicateEntry(root, full, 'lamp'), (e: ProjectError) => {
    assert.equal(e.code, 'SLOT_POOL_FULL');
    return true;
  });
  assert.equal(await exists(path.join(root, 'pack/assets/proj/models/block/lamp_1.json')), false);
});
