/**
 * The setup path, derived from live state rather than remembered.
 *
 * Ella's loop only works once five things are true at the same time, and the order they
 * have to happen in is not guessable from the navigation: a version installed, a project
 * open, something in it, Blockbench reachable, and the game running. Nothing here is a
 * checkbox the user ticks — every step reads the same state the rest of the UI reads, so
 * it can never claim something is done when it is not, and a step that stops being true
 * (the game exits, the project is closed) goes back to undone on its own.
 *
 * Steps are never hidden once complete. Seeing the whole path, with the finished part
 * behind you, is what makes the order obvious the first time and reassuring after that.
 */

export type WorkflowStepId = 'version' | 'project' | 'entry' | 'blockbench' | 'launch';

/** Everything the path depends on, flattened out of the session and config. */
export interface WorkflowFacts {
  installedVersions: number;
  /** Installed versions whose adapter jar exists — the only ones that can live-edit. */
  liveEditingVersions: number;
  hasProject: boolean;
  entryCount: number;
  /** Whether Ella can find a Blockbench to launch, configured or auto-detected. */
  blockbenchFound: boolean;
  /** The mod has completed its handshake, so edits reach the game. */
  connected: boolean;
}

export interface WorkflowStep {
  id: WorkflowStepId;
  done: boolean;
  /** The first unfinished step: the one thing to do next, and the only accented control. */
  current: boolean;
}

/** Fixed order — this is the sequence, not a set of independent chores. */
const ORDER: WorkflowStepId[] = ['version', 'project', 'entry', 'blockbench', 'launch'];

export function workflowSteps(facts: WorkflowFacts): WorkflowStep[] {
  const done: Record<WorkflowStepId, boolean> = {
    version: facts.installedVersions > 0,
    project: facts.hasProject,
    entry: facts.hasProject && facts.entryCount > 0,
    blockbench: facts.blockbenchFound,
    launch: facts.connected,
  };

  // Exactly one step is current, and only the earliest unfinished one. Marking every
  // unfinished step would be the same as marking none.
  const first = ORDER.find((id) => !done[id]);

  return ORDER.map((id) => ({ id, done: done[id], current: id === first }));
}

export const isSetupComplete = (steps: WorkflowStep[]): boolean =>
  steps.every((step) => step.done);

export const currentStep = (steps: WorkflowStep[]): WorkflowStep | null =>
  steps.find((step) => step.current) ?? null;

export const completedCount = (steps: WorkflowStep[]): number =>
  steps.filter((step) => step.done).length;

/**
 * Whether the versions on this machine can live-edit at all.
 *
 * Distinct from having no version installed: someone can install 1.19.2, see everything
 * work, and never understand why edits do not appear. Naming it as its own condition lets
 * the UI say so before the launch rather than after.
 */
export const canLiveEdit = (facts: WorkflowFacts): boolean => facts.liveEditingVersions > 0;
