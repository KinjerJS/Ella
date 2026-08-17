/**
 * Resource pack generation.
 *
 * ## How a slot finds its model
 *
 * The mod registers fixed placeholder blocks (`ella:block_000`…), so vanilla resource
 * loading always looks for `assets/ella/blockstates/block_000.json` and the model it
 * names. Rather than teaching each adapter a custom model loader — version-specific work
 * repeated four times — Ella writes a one-line **redirect model**:
 *
 *   assets/ella/blockstates/block_000.json  -> model "ella:block/slot_000"
 *   assets/ella/models/block/slot_000.json  -> { "parent": "myproject:block/ruby_lamp" }
 *   assets/myproject/models/block/ruby_lamp.json  <- the author's real model
 *
 * Rebinding a slot rewrites one small file and triggers a resource reload. This goes
 * through nothing but vanilla resource resolution, so it behaves identically from 1.8.9
 * to 26.2, and export simply drops the `ella` namespace.
 */

import { writeFile, mkdir, rm } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import type { EntryKind, LocaleMap } from '../shared/protocol.ts';
import type { EllaProject, ProjectEntry } from '../shared/project.ts';

/** Namespace holding the slot plumbing. Never part of an export. */
export const SLOT_NAMESPACE = 'ella';

/**
 * Fallback pack_format values, used only when no game is connected to report the real
 * one. Verified against the versions listed; anything newer falls back to the highest
 * known value, which the UI flags rather than presenting as certain.
 */
const PACK_FORMATS: Array<{ min: string; format: number }> = [
  { min: '1.21', format: 34 },
  { min: '1.20.5', format: 32 },
  { min: '1.20.3', format: 22 },
  { min: '1.20.2', format: 18 },
  { min: '1.20', format: 15 },
  { min: '1.19.4', format: 13 },
  { min: '1.19.3', format: 12 },
  { min: '1.19', format: 9 },
  { min: '1.18', format: 8 },
  { min: '1.17', format: 7 },
  { min: '1.16.2', format: 6 },
  { min: '1.15', format: 5 },
  { min: '1.13', format: 4 },
  { min: '1.11', format: 3 },
  { min: '1.9', format: 2 },
  { min: '1.8', format: 1 },
];

export const HIGHEST_KNOWN_PACK_FORMAT = 34;

export function fallbackPackFormat(mcVersion: string, compare: (a: string, b: string) => number):
  { format: number; certain: boolean } {
  for (const entry of PACK_FORMATS) {
    if (compare(mcVersion, entry.min) >= 0) {
      return { format: entry.format, certain: entry.format !== HIGHEST_KNOWN_PACK_FORMAT };
    }
  }
  return { format: 1, certain: false };
}

const slotName = (kind: EntryKind, slot: number): string =>
  `${kind}_${String(slot).padStart(3, '0')}`;

const slotModelName = (slot: number): string => `slot_${String(slot).padStart(3, '0')}`;

// ---------------------------------------------------------------------------
// File content
// ---------------------------------------------------------------------------

export const packMcmeta = (format: number, description = 'Ella live workspace'): string =>
  JSON.stringify({ pack: { pack_format: format, description } }, null, 2);

/**
 * Model rotation per facing direction, matching vanilla's convention: a model is authored
 * facing north, and the blockstate turns it.
 *
 * `up` and `down` use an x rotation; the horizontal directions use y.
 */
const FACING_ROTATION: Record<string, { x?: number; y?: number }> = {
  north: {},
  east: { y: 90 },
  south: { y: 180 },
  west: { y: 270 },
  up: { x: 270 },
  down: { x: 90 },
};

/**
 * Blockstate for a slot.
 *
 * Every slot carries a `facing` property, because state properties are baked in at
 * registration and a slot that might later need rotation must have it from the start.
 * That means the blockstate lists one variant per direction rather than the single
 * `normal` variant a property-less block would use — with `facing=north` unrotated, so a
 * block whose rotation is off looks exactly as authored.
 */
