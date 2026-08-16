/**
 * Quick launch, pinned to the bottom of the sidebar.
 *
 * Reachable from every view, because launching and relaunching is the most repeated
 * action in a modelling session and having to navigate back to the Versions tab each time
 * is friction that adds up.
 *
 * Populated from disk rather than the manifest, so it appears instantly and still works
 * with no network.
 */

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from './Icon.tsx';
import type { SessionHook } from '../session.ts';
import type { VersionSummaryDto } from '../../../shared/ipc.ts';

export function QuickLaunch({ session }: { session: SessionHook }) {
  const { t } = useI18n();
  const [versions, setVersions] = useState<VersionSummaryDto[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { status, versionId } = session.state;
  const running = status !== 'stopped';

  useEffect(() => {
    void (async () => {
      const result = await window.ella.versions.installed();
      if (!result.ok) return;

      setVersions(result.value);

      // Prefer whatever was last launched, so the common case is one click.
      const config = await window.ella.config.get();
      const preferred =
        result.value.find((entry) => entry.id === config.lastVersion) ?? result.value[0];
      if (preferred) setSelected((current) => current || preferred.id);
    })();
    // Re-reads after a launch or an install/uninstall changes the session state.
  }, [status]);

  // Follow the running version, so the control always shows what is actually going on.
  useEffect(() => {
    if (running && versionId) setSelected(versionId);
  }, [running, versionId]);

  const launch = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    const result = await window.ella.game.launch(selected);
    setError(result.ok ? null : result.message);
    setBusy(false);
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    await window.ella.game.stop();
    setBusy(false);
  };

  const current = versions.find((entry) => entry.id === selected);
  const canLaunch = Boolean(current?.javaAvailable) && !busy && selected !== '';

  return (
    <div className="quick-launch">
      {error && <div className="quick-launch-error">{error}</div>}

      {versions.length === 0 ? (
        <div className="quick-launch-empty">{t('quick.noVersions')}</div>
      ) : (
        <>
          <select
            value={selected}
            disabled={running}
            onChange={(event) => setSelected(event.target.value)}
            title={t('quick.version')}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.id}
                {version.adapterStatus === 'built' ? '' : ' ·'}
              </option>
            ))}
          </select>

          {/* Says up front whether this launch will actually sync, rather than letting
              the user discover it from a silent absence of live editing. */}
          {current && current.adapterStatus !== 'built' && (
            <div className="quick-launch-note">{t('quick.vanillaOnly')}</div>
          )}
          {current && !current.javaAvailable && (
            <div className="quick-launch-note error">
              {t('versions.javaMissing', { java: current.requiredJava })}
            </div>
          )}

          {running ? (
            <button className="danger" onClick={() => void stop()} disabled={busy}>
              <Icon name="stop" />{t('quick.stop')}
            </button>
          ) : (
            <button className="primary" onClick={() => void launch()} disabled={!canLaunch}>
              <Icon name="play" />{busy ? t('versions.launching') : t('quick.launch')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
