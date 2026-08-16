import test from 'node:test';
import assert from 'node:assert/strict';
import {
  translate,
  resolveLocale,
  missingKeys,
  orphanKeys,
  LOCALES,
  createTranslator,
} from '../src/shared/i18n.ts';
import { BLOCK_FIELDS, ITEM_FIELDS } from '../src/shared/settings-schema.ts';

test('every English key has a French translation', () => {
  assert.deepEqual(missingKeys('fr'), [], 'keys missing from fr.json');
});

test('French has no keys English dropped', () => {
  assert.deepEqual(orphanKeys('fr'), [], 'stale keys in fr.json');
});

test('every settings schema key resolves in both locales', () => {
  const referenced = new Set<string>();
  for (const field of [...BLOCK_FIELDS, ...ITEM_FIELDS]) {
    referenced.add(field.labelKey);
    if (field.helpKey) referenced.add(field.helpKey);
    if (field.type === 'enum') {
      for (const option of field.options) referenced.add(option.labelKey);
    }
  }

  for (const locale of LOCALES) {
    for (const key of referenced) {
      assert.notEqual(
        translate(locale, key),
        key,
        `schema key "${key}" has no ${locale} translation`,
      );
    }
  }
});

test('translations differ between locales where they should', () => {
  // Guards against a French catalog that is silently just a copy of the English one.
  assert.notEqual(translate('en', 'nav.settings'), translate('fr', 'nav.settings'));
  assert.equal(translate('fr', 'entry.kind.block'), 'Bloc');
});

test('interpolates named placeholders', () => {
  assert.equal(
    translate('en', 'game.slotsUsed', { used: 3, total: 128 }),
    '3 of 128 slots used',
  );
  assert.equal(
    translate('fr', 'game.slotsUsed', { used: 3, total: 128 }),
    '3 emplacements sur 128 utilisés',
  );
});

test('leaves an unmatched placeholder intact rather than blanking it', () => {
  assert.match(translate('en', 'game.slotsUsed', { used: 3 }), /\{total\}/);
});

test('falls back to English for a key a locale lacks', () => {
  // Simulated by asking for a key that exists only in the default catalog path.
  assert.equal(translate('fr', 'app.name'), 'Ella');
});

test('returns the key itself when nothing matches', () => {
  assert.equal(translate('en', 'no.such.key.exists'), 'no.such.key.exists');
});

test('resolves system locales onto supported ones', () => {
  assert.equal(resolveLocale('fr-FR'), 'fr');
  assert.equal(resolveLocale('fr_CA'), 'fr');
  assert.equal(resolveLocale('en-US'), 'en');
  assert.equal(resolveLocale('de-DE'), 'en');
  assert.equal(resolveLocale(undefined), 'en');
});

test('createTranslator binds a locale', () => {
  const t = createTranslator('fr');
  assert.equal(t('common.cancel'), 'Annuler');
});
