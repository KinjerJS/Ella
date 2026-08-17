/**
 * Session orchestration: ties the open project, the IPC server, the running game and the
 * file watcher together, and is the single place that decides when the game needs to
 * reload.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { EllaProject, ProjectEntry } from '../shared/project.ts';
import { slotRegistryName } from '../shared/project.ts';
import type { EntryKind } from '../shared/protocol.ts';
import { EllaServer, type ConnectedGame } from './ella-server.ts';
import { ModelWatcher, classifyChange, openInBlockbench } from './blockbench.ts';
import { launchGame, type RunningGame } from './minecraft/launch.ts';
import { findForgeVersionId } from './minecraft/forge.ts';
import { ensureAdapterInstalled } from './adapters.ts';
import { collectCrashDiagnostics, collectLaunchFailureDiagnostics } from './diagnostics.ts';
import {
  loadProject,
  saveProject,
  syncPack,
  syncEntryPack,
  type ProjectError,
} from './project.ts';
import { HIGHEST_KNOWN_PACK_FORMAT, SLOT_NAMESPACE } from './pack.ts';
import { purgeStashes } from './trash.ts';
import { loadConfig } from './config.ts';

export type GameStatus = 'stopped' | 'starting' | 'running' | 'connected';

/**
 * How a game run ended.
 *
 * `stopped`     the user pressed Stop — Ella killed it
 * `quit`        a clean exit from inside the game
 * `terminated`  killed by something else: Task Manager, the OS, a parent shell
 * `failed`      a non-zero exit, the only case with something to diagnose
 */
export type GameExit =
  | { kind: 'stopped' }
  | { kind: 'quit' }
  | { kind: 'terminated'; signal: string | null }
  | { kind: 'failed'; code: number };

/**
 * Reads an exit the way a user would describe it.
 *
 * Killing a process reports a null exit code, which is the same shape as being killed by
 * anything else and is *not* the same thing as failing. Ella used to test `code !== 0`,
 * so pressing Stop logged an error and opened the crash dialog — the opposite of what the
 * button promised. Whether the stop was requested is knowledge only the session has, which
 * is why it is a parameter rather than something inferred here.
 */
export function classifyExit(
  requested: boolean,
  code: number | null,
  signal: string | null,
): GameExit {
  if (requested) return { kind: 'stopped' };
  if (code === 0) return { kind: 'quit' };
  if (code === null) return { kind: 'terminated', signal };
  return { kind: 'failed', code };
}

/** How many output lines to retain for a crash report. */
const MAX_RETAINED_OUTPUT = 400;

export interface SessionState {
  status: GameStatus;
  versionId: string | null;
  projectRoot: string | null;
  connected: ConnectedGame | null;
}

/**
 * Events:
 *   `state`   (state: SessionState)
 *   `log`     ({ level, source, message })
 *   `output`  (line: string)              — raw game stdout/stderr
 *   `project` (project: EllaProject)
 *   `error`   (error: Error)
 */
export class Session extends EventEmitter {
  private server: EllaServer;
  private watcher = new ModelWatcher();
  private game: RunningGame | null = null;
  /** Set by {@link stopGame}, so a deliberate stop is not reported as a failure. */
  private stopRequested = false;
  private status: GameStatus = 'stopped';
  private reloadTimer: NodeJS.Timeout | null = null;
  /** Tail of the running game's output, kept for crash diagnostics. */
  private recentOutput: string[] = [];

  project: EllaProject | null = null;
  projectRoot: string | null = null;
  versionId: string | null = null;

  constructor() {
    super();
    this.server = new EllaServer(randomUUID());
    this.wireServer();
    this.wireWatcher();
  }

  get state(): SessionState {
    return {
      status: this.status,
      versionId: this.versionId,
      projectRoot: this.projectRoot,
      connected: this.server.game,
    };
  }