export const slotBlockstate = (slot: number): string => {
  const model = `${SLOT_NAMESPACE}:block/${slotModelName(slot)}`;
  const variants: Record<string, Record<string, unknown>> = {};

  for (const [facing, rotation] of Object.entries(FACING_ROTATION)) {
    variants[`facing=${facing}`] = { model, ...rotation };
  }

  return JSON.stringify({ variants }, null, 2);
};

/**
 * Maps Ella's render layer names onto the `render_type` values Forge reads from model
 * JSON. `solid` is omitted because it is the default and writing it adds nothing.
 */
const RENDER_TYPES: Record<string, string> = {
  cutout: 'minecraft:cutout',
  cutout_mipped: 'minecraft:cutout_mipped',
  translucent: 'minecraft:translucent',
};

/**
 * Redirect model. Unbound slots fall back to a plain cube so the block stays visible.
 *
 * From 1.19 onwards Forge reads `render_type` straight out of the model, which makes the
 * render layer a pure resource-pack concern: changing it needs only a file rewrite and a
 * reload, with no game-side call at all. Older versions ignore the unknown key and get
 * their layer from the block's own override instead, so writing it unconditionally is
 * safe and keeps one code path for the whole range.
 */
export const slotRedirectModel = (target: string | null, renderLayer?: string): string => {
  const model: Record<string, string> = { parent: target ?? 'block/cube_all' };
  const renderType = renderLayer ? RENDER_TYPES[renderLayer] : undefined;
  if (renderType) model.render_type = renderType;
  return JSON.stringify(model, null, 2);
};

/** Item model for a block slot, so it renders in the inventory and in hand. */
export const blockItemModel = (slot: number): string =>
  JSON.stringify({ parent: `${SLOT_NAMESPACE}:block/${slotModelName(slot)}` }, null, 2);

/** A cube-shaped starting model, so a new block is visible before any Blockbench work. */
/**
 * A cube-shaped starting model, so a new block is visible before any Blockbench work.
 *
 * Self-contained rather than `{ parent: "block/cube_all" }`, and that is not a style
 * choice. Blockbench keeps whatever parent it finds, so a model that starts with one still
 * has it after geometry is added — and on 1.8.x a parent overrides the child's own
 * elements outright, which renders the author's work as a plain cube. Starting with no
 * parent means there is none to inherit into that trap. See shared/model-compat.ts.
 *
 * The elements and texture variables are what `block/cube_all` resolves to anyway, so
 * nothing is lost on the versions where inheriting would have worked.
 */
export const defaultBlockModel = (texture: string): string =>
  JSON.stringify(
    {
      textures: {
        all: texture,
        particle: texture,
      },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          faces: {
            down: { uv: [0, 0, 16, 16], texture: '#all', cullface: 'down' },
            up: { uv: [0, 0, 16, 16], texture: '#all', cullface: 'up' },
            north: { uv: [0, 0, 16, 16], texture: '#all', cullface: 'north' },
            south: { uv: [0, 0, 16, 16], texture: '#all', cullface: 'south' },
            west: { uv: [0, 0, 16, 16], texture: '#all', cullface: 'west' },
            east: { uv: [0, 0, 16, 16], texture: '#all', cullface: 'east' },
          },
        },
      ],
    },
    null,
    2,
  );

/** A flat sprite starting model for items. */
export const defaultItemModel = (texture: string, handheld: boolean): string =>
  JSON.stringify(
    { parent: handheld ? 'item/handheld' : 'item/generated', textures: { layer0: texture } },
    null,
    2,
  );

/**
 * A 16×16 magenta/black checkerboard, written by hand as a minimal PNG.
 *
 * Generating it rather than shipping a binary asset keeps the repository text-only, and
 * the missing-texture look makes it obvious at a glance that a texture has not been
 * supplied yet.
 */
