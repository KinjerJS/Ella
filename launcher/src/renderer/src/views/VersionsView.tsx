import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { unwrapOr } from '../result.ts';
import { Icon } from '../components/Icon.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { useToast } from '../components/Toast.tsx';
import type { SessionHook } from '../session.ts';
import type { VersionSummaryDto, InstallFootprintDto } from '../../../shared/ipc.ts';

interface Props {
  session: SessionHook;
  /** Installs and uninstalls change what the setup guide and the sidebar count. */
  onChanged: () => void;
}

export function VersionsView({ session, onChanged }: Props) {
  const { t } = useI18n();
  const toast = useToast();
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
    onChanged();
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

  const install = async (id: string, repair = false): Promise<void> => {
    setBusy(id);
    const result = await window.ella.versions.install(id);
    setBusy(null);

    if (result.ok) {
      toast.ok(t(repair ? 'versions.repairDone' : 'versions.installDone', { version: id }));
    } else {
      toast.error(result.message);
    }

    void refreshAll();
  };

  const launch = async (id: string): Promise<void> => {
    setBusy(id);
    // Through the session, so launching from the list is guarded the same way as launching
    // from the sidebar — this is the button most likely to be a deliberate version change.
    const result = await session.requestLaunch(id);
    unwrapOr(result, (message) => toast.error(message));
    setBusy(null);
  };

  const gameRunning = session.state.status !== 'stopped';
  const installedIds = new Set(installed.map((version) => version.id));
  const available = versions.filter((version) => !installedIds.has(version.id));

  /*
   * Versions with a built adapter get their own section above the full list.
   *
   * "Which Minecraft version should I pick" is the first decision Ella asks for and the
   * one it is worst at leaving to the user: every version in the manifest launches, but
   * only a handful can live-edit, and picking wrong is only discovered after a download
   * and a launch that quietly never syncs.
   */
  const recommended = available.filter((version) => version.adapterStatus === 'built');
  const rest = available.filter((version) => version.adapterStatus !== 'built');

  const rowProps = (version: VersionSummaryDto) => ({
    version,
    busy: busy === version.id,
    gameRunning,
    onInstall: () => void install(version.id, version.installed),
    onLaunch: () => void launch(version.id),
    onUninstall: () => setConfirming(version.id),
  });

  return (
    <div className="view">
      <div className="page-head">
        <h1>{t('versions.title')}</h1>
        <p className="subtitle">{t('versions.subtitle')}</p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* Installed versions first and unfiltered: they are what you actually launch, and
          they stay visible even when the snapshot filter hides them from the list below
          or the manifest cannot be reached. */}
      <h2 style={{ marginTop: 0 }}>
        {t('versions.installed')} ({installed.length})
      </h2>
      {installed.length === 0 ? (
        <EmptyState
          icon="download"
          title={t('versions.noneInstalled')}
          text={t('versions.noneInstalledHelp')}
        />
      ) : (
        <div className="list" style={{ marginBottom: 20 }}>
          {installed.map((version) => (
            <div key={version.id}>
              <VersionRow {...rowProps(version)} />
              {confirming === version.id && (
                <UninstallConfirm
                  versionId={version.id}
                  onDone={() => {
                    setConfirming(null);
                    toast.ok(t('versions.uninstallDone', { version: version.id }));
                    void refreshAll();
                  }}
                  onCancel={() => setConfirming(null)}
                  onError={(message) => toast.error(message)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {recommended.length > 0 && (
        <>
          <h2>{t('versions.recommended')}</h2>
          <p className="section-note">{t('versions.recommendedHelp')}</p>
          <div className="list" style={{ marginBottom: 20 }}>
            {recommended.map((version) => (
              <VersionRow key={version.id} {...rowProps(version)} />
            ))}
          </div>
        </>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>{t('versions.available')}</h2>
        <span className="spacer" />
        <label className="inline" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          <input
            type="checkbox"
            checked={showSnapshots}
            onChange={(event) => toggleSnapshots(event.target.checked)}
          />
          {t('versions.showSnapshots')}
        </label>
        <button
          className="subtle"
          onClick={() => void refresh(showSnapshots, true)}
          disabled={loading}
          title={t('versions.refresh')}
        >
          <Icon name="refresh" />
          {t('versions.refresh')}
        </button>
      </div>

      {loading && versions.length === 0 && <div className="empty">…</div>}

      {/* Anything installed is shown above, so this list is the not-yet-installed
          remainder — no uninstall affordance can apply here. */}
      <div className="list scroll-list">
        {rest.map((version) => (
          <VersionRow key={version.id} {...rowProps(version)} />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  version: VersionSummaryDto;
  busy: boolean;
  gameRunning: boolean;
  onInstall: () => void;
  onLaunch: () => void;
  onUninstall: () => void;
}

function VersionRow({ version, busy, gameRunning, onInstall, onLaunch, onUninstall }: RowProps) {
  const { t } = useI18n();

  /*
   * Why a button cannot be pressed, in the order the user would hit them.
   *
   * A disabled button with no tooltip is a dead end — people conclude the app is broken
   * rather than that something is missing, and the fix (install a JDK, stop the game) is
   * never something they would guess.
   */
  const launchBlocked = !version.javaAvailable
    ? t('versions.javaMissing', { java: version.requiredJava })
    : gameRunning
      ? t('versions.alreadyRunning')
      : null;

  const installBlocked = !version.supported ? t('versions.unsupportedReason') : null;

  return (
    <div className="list-row" style={{ cursor: 'default' }}>
      <span className="name" style={{ minWidth: 92 }}>
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
        <span className="badge" title={t('versions.vanillaOnlyHelp')}>
          {t('versions.vanillaOnly')}
        </span>
      )}

      {version.javaAvailable ? (
        <span className="badge" title={t('versions.javaFoundHelp')}>
          {t('versions.javaRequired', { java: version.requiredJava })}
        </span>
      ) : (
        <span className="badge error">
          {t('versions.javaMissing', { java: version.requiredJava })}
        </span>
      )}

      <span className="spacer" />
      <span className="meta">{version.releaseTime.slice(0, 10)}</span>

      {!version.installed && (
        <button
          onClick={onInstall}
          disabled={busy || !version.supported}
          title={installBlocked ?? undefined}
        >
          {busy ? t('versions.installing') : t('versions.install')}
        </button>
      )}
      {/* Launch only appears once there is something to launch. A disabled Launch on every
          uninstalled row is a column of dead buttons, and Install is already the one
          action that applies. */}
      {version.installed && (
        <>
          {/* Re-runs the whole install over an existing one. Needed because a version can
              be installed and still incomplete — a Forge step that failed leaves files
              missing, and without this the only way to fetch them was to uninstall and
              start over, which also throws away the worlds. */}
          <button
            onClick={onInstall}
            disabled={busy || gameRunning}
            title={t('versions.repairHelp')}
          >
            <Icon name="refresh" size={13} />
            {busy ? t('versions.installing') : t('versions.repair')}
          </button>
          <button
            className="danger icon-only"
            onClick={onUninstall}
            disabled={busy || gameRunning}
            title={gameRunning ? t('versions.inUse') : t('versions.uninstall')}
            aria-label={t('versions.uninstall')}
          >
            <Icon name="trash" size={13} />
          </button>
          <button
            className="primary"
            onClick={onLaunch}
            disabled={busy || launchBlocked !== null}
            title={launchBlocked ?? undefined}
          >
            <Icon name="play" size={13} />
            {busy ? t('versions.launching') : t('versions.launch')}
          </button>
        </>
      )}
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
    <div className="card" style={{ borderColor: 'var(--error)', marginTop: 6 }}>
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
          <Icon name="alert" size={16} />
          <div>{t('versions.uninstallWorldsWarning')}</div>
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
