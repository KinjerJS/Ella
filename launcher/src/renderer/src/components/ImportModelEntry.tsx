/**
 * Creating an entry from a model JSON picked on disk.
 *
 * The file has already been read when this opens, so what the import will bring along is
 * said before anything is written: how many images were found, and — more to the point —
 * which references nothing could be found for, and whether the model inherits from a file
 * this project does not have. Both show up in game as a broken model, far from the import
 * that caused them.
 *
 * The kind is asked because it cannot be changed afterwards and the file only hints at it.
 * The name is optional, as for a duplicate: left empty, the entry is named after the file.
 */

import { useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from './Icon.tsx';
import {
  slugify,
  isValidIdentifier,
  duplicateIdFor,
  duplicateDisplayName,
  type EllaProject,
} from '../../../shared/project.ts';
import type { ModelImportPreviewDto } from '../../../shared/ipc.ts';
import type { EntryKind } from '../../../shared/protocol.ts';

interface Props {
  project: EllaProject;
  preview: ModelImportPreviewDto;
  /** Called with the new entry's id, so the caller can select it. */
  onCreated: (id: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

export function ImportModelEntry({ project, preview, onCreated, onCancel, onError }: Props) {
  const { t } = useI18n();
  const [kind, setKind] = useState<EntryKind>(preview.kind);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const isTaken = (candidate: string): boolean =>
    project.entries.some((existing) => existing.id === candidate);

  // Importing the same file twice numbers the second one, as duplicating would.
  const fileId = slugify(preview.suggestedName) || 'model';
  const fallbackId = isTaken(fileId) ? duplicateIdFor(fileId, isTaken) : fileId;
  const fallbackName =
    fallbackId === fileId
      ? preview.suggestedName
      : duplicateDisplayName({ id: fileId, displayName: { en: preview.suggestedName } }, fallbackId)
          .en;

  const typed = name.trim();
  const id = typed ? slugify(typed) : fallbackId;
  const problem = !typed
    ? null
    : !isValidIdentifier(id)
      ? t('entry.idHelp')
      : isTaken(id)
        ? t('entry.duplicateTaken', { id })
        : null;

  const confirm = async (): Promise<void> => {
    if (problem || busy) return;

    setBusy(true);
    const result = await window.ella.entries.importModel({
      path: preview.path,
      id,
      kind,
      displayName: { en: typed || fallbackName },
    });
    setBusy(false);

    if (result.ok) onCreated(result.value.id);
    else onError(result.message);
  };

  const { summary } = preview;

  return (
    <div className="card" style={{ padding: 12, marginBottom: 10 }}>
      <div className="name">{t('import.title', { file: preview.fileName })}</div>

      <div className="segmented fill" style={{ margin: '10px 0' }}>
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
        value={name}
        autoFocus
        placeholder={fallbackName}
        aria-label={t('entry.displayName')}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void confirm();
          if (event.key === 'Escape') onCancel();
        }}
      />
      <div className="help">{problem ?? `${project.namespace}:${id}`}</div>

      <div className="help" style={{ marginTop: 8 }}>
        {t('import.texturesSummary', { imported: summary.imported, vanilla: summary.vanilla })}
      </div>

      {summary.missing.length > 0 && (
        <div className="warning" style={{ marginTop: 8 }}>
          <Icon name="alert" size={16} />
          <div>{t('import.missingTextures', { list: summary.missing.join(', ') })}</div>
        </div>
      )}

      {summary.missingParent && (
        <div className="warning error" style={{ marginTop: 8 }}>
          <Icon name="alert" size={16} />
          <div>{t('import.missingParent', { parent: summary.missingParent })}</div>
        </div>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="primary"
          style={{ flex: 1 }}
          onClick={() => void confirm()}
          disabled={problem !== null || busy}
          title={problem ?? undefined}
        >
          <Icon name="download" />
          {t('import.confirm')}
        </button>
        <button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
