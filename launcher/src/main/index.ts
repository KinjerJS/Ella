/**
 * Electron main process: window lifecycle and the IPC surface described in shared/ipc.ts.
 */

import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS, EVENTS, type Result } from '../shared/ipc.ts';
import { setDataRoot, ensureLayout, instanceDir } from './paths.ts';
import { formatDiagnostics, type CrashDiagnostics } from './diagnostics.ts';
import { loadConfig, saveConfig } from './config.ts';
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
  listProjects,
  deleteProject,
  measureProject,
  updateProjectInfo,
  readEntryPreviews,
} from './project.ts';
import {
  listTextures,
  addTexture,
  removeTexture,
  setParticleTexture,
  importTextureFor,
} from './textures.ts';
import { exportResourcePack, validateForExport, defaultExportName } from './export.ts';
import { HIGHEST_KNOWN_PACK_FORMAT } from './pack.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));

let window: BrowserWindow | null = null;
const session = new Session();

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
    if (session.projectRoot === root) session.closeProject();

    await deleteProject(root);
    const config = await loadConfig();
    if (config.lastProject === root) await saveConfig({ lastProject: null });

    send(EVENTS.log, { level: 'info', source: 'ella', message: `Deleted project ${root}` });
  });

  handle(CHANNELS.projectsClose, () => {
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

  handle(CHANNELS.entriesCreate, async (options: never) => {
    const { project, root } = requireProject();
    const { project: updated, entry } = await createEntry(root, project, options);
    await session.setProject(updated);
    return entry;
  });

  handle(CHANNELS.entriesUpdate, async (id: never, patch: never) => {
    const { project, root } = requireProject();
    const { project: updated, entry } = await updateEntry(root, project, id, patch);
    await session.setProject(updated);
    return entry;
  });

  handle(CHANNELS.entriesRename, async (id: never, newId: never) => {
    const { project, root } = requireProject();
    const { project: updated, entry } = await renameEntry(root, project, id, newId);
    await session.setProject(updated);
    return entry;
  });

  handle(CHANNELS.entriesDelete, async (id: never, deleteFiles: never) => {
    const { project, root } = requireProject();
    const updated = await deleteEntry(root, project, id, { deleteFiles });
    await session.setProject(updated);
  });

  handle(CHANNELS.entriesPatchLive, async (id: never, settings: never) => {
    const entry = findEntry(id);
    // Persist first: the on-disk project is the source of truth even if the game is
    // not running or silently ignores a key.
    const { project, root } = requireProject();
    const { project: updated } = await updateEntry(root, project, id, { settings });
    await session.setProject(updated, { push: false });
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
    const result = await removeTexture(root, project, findEntry(id), key, { deleteFile });
    await session.pushAll();
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

  handle(CHANNELS.gameLaunch, async (versionId: never) => {
    await session.launch(versionId);
    await saveConfig({ lastVersion: versionId });
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

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#16161c',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once('ready-to-show', () => window?.show());

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
  const config = await loadConfig();
  if (config.lastProject) {
    await session.openProject(config.lastProject).catch(() => {
      // A project that was moved or deleted simply does not reopen.
    });
  }

  createWindow();

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
