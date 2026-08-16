import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { unwrapOr } from '../result.ts';
import type { SessionHook } from '../session.ts';
import type { VersionSummaryDto, InstallFootprintDto } from '../../../shared/ipc.ts';

export function VersionsView({ session }: { session: SessionHook }) {
  const { t } = useI18n();
  const [versions, setVersions] = useState<VersionSummaryDto[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [installed, setInstalled] = useState<VersionSummaryDto[]>([]);

  /** Installed list comes from disk, so it survives a manifest fetch failing. */
  const refreshInstalled = async (): Promise<void> => {
    const result = await window.ella.versions.installed();
    if (result.ok) setInstalled(result.value);
  };

  const refresh = async (includeSnapshots: boolean, force = false): Promise<void> => {
    setLoading(true);
    const result = await window.ella.versions.list({ includeSnapshots, force });
    const value = unwrapOr(result, (message) => setError(message));
    if (value) {
      setVersions(value);
      setError(null);
    }
    setLoading(false);
  };

  const refreshAll = async (): Promise<void> => {
    await Promise.all([refreshInstalled(), refresh(showSnapshots)]);
  };

  useEffect(() => {
    void window.ella.config.get().then((config) => {
      setShowSnapshots(config.showSnapshots);
      void refreshInstalled();
      void refresh(config.showSnapshots);
    });
  }, []);

  const toggleSnapshots = (next: boolean): void => {
    setShowSnapshots(next);
    void window.ella.config.set({ showSnapshots: next });
    void refresh(next);
  };

  const install = async (id: string): Promise<void> => {
    setBusy(id);
    const result = await window.ella.versions.install(id);
    unwrapOr(result, (message) => setError(message));
    setBusy(null);
    void refreshAll();
  };

  const launch = async (id: string): Promise<void> => {
    setBusy(id);
    const result = await window.ella.game.launch(id);
    unwrapOr(result, (message) => setError(message));
    setBusy(null);
  };

  const gameRunning = session.state.status !== 'stopped';
  const installedIds = new Set(installed.map((version) => version.id));

  return (
    <div>
      <h1>{t('versions.title')}</h1>
      <p className="subtitle">{t('app.tagline')}</p>

      {error && <div className="warning error">{error}</div>}

      <div className="row" style={{ marginBottom: 14 }}>
        <label className="inline">
          <input
            type="checkbox"
            checked={showSnapshots}
            onChange={(event) => toggleSnapshots(event.target.checked)}
          />
          {t('versions.showSnapshots')}
        </label>
        <span className="spacer" />
        <button onClick={() => void refresh(showSnapshots, true)} disabled={loading}>
          {t('common.retry')}
        </button>
        {gameRunning && (
          <button className="danger" onClick={() => void window.ella.game.stop()}>
            {t('common.close')}
          </button>
        )}
      </div>

      {/* Installed versions first and unfiltered: they are what you actually launch, and
          they stay visible even when the snapshot filter hides them from the list below
          or the manifest cannot be reached. */}
      <h2 style={{ marginTop: 0 }}>
        {t('versions.installed')} ({installed.length})
      </h2>
      {installed.length === 0 ? (
        <div className="empty" style={{ padding: '18px 0' }}>
          {t('versions.noneInstalled')}
        </div>
      ) : (
        <div className="list" style={{ marginBottom: 18 }}>
          {installed.map((version) => (
            <div key={version.id}>
              <VersionRow
                version={version}
                busy={busy === version.id}
                disabled={gameRunning}
                onInstall={() => void install(version.id)}
                onLaunch={() => void launch(version.id)}
                onUninstall={() => setConfirming(version.id)}
              />
              {confirming === version.id && (
                <UninstallConfirm
                  versionId={version.id}
                  onDone={() => {
                    setConfirming(null);
                    void refreshAll();
                  }}
                  onCancel={() => setConfirming(null)}
                  onError={setError}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <h2>{t('versions.available')}</h2>
      {loading && versions.length === 0 && <div className="empty">…</div>}

      {/* Anything installed is shown above, so this list is the not-yet-installed
          remainder — no uninstall affordance can apply here. */}
      <div className="list scroll-list">
        {versions
          .filter((version) => !installedIds.has(version.id))
          .map((version) => (
            <VersionRow
              key={version.id}
              version={version}
              busy={busy === version.id}
              disabled={gameRunning}
              onInstall={() => void install(version.id)}
              onLaunch={() => void launch(version.id)}
              onUninstall={() => setConfirming(version.id)}
            />
          ))}
      </div>
    </div>
  );
}

interface RowProps {
  version: VersionSummaryDto;
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
  onLaunch: () => void;
  onUninstall: () => void;
}

function VersionRow({ version, busy, disabled, onInstall, onLaunch, onUninstall }: RowProps) {
  const { t } = useI18n();

  return (
    <div className="list-row" style={{ cursor: 'default' }}>
      <span className="name" style={{ minWidth: 90 }}>
        {version.id}
      </span>

      {version.adapterStatus === 'built' ? (
        <span className="badge ok" title={version.adapter ?? ''}>
          {t('versions.liveEditing')}
        </span>
      ) : version.adapterStatus === 'planned' ? (
        <span className="badge warn" title={version.adapterBucket ?? ''}>
          {t('versions.adapterNotBuilt')}
        </span>
      ) : (
        <span className="badge" title={t('versions.unsupportedReason')}>
          {t('versions.vanillaOnly')}
        </span>
      )}

      {version.javaAvailable ? (
        <span className="badge ok">{t('versions.javaRequired', { java: version.requiredJava })}</span>
      ) : (
        <span className="badge error">
          {t('versions.javaMissing', { java: version.requiredJava })}
        </span>
      )}

      {version.installed && <span className="badge ok">{t('versions.installed')}</span>}

      <span className="spacer" />
      <span className="meta">{version.releaseTime.slice(0, 10)}</span>

      {!version.installed && (
        <button onClick={onInstall} disabled={busy || !version.supported}>
          {t('versions.install')}
        </button>
      )}
      {version.installed && (
        <button className="danger" onClick={onUninstall} disabled={busy || disabled}>
          {t('versions.uninstall')}
        </button>
      )}
      <button
        className="primary"
        onClick={onLaunch}
        disabled={busy || disabled || !version.installed || !version.javaAvailable}
      >
        {busy ? t('versions.launching') : t('versions.launch')}
      </button>
    </div>
  );
}

const formatSize = (bytes: number): string =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

interface ConfirmProps {
  versionId: string;
  onDone: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

/**
 * Uninstall confirmation.
 *
 * Deleting worlds is a separate, unticked choice, and the dialog states plainly that
 * shared libraries and assets stay — otherwise "uninstall" reads as though it reclaims
 * far more than it does, and people delete the wrong thing chasing disk space.
 */
function UninstallConfirm({ versionId, onDone, onCancel, onError }: ConfirmProps) {
  const { t } = useI18n();
  const [footprint, setFootprint] = useState<InstallFootprintDto | null>(null);
  const [removeInstance, setRemoveInstance] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.ella.versions.measure(versionId).then((result) => {
      if (result.ok) setFootprint(result.value);
    });
  }, [versionId]);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    const result = await window.ella.versions.uninstall(versionId, removeInstance);
    setBusy(false);
    if (result.ok) onDone();
    else onError(result.message);
  };

  return (
    <div className="card" style={{ borderColor: 'var(--error)' }}>
      <div className="name">{t('versions.uninstallTitle', { version: versionId })}</div>

      <div className="help" style={{ marginTop: 6 }}>
        {t('versions.uninstallRemoves', {
          size: footprint ? formatSize(footprint.versionBytes) : '…',
        })}
      </div>
      <div className="help">{t('versions.uninstallKeepsShared')}</div>

      {footprint?.hasInstance && (
        <label className="inline" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={removeInstance}
            onChange={(event) => setRemoveInstance(event.target.checked)}
          />
          {t('versions.uninstallWorlds', { size: formatSize(footprint.instanceBytes) })}
        </label>
      )}

      {removeInstance && (
        <div className="warning error" style={{ marginTop: 10 }}>
          {t('versions.uninstallWorldsWarning')}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="danger" onClick={() => void confirm()} disabled={busy}>
          {t('versions.uninstall')}
        </button>
        <button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
