import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectCrashDiagnostics, formatDiagnostics } from '../src/main/diagnostics.ts';
import { setDataRoot, instanceDir, instanceModsDir } from '../src/main/paths.ts';

let workspace: string;

test.beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-diag-'));
  setDataRoot(workspace);
});

test.afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writeCrashReport(versionId: string, content: string): Promise<void> {
  const directory = path.join(instanceDir(versionId), 'crash-reports');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'crash-2026-08-16_03.43.21-fml.txt'), content);
}

test('picks the cause out of a Forge mod-loading failure', async () => {
  await writeCrashReport(
    '1.21.1',
    [
      '---- Minecraft Crash Report ----',
      'Description: Mod loading error has occurred',
      '',
      '-- MOD ella --',
      '    Failure message: Ella (ella) has failed to load correctly',
      '        java.lang.NoSuchMethodException: dev.ella.forgemodern.EllaMod.<init>()',
    ].join('\n'),
  );

  const diagnostics = await collectCrashDiagnostics('1.21.1', 1, []);
  assert.match(diagnostics.summary, /failed to load correctly/);
  assert.ok(diagnostics.crashReport);
  assert.ok(diagnostics.crashReportPath);
});

test('falls back to an exception in the captured output', async () => {
  const diagnostics = await collectCrashDiagnostics('1.12.2', 1, [
    'some ordinary line',
    'java.lang.NoClassDefFoundError: net/minecraft/block/Block',
  ]);

  assert.match(diagnostics.summary, /NoClassDefFoundError/);
  assert.match(diagnostics.summary, /net\/minecraft\/block\/Block/);
});

test('says so plainly when there is nothing to go on', async () => {
  // Inventing a diagnosis would be worse than admitting there is none.
  const diagnostics = await collectCrashDiagnostics('1.12.2', 1, []);
  assert.match(diagnostics.summary, /exited with code 1/);
  assert.equal(diagnostics.crashReport, null);
});

test('ignores a crash report left over from an earlier run', async () => {
  await writeCrashReport('1.21.1', 'Description: An old crash');
  const stale = path.join(
    instanceDir('1.21.1'), 'crash-reports', 'crash-2026-08-16_03.43.21-fml.txt',
  );
  // Backdate it beyond the recency window.
  const { utimes } = await import('node:fs/promises');
  const old = new Date(Date.now() - 60 * 60_000);
  await utimes(stale, old, old);

  const diagnostics = await collectCrashDiagnostics('1.21.1', 1, []);
  assert.equal(diagnostics.crashReport, null, 'stale report must not be attributed to this run');
});

test('reads error lines from latest.log when no crash report exists', async () => {
  // The Forge mod-loading error screen writes here rather than a crash report.
  const logs = path.join(instanceDir('1.12.2'), 'logs');
  await mkdir(logs, { recursive: true });
  await writeFile(
    path.join(logs, 'latest.log'),
    [
      '[main/INFO]: ordinary startup line',
      '[main/ERROR]: Caused by: java.lang.RuntimeException: something broke',
      '[main/INFO]: another ordinary line',
    ].join('\n'),
  );

  const diagnostics = await collectCrashDiagnostics('1.12.2', 1, []);
  assert.ok(diagnostics.crashReport?.includes('something broke'));
  assert.match(diagnostics.summary, /something broke/);
});

test('records the environment and installed mods', async () => {
  await mkdir(instanceModsDir('1.21.1'), { recursive: true });
  await writeFile(path.join(instanceModsDir('1.21.1'), 'ella-forge-modern-0.1.0.jar'), 'x');

  const diagnostics = await collectCrashDiagnostics('1.21.1', 1, []);

  assert.deepEqual(diagnostics.mods, ['ella-forge-modern-0.1.0.jar']);
  assert.equal(diagnostics.environment['Minecraft'], '1.21.1');
  assert.equal(diagnostics.environment['Java (required)'], '21');
  assert.match(diagnostics.environment['Adapter'], /forge-modern/);
});

test('trims a very long crash report rather than returning all of it', async () => {
  const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  await writeCrashReport('1.21.1', `Description: Long one\n${long}`);

  const diagnostics = await collectCrashDiagnostics('1.21.1', 1, []);
  const lines = diagnostics.crashReport!.split('\n');

  assert.ok(lines.length < 200, `expected a trimmed report, got ${lines.length} lines`);
  assert.match(diagnostics.crashReport!, /more lines omitted/);
});

test('bounds the retained output', async () => {
  const output = Array.from({ length: 500 }, (_, i) => `out ${i}`);
  const diagnostics = await collectCrashDiagnostics('1.21.1', 1, output);

  assert.ok(diagnostics.output.length <= 80);
  // The tail is what matters: the failure is at the end, not the start.
  assert.equal(diagnostics.output.at(-1), 'out 499');
});

test('formats a report that carries everything needed to diagnose', async () => {
  await writeCrashReport('1.21.1', 'Description: Mod loading error has occurred');
  await mkdir(instanceModsDir('1.21.1'), { recursive: true });
  await writeFile(path.join(instanceModsDir('1.21.1'), 'ella.jar'), 'x');

  const text = formatDiagnostics(
    await collectCrashDiagnostics('1.21.1', 1, ['a line of output']),
  );

  assert.match(text, /Ella crash report/);
  assert.match(text, /\*\*Cause:\*\*/);
  assert.match(text, /Minecraft: 1\.21\.1/);
  assert.match(text, /ella\.jar/);
  assert.match(text, /a line of output/);
  // Fenced blocks keep logs from being mangled by the destination.
  assert.ok(text.includes('```'));
});

test('formats cleanly when there is no crash report at all', async () => {
  const text = formatDiagnostics(await collectCrashDiagnostics('1.12.2', 1, []));
  assert.match(text, /Ella crash report/);
  assert.match(text, /- none/);
});
