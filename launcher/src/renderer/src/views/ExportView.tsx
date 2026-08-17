import { useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from '../components/Icon.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { useToast } from '../components/Toast.tsx';
import type { SessionHook } from '../session.ts';
import type { ExportIssueDto, ExportResultDto } from '../../../shared/ipc.ts';

export function ExportView({ session }: { session: SessionHook }) {
  const { t } = useI18n();
  const toast = useToast();
  const { project } = session;
  const [issues, setIssues] = useState<ExportIssueDto[] | null>(null);
  const [result, setResult] = useState<ExportResultDto | null>(null);
  const [busy, setBusy] = useState(false);

  if (!project) {
    return (
      <div className="view">
        <EmptyState icon="folder" title={t('project.noProject')} text={t('project.noProjectHelp')} />
      </div>
    );
  }

  const blocks = project.entries.filter((entry) => entry.kind === 'block');
  const items = project.entries.filter((entry) => entry.kind === 'item');

  const run = async (): Promise<void> => {
    setBusy(true);
    setResult(null);

    // Validate first: an export that loads but renders wrongly is worse than a refusal.
    const validation = await window.ella.exporter.validate();
    if (!validation.ok) {
      toast.error(validation.message);
      setBusy(false);
      return;
    }
    setIssues(validation.value);

    if (validation.value.some((issue) => issue.severity === 'error')) {
      setBusy(false);
      toast.error(t('export.blocked'));
      return;
    }

    const suggested = await window.ella.exporter.suggestName();
    const destination = await window.ella.dialog.saveFile(suggested);
    if (!destination) {
      setBusy(false);
      return;
    }

    const exported = await window.ella.exporter.run(destination);
    setBusy(false);

    if (exported.ok) {
      setResult(exported.value);
      toast.ok(t('export.doneShort'));
    } else {
      toast.error(exported.message);
    }
  };

  return (
    <div className="view">
      <div className="page-head">
        <h1>{t('export.title')}</h1>
        <p className="subtitle">{t('export.subtitle')}</p>
      </div>

      {result && (
        <div className="warning info">
          <Icon name="check" size={16} />
          <div>
            {t('export.done', { path: result.path })} · {result.fileCount}{' '}
            {t('export.files')} · {(result.bytes / 1024).toFixed(1)} KiB
          </div>
        </div>
      )}

      {issues?.map((issue, index) => (
        <div
          key={`${issue.entryId}-${index}`}
          className={`warning${issue.severity === 'error' ? ' error' : ''}`}
        >
          <Icon name="alert" size={16} />
          <div>
            <strong>{issue.entryId}</strong> — {t(issue.messageKey)}
          </div>
        </div>
      ))}

      <div className="card">
        <div className="row">
          <div>
            <div className="name">{t('export.resourcePack')}</div>
            <div className="help">{t('export.resourcePackHelp')}</div>
          </div>
          <span className="spacer" />
          <span className="badge">
            {blocks.length} {t('entry.kind.block')}
          </span>
          <span className="badge">
            {items.length} {t('entry.kind.item')}
          </span>
          <button
            className="primary"
            onClick={() => void run()}
            disabled={busy || project.entries.length === 0}
            title={project.entries.length === 0 ? t('export.needsEntries') : undefined}
          >
            <Icon name="export" />
            {busy ? t('export.running') : t('export.run')}
          </button>
        </div>
      </div>

      {/* Announced rather than hidden: knowing a mod export is planned is the difference
          between waiting for it and building the registration by hand. */}
      <div className="card" style={{ opacity: 0.55 }}>
        <div className="row">
          <div>
            <div className="name">{t('export.mod')}</div>
            <div className="help">{t('export.modHelp')}</div>
          </div>
          <span className="spacer" />
          <span className="badge">{t('export.planned')}</span>
        </div>
      </div>
    </div>
  );
}
