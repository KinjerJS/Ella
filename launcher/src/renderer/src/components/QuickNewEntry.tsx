/**
 * Compact entry creation, for the editor sidebar.
 *
 * The full form lives in the Project view; this exists so that adding a block during a
 * modelling session does not mean leaving the editor. It asks for a name and nothing
 * else — the identifier is derived, and the French name and settings are editable
 * afterwards in the editor itself.
 */

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { slugify, isValidIdentifier } from '../../../shared/project.ts';
import type { EntryKind } from '../../../shared/protocol.ts';

interface Props {
  /** Called with the new entry's id, so the caller can select it. */
  onCreated: (id: string) => void;
  onError: (message: string) => void;
}

export function QuickNewEntry({ onCreated, onError }: Props) {
  const { t } = useI18n();
  const [kind, setKind] = useState<EntryKind | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus as soon as the field appears: this is a keyboard-speed path, not a form.
  useEffect(() => {
    if (kind) inputRef.current?.focus();
  }, [kind]);

  const id = slugify(name);
  const valid = name.trim().length > 0 && isValidIdentifier(id);

  const close = (): void => {
    setKind(null);
    setName('');
  };

  const create = async (): Promise<void> => {
    if (!valid || !kind || busy) return;

    setBusy(true);
    const result = await window.ella.entries.create({
      id,
      kind,
      displayName: { en: name.trim() },
    });
    setBusy(false);

    if (!result.ok) {
      onError(result.message);
      return;
    }
    close();
    onCreated(result.value.id);
  };

  if (!kind) {
    return (
      <div className="row" style={{ marginBottom: 8 }}>
        <button style={{ flex: 1 }} onClick={() => setKind('block')}>
          + {t('entry.kind.block')}
        </button>
        <button style={{ flex: 1 }} onClick={() => setKind('item')}>
          + {t('entry.kind.item')}
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 8, padding: '10px 12px' }}>
      <div className="help" style={{ marginBottom: 6 }}>
        {kind === 'block' ? t('entry.newBlock') : t('entry.newItem')}
      </div>

      <input
        ref={inputRef}
        value={name}
        placeholder={t('entry.displayName')}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void create();
          if (event.key === 'Escape') close();
        }}
      />

      {/* Shows what the identifier will be, since it is derived rather than typed. */}
      {name.trim().length > 0 && (
        <div className="help" style={{ marginTop: 4 }}>
          {valid ? id : t('entry.idHelp')}
        </div>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={() => void create()} disabled={!valid || busy}>
          {t('common.save')}
        </button>
        <button onClick={close} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
