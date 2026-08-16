/**
 * Contract between the Electron main process and the renderer.
 *
 * The renderer has no Node access; everything it can do is listed here and exposed by the
 * preload script as `window.ella`.
 */

import type { EllaProject, ProjectEntry } from './project.ts';
import type { EntryKind, LocaleMap, HelloPayload, LogPayload } from './protocol.ts';
import type { Locale } from './i18n.ts';

export interface AppConfigDto {
  locale: Locale;
  blockbenchPath: string | null;
  username: string;
  maxMemoryMb: number;
  ellaPort: number;
  slotPool: Record<EntryKind, number>;
  showSnapshots: boolean;
  lastProject: string | null;
  lastVersion: string | null;
}

export interface JavaRuntimeDto {
  path: string;
  major: number;
  version: string;
  origin: string;
}

export interface VersionSummaryDto {
  id: string;
  type: string;
  releaseTime: string;
  installed: boolean;
  supported: boolean;
  /** Adapter id when one is built for this version, otherwise null. */
  adapter: string | null;
  /**
   * Whether an adapter covers this version at all, and if so whether its jar exists.
   * `planned` means live editing is designed for but not available yet — a different
   * situation from no adapter applying, and the UI says which.
   */
  adapterStatus: 'built' | 'planned' | null;
  /** The bucket that covers it, built or not, for display. */
  adapterBucket: string | null;
  /** Java major version this release needs. */
  requiredJava: number;
  /** Whether a matching runtime was found on this machine. */
  javaAvailable: boolean;
}

export interface ProjectSummaryDto {
  name: string;
  namespace: string;
  root: string;
  entryCount: number;
}

export interface TextureVariableDto {
  key: string;
  reference: string;
  relativePath: string | null;
  exists: boolean;
  dataUri: string | null;
  width: number | null;
  height: number | null;
  /** True when the model's `particle` variable points at the same file. */
  isParticle: boolean;
  /** True when this row *is* the `particle` variable rather than a drawable one. */
  isParticleSlot: boolean;
  usedByFaces: string[];
}

export interface TextureInfoDto {
  path: string;
  relativePath: string;
  exists: boolean;
  /** True while the file is still the generated checkerboard. */
  isPlaceholder: boolean;
  dataUri: string | null;
  width: number | null;
  height: number | null;
}

export interface EntryPreviewDto {
  id: string;
  /** Parsed model JSON, or null when missing or unreadable. */
  model: unknown | null;
  textureDataUri: string | null;
  textureWidth: number | null;
  textureHeight: number | null;
}

export interface CrashDiagnosticsDto {
  versionId: string;
  exitCode: number | null;
  /** Short human-readable cause, when one could be identified. */
  summary: string;
  environment: Record<string, string>;
  crashReport: string | null;
  crashReportPath: string | null;
  output: string[];
  mods: string[];
}

export interface ProjectFootprintDto {
  entryCount: number;
  bytes: number;
  /** Files that are the author's own work, excluding generated slot plumbing. */
  authoredFiles: number;
}

export interface InstallFootprintDto {
  versionBytes: number;
  instanceBytes: number;
  hasInstance: boolean;
}

export interface UninstallResultDto {
  removed: string[];
  kept: Array<{ path: string; reason: 'shared' | 'user-data' }>;
}

export type GameStatusDto = 'stopped' | 'starting' | 'running' | 'connected';

export interface SessionStateDto {
  status: GameStatusDto;
  versionId: string | null;
  projectRoot: string | null;
  /** Null until the mod completes its handshake. */
  game: HelloPayload | null;
  capabilities: string[];
}

export interface ProgressDto {
  phase: 'download' | 'install' | 'export';
  completed: number;
  total: number;
  bytes: number;
  label?: string;
}

export interface ExportIssueDto {
  entryId: string;
  messageKey: string;
  severity: 'warning' | 'error';
}

export interface ExportResultDto {
  path: string;
  fileCount: number;
  bytes: number;
}

export interface SettingsPatchResultDto {
  applied: string[];
  ignored: string[];
}

