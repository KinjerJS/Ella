import { useState } from 'react';
import { useI18n } from '../i18n.tsx';
import type { SessionHook } from '../session.ts';
import type { ExportIssueDto, ExportResultDto } from '../../../shared/ipc.ts';

export function ExportView({ session }: { session: SessionHook }) {
  const { t } = useI18n();
  const { project } = session;
  const [issues, setIssues] = useState<ExportIssueDto[] | null>(null);
  const [result, setResult] = useState<ExportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!project) return <div className="empty">{t('project.noEntries')}</div>;

  const blocks = project.entries.filter((entry) => entry.kind === 'block');
  const items = project.entries.filter((entry) => entry.kind === 'item');

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);

    // Validate first: an export that loads but renders wrongly is worse than a refusal.
    const validation = await window.ella.exporter.validate();
    if (!validation.ok) {
      setError(validation.message);
      setBusy(false);
      return;
    }
    setIssues(validation.value);

    if (validation.value.some((issue) => issue.severity === 'error')) {
      setBusy(false);
      return;
    }

    const suggested = await window.ella.exporter.suggestName();
    const destination = await window.ella.dialog.saveFile(suggested);
    if (!destination) {
      setBusy(false);
      return;
    }

    const exported = await window.ella.exporter.run(destination);
    if (exported.ok) setResult(exported.value);
    else setError(exported.message);
    setBusy(false);
  };

  return (
    <div>
      <h1>{t('export.title')}</h1>

      {error && <div className="warning error">{error}</div>}
      {result && (
        <div className="card">
          {t('export.done', { path: result.path })} · {result.fileCount} ·{' '}
          {(result.bytes / 1024).toFixed(1)} KiB
        </div>
      )}

      {issues?.map((issue, index) => (
        <div key={`${issue.entryId}-${index}`} className={`warning${issue.severity === 'error' ? ' error' : ''}`}>
          <strong>{issue.entryId}</strong> — {t(issue.messageKey)}
        </div>
      ))}

      <div className="card">
        <div className="name">{t('export.resourcePack')}</div>
        <div className="help">{t('export.resourcePackHelp')}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="badge">
            {blocks.length} {t('entry.kind.block')}
          </span>
          <span className="badge">
            {items.length} {t('entry.kind.item')}
          </span>
          <span className="spacer" />
          <button className="primary" onClick={() => void run()} disabled={busy || project.entries.length === 0}>
            {t('export.run')}
          </button>
        </div>
      </div>

      <div className="card" style={{ opacity: 0.55 }}>
        <div className="name">{t('export.mod')}</div>
        <div className="help">{t('export.modHelp')}</div>
      </div>
    </div>
  );
}
