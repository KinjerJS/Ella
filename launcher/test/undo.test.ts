import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UndoRegistry } from '../src/main/undo.ts';
import { stashFiles, restoreStash, purgeStashes, TRASH_DIR } from '../src/main/trash.ts';
import {
  createProject,
  createEntry,
  deleteEntry,
  restoreEntry,
  loadProject,
  removeModelParent,
  writeModelFile,
  textureRelativePath,
  ProjectError,
} from '../src/main/project.ts';
import { removeTexture, restoreTexture, addTexture } from '../src/main/textures.ts';
import { setDataRoot } from '../src/main/paths.ts';

let workspace: string;

test.before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-undo-'));
  setDataRoot(workspace);
});

test.after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const exists = (target: string): Promise<boolean> =>
  readFile(target).then(() => true, () => false);

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test('an offer runs the inverse it was registered with', async () => {
  const registry = new UndoRegistry();
  let ran = false;

  const offer = registry.offer('entry.deletedDone', { id: 'x' }, async () => {
    ran = true;
  });

  await registry.run(offer.token);
  assert.equal(ran, true);
});

test('an offer carries what the notification needs to say', async () => {
  const registry = new UndoRegistry();
  const offer = registry.offer('entry.deletedDone', { id: 'ruby' }, async () => {});

  assert.equal(offer.messageKey, 'entry.deletedDone');
  assert.deepEqual(offer.values, { id: 'ruby' });
  assert.ok(offer.token.length > 0);
});

test('an offer is one-shot', async () => {
  // Pressing Undo twice must not apply the inverse twice: restoring a deleted entry a
  // second time would fail on the duplicate, and the second error is the confusing one.
  const registry = new UndoRegistry();
  let runs = 0;
  const offer = registry.offer('k', {}, async () => {
    runs++;
  });

  await registry.run(offer.token);
  await assert.rejects(registry.run(offer.token), (error: Error & { code: string }) => {
    assert.equal(error.code, 'UNDO_EXPIRED');
    return true;
  });
  assert.equal(runs, 1);
});

test('a failed inverse is not offered again', async () => {
  // It has already done whatever part of its work it managed; running it again compounds
  // that rather than retrying it.
  const registry = new UndoRegistry();
  const offer = registry.offer('k', {}, async () => {
    throw new Error('nope');
  });

  await assert.rejects(registry.run(offer.token), /nope/);
  await assert.rejects(registry.run(offer.token), /no longer be undone/);
});

test('two offers do not collide', async () => {
  const registry = new UndoRegistry();
  const order: string[] = [];

  const first = registry.offer('a', {}, async () => void order.push('a'));
  const second = registry.offer('b', {}, async () => void order.push('b'));

  await registry.run(second.token);
  await registry.run(first.token);
  assert.deepEqual(order, ['b', 'a']);
});

test('only the last few offers stay live', async () => {
  // They hold closures over a project state that moves on; keeping them all would let an
  // undo from ten actions ago apply to something it no longer describes.
  const registry = new UndoRegistry();
  const offers = Array.from({ length: 12 }, (_, index) =>
    registry.offer(String(index), {}, async () => {}),
  );

  await assert.rejects(registry.run(offers[0].token), /no longer be undone/);
  await registry.run(offers[11].token);
});

test('clearing drops every offer', async () => {
  const registry = new UndoRegistry();
  const offer = registry.offer('k', {}, async () => {});

  registry.clear();
  await assert.rejects(registry.run(offer.token), /no longer be undone/);
});

// ---------------------------------------------------------------------------
// The stash
// ---------------------------------------------------------------------------

async function stashWorkspace(name: string): Promise<string> {
  const root = path.join(workspace, name);
  await mkdir(path.join(root, 'pack', 'assets', 'x'), { recursive: true });
  await writeFile(path.join(root, 'pack', 'assets', 'x', 'a.json'), '{"a":1}', 'utf8');
  await writeFile(path.join(root, 'pack', 'assets', 'x', 'b.png'), 'png', 'utf8');
  return root;
}

