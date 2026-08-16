/**
 * Ella IPC protocol v1 — see docs/protocol.md
 *
 * Transport is newline-delimited JSON over TCP. The launcher is the server; the in-game
 * mod is the client. These types are mirrored by `EllaMessage` in the Java core, so any
 * change here must be made there too.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 25585;

/** A localized string. `en` is mandatory; other locales fall back to it. */
export type LocaleMap = { en: string } & Partial<Record<string, string>>;

export type EntryKind = 'block' | 'item';

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface Envelope<T = unknown> {
  v: number;
  /** Correlation id. Present on requests and echoed by responses; absent on notifications. */
  id?: string;
  type: string;
  payload?: T;
}

export interface ResultEnvelope<T = unknown> extends Envelope<T> {
  type: 'result';
  ok: boolean;
  error?: ProtocolError;
}

export interface ProtocolError {
  code: ErrorCode;
  /** Developer-facing English text. Never shown to the user — localize `code` instead. */
  message: string;
}

export type ErrorCode =
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'BAD_TOKEN'
  | 'SLOT_OUT_OF_RANGE'
  | 'UNKNOWN_KIND'
  | 'UNSUPPORTED_SETTING'
  | 'RELOAD_FAILED'
  | 'NOT_IN_WORLD';

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Declared by the adapter in `hello`, consumed by the editor to enable or grey out
 * controls. Unknown strings are ignored so adapters can add capabilities without
 * breaking older launchers.
 */
export const CAPABILITIES = [
  'render_layer.cutout',
  'render_layer.cutout_mipped',
  'render_layer.translucent',
  'render_layer.runtime',
  'light.dynamic',
  'hitbox.custom',
  'hitbox.runtime',
  'reload.programmatic',
  'model.obj',
  'item.rarity',
  'item.components',
  'block.rotation',
  'entry.place',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// ---------------------------------------------------------------------------
// Message payloads
// ---------------------------------------------------------------------------

/** mod → launcher, sent immediately on connect. */
export interface HelloPayload {
  token: string;
  minecraftVersion: string;
  loader: 'forge' | 'neoforge' | 'fabric';
  loaderVersion: string;
  adapter: string;
  adapterVersion: string;
  javaVersion: string;
  slots: Record<EntryKind, number>;
  /** Typed as string[] rather than Capability[]: forward compatibility is deliberate. */
  capabilities: string[];
  /**
   * `pack_format` this version expects in pack.mcmeta. Reported by the adapter rather
   * than looked up launcher-side, because the value changes almost every release and a
   * table would be wrong for any version newer than the launcher build.
   */
  packFormat: number;
}

/** launcher → mod, sent in reply to `hello`. */
export interface WelcomePayload {
  workspace: string;
  projectId: string;
  namespace: string;
  /** Directory the mod injects into the resource stack. Guaranteed to exist. */
  packRoot: string;
}

export interface SlotAssignPayload {
  slot: number;
  kind: EntryKind;
  entryId: string;
  registryName: string;
  displayName: LocaleMap;
  settings: Record<string, unknown>;
}

export interface SlotClearPayload {
  slot: number;
  kind: EntryKind;
}

export interface SettingsPatchPayload {
  slot: number;
  kind: EntryKind;
  /** Only the listed keys change. */
  settings: Record<string, unknown>;
}

/** Reply to `settings.patch`: lets the editor flag settings the version could not honour. */
export interface SettingsPatchResult {
  applied: string[];
  ignored: string[];
}

export interface ResourcesReloadPayload {
  reason: 'model_changed' | 'texture_changed' | 'manual';
  entryId?: string;
}

export interface EntryGivePayload {
  slot: number;
  kind: EntryKind;
  count?: number;
}

/** mod → launcher. Surfaces game-side problems without the user reading latest.log. */
export interface LogPayload {
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  entryId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isResult(msg: Envelope): msg is ResultEnvelope {
  return msg.type === 'result';
}

/** Serialize to a single NDJSON line. Throws if the payload contains a raw newline. */
export function encodeMessage(msg: Envelope): string {
  const line = JSON.stringify(msg);
  if (line.includes('\n')) {
    throw new Error('encodeMessage: serialized message contains a newline');
  }
  return line + '\n';
}
