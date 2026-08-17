import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import {
  placeholderTexturePng,
  slotBlockstate,
  slotRedirectModel,
  buildLangFiles,
  writeSlotNamespace,
  writeEntrySlot,
  packMcmeta,
  fallbackPackFormat,
  SLOT_NAMESPACE,
} from '../src/main/pack.ts';
import {
  createProject,
  createEntry,
  updateEntry,
  deleteEntry,
  loadProject,
  saveProject,
  ProjectError,
} from '../src/main/project.ts';
import { setDataRoot } from '../src/main/paths.ts';
import { emptyProject, nextFreeSlot, slugify, isValidIdentifier } from '../src/shared/project.ts';
import { compareVersions } from '../src/shared/version.ts';

let workspace: string;

test.before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-test-'));
  setDataRoot(workspace);
});

test.after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PNG encoder
// ---------------------------------------------------------------------------

test('placeholder texture is a structurally valid PNG', () => {
  const png = placeholderTexturePng();

  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'PNG signature',
  );

  // IHDR: 4-byte length, "IHDR", then width/height.
  assert.equal(png.readUInt32BE(8), 13, 'IHDR length');
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 16, 'width');
  assert.equal(png.readUInt32BE(20), 16, 'height');
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[25], 6, 'colour type RGBA');

  assert.ok(png.includes(Buffer.from('IDAT', 'ascii')));
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});

test('placeholder pixel data round-trips through zlib', () => {
  const png = placeholderTexturePng();

  const idatStart = png.indexOf(Buffer.from('IDAT', 'ascii'));
  const idatLength = png.readUInt32BE(idatStart - 4);
  const compressed = png.subarray(idatStart + 4, idatStart + 4 + idatLength);
  const raw = inflateSync(compressed);

  // 16 scanlines, each a filter byte plus 16 RGBA pixels.
  assert.equal(raw.length, 16 * (1 + 16 * 4));
  assert.equal(raw[0], 0, 'filter byte');
  assert.equal(raw[4], 0xff, 'first pixel alpha');
});

// ---------------------------------------------------------------------------
// Pack content
// ---------------------------------------------------------------------------

test('blockstate points at the slot redirect model', () => {
  const parsed = JSON.parse(slotBlockstate(7));
  assert.equal(parsed.variants['facing=north'].model, `${SLOT_NAMESPACE}:block/slot_007`);
});

test('blockstate covers all six facings', () => {
  // Every slot carries a facing property, because state properties are baked in at
  // registration — so the blockstate must list a variant per direction rather than the
  // single `normal` variant a property-less block would use.
  const parsed = JSON.parse(slotBlockstate(0));
  assert.deepEqual(
    Object.keys(parsed.variants).sort(),
    ['facing=down', 'facing=east', 'facing=north', 'facing=south', 'facing=up', 'facing=west'],
  );
});

test('north is unrotated so a fixed block looks exactly as authored', () => {
  const variants = JSON.parse(slotBlockstate(0)).variants;
  assert.equal(variants['facing=north'].x, undefined);
  assert.equal(variants['facing=north'].y, undefined);
});

test('facing variants apply the vanilla rotation convention', () => {
  const variants = JSON.parse(slotBlockstate(0)).variants;
  assert.equal(variants['facing=east'].y, 90);
  assert.equal(variants['facing=south'].y, 180);
  assert.equal(variants['facing=west'].y, 270);
  // Up and down turn on x, not y.
  assert.equal(variants['facing=up'].x, 270);
  assert.equal(variants['facing=down'].x, 90);
  assert.equal(variants['facing=up'].y, undefined);
});

test('every facing variant uses the same model', () => {
  const variants = JSON.parse(slotBlockstate(3)).variants;
  const models = new Set(Object.values(variants).map((v) => (v as { model: string }).model));
  assert.equal(models.size, 1);
  assert.equal([...models][0], `${SLOT_NAMESPACE}:block/slot_003`);
});

