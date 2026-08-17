/**
 * Installed versions, for the forms that need to offer a choice of one.
 *
 * Read from disk rather than the manifest, so it is instant and works offline — and read
 * once per mounted form rather than held globally: these are short-lived panels, and a
 * version installed while one of them is open is not a case worth complicating them for.
 */

import { useEffect, useState } from 'react';
import type { VersionSummaryDto } from '../../shared/ipc.ts';

export function useInstalledVersions(): VersionSummaryDto[] {
  const [versions, setVersions] = useState<VersionSummaryDto[]>([]);

  useEffect(() => {
    void window.ella.versions.installed().then((result) => {
      if (result.ok) setVersions(result.value);
    });
  }, []);

  return versions;
}
