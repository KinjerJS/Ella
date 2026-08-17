import test from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyProfile } from '../src/main/minecraft/forge.ts';

/*
 * The two installer generations, as they actually appear on maven.minecraftforge.net.
 *
 * Forge builds before 2018 have no `--installClient`: passing it aborts with
 * "'installClient' is not a recognized option", which is what made every 1.8.x install
 * fail while still reporting the version as installed. Those builds also predate the
 * install processors, so unpacking them directly is complete rather than a shortcut.
 *
 * The fields below are trimmed from the real profiles of forge 11.15.0.1655 (1.8.8) and
 * 14.23.5.2859 (1.12.2).
 */

const LEGACY = {
  install: {
    profileName: 'forge',
    target: '1.8.8-forge1.8.8-11.15.0.1655',
    path: 'net.minecraftforge:forge:1.8.8-11.15.0.1655',
    filePath: 'forge-1.8.8-11.15.0.1655-universal.jar',
    minecraft: '1.8.8',
  },
  versionInfo: {
    id: '1.8.8-forge1.8.8-11.15.0.1655',
    inheritsFrom: '1.8.8',
    mainClass: 'net.minecraft.launchwrapper.Launch',
    libraries: [],
  },
};

const MODERN = {
  spec: 0,
  profile: 'forge',
  version: '1.12.2-forge-14.23.5.2859',
  json: '/version.json',
  path: 'net.minecraftforge:forge:1.12.2-14.23.5.2859',
  minecraft: '1.12.2',
  data: {},
  processors: [{ jar: 'net.minecraftforge:installertools:1.1.6', args: [] }],
  libraries: [],
};

test('the pre-2018 installer layout is recognised', () => {
  assert.equal(isLegacyProfile(LEGACY), true);
});

test('a processor-driven installer is left to the official installer', () => {
  // Unpacking one of these by hand would skip the binary patching and deobfuscation, and
  // produce a version that installs cleanly then crashes on launch.
  assert.equal(isLegacyProfile(MODERN), false);
});

test('anything unreadable falls through to the installer', () => {
  assert.equal(isLegacyProfile(null), false);
  assert.equal(isLegacyProfile(undefined), false);
  assert.equal(isLegacyProfile('install_profile.json'), false);
  assert.equal(isLegacyProfile({}), false);
});

test('a half-formed legacy profile is not treated as installable', () => {
  // Every field is used during the unpack, so a missing one has to disqualify the whole
  // profile rather than fail partway through with files already written.
  assert.equal(isLegacyProfile({ install: LEGACY.install }), false);
  assert.equal(isLegacyProfile({ versionInfo: LEGACY.versionInfo }), false);
  assert.equal(
    isLegacyProfile({ install: { path: LEGACY.install.path }, versionInfo: LEGACY.versionInfo }),
    false,
    'a profile with no universal jar to file away',
  );
  assert.equal(
    isLegacyProfile({ install: LEGACY.install, versionInfo: { inheritsFrom: '1.8.8' } }),
    false,
    'a profile with no version id to install under',
  );
});
