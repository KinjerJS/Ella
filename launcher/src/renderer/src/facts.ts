/**
 * The facts the setup guide and the navigation both read.
 *
 * Gathered once in App and passed down rather than fetched per component: the installed
 * version list is a disk scan, and three places asking for it independently would produce
 * three different answers during an install.
 */

import { useEffect, useState } from 'react';
import type { WorkflowFacts } from '../../shared/workflow.ts';
import type { VersionSummaryDto } from '../../shared/ipc.ts';
import type { SessionHook } from './session.ts';

export interface Facts extends WorkflowFacts {
  installed: VersionSummaryDto[];
  /**
   * What a one-click launch should start: the open project's own version, then the last
   * version launched if it is still installed, then the first one that can live-edit, then
   * anything installed.
   */
  preferredVersion: string | null;
  /** Re-reads after an install, an uninstall, or a Blockbench path change. */
  refresh: () => void;
}

export function useWorkflowFacts(session: SessionHook): Facts {
  const [installed, setInstalled] = useState<VersionSummaryDto[]>([]);
  const [blockbenchFound, setBlockbenchFound] = useState(false);
  const [lastVersion, setLastVersion] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const { status } = session.state;

  useEffect(() => {
    void window.ella.versions.installed().then((result) => {
      if (result.ok) setInstalled(result.value);
    });
    void window.ella.blockbench.resolve().then((path) => setBlockbenchFound(path !== null));
    void window.ella.config.get().then((config) => setLastVersion(config.lastVersion));
    // Launching writes lastVersion and an install changes the list, so the game's status
    // is a good enough signal to re-read on without polling.
  }, [status, nonce]);

  const liveCapable = installed.filter((version) => version.adapterStatus === 'built');

  // The project's version outranks the last one launched: the guide's Launch button is a
  // one-click path, and it should not be the thing that starts a version change.
  const preferred =
    installed.find((version) => version.id === session.project?.targetVersion) ??
    installed.find((version) => version.id === lastVersion) ??
    liveCapable[0] ??
    installed[0] ??
    null;

  return {
    installed,
    installedVersions: installed.length,
    liveEditingVersions: liveCapable.length,
    hasProject: session.project !== null,
    entryCount: session.project?.entries.length ?? 0,
    blockbenchFound,
    connected: status === 'connected',
    preferredVersion: preferred?.id ?? null,
    refresh: () => setNonce((current) => current + 1),
  };
}
