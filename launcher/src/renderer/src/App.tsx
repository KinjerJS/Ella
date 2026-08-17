import { useEffect, useState } from 'react';
import { useI18n } from './i18n.tsx';
import { useSession } from './session.ts';
import { useWorkflowFacts } from './facts.ts';
import { NAV, type View } from './navigation.ts';
import { APP_VERSION } from '../../shared/app.ts';
import { workflowSteps, completedCount } from '../../shared/workflow.ts';
import { HomeView } from './views/HomeView.tsx';
import { VersionsView } from './views/VersionsView.tsx';
import { ProjectView } from './views/ProjectView.tsx';
import { EditorView } from './views/EditorView.tsx';
import { LogsView } from './views/LogsView.tsx';
import { ExportView } from './views/ExportView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { QuickLaunch } from './components/QuickLaunch.tsx';
import { CrashDialog } from './components/CrashDialog.tsx';
import { VersionChangeDialog } from './components/VersionChangeDialog.tsx';
import { useToast } from './components/Toast.tsx';
import { Icon } from './components/Icon.tsx';

export function App() {
  const { t } = useI18n();
  const toast = useToast();
  const session = useSession();
  const facts = useWorkflowFacts(session);
  const [view, setView] = useState<View>('home');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);

  /*
   * Undo offers, subscribed once for the whole app.
   *
   * Main announces them rather than returning them, so the notification appears wherever
   * the change was made — including changes nothing on screen asked for, like the rewrite
   * that follows fixing a model. Which action it was is main's business; here it is a
   * message and a token.
   */
  useEffect(
    () =>
      window.ella.on.undo((offer) =>
        toast.undoable(t(offer.messageKey, offer.values), () =>
          window.ella.undo.run(offer.token),
        ),
      ),
    [toast, t],
  );

  const steps = workflowSteps(facts);
  const remaining = steps.length - completedCount(steps);

  /** Jumping straight to the editor is the common path after creating an entry. */
  const openEntry = (id: string): void => {
    setSelectedEntry(id);
    setView('editor');
  };

  // Ctrl+1…7 switches view. The shortcut is named in each item's tooltip rather than
  // printed in the sidebar, which would cost a column of width to teach one thing once.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      const target = NAV[index];
      if (!target) return;
      if (target.needsProject && !session.project) return;
      event.preventDefault();
      setView(target.id);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session.project]);

  /** Count or state for the view behind a row, or null when it has nothing to report. */
  const badgeFor = (id: View): { text: string; tone: string } | null => {
    if (id === 'home' && remaining > 0) return { text: String(remaining), tone: 'attention' };
    if (id === 'versions' && facts.connected) return { text: t('home.live.on'), tone: 'live' };
    if (id === 'versions' && facts.installedVersions > 0) {
      return { text: String(facts.installedVersions), tone: '' };
    }
    if (id === 'project' && facts.entryCount > 0) {
      return { text: String(facts.entryCount), tone: '' };
    }
    return null;
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="block" size={15} />
          </span>
          <span className="brand-text">
            Ell<span>a</span>
          </span>
          {/* Next to the wordmark rather than buried in Settings: the one moment anyone
              needs it is while writing a bug report, and hunting for it is friction at
              exactly the wrong time. */}
          <span className="brand-version">{APP_VERSION}</span>
        </div>

        {/* Which project is open, visible from every view. Without it there is no way to
            tell two similar projects apart before editing the wrong one. */}
        <button
          className={`project-chip${session.project ? '' : ' vacant'}`}
          onClick={() => setView('project')}
          title={session.state.projectRoot ?? undefined}
        >
          {session.project ? (
            <>
              <span className="project-chip-name">{session.project.name}</span>
              <span className="project-chip-meta">
                {session.project.namespace} · {session.project.entries.length}
              </span>
            </>
          ) : (
            <span className="project-chip-meta">{t('project.none')}</span>
          )}
        </button>

        {NAV.map((item, index) => {
          const blocked = Boolean(item.needsProject) && !session.project;
          const badge = badgeFor(item.id);

          return (
            <button
              key={item.id}
              className={`nav-item${view === item.id ? ' active' : ''}`}
              onClick={() => setView(item.id)}
              disabled={blocked}
              // Every disabled control in Ella says why it is disabled. A greyed-out tab
              // with no explanation is the same as a missing one, except more confusing.
              title={blocked ? t('nav.needsProject') : `${t(item.labelKey)}  ·  Ctrl+${index + 1}`}
            >
              <Icon name={item.icon} />
              <span className="nav-label">{t(item.labelKey)}</span>
              {badge && <span className={`nav-badge ${badge.tone}`}>{badge.text}</span>}
            </button>
          );
        })}

        <div className="sidebar-spacer" />
        <QuickLaunch session={session} />
      </nav>

      <main className="content">
        {view === 'home' && (
          <HomeView
            session={session}
            facts={facts}
            onNavigate={setView}
            onOpenEntry={openEntry}
          />
        )}
        {view === 'versions' && <VersionsView session={session} onChanged={facts.refresh} />}
        {view === 'project' && <ProjectView session={session} onOpenEntry={openEntry} />}
        {view === 'editor' && (
          <EditorView
            session={session}
            facts={facts}
            selectedId={selectedEntry}
            onSelect={setSelectedEntry}
            onNavigate={setView}
          />
        )}
        {view === 'logs' && <LogsView session={session} />}
        {view === 'export' && <ExportView session={session} />}
        {view === 'settings' && <SettingsView onChanged={facts.refresh} />}
      </main>

      <StatusBar session={session} />

      {session.crash && (
        <CrashDialog diagnostics={session.crash} onClose={session.dismissCrash} />
      )}

      {/* Rendered here rather than beside the button that triggered it: three different
          views can start a launch, and the answer is the same wherever it came from. */}
      {session.versionChange && session.project && (
        <VersionChangeDialog
          plan={session.versionChange}
          versions={facts.installed}
          projectName={session.project.name}
          onCancel={session.cancelVersionChange}
          onConfirm={session.confirmVersionChange}
        />
      )}
    </div>
  );
}
