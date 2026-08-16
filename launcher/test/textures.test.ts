import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  listTextures,
  addTexture,
  removeTexture,
  setParticleTexture,
  importTextureFor,
  resolveReference,
  PARTICLE_KEY,
} from '../src/main/textures.ts';
import { createProject, createEntry, writeProjectFile, ProjectError } from '../src/main/project.ts';
import { placeholderTexturePng } from '../src/main/pack.ts';
import { setDataRoot } from '../src/main/paths.ts';
import type { EllaProject, ProjectEntry } from '../src/shared/project.ts';

let workspace: string;

const exists = (target: string): Promise<boolean> =>
  stat(target).then(() => true, () => false);

test.beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-tex2-'));
  setDataRoot(workspace);
});

test.afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** A project with one block whose model has a custom shape and named textures. */
async function seed(model?: unknown): Promise<{
  root: string;
  project: EllaProject;
  entry: ProjectEntry;
}> {
  const { project, root } = await createProject('P', 'proj');
  const { project: updated, entry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  if (model) {
    await writeProjectFile(root, entry.model.output, JSON.stringify(model, null, 2));
  }
  return { root, project: updated, entry };
}

test('lists the model texture variables with previews', async () => {
  const { root, project, entry } = await seed();
  const textures = await listTextures(root, project, entry);

  assert.equal(textures.length, 1);
  assert.equal(textures[0].key, 'all');
  assert.equal(textures[0].reference, 'proj:block/lamp');
  assert.equal(textures[0].exists, true);
  assert.equal(textures[0].width, 16);
});

test('reports which faces use each variable', async () => {
  const { root, project, entry } = await seed({
    textures: { '0': 'proj:block/lamp' },
    elements: [
      { from: [0, 0, 0], to: [16, 16, 16],
        faces: { north: { texture: '#0' }, south: { texture: '#0' } } },
    ],
  });

  const textures = await listTextures(root, project, entry);
  assert.deepEqual(textures[0].usedByFaces, ['north', 'south']);
});

test('a variable used by no face is reported as unused', async () => {
  const { root, project, entry } = await seed({
    textures: { spare: 'proj:block/lamp' },
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }],
  });

  assert.deepEqual((await listTextures(root, project, entry))[0].usedByFaces, []);
});

test('adding a variable creates a placeholder file', async () => {
  // A variable pointing at a missing file makes the whole model fail to load, so the
  // placeholder is not a nicety.
  const { root, project, entry } = await seed();
  const textures = await addTexture(root, project, entry, 'side');

  const added = textures.find((texture) => texture.key === 'side')!;
  assert.equal(added.reference, 'proj:block/lamp_side');
  assert.equal(added.exists, true);
  assert.equal(await exists(path.join(root, ...added.relativePath!.split('/'))), true);
});

test('the added variable is written into the model', async () => {
  const { root, project, entry } = await seed();
  await addTexture(root, project, entry, 'side');

  const model = JSON.parse(
    await readFile(path.join(root, ...entry.model.output.split('/')), 'utf8'),
  );
  assert.equal(model.textures.side, 'proj:block/lamp_side');
  assert.equal(model.textures.all, 'proj:block/lamp', 'existing variables survive');
});

test('rejects an invalid or duplicate variable name', async () => {
  const { root, project, entry } = await seed();

  await assert.rejects(addTexture(root, project, entry, 'Bad Name'), (e: ProjectError) => {
    assert.equal(e.code, 'INVALID_TEXTURE_KEY');
    return true;
  });
  await assert.rejects(addTexture(root, project, entry, 'all'), (e: ProjectError) => {
    assert.equal(e.code, 'DUPLICATE_TEXTURE_KEY');
    return true;
  });
});

test('removing a variable keeps its image by default', async () => {
  // The variable is one line of JSON to restore; the artwork is not.
  const { root, project, entry } = await seed();
  const before = (await listTextures(root, project, entry))[0];

  const { textures } = await removeTexture(root, project, entry, 'all');

  assert.equal(textures.length, 0);
  assert.equal(await exists(path.join(root, ...before.relativePath!.split('/'))), true);
});

test('removing a variable can delete its image when asked', async () => {
  const { root, project, entry } = await seed();
  const before = (await listTextures(root, project, entry))[0];

  await removeTexture(root, project, entry, 'all', { deleteFile: true });
  assert.equal(await exists(path.join(root, ...before.relativePath!.split('/'))), false);
});