test('an unbound slot still resolves to a real model', () => {
  // Without this the game logs a missing-model error for every empty slot on each reload.
  assert.equal(JSON.parse(slotRedirectModel(null)).parent, 'block/cube_all');
  assert.equal(JSON.parse(slotRedirectModel('proj:block/lamp')).parent, 'proj:block/lamp');
});

test('pack.mcmeta carries the requested format', () => {
  assert.equal(JSON.parse(packMcmeta(34)).pack.pack_format, 34);
});

test('fallback pack format flags newer versions as uncertain', () => {
  assert.deepEqual(fallbackPackFormat('1.12.2', compareVersions), { format: 3, certain: true });
  assert.deepEqual(fallbackPackFormat('1.8.9', compareVersions), { format: 1, certain: true });
  // 26.2 is past the table, so the value is a guess and must say so.
  assert.equal(fallbackPackFormat('26.2', compareVersions).certain, false);
});

test('lang files are generated for both locales with fallback', () => {
  const project = {
    ...emptyProject('P', 'proj'),
    entries: [
      {
        id: 'lamp', kind: 'block' as const, slot: 0,
        displayName: { en: 'Ruby Lamp', fr: 'Lampe de rubis' },
        model: { source: 'json' as const, path: '', output: '' }, settings: {},
      },
      {
        id: 'gem', kind: 'item' as const, slot: 3,
        displayName: { en: 'Gem' },
        model: { source: 'json' as const, path: '', output: '' }, settings: {},
      },
    ],
  };

  const lang = buildLangFiles(project);
  const en = JSON.parse(lang['en_us.json']);
  const fr = JSON.parse(lang['fr_fr.json']);

  assert.equal(en['block.ella.block_000'], 'Ruby Lamp');
  assert.equal(fr['block.ella.block_000'], 'Lampe de rubis');
  assert.equal(fr['item.ella.item_003'], 'Gem', 'falls back to English');
});

test('lang files carry both key conventions used across the range', () => {
  // 1.12.2 looks up `tile.<ns>.<path>.name`; 1.13+ looks up `block.<ns>.<path>`.
  // Writing only one leaves half the range showing a raw translation key.
  const project = {
    ...emptyProject('P', 'proj'),
    entries: [
      {
        id: 'lamp', kind: 'block' as const, slot: 0, displayName: { en: 'Ruby Lamp' },
        model: { source: 'json' as const, path: '', output: '' }, settings: {},
      },
      {
        id: 'gem', kind: 'item' as const, slot: 1, displayName: { en: 'Gem' },
        model: { source: 'json' as const, path: '', output: '' }, settings: {},
      },
    ],
  };

  const en = JSON.parse(buildLangFiles(project)['en_us.json']);
  assert.equal(en['block.ella.block_000'], 'Ruby Lamp');
  assert.equal(en['tile.ella.block_000.name'], 'Ruby Lamp');
  assert.equal(en['item.ella.item_001'], 'Gem');
  assert.equal(en['item.ella.item_001.name'], 'Gem');
});

test('lang files are emitted in both formats', () => {
  // JSON lang files only arrived in 1.13; 1.12.2 reads `key=value` .lang files.
  const project = {
    ...emptyProject('P', 'proj'),
    entries: [{
      id: 'lamp', kind: 'block' as const, slot: 0, displayName: { en: 'Ruby Lamp' },
      model: { source: 'json' as const, path: '', output: '' }, settings: {},
    }],
  };

  const files = buildLangFiles(project);
  assert.ok(files['en_us.json'], 'modern JSON lang');
  assert.ok(files['en_us.lang'], 'legacy key=value lang');
  assert.match(files['en_us.lang'], /^tile\.ella\.block_000\.name=Ruby Lamp$/m);
});

test('unbound entries are left out of lang files', () => {
  const project = {
    ...emptyProject('P', 'proj'),
    entries: [{
      id: 'x', kind: 'block' as const, slot: null,
      displayName: { en: 'X' }, model: { source: 'json' as const, path: '', output: '' },
      settings: {},
    }],
  };
  assert.deepEqual(JSON.parse(buildLangFiles(project)['en_us.json']), {});
});

