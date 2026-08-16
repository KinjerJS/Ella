import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { useI18n } from '../i18n.tsx';
import { SettingsForm } from '../components/SettingsForm.tsx';
import { TexturePanel } from '../components/TexturePanel.tsx';
import { QuickNewEntry } from '../components/QuickNewEntry.tsx';
import { EntryHeader } from '../components/EntryHeader.tsx';
import { usePreviews } from '../previews.ts';
import type { SessionHook } from '../session.ts';

interface Props {
  session: SessionHook;
  selectedId: string | null;
  /** Null clears the selection, letting the view fall back to the first entry. */
  onSelect: (id: string | null) => void;
}

export function EditorView({ session, selectedId, onSelect }: Props) {
  const { t, locale } = useI18n();
  const { project, state } = session;
  const [error, setError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const previews = usePreviews(Boolean(project));

  // Any change of selection cancels a pending delete, so a confirmation can never end up
  // aimed at an entry other than the one it was opened for.
  useEffect(() => setDeleting(false), [selectedId]);

  const entry = useMemo(
    () => project?.entries.find((candidate) => candidate.id === selectedId) ?? null,
    [project, selectedId],
  );

  /*
   * Select something on first load so the view is never blank.
   *
   * Keyed on nothing being selected, not on the selected entry being missing: creating an
   * entry sets the selection before the updated project reaches the renderer, so a
   * "selected id not found" condition would fire in that window and jump the user back to
   * the first entry. Deletion clears the selection explicitly instead.
   */
  useEffect(() => {
    if (!selectedId && project && project.entries.length > 0) {
      onSelect(project.entries[0].id);
    }
  }, [project, selectedId, onSelect]);

  // Only the absence of a project is a dead end. An empty project still renders the
  // sidebar, because that is where the button to fill it lives.
  if (!project) return <div className="empty">{t('project.noProject')}</div>;

  const connected = state.status === 'connected';

  const patch = async (settings: Record<string, unknown>): Promise<void> => {
    if (!entry) return;
    const result = await window.ella.entries.patchLive(entry.id, settings);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setIgnored(result.value?.ignored ?? []);
  };

  const act = async (action: () => Promise<{ ok: boolean; message?: string }>): Promise<void> => {
    const result = await action();
    setError(result.ok ? null : (result.message ?? null));
  };

  return (
    <div className="split">
      <div>
        <h2 style={{ marginTop: 0 }}>{t('project.entries')}</h2>
        <QuickNewEntry onCreated={onSelect} onError={setError} />

        {project.entries.length === 0 && (
          <div className="help">{t('project.noEntries')}</div>
        )}

        <div className="list scroll-list">
          {project.entries.map((candidate) => (
            <div
              key={candidate.id}
              className={`list-row${candidate.id === selectedId ? ' selected' : ''}`}
              onClick={() => onSelect(candidate.id)}
            >
              <span className="badge">{t(`entry.kind.${candidate.kind}`)}</span>
              <span className="name">
                {candidate.displayName[locale] ?? candidate.displayName.en}
              </span>
            </div>
          ))}
        </div>
      </div>

      {entry && (
        <div>
          <h1>{entry.displayName[locale] ?? entry.displayName.en}</h1>
          <p className="subtitle">
            {entry.id} ·{' '}
            {entry.slot === null ? t('entry.unbound') : `${t('entry.slot')} ${entry.slot}`}
          </p>

          {error && <div className="warning error">{error}</div>}

          <EntryHeader
            entry={entry}
            namespace={project.namespace}
            preview={previews.find((candidate) => candidate.id === entry.id)}
            onError={setError}
            onRenamed={onSelect}
          />

          {ignored.length > 0 && (
            <div className="warning">
              {t('capability.unavailable', {
                version: state.game?.minecraftVersion ?? '?',
              })}
              {`: ${ignored.join(', ')}`}
            </div>
          )}

          {/* Actions are grouped by where they act: the first three reach outside Ella
              (Blockbench, the running game), the last changes the project itself. */}
          <div className="row" style={{ marginBottom: 18 }}>
            <button
              className="primary"
              onClick={() => void act(() => window.ella.entries.openInBlockbench(entry.id))}
            >
              <Icon name="external" />{t('entry.openInBlockbench')}
            </button>
            <button
              disabled={!connected || entry.slot === null}
              onClick={() => void act(() => window.ella.entries.give(entry.id))}
            >
              {t('entry.give')}
            </button>
            <button
              disabled={!connected || entry.slot === null || !session.hasCapability('entry.place')}
              onClick={() => void act(() => window.ella.entries.place(entry.id))}
            >
              {t('entry.place')}
            </button>
            <span className="spacer" />
            <button className="danger" onClick={() => setDeleting(true)}>
              <Icon name="trash" />{t('entry.delete')}
            </button>
          </div>

          {deleting && (
            <DeleteEntry
              entryId={entry.id}
              onCancel={() => setDeleting(false)}
              onDone={() => {
                setDeleting(false);
                setError(null);
                // The selection now points at something gone; hand it back so the
                // auto-select effect picks the next entry.
                onSelect(null);
              }}
              onError={setError}
            />
          )}

          <h2>{t('texture.title')}</h2>
          <TexturePanel entryId={entry.id} onError={setError} />

          <SettingsForm
            kind={entry.kind}
            settings={entry.settings}
            capabilities={state.capabilities}
            minecraftVersion={state.game?.minecraftVersion ?? null}
            onChange={(next) => void patch(next)}
          />
        </div>
      )}
    </div>
  );
}

interface DeleteEntryProps {
  entryId: string;
  onCancel: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * Delete confirmation for one entry.
 *
 * Keeping the model and texture files is the default. Removing an entry from the project
 * is cheap to undo by recreating it; deleting the .json and .png is not, and the two
 * should not be bundled into one button.
 */
function DeleteEntry({ entryId, onCancel, onDone, onError }: DeleteEntryProps) {
  const { t } = useI18n();
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    const result = await window.ella.entries.delete(entryId, deleteFiles);
    setBusy(false);
    if (result.ok) onDone();
    else onError(result.message);
  };

  return (
    <div className="card" style={{ borderColor: 'var(--error)' }}>
      <div className="name">{t('entry.deleteTitle', { id: entryId })}</div>
      <div className="help" style={{ marginTop: 4 }}>
        {t('entry.deleteExplain')}
      </div>

      <label className="inline" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          checked={deleteFiles}
          onChange={(event) => setDeleteFiles(event.target.checked)}
        />
        {t('entry.deleteFiles')}
      </label>

      {deleteFiles && (
        <div className="warning error" style={{ marginTop: 10 }}>
          {t('entry.deleteFilesWarning')}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="danger" onClick={() => void confirm()} disabled={busy}>
          {t('entry.delete')}
        </button>
        <button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

