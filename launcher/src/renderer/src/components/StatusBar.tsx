import { useI18n } from '../i18n.tsx';
import { Icon } from './Icon.tsx';
import type { SessionHook } from '../session.ts';

export function StatusBar({ session }: { session: SessionHook }) {
  const { t } = useI18n();
  const { state, progress, project } = session;

  const connected = state.status === 'connected';
  const running = state.status === 'running' || state.status === 'starting';

  const usedSlots = project?.entries.filter((entry) => entry.slot !== null).length ?? 0;
  const totalSlots = state.game
    ? state.game.slots.block + state.game.slots.item
    : (project?.slotPool.block ?? 0) + (project?.slotPool.item ?? 0);

  return (
    <div className="statusbar">
      <span className="statusbar-item">
        <span className={`dot${connected ? ' connected' : running ? ' running' : ''}`} />
        {connected
          ? t('game.connected')
          : running
            ? t('versions.launching')
            : t('game.disconnected')}
      </span>

      {state.game && (
        <span className="statusbar-item" title={t('status.adapter')}>
          <Icon name="bolt" size={12} />
          {state.game.minecraftVersion} · {state.game.loader} · {state.game.adapter}
        </span>
      )}

      {project && (
        <span className="statusbar-item" title={t('game.slotsHelp')}>
          {project.name} · {t('game.slotsUsed', { used: usedSlots, total: totalSlots })}
        </span>
      )}

      <span className="spacer" />

      {/* The label matters more than the bar: "install" and "download" take very different
          amounts of time, and a bare bar cannot say which one is moving. */}
      {progress && (
        <>
          <span className="statusbar-item">
            {progress.label ?? t(`progress.${progress.phase}`)}
          </span>
          <span style={{ minWidth: 200 }}>
            <div className="progress">
              <div
                style={{
                  width: `${Math.round((progress.completed / Math.max(progress.total, 1)) * 100)}%`,
                }}
              />
            </div>
          </span>
          <span className="statusbar-item">
            {progress.completed} / {progress.total}
          </span>
        </>
      )}
    </div>
  );
}
