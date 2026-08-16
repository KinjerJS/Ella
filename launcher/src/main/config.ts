/**
 * Persisted application settings.
 *
 * Written atomically and merged with defaults on read, so a config file from an older
 * build — or a partially written one — never stops the app starting.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { access, constants } from 'node:fs';
import { promisify } from 'node:util';
import { configFile, ensureDir, getDataRoot } from './paths.ts';
import { DEFAULT_PORT } from '../shared/protocol.ts';
import { DEFAULT_LOCALE, isLocale, type Locale } from '../shared/i18n.ts';

const canAccess = promisify(access);

export interface AppConfig {
  locale: Locale;
  /** Absolute path to the Blockbench executable, or null to auto-detect. */
  blockbenchPath: string | null;
  username: string;
  maxMemoryMb: number;
  ellaPort: number;
  slotPool: { block: number; item: number };
  showSnapshots: boolean;
  lastProject: string | null;
  lastVersion: string | null;
}

export const DEFAULT_CONFIG: AppConfig = {
  locale: DEFAULT_LOCALE,
  blockbenchPath: null,
  username: 'Dev',
  maxMemoryMb: 2048,
  ellaPort: DEFAULT_PORT,
  slotPool: { block: 128, item: 128 },
  showSnapshots: false,
  lastProject: null,
  lastVersion: null,
};

let cached: AppConfig | null = null;

/** Coerces an arbitrary parsed object into a valid config, field by field. */
function sanitize(raw: unknown): AppConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CONFIG };
  const input = raw as Partial<AppConfig>;

  const slotPool = {
    block: clampSlots(input.slotPool?.block),
    item: clampSlots(input.slotPool?.item),
  };

  return {
    locale: typeof input.locale === 'string' && isLocale(input.locale)
      ? input.locale
      : DEFAULT_CONFIG.locale,
    blockbenchPath:
      typeof input.blockbenchPath === 'string' && input.blockbenchPath.length > 0
        ? input.blockbenchPath
        : null,
    username:
      typeof input.username === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(input.username)
        ? input.username
        : DEFAULT_CONFIG.username,
    maxMemoryMb:
      typeof input.maxMemoryMb === 'number' && input.maxMemoryMb >= 512
        ? Math.min(input.maxMemoryMb, 32768)
        : DEFAULT_CONFIG.maxMemoryMb,
    ellaPort:
      typeof input.ellaPort === 'number' && input.ellaPort > 1024 && input.ellaPort < 65536
        ? input.ellaPort
        : DEFAULT_CONFIG.ellaPort,
    slotPool,
    showSnapshots: input.showSnapshots === true,
    lastProject: typeof input.lastProject === 'string' ? input.lastProject : null,
    lastVersion: typeof input.lastVersion === 'string' ? input.lastVersion : null,
  };
}

/**
 * Slot count bounds. The lower bound keeps the pool useful; the upper bound exists
 * because every slot is a real registered block, and a pool in the tens of thousands
 * measurably slows game startup.
 */
function clampSlots(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 128;
  return Math.max(16, Math.min(1024, Math.floor(value)));
}

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  try {
    cached = sanitize(JSON.parse(await readFile(configFile(), 'utf8')));
  } catch {
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const merged = sanitize({ ...(await loadConfig()), ...patch });
  cached = merged;

  await ensureDir(getDataRoot());
  // Write-then-rename: a crash mid-write must not leave an unparseable config.
  const temporary = `${configFile()}.tmp`;
  await writeFile(temporary, JSON.stringify(merged, null, 2), 'utf8');
  await rename(temporary, configFile());
  return merged;
}

/** Test hook — drops the in-memory copy so the next read hits disk. */
export function resetConfigCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Blockbench discovery
// ---------------------------------------------------------------------------

function blockbenchCandidates(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
        'Programs', 'Blockbench', 'Blockbench.exe'),
      'C:\\Program Files\\Blockbench\\Blockbench.exe',
      'C:\\Program Files (x86)\\Blockbench\\Blockbench.exe',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Blockbench.app/Contents/MacOS/Blockbench',
      path.join(home, 'Applications', 'Blockbench.app', 'Contents', 'MacOS', 'Blockbench'),
    ];
  }
  return ['/usr/bin/blockbench', '/usr/local/bin/blockbench', '/snap/bin/blockbench'];
}

/** Returns the configured Blockbench path, or the first one found on disk. */
export async function resolveBlockbenchPath(): Promise<string | null> {
  const config = await loadConfig();
  if (config.blockbenchPath) {
    const ok = await canAccess(config.blockbenchPath, constants.X_OK).then(() => true, () => false);
    if (ok) return config.blockbenchPath;
  }

  for (const candidate of blockbenchCandidates()) {
    const ok = await canAccess(candidate, constants.X_OK).then(() => true, () => false);
    if (ok) return candidate;
  }
  return null;
}
