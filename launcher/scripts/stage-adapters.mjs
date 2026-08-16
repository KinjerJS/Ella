/**
 * Stages the built adapter jars into `resources/adapters/` for packaging.
 *
 * The launcher looks for adapters under `process.resourcesPath/adapters/<adapter-id>/` in
 * a packaged build, and in each adapter's Gradle output during development. Packaging has
 * to bridge the two, and it has to be a separate step from `electron-builder` itself
 * because the jars come from a toolchain electron-builder knows nothing about.
 *
 * Adapters are discovered by scanning `mod/adapters/` rather than from a list kept here,
 * so adding a version bucket never means remembering to update the packaging script.
 *
 * The jar keeps its real filename (`ella-forge-1.12.2-0.1.0.jar`). The injector deletes
 * stale jars by matching `ella-*.jar`, so renaming them to the adapter id would quietly
 * break the cleanup and let two Ella mods land in one instance.
 */

import { readdir, mkdir, copyFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(launcherRoot, '..');
const adaptersSource = path.join(repoRoot, 'mod', 'adapters');
const stagingRoot = path.join(launcherRoot, 'resources', 'adapters');

/** Same exclusions as the runtime lookup: dev jars are deobfuscated and will not load. */
function selectJar(names) {
  const candidates = names
    .filter((name) => name.endsWith('.jar'))
    .filter((name) => !name.endsWith('-dev.jar'))
    .filter((name) => !name.endsWith('-sources.jar'))
    .sort();
  return candidates.at(-1) ?? null;
}

async function listDirectories(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function main() {
  const adapters = await listDirectories(adaptersSource);
  if (adapters.length === 0) {
    console.error(`No adapters found under ${adaptersSource}`);
    process.exit(1);
  }

  // Start from empty so a jar removed upstream cannot survive into the installer.
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  const staged = [];
  const missing = [];

  for (const adapter of adapters) {
    const libs = path.join(adaptersSource, adapter, 'build', 'libs');

    let names;
    try {
      names = await readdir(libs);
    } catch {
      missing.push(adapter);
      continue;
    }

    const jar = selectJar(names);
    if (!jar) {
      missing.push(adapter);
      continue;
    }

    const destination = path.join(stagingRoot, adapter);
    await mkdir(destination, { recursive: true });
    await copyFile(path.join(libs, jar), path.join(destination, jar));

    const { size } = await stat(path.join(destination, jar));
    staged.push({ adapter, jar, size });
  }

  for (const { adapter, jar, size } of staged) {
    console.log(`staged  ${adapter.padEnd(16)} ${jar} (${Math.round(size / 1024)} KB)`);
  }
  for (const adapter of missing) {
    console.log(`skipped ${adapter.padEnd(16)} not built — the installer will report it as unavailable`);
  }

  // An installer with no adapters at all still launches Minecraft, but silently loses the
  // feature the tool exists for. That is worth failing the build over.
  if (staged.length === 0) {
    console.error('\nNo adapter jars were staged. Build at least one adapter first:');
    console.error('  cd mod/adapters/forge-1.12.2 && ./gradlew build');
    process.exit(1);
  }
}

await main();
