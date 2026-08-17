/**
 * Compact entry creation, for the editor sidebar.
 *
 * The full form lives in the Project view; this exists so that adding a block during a
 * modelling session does not mean leaving the editor. It asks for a name and a kind and
 * nothing else — the identifier is derived, and the French name and settings are editable
 * afterwards in the editor itself.
 *
 * The kind sits *inside* the composer rather than in front of it. Two buttons up front made
 * the choice look like two separate features, and picking one swapped the whole row for a
 * taller form, so the list below jumped every time. Here the panel opens once, at a fixed
 * size, and the kind is a toggle you can still change while typing the name.
 */

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from './Icon.tsx';
import { slugify, isValidIdentifier } from '../../../shared/project.ts';
import type { EntryKind } from '../../../shared/protocol.ts';

interface Props {
  /** Shown with the derived id, so the resource location is visible before creating. */
  namespace: string;
  /** Called with the new entry's id, so the caller can select it. */
  onCreated: (id: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

export function QuickNewEntry({ namespace, onCreated, onCancel, onError }: Props) {
  const { t } = useI18n();
  const [kind, setKind] = useState<EntryKind>('block');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on open: this is a keyboard-speed path, not a form to fill in.
  useEffect(() => inputRef.current?.focus(), []);

  const id = slugify(name);
  const valid = name.trim().length > 0 && isValidIdentifier(id);

  const create = async (): Promise<void> => {
    if (!valid || busy) return;

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
    onCreated(result.value.id);
  };

  return (
    <div className="card" style={{ padding: 12, marginBottom: 10 }}>
      <div className="segmented fill" style={{ marginBottom: 10 }}>
        {(['block', 'item'] as EntryKind[]).map((candidate) => (
          <button
            key={candidate}
            className={kind === candidate ? 'active' : ''}
            onClick={() => setKind(candidate)}
            aria-pressed={kind === candidate}
          >
            <Icon name={candidate} size={13} />
            {t(`entry.kind.${candidate}`)}
          </button>
        ))}
      </div>

      <input
        ref={inputRef}
        value={name}
        placeholder={t('entry.displayName')}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void create();
          if (event.key === 'Escape') onCancel();
        }}
      />

      {/* The identifier is derived, not typed, so the resource location the game will see
          is spelled out before anything is written. */}
      <div className="help" style={{ minHeight: 16 }}>
        {name.trim().length === 0 ? '' : valid ? `${namespace}:${id}` : t('entry.idHelp')}
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="primary"
          style={{ flex: 1 }}
          onClick={() => void create()}
          disabled={!valid || busy}
          title={valid ? undefined : t('entry.nameRequired')}
        >
          <Icon name="plus" />
          {t('entry.create')}
        </button>
        <button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
