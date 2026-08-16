/**
 * Renderer-side mirror of the main process session state.
 */

import { useEffect, useState } from 'react';
import type { EllaProject } from '../../shared/project.ts';
import type { LogPayload } from '../../shared/protocol.ts';
import type { ProgressDto, SessionStateDto, CrashDiagnosticsDto } from '../../shared/ipc.ts';

const EMPTY_STATE: SessionStateDto = {
  status: 'stopped',
  versionId: null,
  projectRoot: null,
  game: null,
  capabilities: [],
};

export interface ConsoleLine {
  key: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  text: string;
}

/** Keeps only the tail: an unbounded log would grow without limit over a long session. */
const MAX_LINES = 500;

export function useSession() {
  const [state, setState] = useState<SessionStateDto>(EMPTY_STATE);
  const [project, setProject] = useState<EllaProject | null>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [crash, setCrash] = useState<CrashDiagnosticsDto | null>(null);

  useEffect(() => {
    let nextKey = 0;
    const append = (level: ConsoleLine['level'], text: string): void =>
      setLines((current) => [...current, { key: nextKey++, level, text }].slice(-MAX_LINES));

    void window.ella.game.state().then(setState);
    void window.ella.projects.current().then((current) => setProject(current.project));

    const unsubscribers = [
      window.ella.on.state(setState),
      window.ella.on.project(setProject),
      window.ella.on.log((entry: LogPayload) =>
        append(entry.level, `[${entry.source}] ${entry.message}`),
      ),
      window.ella.on.output((line: string) => append('info', line)),
      window.ella.on.progress((report) => {
        setProgress(report);
        if (report.completed >= report.total) setProgress(null);
      }),
      window.ella.on.crash(setCrash),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  return {
    state,
    project,
    lines,
    progress,
    crash,
    dismissCrash: () => setCrash(null),
    clearLines: () => setLines([]),
    hasCapability: (capability: string) => state.capabilities.includes(capability),
  };
}

/** Declared here rather than in App so views can import it without a circular reference. */
export type SessionHook = ReturnType<typeof useSession>;
