import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-i18n-'));
process.env.STATE_DIR = directory;
const { state } = await import('../src/store.js');
const { commandsFor, count, language, t } = await import('../src/i18n.js');
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

test('spanish covers every literal line and the main surfaces', async () => {
  const { check, dynamicKeys } = await import('../scripts/spanish.js');
  const { es, nouns } = await import('../src/i18n/es.js');
  const { missing, extra } = check(es, nouns, await dynamicKeys());
  assert.deepEqual(missing, [], `no spanish yet:\n${missing.join('\n')}`);
  assert.deepEqual(extra, [], `spanish adds a placeholder:\n${extra.join('\n')}`);

  state.messages = { language: 'es' };
  assert.equal(t('Tracking {0}'), 'Siguiendo {0}');
  const [localized] = commandsFor([{ name: 'help', description: 'Short command list, verbose:True for the full one with details' }], 'es');
  assert.match(localized.description, /corta/);
  const { help } = await import('../src/embeds/system.js');
  assert.match(help(false)[0].data.description, /Empieza aquí/);
  assert.ok(help(true).some((card) => /Vincularte|Empieza aquí|Torneos/.test(card.data.description)));
  state.messages = { language: 'en' };
});

test('spanish counts the newer report words the way the cards use them', () => {
  state.messages = { language: 'es' };
  assert.equal(count(1, 'doubles set'), '1 set de dobles');
  assert.equal(count(2, 'doubles set'), '2 sets de dobles');
  assert.equal(count(1, 'ranked set'), '1 set rankeado');
  assert.equal(count(2, 'DQ'), '2 DQs');
  state.messages = { language: 'en' };
  assert.equal(count(2, 'doubles set'), '2 doubles sets');
});
