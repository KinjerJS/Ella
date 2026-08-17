import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, type AdapterId } from '../src/shared/version.ts';

/*
 * Keeps ADAPTERS in step with what each adapter tells its own loader.
 *
 * The README claims this table prevents the launcher offering a version the game then
 * refuses the mod on. It did not: widening the 1.8 bucket to 1.8.8 left the mod still
 * declaring 1.8.9 to FML, and the game rejected it with "Ella (ella) wants Minecraft
 * [1.8.9,1.8.9]" on a version the launcher had just advertised as live-editable. Nothing
 * in the build could catch that, because the two facts live in different languages in
 * different directories.
 *
 * Read as text rather than parsed: these are Java and TOML, and a regex over a line that
 * has to be written literally anyway is enough to notice it changing.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where each built adapter states the range it accepts, and how to find it in the file. */
const DECLARATIONS: Record<string, { file: string; pattern: RegExp }> = {
  'forge-1.8.9': {
    file: 'mod/adapters/forge-1.8.9/src/main/java/dev/ella/forge189/EllaMod.java',
    pattern: /acceptedMinecraftVersions\s*=\s*"([^"]+)"/,
  },
  'forge-1.12.2': {
    file: 'mod/adapters/forge-1.12.2/src/main/java/dev/ella/forge112/EllaMod.java',
    pattern: /acceptedMinecraftVersions\s*=\s*"([^"]+)"/,
  },
  'forge-modern': {
    file: 'mod/adapters/forge-modern/src/main/resources/META-INF/mods.toml',
    // The minecraft dependency's range, not the loader's.
    pattern: /versionRange\s*=\s*"(\[1\.[^"]+)"/,
  },
};

/** ADAPTERS uses an inclusive minimum and an exclusive maximum, which is Maven's `[a,b)`. */
const expectedRange = (min: string, max: string): string => `[${min},${max})`;

for (const coverage of ADAPTERS.filter((entry) => entry.status === 'built')) {
  test(`${coverage.id} declares the range the launcher advertises`, async () => {
    const declaration = DECLARATIONS[coverage.id as AdapterId];
    assert.ok(declaration, `no declaration site recorded for ${coverage.id}`);

    const source = await readFile(path.join(repoRoot, declaration.file), 'utf8');
    const match = declaration.pattern.exec(source);

    assert.ok(
      match,
      `${declaration.file} states no accepted Minecraft range, so the loader will infer ` +
        'one from the exact version and refuse everything else in the bucket',
    );

    assert.equal(
      match[1],
      expectedRange(coverage.min, coverage.max),
      `${coverage.id} accepts ${match[1]} but the launcher offers ` +
        `${expectedRange(coverage.min, coverage.max)}`,
    );
  });
}

test('every built adapter has a declaration site to check', () => {
  // A new adapter must not pass this file silently by being absent from it.
  for (const coverage of ADAPTERS.filter((entry) => entry.status === 'built')) {
    assert.ok(
      coverage.id in DECLARATIONS,
      `${coverage.id} is built but this test does not know where it declares its range`,
    );
  }
});
