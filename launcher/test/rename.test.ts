import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createProject,
  createEntry,
  renameEntry,
  updateProjectInfo,
  readTextureInfo,
  loadProject,
  ProjectError,
} from '../src/main/project.ts';
import { setDataRoot } from '../src/main/paths.ts';
import { translationKeysFor, registryNameFor } from '../src/shared/project.ts';

let workspace: string;

const exists = (target: string): Promise<boolean> =>
  stat(target).then(() => true, () => false);

test.beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-rename-'));
  setDataRoot(workspace);
});

test.afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function seed(namespace = 'proj') {
  const { project, root } = await createProject('P', namespace);
  const { project: updated, entry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });
  return { root, project: updated, entry };
}

// ---------------------------------------------------------------------------
// Entry rename
// ---------------------------------------------------------------------------

test('renaming an entry moves its model and texture', async () => {
  const { root, project } = await seed();
  const { entry } = await renameEntry(root, project, 'lamp', 'ruby_lamp');

  assert.equal(entry.id, 'ruby_lamp');
  assert.equal(await exists(path.join(root, 'pack/assets/proj/models/block/ruby_lamp.json')), true);
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/block/ruby_lamp.png')), true);

  // Moved, not copied: a leftover would be exported as a stray asset.
  assert.equal(await exists(path.join(root, 'pack/assets/proj/models/block/lamp.json')), false);
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/block/lamp.png')), false);
});

test('the renamed entry keeps its settings, slot and display name', async () => {
  const { root, project } = await seed();
  const { project: patched } = await createEntry(root, project, {
    id: 'other', kind: 'item', displayName: { en: 'Other' },
  });

  const before = patched.entries.find((e) => e.id === 'lamp')!;
  const { entry } = await renameEntry(root, patched, 'lamp', 'renamed');

  assert.equal(entry.slot, before.slot);
  assert.deepEqual(entry.displayName, before.displayName);
  assert.deepEqual(entry.settings, before.settings);
});

test('the texture is still readable after a rename', async () => {
  const { root, project } = await seed();
  const { project: updated, entry } = await renameEntry(root, project, 'lamp', 'renamed');

  const info = await readTextureInfo(root, updated, entry);
  assert.equal(info.exists, true);
  assert.equal(info.isPlaceholder, true);
});

test('rejects an invalid or duplicate identifier without touching files', async () => {
  const { root, project } = await seed();
  const { project: two } = await createEntry(root, project, {
    id: 'taken', kind: 'block', displayName: { en: 'Taken' },
  });

  await assert.rejects(renameEntry(root, two, 'lamp', 'Bad Name'), (e: ProjectError) => {
    assert.equal(e.code, 'INVALID_ID');
    return true;
  });
  await assert.rejects(renameEntry(root, two, 'lamp', 'taken'), (e: ProjectError) => {
    assert.equal(e.code, 'DUPLICATE_ID');
    return true;
  });

  assert.equal(await exists(path.join(root, 'pack/assets/proj/models/block/lamp.json')), true);
});

test('renaming to the same id is a no-op', async () => {
  const { root, project } = await seed();
  const { entry } = await renameEntry(root, project, 'lamp', 'lamp');
  assert.equal(entry.id, 'lamp');
});

test('rename changes the export registry name and translation keys', async () => {
  // This is the point of the feature: the id is what an export uses.
  const { root, project } = await seed();
  const { project: updated, entry } = await renameEntry(root, project, 'lamp', 'ruby_lamp');

  assert.equal(registryNameFor(updated.namespace, entry.id), 'proj:ruby_lamp');
  assert.deepEqual(translationKeysFor(updated.namespace, entry), {
    modern: 'block.proj.ruby_lamp',
    legacy: 'tile.proj.ruby_lamp.name',
  });
});

// ---------------------------------------------------------------------------
// Project namespace rename
// ---------------------------------------------------------------------------

test('renaming the namespace moves the asset directory', async () => {
  const { root, project } = await seed('oldns');
  const updated = await updateProjectInfo(root, project, { namespace: 'newns' });

  assert.equal(updated.namespace, 'newns');
  assert.equal(await exists(path.join(root, 'pack/assets/newns')), true);
  assert.equal(await exists(path.join(root, 'pack/assets/oldns')), false);
});

test('renaming the namespace rewrites texture references inside models', async () => {
  // Leaving these behind produces a pack that loads but shows the missing texture —
  // much harder to trace than an outright failure.
  const { root, project } = await seed('oldns');
  const updated = await updateProjectInfo(root, project, { namespace: 'newns' });

  const entry = updated.entries[0];
  const model = await readFile(path.join(root, ...entry.model.output.split('/')), 'utf8');

  assert.match(model, /newns:block\/lamp/);
  assert.doesNotMatch(model, /oldns:/);
});

test('entry model paths follow the namespace', async () => {
  const { root, project } = await seed('oldns');
  const updated = await updateProjectInfo(root, project, { namespace: 'newns' });

  assert.match(updated.entries[0].model.output, /assets\/newns\//);
  assert.equal(await exists(path.join(root, ...updated.entries[0].model.output.split('/'))), true);
});

test('a similar namespace prefix is not corrupted', async () => {
  // Renaming `proj` must not touch a reference to `project`; the colon is part of the
  // search term, so `proj:` simply does not occur inside `project:`.
  const { root, project } = await seed('proj');
  const updated = await updateProjectInfo(root, project, { namespace: 'renamed' });

  const model = await readFile(
    path.join(root, ...updated.entries[0].model.output.split('/')), 'utf8',
  );
  assert.match(model, /renamed:block\/lamp/);
});

test('the project name can change on its own', async () => {
  const { root, project } = await seed();
  const updated = await updateProjectInfo(root, project, { name: 'Renamed Project' });

  assert.equal(updated.name, 'Renamed Project');
  assert.equal(updated.namespace, 'proj', 'namespace untouched');
  assert.equal((await loadProject(root)).name, 'Renamed Project');
});

test('rejects an empty name or an invalid namespace', async () => {
  const { root, project } = await seed();

  await assert.rejects(updateProjectInfo(root, project, { name: '   ' }), (e: ProjectError) => {
    assert.equal(e.code, 'INVALID_NAME');
    return true;
  });
  await assert.rejects(
    updateProjectInfo(root, project, { namespace: 'Bad NS' }),
    (e: ProjectError) => {
      assert.equal(e.code, 'INVALID_NAMESPACE');
      return true;
    },
  );
});