export function placeholderTexturePng(): Buffer {
  const size = 16;
  const cell = 4;
  // Raw RGBA scanlines, each prefixed with a zero filter byte.
  const raw = Buffer.alloc(size * (1 + size * 4));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const magenta = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      raw[offset++] = magenta ? 0xf8 : 0x14;
      raw[offset++] = magenta ? 0x3c : 0x14;
      raw[offset++] = magenta ? 0xf8 : 0x14;
      raw[offset++] = 0xff;
    }
  }
  return encodePng(size, size, raw);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(width: number, height: number, rawRgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rawRgba)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Language files
// ---------------------------------------------------------------------------

/** Minecraft's locale codes differ from the app's; only these two are generated. */
const MC_LOCALES: Record<string, string> = { en: 'en_us', fr: 'fr_fr' };

/**
 * Translation keys for a slot, in both conventions Ella's range uses.
 *
 * 1.12.2 and older look up `tile.<ns>.<path>.name` for blocks and `item.<ns>.<path>.name`
 * for items; 1.13 onwards use `block.<ns>.<path>` and `item.<ns>.<path>`. Both are
 * emitted for the same reason both blockstate variant keys are: the unused one is
 * ignored, and writing only one leaves half the range showing a raw key.
 */
function translationKeys(kind: EntryKind, slot: number): string[] {
  const path = slotName(kind, slot);
  const legacyPrefix = kind === 'block' ? 'tile' : 'item';
  return [
    `${kind}.${SLOT_NAMESPACE}.${path}`,
    `${legacyPrefix}.${SLOT_NAMESPACE}.${path}.name`,
  ];
}

/** Escapes a value for the legacy `key=value` lang format, which is line-based. */
const escapeLangValue = (value: string): string =>
  value.replace(/\r?\n/g, ' ').trim();

/**
 * Builds the lang files that name each bound slot in game, so the hotbar shows
 * "Ruby Lamp" instead of "block_000".
 *
 * Returns a filename → content map covering both formats Ella's range uses: 1.12.2 and
 * older read `en_us.lang` as `key=value` lines, and JSON lang files only arrived in 1.13.
 * A version ignores the format it does not understand.
 */
