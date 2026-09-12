/**
 * Electron main process: window lifecycle and the IPC surface described in shared/ipc.ts.
 */

import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS, EVENTS, type Result } from '../shared/ipc.ts';
import { setDataRoot, ensureLayout, instanceDir } from './paths.ts';
import { formatDiagnostics, type CrashDiagnostics } from './diagnostics.ts';
import { loadConfig, saveConfig, resolveBlockbenchPath } from './config.ts';
import { createSplash, MIN_SPLASH_MS } from './splash.ts';
import { translate } from '../shared/i18n.ts';
import { discoverJavaRuntimes } from './java-runtime.ts';
import {
  listVersions,
  listInstalledVersions,
  type VersionSummary,
} from './minecraft/manifest.ts';
import { installVersion } from './minecraft/install.ts';
import { installForge } from './minecraft/forge.ts';
import { uninstallVersion, measureInstall, VersionInUseError } from './minecraft/uninstall.ts';
import { installAdapter } from './adapters.ts';
import { pluginStatus, installPlugin } from './blockbench-plugin.ts';
import { requiredJavaVersion, adapterCoverageFor } from '../shared/version.ts';
import { Session } from './session.ts';
import {
  createProject,
  createEntry,
  updateEntry,
  deleteEntry,
  renameEntry,
  duplicateEntry,
  entryStash,
  listProjects,
  deleteProject,
  measureProject,
  updateProjectInfo,
  readEntryPreviews,
  removeModelParent,
  restoreEntry,
  writeModelFile,
} from './project.ts';
import { UndoRegistry } from './undo.ts';
import { stashFiles } from './trash.ts';
import {
  readModelFile,
  inferModelKind,
  nameFromFile,
  planModelImport,
  importModelAsEntry,
  replaceEntryModel,
  undoReplaceModel,
  type ImportModelOptions,
} from './model-import.ts';
import { planVersionChange, applyVersionChange } from './version-change.ts';
import {
  listTextures,
  addTexture,
  removeTexture,
  restoreTexture,
  setParticleTexture,
  importTextureFor,
} from './textures.ts';
import { exportResourcePack, validateForExport, defaultExportName } from './export.ts';
import { HIGHEST_KNOWN_PACK_FORMAT } from './pack.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));

let window: BrowserWindow | null = null;
const session = new Session();
const undoable = new UndoRegistry();

/** Wraps a handler so IPC never rejects: the renderer always receives a Result. */
function handle<T>(channel: string, handler: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, value: await handler(...(args as never[])) };
    } catch (error) {
      const err = error as Error & { code?: string };
      return {
        ok: false,
        code: err.code ?? err.name ?? 'ERROR',
        message: err.message ?? String(error),
      };
    }
  });
}

/** For handlers whose failure has no meaningful UI branch. */
function handleRaw<T>(channel: string, handler: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as never[])));
}

function send(channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function requireProject(): { project: NonNullable<Session['project']>; root: string } {
  if (!session.project || !session.projectRoot) {
    const error = new Error('No project is open') as Error & { code: string };
    error.code = 'NO_PROJECT';
    throw error;
  }
  return { project: session.project, root: session.projectRoot };
}

/**
 * Announces a change that can still be taken back.
 *
 * The inverse re-reads the open project rather than capturing it: seconds pass between the
 * offer and the click, and applying an undo to the project as it was would quietly discard
 * anything done in between.
 */
function offerUndo(
  messageKey: string,
  values: Record<string, string | number>,
  inverse: () => Promise<void>,
): void {
  send(EVENTS.undo, undoable.offer(messageKey, values, inverse));
}

/**
 * The way back from an action that added an entry: the entry out of the manifest, and the
 * files it wrote moved aside rather than deleted — they may have been opened in Blockbench
 * and saved in the seconds since.
 */
function removeAddedEntry(id: string, files: string[]): () => Promise<void> {
  return async () => {
    const current = requireProject();
    const removed = await deleteEntry(current.root, current.project, id);
    await stashFiles(current.root, entryStash(id), files);
    await session.setProject(removed.project);
  };
}

/** Asks for a model JSON. Null when the picker is cancelled or there is no window. */
async function pickModelFile(): Promise<string | null> {
  if (!window) return null;
  const chosen = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'Minecraft model', extensions: ['json'] }],
  });
  return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
}

