/**
 * Export.
 *
 * The live workspace is built around slots (`ella:block_000`), which is an editing-time
 * convenience and has no place in a deliverable. Export therefore rewrites everything to
 * the project's real namespace and identifiers, and drops the `ella` namespace entirely.
 */

import { readdir, readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { EllaProject, ProjectEntry } from '../shared/project.ts';
import { packMcmeta, SLOT_NAMESPACE } from './pack.ts';

/** Locale codes as Minecraft names them. */
const MC_LOCALES: Record<string, string> = { en: 'en_us', fr: 'fr_fr' };

/** Ella render layer names to the `render_type` values Forge reads from model JSON. */
const RENDER_TYPES: Record<string, string> = {
  cutout: 'minecraft:cutout',
  cutout_mipped: 'minecraft:cutout_mipped',
  translucent: 'minecraft:translucent',
};

/**
 * Adds `render_type` to a model, leaving an existing one alone — a value the author put
 * there by hand is a deliberate choice and outranks the editor's setting.
 *
 * A model that will not parse is passed through untouched: `validateForExport` already
 * reports it, and silently rewriting broken JSON would only obscure the problem.
 */
function withRenderType(content: Buffer, renderType: string): Buffer {
  try {
    const model = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
    if (typeof model.render_type === 'string') return content;
    return Buffer.from(JSON.stringify({ ...model, render_type: renderType }, null, 2));
  } catch {
    return content;
  }
}

export interface ExportOptions {
  destination: string;
  packFormat: number;
  description?: string;
}

export interface ExportResult {
  path: string;
  fileCount: number;
  bytes: number;
}

/** Recursively lists files under `dir`, returned as paths relative to it. */
async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(dir, entry.name), relative)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

/**
 * Blockstate for a real, statically registered block. Carries both the `normal` and
 * empty-string variant keys for the same reason the workspace version does — see
 * `slotBlockstate` in pack.ts.
 */
const exportedBlockstate = (namespace: string, id: string): string => {
  const variant = { model: `${namespace}:block/${id}` };
  return JSON.stringify({ variants: { '': variant, normal: variant } }, null, 2);
};

/** Inventory model for a block, parented to its block model. */
const exportedBlockItemModel = (namespace: string, id: string): string =>
  JSON.stringify({ parent: `${namespace}:block/${id}` }, null, 2);

/**
 * Translation keys as a real mod would use them, not the slot keys.
 *
 * Emits both key conventions and both file formats, for the same reason the workspace
 * pack does: 1.12.2 reads `tile.<ns>.<id>.name` out of a `key=value` .lang file, and
 * 1.13+ reads `block.<ns>.<id>` out of JSON. An exported pack should work on whichever
 * version the author hands it to.
 */
export function exportedLangFiles(project: EllaProject): Record<string, string> {
  const files: Record<string, string> = {};

  for (const [appLocale, mcLocale] of Object.entries(MC_LOCALES)) {
    const entries: Record<string, string> = {};
    for (const entry of project.entries) {
      const name = entry.displayName[appLocale] ?? entry.displayName.en;
      const legacyPrefix = entry.kind === 'block' ? 'tile' : 'item';
      entries[`${entry.kind}.${project.namespace}.${entry.id}`] = name;
      entries[`${legacyPrefix}.${project.namespace}.${entry.id}.name`] = name;
    }

    files[`${mcLocale}.json`] = JSON.stringify(entries, null, 2);
    files[`${mcLocale}.lang`] = Object.entries(entries)
      .map(([key, value]) => `${key}=${value.replace(/\r?\n/g, ' ').trim()}`)
      .join('\n');
  }

  return files;
}

/**
 * Writes a resource pack zip containing the project's own namespace only.
 *
 * Blockstates and block item models are generated rather than copied: the workspace
 * versions point at slot redirects, which would be meaningless outside Ella.
 */
