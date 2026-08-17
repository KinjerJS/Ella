import test from 'node:test';
import assert from 'node:assert/strict';
import {
  workflowSteps,
  isSetupComplete,
  completedCount,
  currentStep,
  canLiveEdit,
  type WorkflowFacts,
} from '../src/shared/workflow.ts';
import { translate, LOCALES } from '../src/shared/i18n.ts';

const NOTHING: WorkflowFacts = {
  installedVersions: 0,
  liveEditingVersions: 0,
  hasProject: false,
  entryCount: 0,
  blockbenchFound: false,
  connected: false,
};

const EVERYTHING: WorkflowFacts = {
  installedVersions: 2,
  liveEditingVersions: 1,
  hasProject: true,
  entryCount: 3,
  blockbenchFound: true,
  connected: true,
};

test('a fresh install has nothing done and starts at the first step', () => {
  const steps = workflowSteps(NOTHING);
  assert.equal(completedCount(steps), 0);
  assert.equal(currentStep(steps)?.id, 'version');
  assert.equal(isSetupComplete(steps), false);
});

test('a fully set up session has no current step', () => {
  const steps = workflowSteps(EVERYTHING);
  assert.equal(isSetupComplete(steps), true);
  assert.equal(currentStep(steps), null);
});

test('exactly one step is current, however many are outstanding', () => {
  const steps = workflowSteps({ ...NOTHING, installedVersions: 1, blockbenchFound: true });
  assert.equal(steps.filter((step) => step.current).length, 1);
  // Blockbench being found already does not pull it in front of the project step.
  assert.equal(currentStep(steps)?.id, 'project');
});

test('a later step can be done while an earlier one is not', () => {
  const steps = workflowSteps({ ...NOTHING, blockbenchFound: true });
  const blockbench = steps.find((step) => step.id === 'blockbench');
  assert.equal(blockbench?.done, true);
  assert.equal(blockbench?.current, false);
});

test('closing the project un-does the steps that depended on it', () => {
  // Entry count is stale for a moment after a project closes; the step must not claim
  // an entry exists when there is no project to hold it.
  const steps = workflowSteps({ ...EVERYTHING, hasProject: false });
  assert.equal(steps.find((step) => step.id === 'entry')?.done, false);
});

test('the game disconnecting reopens the launch step', () => {
  const steps = workflowSteps({ ...EVERYTHING, connected: false });
  assert.equal(isSetupComplete(steps), false);
  assert.equal(currentStep(steps)?.id, 'launch');
});

test('installed versions without a built adapter cannot live-edit', () => {
  assert.equal(canLiveEdit({ ...NOTHING, installedVersions: 3 }), false);
  assert.equal(canLiveEdit({ ...NOTHING, installedVersions: 3, liveEditingVersions: 1 }), true);
});

test('every step has a title, a reason and an action in both locales', () => {
  for (const step of workflowSteps(NOTHING)) {
    for (const locale of LOCALES) {
      for (const suffix of ['title', 'why', 'action']) {
        const key = `guide.${step.id}.${suffix}`;
        assert.notEqual(translate(locale, key), key, `${key} is missing in ${locale}`);
      }
    }
  }
});