/** Uniform result wrapper: IPC never rejects, so the UI always has something to show. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export interface EllaApi {
  config: {
    get(): Promise<AppConfigDto>;
    set(patch: Partial<AppConfigDto>): Promise<AppConfigDto>;
  };

  java: {
    list(): Promise<JavaRuntimeDto[]>;
  };

  versions: {
    list(options?: { includeSnapshots?: boolean; force?: boolean }): Promise<
      Result<VersionSummaryDto[]>
    >;
    /** Installed versions read from disk alone — instant, and works offline. */
    installed(): Promise<Result<VersionSummaryDto[]>>;
    install(versionId: string): Promise<Result<{ failures: number }>>;
    /** What an uninstall would reclaim, so the confirmation can be specific. */
    measure(versionId: string): Promise<Result<InstallFootprintDto>>;
    uninstall(
      versionId: string,
      removeInstanceData: boolean,
    ): Promise<Result<UninstallResultDto>>;
  };

  projects: {
    list(): Promise<ProjectSummaryDto[]>;
    create(name: string, namespace: string, targetVersions: string[]): Promise<
      Result<{ project: EllaProject; root: string }>
    >;
    open(root: string): Promise<Result<EllaProject>>;
    current(): Promise<{ project: EllaProject | null; root: string | null }>;
    /** What deleting the open project would destroy. */
    measure(): Promise<Result<ProjectFootprintDto>>;
    delete(root: string): Promise<Result<void>>;
    close(): Promise<Result<void>>;
    /** Edits the open project's name, namespace and target versions. */
    updateInfo(changes: {
      name?: string;
      namespace?: string;
      targetVersions?: string[];
    }): Promise<Result<EllaProject>>;
  };

  entries: {
    create(options: { id: string; kind: EntryKind; displayName: LocaleMap }): Promise<
      Result<ProjectEntry>
    >;
    update(
      id: string,
      patch: { displayName?: LocaleMap; settings?: Record<string, unknown>; slot?: number | null },
    ): Promise<Result<ProjectEntry>>;
    delete(id: string, deleteFiles: boolean): Promise<Result<void>>;
    /** Changes an entry's identifier, moving the files named after it. */
    rename(id: string, newId: string): Promise<Result<ProjectEntry>>;
    /** Live settings change; returns which keys the running version honoured. */
    patchLive(id: string, settings: Record<string, unknown>): Promise<
      Result<SettingsPatchResultDto | null>
    >;
    openInBlockbench(id: string): Promise<Result<void>>;
    /** The model's texture variables, with previews. */
    textures(id: string): Promise<Result<TextureVariableDto[]>>;
    /** Opens a file picker and replaces the PNG a variable points at. */
    importTexture(id: string, key: string): Promise<Result<TextureVariableDto[] | null>>;
    addTexture(id: string, key: string): Promise<Result<TextureVariableDto[]>>;
    removeTexture(
      id: string,
      key: string,
      deleteFile: boolean,
    ): Promise<Result<{ textures: TextureVariableDto[]; orphanedFaces: string[] }>>;
    /** Points the model's `particle` variable at this one, or clears it with null. */
    setParticleTexture(id: string, key: string | null): Promise<Result<TextureVariableDto[]>>;
    revealTexture(id: string): Promise<Result<void>>;
    /** Preview data for every entry, batched for the card grid. */
    previews(): Promise<Result<EntryPreviewDto[]>>;
    give(id: string): Promise<Result<void>>;
    place(id: string): Promise<Result<void>>;
  };

  game: {
    launch(versionId: string): Promise<Result<void>>;
    stop(): Promise<Result<void>>;
    state(): Promise<SessionStateDto>;
    reload(): Promise<Result<void>>;
  };

  exporter: {
    validate(): Promise<Result<ExportIssueDto[]>>;
    run(destination: string): Promise<Result<ExportResultDto>>;
    suggestName(): Promise<string>;
  };

  blockbench: {
    pluginStatus(): Promise<{ installed: boolean; outdated: boolean; installedPath: string }>;
    installPlugin(): Promise<Result<string>>;
  };

  crash: {
    /** Copies a formatted report to the clipboard, ready to paste into a bug report. */
    copy(diagnostics: CrashDiagnosticsDto): Promise<Result<void>>;
    /** Reveals the crash report, or the game folder when there is no report file. */
    reveal(diagnostics: CrashDiagnosticsDto): Promise<Result<void>>;
  };

  dialog: {
    saveFile(defaultName: string): Promise<string | null>;
    openFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
  };

  /** Subscriptions. Each returns an unsubscribe function. */
  on: {
    state(handler: (state: SessionStateDto) => void): () => void;
    /** Null when the project is closed or deleted. */
    project(handler: (project: EllaProject | null) => void): () => void;
    log(handler: (entry: LogPayload) => void): () => void;
    output(handler: (line: string) => void): () => void;
    progress(handler: (progress: ProgressDto) => void): () => void;
    /** Fires when the game exits with a non-zero code. */
    crash(handler: (diagnostics: CrashDiagnosticsDto) => void): () => void;
    /** Fires when watched model or texture files change on disk. */
    files(handler: (paths: string[]) => void): () => void;
  };
}

/** Channel names, kept in one place so main and preload cannot drift. */
export const CHANNELS = {
  configGet: 'config:get',
  configSet: 'config:set',
  javaList: 'java:list',
  versionsList: 'versions:list',
  versionsInstall: 'versions:install',
  versionsInstalled: 'versions:installed',
  versionsMeasure: 'versions:measure',
  versionsUninstall: 'versions:uninstall',
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsOpen: 'projects:open',
  projectsCurrent: 'projects:current',
  projectsMeasure: 'projects:measure',
  projectsDelete: 'projects:delete',
  projectsClose: 'projects:close',
  projectsUpdateInfo: 'projects:updateInfo',
  entriesCreate: 'entries:create',
  entriesUpdate: 'entries:update',
  entriesDelete: 'entries:delete',
  entriesRename: 'entries:rename',
  entriesPatchLive: 'entries:patchLive',
  entriesBlockbench: 'entries:blockbench',
  entriesTextures: 'entries:textures',
  entriesImportTexture: 'entries:importTexture',
  entriesAddTexture: 'entries:addTexture',
  entriesRemoveTexture: 'entries:removeTexture',
  entriesSetParticle: 'entries:setParticle',
  entriesRevealTexture: 'entries:revealTexture',
  entriesPreviews: 'entries:previews',
  entriesGive: 'entries:give',
  entriesPlace: 'entries:place',
  gameLaunch: 'game:launch',
  gameStop: 'game:stop',
  gameState: 'game:state',
  gameReload: 'game:reload',
  exportValidate: 'export:validate',
  exportRun: 'export:run',
  exportSuggestName: 'export:suggestName',
  blockbenchPluginStatus: 'blockbench:pluginStatus',
  blockbenchInstallPlugin: 'blockbench:installPlugin',
  crashCopy: 'crash:copy',
  crashReveal: 'crash:reveal',
  dialogSaveFile: 'dialog:saveFile',
  dialogOpenFile: 'dialog:openFile',
} as const;

export const EVENTS = {
  state: 'event:state',
  project: 'event:project',
  log: 'event:log',
  output: 'event:output',
  progress: 'event:progress',
  crash: 'event:crash',
  files: 'event:files',
} as const;
