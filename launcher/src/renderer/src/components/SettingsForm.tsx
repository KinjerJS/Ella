/**
 * Renders a block's or item's settings from the declarative schema.
 *
 * Fields the running adapter cannot honour are disabled and labelled with the reason,
 * never hidden — someone testing on 1.8.9 should still be able to see that an option
 * exists, and why it is unavailable to them.
 */

import { useI18n } from '../i18n.tsx';
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
  kind: EntryKind;
  settings: Record<string, unknown>;
  capabilities: string[];
  /** Null when no game is connected, so gating can be presented as unknown, not absent. */
  minecraftVersion: string | null;
  onChange: (patch: Record<string, unknown>) => void;
}

const GROUPS: FieldGroup[] = ['appearance', 'physical', 'interaction'];

export function SettingsForm({
  kind,
  settings,
  capabilities,
  minecraftVersion,
  onChange,
}: Props) {
  const { t } = useI18n();
  const fields = fieldsFor(kind);
  const warnings = checkSettings(kind, settings);

  const visible = (field: SettingField): boolean =>
    !field.visibleWhen || settings[field.visibleWhen.key] === field.visibleWhen.equals;

  return (
    <div>
      {warnings.map((warning) => (
        <div className="warning" key={warning.messageKey}>
          {t(warning.messageKey)}
          {warning.fix && (
            <>
              {' '}
              <button onClick={() => onChange(warning.fix as Record<string, unknown>)}>
                {t('warning.fix')}
              </button>
            </>
          )}
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
                  value={settings[field.key]}
                  capabilities={capabilities}
                  minecraftVersion={minecraftVersion}
                  onChange={(value) => onChange({ [field.key]: value })}
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