test('a shared image survives removing one of the variables pointing at it', async () => {
  const { root, project, entry } = await seed({
    textures: { a: 'proj:block/lamp', b: 'proj:block/lamp' },
  });

  await removeTexture(root, project, entry, 'a', { deleteFile: true });
  assert.equal(await exists(path.join(root, 'pack/assets/proj/textures/block/lamp.png')), true);
});

test('removal reports faces left pointing at nothing', async () => {
  // Those faces make the model fail to load, so the caller has to be able to say so.
  const { root, project, entry } = await seed({
    textures: { '0': 'proj:block/lamp' },
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#0' } } }],
  });

  const { orphanedFaces } = await removeTexture(root, project, entry, '0');
  assert.deepEqual(orphanedFaces, ['up']);
});

test('setting the particle texture points the particle variable at the same file', async () => {
  const { root, project, entry } = await seed();
  const textures = await setParticleTexture(root, project, entry, 'all');

  const drawable = textures.find((texture) => texture.key === 'all')!;
  assert.equal(drawable.isParticle, true);

  const particle = textures.find((texture) => texture.key === PARTICLE_KEY)!;
  assert.equal(particle.reference, 'proj:block/lamp');
  assert.equal(particle.isParticleSlot, true);
});

test('the particle variable can be cleared', async () => {
  const { root, project, entry } = await seed();
  await setParticleTexture(root, project, entry, 'all');
  const textures = await setParticleTexture(root, project, entry, null);

  assert.equal(textures.some((texture) => texture.isParticleSlot), false);
});

test('removing a variable also drops a particle entry pointing at it', async () => {
  // Otherwise particle outlives the file it referenced.
  const { root, project, entry } = await seed();
  await setParticleTexture(root, project, entry, 'all');

  const { textures } = await removeTexture(root, project, entry, 'all');
  assert.equal(textures.length, 0);
});

test('setting particles on an unknown variable is refused', async () => {
  const { root, project, entry } = await seed();
  await assert.rejects(
    setParticleTexture(root, project, entry, 'nope'),
    (e: ProjectError) => {
      assert.equal(e.code, 'UNKNOWN_TEXTURE_KEY');
      return true;
    },
  );
});

test('importing replaces the file a variable points at', async () => {
  const { root, project, entry } = await seed();

  const different = placeholderTexturePng();
  different[different.length - 12] ^= 0xff;
  const source = path.join(workspace, 'custom.png');
  await writeFile(source, different);

  const textures = await importTextureFor(root, project, entry, 'all', source);
  const onDisk = await readFile(path.join(root, ...textures[0].relativePath!.split('/')));

  assert.deepEqual(onDisk, different);
});

test('importing rejects a file that is not a PNG', async () => {
  const { root, project, entry } = await seed();
  const source = path.join(workspace, 'nope.png');
  await writeFile(source, 'plain text');

  await assert.rejects(
    importTextureFor(root, project, entry, 'all', source),
    (e: ProjectError) => {
      assert.equal(e.code, 'NOT_A_PNG');
      return true;
    },
  );
});

test('references outside the project are listed but not managed', async () => {
  // `minecraft:block/stone` is valid in a model; there is simply no file here to touch.
  const { root, project, entry } = await seed({
    textures: { all: 'minecraft:block/stone' },
  });

  const textures = await listTextures(root, project, entry);
  assert.equal(textures[0].relativePath, null);
  assert.equal(textures[0].exists, false);

  await assert.rejects(
    importTextureFor(root, project, entry, 'all', path.join(workspace, 'x.png')),
    (e: ProjectError) => {
      assert.equal(e.code, 'EXTERNAL_TEXTURE');
      return true;
    },
  );
});

test('resolveReference maps a project reference to its file', () => {
  const project = { namespace: 'proj' } as EllaProject;
  assert.equal(resolveReference(project, 'proj:block/lamp'), 'pack/assets/proj/textures/block/lamp.png');
  assert.equal(resolveReference(project, 'minecraft:block/stone'), null);
  assert.equal(resolveReference(project, '#other'), null, 'an alias is not a file');
});

test('a malformed model is refused rather than overwritten', async () => {
  const { root, project, entry } = await seed();
  await writeProjectFile(root, entry.model.output, '{ not json');

  await assert.rejects(addTexture(root, project, entry, 'side'), (e: ProjectError) => {
    assert.equal(e.code, 'BAD_MODEL_JSON');
    return true;
  });

  // The broken file is left exactly as it was, for the author to fix.
  assert.equal(
    await readFile(path.join(root, ...entry.model.output.split('/')), 'utf8'),
    '{ not json',
  );
});
