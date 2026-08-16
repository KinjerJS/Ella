import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJavaVersion, NoSuitableJavaError } from '../src/main/java-runtime.ts';

test('parses the legacy 1.x version format as its second component', () => {
  // `java version "1.8.0_371"` means Java 8, not Java 1.
  assert.deepEqual(parseJavaVersion('java version "1.8.0_371"'), {
    major: 8,
    version: '1.8.0_371',
  });
});

test('parses the modern version format as its first component', () => {
  assert.deepEqual(parseJavaVersion('openjdk version "21.0.3" 2024-04-16 LTS'), {
    major: 21,
    version: '21.0.3',
  });
  assert.equal(parseJavaVersion('openjdk version "17.0.16" 2025-07-15')?.major, 17);
});

test('handles the multi-line output real runtimes emit', () => {
  const output = [
    'openjdk version "21.0.3" 2024-04-16 LTS',
    'OpenJDK Runtime Environment Temurin-21.0.3+9 (build 21.0.3+9-LTS)',
    'OpenJDK 64-Bit Server VM Temurin-21.0.3+9 (build 21.0.3+9-LTS, mixed mode)',
  ].join('\n');
  assert.equal(parseJavaVersion(output)?.major, 21);
});

test('returns null instead of throwing on unparseable output', () => {
  assert.equal(parseJavaVersion(''), null);
  assert.equal(parseJavaVersion('command not found'), null);
  assert.equal(parseJavaVersion('version "notanumber"'), null);
});

test('NoSuitableJavaError names the version and what was found', () => {
  const error = new NoSuitableJavaError(8, '1.12.2', [17, 21]);
  assert.match(error.message, /1\.12\.2/);
  assert.match(error.message, /Java 8/);
  assert.match(error.message, /17, 21/);
  assert.equal(error.required, 8);
});

test('NoSuitableJavaError reads correctly when no runtime exists at all', () => {
  assert.match(new NoSuitableJavaError(21, '26.2', []).message, /no runtime/);
});
