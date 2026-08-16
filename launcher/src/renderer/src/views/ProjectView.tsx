import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon.tsx';
import { useI18n } from '../i18n.tsx';
import { unwrapOr } from '../result.ts';
import type { SessionHook } from '../session.ts';
import type { ProjectSummaryDto, ProjectFootprintDto } from '../../../shared/ipc.ts';
import { ModelPreview } from '../components/ModelPreview.tsx';
import { usePreviews } from '../previews.ts';
import { slugify, isValidIdentifier, type EllaProject } from '../../../shared/project.ts';
import type { EntryKind } from '../../../shared/protocol.ts';

interface Props {
  session: SessionHook;
  onOpenEntry: (id: string) => void;
}

export function ProjectView({ session, onOpenEntry }: Props) {
  const { t, locale } = useI18n();
  const { project } = session;
  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [editing, setEditing] = useState(false);
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

  const closeProject = async (): Promise<void> => {
    unwrapOr(await window.ella.projects.close(), (message) => setError(message));
  };

  return (
    <div>
      <h1>{t('project.title')}</h1>
      {error && <div className="warning error">{error}</div>}

      {!project || creating ? (
        <CreateProject
          existing={projects}
          onCancel={project ? () => setCreating(false) : undefined}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onOpen={open}
        />
      ) : (
        <>
          <div className="card">
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div className="name">{project.name}</div>
                <div className="meta">
                  {project.namespace} · {project.entries.length} {t('project.entries').toLowerCase()}
                </div>
                {session.state.projectRoot && (
                  <div className="help" style={{ marginTop: 4 }}>
                    {session.state.projectRoot}
                  </div>
                )}
              </div>
              <span className="spacer" />
              <button onClick={() => setEditing((current) => !current)}>
                {t('project.edit')}
              </button>
              <button onClick={() => setCreating(true)}>{t('project.new')}</button>
              <button onClick={() => void closeProject()}>{t('project.close')}</button>
              <button className="danger" onClick={() => setDeletingProject(true)}>
                <Icon name="trash" />{t('project.delete')}
              </button>
            </div>
          </div>

          {editing && (
            <EditProject
              project={project}
              onDone={() => setEditing(false)}
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
                refresh();
              }}
              onError={setError}
            />
          )}

          <NewEntry session={session} onCreated={onOpenEntry} onError={setError} />

          <div className="row" style={{ marginTop: 22, marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>{t('project.entries')}</h2>
            <span className="spacer" />
            <div className="tabs" style={{ margin: 0 }}>
              <button
                className={`tab${view === 'cards' ? ' active' : ''}`}
                onClick={() => setView('cards')}
              >
                {t('project.viewCards')}
              </button>
              <button
                className={`tab${view === 'rows' ? ' active' : ''}`}
                onClick={() => setView('rows')}
              >
                {t('project.viewRows')}
              </button>
            </div>
          </div>

          {project.entries.length === 0 ? (
            <div className="empty">{t('project.noEntries')}</div>
          ) : view === 'rows' ? (
            <div className="list">
              {project.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="list-row"
                  onClick={() => onOpenEntry(entry.id)}
                >
                  <span className="badge">{t(`entry.kind.${entry.kind}`)}</span>
                  <span className="name">
                    {entry.displayName[locale] ?? entry.displayName.en}
                  </span>
                  <span className="meta">{entry.id}</span>
                  <span className="spacer" />
                  <span className="meta">
                    {entry.slot === null
                      ? t('entry.unbound')
                      : `${t('entry.slot')} ${entry.slot}`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-grid">
              {project.entries.map((entry) => (
                <button
                  key={entry.id}
                  className="entry-card"
                  onClick={() => onOpenEntry(entry.id)}
                >
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
                    {entry.id} ·{' '}
                    {entry.slot === null ? t('entry.unbound') : `#${entry.slot}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface EditProjectProps {
  project: EllaProject;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * Editing the open project's name and namespace.
 *
 * The namespace warning is not decoration: it names the asset directory and appears in
 * every texture reference inside the models, so changing it rewrites files. Ella handles
 * that, but anything referencing the old namespace from outside the project — a hand-written
 * model, an already-exported pack — will not follow.
 */
function EditProject({ project, onDone, onError }: EditProjectProps) {
  const { t } = useI18n();
  const [name, setName] = useState(project.name);
  const [namespace, setNamespace] = useState(project.namespace);
  const [busy, setBusy] = useState(false);

  const namespaceChanged = namespace.trim() !== project.namespace;
  const valid = name.trim().length > 0 && isValidIdentifier(namespace.trim());
  const changed = name.trim() !== project.name || namespaceChanged;

  const save = async (): Promise<void> => {
    setBusy(true);
    const result = await window.ella.projects.updateInfo({
      name: name.trim(),
      namespace: namespace.trim(),
    });
    setBusy(false);

    if (result.ok) onDone();
    else onError(result.message);
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t('project.edit')}</h2>

      <div className="field">
        <label>{t('project.name')}</label>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </div>

      <div className="field">
        <label>{t('project.namespace')}</label>
        <input value={namespace} onChange={(event) => setNamespace(event.target.value)} />
        <div className="help">{t('project.namespaceHelp')}</div>
      </div>

      {namespaceChanged && (
        <div className="warning">
          {t('project.namespaceChangeWarning', {
            from: project.namespace,
            to: namespace.trim(),
          })}
        </div>
      )}

      <div className="row">
        <button className="primary" onClick={() => void save()} disabled={!valid || !changed || busy}>
          {t('common.save')}
        </button>
        <button onClick={onDone} disabled={busy}>
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

      <div className="warning error" style={{ marginTop: 8 }}>
        {t('project.deleteWarning', {
          entries: footprint?.entryCount ?? 0,
          files: footprint?.authoredFiles ?? 0,
        })}
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

interface CreateProps {
  existing: ProjectSummaryDto[];
  onCancel?: () => void;
  onCreated: () => void;
  onOpen: (root: string) => void;
}

function CreateProject({ existing, onCancel, onCreated, onOpen }: CreateProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The namespace tracks the name until the user edits it themselves.
  const effectiveNamespace = touched ? namespace : slugify(name);
  const valid = name.trim().length > 0 && isValidIdentifier(effectiveNamespace);

  const create = async (): Promise<void> => {
    const result = await window.ella.projects.create(name.trim(), effectiveNamespace, []);
    if (unwrapOr(result, (message) => setError(message))) onCreated();
  };

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('project.new')}</h2>
        {error && <div className="warning error">{error}</div>}

        <div className="field">
          <label>{t('project.name')}</label>
          <input value={name} onChange={(event) => setName(event.target.value)} />
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

        <div className="row">
          <button className="primary" onClick={() => void create()} disabled={!valid}>
            {t('common.save')}
          </button>
          {onCancel && <button onClick={onCancel}>{t('common.cancel')}</button>}
        </div>
      </div>

      {existing.length > 0 && (
        <>
          <h2>{t('project.open')}</h2>
          <div className="list">
            {existing.map((summary) => (
              <div key={summary.root} className="list-row" onClick={() => onOpen(summary.root)}>
                <span className="name">{summary.name}</span>
                <span className="meta">{summary.namespace}</span>
                <span className="spacer" />
                <span className="meta">{summary.entryCount}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

interface NewEntryProps {
  session: SessionHook;
  onCreated: (id: string) => void;
  onError: (message: string) => void;
}

function NewEntry({ session, onCreated, onError }: NewEntryProps) {
  const { t } = useI18n();
  const [kind, setKind] = useState<EntryKind>('block');
  const [nameEn, setNameEn] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [id, setId] = useState('');
  const [touched, setTouched] = useState(false);

  const effectiveId = touched ? id : slugify(nameEn);
  const valid = nameEn.trim().length > 0 && isValidIdentifier(effectiveId);

  const create = async (): Promise<void> => {
    const displayName = nameFr.trim()
      ? { en: nameEn.trim(), fr: nameFr.trim() }
      : { en: nameEn.trim() };

    const result = await window.ella.entries.create({ id: effectiveId, kind, displayName });
    const entry = result.ok ? result.value : null;
    if (!entry) {
      onError(result.ok ? '' : result.message);
      return;
    }

    setNameEn('');
    setNameFr('');
    setId('');
    setTouched(false);
    onCreated(entry.id);
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t('entry.new')}</h2>

      <div className="field-grid">
        <div className="field">
          <label>{t('entry.kind')}</label>
          <select value={kind} onChange={(event) => setKind(event.target.value as EntryKind)}>
            <option value="block">{t('entry.kind.block')}</option>
            <option value="item">{t('entry.kind.item')}</option>
          </select>
        </div>

        <div className="field">
          <label>{t('entry.displayName')} · EN</label>
          <input value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
        </div>

        <div className="field">
          <label>{t('entry.displayName')} · FR</label>
          <input value={nameFr} onChange={(event) => setNameFr(event.target.value)} />
        </div>

        <div className="field">
          <label>{t('entry.id')}</label>
          <input
            value={effectiveId}
            onChange={(event) => {
              setTouched(true);
              setId(event.target.value);
            }}
          />
          <div className="help">{t('entry.idHelp')}</div>
        </div>
      </div>

      <button className="primary" onClick={() => void create()} disabled={!valid}>
        {kind === 'block' ? t('entry.newBlock') : t('entry.newItem')}
      </button>
      {session.state.status === 'connected' && (
        <span className="meta" style={{ marginLeft: 10 }}>
          {t('game.connected')}
        </span>
      )}
    </div>
  );
}