test('the block redirect model is written at both paths blockstates resolve to', async () => {
  // Before 1.13 a blockstate's `model` is relative to `models/block/`, so
  // `ella:block/slot_000` means `models/block/block/slot_000.json`. From 1.13 it is a
  // full path and means `models/block/slot_000.json`. One blockstate, two lookups.
  const root = path.join(workspace, 'dual-path');
  const project = { ...emptyProject('P', 'proj'), slotPool: { block: 1, item: 1 } };

  await writeSlotNamespace(root, project, 34);

  const modern = path.join(root, 'pack/assets/ella/models/block/slot_000.json');
  const legacy = path.join(root, 'pack/assets/ella/models/block/block/slot_000.json');

  assert.deepEqual(
    JSON.parse(await readFile(modern, 'utf8')),
    JSON.parse(await readFile(legacy, 'utf8')),
    'both copies must be identical',
  );

  // And the blockstate must reference the form that resolves to them.
  const blockstate = JSON.parse(
    await readFile(path.join(root, 'pack/assets/ella/blockstates/block_000.json'), 'utf8'),
  );
  assert.equal(blockstate.variants['facing=north'].model, 'ella:block/slot_000');
});

test('regenerating the slot namespace removes stale files', async () => {
  const root = path.join(workspace, 'stale-test');
  const project = { ...emptyProject('P', 'proj'), slotPool: { block: 2, item: 2 } };

  await writeSlotNamespace(root, project, 34);
  const blockstates = path.join(root, 'pack', 'assets', SLOT_NAMESPACE, 'blockstates');
  assert.deepEqual((await readdir(blockstates)).sort(), ['block_000.json', 'block_001.json']);

  // Shrinking the pool must not leave block_001 behind rendering a ghost block.
  await writeSlotNamespace(root, { ...project, slotPool: { block: 1, item: 1 } }, 34);
  assert.deepEqual(await readdir(blockstates), ['block_000.json']);
});

// ---------------------------------------------------------------------------
// Targeted slot writes
// ---------------------------------------------------------------------------

/**
 * A settings change takes the cheap path: one slot rewritten rather than the whole
 * namespace. These pin the two properties that makes safe — it writes the slot it was
 * given, and it leaves every other slot exactly as it was.
 */
test('writing one entry slot updates only that slot', async () => {
  const root = path.join(workspace, 'targeted');
  const base = { ...emptyProject('P', 'proj'), slotPool: { block: 3, item: 1 } };

  const project: typeof base = {
    ...base,
    entries: [
      {
        ...base.entries[0],
        id: 'lamp',
        kind: 'block',
        slot: 1,
        displayName: { en: 'Lamp' },
        settings: { renderLayer: 'solid' },
      } as (typeof base.entries)[number],
    ],
  };

  await writeSlotNamespace(root, project, 34);

  const modelAt = (slot: number): string =>
    path.join(root, `pack/assets/ella/models/block/slot_${String(slot).padStart(3, '0')}.json`);

  const untouchedBefore = await readFile(modelAt(0), 'utf8');

  const patched = {
    ...project.entries[0],
    settings: { renderLayer: 'translucent' },
  };
  const written = await writeEntrySlot(root, project, patched);

  assert.equal(written, true);
  assert.equal(
    JSON.parse(await readFile(modelAt(1), 'utf8')).render_type,
    'minecraft:translucent',
    'the entry’s own slot must pick up the new render layer',
  );
  assert.equal(
    await readFile(modelAt(0), 'utf8'),
    untouchedBefore,
    'no other slot may be rewritten',
  );

  // Both copies of a block model stay in step — the pair is what lets one blockstate
  // serve versions either side of 1.13.
  assert.equal(
    await readFile(modelAt(1), 'utf8'),
    await readFile(
      path.join(root, 'pack/assets/ella/models/block/block/slot_001.json'),
      'utf8',
    ),
  );
});

test('an unbound entry has no slot to write', async () => {
  const root = path.join(workspace, 'targeted-unbound');
  const project = { ...emptyProject('P', 'proj'), slotPool: { block: 1, item: 1 } };
  await writeSlotNamespace(root, project, 34);

  const entry = {
    id: 'floating',
    kind: 'block' as const,
    slot: null,
    displayName: { en: 'Floating' },
    settings: {},
    model: { source: 'json' as const, path: 'x.json', output: 'x.json' },
  };

  assert.equal(await writeEntrySlot(root, project, entry), false);
});

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

