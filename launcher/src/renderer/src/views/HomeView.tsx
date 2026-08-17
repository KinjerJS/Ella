/**
 * The view Ella opens on.
 *
 * It answers one question — what should I do next — and answers it differently depending
 * on how far along you are. Before the setup is complete it is a guide: five steps read
 * off live state, with the next one accented and its button wired to the thing it names.
 * After that the checklist folds away and the same space becomes a dashboard of what is
 * running, because a finished checklist is not worth a screen.
 */

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon, type IconName } from '../components/Icon.tsx';
import { useToast } from '../components/Toast.tsx';
import { ModelPreview } from '../components/ModelPreview.tsx';
import { usePreviews } from '../previews.ts';
import type { ProjectSummaryDto } from '../../../shared/ipc.ts';
import {
  workflowSteps,
  isSetupComplete,
  completedCount,
  type WorkflowStep,
  type WorkflowStepId,
} from '../../../shared/workflow.ts';
import type { Facts } from '../facts.ts';
import type { SessionHook } from '../session.ts';
import type { View } from '../navigation.ts';

interface Props {
  session: SessionHook;
  facts: Facts;
  onNavigate: (view: View) => void;
  onOpenEntry: (id: string) => void;
}

/** Each step's button either moves you to where it happens, or does the thing outright. */
const STEP_ICON: Record<WorkflowStepId, IconName> = {
  version: 'download',
  project: 'folder',
  entry: 'plus',
  blockbench: 'brush',
  launch: 'play',
};

