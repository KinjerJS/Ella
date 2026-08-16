import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  parseVersion,
  requiredJavaVersion,
  adapterFor,
  adapterCoverageFor,
  baseVersionOf,
  ADAPTERS,
  isSupported,
  isInRange,
} from '../src/shared/version.ts';

test('orders both numbering schemes against each other', () => {
  const ordered = ['1.8.9', '1.12.2', '1.16.5', '1.20.1', '1.21.1', '1.21.11', '26.1', '26.2'];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.ok(
      compareVersions(ordered[i], ordered[i + 1]) < 0,
      `expected ${ordered[i]} < ${ordered[i + 1]}`,
    );
  }
});

test('compares numerically, not lexically', () => {
  // The trap: string comparison puts "1.8.9" after "1.12.2".
  assert.ok(compareVersions('1.8.9', '1.12.2') < 0);
  assert.ok(compareVersions('1.21.11', '1.21.9') > 0);
});

test('treats a missing trailing component as zero', () => {
  assert.equal(compareVersions('1.21', '1.21.0'), 0);
  assert.ok(compareVersions('1.21', '1.21.1') < 0);
});

test('sorts a prerelease before the release it precedes', () => {
  assert.ok(compareVersions('26.3-snapshot-6', '26.3') < 0);
  assert.ok(compareVersions('26.3-snapshot-6', '26.2') > 0);
  assert.ok(compareVersions('26.3-snapshot-2', '26.3-snapshot-6') < 0);
});

test('places week snapshots between the releases they fall among', () => {
  assert.ok(compareVersions('1.21.11', '25w21a') < 0);
  assert.ok(compareVersions('25w21a', '25w43a') < 0);
  assert.ok(compareVersions('25w43a', '26.1') < 0);
});

test('sorts unknown version strings last without throwing', () => {
  assert.equal(parseVersion('garbage').kind, 'unknown');
  assert.ok(compareVersions('garbage', '1.12.2') > 0);
});

test('strips a modded suffix to find the base version', () => {
  assert.equal(baseVersionOf('1.12.2-forge-14.23.5.2859'), '1.12.2');
  assert.equal(baseVersionOf('1.21.1-forge-52.1.0'), '1.21.1');
  assert.equal(baseVersionOf('1.20.1-fabric-0.15.0'), '1.20.1');
  assert.equal(baseVersionOf('1.12.2'), '1.12.2', 'already parseable, left alone');
  assert.equal(baseVersionOf('26.2'), '26.2');
});

test('a modded version id gets the Java its base version needs', () => {
  // The failure this guards: an unparseable id sorts after every known release, so
  // "is it at least 1.20.5?" answers yes and 1.12.2 gets Java 21. Java 21 then runs
  // launchwrapper and dies with a ClassCastException nowhere near the cause.
  assert.equal(requiredJavaVersion('1.12.2-forge-14.23.5.2859'), 8);
  assert.equal(requiredJavaVersion('1.8.9-forge1.8.9-11.15.1.2318'), 8);
  assert.equal(requiredJavaVersion('1.21.1-forge-52.1.0'), 21);
  assert.equal(requiredJavaVersion('1.20.1-forge-47.4.10'), 17);
});

test('an unrecognisable version id falls back to Java 8, not the newest', () => {
  // Wrong towards 8 fails loudly at startup; wrong towards 21 fails deep inside a
  // legacy launcher with an unrelated-looking error.
  assert.equal(requiredJavaVersion('completely-unparseable'), 8);
});

test('picks the Java runtime each version actually needs', () => {
  assert.equal(requiredJavaVersion('1.8.9'), 8);
  assert.equal(requiredJavaVersion('1.12.2'), 8);
  assert.equal(requiredJavaVersion('1.16.5'), 8);
  assert.equal(requiredJavaVersion('1.17'), 16);
  assert.equal(requiredJavaVersion('1.18.2'), 17);
  assert.equal(requiredJavaVersion('1.20.1'), 17);
  assert.equal(requiredJavaVersion('1.20.5'), 21);
  assert.equal(requiredJavaVersion('1.21.1'), 21);
  assert.equal(requiredJavaVersion('26.2'), 21);
});

test('routes a version only to an adapter that is actually built', () => {
  assert.equal(adapterFor('1.12.2'), 'forge-1.12.2');
  assert.equal(adapterFor('1.21.1'), 'forge-modern');

  // Designed-for but unbuilt buckets must not be offered as working.
  assert.equal(adapterFor('1.8.9'), null);
  assert.equal(adapterFor('1.16.5'), null);
  assert.equal(adapterFor('1.20.1'), null);
});

test('a planned bucket is still reported as covering its range', () => {
  // The UI distinguishes "no adapter will ever apply" from "not built yet".
  assert.equal(adapterCoverageFor('1.16.5')?.id, 'forge-mid');
  assert.equal(adapterCoverageFor('1.16.5')?.status, 'planned');
  assert.equal(adapterCoverageFor('1.12.2')?.status, 'built');
});

test('an adapter does not claim versions it was not compiled against', () => {
  // The failure this guards: 1.21.11 is newer than 1.21.2, so the modern adapter's
  // declared range excludes it. Offering it would inject a jar Forge then refuses,
  // which is exactly what happened before this table existed.
  assert.equal(adapterFor('1.21.11'), null);
  assert.equal(adapterFor('1.21.4'), null);
  assert.equal(adapterFor('26.2'), null);
  assert.equal(adapterFor('1.20.2'), null);
});

test('adapter ranges stay numeric, not lexical', () => {
  // 1.21.11 > 1.21.2 numerically; a string compare would wrongly include it.
  assert.equal(compareVersions('1.21.11', '1.21.2') > 0, true);
});

test('rejects versions below the JSON-model floor', () => {
  assert.equal(isSupported('1.7.10'), false);
});

test('leaves gaps between buckets uncovered rather than guessing', () => {
  assert.equal(adapterCoverageFor('1.13.2'), null);
  assert.equal(adapterCoverageFor('1.14.4'), null);
});

test('every declared adapter range is well formed', () => {
  for (const entry of ADAPTERS) {
    assert.ok(
      compareVersions(entry.min, entry.max) < 0,
      `${entry.id}: min must be below max`,
    );
  }
});

test('adapter ranges do not overlap', () => {
  // Overlapping ranges would make routing depend on table order.
  for (let i = 0; i < ADAPTERS.length; i++) {
    for (let j = i + 1; j < ADAPTERS.length; j++) {
      const a = ADAPTERS[i];
      const b = ADAPTERS[j];
      const disjoint =
        compareVersions(a.max, b.min) <= 0 || compareVersions(b.max, a.min) <= 0;
      assert.ok(disjoint, `${a.id} and ${b.id} overlap`);
    }
  }
});

test('isInRange is inclusive at the bottom and exclusive at the top', () => {
  assert.equal(isInRange('1.12', '1.12', '1.13'), true);
  assert.equal(isInRange('1.12.2', '1.12', '1.13'), true);
  assert.equal(isInRange('1.13', '1.12', '1.13'), false);
  assert.equal(isInRange('26.2', '1.20.2'), true);
});
