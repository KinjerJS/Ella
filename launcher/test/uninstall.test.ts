import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  uninstallVersion,
  measureInstall,
  listInstalledVersionIds,
} from '../src/main/minecraft/uninstall.ts';
import { ensureAdapterInstalled } from '../src/main/adapters.ts';
import {
  setDataRoot,
  versionDir,
  nativesDir,
  instanceDir,
  librariesDir,
  assetObjectsDir,
  instanceModsDir,
} from '../src/main/paths.ts';

let workspace: string;

const exists = (target: string): Promise<boolean> =>
  stat(target).then(() => true, () => false);

async function writeFileAt(target: string, content = 'x'): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

/** Lays out a version as a real install would: version files, natives, instance, shared. */
async function seedVersion(id: string): Promise<void> {
  await writeFileAt(path.join(versionDir(id), `${id}.json`), '{}');
  await writeFileAt(path.join(versionDir(id), `${id}.jar`), 'jar');
  await writeFileAt(path.join(nativesDir(id), 'lwjgl.dll'), 'native');
  await writeFileAt(path.join(instanceDir(id), 'saves', 'MyWorld', 'level.dat'), 'world');
  await writeFileAt(path.join(instanceDir(id), 'options.txt'), 'fov:90');
  await writeFileAt(path.join(librariesDir(), 'org', 'lwjgl', 'lwjgl.jar'), 'shared');
  await writeFileAt(path.join(assetObjectsDir(), 'ab', 'abcdef'), 'asset');
}

test.beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-uninstall-'));
  setDataRoot(workspace);
});

test.afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test('removes version files and natives', async () => {
  await seedVersion('1.21.1');
  const result = await uninstallVersion('1.21.1');

  assert.equal(await exists(versionDir('1.21.1')), false);
  assert.equal(await exists(nativesDir('1.21.1')), false);
  assert.ok(result.removed.length >= 2);
});

test('never deletes shared libraries or asset objects', async () => {
  // These are deduplicated across every installed version; removing one version's
  // references would break the others.
  await seedVersion('1.21.1');
  await uninstallVersion('1.21.1');

  assert.equal(await exists(path.join(librariesDir(), 'org', 'lwjgl', 'lwjgl.jar')), true);
  assert.equal(await exists(path.join(assetObjectsDir(), 'ab', 'abcdef')), true);
});

test('keeps worlds by default and says so', async () => {
  await seedVersion('1.21.1');
  const result = await uninstallVersion('1.21.1');

  const world = path.join(instanceDir('1.21.1'), 'saves', 'MyWorld', 'level.dat');
  assert.equal(await exists(world), true, 'worlds must survive a plain uninstall');
  assert.deepEqual(result.kept, [{ path: instanceDir('1.21.1'), reason: 'user-data' }]);
});

test('deletes worlds only when explicitly asked', async () => {
  await seedVersion('1.21.1');
  await uninstallVersion('1.21.1', { removeInstanceData: true });

  assert.equal(await exists(instanceDir('1.21.1')), false);
});

test('leaves other versions untouched', async () => {
  await seedVersion('1.21.1');
  await seedVersion('1.12.2');
  await uninstallVersion('1.21.1');

  assert.equal(await exists(versionDir('1.12.2')), true);
  assert.equal(await exists(instanceDir('1.12.2')), true);
});

test('uninstalling something absent is not an error', async () => {
  const result = await uninstallVersion('1.16.5');
  assert.deepEqual(result.removed, []);
});

test('measures what would be reclaimed, separating worlds', async () => {
  await seedVersion('1.21.1');
  const footprint = await measureInstall('1.21.1');

  assert.ok(footprint.versionBytes > 0);
  assert.equal(footprint.hasInstance, true);
  assert.ok(footprint.instanceBytes > 0);
});

test('lists versions present on disk', async () => {
  await seedVersion('1.21.1');
  await seedVersion('1.12.2');
  assert.deepEqual(await listInstalledVersionIds(), ['1.12.2', '1.21.1']);
});

// ---------------------------------------------------------------------------
// Adapter presence check
// ---------------------------------------------------------------------------

test('reports unavailable for a version with no built adapter', async () => {
  const check = await ensureAdapterInstalled('1.16.5', '1.16.5');
  assert.equal(check.status, 'unavailable');
});

test('installs the adapter when the mods folder is empty', async () => {
  const check = await ensureAdapterInstalled('1.21.1', '1.21.1');
  // Depends on the adapter jar having been built; skip rather than fail if it has not.
  if (check.status === 'unavailable') return;

  assert.equal(check.status, 'installed');
  assert.equal(await exists(check.path), true);
});

test('leaves an already-current jar alone', async () => {
  const first = await ensureAdapterInstalled('1.21.1', '1.21.1');
  if (first.status === 'unavailable') return;

  const second = await ensureAdapterInstalled('1.21.1', '1.21.1');
  assert.equal(second.status, 'current');
});

test('replaces a jar whose contents differ from the build', async () => {
  // This is what makes a rebuilt adapter reach the game without a reinstall step.
  const first = await ensureAdapterInstalled('1.21.1', '1.21.1');
  if (first.status === 'unavailable') return;

  await writeFile(first.path, 'stale contents');
  const second = await ensureAdapterInstalled('1.21.1', '1.21.1');

  assert.equal(second.status, 'updated');
});

test('removes a stale Ella jar left by an older version', async () => {
  // Two jars declaring the same mod id makes Forge refuse to start, with an error that
  // does not point back here.
  const modsDirectory = instanceModsDir('1.21.1');
  await writeFileAt(path.join(modsDirectory, 'ella-forge-modern-0.0.9.jar'), 'old');

  const check = await ensureAdapterInstalled('1.21.1', '1.21.1');
  if (check.status === 'unavailable') return;

  const remaining = (await readdir(modsDirectory)).filter((n) => n.startsWith('ella-'));
  assert.equal(remaining.length, 1, `expected one Ella jar, got ${remaining.join(', ')}`);
});

test('does not touch mods the user put there', async () => {
  const modsDirectory = instanceModsDir('1.21.1');
  await writeFileAt(path.join(modsDirectory, 'jei-1.21.1.jar'), 'someone elses mod');

  const check = await ensureAdapterInstalled('1.21.1', '1.21.1');
  if (check.status === 'unavailable') return;

  assert.equal(await exists(path.join(modsDirectory, 'jei-1.21.1.jar')), true);
});
