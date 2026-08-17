/**
 * Preload bridge.
 *
 * The renderer runs with context isolation and no Node integration, so this file is the
 * only surface it can reach. Every exposed function maps to a channel in shared/ipc.ts —
 * nothing is forwarded generically, which keeps the attack surface enumerable.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS, EVENTS, type EllaApi } from '../shared/ipc.ts';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

/** Subscribes to a main-process event and returns an unsubscribe function. */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const api: EllaApi = {
  config: {
    get: () => invoke(CHANNELS.configGet),
    set: (patch) => invoke(CHANNELS.configSet, patch),
  },

  java: {
    list: () => invoke(CHANNELS.javaList),
  },

  versions: {
    list: (options) => invoke(CHANNELS.versionsList, options),
    installed: () => invoke(CHANNELS.versionsInstalled),
    install: (versionId) => invoke(CHANNELS.versionsInstall, versionId),
    measure: (versionId) => invoke(CHANNELS.versionsMeasure, versionId),
    uninstall: (versionId, removeInstanceData) =>
      invoke(CHANNELS.versionsUninstall, versionId, removeInstanceData),
  },

  projects: {
    list: () => invoke(CHANNELS.projectsList),
    create: (name, namespace, targetVersion) =>
      invoke(CHANNELS.projectsCreate, name, namespace, targetVersion),
    open: (root) => invoke(CHANNELS.projectsOpen, root),
    current: () => invoke(CHANNELS.projectsCurrent),
    measure: () => invoke(CHANNELS.projectsMeasure),
    delete: (root) => invoke(CHANNELS.projectsDelete, root),
    close: () => invoke(CHANNELS.projectsClose),
    updateInfo: (changes) => invoke(CHANNELS.projectsUpdateInfo, changes),
    planVersionChange: (versionId) => invoke(CHANNELS.projectsPlanVersionChange, versionId),
    applyVersionChange: (versionId, migrate) =>
      invoke(CHANNELS.projectsApplyVersionChange, versionId, migrate),
  },

  entries: {
    create: (options) => invoke(CHANNELS.entriesCreate, options),
    update: (id, patch) => invoke(CHANNELS.entriesUpdate, id, patch),
    delete: (id, deleteFiles) => invoke(CHANNELS.entriesDelete, id, deleteFiles),
    rename: (id, newId) => invoke(CHANNELS.entriesRename, id, newId),
    patchLive: (id, settings) => invoke(CHANNELS.entriesPatchLive, id, settings),
    openInBlockbench: (id) => invoke(CHANNELS.entriesBlockbench, id),
    textures: (id) => invoke(CHANNELS.entriesTextures, id),
    importTexture: (id, key) => invoke(CHANNELS.entriesImportTexture, id, key),
    addTexture: (id, key) => invoke(CHANNELS.entriesAddTexture, id, key),
    removeTexture: (id, key, deleteFile) =>
      invoke(CHANNELS.entriesRemoveTexture, id, key, deleteFile),
    setParticleTexture: (id, key) => invoke(CHANNELS.entriesSetParticle, id, key),
    revealTexture: (id) => invoke(CHANNELS.entriesRevealTexture, id),
    removeModelParent: (id) => invoke(CHANNELS.entriesRemoveModelParent, id),
    previews: () => invoke(CHANNELS.entriesPreviews),
    give: (id) => invoke(CHANNELS.entriesGive, id),
    place: (id) => invoke(CHANNELS.entriesPlace, id),
  },

  undo: {
    run: (token) => invoke(CHANNELS.undoRun, token),
  },

  game: {
    launch: (versionId) => invoke(CHANNELS.gameLaunch, versionId),
    stop: () => invoke(CHANNELS.gameStop),
    state: () => invoke(CHANNELS.gameState),
    reload: () => invoke(CHANNELS.gameReload),
  },

  exporter: {
    validate: () => invoke(CHANNELS.exportValidate),
    run: (destination) => invoke(CHANNELS.exportRun, destination),
    suggestName: () => invoke(CHANNELS.exportSuggestName),
  },

  blockbench: {
    resolve: () => invoke(CHANNELS.blockbenchResolve),
    pluginStatus: () => invoke(CHANNELS.blockbenchPluginStatus),
    installPlugin: () => invoke(CHANNELS.blockbenchInstallPlugin),
  },

  crash: {
    copy: (diagnostics) => invoke(CHANNELS.crashCopy, diagnostics),
    reveal: (diagnostics) => invoke(CHANNELS.crashReveal, diagnostics),
  },

  dialog: {
    saveFile: (defaultName) => invoke(CHANNELS.dialogSaveFile, defaultName),
    openFile: (filters) => invoke(CHANNELS.dialogOpenFile, filters),
  },

  on: {
    state: (handler) => subscribe(EVENTS.state, handler),
    project: (handler) => subscribe(EVENTS.project, handler),
    log: (handler) => subscribe(EVENTS.log, handler),
    output: (handler) => subscribe(EVENTS.output, handler),
    progress: (handler) => subscribe(EVENTS.progress, handler),
    crash: (handler) => subscribe(EVENTS.crash, handler),
    files: (handler) => subscribe(EVENTS.files, handler),
    undo: (handler) => subscribe(EVENTS.undo, handler),
  },
};

contextBridge.exposeInMainWorld('ella', api);
