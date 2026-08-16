/**
 * Mojang version metadata.
 *
 * These files changed shape over the range Ella supports, and both shapes are still
 * live: 1.12.2 and older carry a single `minecraftArguments` string, while 1.13+ use the
 * structured `arguments` object. Modded version files (the ones Forge installers write)
 * additionally use `inheritsFrom` to layer onto a vanilla version.
 */

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: ManifestEntry[];
}

export interface ManifestEntry {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel: number;
}

export interface DownloadInfo {
  url: string;
  sha1: string;
  size: number;
  /** Present on library artifacts: the path under `libraries/`. */
  path?: string;
}

export interface Rule {
  action: 'allow' | 'disallow';
  os?: { name?: string; version?: string; arch?: string };
  features?: Record<string, boolean>;
}

export interface Library {
  name: string;
  downloads?: {
    artifact?: DownloadInfo;
    classifiers?: Record<string, DownloadInfo>;
  };
  /** Legacy natives mapping, e.g. `{ windows: "natives-windows" }`. */
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
  rules?: Rule[];
  /** Forge-style libraries sometimes give only a Maven base url. */
  url?: string;
}

export interface AssetIndexInfo extends DownloadInfo {
  id: string;
  totalSize?: number;
}

export type Argument = string | { rules?: Rule[]; value: string | string[] };

export interface VersionJson {
  id: string;
  type: string;
  mainClass: string;
  /** Asset index id. `pre-1.6` and `legacy` need the virtual asset layout. */
  assets?: string;
  assetIndex?: AssetIndexInfo;
  downloads?: Record<string, DownloadInfo>;
  libraries: Library[];
  /** 1.13+ */
  arguments?: { game?: Argument[]; jvm?: Argument[] };
  /** 1.12.2 and older */
  minecraftArguments?: string;
  javaVersion?: { component: string; majorVersion: number };
  /** Set by modded version files; the named version must be resolved and merged in. */
  inheritsFrom?: string;
  releaseTime?: string;
  time?: string;
  logging?: unknown;

  /**
   * Ella's own field, not Mojang's: the id of the vanilla version a merged file was
   * built from.
   *
   * A modded version has its own id but no client jar — the jar lives under the version
   * it inherits from. Without recording that, the classpath points at a jar that does
   * not exist.
   */
  ellaBaseVersionId?: string;
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
  /** Older indexes are "virtual": assets must be materialised by name, not by hash. */
  virtual?: boolean;
  /** 1.19+ resource-pack-style indexes map to the resources directory. */
  map_to_resources?: boolean;
}