test('stashing moves files out of the project and back again', async () => {
  const root = await stashWorkspace('stash-round-trip');
  const paths = ['pack/assets/x/a.json', 'pack/assets/x/b.png'];

  assert.deepEqual(await stashFiles(root, 'entry-a', paths), paths);
  assert.equal(await exists(path.join(root, 'pack/assets/x/a.json')), false);

  assert.deepEqual((await restoreStash(root, 'entry-a')).sort(), paths);
  assert.equal(await readFile(path.join(root, 'pack/assets/x/a.json'), 'utf8'), '{"a":1}');
});

test('stashing skips a file that is not there', async () => {
  // An entry may never have had a Blockbench source, and refusing to delete it over that
  // would be absurd.
  const root = await stashWorkspace('stash-missing');
  const moved = await stashFiles(root, 'entry-a', ['pack/assets/x/a.json', 'sources/a.bbmodel']);

  assert.deepEqual(moved, ['pack/assets/x/a.json']);
});

test('restoring never overwrites a file that came back on its own', async () => {
  // Recreating an entry with the same id after deleting it is the case: the new file is
  // the author's current work, and an undo of the old delete must not bury it.
  const root = await stashWorkspace('stash-no-clobber');
  await stashFiles(root, 'entry-a', ['pack/assets/x/a.json']);
  await writeFile(path.join(root, 'pack/assets/x/a.json'), 'newer', 'utf8');

  assert.deepEqual(await restoreStash(root, 'entry-a'), []);
  assert.equal(await readFile(path.join(root, 'pack/assets/x/a.json'), 'utf8'), 'newer');
});

test('restoring an empty stash is not an error', async () => {
  const root = await stashWorkspace('stash-empty');
  assert.deepEqual(await restoreStash(root, 'never-used'), []);
});

test('purging empties the trash', async () => {
  const root = await stashWorkspace('stash-purge');
  await stashFiles(root, 'entry-a', ['pack/assets/x/a.json']);

  await purgeStashes(root);
  assert.equal(await exists(path.join(root, TRASH_DIR, 'entry-a', 'pack/assets/x/a.json')), false);
});

// ---------------------------------------------------------------------------
// Undoing a delete
// ---------------------------------------------------------------------------

async function projectWithEntries(namespace: string) {
  const { project, root } = await createProject('U', namespace, '1.12.2');
  let current = project;
  for (const id of ['one', 'two', 'three']) {
    current = (await createEntry(root, current, { id, kind: 'block', displayName: { en: id } }))
      .project;
  }
  return { project: current, root };
}

test('restoring a deleted entry puts it back where it was', async () => {
  // Appending it would reorder a list the author arranged, for no reason other than
  // convenience of implementation.
  const { project, root } = await projectWithEntries('undodelete');
  const { project: after, entry, index } = await deleteEntry(root, project, 'two');

  assert.equal(index, 1);
  const { project: restored } = await restoreEntry(root, after, entry, index);

  assert.deepEqual(restored.entries.map((candidate) => candidate.id), ['one', 'two', 'three']);
  assert.deepEqual((await loadProject(root)).entries.map((c) => c.id), ['one', 'two', 'three']);
});

test('restoring brings the files back when the delete took them', async () => {
  const { project, root } = await projectWithEntries('undofiles');
  const entry = project.entries.find((candidate) => candidate.id === 'two')!;
  const model = path.join(root, ...entry.model.output.split('/'));
  const texture = path.join(root, ...textureRelativePath(project, entry).split('/'));

  const deleted = await deleteEntry(root, project, 'two', { deleteFiles: true });
  assert.equal(await exists(model), false);
  assert.equal(await exists(texture), false, 'the texture goes too, as the dialog promises');

  await restoreEntry(root, deleted.project, deleted.entry, deleted.index);
  assert.equal(await exists(model), true);
  assert.equal(await exists(texture), true);
});

test('a restored entry keeps its slot when it is still free', async () => {
  const { project, root } = await projectWithEntries('undoslot');
  const deleted = await deleteEntry(root, project, 'two');
  const slot = deleted.entry.slot;

  const { entry } = await restoreEntry(root, deleted.project, deleted.entry, deleted.index);
  assert.equal(entry.slot, slot);
});