test('identifier validation matches resource location rules', () => {
  assert.equal(isValidIdentifier('ruby_lamp'), true);
  assert.equal(isValidIdentifier('Ruby_Lamp'), false);
  assert.equal(isValidIdentifier('ruby-lamp'), false);
  assert.equal(isValidIdentifier(''), false);
});

test('slugify strips accents rather than dropping the letters', () => {
  assert.equal(slugify('Épée dorée'), 'epee_doree');
  assert.equal(slugify('Ruby Lamp'), 'ruby_lamp');
  assert.equal(slugify('  weird--name!! '), 'weird_name');
});

// ---------------------------------------------------------------------------
// Slot allocation
// ---------------------------------------------------------------------------

test('allocates the lowest free slot and reuses freed ones', () => {
  const base = emptyProject('P', 'proj');
  const withEntries = {
    ...base,
    entries: [0, 2].map((slot) => ({
      id: `e${slot}`, kind: 'block' as const, slot,
      displayName: { en: 'E' }, model: { source: 'json' as const, path: '', output: '' },
      settings: {},
    })),
  };
  assert.equal(nextFreeSlot(withEntries, 'block'), 1);
  assert.equal(nextFreeSlot(withEntries, 'item'), 0, 'kinds have independent pools');
});

test('reports an exhausted pool instead of returning a bad slot', () => {
  const project = {
    ...emptyProject('P', 'proj'),
    slotPool: { block: 1, item: 1 },
    entries: [{
      id: 'a', kind: 'block' as const, slot: 0,
      displayName: { en: 'A' }, model: { source: 'json' as const, path: '', output: '' },
      settings: {},
    }],
  };
  assert.equal(nextFreeSlot(project, 'block'), null);
});

// ---------------------------------------------------------------------------
// Project lifecycle
// ---------------------------------------------------------------------------

test('creates a project on disk and reads it back', async () => {
  const { project, root } = await createProject('My Project', 'myproject', '1.12.2');
  assert.equal(project.namespace, 'myproject');

  const reloaded = await loadProject(root);
  assert.equal(reloaded.name, 'My Project');
  assert.equal(reloaded.targetVersion, '1.12.2');

  const mcmeta = JSON.parse(await readFile(path.join(root, 'pack', 'pack.mcmeta'), 'utf8'));
  assert.ok(mcmeta.pack.pack_format > 0);
});

test('a project written before targetVersion adopts its first old target', async () => {
  // `targetVersions` was an array nothing ever read past creation. Its first entry is the
  // version the author picked when they created the project, which is exactly what the
  // single field now means — discarding it would silently unbind every existing project.
  const { root } = await createProject('Legacy', 'legacyproj');
  const manifest = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8'));

  delete manifest.targetVersion;
  manifest.targetVersions = ['1.12.2', '1.21.1'];
  await writeFile(path.join(root, 'project.json'), JSON.stringify(manifest, null, 2), 'utf8');

  assert.equal((await loadProject(root)).targetVersion, '1.12.2');
});

test('a project with no version at all loads unbound rather than failing', async () => {
  const { root } = await createProject('Bare', 'bareproj');
  const manifest = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8'));

  delete manifest.targetVersion;
  await writeFile(path.join(root, 'project.json'), JSON.stringify(manifest, null, 2), 'utf8');

  assert.equal((await loadProject(root)).targetVersion, null);
});

test('rejects an invalid namespace', async () => {
  await assert.rejects(createProject('X', 'Bad Namespace'), (error: ProjectError) => {
    assert.equal(error.code, 'INVALID_NAMESPACE');
    return true;
  });
});

test('refuses to overwrite an existing project', async () => {
  await createProject('Dup', 'dupproject');
  await assert.rejects(createProject('Dup', 'dupproject'), (error: ProjectError) => {
    assert.equal(error.code, 'PROJECT_EXISTS');
    return true;
  });
});

