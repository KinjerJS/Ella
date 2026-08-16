import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createProject,
  createEntry,
  readTextureInfo,
  textureRelativePath,
} from '../src/main/project.ts';
import { placeholderTexturePng } from '../src/main/pack.ts';
import { setDataRoot } from '../src/main/paths.ts';

let workspace: string;

test.beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-tex-'));
  setDataRoot(workspace);
});

test.afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** Builds a project with one block entry. */
async function seed() {
  const { project, root } = await createProject('Tex', 'tex');
  const { project: updated, entry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });
  return { root, project: updated, entry };
}

test('a new entry starts with the generated placeholder', async () => {
  const { root, project, entry } = await seed();
  const info = await readTextureInfo(root, project, entry);

  assert.equal(info.exists, true);
  assert.equal(info.isPlaceholder, true, 'must be recognised as not-yet-textured');
  assert.equal(info.width, 16);
  assert.equal(info.height, 16);
  assert.match(info.dataUri!, /^data:image\/png;base64,/);
});

test('texture path follows the entry kind', async () => {
  const { project, root } = await createProject('Kinds', 'kinds');
  const { project: withBlock, entry: block } = await createEntry(root, project, {
    id: 'stone', kind: 'block', displayName: { en: 'Stone' },
  });
  const { project: withItem, entry: item } = await createEntry(root, withBlock, {
    id: 'gem', kind: 'item', displayName: { en: 'Gem' },
  });

  assert.equal(textureRelativePath(withItem, block), 'pack/assets/kinds/textures/block/stone.png');
  assert.equal(textureRelativePath(withItem, item), 'pack/assets/kinds/textures/item/gem.png');
});

test('reports a missing texture without throwing', async () => {
  const { root, project, entry } = await seed();
  await rm(path.join(root, ...textureRelativePath(project, entry).split('/')));

  const info = await readTextureInfo(root, project, entry);
  assert.equal(info.exists, false);
  assert.equal(info.dataUri, null);
});
