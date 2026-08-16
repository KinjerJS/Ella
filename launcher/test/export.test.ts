import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  exportResourcePack,
  exportedLangFiles,
  validateForExport,
  defaultExportName,
} from '../src/main/export.ts';
import { emptyProject, type EllaProject, type ProjectEntry } from '../src/shared/project.ts';
import { defaultsFor } from '../src/shared/settings-schema.ts';

let workspace: string;

test.before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'ella-export-'));
});

test.after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function entry(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  const id = overrides.id ?? 'lamp';
  const kind = overrides.kind ?? 'block';
  return {
    id,
    kind,
    displayName: { en: 'Lamp', fr: 'Lampe' },
    slot: 0,
    model: {
      source: 'json',
      path: `pack/assets/proj/models/${kind}/${id}.json`,
      output: `pack/assets/proj/models/${kind}/${id}.json`,
    },
    settings: defaultsFor(kind),
    ...overrides,
  };
}

/** Builds a project directory on disk with the given entries and model contents. */
async function makeProject(
  name: string,
  entries: ProjectEntry[],
  models: Record<string, unknown> = {},
): Promise<{ root: string; project: EllaProject }> {
  const root = path.join(workspace, name);
  const project: EllaProject = { ...emptyProject(name, 'proj'), entries };

  for (const item of entries) {
    const modelPath = path.join(root, ...item.model.output.split('/'));
    await mkdir(path.dirname(modelPath), { recursive: true });
    await writeFile(
      modelPath,
      JSON.stringify(
        models[item.id] ?? { parent: 'block/cube_all', textures: { all: `proj:block/${item.id}` } },
      ),
    );

    const texturePath = path.join(
      root, 'pack', 'assets', 'proj', 'textures', item.kind, `${item.id}.png`,
    );
    await mkdir(path.dirname(texturePath), { recursive: true });
    await writeFile(texturePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }

  return { root, project };
}

const readZip = (file: string): AdmZip => new AdmZip(file);

const zipText = (zip: AdmZip, name: string): string | null => {
  const found = zip.getEntry(name);
  return found ? found.getData().toString('utf8') : null;
};

test('exports a resource pack containing only the project namespace', async () => {
  const { root, project } = await makeProject('basic', [entry()]);
  const destination = path.join(workspace, 'basic.zip');

  const result = await exportResourcePack(root, project, { destination, packFormat: 34 });
  const zip = readZip(result.path);
  const names = zip.getEntries().map((e) => e.entryName);

  assert.ok(names.includes('pack.mcmeta'));
  assert.ok(names.includes('assets/proj/models/block/lamp.json'));
  assert.ok(names.includes('assets/proj/blockstates/lamp.json'));
  // The slot plumbing is an editing-time convenience and must never ship.
  assert.equal(names.some((name) => name.includes('/ella/')), false);
});

test('generated blockstate points at the real model, not a slot redirect', async () => {
  const { root, project } = await makeProject('states', [entry()]);
  const destination = path.join(workspace, 'states.zip');

  await exportResourcePack(root, project, { destination, packFormat: 34 });
  const blockstate = JSON.parse(zipText(readZip(destination), 'assets/proj/blockstates/lamp.json')!);

  assert.equal(blockstate.variants[''].model, 'proj:block/lamp');
  assert.deepEqual(Object.keys(blockstate.variants).sort(), ['', 'normal']);
});

test('folds the render type into the exported block model', async () => {
  // In the workspace the render type lives on the slot redirect, which is not exported;
  // without this the block would render opaque for anyone installing the pack.
  const { root, project } = await makeProject('cutout', [
    entry({ settings: { ...defaultsFor('block'), renderLayer: 'cutout', opaque: false } }),
  ]);
  const destination = path.join(workspace, 'cutout.zip');

  await exportResourcePack(root, project, { destination, packFormat: 34 });
  const model = JSON.parse(zipText(readZip(destination), 'assets/proj/models/block/lamp.json')!);

  assert.equal(model.render_type, 'minecraft:cutout');
  assert.equal(model.parent, 'block/cube_all', 'existing keys survive');
});

test('a solid block gets no render_type', async () => {
  const { root, project } = await makeProject('solid', [entry()]);
  const destination = path.join(workspace, 'solid.zip');

  await exportResourcePack(root, project, { destination, packFormat: 34 });
  const model = JSON.parse(zipText(readZip(destination), 'assets/proj/models/block/lamp.json')!);

  assert.equal(model.render_type, undefined);
});

test('a hand-written render_type is left alone', async () => {
  const { root, project } = await makeProject(
    'manual',
    [entry({ settings: { ...defaultsFor('block'), renderLayer: 'cutout' } })],
    { lamp: { parent: 'block/cube_all', render_type: 'minecraft:translucent' } },
  );
  const destination = path.join(workspace, 'manual.zip');

  await exportResourcePack(root, project, { destination, packFormat: 34 });
  const model = JSON.parse(zipText(readZip(destination), 'assets/proj/models/block/lamp.json')!);

  assert.equal(model.render_type, 'minecraft:translucent', 'author choice wins');
});

test('lang files use real registry keys, not slot keys', async () => {
  const project = { ...emptyProject('L', 'proj'), entries: [entry()] };
  const lang = exportedLangFiles(project);

  assert.equal(JSON.parse(lang['en_us.json'])['block.proj.lamp'], 'Lamp');
  assert.equal(JSON.parse(lang['fr_fr.json'])['block.proj.lamp'], 'Lampe');
  assert.equal(JSON.parse(lang['en_us.json'])['block.ella.block_000'], undefined);

  // An exported pack should work whichever version it is handed to.
  assert.match(lang['en_us.lang'], /^tile\.proj\.lamp\.name=Lamp$/m);
});

test('unbound entries are still exported', async () => {
  // Slots are a runtime concern; an entry with no slot is still part of the project.
  const { root, project } = await makeProject('unbound', [entry({ slot: null })]);
  const destination = path.join(workspace, 'unbound.zip');

  await exportResourcePack(root, project, { destination, packFormat: 34 });
  assert.ok(readZip(destination).getEntry('assets/proj/models/block/lamp.json'));
});

test('validation reports a missing model as an error', async () => {
  const root = path.join(workspace, 'missing');
  await mkdir(root, { recursive: true });
  const project = { ...emptyProject('M', 'proj'), entries: [entry()] };

  const issues = await validateForExport(root, project);
  assert.equal(issues[0].severity, 'error');
  assert.equal(issues[0].messageKey, 'export.issue.missingModel');
});

test('validation reports a missing texture', async () => {
  const { root, project } = await makeProject('notex', [entry()], {
    lamp: { parent: 'block/cube_all', textures: { all: 'proj:block/nonexistent' } },
  });

  const issues = await validateForExport(root, project);
  assert.ok(issues.some((issue) => issue.messageKey === 'export.issue.missingTexture'));
});

test('validation ignores vanilla texture references', async () => {
  // Only the project's own textures can be checked; vanilla ones are assumed present.
  const { root, project } = await makeProject('vanilla', [entry()], {
    lamp: { parent: 'block/cube_all', textures: { all: 'minecraft:block/stone' } },
  });

  assert.deepEqual(await validateForExport(root, project), []);
});

test('validation ignores #references between texture slots', async () => {
  const { root, project } = await makeProject('refs', [entry()], {
    lamp: { parent: 'block/cube_all', textures: { all: '#side', side: 'proj:block/lamp' } },
  });

  assert.deepEqual(await validateForExport(root, project), []);
});

test('validation reports unparseable model JSON', async () => {
  const { root, project } = await makeProject('broken', [entry()]);
  await writeFile(path.join(root, 'pack/assets/proj/models/block/lamp.json'), '{ not json');

  const issues = await validateForExport(root, project);
  assert.equal(issues[0].messageKey, 'export.issue.badModelJson');
});

test('default export name is derived from the namespace', () => {
  assert.equal(defaultExportName(emptyProject('P', 'myproj')), 'myproj-resourcepack.zip');
});
