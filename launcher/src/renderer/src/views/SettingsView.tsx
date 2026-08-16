import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { LOCALES, LOCALE_NAMES, type Locale } from '../../../shared/i18n.ts';
import type { AppConfigDto, JavaRuntimeDto } from '../../../shared/ipc.ts';

/**
 * The plugin is optional: Ella syncs on a normal Ctrl+S either way, and the plugin only
 * removes the Ctrl+S. The card says so rather than presenting it as a required step.
 */
function BlockbenchPlugin() {
  const { t } = useI18n();
  const [status, setStatus] = useState<
    { installed: boolean; outdated: boolean; installedPath: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = (): void => {
    void window.ella.blockbench.pluginStatus().then(setStatus);
  };

  useEffect(refresh, []);

  const install = async (): Promise<void> => {
    setBusy(true);
    const result = await window.ella.blockbench.installPlugin();
    if (!result.ok) setError(result.message);
    else setError(null);
    setBusy(false);
    refresh();
  };

  return (
    <>
      <h2>{t('plugin.title')}</h2>
      {error && <div className="warning error">{error}</div>}
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
    </>
  );
}

export function SettingsView() {
  const { t, locale, setLocale } = useI18n();
  const [config, setConfig] = useState<AppConfigDto | null>(null);
  const [runtimes, setRuntimes] = useState<JavaRuntimeDto[]>([]);

  useEffect(() => {
    void window.ella.config.get().then(setConfig);
    void window.ella.java.list().then(setRuntimes);
  }, []);

  if (!config) return null;

  const update = (patch: Partial<AppConfigDto>): void => {
    setConfig({ ...config, ...patch });
    void window.ella.config.set(patch);
  };

  const browseBlockbench = async (): Promise<void> => {
    const chosen = await window.ella.dialog.openFile([
      { name: 'Blockbench', extensions: ['exe', 'app', ''] },
    ]);
    if (chosen) update({ blockbenchPath: chosen });
  };

  return (
    <div>
      <h1>{t('settings.title')}</h1>

      <div className="field" style={{ maxWidth: 260 }}>
        <label>{t('settings.language')}</label>
        <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_NAMES[code]}
            </option>
          ))}
        </select>
      </div>

      <div className="field" style={{ maxWidth: 260 }}>
        <label>{t('entry.displayName')}</label>
        <input
          value={config.username}
          onChange={(event) => update({ username: event.target.value })}
        />
      </div>

      <div className="field">
        <label>{t('settings.blockbenchPath')}</label>
        <div className="row">
          <input
            value={config.blockbenchPath ?? ''}
            placeholder={t('blockbench.notFoundHelp')}
            onChange={(event) => update({ blockbenchPath: event.target.value || null })}
          />
          <button onClick={() => void browseBlockbench()}>{t('common.browse')}</button>
        </div>
      </div>

      <div className="field-grid" style={{ maxWidth: 560 }}>
        <div className="field">
          <label>{t('settings.slotPool')} · {t('entry.kind.block')}</label>
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
          <label>{t('settings.slotPool')} · {t('entry.kind.item')}</label>
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
      <div className="help" style={{ marginTop: -6, marginBottom: 14 }}>
        {t('settings.slotPoolHelp')}
      </div>

      <BlockbenchPlugin />

      <h2>Java</h2>
      <div className="list">
        {runtimes.map((runtime) => (
          <div key={runtime.path} className="list-row" style={{ cursor: 'default' }}>
            <span className="badge">Java {runtime.major}</span>
            <span className="name">{runtime.version}</span>
            <span className="spacer" />
            <span className="meta">{runtime.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