test('a restored entry takes another slot rather than doubling up', async () => {
  // Two entries on one slot is a live-editing bug that outlasts the session, and the slot
  // is the one part of an entry that is disposable.
  const { project, root } = await projectWithEntries('undoslottaken');
  const deleted = await deleteEntry(root, project, 'two');
  const freed = deleted.entry.slot as number;

  const { project: withNew } = await createEntry(root, deleted.project, {
    id: 'squatter',
    kind: 'block',
    displayName: { en: 'Squatter' },
    slot: freed,
  });

  const { entry } = await restoreEntry(root, withNew, deleted.entry, deleted.index);
  assert.notEqual(entry.slot, freed);
  assert.equal(typeof entry.slot, 'number');
});

test('restoring over an id that came back is refused', async () => {
  const { project, root } = await projectWithEntries('undodup');
  const deleted = await deleteEntry(root, project, 'two');

  const { project: recreated } = await createEntry(root, deleted.project, {
    id: 'two',
    kind: 'block',
    displayName: { en: 'Two again' },
  });

  await assert.rejects(
    restoreEntry(root, recreated, deleted.entry, deleted.index),
    (error: ProjectError) => {
      assert.equal(error.code, 'DUPLICATE_ID');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Undoing a texture removal
// ---------------------------------------------------------------------------

test('restoring a texture variable puts the key back', async () => {
  const { project, root } = await createProject('T', 'undotex', '1.12.2');
  const { project: withEntry, entry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });
  await addTexture(root, withEntry, entry, 'side');

  const { removed, textures } = await removeTexture(root, withEntry, entry, 'side');
  assert.equal(textures.some((texture) => texture.key === 'side'), false);

  const after = await restoreTexture(root, withEntry, entry, removed);
  const side = after.find((texture) => texture.key === 'side');
  assert.equal(side?.reference, removed.reference);
});

test('restoring a texture puts the particle entry back with it', async () => {
  // Removing a variable the particle pointed at clears both; an undo that restored only
  // one would leave the model half-reverted.
  const { project, root } = await createProject('T', 'undopart', '1.12.2');
  const { project: withEntry, entry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  const { removed } = await removeTexture(root, withEntry, entry, 'all');
  assert.equal(removed.wasParticle, true, 'the generated model points particle at #all');

  const after = await restoreTexture(root, withEntry, entry, removed);
  const particle = after.find((texture) => texture.key === 'particle');
  assert.equal(particle?.reference, removed.reference);
});

test('a texture whose file was deleted is not restored as a dangling reference', async () => {
  // A variable pointing at a missing file stops the whole model loading — worse than the
  // removal it was meant to undo.
  const { project, root } = await createProject('T', 'undogone', '1.12.2');
  const { project: withEntry, entry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  const { removed } = await removeTexture(root, withEntry, entry, 'all', { deleteFile: true });

  await assert.rejects(
    restoreTexture(root, withEntry, entry, removed),
    (error: ProjectError) => {
      assert.equal(error.code, 'TEXTURE_FILE_GONE');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Undoing a model rewrite
// ---------------------------------------------------------------------------

test('removing a parent hands back the file as it was', async () => {
  const { project, root } = await createProject('M', 'undoparent', '1.12.2');
  const { entry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  const file = path.join(root, ...entry.model.output.split('/'));
  const authored = '{\n  "parent": "block/cube_all",\n  "elements": [ ]\n}\n';
  await writeFile(file, '{"parent":"block/cube_all","elements":[{"from":[0,0,0]}]}', 'utf8');
  const before = await readFile(file, 'utf8');

  const removed = await removeModelParent(root, entry);
  assert.equal(removed?.parent, 'block/cube_all');
  assert.equal(removed?.original, before, 'byte-for-byte, not re-derived');
  assert.equal((await readFile(file, 'utf8')).includes('parent'), false);

  // Undoing is writing that text back, which also restores whatever formatting it had.
  await writeModelFile(root, entry, removed!.original);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.notEqual(before, authored);
});

test('a model with nothing to fix reports nothing to undo', async () => {
  const { project, root } = await createProject('M', 'undonoop', '1.12.2');
  const { entry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  assert.equal(await removeModelParent(root, entry), null);
});