  private setStatus(status: GameStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('state', this.state);
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  private wireServer(): void {
    this.server.on('connected', () => {
      this.setStatus('connected');
      // Pushing the whole project on connect means a game started independently, or
      // restarted after a crash, lands in the same state without any user action.
      void this.pushAll();
    });

    this.server.on('disconnected', () => {
      this.setStatus(this.game ? 'running' : 'stopped');
    });

    this.server.on('log', (entry) => this.emit('log', entry));
    this.server.on('error', (error) => this.emit('error', error));
  }

  private wireWatcher(): void {
    this.watcher.on('changed', (files: string[]) => {
      const kinds = new Set(files.map(classifyChange));
      const reason = kinds.has('texture') ? 'texture_changed' : 'model_changed';
      this.scheduleReload(reason);

      // The editor draws previews from these files, so it has to hear about a Blockbench
      // save too — otherwise the preview keeps showing the model as it was when the
      // project last changed, which for a live-editing tool is worse than showing nothing.
      this.emit('files', files);
    });
    this.watcher.on('error', (error) => this.emit('error', error));
  }

  async start(): Promise<number> {
    const config = await loadConfig();
    return this.server.listen(config.ellaPort);
  }

  async dispose(): Promise<void> {
    this.watcher.stop();
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.stopGame();
    await this.server.close();
  }

  // -------------------------------------------------------------------------
  // Project
  // -------------------------------------------------------------------------

  async openProject(root: string): Promise<EllaProject> {
    const project = await loadProject(root);
    this.project = project;
    this.projectRoot = root;

    // Files a previous session moved aside for an undo that was never taken. The offers
    // themselves are long gone, so this is the moment they stop costing disk.
    await purgeStashes(root);

    await syncPack(root, project, this.packFormat());
    this.watcher.stop();
    // The `ella` namespace is Ella's own output, regenerated from the project. Watching it
    // meant every settings change fed its own writes back in as a model change: a reload
    // the game did not need, and a preview refresh in the editor for each of them.
    await this.watcher.watchDirectory(path.join(root, 'pack'), {
      ignore: (relative) => relative.startsWith(`assets/${SLOT_NAMESPACE}/`),
    });

    this.emit('project', project);
    this.emit('state', this.state);

    if (this.server.connected) await this.pushAll();
    return project;
  }

  /**
   * Closes the open project, stopping the file watcher.
   *
   * Deliberately does not touch the running game: the slots it registered stay bound
   * until something replaces them, and killing the game because a project was closed
   * would be a surprising amount of collateral.
   */
  closeProject(): void {
    this.watcher.stop();
    this.project = null;
    this.projectRoot = null;
    this.emit('project', null);
    this.emit('state', this.state);
  }

  /** Replaces the in-memory project after an edit and re-syncs everything downstream. */
  async setProject(project: EllaProject, options: { push?: boolean } = {}): Promise<void> {
    if (!this.projectRoot) throw new Error('No project open');
    this.project = project;
    await saveProject(this.projectRoot, project);
    await syncPack(this.projectRoot, project, this.packFormat());
    this.emit('project', project);

    if (options.push !== false && this.server.connected) await this.pushAll();
  }

  /**
   * Adopts a project whose only change is confined to one entry's own slot.
   *
   * The same as {@link setProject} except for what it rewrites: one slot instead of the
   * whole namespace. Settings changes arrive one per slider tick, and regenerating several
   * hundred files for each of them made the editor feel frozen while it caught up.
   *
   * The caller has already persisted the project — this does not save it again.
   */
  async setEntry(project: EllaProject, entry: ProjectEntry): Promise<void> {
    if (!this.projectRoot) throw new Error('No project open');
    this.project = project;
    await syncEntryPack(this.projectRoot, project, entry);
    this.emit('project', project);
  }

  /** The connected game knows its own pack format; otherwise fall back to the table. */
  private packFormat(): number {
    return this.server.game?.hello.packFormat ?? HIGHEST_KNOWN_PACK_FORMAT;
  }

  // -------------------------------------------------------------------------
  // Game
  // -------------------------------------------------------------------------

  async launch(versionId: string): Promise<void> {
    if (this.game) throw new Error('A game is already running');
    if (!this.projectRoot) throw new Error('Open a project before launching');

    const config = await loadConfig();
    this.versionId = versionId;
    // Cleared per run: a previous process that ignored its kill signal must not hand its
    // pending "this was deliberate" to whatever exits next.
    this.stopRequested = false;
    this.setStatus('starting');

    // Without Forge there is no Ella mod, so the game runs but nothing syncs. Launching
    // anyway is more useful than refusing — the user may just want to look at something —
    // but it has to be said plainly rather than looking like a silent failure.
    const forgeVersionId = await findForgeVersionId(versionId);
    if (!forgeVersionId) {
      this.emit('log', {
        level: 'warn',
        source: 'ella',
        message:
          `Forge is not installed for ${versionId}; launching vanilla. Live editing needs ` +
          'Forge and the Ella adapter — install them from the Versions tab.',
      });
    } else {
      // Checked on every launch, not just at install: a mods folder can be emptied
      // between sessions, and a rebuilt adapter should reach the game without a
      // reinstall step.
      await this.verifyAdapter(versionId);
    }

    try {
      this.game = await launchGame({
        versionId: forgeVersionId ?? versionId,
        instanceId: versionId,
        username: config.username,
        maxMemoryMb: config.maxMemoryMb,
        extraJvmArgs: [
          `-Della.slots.block=${config.slotPool.block}`,
          `-Della.slots.item=${config.slotPool.item}`,
        ],
        ella: {
          port: config.ellaPort,
          workspace: this.projectRoot,
          token: this.server.token,
        },
      });
    } catch (error) {
      this.setStatus('stopped');

      // A launch that never reaches the game looks identical to a crash from the user's
      // side, so it gets the same dialog rather than a line of red text.
      this.emit(
        'crash',
        await collectLaunchFailureDiagnostics(versionId, error as Error),
      );
      throw error;
    }

    this.setStatus('running');
    this.recentOutput = [];
    this.pipeOutput(this.game.process);

    // Captured now: `this.game` is cleared before the crash report is built.
    const command = this.game.command;

    this.game.process.on('exit', (code, signal) => {
      const exit = classifyExit(this.stopRequested, code, signal);
      this.stopRequested = false;
      this.game = null;
      this.setStatus('stopped');

      if (exit.kind === 'quit') return;

      if (exit.kind === 'stopped') {
        this.emit('log', { level: 'info', source: 'game', message: 'Game stopped' });
        return;
      }

      // Killed from outside. The game did not fault, so there is no crash report to
      // collect and nothing to diagnose; say what happened and stop there.
      if (exit.kind === 'terminated') {
        this.emit('log', {
          level: 'warn',
          source: 'game',
          message: `Game was terminated${exit.signal ? ` (${exit.signal})` : ''}`,
        });
        return;
      }

      // A non-zero exit is a real failure, and the user should not have to go hunting
      // through folders to find out why.
      this.emit('log', {
        level: 'error',
        source: 'game',
        message: `Game exited with code ${exit.code}`,
      });

      void collectCrashDiagnostics(versionId, exit.code, this.recentOutput, {
        javaUsed: {
          major: command.java.major,
          version: command.java.version,
          path: command.java.path,
        },
        launchedVersionId: command.version.id,
      })
        .then((diagnostics) => this.emit('crash', diagnostics))
        .catch((error: Error) =>
          this.emit('log', {
            level: 'error',
            source: 'ella',
            message: `Could not collect crash diagnostics: ${error.message}`,
          }),
        );
    });
  }

  /** Confirms the instance holds the current adapter jar, reporting what it did. */
  private async verifyAdapter(versionId: string): Promise<void> {
    const check = await ensureAdapterInstalled(versionId, versionId);

    switch (check.status) {
      case 'unavailable':
        this.emit('log', {
          level: 'warn',
          source: 'ella',
          message: `${check.reason}; launching without live editing.`,
        });
        break;
      case 'installed':
        this.emit('log', {
          level: 'info',
          source: 'ella',
          message: `Ella mod was missing and has been installed: ${check.path}`,
        });
        break;
      case 'updated':
        this.emit('log', {
          level: 'info',
          source: 'ella',
          message: `Ella mod was out of date and has been replaced: ${check.path}`,
        });
        break;
      case 'current':
        this.emit('log', {
          level: 'info',
          source: 'ella',
          message: 'Ella mod present and up to date.',
        });
        break;
    }
  }

  private pipeOutput(child: ChildProcess): void {
    // Streaming stdout is what lets model-loading errors reach the editor instead of
    // only latest.log.
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      let buffer = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trimEnd();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;

          this.emit('output', line);

          // Kept so a crash report can include the run's tail. Bounded, because a long
          // session produces far more output than is worth holding.
          this.recentOutput.push(line);
          if (this.recentOutput.length > MAX_RETAINED_OUTPUT) this.recentOutput.shift();
        }
      });
    }
  }

  stopGame(): void {
    // Recorded before the kill so the exit handler can tell "the user pressed Stop" from
    // "the game died". Killing a process yields a null exit code, which is otherwise
    // indistinguishable from a crash.
    if (this.game) this.stopRequested = true;
    this.game?.process.kill();
    this.game = null;
    this.setStatus('stopped');
  }

  // -------------------------------------------------------------------------
  // Pushing to the game
  // -------------------------------------------------------------------------

  /** Sends the welcome, every bound entry, and one reload. */
  async pushAll(): Promise<void> {
    if (!this.project || !this.projectRoot || !this.server.connected) return;

    this.server.welcome({
      workspace: this.projectRoot,
      projectId: this.project.namespace,
      namespace: this.project.namespace,
      packRoot: path.join(this.projectRoot, 'pack'),
    });

    for (const entry of this.project.entries) {
      if (entry.slot === null) continue;
      try {
        await this.server.assignSlot(this.assignPayload(entry));
      } catch (error) {
        this.emit('error', error as Error);
      }
    }

    this.scheduleReload('manual');
  }

  private assignPayload(entry: ProjectEntry) {
    return {
      slot: entry.slot as number,
      kind: entry.kind,
      entryId: entry.id,
      registryName: slotRegistryName(entry.kind, entry.slot as number),
      displayName: entry.displayName,
      settings: entry.settings,
    };
  }

  /** Applies a settings change to a live slot without a full reassign. */
  async patchEntrySettings(
    entry: ProjectEntry,
    settings: Record<string, unknown>,
  ): Promise<{ applied: string[]; ignored: string[] } | null> {
    if (entry.slot === null || !this.server.connected) return null;
    return this.server.patchSettings(entry.slot, entry.kind, settings);
  }

  async giveEntry(entry: ProjectEntry): Promise<void> {
    if (entry.slot === null) throw new Error('Entry is not bound to a slot');
    await this.server.give(entry.slot, entry.kind);
  }

  async placeEntry(entry: ProjectEntry): Promise<void> {
    if (entry.slot === null) throw new Error('Entry is not bound to a slot');
    if (!this.server.hasCapability('entry.place')) {
      throw new Error('This version does not support placing blocks remotely');
    }
    await this.server.place(entry.slot, entry.kind);
  }

  async openEntryInBlockbench(entry: ProjectEntry): Promise<void> {
    if (!this.projectRoot) throw new Error('No project open');
    await openInBlockbench(path.join(this.projectRoot, ...entry.model.output.split('/')));
  }

  /**
   * Coalesces reload requests. A burst of file writes — which is what one Blockbench save
   * looks like from the outside — should cost exactly one reload.
   */
  private scheduleReload(reason: 'model_changed' | 'texture_changed' | 'manual'): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      if (!this.server.connected) return;
      this.server.reloadResources(reason).catch((error: Error) => this.emit('error', error));
    }, 150);
  }

  hasCapability(capability: string): boolean {
    return this.server.hasCapability(capability);
  }

  get ellaToken(): string {
    return this.server.token;
  }
}
