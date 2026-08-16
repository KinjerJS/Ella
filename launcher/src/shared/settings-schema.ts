/**
 * Declarative schema for block and item settings.
 *
 * The editor renders its forms from this schema rather than hard-coding controls, and the
 * same schema drives validation and export. A control is disabled — never hidden without
 * explanation — when the running adapter lacks the required capability, so the user can
 * see that an option exists and why it is unavailable on their version.
 *
 * Adding a setting means adding an entry here, an i18n label in both locales, and handling
 * for it in each adapter that claims the capability.
 */

import type { Capability, EntryKind } from './protocol.ts';

export type FieldGroup = 'appearance' | 'physical' | 'interaction';

interface FieldBase {
  key: string;
  /** i18n key for the control label. */
  labelKey: string;
  /** i18n key for the help text shown next to the control. */
  helpKey?: string;
  group: FieldGroup;
  /** Adapter capability required. Absent means every version supports it. */
  capability?: Capability;
  /** Minecraft version bounds, inclusive lower / exclusive upper. */
  minVersion?: string;
  maxVersion?: string;
  /** Show this field only when another field holds a given value. */
  visibleWhen?: { key: string; equals: unknown };
}

export interface EnumOption {
  value: string;
  labelKey: string;
  /** Per-option capability, e.g. `cutout_mipped` is not available everywhere. */
  capability?: Capability;
}

export type SettingField =
  | (FieldBase & { type: 'enum'; options: EnumOption[]; default: string })
  | (FieldBase & { type: 'int'; min: number; max: number; default: number })
  | (FieldBase & { type: 'float'; min: number; max: number; step: number; default: number })
  | (FieldBase & { type: 'bool'; default: boolean })
  | (FieldBase & { type: 'box'; default: [number, number, number, number, number, number] });

// ---------------------------------------------------------------------------
// Block settings
// ---------------------------------------------------------------------------

export const BLOCK_FIELDS: SettingField[] = [
  {
    key: 'renderLayer',
    type: 'enum',
    labelKey: 'settings.block.renderLayer',
    helpKey: 'settings.block.renderLayer.help',
    group: 'appearance',
    default: 'solid',
    options: [
      { value: 'solid', labelKey: 'settings.renderLayer.solid' },
      { value: 'cutout', labelKey: 'settings.renderLayer.cutout', capability: 'render_layer.cutout' },
      {
        value: 'cutout_mipped',
        labelKey: 'settings.renderLayer.cutoutMipped',
        capability: 'render_layer.cutout_mipped',
      },
      {
        value: 'translucent',
        labelKey: 'settings.renderLayer.translucent',
        capability: 'render_layer.translucent',
      },
    ],
  },
  {
    key: 'opaque',
    type: 'bool',
    labelKey: 'settings.block.opaque',
    helpKey: 'settings.block.opaque.help',
    group: 'appearance',
    default: true,
  },
  {
    key: 'emissive',
    type: 'bool',
    labelKey: 'settings.block.emissive',
    helpKey: 'settings.block.emissive.help',
    group: 'appearance',
    default: false,
  },
  {
    key: 'tintIndex',
    type: 'int',
    labelKey: 'settings.block.tintIndex',
    helpKey: 'settings.block.tintIndex.help',
    group: 'appearance',
    min: -1,
    max: 15,
    default: -1,
  },
  {
    key: 'lightLevel',
    type: 'int',
    labelKey: 'settings.block.lightLevel',
    helpKey: 'settings.block.lightLevel.help',
    group: 'appearance',
    min: 0,
    max: 15,
    default: 0,
  },
  {
    key: 'hardness',
    type: 'float',
    labelKey: 'settings.block.hardness',
    helpKey: 'settings.block.hardness.help',
    group: 'physical',
    min: -1,
    max: 100,
    step: 0.1,
    default: 1.5,
  },
  {
    key: 'resistance',
    type: 'float',
    labelKey: 'settings.block.resistance',
    group: 'physical',
    min: 0,
    max: 3600,
    step: 0.1,
    default: 6,
  },
  {
    key: 'soundType',
    type: 'enum',
    labelKey: 'settings.block.soundType',
    helpKey: 'settings.block.soundType.help',
    group: 'physical',
    default: 'stone',
    options: [
      { value: 'stone', labelKey: 'settings.soundType.stone' },
      { value: 'wood', labelKey: 'settings.soundType.wood' },
      { value: 'gravel', labelKey: 'settings.soundType.gravel' },
      { value: 'grass', labelKey: 'settings.soundType.grass' },
      { value: 'metal', labelKey: 'settings.soundType.metal' },
      { value: 'glass', labelKey: 'settings.soundType.glass' },
      { value: 'wool', labelKey: 'settings.soundType.wool' },
      { value: 'sand', labelKey: 'settings.soundType.sand' },
      { value: 'snow', labelKey: 'settings.soundType.snow' },
    ],
  },
  {
    key: 'fullCube',
    type: 'bool',
    labelKey: 'settings.block.fullCube',
    helpKey: 'settings.block.fullCube.help',
    group: 'physical',
    default: true,
  },
  {
    key: 'rotation',
    type: 'enum',
    labelKey: 'settings.block.rotation',
    helpKey: 'settings.block.rotation.help',
    group: 'interaction',
    capability: 'block.rotation',
    default: 'none',
    options: [
      { value: 'none', labelKey: 'settings.rotation.none' },
      { value: 'horizontal', labelKey: 'settings.rotation.horizontal' },
      { value: 'all', labelKey: 'settings.rotation.all' },
    ],
  },
  {
    key: 'collision',
    type: 'enum',
    labelKey: 'settings.block.collision',
    group: 'interaction',
    default: 'full',
    options: [
      { value: 'full', labelKey: 'settings.collision.full' },
      { value: 'none', labelKey: 'settings.collision.none' },
      { value: 'custom', labelKey: 'settings.collision.custom', capability: 'hitbox.custom' },
    ],
  },
  {
    key: 'hitbox',
    type: 'box',
    labelKey: 'settings.block.hitbox',
    helpKey: 'settings.block.hitbox.help',
    group: 'interaction',
    capability: 'hitbox.custom',
    visibleWhen: { key: 'collision', equals: 'custom' },
    default: [0, 0, 0, 16, 16, 16],
  },
];

