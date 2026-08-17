/**
 * Moving an open project between Minecraft versions.
 *
 * Two halves: {@link planVersionChange} reads every entry's model and reports what would go
 * wrong on the version about to be launched, and {@link applyVersionChange} rewrites those
 * files and records the new version on the project.
 *
 * They are separate because the answer to "what will this break?" has to reach the user
 * *before* anything is written — a migration that happened on the way to a dialog would be
 * a migration nobody agreed to. What counts as broken, and how it is fixed, lives in
 * shared/version-compat.ts; this module only does the file I/O around it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EllaProject } from '../shared/project.ts';
import {
  inspectModel,
  migrateModel,
  isVersionChange,
  type CompatIssue,
} from '../shared/version-compat.ts';
import { saveProject } from './project.ts';

export interface VersionChangeFinding extends CompatIssue {
  entryId: string;
}

export interface VersionChangePlan {
  /** The version the project is bound to, or null when nothing has bound it yet. */
  from: string | null;
  to: string;
  /** True when this launch is a change the user should be asked about. */
  needsConfirmation: boolean;
  findings: VersionChangeFinding[];
  /** How many model files Ella would rewrite — entries, not findings, since two issues in
   *  one model are still one file. */
  fixable: number;
}

const modelPath = (root: string, output: string): string =>
  path.join(root, ...output.split('/'));

/** Reads an entry's model, or null when it is missing or not JSON. */
async function readModel(
  root: string,
  output: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(modelPath(root, output), 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // A missing or malformed model is not a version problem, and validateForExport already
    // reports it properly. Saying nothing here beats inventing a second diagnosis for it.
    return null;
  }
}

/**
 * What launching `to` would mean for this project.
 *
 * The findings are collected whether or not the version actually differs: the same check
 * answers "is this file wrong for the version I am already on?", which is worth knowing.
 */
export async function planVersionChange(
  root: string,
  project: EllaProject,
  to: string,
): Promise<VersionChangePlan> {
  const findings: VersionChangeFinding[] = [];

  for (const entry of project.entries) {
    const model = await readModel(root, entry.model.output);
    if (!model) continue;

    for (const issue of inspectModel(model, to)) {
      findings.push({ ...issue, entryId: entry.id });
    }
  }

  const fixable = new Set(
    findings.filter((finding) => finding.fixable).map((finding) => finding.entryId),
  );

  return {
    from: project.targetVersion,
    to,
    needsConfirmation: isVersionChange(project.targetVersion, to),
    findings,
    fixable: fixable.size,
  };
}

export interface VersionChangeResult {
  project: EllaProject;
  /** Entry ids whose model files were rewritten. */
  migrated: string[];
}

/**
 * Binds the project to `to`, optionally rewriting the models that need it first.
 *
 * Files are written before the manifest: if a rewrite fails, the project still says it is
 * bound to the version its files are actually written for.
 *
 * The rewrite keeps Blockbench's own formatting — two-space JSON with a trailing newline —
 * because these are the author's files and the next save has to see something it
 * recognises rather than a diff of the whole document.
 */
export async function applyVersionChange(
  root: string,
  project: EllaProject,
  to: string,
  options: { migrate: boolean },
): Promise<VersionChangeResult> {
  const migrated: string[] = [];

  if (options.migrate) {
    for (const entry of project.entries) {
      const model = await readModel(root, entry.model.output);
      if (!model) continue;

      const { model: rewritten, applied } = migrateModel(model, to);
      if (applied.length === 0) continue;

      await writeFile(
        modelPath(root, entry.model.output),
        `${JSON.stringify(rewritten, null, 2)}\n`,
        'utf8',
      );
      migrated.push(entry.id);
    }
  }

  const updated: EllaProject = { ...project, targetVersion: to };
  await saveProject(root, updated);

  return { project: updated, migrated };
}
