import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_NAME, APP_VERSION } from '../src/shared/app.ts';

test('the version shown in the app is the version that was built', async () => {
  // APP_VERSION is written out rather than read from the manifest, because the renderer has
  // no filesystem. This is what stops the two drifting: a release bumps package.json, and
  // this fails until the constant follows — before a build ships a sidebar and a crash
  // report claiming the wrong build.
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { name: string; version: string };

  assert.equal(APP_VERSION, manifest.version);
});

test('the version is a version', async () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});

test('the launcher names itself the same way everywhere', () => {
  // Minecraft is told this name in its launch arguments and it appears in the window, so a
  // stray rename in one place would show up in a log nobody thinks to distrust.
  assert.equal(APP_NAME, 'Ella');
});
