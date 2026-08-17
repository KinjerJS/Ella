/**
 * Crash diagnostics.
 *
 * When the game exits badly, the useful information is scattered: an exit code here, a
 * crash report there, a mod list somewhere else. This gathers it into one block a user
 * can copy into a bug report without knowing where any of it lives.
 *
 * Minecraft's own crash report is the most valuable part and is preferred over stdout,
 * which is usually just the tail of a stack trace with no context.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { instanceDir, instanceModsDir } from './paths.ts';
import { findForgeVersionId } from './minecraft/forge.ts';
import { selectJavaFor } from './java-runtime.ts';
import { adapterCoverageFor, requiredJavaVersion } from '../shared/version.ts';
import { APP_VERSION } from '../shared/app.ts';

/** Crash reports run long; keep enough to diagnose without producing an unusable wall. */
const MAX_CRASH_REPORT_LINES = 120;
const MAX_LOG_LINES = 80;

export interface CrashDiagnostics {
  versionId: string;
  /**
   * `launch` means the game process never started — the failure was launcher-side.
   * `runtime` means it started and then exited badly.
   */
  phase: 'launch' | 'runtime';
  exitCode: number | null;
  /** Short human-readable cause, when one can be identified. */
  summary: string;
  environment: Record<string, string>;
  /** Contents of Minecraft's own crash report, trimmed. */
  crashReport: string | null;
  crashReportPath: string | null;
  /** Tail of the game's stdout/stderr as captured by the launcher. */
  output: string[];
  mods: string[];
}

async function newestFileIn(directory: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return null;
  }

  let newest: { path: string; mtime: number } | null = null;
  for (const name of entries) {
    const full = path.join(directory, name);
    const stats = await stat(full).catch(() => null);
    if (!stats?.isFile()) continue;
    if (!newest || stats.mtimeMs > newest.mtime) {
      newest = { path: full, mtime: stats.mtimeMs };
    }
  }
  return newest?.path ?? null;
}

/** Keeps the head of a file, which is where the cause is, and notes what was cut. */
function trimToLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return [
    ...lines.slice(0, maxLines),
    `… ${lines.length - maxLines} more lines omitted`,
  ].join('\n');
}

/**
 * Extracts a one-line cause from a crash report or the captured output.
 *
 * Pattern-matched rather than guessed at: these are the shapes Forge and the JVM actually
 * produce, and anything unrecognised falls back to saying so rather than inventing a
 * diagnosis.
 */
function summarise(crashReport: string | null, output: string[], exitCode: number | null): string {
  const haystack = [crashReport ?? '', ...output].join('\n');

  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/Failure message:\s*(.+)/, (m) => m[1].trim()],
    [/Caused by:\s*(.+)/, (m) => m[1].trim()],
    [
      /java\.lang\.(\w+Exception|\w+Error)(?::\s*(.+))?/,
      (m) => (m[2] ? `${m[1]}: ${m[2].trim()}` : m[1]),
    ],
    [/Description:\s*(.+)/, (m) => m[1].trim()],
    [/Mod .+ requires .+/, (m) => m[0].trim()],
  ];

  for (const [pattern, format] of patterns) {
    const match = haystack.match(pattern);
    if (match) return format(match);
  }

  if (exitCode === null) return 'The game stopped unexpectedly.';
  return `The game exited with code ${exitCode} and left no crash report.`;
}

/**
 * Diagnostics for a launch that failed before the game process started.
 *
 * These are worth surfacing the same way as a crash: from the user's side "it did not
 * start" looks identical whether the failure was in the launcher or the game, and the
 * environment block is exactly what makes the difference diagnosable.
 */
export async function collectLaunchFailureDiagnostics(
  versionId: string,
  error: Error,
): Promise<CrashDiagnostics> {
  const diagnostics = await collectCrashDiagnostics(versionId, null, []);

  return {
    ...diagnostics,
    phase: 'launch',
    summary: error.message,
    // The game never ran, so anything already on disk belongs to an earlier session and
    // would point at the wrong thing.
    crashReport: null,
    crashReportPath: null,
    output: [`${error.name}: ${error.message}`, ...(error.stack?.split('\n').slice(1, 8) ?? [])],
  };
}

