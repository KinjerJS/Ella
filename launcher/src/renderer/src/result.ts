/**
 * Helpers for the `Result` wrapper every IPC call returns.
 *
 * The main process never rejects across IPC, so the renderer always has something to
 * display; these helpers keep the unwrapping in one place instead of at every call site.
 */

import type { Result } from '../../shared/ipc.ts';

export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw Object.assign(new Error(result.message), { code: result.code });
}

/** Returns the value, or null after handing the failure to `onError`. */
export function unwrapOr<T>(
  result: Result<T>,
  onError: (message: string, code: string) => void,
): T | null {
  if (result.ok) return result.value;
  onError(result.message, result.code);
  return null;
}
