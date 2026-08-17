/**
 * Renders a block's or item's settings from the declarative schema.
 *
 * Fields the running adapter cannot honour are disabled and labelled with the reason,
 * never hidden — someone testing on 1.8.9 should still be able to see that an option
 * exists, and why it is unavailable to them.
 *
 * The controls are driven by a local draft rather than by the saved project. Every change
 * has to travel to the main process, be written to disk and be pushed to the running game
 * before it comes back, and a control bound to the round trip does not follow the mouse —
 * dragging a slider looked like the window had frozen. The draft answers the keyboard and
 * mouse immediately; saving happens behind it, coalesced and never overlapping, with a
 * visible indicator so "behind" never means "silently".
 */

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from './Icon.tsx';
import {
  fieldsFor,
  checkSettings,
  isFieldAvailable,
  isOptionAvailable,
  type SettingField,
  type FieldGroup,
} from '../../../shared/settings-schema.ts';
import type { EntryKind } from '../../../shared/protocol.ts';

interface Props {
  /** Also the reset key: switching entry starts a fresh draft. */
  entryId: string;
  kind: EntryKind;
  settings: Record<string, unknown>;
  capabilities: string[];
  /** Null when no game is connected, so gating can be presented as unknown, not absent. */
  minecraftVersion: string | null;
  /** Takes the entry id explicitly so a patch in flight cannot land on the wrong entry. */
  onChange: (entryId: string, patch: Record<string, unknown>) => Promise<void>;
}

const GROUPS: FieldGroup[] = ['appearance', 'physical', 'interaction'];

/**
 * How long to wait after the last change before writing.
 *
 * Long enough that a slider drag is one write instead of forty, short enough that a
 * checkbox still feels like it took effect at once.
 */
const DEBOUNCE_MS = 200;

