/**
 * Editable identity for the selected entry: its display names in both locales.
 *
 * Needed because quick-create only asks for an English name — without this there would be
 * no way to add the French one afterwards, and no way to fix a typo short of deleting the
 * entry and starting over.
 *
 * The identifier is deliberately read-only: it is baked into file paths and the exported
 * registry name, so changing it is a rename operation across several files rather than an
 * edit of one field.
 */

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import {
  isValidIdentifier,
  translationKeysFor,
  registryNameFor,
  type ProjectEntry,
} from '../../../shared/project.ts';
import type { EntryPreviewDto } from '../../../shared/ipc.ts';
import { ModelPreview } from './ModelPreview.tsx';

interface Props {
  entry: ProjectEntry;
  namespace: string;
  preview: EntryPreviewDto | undefined;
  /** Reports what went wrong, or null once it no longer applies. */
  onError: (message: string | null) => void;
  /** Called after a rename, so the caller can follow the entry to its new id. */
  onRenamed: (newId: string) => void;
}

export function EntryHeader({ entry, namespace, preview, onError, onRenamed }: Props) {
  const { t } = useI18n();
  const [en, setEn] = useState(entry.displayName.en);
  const [fr, setFr] = useState(entry.displayName.fr ?? '');
  const [id, setId] = useState(entry.id);

  // Reset when the selection changes, otherwise the fields keep the previous entry's text.
  useEffect(() => {
    setEn(entry.displayName.en);
    setFr(entry.displayName.fr ?? '');
    setId(entry.id);
  }, [entry.id]);

  /**
   * Commits an identifier change. This moves files, so it is deliberately only triggered
   * on blur or Enter — never per keystroke.
   */
  const commitId = async (): Promise<void> => {
    const next = id.trim();
    if (next === entry.id) return;

    // Whatever went wrong last time was about the value being replaced.
    onError(null);

    if (!isValidIdentifier(next)) {
      setId(entry.id);
      onError(t('entry.idHelp'));
      return;
    }

    const result = await window.ella.entries.rename(entry.id, next);
    if (!result.ok) {
      setId(entry.id);
      onError(result.message);
      return;
    }
    onRenamed(result.value.id);
  };

  const keys = translationKeysFor(namespace, { id: entry.id, kind: entry.kind });

  /**
   * Commits on blur rather than on every keystroke: each save rewrites the project and
   * pushes new names to the running game, which is far too much for one character.
   */
  const commit = async (): Promise<void> => {
    const trimmedEn = en.trim();
    const trimmedFr = fr.trim();

    if (trimmedEn.length === 0) {
      setEn(entry.displayName.en);
      return;
    }
    if (trimmedEn === entry.displayName.en && trimmedFr === (entry.displayName.fr ?? '')) {
      return;
    }

    onError(null);
    const displayName = trimmedFr ? { en: trimmedEn, fr: trimmedFr } : { en: trimmedEn };
    const result = await window.ella.entries.update(entry.id, { displayName });
    if (!result.ok) onError(result.message);
  };

  return (
    <div className="entry-identity">
      {/* Left of the fields on purpose: while renaming or retyping a display name, the
          model is the thing that tells you which entry you are actually editing. */}
      <div className="entry-identity-preview">
        <ModelPreview preview={preview} size={132} interactive label={t('entry.previewRotate')} />
      </div>

      <div className="field-grid" style={{ flex: 1, minWidth: 0 }}>
      <div className="field">
        <label>{t('entry.displayName')} · EN</label>
        <input
          value={en}
          onChange={(event) => setEn(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>

      <div className="field">
        <label>{t('entry.displayName')} · FR</label>
        <input
          value={fr}
          placeholder={en}
          onChange={(event) => setFr(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>

      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label>{t('entry.id')}</label>
        <input
          value={id}
          onChange={(event) => setId(event.target.value)}
          onBlur={() => void commitId()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setId(entry.id);
          }}
        />
        {/* Spelled out because the identifier is not just a filename: it is what an
            exported mod passes to setTranslationKey, and what the registry name uses. */}
        <div className="help">
          {t('entry.registryName')}: <code>{registryNameFor(namespace, entry.id)}</code>
        </div>
        <div className="help">
          {t('entry.translationKey')}: <code>{keys.modern}</code> · <code>{keys.legacy}</code>
        </div>
      </div>
      </div>
    </div>
  );
}
