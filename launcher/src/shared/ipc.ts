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
  /** The Minecraft version it is authored against, or null when unbound. */
  targetVersion: string | null;
}

/** One thing in the project's files that a version change would break. */
export interface CompatFindingDto {
  entryId: string;
  /** A {@link CompatIssueId}; also the suffix of its `compat.issue.*` message. */
  issue: string;
  /** True when Ella can rewrite the file itself. */
  fixable: boolean;
  /** Interpolation values for the message. */
  detail: Record<string, string | number>;
}

export interface VersionChangePlanDto {
  /** The version the project is bound to, or null when nothing has bound it yet. */
  from: string | null;
  to: string;
  /** True when this launch is a change worth stopping for. */
  needsConfirmation: boolean;
  findings: CompatFindingDto[];
  /** How many findings Ella can rewrite the files for. */
  fixable: number;
}

export interface VersionChangeResultDto {
  project: EllaProject;
  /** Entry ids whose model files were rewritten. */
  migrated: string[];
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

/** What importing a model file brings with it, reported before and after the import. */
export interface ModelImportSummaryDto {
  /** Images found beside the file and copied into the project. */
  imported: number;
  /** References left pointing at Minecraft's own textures. */
  vanilla: number;
  /** References nothing could be found for, each backed by a placeholder. */
  missing: string[];
  /** A parent this project cannot supply, which stops the model loading; null when fine. */
  missingParent: string | null;
}

/** A model file picked for import, read but not yet written anywhere. */
export interface ModelImportPreviewDto {
  path: string;
  fileName: string;
  /** Inferred from the file; the author can change it before importing. */
  kind: EntryKind;
  /** Derived from the file name. */
  suggestedName: string;
  summary: ModelImportSummaryDto;
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

/**
 * An action that can still be taken back, pushed as an event the moment it happens.
 *
 * Sent rather than returned so the offer is independent of whichever call produced it: the
 * notification layer subscribes once, and a handler becomes undoable by registering an
 * inverse instead of by changing its signature.
 */
export interface UndoOfferDto {
  token: string;
  /** i18n key describing what happened; the renderer translates it. */
  messageKey: string;
  values: Record<string, string | number>;
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
    create(name: string, namespace: string, targetVersion: string | null): Promise<
      Result<{ project: EllaProject; root: string }>
    >;
    open(root: string): Promise<Result<EllaProject>>;
    current(): Promise<{ project: EllaProject | null; root: string | null }>;
    /** What deleting the open project would destroy. */
    measure(): Promise<Result<ProjectFootprintDto>>;
    delete(root: string): Promise<Result<void>>;
    close(): Promise<Result<void>>;
    /** Edits the open project's name, namespace and target version. */
    updateInfo(changes: {
      name?: string;
      namespace?: string;
      /** Null unbinds it; omitted leaves it alone. */
      targetVersion?: string | null;
    }): Promise<Result<EllaProject>>;
    /**
     * What launching `versionId` would mean for the open project, without changing
     * anything. Reads every entry's model, so it is the answer for the files as they
     * actually are rather than as the manifest describes them.
     */
    planVersionChange(versionId: string): Promise<Result<VersionChangePlanDto>>;
    /** Binds the project to `versionId`, rewriting the models that need it when asked. */
    applyVersionChange(
      versionId: string,
      migrate: boolean,
    ): Promise<Result<VersionChangeResultDto>>;
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
    /**
     * Copies an entry with its own model, textures and settings. An omitted id takes the
     * next in the series — `lamp_1`, `lamp_2`… — with display names numbered to match.
     */
    duplicate(
      id: string,
      options: { id?: string; displayName?: LocaleMap },
    ): Promise<Result<ProjectEntry>>;
    /**
     * Opens a file picker for a model JSON and reads it, without importing anything.
     * Resolves to null when the picker is cancelled.
     */
    inspectModel(): Promise<Result<ModelImportPreviewDto | null>>;
    /** Adds an entry whose model is a file picked with {@link inspectModel}. */
    importModel(options: {
      path: string;
      id: string;
      kind: EntryKind;
      displayName: LocaleMap;
    }): Promise<Result<ProjectEntry>>;
    /**
     * Opens a file picker and replaces an entry's model with the chosen JSON.
     * Resolves to null when the picker is cancelled.
     */
    replaceModel(id: string): Promise<Result<ModelImportSummaryDto | null>>;
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
    /**
     * Strips a `parent` that would override the model's own geometry on 1.8.x.
     * Resolves to the removed parent, or null when there was nothing to fix.
     */
    removeModelParent(id: string): Promise<Result<string | null>>;
    /** Preview data for every entry, batched for the card grid. */
    previews(): Promise<Result<EntryPreviewDto[]>>;
    give(id: string): Promise<Result<void>>;
    place(id: string): Promise<Result<void>>;
  };

  undo: {
    /** Reverses the action a {@link UndoOfferDto} names. One-shot. */
    run(token: string): Promise<Result<void>>;
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
    /**
     * The executable Ella would actually launch, or null when it cannot find one.
     *
     * Not the same as the configured path: Blockbench is usually auto-detected, so an
     * empty setting says nothing about whether opening a model will work.
     */
    resolve(): Promise<string | null>;
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
    /** Fires after a change that can still be taken back. */
    undo(handler: (offer: UndoOfferDto) => void): () => void;
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
  projectsPlanVersionChange: 'projects:planVersionChange',
  projectsApplyVersionChange: 'projects:applyVersionChange',
  entriesCreate: 'entries:create',
  entriesUpdate: 'entries:update',
  entriesDelete: 'entries:delete',
  entriesRename: 'entries:rename',
  entriesDuplicate: 'entries:duplicate',
  entriesInspectModel: 'entries:inspectModel',
  entriesImportModel: 'entries:importModel',
  entriesReplaceModel: 'entries:replaceModel',
  entriesPatchLive: 'entries:patchLive',
  entriesBlockbench: 'entries:blockbench',
  entriesTextures: 'entries:textures',
  entriesImportTexture: 'entries:importTexture',
  entriesAddTexture: 'entries:addTexture',
  entriesRemoveTexture: 'entries:removeTexture',
  entriesSetParticle: 'entries:setParticle',
  entriesRevealTexture: 'entries:revealTexture',
  entriesRemoveModelParent: 'entries:removeModelParent',
  entriesPreviews: 'entries:previews',
  entriesGive: 'entries:give',
  entriesPlace: 'entries:place',
  undoRun: 'undo:run',
  gameLaunch: 'game:launch',
  gameStop: 'game:stop',
  gameState: 'game:state',
  gameReload: 'game:reload',
  exportValidate: 'export:validate',
  exportRun: 'export:run',
  exportSuggestName: 'export:suggestName',
  blockbenchResolve: 'blockbench:resolve',
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
  undo: 'event:undo',
} as const;
