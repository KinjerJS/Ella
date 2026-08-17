/**
 * Confirmation for launching a project on a version it was not authored for.
 *
 * A project is bound to a version, and most of the time that binding is invisible: the
 * launcher preselects it and the run matches. This dialog is the exception, and it exists
 * because the ways a resource pack breaks across versions are all silent — the game loads
 * the file, says nothing, and draws the wrong thing. Finding out from a black block in the
 * world is far worse than being told here.
 *
 * So it lists what would actually break, per entry, rather than warning in the abstract;
 * and where Ella can rewrite the file itself, it offers to.
 */

import { useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from './Icon.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { versionChangeNotes, type VersionFacts } from '../../../shared/version-compat.ts';
import type { Result, VersionChangePlanDto, VersionSummaryDto } from '../../../shared/ipc.ts';

interface Props {
  plan: VersionChangePlanDto;
  /** Installed versions, for the consequences that are not about the project's files. */
  versions: VersionSummaryDto[];
  projectName: string;
  onCancel: () => void;
  onConfirm: (adopt: boolean) => Promise<Result<void>>;
}

export function VersionChangeDialog({
  plan,
  versions,
  projectName,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  // Adopting is the answer that leaves the project consistent with its files, so it is the
  // default. Unticking it makes the run a one-off, which is the rarer intent.
  const [adopt, setAdopt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const factsFor = (id: string | null): VersionFacts | null => {
    if (!id) return null;
    const summary = versions.find((version) => version.id === id);
    return summary
      ? {
          id,
          installed: summary.installed,
          adapterStatus: summary.adapterStatus,
          javaAvailable: summary.javaAvailable,
          requiredJava: summary.requiredJava,
        }
      : null;
  };

  // A version absent from the installed list is one Ella cannot launch, which the notes
  // then say in as many words rather than the dialog quietly showing nothing.
  const target = factsFor(plan.to) ?? {
    id: plan.to,
    installed: false,
    adapterStatus: null,
    javaAvailable: true,
    requiredJava: 0,
  };

  const notes = versionChangeNotes(factsFor(plan.from), target);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    const result = await onConfirm(adopt);
    setBusy(false);
    if (!result.ok) setError(result.message);
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal narrow" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{t('compat.title')}</div>
            <div className="modal-subtitle plain">
              {t('compat.subtitle', { project: projectName, from: plan.from ?? '?', to: plan.to })}
            </div>
          </div>
          <span className="spacer" />
          <div className="version-swap">
            <span className="version-swap-from">{plan.from}</span>
            <Icon name="arrow" size={13} />
            <span className="version-swap-to">{plan.to}</span>
          </div>
        </div>

        <div className="modal-body">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />

          {notes.map((note) => (
            <div key={note.id} className="warning">
              <Icon name="alert" size={16} />
              <div>{t(`compat.note.${note.id}`, note.detail)}</div>
            </div>
          ))}

          <h2 className="compat-heading">{t('compat.files')}</h2>

          {plan.findings.length === 0 ? (
            <div className="warning info">
              <Icon name="check" size={16} />
              <div>{t('compat.noIssues', { to: plan.to })}</div>
            </div>
          ) : (
            <div className="list">
              {plan.findings.map((finding, index) => (
                <div key={`${finding.entryId}-${finding.issue}-${index}`} className="list-row">
                  <Icon name="alert" size={14} />
                  <span className="name">{finding.entryId}</span>
                  <span className="compat-detail">
                    {t(`compat.issue.${finding.issue}`, { ...finding.detail, to: plan.to })}
                  </span>
                  {Number(finding.detail.count) > 1 && (
                    <span className="nav-badge">{finding.detail.count}</span>
                  )}
                  <span className="spacer" />
                  <span className="meta">
                    {finding.fixable ? t('compat.fixable') : t('compat.manual')}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="help" style={{ marginTop: 12 }}>
            {t('compat.automatic')}
          </div>
        </div>

        <div className="modal-footer">
          <label className="inline">
            <input
              type="checkbox"
              checked={adopt}
              disabled={busy}
              onChange={(event) => setAdopt(event.target.checked)}
            />
            {plan.fixable > 0
              ? t('compat.adoptAndFix', { to: plan.to, count: plan.fixable })
              : t('compat.adopt', { to: plan.to })}
          </label>

          <span className="spacer" />

          <button onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="primary" onClick={() => void confirm()} disabled={busy}>
            <Icon name="play" size={13} />
            {t('compat.launch', { to: plan.to })}
          </button>
        </div>

        {/* Said last, next to the control it qualifies: unticking the box is not "cancel",
            it is a run on another version with the project left where it is. */}
        {!adopt && (
          <div className="modal-footer-note">{t('compat.oneOff', { from: plan.from ?? '?' })}</div>
        )}
      </div>
    </div>
  );
}
