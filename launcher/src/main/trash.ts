/**
 * Files an action moved aside instead of deleting.
 *
 * Deleting an entry's model and texture is the one editor action whose result cannot be
 * typed back in, and the notification that follows it offers a way out — which is only
 * true if the bytes still exist. So "delete the files too" moves them into
 * `<project>/.trash/<slug>/`, keeping their project-relative layout, which is what makes
 * putting them back need no bookkeeping beyond the slug.
 *
 * The stash lives for as long as the project stays open: it is purged on the next open, so
 * it cannot grow without limit. That is not a recycle bin and is not offered as one — the
 * undo it backs is a notification that lasts seconds.
 *
 * It sits outside `pack/` on purpose, so nothing here reaches the file watcher, an export,
 * or the running game.
 */

import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/** Kept out of `pack/`, and dot-prefixed so it reads as Ella's own bookkeeping. */
export const TRASH_DIR = '.trash';

const stashDir = (root: string, slug: string): string => path.join(root, TRASH_DIR, slug);

/**
 * Moves files out of the project, into the stash named by `slug`.
 *
 * A path that does not exist is skipped rather than failing: an entry may never have had a
 * Blockbench source, and refusing to delete it over that would be absurd.
 *
 * @returns the project-relative paths that were actually moved
 */
export async function stashFiles(
  root: string,
  slug: string,
  relativePaths: string[],
): Promise<string[]> {
  const moved: string[] = [];

  for (const relative of relativePaths) {
    const from = path.join(root, ...relative.split('/'));
    const to = path.join(stashDir(root, slug), ...relative.split('/'));

    await mkdir(path.dirname(to), { recursive: true });
    try {
      await rename(from, to);
      moved.push(relative);
    } catch {
      // Missing, or already moved by an earlier call for the same entry.
    }
  }

  return moved;
}

/**
 * Puts a stash back where it came from and removes it.
 *
 * Never overwrites: a file that exists again was recreated after the delete, and it is the
 * newer one. Losing it to an undo of something else would be the very failure this module
 * exists to prevent.
 *
 * @returns the project-relative paths that were restored
 */
export async function restoreStash(root: string, slug: string): Promise<string[]> {
  const directory = stashDir(root, slug);
  const restored: string[] = [];

  for (const relative of await listStashed(directory)) {
    const from = path.join(directory, ...relative.split('/'));
    const to = path.join(root, ...relative.split('/'));

    // `rename` replaces an existing destination silently, so it is checked first.
    if (await stat(to).then(() => true, () => false)) continue;

    await mkdir(path.dirname(to), { recursive: true });
    try {
      await rename(from, to);
      restored.push(relative);
    } catch {
      // Left in the stash; the purge on the next project open clears it.
    }
  }

  await rm(directory, { recursive: true, force: true });
  return restored;
}

/** Everything under a stash, as paths relative to it. */
async function listStashed(directory: string, prefix = ''): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listStashed(path.join(directory, entry.name), relative)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

/**
 * Empties the trash.
 *
 * Called when a project is opened rather than on a timer: the undo offers a stash backs are
 * gone by then anyway, and tying the lifetime to something the user does keeps it
 * predictable — nothing disappears while the project is open.
 */
export async function purgeStashes(root: string): Promise<void> {
  await rm(path.join(root, TRASH_DIR), { recursive: true, force: true });
}
