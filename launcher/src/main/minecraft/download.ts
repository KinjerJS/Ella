/**
 * Download helper with hash verification and bounded concurrency.
 *
 * Verification is not optional here: a truncated library or asset produces a crash deep
 * inside the game with no useful message, and the cost of a hash check is trivial next to
 * re-downloading a version.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat, mkdir, rename, unlink, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

export interface DownloadTask {
  url: string;
  destination: string;
  sha1?: string;
  size?: number;
  /** Shown in progress reporting. */
  label?: string;
}

export interface ProgressReport {
  completed: number;
  total: number;
  bytesDownloaded: number;
  currentLabel?: string;
}

export type ProgressCallback = (report: ProgressReport) => void;

export class DownloadError extends Error {
  url: string;
  override cause?: unknown;

  constructor(url: string, message: string, cause?: unknown) {
    super(`${message} (${url})`);
    this.name = 'DownloadError';
    this.url = url;
    this.cause = cause;
  }
}

export async function sha1Of(filePath: string): Promise<string> {
  const hash = createHash('sha1');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

/** True when the file already on disk matches the expected hash and size. */
export async function isUpToDate(
  filePath: string,
  sha1?: string,
  size?: number,
): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return false;
    if (size !== undefined && stats.size !== size) return false;
    // With no hash to check against, size alone is the best signal available.
    if (!sha1) return true;
    return (await sha1Of(filePath)) === sha1.toLowerCase();
  } catch {
    return false;
  }
}

const MAX_ATTEMPTS = 3;

/**
 * Downloads one file. Writes to a temporary sibling and renames on success, so an
 * interrupted download can never leave a half-written file that later looks valid.
 */
export async function downloadFile(task: DownloadTask, signal?: AbortSignal): Promise<number> {
  if (await isUpToDate(task.destination, task.sha1, task.size)) return 0;

  await mkdir(path.dirname(task.destination), { recursive: true });
  const temporary = `${task.destination}.part`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(task.url, { signal });
      if (!response.ok) {
        throw new DownloadError(task.url, `HTTP ${response.status} ${response.statusText}`);
      }
      if (!response.body) {
        throw new DownloadError(task.url, 'Response had no body');
      }

      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));

      if (task.sha1) {
        const actual = await sha1Of(temporary);
        if (actual !== task.sha1.toLowerCase()) {
          throw new DownloadError(
            task.url,
            `Checksum mismatch: expected ${task.sha1}, got ${actual}`,
          );
        }
      }

      await rename(temporary, task.destination);
      return (await stat(task.destination)).size;
    } catch (error) {
      lastError = error;
      await unlink(temporary).catch(() => {});
      // An aborted download is a deliberate cancellation, not a transient failure.
      if (signal?.aborted) throw error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }
  }

  throw lastError instanceof DownloadError
    ? lastError
    : new DownloadError(task.url, 'Download failed after retries', lastError);
}

/**
 * Downloads many files with at most `concurrency` in flight.
 *
 * Failures are collected rather than aborting the whole batch on the first error: a
 * partial install that reports exactly what is missing is far more useful than one that
 * stops at the first bad url.
 */
export async function downloadAll(
  tasks: DownloadTask[],
  options: {
    concurrency?: number;
    onProgress?: ProgressCallback;
    signal?: AbortSignal;
  } = {},
): Promise<{ bytesDownloaded: number; failures: DownloadError[] }> {
  const { concurrency = 8, onProgress, signal } = options;

  let completed = 0;
  let bytesDownloaded = 0;
  const failures: DownloadError[] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted) return;
      const index = next++;
      if (index >= tasks.length) return;
      const task = tasks[index];

      try {
        bytesDownloaded += await downloadFile(task, signal);
      } catch (error) {
        failures.push(
          error instanceof DownloadError
            ? error
            : new DownloadError(task.url, 'Download failed', error),
        );
      }

      completed++;
      onProgress?.({
        completed,
        total: tasks.length,
        bytesDownloaded,
        currentLabel: task.label,
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );

  return { bytesDownloaded, failures };
}

/** Fetches and parses JSON, with the same retry behaviour as file downloads. */
export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new DownloadError(url, `HTTP ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError instanceof DownloadError
    ? lastError
    : new DownloadError(url, 'Request failed after retries', lastError);
}
