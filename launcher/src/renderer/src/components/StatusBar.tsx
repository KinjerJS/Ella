import { useI18n } from '../i18n.tsx';
import type { SessionHook } from '../session.ts';

export function StatusBar({ session }: { session: SessionHook }) {
  const { t } = useI18n();
  const { state, progress, project } = session;

  const connected = state.status === 'connected';
  const running = state.status === 'running' || state.status === 'starting';

  const usedSlots = project?.entries.filter((entry) => entry.slot !== null).length ?? 0;
  const totalSlots = state.game
    ? state.game.slots.block + state.game.slots.item
    : ((project?.slotPool.block ?? 0) + (project?.slotPool.item ?? 0));

  return (
    <div className="statusbar">
      <span>
        <span className={`dot${connected ? ' connected' : running ? ' running' : ''}`} />
        {connected ? t('game.connected') : running ? t('versions.launching') : t('game.disconnected')}
      </span>

      {state.game && (
        <span>
          {state.game.minecraftVersion} · {state.game.loader} · {state.game.adapter}
        </span>
      )}

      {project && (
        <span>
          {project.name} · {t('game.slotsUsed', { used: usedSlots, total: totalSlots })}
        </span>
      )}

      <span className="spacer" />

      {progress && (
        <span style={{ minWidth: 220 }}>
          <div className="progress">
            <div style={{ width: `${Math.round((progress.completed / Math.max(progress.total, 1)) * 100)}%` }} />
          </div>
        </span>
      )}
      {progress && (
        <span>
          {progress.completed} / {progress.total}
        </span>
      )}
    </div>
  );
}
