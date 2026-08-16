/**
 * Installing the bundled Blockbench plugin.
 *
 * The plugin is optional — Ella works with a plain Ctrl+S because the file watcher is the
 * transport either way. Installing it just removes the Ctrl+S.
 */

import { copyFile, readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PLUGIN_FILENAME = 'ella_live_sync.js';

/** Where Blockbench loads user plugins from. */
export function blockbenchPluginsDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      'Blockbench', 'plugins',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Blockbench', 'plugins');
  }
  return path.join(home, '.config', 'Blockbench', 'plugins');
}

/** Candidate locations of the plugin source, packaged and in development. */
function sourceCandidates(): string[] {
  return [
    path.join(process.resourcesPath ?? '', 'blockbench-plugin', PLUGIN_FILENAME),
    path.resolve(here, '../../../blockbench-plugin', PLUGIN_FILENAME),
    path.resolve(here, '../../../../blockbench-plugin', PLUGIN_FILENAME),
  ].filter(Boolean);
}

const isFile = (target: string): Promise<boolean> =>
  stat(target).then((s) => s.isFile(), () => false);

export async function findPluginSource(): Promise<string | null> {
  for (const candidate of sourceCandidates()) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

export interface PluginStatus {
  installed: boolean;
  /** True when an installed copy differs from the bundled one. */
  outdated: boolean;
  installedPath: string;
}

export async function pluginStatus(): Promise<PluginStatus> {
  const installedPath = path.join(blockbenchPluginsDir(), PLUGIN_FILENAME);
  const source = await findPluginSource();

  if (!(await isFile(installedPath))) {
    return { installed: false, outdated: false, installedPath };
  }
  if (!source) {
    return { installed: true, outdated: false, installedPath };
  }

  // Content comparison rather than mtime: copying preserves neither, and the file is
  // small enough that reading both is free.
  const [installed, bundled] = await Promise.all([
    readFile(installedPath, 'utf8'),
    readFile(source, 'utf8'),
  ]);

  return { installed: true, outdated: installed !== bundled, installedPath };
}

export class PluginSourceMissingError extends Error {
  constructor() {
    super('The bundled Blockbench plugin could not be found');
    this.name = 'PluginSourceMissingError';
  }
}

/** Copies the plugin into Blockbench's plugin directory, overwriting any older copy. */
export async function installPlugin(): Promise<string> {
  const source = await findPluginSource();
  if (!source) throw new PluginSourceMissingError();

  const directory = blockbenchPluginsDir();
  await mkdir(directory, { recursive: true });

  const destination = path.join(directory, PLUGIN_FILENAME);
  await copyFile(source, destination);
  return destination;
}
