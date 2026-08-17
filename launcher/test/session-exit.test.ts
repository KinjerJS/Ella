import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExit } from '../src/main/session.ts';

/*
 * Every one of these was a real misreading at some point: killing a process reports a null
 * exit code, so a `code !== 0` test treated the Stop button as a crash — an error in the
 * log and the crash dialog on screen, for an action the user asked for.
 */

test('pressing Stop is not a failure', () => {
  // Node reports a killed process as (null, 'SIGTERM'), which on its own is
  // indistinguishable from being killed by anything else.
  assert.deepEqual(classifyExit(true, null, 'SIGTERM'), { kind: 'stopped' });
});

test('a requested stop stays a stop whatever the process reports', () => {
  // Windows kills can surface as an exit code rather than a signal.
  assert.deepEqual(classifyExit(true, 1, null), { kind: 'stopped' });
  assert.deepEqual(classifyExit(true, 0, null), { kind: 'stopped' });
});

test('quitting from inside the game is silent', () => {
  assert.deepEqual(classifyExit(false, 0, null), { kind: 'quit' });
});

test('an outside kill is reported but not diagnosed', () => {
  // Nothing faulted, so there is no crash report to collect.
  assert.deepEqual(classifyExit(false, null, 'SIGKILL'), {
    kind: 'terminated',
    signal: 'SIGKILL',
  });
  assert.deepEqual(classifyExit(false, null, null), { kind: 'terminated', signal: null });
});

test('a non-zero exit is the only case worth a crash report', () => {
  assert.deepEqual(classifyExit(false, 1, null), { kind: 'failed', code: 1 });
  assert.deepEqual(classifyExit(false, 255, null), { kind: 'failed', code: 255 });
});
