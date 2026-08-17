/**
 * Game and launcher output.
 *
 * Its own view because the output is global: it belongs to the running game, not to
 * whichever entry happens to be selected. It used to sit inside the entry editor, which
 * implied a per-model scope it never had.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import type { SessionHook } from '../session.ts';
import type { ConsoleLine } from '../session.ts';

type Level = ConsoleLine['level'];

const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];

export function LogsView({ session }: { session: SessionHook }) {
  const { t } = useI18n();
  const [minLevel, setMinLevel] = useState<Level>('info');
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const consoleRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const threshold = LEVELS.indexOf(minLevel);
    const needle = filter.trim().toLowerCase();

    return session.lines.filter((line) => {
      if (LEVELS.indexOf(line.level) < threshold) return false;
      return needle.length === 0 || line.text.toLowerCase().includes(needle);
    });
  }, [session.lines, minLevel, filter]);

  // Following the tail is what you want while the game boots, but not while reading back
  // through a stack trace — so it is a toggle rather than unconditional.
  useEffect(() => {
    if (follow && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [visible, follow]);

  const counts = useMemo(() => {
    const tally: Record<Level, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const line of session.lines) tally[line.level]++;
    return tally;
  }, [session.lines]);

  const connected = session.state.status === 'connected';
  const running = session.state.status !== 'stopped';

  return (
    <div className="view">
      <div className="page-head">
        <h1>{t('nav.logs')}</h1>
        <p className="subtitle inline">
          <span className={`dot${connected ? ' connected' : running ? ' running' : ''}`} />
          {connected
            ? t('game.connected')
            : running
              ? t('versions.launching')
              : t('game.disconnected')}
        </p>
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <input
          style={{ maxWidth: 280 }}
          value={filter}
          placeholder={t('logs.filter')}
          onChange={(event) => setFilter(event.target.value)}
        />

        <select
          style={{ maxWidth: 150 }}
          value={minLevel}
          onChange={(event) => setMinLevel(event.target.value as Level)}
        >
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(`logs.level.${level}`)}
            </option>
          ))}
        </select>

        <label className="inline">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          {t('logs.follow')}
        </label>

        <span className="spacer" />

        {counts.error > 0 && <span className="badge error">{counts.error}</span>}
        {counts.warn > 0 && <span className="badge warn">{counts.warn}</span>}
        <span className="meta">
          {visible.length} / {session.lines.length}
        </span>

        <button onClick={session.clearLines} disabled={session.lines.length === 0}>
          {t('logs.clear')}
        </button>
      </div>

      <div className="console logs-console" ref={consoleRef}>
        {visible.length === 0 ? (
          <span style={{ color: 'var(--text-faint)' }}>
            {session.lines.length === 0 ? t('logs.empty') : t('logs.noMatch')}
          </span>
        ) : (
          visible.map((line) => (
            <div key={line.key} className={line.level}>
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
