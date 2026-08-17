/**
 * Quick launch, pinned to the bottom of the sidebar.
 *
 * Reachable from every view, because launching and relaunching is the most repeated
 * action in a modelling session and having to navigate back to the Versions tab each time
 * is friction that adds up.
 *
 * Populated from disk rather than the manifest, so it appears instantly and still works
 * with no network.
 *
 * The selection follows the open project rather than the last launch: a project is bound to
 * the version it was authored for, and opening another one has to bring its version with
 * it. Otherwise switching projects quietly leaves the previous project's version armed —
 * one click from a run whose breakages are all silent.
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
  const targetVersion = session.project?.targetVersion ?? null;

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

  // Opening a project arms its own version. Deliberately overwrites whatever was selected:
  // the previous choice belonged to the previous project.
  //
  // Also re-arms it when a run ends, so the control comes to rest on the project's version
  // rather than keeping a one-off launch armed for the next click.
  useEffect(() => {
    if (!running && targetVersion) setSelected(targetVersion);
  }, [targetVersion, running]);

  // Follow the running version, so the control always shows what is actually going on.
  useEffect(() => {
    if (running && versionId) setSelected(versionId);
  }, [running, versionId]);

  const launch = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    const result = await session.requestLaunch(selected);
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

  // Two different situations, and the difference matters: the project's version is armed
  // and something else was picked, or the project's version cannot be armed at all.
  const targetInstalled =
    targetVersion !== null && versions.some((entry) => entry.id === targetVersion);
  const differsFromProject = targetVersion !== null && selected !== targetVersion;

  return (
    <div className="quick-launch">
      <div className="quick-launch-label">
        <Icon name="bolt" size={11} />
        {t('quick.title')}
      </div>

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

          {/* The project's binding, said before the launch rather than in the dialog that
              would follow it. Someone who picked another version on purpose gets a
              reminder; someone who did it by accident gets a chance to notice. */}
          {differsFromProject && (
            <div className="quick-launch-note">
              <Icon name="alert" size={11} />
              {targetInstalled
                ? t('quick.projectTargets', { version: targetVersion })
                : t('quick.projectTargetsMissing', { version: targetVersion })}
            </div>
          )}

          {/* Says up front whether this launch will actually sync, rather than letting
              the user discover it from a silent absence of live editing. */}
          {current && current.adapterStatus !== 'built' && (
            <div className="quick-launch-note">
              <Icon name="alert" size={11} />
              {t('quick.vanillaOnly')}
            </div>
          )}
          {current && !current.javaAvailable && (
            <div className="quick-launch-note error">
              <Icon name="alert" size={11} />
              {t('versions.javaMissing', { java: current.requiredJava })}
            </div>
          )}

          {running ? (
            <button className="danger" onClick={() => void stop()} disabled={busy}>
              <Icon name="stop" size={13} />
              {t('quick.stop')}
            </button>
          ) : (
            <button
              className="primary"
              onClick={() => void launch()}
              disabled={!canLaunch}
              title={
                current && !current.javaAvailable
                  ? t('versions.javaMissing', { java: current.requiredJava })
                  : undefined
              }
            >
              <Icon name="play" size={13} />
              {busy ? t('versions.launching') : t('quick.launch')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
