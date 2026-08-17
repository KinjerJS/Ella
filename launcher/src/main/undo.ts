/**
 * One-shot inverses, handed to the renderer as an opaque token.
 *
 * How to reverse an action belongs next to the action. The alternative — the renderer
 * holding the manifest fragment, the file paths and the ordering it would need to undo a
 * delete — would spread knowledge of the project format into the button that offers the
 * undo, and would need a new IPC call for every action that ever becomes undoable. Here it
 * is one `offer(...)` beside the thing that happened, and one channel for all of them.
 *
 * Offers are one-shot and bounded. They back a notification that lives for seconds; keeping
 * more than the last handful would mean holding closures over a project that has since
 * moved on, and an undo that quietly applies to the wrong state is worse than no undo.
 */

import { randomUUID } from 'node:crypto';

export interface UndoOffer {
  token: string;
  /** i18n key describing what happened, translated by the renderer. */
  messageKey: string;
  values: Record<string, string | number>;
}

/**
 * How many offers stay live.
 *
 * Deep enough that a burst of edits does not drop the one still on screen, shallow enough
 * that nothing lingers long past the notification it belongs to.
 */
const MAX_OFFERS = 8;

export class UndoRegistry {
  private inverses = new Map<string, () => Promise<void>>();

  /** Registers a way back and returns what the renderer needs to offer it. */
  offer(
    messageKey: string,
    values: Record<string, string | number>,
    inverse: () => Promise<void>,
  ): UndoOffer {
    const token = randomUUID();
    this.inverses.set(token, inverse);

    // Map iterates in insertion order, so the oldest is the first key.
    while (this.inverses.size > MAX_OFFERS) {
      const oldest = this.inverses.keys().next().value;
      if (oldest === undefined) break;
      this.inverses.delete(oldest);
    }

    return { token, messageKey, values };
  }

  /**
   * Runs an inverse, once.
   *
   * Removed before it runs rather than after: a failed undo has already done whatever part
   * of its work it managed, and running it a second time would compound that rather than
   * retry it.
   */
  async run(token: string): Promise<void> {
    const inverse = this.inverses.get(token);
    if (!inverse) {
      const error = new Error('This change can no longer be undone') as Error & { code: string };
      error.code = 'UNDO_EXPIRED';
      throw error;
    }

    this.inverses.delete(token);
    await inverse();
  }

  /** Drops every offer. Used when the project they refer to is no longer open. */
  clear(): void {
    this.inverses.clear();
  }
}
