import { useEffect, useState, type KeyboardEvent } from 'react';
import { Icon } from '../components/Icon.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { useToast } from '../components/Toast.tsx';
import { useI18n } from '../i18n.tsx';
import { unwrapOr } from '../result.ts';
import type { SessionHook } from '../session.ts';
import type {
  ProjectSummaryDto,
  ProjectFootprintDto,
  VersionSummaryDto,
  ModelImportPreviewDto,
} from '../../../shared/ipc.ts';
import { ModelPreview } from '../components/ModelPreview.tsx';
import { ImportModelEntry } from '../components/ImportModelEntry.tsx';
import { usePreviews } from '../previews.ts';
import { useInstalledVersions } from '../versions.ts';
import { slugify, isValidIdentifier, type EllaProject } from '../../../shared/project.ts';
import type { EntryKind } from '../../../shared/protocol.ts';

interface Props {
  session: SessionHook;
  onOpenEntry: (id: string) => void;
}

export function ProjectView({ session, onOpenEntry }: Props) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { project } = session;
  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingEntry, setAddingEntry] = useState(false);
  const [importing, setImporting] = useState<ModelImportPreviewDto | null>(null);
  // Cards by default: seeing the models is the point of this list.
  const [view, setView] = useState<'cards' | 'rows'>('cards');
  const previews = usePreviews(Boolean(project));

  const refresh = (): void => {
    void window.ella.projects.list().then(setProjects);
  };

  useEffect(refresh, [project]);

  const open = async (root: string): Promise<void> => {
    unwrapOr(await window.ella.projects.open(root), (message) => setError(message));
  };

  const pickModel = async (): Promise<void> => {
    const result = await window.ella.entries.inspectModel();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.value) {
      setAddingEntry(false);
      setImporting(result.value);
    }
  };

  const closeProject = async (): Promise<void> => {
    unwrapOr(await window.ella.projects.close(), (message) => setError(message));
  };

  if (!project || creating) {
    return (
      <div className="view">
        <div className="page-head">
          <h1>{t('project.new')}</h1>
          <p className="subtitle">{t('project.newSubtitle')}</p>
        </div>
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        <CreateProject
          existing={projects}
          onCancel={project ? () => setCreating(false) : undefined}
          onCreated={(name) => {
            setCreating(false);
            toast.ok(t('project.createdDone', { name }));
            refresh();
          }}
          onOpen={open}
        />
      </div>
    );
  }

  return (
    <div className="view">
      <div className="page-head">
        <div className="row">
          <div style={{ minWidth: 0 }}>
            <h1>{project.name}</h1>
            <p className="subtitle">
              {project.namespace} · {project.entries.length}{' '}
              {t('project.entries').toLowerCase()} ·{' '}
              {project.targetVersion ?? t('project.targetVersionNone')}
            </p>
          </div>
          <span className="spacer" />
          <button onClick={() => setEditing((current) => !current)}>{t('project.edit')}</button>
          <button onClick={() => setCreating(true)}>{t('project.new')}</button>
          <button onClick={() => void closeProject()}>{t('project.close')}</button>
          <button
            className="danger icon-only"
            onClick={() => setDeletingProject(true)}
            title={t('project.delete')}
            aria-label={t('project.delete')}
          >
            <Icon name="trash" />
          </button>
        </div>
        {session.state.projectRoot && (
          <div className="help">{session.state.projectRoot}</div>
        )}
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {editing && (
        <EditProject
          project={project}
          onDone={() => {
            setEditing(false);
            toast.ok(t('project.savedDone'));
          }}
          onCancel={() => setEditing(false)}
          onError={setError}
        />
      )}

      {deletingProject && session.state.projectRoot && (
        <DeleteProject
          root={session.state.projectRoot}
          name={project.name}
          onCancel={() => setDeletingProject(false)}
          onDone={() => {
            setDeletingProject(false);
            toast.ok(t('project.deletedDone', { name: project.name }));
            refresh();
          }}
          onError={setError}
        />
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{t('project.entries')}</h2>
        <span className="spacer" />
        {project.entries.length > 0 && (
          <div className="segmented">
            <button
              className={view === 'cards' ? 'active' : ''}
              onClick={() => setView('cards')}
            >
              {t('project.viewCards')}
            </button>
            <button className={view === 'rows' ? 'active' : ''} onClick={() => setView('rows')}>
              {t('project.viewRows')}
            </button>
          </div>
        )}
        <button onClick={() => void pickModel()} title={t('import.buttonHelp')}>
          <Icon name="download" />
          {t('import.button')}
        </button>
        <button
          className="primary"
          onClick={() => {
            setImporting(null);
            setAddingEntry((current) => !current);
          }}
        >
          <Icon name="plus" />
          {t('entry.new')}
        </button>
      </div>

      {importing && (
        <ImportModelEntry
          project={project}
          preview={importing}
          onCreated={(id) => {
            setImporting(null);
            // No toast: the import announces itself, with the way back attached.
            onOpenEntry(id);
          }}
          onCancel={() => setImporting(null)}
          onError={setError}
        />
      )}

      {!importing && (addingEntry || project.entries.length === 0) && (
        <NewEntry
          onCreated={(id, name) => {
            setAddingEntry(false);
            toast.ok(t('entry.createdDone', { name }));
            onOpenEntry(id);
          }}
          onCancel={project.entries.length > 0 ? () => setAddingEntry(false) : undefined}
          onError={setError}
        />
      )}

      {project.entries.length === 0 ? (
        !addingEntry && !importing && (
          <EmptyState
            icon="block"
            title={t('project.noEntries')}
            text={t('project.noEntriesHelp')}
          />
        )
      ) : view === 'rows' ? (
        <div className="list">
          {project.entries.map((entry) => (
            <div key={entry.id} className="list-row" onClick={() => onOpenEntry(entry.id)}>
              <Icon name={entry.kind} size={15} />
              <span className="name">
                {entry.displayName[locale] ?? entry.displayName.en}
              </span>
              <span className="meta">
                {project.namespace}:{entry.id}
              </span>
              <span className="spacer" />
              <span className="meta">
                {entry.slot === null ? t('entry.unbound') : `${t('entry.slot')} ${entry.slot}`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="card-grid">
          {project.entries.map((entry) => (
            <button key={entry.id} className="entry-card" onClick={() => onOpenEntry(entry.id)}>
              <Icon name={entry.kind} size={14} className="entry-card-kind" />
              <div className="entry-card-preview">
                <ModelPreview
                  preview={previews.find((p) => p.id === entry.id)}
                  size={112}
                />
              </div>
              <div className="entry-card-name">
                {entry.displayName[locale] ?? entry.displayName.en}
              </div>
              <div className="entry-card-meta">
                {entry.id} · {entry.slot === null ? t('entry.unbound') : `#${entry.slot}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface EditProjectProps {
  project: EllaProject;
  onDone: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

/**
 * Editing the open project's name, namespace and target version.
 *
 * The namespace warning is not decoration: it names the asset directory and appears in
 * every texture reference inside the models, so changing it rewrites files. Ella handles
 * that, but anything referencing the old namespace from outside the project — a hand-written
 * model, an already-exported pack — will not follow.
 *
 * Changing the target version here deliberately does *not* migrate the models: this is the
 * place to correct a binding that was wrong, and the launch dialog is the place to move a
 * project across versions, because that is where the consequences can be listed against
 * the files as they actually are.
 */
function EditProject({ project, onDone, onCancel, onError }: EditProjectProps) {
  const { t } = useI18n();
  const [name, setName] = useState(project.name);
  const [namespace, setNamespace] = useState(project.namespace);
  const [targetVersion, setTargetVersion] = useState(project.targetVersion ?? '');
  const [busy, setBusy] = useState(false);
  const versions = useInstalledVersions();

  const namespaceChanged = namespace.trim() !== project.namespace;
  const valid = name.trim().length > 0 && isValidIdentifier(namespace.trim());
  const changed =
    name.trim() !== project.name ||
    namespaceChanged ||
    targetVersion !== (project.targetVersion ?? '');

  const save = async (): Promise<void> => {
    setBusy(true);
    const result = await window.ella.projects.updateInfo({
      name: name.trim(),
      namespace: namespace.trim(),
      targetVersion: targetVersion === '' ? null : targetVersion,
    });
    setBusy(false);

    if (result.ok) onDone();
    else onError(result.message);
  };

  return (
    <div className="card">
      <div className="name" style={{ marginBottom: 12 }}>
        {t('project.edit')}
      </div>

      <div className="field-grid">
        <div className="field">
          <label>{t('project.name')}</label>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </div>

        <div className="field">
          <label>{t('project.namespace')}</label>
          <input value={namespace} onChange={(event) => setNamespace(event.target.value)} />
          <div className="help">{t('project.namespaceHelp')}</div>
        </div>

        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>{t('project.targetVersion')}</label>
          <VersionSelect
            value={targetVersion}
            versions={versions}
            onChange={setTargetVersion}
          />
          <div className="help">{t('project.targetVersionHelp')}</div>
        </div>
      </div>

      {namespaceChanged && (
        <div className="warning">
          <Icon name="alert" size={16} />
          <div>
            {t('project.namespaceChangeWarning', {
              from: project.namespace,
              to: namespace.trim(),
            })}
          </div>
        </div>
      )}

      <div className="row">
        <button
          className="primary"
          onClick={() => void save()}
          disabled={!valid || !changed || busy}
          title={!changed ? t('common.noChanges') : undefined}
        >
          {t('common.save')}
        </button>
        <button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

interface DeleteProjectProps {
  root: string;
  name: string;
  onCancel: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * Delete confirmation for a whole project.
 *
 * Unlike deleting one entry, there is no variant of this that keeps the models — so the
 * confirmation states the count of authored files, and requires the project name to be
 * typed. That friction is deliberate: this is the one action in Ella that can destroy an
 * afternoon of modelling with a single click.
 */
function DeleteProject({ root, name, onCancel, onDone, onError }: DeleteProjectProps) {
  const { t } = useI18n();
  const [footprint, setFootprint] = useState<ProjectFootprintDto | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.ella.projects.measure().then((result) => {
      if (result.ok) setFootprint(result.value);
    });
  }, [root]);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    const result = await window.ella.projects.delete(root);
    setBusy(false);
    if (result.ok) onDone();
    else onError(result.message);
  };

  return (
    <div className="card" style={{ borderColor: 'var(--error)' }}>
      <div className="name">{t('project.deleteTitle', { name })}</div>

      <div className="warning error" style={{ marginTop: 10 }}>
        <Icon name="alert" size={16} />
        <div>
          {t('project.deleteWarning', {
            entries: footprint?.entryCount ?? 0,
            files: footprint?.authoredFiles ?? 0,
          })}
        </div>
      </div>

      <div className="field" style={{ maxWidth: 320 }}>
        <label>{t('project.deleteConfirmLabel', { name })}</label>
        <input value={typed} onChange={(event) => setTyped(event.target.value)} />
      </div>

      <div className="row">
        <button
          className="danger"
          onClick={() => void confirm()}
          disabled={busy || typed !== name}
          title={typed !== name ? t('project.deleteConfirmLabel', { name }) : undefined}
        >
          {t('project.delete')}
        </button>
        <button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/**
 * Picks the version a project is authored against.
 *
 * "None" is a real answer rather than a placeholder: an unbound project takes the version
 * of its next launch, which is how every project made before this field existed acquires
 * one without being asked.
 */
function VersionSelect({
  value,
  versions,
  onChange,
}: {
  value: string;
  versions: VersionSummaryDto[];
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const known = versions.some((version) => version.id === value);

  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{t('project.targetVersionNone')}</option>
      {/* A binding whose version is no longer installed still has to be selectable, or
          simply opening this form and saving would quietly unbind the project. */}
      {value !== '' && !known && (
        <option value={value}>{t('project.targetVersionMissing', { version: value })}</option>
      )}
      {versions.map((version) => (
        <option key={version.id} value={version.id}>
          {version.id}
        </option>
      ))}
    </select>
  );
}

interface CreateProps {
  existing: ProjectSummaryDto[];
  onCancel?: () => void;
  onCreated: (name: string) => void;
  onOpen: (root: string) => void;
}

function CreateProject({ existing, onCancel, onCreated, onOpen }: CreateProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [touched, setTouched] = useState(false);
  const [targetVersion, setTargetVersion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const versions = useInstalledVersions();

  // The namespace tracks the name until the user edits it themselves.
  const effectiveNamespace = touched ? namespace : slugify(name);
  const valid = name.trim().length > 0 && isValidIdentifier(effectiveNamespace);

  const create = async (): Promise<void> => {
    const result = await window.ella.projects.create(
      name.trim(),
      effectiveNamespace,
      targetVersion === '' ? null : targetVersion,
    );
    if (unwrapOr(result, (message) => setError(message))) onCreated(name.trim());
  };

  return (
    <>
      {/* Opening beats creating when something is already there, so the existing list
          comes first — a second project made by accident is a split workspace. */}
      {existing.length > 0 && (
        <>
          <h2 style={{ marginTop: 0 }}>{t('project.open')}</h2>
          <div className="list" style={{ marginBottom: 22 }}>
            {existing.map((summary) => (
              <div
                key={summary.root}
                className="list-row"
                onClick={() => onOpen(summary.root)}
              >
                <Icon name="folder" size={15} />
                <span className="name">{summary.name}</span>
                <span className="meta">{summary.namespace}</span>
                <span className="spacer" />
                {/* The version comes before the entry count: it is what decides whether
                    opening this project also changes what the launcher will start. */}
                {summary.targetVersion && (
                  <span className="meta">{summary.targetVersion}</span>
                )}
                <span className="meta">
                  {summary.entryCount} {t('project.entries').toLowerCase()}
                </span>
                <Icon name="arrow" size={15} />
              </div>
            ))}
          </div>
          <h2>{t('project.new')}</h2>
        </>
      )}

      <div className="card">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <div className="field-grid">
          <div className="field">
            <label>{t('project.name')}</label>
            <input
              value={name}
              autoFocus
              placeholder={t('project.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="field">
            <label>{t('project.namespace')}</label>
            <input
              value={effectiveNamespace}
              onChange={(event) => {
                setTouched(true);
                setNamespace(event.target.value);
              }}
            />
            <div className="help">{t('project.namespaceHelp')}</div>
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>{t('project.targetVersion')}</label>
            <VersionSelect
              value={targetVersion}
              versions={versions}
              onChange={setTargetVersion}
            />
            <div className="help">{t('project.targetVersionHelp')}</div>
          </div>
        </div>

        <div className="row">
          <button
            className="primary"
            onClick={() => void create()}
            disabled={!valid}
            title={!valid ? t('project.nameRequired') : undefined}
          >
            <Icon name="plus" />
            {t('project.create')}
          </button>
          {onCancel && <button onClick={onCancel}>{t('common.cancel')}</button>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

interface NewEntryProps {
  onCreated: (id: string, name: string) => void;
  onCancel?: () => void;
  onError: (message: string) => void;
}

/**
 * Creating a block or an item.
 *
 * The kind is picked from two labelled buttons rather than a dropdown: it is the one
 * choice here that cannot be changed afterwards, and a closed `select` showing "Block"
 * does not read as a decision at all.
 */
function NewEntry({ onCreated, onCancel, onError }: NewEntryProps) {
  const { t } = useI18n();
  const [kind, setKind] = useState<EntryKind>('block');
  const [nameEn, setNameEn] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [id, setId] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const effectiveId = touched ? id : slugify(nameEn);
  const valid = nameEn.trim().length > 0 && isValidIdentifier(effectiveId);

  const create = async (): Promise<void> => {
    const displayName = nameFr.trim()
      ? { en: nameEn.trim(), fr: nameFr.trim() }
      : { en: nameEn.trim() };

    setBusy(true);
    const result = await window.ella.entries.create({ id: effectiveId, kind, displayName });
    setBusy(false);

    if (!result.ok) {
      onError(result.message);
      return;
    }

    const created = result.value;
    setNameEn('');
    setNameFr('');
    setId('');
    setTouched(false);
    onCreated(created.id, nameEn.trim());
  };

  const submitOnEnter = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && valid && !busy) void create();
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="field">
        <label>{t('entry.kind')}</label>
        <div className="action-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          {(['block', 'item'] as EntryKind[]).map((candidate) => (
            <button
              key={candidate}
              className="action-card"
              style={
                kind === candidate
                  ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' }
                  : undefined
              }
              onClick={() => setKind(candidate)}
              aria-pressed={kind === candidate}
            >
              <span className="action-card-icon">
                <Icon name={candidate} size={17} />
              </span>
              <span>
                <span className="action-card-title">{t(`entry.kind.${candidate}`)}</span>
                <span className="action-card-text" style={{ display: 'block' }}>
                  {t(`entry.kind.${candidate}.help`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="field-grid">
        <div className="field">
          <label>{t('entry.displayName')} · EN</label>
          <input
            value={nameEn}
            autoFocus
            onKeyDown={submitOnEnter}
            onChange={(event) => setNameEn(event.target.value)}
          />
        </div>

        <div className="field">
          <label>{t('entry.displayName')} · FR</label>
          <input
            value={nameFr}
            onKeyDown={submitOnEnter}
            placeholder={t('entry.displayNameOptional')}
            onChange={(event) => setNameFr(event.target.value)}
          />
        </div>

        <div className="field">
          <label>{t('entry.id')}</label>
          <input
            value={effectiveId}
            onKeyDown={submitOnEnter}
            onChange={(event) => {
              setTouched(true);
              setId(event.target.value);
            }}
          />
          <div className="help">{t('entry.idHelp')}</div>
        </div>
      </div>

      <div className="row">
        <button
          className="primary"
          onClick={() => void create()}
          disabled={!valid || busy}
          title={!valid ? t('entry.nameRequired') : undefined}
        >
          <Icon name="plus" />
          {kind === 'block' ? t('entry.newBlock') : t('entry.newItem')}
        </button>
        {onCancel && <button onClick={onCancel}>{t('common.cancel')}</button>}
      </div>
    </div>
  );
}
