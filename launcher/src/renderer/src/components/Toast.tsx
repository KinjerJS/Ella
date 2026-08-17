/**
 * Transient confirmations, failures, and the way back out of a change.
 *
 * Inline banners were the wrong place for the first two. They render where the action was
 * triggered, which by the time a launch or an export finishes is often scrolled out of view
 * or on another tab entirely — so a success looked like nothing happening, and a failure
 * could be missed completely.
 *
 * Failures stay noticeably longer than confirmations and can be dismissed by hand: a message
 * you have to read should not disappear while you are reading it.
 *
 * An undoable toast is the third kind, and the reason it lives here rather than in a dialog:
 * a change that needs confirming *before* it happens interrupts the work, while one that can
 * be taken back afterwards does not. Its remaining time is drawn as a thinning line, because
 * an offer with a deadline should show the deadline rather than vanish mid-reach.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from './Icon.tsx';

type ToastKind = 'ok' | 'error' | 'info';

/** What an undo attempt reports back. Shaped to accept an IPC `Result` unchanged. */
type UndoOutcome = { ok: boolean; message?: string };

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  undo?: () => Promise<UndoOutcome>;
  /** Set while the undo is in flight, so the button cannot be pressed twice. */
  undoing?: boolean;
}

const LIFETIME_MS: Record<ToastKind, number> = {
  ok: 4000,
  info: 5000,
  error: 10000,
};

/**
 * Longer than a plain confirmation: this one is not just read, it is decided on, and the
 * decision needs time to reach the mouse.
 */
const UNDO_LIFETIME_MS = 9000;

const ICONS: Record<ToastKind, 'check' | 'alert' | 'info'> = {
  ok: 'check',
  error: 'alert',
  info: 'info',
};

export interface ToastApi {
  ok: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  /**
   * Reports a change and offers to reverse it.
   *
   * The offer expires with the toast, but nothing is destroyed when it does: what expires
   * is the shortcut, never the possibility.
   */
  undoable: (message: string, undo: () => Promise<UndoOutcome>) => void;
}

const noop: ToastApi = {
  ok: () => {},
  error: () => {},
  info: () => {},
  undoable: () => {},
};

const ToastContext = createContext<ToastApi>(noop);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (entry: Omit<ToastEntry, 'id'>, lifetime: number): void => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...entry, id }]);
      setTimeout(() => dismiss(id), lifetime);
    },
    [dismiss],
  );

  /**
   * Guards against a double press landing two calls in one frame, before the disabled
   * state has rendered. The second would find the offer already spent and report an error
   * for something that in fact worked.
   */
  const running = useRef(new Set<number>());

  const runUndo = useCallback(
    async (toast: ToastEntry): Promise<void> => {
      if (!toast.undo || running.current.has(toast.id)) return;
      running.current.add(toast.id);

      setToasts((current) =>
        current.map((candidate) =>
          candidate.id === toast.id ? { ...candidate, undoing: true } : candidate,
        ),
      );

      const result = await toast.undo();
      running.current.delete(toast.id);
      dismiss(toast.id);

      // Replaced rather than left in place: the offer is spent either way, and a toast
      // still showing "Undo" after one was attempted invites a second press.
      push(
        result.ok
          ? { kind: 'ok', message: t('common.undone') }
          : { kind: 'error', message: result.message ?? t('common.error') },
        result.ok ? LIFETIME_MS.ok : LIFETIME_MS.error,
      );
    },
    [dismiss, push, t],
  );

  const api = useMemo<ToastApi>(
    () => ({
      ok: (message) => push({ kind: 'ok', message }, LIFETIME_MS.ok),
      error: (message) => push({ kind: 'error', message }, LIFETIME_MS.error),
      info: (message) => push({ kind: 'info', message }, LIFETIME_MS.info),
      undoable: (message, undo) => push({ kind: 'ok', message, undo }, UNDO_LIFETIME_MS),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            <Icon name={ICONS[toast.kind]} className="toast-icon" size={17} />
            <div className="toast-body">{toast.message}</div>

            {toast.undo && (
              <button
                className="toast-undo"
                onClick={() => void runUndo(toast)}
                disabled={toast.undoing}
              >
                {t('common.undo')}
              </button>
            )}

            <button
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label={t('common.dismiss')}
            >
              <Icon name="close" size={14} />
            </button>

            {/* Only where there is something to lose by waiting. */}
            {toast.undo && (
              <span
                className="toast-life"
                style={{ animationDuration: `${UNDO_LIFETIME_MS}ms` }}
              />
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = (): ToastApi => useContext(ToastContext);