export function buildLangFiles(project: EllaProject): Record<string, string> {
  const files: Record<string, string> = {};

  for (const [appLocale, mcLocale] of Object.entries(MC_LOCALES)) {
    const entries: Record<string, string> = {};
    for (const entry of project.entries) {
      if (entry.slot === null) continue;
      const name = entry.displayName[appLocale] ?? entry.displayName.en;
      for (const key of translationKeys(entry.kind, entry.slot)) {
        entries[key] = name;
      }
    }

    files[`${mcLocale}.json`] = JSON.stringify(entries, null, 2);
    files[`${mcLocale}.lang`] =
      Object.entries(entries)
        .map(([key, value]) => `${key}=${escapeLangValue(value)}`)
        .join('\n') + '\n';
  }

  return files;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function writeFileAt(root: string, relative: string, content: string | Buffer): Promise<void> {
  const target = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

/**
 * Writes the files for one slot.
 *
 * `target` is the model the slot points at, or null for an unbound slot: those still need
 * files, otherwise the game logs a missing-model error for every empty slot in the pool on
 * every reload.
 */
async function writeSlot(
  packDir: string,
  kind: EntryKind,
  slot: number,
  target: string | null,
  renderLayer: string | undefined,
): Promise<void> {
  if (kind === 'item') {
    await writeFileAt(
      packDir,
      `assets/${SLOT_NAMESPACE}/models/item/${slotName(kind, slot)}.json`,
      slotRedirectModel(target ?? 'item/generated'),
    );
    return;
  }

  await writeFileAt(
    packDir,
    `assets/${SLOT_NAMESPACE}/blockstates/${slotName(kind, slot)}.json`,
    slotBlockstate(slot),
  );

  const redirect = slotRedirectModel(target, renderLayer);

  /*
   * The same model is written at two paths on purpose.
   *
   * A blockstate's `model` value is resolved relative to `models/block/` on 1.12.2
   * and older — the prefix is implicit — but is a full path from `models/` on 1.13
   * and newer. So `ella:block/slot_000` means `models/block/block/slot_000.json`
   * on the old versions and `models/block/slot_000.json` on the new ones.
   *
   * Writing both lets one blockstate serve the whole range. The alternative is
   * emitting a different `model` value per version, which needs the target version
   * at write time — and the pack is written before any game connects.
   *
   * Note this quirk applies only to blockstates. A `parent` inside a model file is
   * a full path on every version, which is why the item models resolve correctly
   * with a single copy.
   */
  await writeFileAt(
    packDir,
    `assets/${SLOT_NAMESPACE}/models/block/${slotModelName(slot)}.json`,
    redirect,
  );
  await writeFileAt(
    packDir,
    `assets/${SLOT_NAMESPACE}/models/block/block/${slotModelName(slot)}.json`,
    redirect,
  );
  await writeFileAt(
    packDir,
    `assets/${SLOT_NAMESPACE}/models/item/${slotName(kind, slot)}.json`,
    blockItemModel(slot),
  );
}

/** The model path a bound entry's slot redirects to. */
const entryTarget = (project: EllaProject, entry: ProjectEntry): string =>
  `${project.namespace}:${entry.kind}/${entry.id}`;

const entryRenderLayer = (entry: ProjectEntry): string | undefined =>
  typeof entry.settings.renderLayer === 'string' ? entry.settings.renderLayer : undefined;

/**
 * Regenerates the whole `ella` slot namespace from the project.
 *
 * The namespace is wiped first: stale blockstates from deleted entries would otherwise
 * keep rendering, which is exactly the kind of ghost that makes people restart the game
 * to "fix" something that was never broken.
 *
 * This is the expensive path — a full pool is four files per block slot plus one per item
 * slot, so a default project regenerates several hundred files. Use it for changes that
 * move bindings, names or the namespace; {@link writeEntrySlot} covers the rest.
 */
export async function writeSlotNamespace(
  projectRoot: string,
  project: EllaProject,
  packFormat: number,
): Promise<void> {
  const packDir = path.join(projectRoot, 'pack');
  const slotAssets = path.join(packDir, 'assets', SLOT_NAMESPACE);
  await rm(slotAssets, { recursive: true, force: true });

  await writeFileAt(packDir, 'pack.mcmeta', packMcmeta(packFormat));

  const bound = new Map<string, ProjectEntry>();
  for (const entry of project.entries) {
    if (entry.slot !== null) bound.set(`${entry.kind}:${entry.slot}`, entry);
  }

  for (const kind of ['block', 'item'] as const) {
    for (let slot = 0; slot < project.slotPool[kind]; slot++) {
      const entry = bound.get(`${kind}:${slot}`);
      await writeSlot(
        packDir,
        kind,
        slot,
        entry ? entryTarget(project, entry) : null,
        entry ? entryRenderLayer(entry) : undefined,
      );
    }
  }

  for (const [filename, content] of Object.entries(buildLangFiles(project))) {
    await writeFileAt(packDir, `assets/${SLOT_NAMESPACE}/lang/${filename}`, content);
  }
}

/**
 * Rewrites the files for a single entry's slot, leaving the rest of the namespace alone.
 *
 * Settings reach the generated pack through exactly one thing: the render layer, baked
 * into that slot's redirect model. Nothing else in the namespace — blockstates, item
 * models, the lang files — depends on an entry's settings, only on its binding and its
 * display name. So a settings change is a handful of writes, not a regeneration.
 *
 * Returns false for an unbound entry, which has no slot files to write.
 */
export async function writeEntrySlot(
  projectRoot: string,
  project: EllaProject,
  entry: ProjectEntry,
): Promise<boolean> {
  if (entry.slot === null) return false;

  await writeSlot(
    path.join(projectRoot, 'pack'),
    entry.kind,
    entry.slot,
    entryTarget(project, entry),
    entryRenderLayer(entry),
  );
  return true;
}