export async function exportResourcePack(
  projectRoot: string,
  project: EllaProject,
  options: ExportOptions,
): Promise<ExportResult> {
  const zip = new AdmZip();
  const namespaceRoot = path.join(projectRoot, 'pack', 'assets', project.namespace);

  zip.addFile(
    'pack.mcmeta',
    Buffer.from(packMcmeta(options.packFormat, options.description ?? `${project.name} — by Ella`)),
  );

  let fileCount = 1;

  // Which block models need a render_type injected, keyed by their file name.
  const renderTypes = new Map<string, string>();
  for (const entry of project.entries) {
    if (entry.kind !== 'block') continue;
    const mapped = RENDER_TYPES[String(entry.settings.renderLayer ?? 'solid')];
    if (mapped) renderTypes.set(`models/block/${entry.id}.json`, mapped);
  }

  // Author-created assets: models and textures.
  for (const relative of await listFiles(namespaceRoot)) {
    // Blockstates are regenerated below; never carry the slot-redirect versions across.
    if (relative.startsWith('blockstates/')) continue;

    const original = await readFile(path.join(namespaceRoot, ...relative.split('/')));

    // In the live workspace the render type lives on the slot redirect model, which is
    // not exported. Without folding it into the real model here, a transparent block
    // would render opaque for anyone who installs the pack.
    const renderType = renderTypes.get(relative);
    const content: Buffer = renderType ? withRenderType(original, renderType) : original;

    zip.addFile(`assets/${project.namespace}/${relative}`, content);
    fileCount++;
  }

  // Generated: blockstates and block inventory models.
  for (const entry of project.entries) {
    if (entry.kind !== 'block') continue;

    zip.addFile(
      `assets/${project.namespace}/blockstates/${entry.id}.json`,
      Buffer.from(exportedBlockstate(project.namespace, entry.id)),
    );
    zip.addFile(
      `assets/${project.namespace}/models/item/${entry.id}.json`,
      Buffer.from(exportedBlockItemModel(project.namespace, entry.id)),
    );
    fileCount += 2;

    // A blockstate's `model` is relative to `models/block/` before 1.13 and a full path
    // from `models/` after it, so `<ns>:block/<id>` resolves to two different files
    // depending on the version. The block model is copied to the legacy path as well so
    // one exported pack works across the range — see writeSlotNamespace in pack.ts.
    const modelSource = path.join(namespaceRoot, 'models', 'block', `${entry.id}.json`);
    const model = await readFile(modelSource).catch(() => null);
    if (model) {
      const renderType = renderTypes.get(`models/block/${entry.id}.json`);
      zip.addFile(
        `assets/${project.namespace}/models/block/block/${entry.id}.json`,
        renderType ? withRenderType(model, renderType) : model,
      );
      fileCount++;
    }
  }

  for (const [filename, content] of Object.entries(exportedLangFiles(project))) {
    zip.addFile(`assets/${project.namespace}/lang/${filename}`, Buffer.from(content));
    fileCount++;
  }

  await mkdir(path.dirname(options.destination), { recursive: true });
  zip.writeZip(options.destination);

  return {
    path: options.destination,
    fileCount,
    bytes: (await stat(options.destination)).size,
  };
}

/**
 * Sanity check run before export, surfaced in the UI as a list rather than blocking.
 *
 * These are the mistakes that produce a pack which loads without error but renders
 * wrongly — the kind that is far cheaper to catch here than in game.
 */
export interface ExportIssue {
  entryId: string;
  messageKey: string;
  severity: 'warning' | 'error';
}

export async function validateForExport(
  projectRoot: string,
  project: EllaProject,
): Promise<ExportIssue[]> {
  const issues: ExportIssue[] = [];

  for (const entry of project.entries) {
    const modelPath = path.join(projectRoot, ...entry.model.output.split('/'));
    const hasModel = await stat(modelPath).then((s) => s.isFile(), () => false);
    if (!hasModel) {
      issues.push({ entryId: entry.id, messageKey: 'export.issue.missingModel', severity: 'error' });
      continue;
    }

    try {
      const model = JSON.parse(await readFile(modelPath, 'utf8')) as {
        textures?: Record<string, string>;
      };

      for (const reference of Object.values(model.textures ?? {})) {
        // `#name` is a reference to another texture slot, not a file.
        if (reference.startsWith('#')) continue;
        const [namespace, texturePath] = reference.includes(':')
          ? reference.split(':')
          : ['minecraft', reference];
        // Only the project's own textures can be checked; vanilla ones are assumed present.
        if (namespace !== project.namespace) continue;

        const file = path.join(
          projectRoot, 'pack', 'assets', namespace, 'textures', ...texturePath.split('/'),
        );
        const exists = await stat(`${file}.png`).then((s) => s.isFile(), () => false);
        if (!exists) {
          issues.push({
            entryId: entry.id,
            messageKey: 'export.issue.missingTexture',
            severity: 'error',
          });
        }
      }
    } catch {
      issues.push({ entryId: entry.id, messageKey: 'export.issue.badModelJson', severity: 'error' });
    }
  }

  return issues;
}

/** Files under the workspace pack that export deliberately leaves out. */
export const isSlotPlumbing = (relativePath: string): boolean =>
  relativePath.includes(`/assets/${SLOT_NAMESPACE}/`) ||
  relativePath.startsWith(`assets/${SLOT_NAMESPACE}/`);

/** Convenience: derives a default output filename for a project. */
export function defaultExportName(project: EllaProject): string {
  return `${project.namespace}-resourcepack.zip`;
}

/** Shape used by the renderer when listing what an export will contain. */
export function summariseExport(project: EllaProject): {
  blocks: ProjectEntry[];
  items: ProjectEntry[];
} {
  return {
    blocks: project.entries.filter((entry) => entry.kind === 'block'),
    items: project.entries.filter((entry) => entry.kind === 'item'),
  };
}