export function SettingsForm({
  entryId,
  kind,
  settings,
  capabilities,
  minecraftVersion,
  onChange,
}: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  /** What is waiting to be written, and for which entry — never assumed to be the current one. */
  const pending = useRef<{ entryId: string; patch: Record<string, unknown> } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // A different entry is a different draft. Keyed on the id and not on `settings`, because
  // our own write comes back through `settings` and would otherwise overwrite whatever the
  // user has moved since.
  useEffect(() => {
    setDraft(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const flush = async (): Promise<void> => {
    // One writer at a time. Anything that arrives mid-write is picked up by the loop
    // below rather than racing the request already in flight.
    if (flushing.current) return;

    flushing.current = true;
    setSaving(true);
    try {
      while (pending.current) {
        const { entryId: target, patch } = pending.current;
        pending.current = null;
        await onChangeRef.current(target, patch);
      }
    } finally {
      flushing.current = false;
      setSaving(false);
    }
  };

  const commit = (patch: Record<string, unknown>): void => {
    setDraft((current) => ({ ...current, ...patch }));

    pending.current =
      pending.current && pending.current.entryId === entryId
        ? { entryId, patch: { ...pending.current.patch, ...patch } }
        : { entryId, patch };

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, DEBOUNCE_MS);
  };

  // Leaving the entry, or the view, must not drop an edit still inside the debounce
  // window. The pending patch carries its own entry id, so writing it late is safe.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const fields = fieldsFor(kind);
  const warnings = checkSettings(kind, draft);
  const busy = saving || pending.current !== null;

  const visible = (field: SettingField): boolean =>
    !field.visibleWhen || draft[field.visibleWhen.key] === field.visibleWhen.equals;

  return (
    <div>
      <div className="row" style={{ marginTop: 26, marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>{t('entry.settings')}</h2>
        <span className="spacer" />
        {/* Present only while there is something outstanding. A permanent "saved" chip
            would be one more thing on screen that never changes. */}
        {busy && (
          <span className="save-indicator">
            <span className="spinner" />
            {t('common.saving')}
          </span>
        )}
      </div>

      {warnings.map((warning) => (
        <div className="warning" key={warning.messageKey}>
          <Icon name="alert" size={16} />
          <div>
            {t(warning.messageKey)}
            {warning.fix && (
              <>
                {' '}
                <button
                  className="link"
                  onClick={() => commit(warning.fix as Record<string, unknown>)}
                >
                  {t('warning.fix')}
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      {GROUPS.map((group) => {
        const groupFields = fields.filter((field) => field.group === group && visible(field));
        if (groupFields.length === 0) return null;

        return (
          <div key={group}>
            <h2>{t(`settings.group.${group}`)}</h2>
            <div className="field-grid">
              {groupFields.map((field) => (
                <Field
                  key={field.key}
                  field={field}
                  value={draft[field.key]}
                  capabilities={capabilities}
                  minecraftVersion={minecraftVersion}
                  onChange={(value) => commit({ [field.key]: value })}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface FieldProps {
  field: SettingField;
  value: unknown;
  capabilities: string[];
  minecraftVersion: string | null;
  onChange: (value: unknown) => void;
}

function Field({ field, value, capabilities, minecraftVersion, onChange }: FieldProps) {
  const { t } = useI18n();
  // With no game connected nothing is known to be missing, so everything stays editable.
  const available = minecraftVersion === null || isFieldAvailable(field, capabilities);

  return (
    <div className={`field${available ? '' : ' disabled'}`}>
      <label>{t(field.labelKey)}</label>
      <Control
        field={field}
        value={value}
        disabled={!available}
        capabilities={capabilities}
        knownVersion={minecraftVersion !== null}
        onChange={onChange}
      />
      {!available && minecraftVersion && (
        <div className="help">{t('capability.unavailable', { version: minecraftVersion })}</div>
      )}
      {available && field.helpKey && <div className="help">{t(field.helpKey)}</div>}
    </div>
  );
}

interface ControlProps {
  field: SettingField;
  value: unknown;
  disabled: boolean;
  capabilities: string[];
  knownVersion: boolean;
  onChange: (value: unknown) => void;
}

function Control({ field, value, disabled, capabilities, knownVersion, onChange }: ControlProps) {
  const { t } = useI18n();

  switch (field.type) {
    case 'enum':
      return (
        <select
          disabled={disabled}
          value={String(value ?? field.default)}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options.map((option) => {
            const usable = !knownVersion || isOptionAvailable(option, capabilities);
            return (
              <option key={option.value} value={option.value} disabled={!usable}>
                {t(option.labelKey)}
                {usable ? '' : ' —'}
              </option>
            );
          })}
        </select>
      );

    case 'bool':
      return (
        <input
          type="checkbox"
          disabled={disabled}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      );

    case 'int':
      return (
        <div className="inline">
          <input
            type="range"
            disabled={disabled}
            min={field.min}
            max={field.max}
            step={1}
            value={Number(value ?? field.default)}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <input
            type="number"
            style={{ width: 72 }}
            disabled={disabled}
            min={field.min}
            max={field.max}
            value={Number(value ?? field.default)}
            onChange={(event) => onChange(clamp(event.target.value, field.min, field.max))}
          />
        </div>
      );

    case 'float':
      return (
        <input
          type="number"
          disabled={disabled}
          min={field.min}
          max={field.max}
          step={field.step}
          value={Number(value ?? field.default)}
          onChange={(event) => onChange(clamp(event.target.value, field.min, field.max))}
        />
      );

    case 'box': {
      const box = Array.isArray(value) ? (value as number[]) : field.default;
      const labels = ['X₁', 'Y₁', 'Z₁', 'X₂', 'Y₂', 'Z₂'];
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {box.map((component, index) => (
            <input
              key={labels[index]}
              type="number"
              disabled={disabled}
              min={0}
              max={16}
              step={0.5}
              title={labels[index]}
              value={component}
              onChange={(event) => {
                const next = [...box];
                next[index] = clamp(event.target.value, 0, 16);
                onChange(next);
              }}
            />
          ))}
        </div>
      );
    }
  }
}

/** Keeps a typed value inside its declared bounds, treating junk as the lower bound. */
function clamp(raw: string, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}