// ---------------------------------------------------------------------------
// Item settings
// ---------------------------------------------------------------------------

export const ITEM_FIELDS: SettingField[] = [
  {
    key: 'handheld',
    type: 'bool',
    labelKey: 'settings.item.handheld',
    helpKey: 'settings.item.handheld.help',
    group: 'appearance',
    default: false,
  },
  {
    key: 'glint',
    type: 'bool',
    labelKey: 'settings.item.glint',
    group: 'appearance',
    default: false,
  },
  {
    key: 'stackSize',
    type: 'int',
    labelKey: 'settings.item.stackSize',
    group: 'physical',
    min: 1,
    max: 99,
    default: 64,
  },
  {
    key: 'rarity',
    type: 'enum',
    labelKey: 'settings.item.rarity',
    group: 'appearance',
    capability: 'item.rarity',
    default: 'common',
    options: [
      { value: 'common', labelKey: 'settings.rarity.common' },
      { value: 'uncommon', labelKey: 'settings.rarity.uncommon' },
      { value: 'rare', labelKey: 'settings.rarity.rare' },
      { value: 'epic', labelKey: 'settings.rarity.epic' },
    ],
  },
];

export const fieldsFor = (kind: EntryKind): SettingField[] =>
  kind === 'block' ? BLOCK_FIELDS : ITEM_FIELDS;

export function defaultsFor(kind: EntryKind): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fieldsFor(kind)) out[field.key] = field.default;
  return out;
}

// ---------------------------------------------------------------------------
// Cross-field rules
// ---------------------------------------------------------------------------

export interface SettingsWarning {
  /** i18n key for the message shown to the user. */
  messageKey: string;
  /** Fields the warning relates to, so the UI can highlight them. */
  keys: string[];
  /** A one-click correction the UI can offer. */
  fix?: Record<string, unknown>;
}

/**
 * Rules that span more than one field. The transparency rule is the important one: a
 * non-solid render layer only actually looks transparent if neighbour face culling is
 * also switched off, and getting exactly one of the two is the single most common
 * mistake when porting a Blockbench model into the game.
 */
export function checkSettings(
  kind: EntryKind,
  settings: Record<string, unknown>,
): SettingsWarning[] {
  const warnings: SettingsWarning[] = [];
  if (kind !== 'block') return warnings;

  const layer = settings.renderLayer;
  const isTransparentLayer = layer === 'cutout' || layer === 'cutout_mipped' || layer === 'translucent';

  if (isTransparentLayer && settings.opaque === true) {
    warnings.push({
      messageKey: 'warning.transparentButOpaque',
      keys: ['renderLayer', 'opaque'],
      fix: { opaque: false },
    });
  }

  if (settings.opaque === false && settings.fullCube === true && layer === 'solid') {
    warnings.push({
      messageKey: 'warning.nonOpaqueSolidLayer',
      keys: ['renderLayer', 'opaque'],
      fix: { renderLayer: 'cutout' },
    });
  }

  if (settings.collision === 'custom' && settings.fullCube === true) {
    warnings.push({
      messageKey: 'warning.customHitboxFullCube',
      keys: ['collision', 'fullCube'],
      fix: { fullCube: false },
    });
  }

  const hitbox = settings.hitbox;
  if (settings.collision === 'custom' && Array.isArray(hitbox) && hitbox.length === 6) {
    const [x1, y1, z1, x2, y2, z2] = hitbox as number[];
    if (x2 <= x1 || y2 <= y1 || z2 <= z1) {
      warnings.push({ messageKey: 'warning.invalidHitbox', keys: ['hitbox'] });
    }
  }

  return warnings;
}

/** True when the running adapter can honour this field. */
export function isFieldAvailable(field: SettingField, capabilities: readonly string[]): boolean {
  return field.capability === undefined || capabilities.includes(field.capability);
}

export function isOptionAvailable(option: EnumOption, capabilities: readonly string[]): boolean {
  return option.capability === undefined || capabilities.includes(option.capability);
}