function findEntry(id: string) {
  const { project } = requireProject();
  const entry = project.entries.find((candidate) => candidate.id === id);
  if (!entry) {
    const error = new Error(`No entry named "${id}"`) as Error & { code: string };
    error.code = 'UNKNOWN_ENTRY';
    throw error;
  }
  return entry;
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

function registerHandlers(): void {
  handleRaw(CHANNELS.configGet, () => loadConfig());
  handleRaw(CHANNELS.configSet, (patch: never) => saveConfig(patch));

  handleRaw(CHANNELS.javaList, async () =>
    (await discoverJavaRuntimes()).map((runtime) => ({
      path: runtime.path,
      major: runtime.major,
      version: runtime.version,
      origin: runtime.origin,
    })),
  );

  handle(CHANNELS.versionsList, async (options: never) =>
    describeVersions(await listVersions(options ?? {})),
  );

  // Disk-only, so quick launch populates instantly and works offline.
  handle(CHANNELS.versionsInstalled, async () =>
    describeVersions(await listInstalledVersions()),
  );

  /**
   * Installs everything a version needs to be useful: vanilla assets, Forge, and the
   * matching Ella adapter. Forge and adapter failures are reported rather than thrown —
   * a version that is playable but not yet live-editable is still worth having.
   */
  handle(CHANNELS.versionsInstall, async (versionId: never) => {
    const progress = (phase: 'download' | 'install') =>
      (report: { completed: number; total: number; bytesDownloaded: number; currentLabel?: string }) =>
        send(EVENTS.progress, {
          phase,
          completed: report.completed,
          total: report.total,
          bytes: report.bytesDownloaded,
          label: report.currentLabel,
        });

    const result = await installVersion(versionId, { onProgress: progress('download') });

    const warnings: string[] = [];

    try {
      send(EVENTS.progress, { phase: 'install', completed: 0, total: 1, bytes: 0, label: 'Forge' });
      await installForge(versionId, {
        onLog: (line) =>
          send(EVENTS.log, { level: 'info', source: 'forge-installer', message: line }),
      });
    } catch (error) {
      warnings.push((error as Error).message);
    }

    try {
      await installAdapter(versionId, versionId);
    } catch (error) {
      warnings.push((error as Error).message);
    }

    for (const message of warnings) {
      send(EVENTS.log, { level: 'warn', source: 'ella', message });
    }
    send(EVENTS.progress, { phase: 'install', completed: 1, total: 1, bytes: 0 });

    return { failures: result.failures.length + warnings.length };
  });

  handle(CHANNELS.versionsMeasure, (versionId: never) => measureInstall(versionId));

  handle(CHANNELS.versionsUninstall, async (versionId: never, removeInstanceData: never) => {
    // Deleting the files out from under a running game leaves it in a state that is far
    // harder to explain than simply refusing.
    if (session.state.status !== 'stopped' && session.state.versionId === versionId) {
      throw new VersionInUseError(versionId);
    }

    const result = await uninstallVersion(versionId, { removeInstanceData });
    send(EVENTS.log, {
      level: 'info',
      source: 'ella',
      message: `Uninstalled ${versionId}: removed ${result.removed.length} director${
        result.removed.length === 1 ? 'y' : 'ies'
      }`,
    });
    return result;
  });

  handleRaw(CHANNELS.projectsList, () => listProjects());

  handle(CHANNELS.projectsCreate, async (name: never, namespace: never, targets: never) => {
    const created = await createProject(name, namespace, targets ?? []);
    await session.openProject(created.root);
    await saveConfig({ lastProject: created.root });
    return created;
  });

  handle(CHANNELS.projectsOpen, async (root: never) => {
    // Every pending inverse names files and entries in the project being left. Applied to
    // the next one they would restore something into a project it never belonged to.
    undoable.clear();

    const project = await session.openProject(root);
    await saveConfig({ lastProject: root });
    return project;
  });

  handleRaw(CHANNELS.projectsCurrent, () => ({
    project: session.project,
    root: session.projectRoot,
  }));

  handle(CHANNELS.projectsMeasure, () => {
    const { project, root } = requireProject();
    return measureProject(root, project);
  });

  handle(CHANNELS.projectsDelete, async (root: never) => {
    // Close first: deleting the directory a watcher is bound to leaves the session
    // pointing at files that no longer exist.
    if (session.projectRoot === root) {
      undoable.clear();
      session.closeProject();
    }

    await deleteProject(root);
    const config = await loadConfig();
    if (config.lastProject === root) await saveConfig({ lastProject: null });

    send(EVENTS.log, { level: 'info', source: 'ella', message: `Deleted project ${root}` });
  });

  handle(CHANNELS.projectsClose, () => {
    undoable.clear();
    session.closeProject();
  });

  handle(CHANNELS.projectsUpdateInfo, async (changes: never) => {
    const { project, root } = requireProject();
    const updated = await updateProjectInfo(root, project, changes);
    // Regenerates the slot namespace and pushes to the game: a namespace change alters
    // every model reference, so nothing downstream is still valid.
    await session.setProject(updated);
    return updated;
  });

  handle(CHANNELS.projectsPlanVersionChange, (versionId: never) => {
    const { project, root } = requireProject();
    return planVersionChange(root, project, versionId);
  });

  handle(CHANNELS.projectsApplyVersionChange, async (versionId: never, migrate: never) => {
    const { project, root } = requireProject();
    const result = await applyVersionChange(root, project, versionId, { migrate });

    // Rewritten models are the files the game reads, so the session has to adopt the new
    // project and push: skipping this would leave the running game on the old geometry
    // until something else happened to trigger a reload.
    await session.setProject(result.project);

    if (result.migrated.length > 0) {
      send(EVENTS.log, {
        level: 'info',
        source: 'ella',
        message:
          `Adapted ${result.migrated.length} model(s) to Minecraft ${versionId}: ` +
          result.migrated.join(', '),
      });
    }

    return result;
  });

  handle(CHANNELS.entriesCreate, async (options: never) => {
    const { project, root } = requireProject();
    const { project: updated, entry } = await createEntry(root, project, options);
    await session.setProject(updated);
    return entry;
  });

  handle(CHANNELS.entriesUpdate, async (id: never, patch: never) => {
    const { project, root } = requireProject();
    const previous = findEntry(id).displayName;
    const { project: updated, entry } = await updateEntry(root, project, id, patch);
    await session.setProject(updated);

    // Only the display name. A slot or settings change arrives from a control that already
    // shows its own value, so putting it back is moving that control back.
    if ((patch as { displayName?: unknown }).displayName) {
      offerUndo('entry.renamedTitleDone', { name: entry.displayName.en }, async () => {
        const current = requireProject();
        const reverted = await updateEntry(current.root, current.project, entry.id, {
          displayName: previous,
        });
        await session.setProject(reverted.project);
      });
    }

    return entry;
  });

  handle(CHANNELS.entriesRename, async (id: never, newId: never) => {
    const { project, root } = requireProject();
    const { project: updated, entry } = await renameEntry(root, project, id, newId);
    await session.setProject(updated);

    // renameEntry is a no-op when the id has not changed, and an undo for nothing would be
    // a notification for nothing.
    if (entry.id !== id) {
      offerUndo('entry.renamedDone', { from: id, to: entry.id }, async () => {
        const current = requireProject();
        const reverted = await renameEntry(current.root, current.project, entry.id, id);
        await session.setProject(reverted.project);
      });
    }

    return entry;
  });

  handle(CHANNELS.entriesDuplicate, async (id: never, options: never) => {
    const { project, root } = requireProject();
    const { project: updated, entry, files } = await duplicateEntry(root, project, id, options);
    await session.setProject(updated);

    offerUndo('entry.duplicatedDone', { from: id, to: entry.id }, removeAddedEntry(entry.id, files));
    return entry;
  });

  handle(CHANNELS.entriesInspectModel, async () => {
    const { project, root } = requireProject();
    const file = await pickModelFile();
    if (!file) return null;

    const model = await readModelFile(file);
    const kind = inferModelKind(file, model);
    const suggestedName = nameFromFile(file);
    // The summary does not depend on the id the author will pick, so any valid one plans it.
    const { summary } = await planModelImport(root, project, file, model, { id: 'model', kind });

    return { path: file, fileName: path.basename(file), kind, suggestedName, summary };
  });

  handle(CHANNELS.entriesImportModel, async (options: never) => {
    const { project, root } = requireProject();
    const { path: file, ...entryOptions } = options as ImportModelOptions & { path: string };
    const { project: updated, entry, files } = await importModelAsEntry(
      root,
      project,
      file,
      entryOptions,
    );
    await session.setProject(updated);

    offerUndo(
      'import.createdDone',
      { file: path.basename(file), id: entry.id },
      removeAddedEntry(entry.id, files),
    );
    return entry;
  });

  handle(CHANNELS.entriesReplaceModel, async (id: never) => {
    const { project, root } = requireProject();
    const entry = findEntry(id);
    const file = await pickModelFile();
    if (!file) return null;

    const replaced = await replaceEntryModel(root, project, entry, file);
    // The file watcher would catch this too, but reloading explicitly means the game
    // updates immediately rather than after the debounce window.
    await session.pushAll();

    offerUndo('import.replacedDone', { id: entry.id, file: path.basename(file) }, async () => {
      await undoReplaceModel(requireProject().root, replaced);
      await session.pushAll();
    });
    return replaced.summary;
  });

  handle(CHANNELS.entriesDelete, async (id: never, deleteFiles: never) => {
    const { project, root } = requireProject();
    const { project: updated, entry, index } = await deleteEntry(root, project, id, {
      deleteFiles,
    });
    await session.setProject(updated);

    offerUndo('entry.deletedDone', { id }, async () => {
      const current = requireProject();
      const restored = await restoreEntry(current.root, current.project, entry, index);
      await session.setProject(restored.project);
    });
  });

  handle(CHANNELS.entriesPatchLive, async (id: never, settings: never) => {
    const entry = findEntry(id);
    // Persist first: the on-disk project is the source of truth even if the game is
    // not running or silently ignores a key.
    const { project, root } = requireProject();
    const { project: updated, entry: patched } = await updateEntry(root, project, id, { settings });
    // Settings cannot affect any slot but this entry's own, so only that one is rewritten.
    // This runs once per slider tick — a full namespace rebuild here is what made the
    // editor lag behind the control the user was dragging.
    await session.setEntry(updated, patched);
    return session.patchEntrySettings({ ...entry, settings }, settings);
  });

  handle(CHANNELS.entriesBlockbench, async (id: never) => {
    await session.openEntryInBlockbench(findEntry(id));
  });

  handle(CHANNELS.entriesTextures, (id: never) => {
    const { project, root } = requireProject();
    return listTextures(root, project, findEntry(id));
  });

  handle(CHANNELS.entriesImportTexture, async (id: never, key: never) => {
    const { project, root } = requireProject();
    const entry = findEntry(id);

    if (!window) return null;
    const chosen = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return null;

    const textures = await importTextureFor(root, project, entry, key, chosen.filePaths[0]);
    // The file watcher would catch this too, but reloading explicitly means the game
    // updates immediately rather than after the debounce window.
    await session.pushAll();
    return textures;
  });

  handle(CHANNELS.entriesAddTexture, async (id: never, key: never) => {
    const { project, root } = requireProject();
    const textures = await addTexture(root, project, findEntry(id), key);
    await session.pushAll();
    return textures;
  });

  handle(CHANNELS.entriesRemoveTexture, async (id: never, key: never, deleteFile: never) => {
    const { project, root } = requireProject();
    const { removed, ...result } = await removeTexture(root, project, findEntry(id), key, {
      deleteFile,
    });
    await session.pushAll();

    offerUndo('texture.removedDone', { key }, async () => {
      const current = requireProject();
      await restoreTexture(current.root, current.project, findEntry(id), removed);
      await session.pushAll();
    });

    return result;
  });

  handle(CHANNELS.entriesSetParticle, async (id: never, key: never) => {
    const { project, root } = requireProject();
    const textures = await setParticleTexture(root, project, findEntry(id), key);
    await session.pushAll();
    return textures;
  });

  handle(CHANNELS.entriesPreviews, () => {
    const { project, root } = requireProject();
    return readEntryPreviews(root, project);
  });

  handle(CHANNELS.entriesRemoveModelParent, async (id: never) => {
    const { root } = requireProject();
    const removed = await removeModelParent(root, findEntry(id));
    if (removed === null) return null;

    // The slot redirect points at this file, so what the game loads changes with it.
    await session.pushAll();

    // Ella rewrote a file the author owns, so the way back is the file as it was — not a
    // re-derived version of it, which would also undo whatever Blockbench formatted.
    offerUndo('model.parentRemoved', { parent: removed.parent }, async () => {
      const current = requireProject();
      await writeModelFile(current.root, findEntry(id), removed.original);
      await session.pushAll();
    });

    return removed.parent;
  });

  handle(CHANNELS.entriesRevealTexture, () => {
    const { project, root } = requireProject();
    shell.showItemInFolder(
      path.join(root, 'pack', 'assets', project.namespace, 'textures'),
    );
  });

  handle(CHANNELS.entriesGive, async (id: never) => {
    await session.giveEntry(findEntry(id));
  });

  handle(CHANNELS.entriesPlace, async (id: never) => {
    await session.placeEntry(findEntry(id));
  });

  handle(CHANNELS.undoRun, (token: never) => undoable.run(token));

  handle(CHANNELS.gameLaunch, async (versionId: never) => {
    await session.launch(versionId);
    await saveConfig({ lastVersion: versionId });

    // A project with no version yet adopts the first one it is launched on. Asking instead
    // would be a dialog whose only answer is the version already being launched, and it
    // means every project made before this existed binds itself on its next run.
    if (session.project && session.projectRoot && session.project.targetVersion === null) {
      const { project } = await applyVersionChange(
        session.projectRoot,
        session.project,
        versionId,
        { migrate: false },
      );
      await session.setProject(project, { push: false });
    }
  });

  handle(CHANNELS.gameStop, () => {
    session.stopGame();
  });

  handleRaw(CHANNELS.gameState, () => sessionStateDto());

  handle(CHANNELS.gameReload, async () => {
    await session.pushAll();
  });

  handle(CHANNELS.exportValidate, async () => {
    const { project, root } = requireProject();
    return validateForExport(root, project);
  });

  handle(CHANNELS.exportRun, async (destination: never) => {
    const { project, root } = requireProject();
    return exportResourcePack(root, project, {
      destination,
      packFormat: session.state.connected?.hello.packFormat ?? HIGHEST_KNOWN_PACK_FORMAT,
    });
  });

  handleRaw(CHANNELS.exportSuggestName, () => {
    const { project } = requireProject();
    return defaultExportName(project);
  });

  handleRaw(CHANNELS.blockbenchResolve, () => resolveBlockbenchPath());
  handleRaw(CHANNELS.blockbenchPluginStatus, () => pluginStatus());
  handle(CHANNELS.blockbenchInstallPlugin, () => installPlugin());

  handle(CHANNELS.crashCopy, (diagnostics: never) => {
    clipboard.writeText(formatDiagnostics(diagnostics));
  });

  handle(CHANNELS.crashReveal, (diagnostics: never) => {
    const target = (diagnostics as CrashDiagnostics).crashReportPath;
    if (target) shell.showItemInFolder(target);
    else void shell.openPath(instanceDir((diagnostics as CrashDiagnostics).versionId));
  });

  handleRaw(CHANNELS.dialogSaveFile, async (defaultName: never) => {
    if (!window) return null;
    const result = await dialog.showSaveDialog(window, {
      defaultPath: defaultName,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    return result.canceled ? null : result.filePath;
  });

  handleRaw(CHANNELS.dialogOpenFile, async (filters: never) => {
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: filters ?? [],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}

/**
 * Annotates version summaries with what Ella can do with each: which adapter applies,
 * and whether a usable Java runtime is present.
 */
async function describeVersions(summaries: VersionSummary[]) {
  const runtimes = await discoverJavaRuntimes();
  const majors = new Set(runtimes.map((runtime) => runtime.major));

  return summaries.map((summary) => {
    const required = requiredJavaVersion(summary.id);
    const coverage = adapterCoverageFor(summary.id);

    return {
      id: summary.id,
      type: summary.type,
      releaseTime: summary.releaseTime,
      installed: summary.installed,
      supported: summary.supported,
      adapter: summary.adapter,
      adapterStatus: coverage?.status ?? null,
      adapterBucket: coverage?.id ?? null,
      requiredJava: required,
      // A newer runtime is acceptable only from Java 17 up; below that the exact major
      // is required, which is why this is not a simple `>=` check.
      javaAvailable:
        majors.has(required) ||
        (required >= 17 && [...majors].some((major) => major > required)),
    };
  });
}

function sessionStateDto() {
  const state = session.state;
  return {
    status: state.status,
    versionId: state.versionId,
    projectRoot: state.projectRoot,
    game: state.connected?.hello ?? null,
    capabilities: state.connected ? [...state.connected.capabilities] : [],
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * @param splash   Closed once the main window can paint, or null when there is none.
 * @param shownAt  When the splash appeared, so it can be held for its minimum.
 */
function createWindow(splash: BrowserWindow | null = null, shownAt = 0): void {
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    // Matches --bg, so the frame that shows before the renderer paints is not a flash of
    // a different colour.
    backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const closeSplash = (): void => {
    if (splash && !splash.isDestroyed()) splash.close();
  };

  window.once('ready-to-show', () => {
    const remaining = Math.max(0, MIN_SPLASH_MS - (Date.now() - shownAt));
    setTimeout(() => {
      // The main window comes up first. Closing the splash first would leave a frame of
      // bare desktop where the app should be.
      window?.show();
      closeSplash();
    }, remaining);
  });

  // The splash is always-on-top and has no close button, so it must never be able to
  // outlive a main window that failed to paint.
  const failsafe = setTimeout(closeSplash, 20_000);
  window.once('closed', () => clearTimeout(failsafe));
  window.webContents.once('did-fail-load', closeSplash);

  // Anything that is not the app itself belongs in the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(path.join(dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(async () => {
  setDataRoot(app.getPath('userData'));

  // Up before anything slow runs. Reopening the last project regenerates its pack, which
  // is most of the wait between clicking the icon and seeing a window.
  const startupConfig = await loadConfig();
  const splash = createSplash(translate(startupConfig.locale, 'app.tagline'));
  const splashShownAt = Date.now();

  await ensureLayout();

  registerHandlers();

  session.on('state', () => send(EVENTS.state, sessionStateDto()));
  session.on('project', (project) => send(EVENTS.project, project));
  session.on('log', (entry) => send(EVENTS.log, entry));
  session.on('output', (line) => send(EVENTS.output, line));
  session.on('crash', (diagnostics) => send(EVENTS.crash, diagnostics));
  session.on('files', (files) => send(EVENTS.files, files));
  session.on('error', (error: Error) =>
    send(EVENTS.log, { level: 'error', source: 'ella', message: error.message }),
  );

  try {
    await session.start();
  } catch (error) {
    // A busy port must not stop the app: the editor still works, only live sync is lost.
    send(EVENTS.log, {
      level: 'error',
      source: 'ella',
      message: `Could not bind the Ella port: ${(error as Error).message}`,
    });
  }

  // Reopen whatever was last in use, so the app starts where the user left off.
  if (startupConfig.lastProject) {
    await session.openProject(startupConfig.lastProject).catch(() => {
      // A project that was moved or deleted simply does not reopen.
    });
  }

  createWindow(splash, splashShownAt);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void session.dispose();
});
