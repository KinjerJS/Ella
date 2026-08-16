import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createProject,
  createEntry,
  deleteProject,
  measureProject,
  loadProject,
  ProjectError,
} from '../src/main/project.ts';
import { setDataRoot, projectsDir } from '../src/main/paths.ts';

let workspace: string;

const exists = (target: string): Promise<boolean> =>
  stat(target).then(() => true, () => false);

test.beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-projdel-'));
  setDataRoot(workspace);
});

test.afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test('deletes a project directory entirely', async () => {
  const { root } = await createProject('Gone', 'gone');
  assert.equal(await exists(root), true);

  await deleteProject(root);
  assert.equal(await exists(root), false);
});

test('refuses a path outside the projects directory', async () => {
  // This function deletes recursively; a caller mistake must not reach arbitrary files.
  const outside = path.join(workspace, 'not-a-project');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'important.txt'), 'do not delete');

  await assert.rejects(deleteProject(outside), (error: ProjectError) => {
    assert.equal(error.code, 'PROJECT_OUTSIDE_ROOT');
    return true;
  });
  assert.equal(await exists(path.join(outside, 'important.txt')), true);
});

test('refuses to delete the projects directory itself', async () => {
  await assert.rejects(deleteProject(projectsDir()), (error: ProjectError) => {
    assert.equal(error.code, 'PROJECT_OUTSIDE_ROOT');
    return true;
  });
});

test('refuses a directory that is not a project', async () => {
  const stray = path.join(projectsDir(), 'stray');
  await mkdir(stray, { recursive: true });
  await writeFile(path.join(stray, 'notes.txt'), 'personal notes');

  // No project.json means this is not ours to delete, whatever it is doing there.
  await assert.rejects(deleteProject(stray));
  assert.equal(await exists(path.join(stray, 'notes.txt')), true);
});

test('leaves other projects untouched', async () => {
  const { root: first } = await createProject('First', 'first');
  const { root: second } = await createProject('Second', 'second');

  await deleteProject(first);

  assert.equal(await exists(first), false);
  assert.equal(await exists(second), true);
  assert.equal((await loadProject(second)).name, 'Second');
});

test('measures authored work, not generated plumbing', async () => {
  const { project, root } = await createProject('Measured', 'measured');
  const { project: withOne } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });
  await createEntry(root, withOne, {
    id: 'gem', kind: 'item', displayName: { en: 'Gem' },
  });

  const footprint = await measureProject(root, {
    ...withOne,
    entries: [...withOne.entries],
  });

  assert.equal(footprint.entryCount, 1);
  assert.ok(footprint.bytes > 0);
  // Two files per entry (model + texture) under the project's own namespace; the ~512
  // generated slot files must not be counted as the author's work.
  assert.ok(footprint.authoredFiles > 0, 'authored files counted');
  assert.ok(footprint.authoredFiles < 20, `expected a small count, got ${footprint.authoredFiles}`);
});

test('a deleted project no longer loads', async () => {
  const { root } = await createProject('Temp', 'temp');
  await deleteProject(root);
  await assert.rejects(loadProject(root));
});