export interface CrashContext {
  /** The runtime the launch actually used, when a launch got that far. */
  javaUsed?: { major: number; version: string; path: string };
  /** The version file that was launched, which for a modded run is not `versionId`. */
  launchedVersionId?: string;
}

export async function collectCrashDiagnostics(
  versionId: string,
  exitCode: number | null,
  output: string[],
  context: CrashContext = {},
): Promise<CrashDiagnostics> {
  const gameDir = instanceDir(versionId);

  const crashReportPath = await newestFileIn(path.join(gameDir, 'crash-reports'));
  let crashReport: string | null = null;
  if (crashReportPath) {
    // Only a crash report from this run is relevant; an older one would be misleading.
    const stats = await stat(crashReportPath).catch(() => null);
    const isRecent = stats ? Date.now() - stats.mtimeMs < 5 * 60_000 : false;
    if (isRecent) {
      crashReport = trimToLines(
        await readFile(crashReportPath, 'utf8').catch(() => ''),
        MAX_CRASH_REPORT_LINES,
      );
    }
  }

  // The Forge mod-loading error screen writes to the log rather than a crash report.
  if (!crashReport) {
    const logPath = path.join(gameDir, 'logs', 'latest.log');
    const log = await readFile(logPath, 'utf8').catch(() => null);
    if (log) {
      const errorLines = log
        .split('\n')
        .filter((line) => /ERROR|FATAL|Exception|Caused by/.test(line))
        .slice(-MAX_LOG_LINES);
      if (errorLines.length > 0) crashReport = errorLines.join('\n');
    }
  }

  const mods = await readdir(instanceModsDir(versionId)).catch(() => []);

  const coverage = adapterCoverageFor(versionId);
  const forgeVersionId = await findForgeVersionId(versionId);

  // Prefer the runtime the launch actually used. Re-deriving it here would describe what
  // Ella *would* pick now, which is exactly the wrong thing when the bug being diagnosed
  // is a bad pick — the report would agree with itself and hide the fault.
  const java =
    context.javaUsed ?? (await selectJavaFor(versionId).catch(() => null));

  const environment: Record<string, string> = {
    'Ella': APP_VERSION,
    'Minecraft': versionId,
    'Forge': forgeVersionId ?? 'not installed',
    'Launched': context.launchedVersionId ?? versionId,
    'Adapter': coverage ? `${coverage.id} (${coverage.status})` : 'none for this version',
    'Java (required)': String(requiredJavaVersion(versionId)),
    'Java (used)': java
      ? `${java.major} — ${java.version}${context.javaUsed ? '' : ' (not confirmed)'}`
      : 'none found',
    'OS': `${os.platform()} ${os.release()} ${os.arch()}`,
    'Game directory': gameDir,
  };

  return {
    versionId,
    phase: 'runtime',
    exitCode,
    summary: summarise(crashReport, output, exitCode),
    environment,
    crashReport,
    crashReportPath,
    output: output.slice(-MAX_LOG_LINES),
    mods,
  };
}

/**
 * Formats diagnostics as Markdown, ready to paste into an issue.
 *
 * Markdown rather than plain text because the destination is almost always a tracker or
 * a chat window, and fenced blocks stop logs being mangled into unreadable prose.
 */
export function formatDiagnostics(diagnostics: CrashDiagnostics): string {
  const lines: string[] = [];

  const phase = diagnostics.phase === 'launch' ? 'launch failure' : 'crash';
  lines.push(`**Ella ${phase} report — Minecraft ${diagnostics.versionId}**`, '');
  lines.push(`**Cause:** ${diagnostics.summary}`, '');

  lines.push('**Environment**', '');
  for (const [key, value] of Object.entries(diagnostics.environment)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push('');

  lines.push(`**Mods** (${diagnostics.mods.length})`, '');
  lines.push(diagnostics.mods.length > 0 ? diagnostics.mods.map((m) => `- ${m}`).join('\n') : '- none');
  lines.push('');

  if (diagnostics.crashReport) {
    lines.push(`**Crash report** (${diagnostics.crashReportPath ?? 'from latest.log'})`, '');
    lines.push('```', diagnostics.crashReport, '```', '');
  }

  if (diagnostics.output.length > 0) {
    lines.push('**Launcher output**', '');
    lines.push('```', diagnostics.output.join('\n'), '```');
  }

  return lines.join('\n');
}
