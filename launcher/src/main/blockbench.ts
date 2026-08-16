/**
 * Blockbench integration.
 *
 * Phase 1 (this file): open the model file in Blockbench and watch it. Because Ella hands
 * Blockbench the vanilla model JSON the game actually loads, a save in Blockbench *is*
 * the update — there is no conversion step and nothing can drift between the two.
 *
 * Phase 2 (blockbench-plugin/): a bundled Blockbench plugin talking to the launcher over
 * a socket, for per-edit sync without saving. The watcher here stays as the fallback for
 * users who would rather not install the plugin.
 */

import { spawn } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { resolveBlockbenchPath } from './config.ts';

export class BlockbenchNotFoundError extends Error {
  constructor() {
    super('Blockbench executable was not found');
    this.name = 'BlockbenchNotFoundError';
  }
}

/** Opens a file in Blockbench. Returns once the process has been spawned. */
export async function openInBlockbench(filePath: string): Promise<void> {
  const executable = await resolveBlockbenchPath();
  if (!executable) throw new BlockbenchNotFoundError();

  // Detached so closing Ella does not take the user's modelling session with it.
  const child = spawn(executable, [filePath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * Watches model and texture files for changes.
 *
 * Saves are debounced: an editor writing a file typically produces several filesystem
 * events, and each one would otherwise cost a full resource reload in game.
 *
 * Events:
 *   `changed` (files: string[])  — absolute paths, after the debounce window
 *   `error`   (error: Error)
 */
export class ModelWatcher extends EventEmitter {
  private watchers = new Map<string, FSWatcher>();
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(debounceMs = 250) {
    super();
    this.debounceMs = debounceMs;
  }

  /**
   * Watches a directory tree. Directories are watched rather than individual files
   * because editors commonly save by writing a temporary file and renaming it over the
   * target, which breaks a watch bound to the original inode.
   */
  async watchDirectory(directory: string): Promise<void> {
    if (this.watchers.has(directory)) return;

    const exists = await stat(directory).then((s) => s.isDirectory(), () => false);
    if (!exists) return;

    try {
      const watcher = watch(directory, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (!/\.(json|png)$/i.test(name)) return;
        // Ignore the temporary files atomic saves leave behind.
        if (name.endsWith('.tmp') || name.endsWith('.part')) return;

        this.pending.add(path.join(directory, name));
        this.schedule();
      });

      watcher.on('error', (error) => this.emit('error', error));
      this.watchers.set(directory, watcher);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const files = [...this.pending];
      this.pending.clear();
      this.timer = null;
      if (files.length > 0) this.emit('changed', files);
    }, this.debounceMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}

/** Classifies a changed path so the caller knows what kind of reload it needs. */
export function classifyChange(filePath: string): 'model' | 'texture' | 'other' {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'texture';
  if (extension === '.json') return 'model';
  return 'other';
}
