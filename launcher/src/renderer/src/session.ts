/**
 * Renderer-side mirror of the main process session state.
 */

import { useEffect, useState } from 'react';
import type { EllaProject } from '../../shared/project.ts';
import type { LogPayload } from '../../shared/protocol.ts';
import type {
  ProgressDto,
  Result,
  SessionStateDto,
  CrashDiagnosticsDto,
  VersionChangePlanDto,
} from '../../shared/ipc.ts';

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
  const [versionChange, setVersionChange] = useState<VersionChangePlanDto | null>(null);

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

  // A pending version question belongs to the project that raised it. Keyed on the root
  // rather than on the project object, which is replaced by every edit — including the
  // rebind the question itself performs.
  useEffect(() => {
    setVersionChange(null);
  }, [state.projectRoot]);

  /**
   * The one way to start the game.
   *
   * Every launch goes through here so the version check cannot be bypassed by whichever
   * button happens to be nearest — the sidebar, the versions list and the setup guide all
   * start a run, and a guard on one of them is a guard on none.
   *
   * Resolves ok when the launch was deferred to the confirmation: a question is not a
   * failure, and the dialog owns what happens next.
   */
  const requestLaunch = async (versionId: string): Promise<Result<void>> => {
    if (project) {
      const plan = await window.ella.projects.planVersionChange(versionId);
      if (plan.ok && plan.value.needsConfirmation) {
        setVersionChange(plan.value);
        return { ok: true, value: undefined };
      }
    }
    return window.ella.game.launch(versionId);
  };

  /**
   * Answers the confirmation and launches.
   *
   * `adopt` rebinds the project to the new version and rewrites the models that need it;
   * without it the run is a one-off and the project keeps pointing at the version it was
   * authored for — so the same warning comes back next time, which is the point of binding
   * a project to a version at all.
   */
  const confirmVersionChange = async (adopt: boolean): Promise<Result<void>> => {
    if (!versionChange) return { ok: true, value: undefined };
    const { to } = versionChange;

    // The rebind stands even if the launch then fails: moving the project was the answer
    // given, and Java being missing does not retract it. The dialog stays open with the
    // error, so the launch can be retried without being asked the same question again.
    if (adopt) {
      const applied = await window.ella.projects.applyVersionChange(to, true);
      if (!applied.ok) return applied;
    }

    const launched = await window.ella.game.launch(to);
    if (launched.ok) setVersionChange(null);
    return launched;
  };

  return {
    state,
    project,
    lines,
    progress,
    crash,
    versionChange,
    requestLaunch,
    confirmVersionChange,
    cancelVersionChange: () => setVersionChange(null),
    dismissCrash: () => setCrash(null),
    clearLines: () => setLines([]),
    hasCapability: (capability: string) => state.capabilities.includes(capability),
  };
}

/** Declared here rather than in App so views can import it without a circular reference. */
export type SessionHook = ReturnType<typeof useSession>;
