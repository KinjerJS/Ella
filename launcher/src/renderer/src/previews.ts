/**
 * Entry preview data, kept in step with what is on disk.
 *
 * Refreshed on two signals rather than one: a project change (an entry added, renamed or
 * re-bound) and a file change (a Blockbench save, or a texture edited in any other tool).
 * Watching only the first would leave the preview showing the model as it was when the
 * project last changed — the wrong answer for a tool whose point is live editing.
 */

import { useEffect, useState } from 'react';
import type { EntryPreviewDto } from '../../shared/ipc.ts';

export function usePreviews(hasProject: boolean) {
  const [previews, setPreviews] = useState<EntryPreviewDto[]>([]);

  useEffect(() => {
    if (!hasProject) {
      setPreviews([]);
      return;
    }

    let cancelled = false;

    const refresh = (): void => {
      void window.ella.entries.previews().then((result) => {
        if (!cancelled && result.ok) setPreviews(result.value);
      });
    };

    refresh();

    const unsubscribers = [
      window.ella.on.project(refresh),
      window.ella.on.files(refresh),
    ];

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [hasProject]);

  return previews;
}