export function HomeView({ session, facts, onNavigate, onOpenEntry }: Props) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [showGuide, setShowGuide] = useState(false);
  const [launching, setLaunching] = useState(false);

  const steps = workflowSteps(facts);
  const complete = isSetupComplete(steps);
  const { project, state } = session;
  const previews = usePreviews(Boolean(project));
  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);

  // Only needed while nothing is open — that is the one moment the answer to "what now"
  // is most likely to be "carry on with the one I had yesterday".
  useEffect(() => {
    if (project) return;
    void window.ella.projects.list().then(setProjects);
  }, [project]);

  const open = async (root: string): Promise<void> => {
    const result = await window.ella.projects.open(root);
    if (!result.ok) toast.error(result.message);
  };

  const launch = async (): Promise<void> => {
    if (!facts.preferredVersion) return;
    setLaunching(true);
    const result = await session.requestLaunch(facts.preferredVersion);
    setLaunching(false);
    if (!result.ok) toast.error(result.message);
  };

  const act = (step: WorkflowStepId): void => {
    if (step === 'launch') void launch();
    else if (step === 'version') onNavigate('versions');
    else if (step === 'blockbench') onNavigate('settings');
    else onNavigate('project');
  };

  const running = state.status === 'running' || state.status === 'starting';

  return (
    <div className="view">
      <div className="hero">
        <h1>{project ? project.name : t('home.welcome')}</h1>
        <p className="subtitle">
          {project ? t('home.projectSubtitle', { namespace: project.namespace }) : t('home.welcomeText')}
        </p>

        <div className="stat-row">
          <Stat
            label={t('home.stat.live')}
            value={
              facts.connected
                ? t('home.live.on')
                : running
                  ? t('versions.launching')
                  : t('home.live.off')
            }
            tone={facts.connected ? 'ok' : 'dim'}
            dot={facts.connected ? 'connected' : running ? 'running' : null}
          />
          <Stat
            label={t('home.stat.minecraft')}
            value={state.game?.minecraftVersion ?? String(facts.installedVersions)}
            tone={facts.installedVersions > 0 ? 'normal' : 'dim'}
          />
          <Stat
            label={t('project.entries')}
            value={project ? String(project.entries.length) : '—'}
            tone={facts.entryCount > 0 ? 'normal' : 'dim'}
          />
          <Stat
            label={t('home.stat.blockbench')}
            value={facts.blockbenchFound ? t('home.found') : t('home.notFound')}
            tone={facts.blockbenchFound ? 'normal' : 'dim'}
          />
        </div>
      </div>

      {/* One warning that outranks the checklist: versions are installed but none of them
          can live-edit, so following every step still ends in a game that never updates. */}
      {facts.installedVersions > 0 && facts.liveEditingVersions === 0 && (
        <div className="warning">
          <Icon name="alert" size={16} />
          <div>
            {t('home.noLiveVersion')}{' '}
            <button className="link" onClick={() => onNavigate('versions')}>
              {t('home.noLiveVersionAction')}
            </button>
          </div>
        </div>
      )}

      {/*
        With nothing open, the fastest route back to work is almost never "create a
        project" — it is the one from yesterday. The list goes above the checklist for
        that reason, and stays a plain overview: a name, its namespace and how much is in
        it, which is all that is knowable without opening the project.
      */}
      {!project && projects.length > 0 && (
        <>
          <h2 style={{ marginTop: 4 }}>{t('home.resume')}</h2>
          <p className="section-note">{t('home.resumeHelp')}</p>

          <div className="action-grid" style={{ marginBottom: 24 }}>
            {projects.map((summary) => (
              <button
                key={summary.root}
                className="action-card"
                onClick={() => void open(summary.root)}
                title={summary.root}
              >
                <span className="action-card-icon">
                  <Icon name="folder" size={17} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="action-card-title">{summary.name}</span>
                  <span className="action-card-text" style={{ display: 'block' }}>
                    {summary.namespace} · {summary.entryCount}{' '}
                    {t('project.entries').toLowerCase()}
                  </span>
                </span>
              </button>
            ))}

            <button className="action-card" onClick={() => onNavigate('project')}>
              <span className="action-card-icon">
                <Icon name="plus" size={17} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="action-card-title">{t('project.new')}</span>
                <span className="action-card-text" style={{ display: 'block' }}>
                  {t('home.newProjectText')}
                </span>
              </span>
            </button>
          </div>
        </>
      )}

      {complete ? (
        <>
          <div className="row">
            <h2 style={{ margin: '4px 0 11px' }}>{t('home.quickActions')}</h2>
            <span className="spacer" />
            <button className="subtle" onClick={() => setShowGuide((current) => !current)}>
              {showGuide ? t('guide.hide') : t('guide.show')}
            </button>
          </div>

          <div className="action-grid">
            <ActionCard
              icon="editor"
              title={t('home.action.editor')}
              text={t('home.action.editorText')}
              onClick={() => onNavigate('editor')}
            />
            <ActionCard
              icon="plus"
              title={t('entry.new')}
              text={t('home.action.newText')}
              onClick={() => onNavigate('project')}
            />
            <ActionCard
              icon="export"
              title={t('export.resourcePack')}
              text={t('home.action.exportText')}
              onClick={() => onNavigate('export')}
            />
            <ActionCard
              icon="logs"
              title={t('nav.logs')}
              text={t('home.action.logsText')}
              onClick={() => onNavigate('logs')}
            />
          </div>

          {showGuide && (
            <div style={{ marginTop: 22 }}>
              <Guide steps={steps} launching={launching} onAct={act} />
            </div>
          )}

          {project && project.entries.length > 0 && (
            <>
              <h2>{t('home.recent')}</h2>
              <div className="card-grid">
                {project.entries.slice(0, 6).map((entry) => (
                  <button
                    key={entry.id}
                    className="entry-card"
                    onClick={() => onOpenEntry(entry.id)}
                  >
                    <Icon name={entry.kind} size={14} className="entry-card-kind" />
                    <div className="entry-card-preview">
                      <ModelPreview
                        preview={previews.find((candidate) => candidate.id === entry.id)}
                        size={112}
                      />
                    </div>
                    <div className="entry-card-name">
                      {entry.displayName[locale] ?? entry.displayName.en}
                    </div>
                    <div className="entry-card-meta">
                      {entry.slot === null ? t('entry.unbound') : `#${entry.slot}`}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="row" style={{ marginTop: 4 }}>
            <h2 style={{ margin: 0 }}>{t('guide.title')}</h2>
            <span className="badge accent">
              {t('guide.progress', { done: completedCount(steps), total: steps.length })}
            </span>
          </div>
          <p className="subtitle" style={{ margin: '8px 0 14px' }}>
            {t('guide.subtitle')}
          </p>
          <Guide steps={steps} launching={launching} onAct={act} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface GuideProps {
  steps: WorkflowStep[];
  launching: boolean;
  onAct: (step: WorkflowStepId) => void;
}

function Guide({ steps, launching, onAct }: GuideProps) {
  const { t } = useI18n();

  return (
    <div className="guide">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={`guide-step ${step.done ? 'done' : step.current ? 'current' : 'todo'}`}
        >
          <div className="guide-marker">
            {step.done ? <Icon name="check" size={15} /> : index + 1}
          </div>

          <div>
            <div className="guide-title">{t(`guide.${step.id}.title`)}</div>
            {/* Why, not how. The button already covers how, and a step whose point is
                unclear gets skipped or undone later. */}
            {!step.done && <div className="guide-why">{t(`guide.${step.id}.why`)}</div>}
          </div>

          {!step.done && (
            <button
              className={`guide-action${step.current ? ' primary' : ''}`}
              onClick={() => onAct(step.id)}
              disabled={step.id === 'launch' && launching}
            >
              <Icon name={STEP_ICON[step.id]} />
              {step.id === 'launch' && launching
                ? t('versions.launching')
                : t(`guide.${step.id}.action`)}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  tone: 'normal' | 'ok' | 'dim';
  dot?: 'connected' | 'running' | null;
}

function Stat({ label, value, tone, dot }: StatProps) {
  return (
    <div className="stat">
      <div className={`stat-value${tone === 'normal' ? '' : ` ${tone}`}`}>
        {dot !== undefined && dot !== null && <span className={`dot ${dot}`} />}
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

interface ActionCardProps {
  icon: IconName;
  title: string;
  text: string;
  onClick: () => void;
}

function ActionCard({ icon, title, text, onClick }: ActionCardProps) {
  return (
    <button className="action-card" onClick={onClick}>
      <span className="action-card-icon">
        <Icon name={icon} size={17} />
      </span>
      <span>
        <span className="action-card-title">{title}</span>
        <span className="action-card-text" style={{ display: 'block' }}>
          {text}
        </span>
      </span>
    </button>
  );
}
