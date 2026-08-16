/**
 * Crash dialog.
 *
 * Shown when the game exits badly. The point is that a user should never have to know
 * where crash reports live, or which of several logs matters: everything is here, and one
 * button puts a complete report on the clipboard.
 */

import { useState } from 'react';
import { useI18n } from '../i18n.tsx';
import type { CrashDiagnosticsDto } from '../../../shared/ipc.ts';

interface Props {
  diagnostics: CrashDiagnosticsDto;
  onClose: () => void;
}

type Tab = 'report' | 'output';

export function CrashDialog({ diagnostics, onClose }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(diagnostics.crashReport ? 'report' : 'output');
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    const result = await window.ella.crash.copy(diagnostics);
    if (result.ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    // Clicking the backdrop closes; clicking inside must not, or selecting log text
    // would dismiss the dialog mid-drag.
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">
              {t('crash.title', { version: diagnostics.versionId })}
            </div>
            <div className="modal-subtitle">{diagnostics.summary}</div>
          </div>
          <button onClick={onClose}>{t('common.close')}</button>
        </div>

        <div className="modal-body">
          <div className="crash-env">
            {Object.entries(diagnostics.environment).map(([key, value]) => (
              <div key={key} className="crash-env-row">
                <span className="crash-env-key">{key}</span>
                <span className="crash-env-value">{value}</span>
              </div>
            ))}
            <div className="crash-env-row">
              <span className="crash-env-key">{t('crash.mods')}</span>
              <span className="crash-env-value">
                {diagnostics.mods.length > 0 ? diagnostics.mods.join(', ') : '—'}
              </span>
            </div>
          </div>

          <div className="tabs">
            <button
              className={`tab${tab === 'report' ? ' active' : ''}`}
              onClick={() => setTab('report')}
              disabled={!diagnostics.crashReport}
            >
              {t('crash.report')}
            </button>
            <button
              className={`tab${tab === 'output' ? ' active' : ''}`}
              onClick={() => setTab('output')}
            >
              {t('crash.output')} ({diagnostics.output.length})
            </button>
          </div>

          <div className="console crash-console">
            {tab === 'report'
              ? (diagnostics.crashReport ?? t('crash.noReport'))
              : diagnostics.output.length > 0
                ? diagnostics.output.join('\n')
                : t('crash.noOutput')}
          </div>
        </div>

        <div className="modal-footer">
          <button className="primary" onClick={() => void copy()}>
            {copied ? t('crash.copied') : t('crash.copy')}
          </button>
          <button onClick={() => void window.ella.crash.reveal(diagnostics)}>
            {diagnostics.crashReportPath ? t('crash.showReport') : t('crash.showFolder')}
          </button>
          <span className="spacer" />
          <span className="meta">{t('crash.copyHint')}</span>
        </div>
      </div>
    </div>
  );
}