test('creating an entry writes a model and a placeholder texture', async () => {
  const { project, root } = await createProject('Entries', 'entryproj');
  const { project: updated, entry } = await createEntry(root, project, {
    id: 'ruby_lamp', kind: 'block', displayName: { en: 'Ruby Lamp', fr: 'Lampe de rubis' },
  });

  assert.equal(entry.slot, 0);
  assert.equal(updated.entries.length, 1);

  const model = JSON.parse(
    await readFile(path.join(root, 'pack/assets/entryproj/models/block/ruby_lamp.json'), 'utf8'),
  );
  assert.equal(model.textures.all, 'entryproj:block/ruby_lamp');

  const texture = await readFile(path.join(root, 'pack/assets/entryproj/textures/block/ruby_lamp.png'));
  assert.equal(texture.subarray(1, 4).toString('ascii'), 'PNG');
});

test('rejects a duplicate entry id', async () => {
  const { project, root } = await createProject('Dupe', 'dupeentry');
  const { project: withOne } = await createEntry(root, project, {
    id: 'thing', kind: 'block', displayName: { en: 'Thing' },
  });
  await assert.rejects(
    createEntry(root, withOne, { id: 'thing', kind: 'block', displayName: { en: 'Thing' } }),
    (error: ProjectError) => {
      assert.equal(error.code, 'DUPLICATE_ID');
      return true;
    },
  );
});

test('reports an exhausted slot pool when creating an entry', async () => {
  const { project, root } = await createProject('Full', 'fullpool');
  const tiny = { ...project, slotPool: { block: 1, item: 1 } };
  await saveProject(root, tiny);

  const { project: withOne } = await createEntry(root, tiny, {
    id: 'a', kind: 'block', displayName: { en: 'A' },
  });
  await assert.rejects(
    createEntry(root, withOne, { id: 'b', kind: 'block', displayName: { en: 'B' } }),
    (error: ProjectError) => {
      assert.equal(error.code, 'SLOT_POOL_FULL');
      return true;
    },
  );
});

test('updating settings merges rather than replaces', async () => {
  const { project, root } = await createProject('Merge', 'mergeproj');
  const { project: withEntry } = await createEntry(root, project, {
    id: 'lamp', kind: 'block', displayName: { en: 'Lamp' },
  });

  const { entry } = await updateEntry(root, withEntry, 'lamp', {
    settings: { lightLevel: 15 },
  });

  assert.equal(entry.settings.lightLevel, 15);
  // A partial patch from the editor must not wipe fields it did not render.
  assert.equal(entry.settings.hardness, 1.5, 'untouched default survives');
  assert.equal(entry.settings.renderLayer, 'solid');
});

test('deleting an entry keeps its files unless asked otherwise', async () => {
  const { project, root } = await createProject('Del', 'delproj');
  const { project: withEntry } = await createEntry(root, project, {
    id: 'gem', kind: 'item', displayName: { en: 'Gem' },
  });

  const modelPath = path.join(root, 'pack/assets/delproj/models/item/gem.json');
  const { project: after } = await deleteEntry(root, withEntry, 'gem');
  assert.equal(after.entries.length, 0);
  // The author's model is their work; a mis-click must not destroy it.
  assert.ok(await readFile(modelPath).then(() => true, () => false), 'model still on disk');

  const { project: again } = await createEntry(root, after, {
    id: 'gem2', kind: 'item', displayName: { en: 'Gem 2' },
  });
  await deleteEntry(root, again, 'gem2', { deleteFiles: true });
  const gone = await readFile(path.join(root, 'pack/assets/delproj/models/item/gem2.json'))
    .then(() => false, () => true);
  assert.ok(gone, 'files removed when explicitly requested');
});

test('refuses a project written by a newer format version', async () => {
  const root = path.join(workspace, 'future-project');
  await saveProject(root, { ...emptyProject('Future', 'future'), formatVersion: 99 });
  await assert.rejects(loadProject(root), (error: ProjectError) => {
    assert.equal(error.code, 'PROJECT_TOO_NEW');
    return true;
  });
});
