import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from '../components/Icon.tsx';
import { useToast } from '../components/Toast.tsx';
import { LOCALES, LOCALE_NAMES, type Locale } from '../../../shared/i18n.ts';
import type { AppConfigDto, JavaRuntimeDto } from '../../../shared/ipc.ts';

/**
 * The plugin is optional: Ella syncs on a normal Ctrl+S either way, and the plugin only
 * removes the Ctrl+S. The card says so rather than presenting it as a required step.
 */
function BlockbenchPlugin() {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<
    { installed: boolean; outdated: boolean; installedPath: string } | null
  >(null);
  const [busy, setBusy] = useState(false);

  const refresh = (): void => {
    void window.ella.blockbench.pluginStatus().then(setStatus);
  };

  useEffect(refresh, []);

  const install = async (): Promise<void> => {
    setBusy(true);
    const result = await window.ella.blockbench.installPlugin();
    setBusy(false);
    if (result.ok) toast.ok(t('plugin.installedDone'));
    else toast.error(result.message);
    refresh();
  };

  return (
    <div className="card">
      <div className="row">
        <div>
          <div className="name">{t('plugin.liveSync')}</div>
          <div className="help">{t('plugin.liveSyncHelp')}</div>
        </div>
        <span className="spacer" />
        {status?.installed && !status.outdated && (
          <span className="badge ok">{t('plugin.installed')}</span>
        )}
        {status?.outdated && <span className="badge warn">{t('plugin.outdated')}</span>}
        <button onClick={() => void install()} disabled={busy}>
          {status?.installed ? t('plugin.reinstall') : t('plugin.install')}
        </button>
      </div>
      {status?.installed && <div className="help">{status.installedPath}</div>}
    </div>
  );
}

interface Props {
  /** A Blockbench path change moves a setup step from undone to done. */
  onChanged: () => void;
}

export function SettingsView({ onChanged }: Props) {
  const { t, locale, setLocale } = useI18n();
  const [config, setConfig] = useState<AppConfigDto | null>(null);
  const [runtimes, setRuntimes] = useState<JavaRuntimeDto[]>([]);
  const [detected, setDetected] = useState<string | null>(null);

  const refreshDetected = (): void => {
    void window.ella.blockbench.resolve().then(setDetected);
  };

  useEffect(() => {
    void window.ella.config.get().then(setConfig);
    void window.ella.java.list().then(setRuntimes);
    refreshDetected();
  }, []);

  if (!config) return null;

  const update = (patch: Partial<AppConfigDto>): void => {
    setConfig({ ...config, ...patch });
    void window.ella.config.set(patch);
  };

  const updateBlockbench = (path: string | null): void => {
    update({ blockbenchPath: path });
    // Resolution also falls back to the well-known install locations, so the answer to
    // "will opening a model work" is the main process's, not this input's.
    setTimeout(() => {
      refreshDetected();
      onChanged();
    }, 0);
  };

  const browseBlockbench = async (): Promise<void> => {
    const chosen = await window.ella.dialog.openFile([
      { name: 'Blockbench', extensions: ['exe', 'app', ''] },
    ]);
    if (chosen) updateBlockbench(chosen);
  };

  return (
    <div className="view">
      <div className="page-head">
        <h1>{t('settings.title')}</h1>
        <p className="subtitle">{t('settings.subtitle')}</p>
      </div>

      <div className="field-grid" style={{ maxWidth: 560 }}>
        <div className="field">
          <label>{t('settings.language')}</label>
          <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_NAMES[code]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{t('settings.username')}</label>
          <input
            value={config.username}
            onChange={(event) => update({ username: event.target.value })}
          />
          <div className="help">{t('settings.usernameHelp')}</div>
        </div>
      </div>

      <h2>{t('settings.blockbench')}</h2>

      <div className="field" style={{ maxWidth: 700 }}>
        <label>{t('settings.blockbenchPath')}</label>
        <div className="row">
          <input
            value={config.blockbenchPath ?? ''}
            placeholder={t('settings.blockbenchPlaceholder')}
            onChange={(event) => updateBlockbench(event.target.value || null)}
          />
          <button onClick={() => void browseBlockbench()}>
            <Icon name="folder" />
            {t('common.browse')}
          </button>
        </div>
        {/* Whether Ella can find Blockbench is not the same question as whether this box
            is filled in, and only the first one decides if opening a model works. */}
        {detected ? (
          <div className="help" style={{ color: 'var(--ok)' }}>
            {config.blockbenchPath
              ? t('settings.blockbenchOk')
              : t('settings.blockbenchDetected', { path: detected })}
          </div>
        ) : (
          <div className="help" style={{ color: 'var(--warn)' }}>
            {t('settings.blockbenchMissing')}
          </div>
        )}
      </div>

      <BlockbenchPlugin />

      <h2>{t('settings.slotPool')}</h2>
      <div className="field-grid" style={{ maxWidth: 560 }}>
        <div className="field">
          <label>{t('entry.kind.block')}</label>
          <input
            type="number"
            min={16}
            max={1024}
            value={config.slotPool.block}
            onChange={(event) =>
              update({ slotPool: { ...config.slotPool, block: Number(event.target.value) } })
            }
          />
        </div>
        <div className="field">
          <label>{t('entry.kind.item')}</label>
          <input
            type="number"
            min={16}
            max={1024}
            value={config.slotPool.item}
            onChange={(event) =>
              update({ slotPool: { ...config.slotPool, item: Number(event.target.value) } })
            }
          />
        </div>
      </div>
      <div className="help" style={{ marginTop: -8, marginBottom: 14 }}>
        {t('settings.slotPoolHelp')}
      </div>

      <h2>Java</h2>
      <p className="section-note">{t('settings.javaHelp')}</p>
      {runtimes.length === 0 ? (
        <div className="warning">
          <Icon name="alert" size={16} />
          <div>{t('settings.javaNone')}</div>
        </div>
      ) : (
        <div className="list">
          {runtimes.map((runtime) => (
            <div key={runtime.path} className="list-row" style={{ cursor: 'default' }}>
              <span className="badge accent">Java {runtime.major}</span>
              <span className="name">{runtime.version}</span>
              <span className="spacer" />
              <span className="meta">{runtime.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
