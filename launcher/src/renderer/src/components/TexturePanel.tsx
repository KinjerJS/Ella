/**
 * Texture variables of the selected entry.
 *
 * A model maps names to texture files, and faces refer to them by name. This lists them,
 * and offers the operations that actually come up while modelling: replace the image,
 * add or remove a variable, and choose which one feeds the break and step particles.
 */

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from './Icon.tsx';
import type { TextureVariableDto } from '../../../shared/ipc.ts';

interface Props {
  entryId: string;
  /**
   * Reports what went wrong, or null once it no longer applies. Every operation clears it
   * first: a message about the last one, still on screen after the next one worked, is
   * read as a description of the state rather than of a moment.
   */
  onError: (message: string | null) => void;
}

export function TexturePanel({ entryId, onError }: Props) {
  const { t } = useI18n();
  const [textures, setTextures] = useState<TextureVariableDto[]>([]);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = (): void => {
    void window.ella.entries.textures(entryId).then((result) => {
      if (result.ok) setTextures(result.value);
      else setTextures([]);
    });
  };

  useEffect(refresh, [entryId]);

  // Blockbench rewrites the model's texture list on save, so follow the file watcher
  // rather than assuming this panel is the only thing that changes it.
  useEffect(() => window.ella.on.files(refresh), [entryId]);

  /** Runs an operation that returns the new list, surfacing failures. */
  const run = async (
    action: () => Promise<{ ok: true; value: TextureVariableDto[] | null } | { ok: false; message: string }>,
  ): Promise<void> => {
    setBusy(true);
    onError(null);
    const result = await action();
    setBusy(false);

    if (!result.ok) {
      onError(result.message);
      return;
    }
    if (result.value) setTextures(result.value);
  };

  const add = async (): Promise<void> => {
    const key = newKey.trim();
    if (!key) return;

    setBusy(true);
    onError(null);
    const result = await window.ella.entries.addTexture(entryId, key);
    setBusy(false);

    if (!result.ok) {
      onError(result.message);
      return;
    }
    setTextures(result.value);
    setNewKey('');
    setAdding(false);
  };

  const remove = async (texture: TextureVariableDto): Promise<void> => {
    onError(null);
    // The image is kept: the variable is one line of JSON to restore, the artwork is not.
    const result = await window.ella.entries.removeTexture(entryId, texture.key, false);
    if (!result.ok) {
      onError(result.message);
      return;
    }
    setTextures(result.value.textures);

    // Not a failure — the removal worked — but the model will not load until those faces
    // are pointed somewhere else, which is worth more than a toast that scrolls away.
    if (result.value.orphanedFaces.length > 0) {
      onError(
        t('texture.orphanedFaces', {
          key: texture.key,
          faces: result.value.orphanedFaces.join(', '),
        }),
      );
    }
  };

  const drawable = textures.filter((texture) => !texture.isParticleSlot);
  const particleSlot = textures.find((texture) => texture.isParticleSlot);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="name">{t('texture.title')}</div>
        <span className="spacer" />
        <button onClick={() => setAdding((current) => !current)} disabled={busy}>
          <Icon name="plus" />{t('texture.add')}
        </button>
        <button onClick={() => void window.ella.entries.revealTexture(entryId)}>
          <Icon name="folder" />{t('texture.reveal')}
        </button>
      </div>

      {adding && (
        <div className="row" style={{ marginBottom: 10 }}>
          <input
            autoFocus
            style={{ maxWidth: 220 }}
            value={newKey}
            placeholder={t('texture.namePlaceholder')}
            onChange={(event) => setNewKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void add();
              if (event.key === 'Escape') setAdding(false);
            }}
          />
          <button className="primary" onClick={() => void add()} disabled={busy || !newKey.trim()}>
            {t('common.save')}
          </button>
          <button onClick={() => setAdding(false)}>{t('common.cancel')}</button>
        </div>
      )}

      {textures.length === 0 && <div className="help">{t('texture.none')}</div>}

      <div className="texture-list">
        {drawable.map((texture) => (
          <div key={texture.key} className="texture-row">
            <div className="texture-preview small">
              {texture.dataUri ? (
                <img src={texture.dataUri} alt="" />
              ) : (
                <div className="texture-missing">?</div>
              )}
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row" style={{ gap: 6 }}>
                <code className="texture-key">#{texture.key}</code>
                {texture.isParticle && <span className="badge">{t('texture.particle')}</span>}
                {!texture.exists && <span className="badge error">{t('texture.missingFile')}</span>}
              </div>

              <div className="help">
                {texture.reference}
                {texture.width ? ` · ${texture.width}×${texture.height}` : ''}
              </div>

              <div className="help">
                {texture.usedByFaces.length > 0
                  ? t('texture.usedBy', { faces: texture.usedByFaces.join(', ') })
                  : t('texture.unused')}
              </div>
            </div>

            <div className="row" style={{ gap: 6 }}>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() => window.ella.entries.importTexture(entryId, texture.key))
                }
              >
                {t('texture.replace')}
              </button>
              <button
                disabled={busy || texture.isParticle}
                title={t('texture.particleHelp')}
                onClick={() =>
                  void run(() =>
                    window.ella.entries.setParticleTexture(entryId, texture.key),
                  )
                }
              >
                <Icon name="sparkle" />{t('texture.useForParticles')}
              </button>
              <button className="danger" disabled={busy} onClick={() => void remove(texture)}>
                <Icon name="trash" />{t('texture.remove')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {particleSlot && (
        <div className="help" style={{ marginTop: 8 }}>
          {t('texture.particleCurrent', { reference: particleSlot.reference })}{' '}
          <button
            className="link"
            disabled={busy}
            onClick={() => void run(() => window.ella.entries.setParticleTexture(entryId, null))}
          >
            {t('texture.clearParticle')}
          </button>
        </div>
      )}
    </div>
  );
}
