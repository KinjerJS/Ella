import { useState } from 'react';
import { useI18n } from './i18n.tsx';
import { useSession } from './session.ts';
import { VersionsView } from './views/VersionsView.tsx';
import { ProjectView } from './views/ProjectView.tsx';
import { EditorView } from './views/EditorView.tsx';
import { LogsView } from './views/LogsView.tsx';
import { ExportView } from './views/ExportView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { QuickLaunch } from './components/QuickLaunch.tsx';
import { CrashDialog } from './components/CrashDialog.tsx';
import { Icon, type IconName } from './components/Icon.tsx';

type View = 'versions' | 'project' | 'editor' | 'logs' | 'export' | 'settings';

const NAV: Array<{ id: View; labelKey: string; icon: IconName }> = [
  { id: 'versions', labelKey: 'nav.versions', icon: 'versions' },
  { id: 'project', labelKey: 'nav.project', icon: 'project' },
  { id: 'editor', labelKey: 'nav.editor', icon: 'editor' },
  { id: 'logs', labelKey: 'nav.logs', icon: 'logs' },
  { id: 'export', labelKey: 'nav.export', icon: 'export' },
  { id: 'settings', labelKey: 'nav.settings', icon: 'settings' },
];

export function App() {
  const { t } = useI18n();
  const session = useSession();
  const [view, setView] = useState<View>('project');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);

  /** Jumping straight to the editor is the common path after creating an entry. */
  const openEntry = (id: string): void => {
    setSelectedEntry(id);
    setView('editor');
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          Ell<span>a</span>
        </div>

        {/* Which project is open, visible from every view. Without it there is no way to
            tell two similar projects apart before editing the wrong one. */}
        <button
          className={`project-chip${session.project ? '' : ' empty'}`}
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

        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item${view === item.id ? ' active' : ''}`}
            onClick={() => setView(item.id)}
          >
            <Icon name={item.icon} />
            {t(item.labelKey)}
          </button>
        ))}

        <div className="sidebar-spacer" />
        <QuickLaunch session={session} />
      </nav>

      <main className="content">
        {view === 'versions' && <VersionsView session={session} />}
        {view === 'project' && <ProjectView session={session} onOpenEntry={openEntry} />}
        {view === 'editor' && (
          <EditorView
            session={session}
            selectedId={selectedEntry}
            onSelect={setSelectedEntry}
          />
        )}
        {view === 'logs' && <LogsView session={session} />}
        {view === 'export' && <ExportView session={session} />}
        {view === 'settings' && <SettingsView />}
      </main>

      <StatusBar session={session} />

      {session.crash && (
        <CrashDialog diagnostics={session.crash} onClose={session.dismissCrash} />
      )}
    </div>
  );
}
