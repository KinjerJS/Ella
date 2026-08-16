import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { matchesRules, type OsInfo } from '../src/main/minecraft/rules.ts';
import {
  mavenToPath,
  resolveLibraries,
  mergeInherited,
} from '../src/main/minecraft/libraries.ts';
import { offlineUuid } from '../src/main/minecraft/launch.ts';
import type { VersionJson } from '../src/main/minecraft/types.ts';

const windows: OsInfo = { name: 'windows', arch: 'x86_64', version: '10.0.26200' };
const linux: OsInfo = { name: 'linux', arch: 'x86_64', version: '6.1.0' };

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

test('an absent or empty rule list allows the entry', () => {
  assert.equal(matchesRules(undefined, {}, windows), true);
  assert.equal(matchesRules([], {}, windows), true);
});

test('a rule list starts disallowed until something matches', () => {
  assert.equal(matchesRules([{ action: 'allow', os: { name: 'osx' } }], {}, windows), false);
  assert.equal(matchesRules([{ action: 'allow', os: { name: 'windows' } }], {}, windows), true);
});

test('later rules override earlier ones', () => {
  // The real shape used by Mojang: allow everywhere, then carve out one OS.
  const rules = [
    { action: 'allow' as const },
    { action: 'disallow' as const, os: { name: 'windows' } },
  ];
  assert.equal(matchesRules(rules, {}, windows), false);
  assert.equal(matchesRules(rules, {}, linux), true);
});

test('os.version is matched as a regular expression', () => {
  const rules = [{ action: 'allow' as const, os: { name: 'windows', version: '^10\\.' } }];
  assert.equal(matchesRules(rules, {}, windows), true);
  assert.equal(
    matchesRules(rules, {}, { ...windows, version: '6.1.7601' }),
    false,
  );
});

test('a malformed version pattern does not throw', () => {
  const rules = [{ action: 'allow' as const, os: { name: 'windows', version: '[unclosed' } }];
  assert.doesNotThrow(() => matchesRules(rules, {}, windows));
  assert.equal(matchesRules(rules, {}, windows), false);
});

test('feature rules match against the supplied feature set', () => {
  const rules = [
    { action: 'allow' as const, features: { has_custom_resolution: true } },
  ];
  assert.equal(matchesRules(rules, { has_custom_resolution: true }, windows), true);
  assert.equal(matchesRules(rules, {}, windows), false);
});

test('architecture is matched using Mojang naming', () => {
  const rules = [{ action: 'allow' as const, os: { arch: 'x86' } }];
  assert.equal(matchesRules(rules, {}, windows), false);
  assert.equal(matchesRules(rules, {}, { ...windows, arch: 'x86' }), true);
});

// ---------------------------------------------------------------------------
// Maven coordinates
// ---------------------------------------------------------------------------

test('converts a plain Maven coordinate to a repository path', () => {
  assert.equal(
    mavenToPath('com.google.guava:guava:21.0'),
    path.join('com', 'google', 'guava', 'guava', '21.0', 'guava-21.0.jar'),
  );
});

test('handles a classifier', () => {
  assert.equal(
    mavenToPath('org.lwjgl:lwjgl:3.3.3:natives-windows'),
    path.join('org', 'lwjgl', 'lwjgl', '3.3.3', 'lwjgl-3.3.3-natives-windows.jar'),
  );
});

test('handles the @extension suffix Forge uses', () => {
  assert.equal(
    mavenToPath('net.minecraftforge:forge:1.12.2-14.23.5.2859:universal@jar'),
    path.join(
      'net', 'minecraftforge', 'forge', '1.12.2-14.23.5.2859',
      'forge-1.12.2-14.23.5.2859-universal.jar',
    ),
  );
  assert.match(mavenToPath('de.oceanlabs.mcp:mcp_config:1.16.5@zip'), /\.zip$/);
});

test('rejects a malformed coordinate instead of producing a wrong path', () => {
  assert.throws(() => mavenToPath('not:enough'), /Malformed Maven coordinate/);
});

// ---------------------------------------------------------------------------
// Library resolution
// ---------------------------------------------------------------------------

const versionWith = (libraries: VersionJson['libraries']): VersionJson => ({
  id: 'test',
  type: 'release',
  mainClass: 'net.minecraft.client.main.Main',
  libraries,
});

test('splits natives out of the classpath', () => {
  const resolved = resolveLibraries(
    versionWith([
      {
        name: 'org.lwjgl:lwjgl:2.9.4',
        downloads: {
          artifact: { url: 'https://x/lwjgl.jar', sha1: 'a', size: 1, path: 'org/lwjgl/lwjgl.jar' },
          classifiers: {
            'natives-windows': {
              url: 'https://x/lwjgl-natives.jar',
              sha1: 'b',
              size: 2,
              path: 'org/lwjgl/lwjgl-natives-windows.jar',
            },
          },
        },
        natives: { windows: 'natives-windows', linux: 'natives-linux' },
      },
    ]),
    '/libs',
    windows,
  );

  assert.equal(resolved.classpath.length, 0);
  assert.equal(resolved.natives.length, 1);
  assert.equal(resolved.natives[0].exclude[0], 'META-INF/');
});

