import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-i18n-'));
process.env.STATE_DIR = directory;
const { state } = await import('../src/store.js');
const { commandsFor, language, t } = await import('../src/i18n.js');
after(() => rmSync(directory, { recursive: true, force: true }));

test('the saved server language controls translated text', () => {
  state.messages = { language: 'es' };
  assert.equal(language(), 'es');
  assert.equal(t('Stats'), 'Estadísticas');
  state.messages = { language: 'en' };
  assert.equal(t('Stats'), 'Stats');
});

test('command localization leaves the definitions untouched', () => {
  const source = [{ name: 'test', description: 'Stats', options: [{ name: 'kind', description: 'Stats' }] }];
  const [localized] = commandsFor(source, 'es');
  assert.equal(localized.description, 'Estadísticas');
  assert.equal(localized.description_localizations['es-ES'], 'Estadísticas');
  assert.equal(source[0].description_localizations, undefined);
});
