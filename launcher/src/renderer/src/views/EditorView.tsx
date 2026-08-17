import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { useToast } from '../components/Toast.tsx';
import { useI18n } from '../i18n.tsx';
import { SettingsForm } from '../components/SettingsForm.tsx';
import { TexturePanel } from '../components/TexturePanel.tsx';
import { QuickNewEntry } from '../components/QuickNewEntry.tsx';
import { EntryHeader } from '../components/EntryHeader.tsx';
import { usePreviews } from '../previews.ts';
import { findParentTrap } from '../../../shared/model-compat.ts';
import type { Facts } from '../facts.ts';
import type { SessionHook } from '../session.ts';
import type { View } from '../navigation.ts';

interface Props {
  session: SessionHook;
  facts: Facts;
  selectedId: string | null;
  /** Null clears the selection, letting the view fall back to the first entry. */
  onSelect: (id: string | null) => void;
  onNavigate: (view: View) => void;
}

export function EditorView({ session, facts, selectedId, onSelect, onNavigate }: Props) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { project, state } = session;
  const [error, setError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fixingParent, setFixingParent] = useState(false);
  const previews = usePreviews(Boolean(project));

  // Any change of selection cancels a pending delete, so a confirmation can never end up
  // aimed at an entry other than the one it was opened for.
  //
  // The error goes with it, for the same reason: it named a failure on the entry being
  // left, and reading it above a different one is worse than not seeing it at all. The
  // capability list too — it describes what the last patched entry's settings did.
  useEffect(() => {
    setDeleting(false);
    setError(null);
    setIgnored([]);
  }, [selectedId]);

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
  if (!project) {
    return (
      <div className="view">
        <EmptyState
          icon="folder"
          title={t('project.noProject')}
          text={t('project.noProjectHelp')}
          action={{
            label: t('project.new'),
            icon: 'plus',
            onClick: () => onNavigate('project'),
          }}
        />
      </div>
    );
  }

  const connected = state.status === 'connected';

  // Takes the id from the form rather than from the current selection: a patch can still
  // be in flight when the user moves to another entry, and it must land on the one it was
  // made for.
  const patch = async (id: string, settings: Record<string, unknown>): Promise<void> => {
    const result = await window.ella.entries.patchLive(id, settings);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setIgnored(result.value?.ignored ?? []);
  };

  // Read off the preview, which already carries the parsed model and is refreshed on every
  // Blockbench save — so the warning appears and clears as the file changes.
  const parentTrap = findParentTrap(
    previews.find((candidate) => candidate.id === entry?.id)?.model,
  );

  const fixParent = async (id: string): Promise<void> => {
    setFixingParent(true);
    const result = await window.ella.entries.removeModelParent(id);
    setFixingParent(false);

    // Success announces itself as an undoable change; only the failure needs saying here.
    if (!result.ok) toast.error(result.message);
  };

  const act = async (
    action: () => Promise<{ ok: boolean; message?: string }>,
    success?: string,
  ): Promise<void> => {
    const result = await action();
    if (result.ok) {
      setError(null);
      if (success) toast.ok(success);
    } else {
      toast.error(result.message ?? t('common.error'));
    }
  };

  /*
   * Why each action is unavailable, said on the control itself.
   *
   * These three buttons are dark most of the time — before a launch, before the mod
   * connects, on a version whose adapter cannot place blocks — and each has a different
   * cause with a different fix. Without the reason they read as broken.
   */
  const blockbenchBlocked = facts.blockbenchFound ? null : t('blockbench.notFoundHelp');
  const gameBlocked = !connected
    ? t('entry.needsGame')
    : entry && entry.slot === null
      ? t('entry.needsSlot')
      : null;
  const placeBlocked =
    gameBlocked ??
    (session.hasCapability('entry.place')
      ? null
      : t('capability.unavailable', { version: state.game?.minecraftVersion ?? '?' }));

  return (
    <div className="view split">
      <div>
        {/* Heading and its one action on the same line, as in the project view. The list
            then starts directly underneath instead of behind a pair of buttons the eye
            has to sort out from the entries. */}
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{t('project.entries')}</h2>
          <span className="spacer" />
          {!adding && (
            <button className="subtle" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              {t('entry.new')}
            </button>
          )}
        </div>

        {adding && (
          <QuickNewEntry
            namespace={project.namespace}
            onCreated={(id) => {
              setAdding(false);
              onSelect(id);
            }}
            onCancel={() => setAdding(false)}
            onError={setError}
          />
        )}

        {project.entries.length === 0 ? (
          <div className="help" style={{ marginTop: 10 }}>
            {t('project.noEntriesHelp')}
          </div>
        ) : (
          <div className="list scroll-list">
            {project.entries.map((candidate) => (
              <div
                key={candidate.id}
                className={`list-row${candidate.id === selectedId ? ' selected' : ''}`}
                onClick={() => onSelect(candidate.id)}
              >
                <Icon name={candidate.kind} size={15} />
                <span className="name">
                  {candidate.displayName[locale] ?? candidate.displayName.en}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {entry && (
        <div>
          <div className="page-head">
            <h1>{entry.displayName[locale] ?? entry.displayName.en}</h1>
            <p className="subtitle">
              {project.namespace}:{entry.id} ·{' '}
              {entry.slot === null ? t('entry.unbound') : `${t('entry.slot')} ${entry.slot}`}
            </p>
          </div>

          <ErrorBanner message={error} onDismiss={() => setError(null)} />

          {/* Blockbench missing blocks the only action on this page that matters, so it
              gets a banner with the fix attached rather than a tooltip on a dark button. */}
          {blockbenchBlocked && (
            <div className="warning">
              <Icon name="alert" size={16} />
              <div>
                {t('blockbench.notFound')} —{' '}
                <button className="link" onClick={() => onNavigate('settings')}>
                  {t('blockbench.setPath')}
                </button>
              </div>
            </div>
          )}

          <EntryHeader
            entry={entry}
            namespace={project.namespace}
            preview={previews.find((candidate) => candidate.id === entry.id)}
            onError={setError}
            onRenamed={onSelect}
          />

          {/* A parent silently overrides the model's own geometry on 1.8.x, so the author
              sees a plain cube and reasonably concludes Ella lost their work. Shown
              whatever version is connected: the file is wrong for 1.8 either way, and
              finding out at launch is the failure worth avoiding. */}
          {parentTrap && (
            <div className="warning">
              <Icon name="alert" size={16} />
              <div>
                {t('model.parentTrap', {
                  parent: parentTrap.parent,
                  count: parentTrap.elementCount,
                })}{' '}
                <button
                  className="link"
                  disabled={fixingParent}
                  onClick={() => void fixParent(entry.id)}
                >
                  {t('warning.fix')}
                </button>
              </div>
            </div>
          )}

          {ignored.length > 0 && (
            <div className="warning">
              <Icon name="alert" size={16} />
              <div>
                {t('capability.unavailable', {
                  version: state.game?.minecraftVersion ?? '?',
                })}
                {`: ${ignored.join(', ')}`}
              </div>
            </div>
          )}

          {/* Actions are grouped by where they act: the first three reach outside Ella
              (Blockbench, the running game), the last changes the project itself. */}
          <div className="row" style={{ marginBottom: 20 }}>
            <button
              className="primary"
              disabled={blockbenchBlocked !== null}
              title={blockbenchBlocked ?? undefined}
              onClick={() =>
                void act(() => window.ella.entries.openInBlockbench(entry.id))
              }
            >
              <Icon name="brush" />
              {t('entry.openInBlockbench')}
            </button>
            <button
              disabled={gameBlocked !== null}
              title={gameBlocked ?? undefined}
              onClick={() =>
                void act(() => window.ella.entries.give(entry.id), t('entry.giveDone'))
              }
            >
              {t('entry.give')}
            </button>
            <button
              disabled={placeBlocked !== null}
              title={placeBlocked ?? undefined}
              onClick={() =>
                void act(() => window.ella.entries.place(entry.id), t('entry.placeDone'))
              }
            >
              {t('entry.place')}
            </button>
            <span className="spacer" />
            <button
              className="danger icon-only"
              onClick={() => setDeleting(true)}
              title={t('entry.delete')}
              aria-label={t('entry.delete')}
            >
              <Icon name="trash" />
            </button>
          </div>

          {deleting && (
            <DeleteEntry
              entryId={entry.id}
              onCancel={() => setDeleting(false)}
              onDone={() => {
                setDeleting(false);
                setError(null);
                // No toast here: the deletion announces itself, with the way back attached.
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
            entryId={entry.id}
            kind={entry.kind}
            settings={entry.settings}
            capabilities={state.capabilities}
            minecraftVersion={state.game?.minecraftVersion ?? null}
            onChange={patch}
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
          <Icon name="alert" size={16} />
          <div>{t('entry.deleteFilesWarning')}</div>
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