test('expands ${arch} in a natives classifier', () => {
  const library = {
    name: 'org.lwjgl:lwjgl:2.9.4',
    downloads: {
      classifiers: {
        'natives-windows-64': { url: 'https://x/a.jar', sha1: 'a', size: 1, path: 'a.jar' },
      },
    },
    natives: { windows: 'natives-windows-${arch}' },
  };
  assert.equal(resolveLibraries(versionWith([library]), '/libs', windows).natives.length, 1);
});

test('skips a natives entry with no download for this platform', () => {
  // Normal for libraries that only ship natives on some systems — must not fail the launch.
  const resolved = resolveLibraries(
    versionWith([
      {
        name: 'org.lwjgl:lwjgl:2.9.4',
        downloads: { classifiers: {} },
        natives: { windows: 'natives-windows' },
      },
    ]),
    '/libs',
    windows,
  );
  assert.equal(resolved.natives.length, 0);
  assert.equal(resolved.classpath.length, 0);
});

test('honours library rules', () => {
  const resolved = resolveLibraries(
    versionWith([
      { name: 'a:a:1', rules: [{ action: 'allow', os: { name: 'osx' } }] },
      { name: 'b:b:1' },
    ]),
    '/libs',
    windows,
  );
  assert.deepEqual(resolved.classpath.map((l) => l.name), ['b:b:1']);
});

test('keeps the first occurrence of a duplicated coordinate', () => {
  // Forge overrides vanilla libraries; the override must not be shadowed.
  const resolved = resolveLibraries(
    versionWith([{ name: 'a:a:1' }, { name: 'a:a:1' }]),
    '/libs',
    windows,
  );
  assert.equal(resolved.classpath.length, 1);
});

// ---------------------------------------------------------------------------
// inheritsFrom merging
// ---------------------------------------------------------------------------

test('child libraries precede parent libraries', () => {
  // Classpath order decides which class wins, so this ordering is load-bearing.
  const merged = mergeInherited(
    { ...versionWith([{ name: 'forge:forge:1' }]), inheritsFrom: 'parent' },
    versionWith([{ name: 'vanilla:vanilla:1' }]),
  );
  assert.deepEqual(merged.libraries.map((l) => l.name), ['forge:forge:1', 'vanilla:vanilla:1']);
  assert.equal(merged.inheritsFrom, undefined);
});

test('a child keeps the parent legacy argument string when it declares none', () => {
  const merged = mergeInherited(
    { ...versionWith([]), inheritsFrom: 'parent' },
    { ...versionWith([]), minecraftArguments: '--username ${auth_player_name}' },
  );
  assert.equal(merged.minecraftArguments, '--username ${auth_player_name}');
});

test('a child overrides the parent main class', () => {
  const merged = mergeInherited(
    { ...versionWith([]), mainClass: 'net.minecraftforge.fml.Loader', inheritsFrom: 'p' },
    versionWith([]),
  );
  assert.equal(merged.mainClass, 'net.minecraftforge.fml.Loader');
});

test('merging two legacy versions leaves arguments undefined', () => {
  // The trap this guards: synthesizing `{ game: [], jvm: [] }` looks harmless, but an
  // empty array is truthy, so callers conclude the file uses the modern argument format
  // and skip the legacy path that supplies `-cp`. The launch then has no classpath and
  // fails with "Could not find or load main class", far from the cause.
  const merged = mergeInherited(
    { ...versionWith([]), inheritsFrom: 'p', minecraftArguments: '--username ${auth_player_name}' },
    { ...versionWith([]), minecraftArguments: '--username ${auth_player_name}' },
  );

  assert.equal(merged.arguments, undefined);
  // The legacy argument string is what must survive the merge instead.
  assert.equal(merged.minecraftArguments, '--username ${auth_player_name}');
});

test('merging keeps modern arguments when either side has them', () => {
  const merged = mergeInherited(
    { ...versionWith([]), inheritsFrom: 'p', arguments: { jvm: ['-DchildFlag'] } },
    { ...versionWith([]), arguments: { jvm: ['-DparentFlag'], game: ['--demo'] } },
  );

  assert.deepEqual(merged.arguments?.jvm, ['-DparentFlag', '-DchildFlag']);
  assert.deepEqual(merged.arguments?.game, ['--demo']);
});

test('a child inherits the parent asset index', () => {
  const merged = mergeInherited(
    { ...versionWith([]), inheritsFrom: 'p' },
    { ...versionWith([]), assets: '1.12', assetIndex: { id: '1.12', url: 'u', sha1: 's', size: 1 } },
  );
  assert.equal(merged.assetIndex?.id, '1.12');
});

// ---------------------------------------------------------------------------
// Offline identity
// ---------------------------------------------------------------------------

test('offline uuid is a well-formed version 3 uuid', () => {
  const uuid = offlineUuid('Dev');
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(uuid[14], '3', 'version nibble');
  assert.ok(['8', '9', 'a', 'b'].includes(uuid[19]), 'RFC 4122 variant nibble');
});

test('offline uuid is stable per name and differs between names', () => {
  // Stability is what keeps player data attached to the same world across launches.
  assert.equal(offlineUuid('Dev'), offlineUuid('Dev'));
  assert.notEqual(offlineUuid('Dev'), offlineUuid('dev'));
});
