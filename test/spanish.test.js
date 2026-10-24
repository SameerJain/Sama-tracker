import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// node scripts/spanish.js runs the same check and lists what's missing. multi-server, since its commands have
// everything the single-server ones do, plus /t-o settings channel:
const directory = mkdtempSync(join(tmpdir(), 'sama-spanish-'));
process.env.STATE_DIR = directory;
process.env.MULTI_GUILD = 'true';
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { check, dynamicKeys } = await import('../scripts/spanish.js');
const { es, nouns, parts } = await import('../src/i18n/es.js');
after(() => rmSync(directory, { recursive: true, force: true }));

test('every line the bot says has spanish, and every spanish line is still said', async () => {
  const { missing, missingNouns, unused, extra } = check(es, nouns, await dynamicKeys());
  assert.deepEqual(missing, [], `no spanish yet, run node scripts/spanish.js:\n${missing.join('\n')}`);
  assert.deepEqual(missingNouns, [], `count() words with no spanish:\n${missingNouns.join('\n')}`);
  assert.deepEqual(unused, [], `spanish nothing says anymore:\n${unused.join('\n')}`);
  assert.deepEqual(extra, [], `spanish with a value the english doesn't have:\n${extra.join('\n')}`);
});

test('each english line is in one dictionary file, so two files can\'t disagree on it', () => {
  const seen = new Map();
  for (const [part, dictionary] of Object.entries(parts)) {
    for (const key of Object.keys(dictionary)) {
      assert.ok(!seen.has(key), `${JSON.stringify(key)} is in both ${seen.get(key)} and ${part}`);
      seen.set(key, part);
    }
  }
});

test('the check finds lines in t``, t(\'\'), constants passed to t and count() words', async () => {
  const { constantKeysIn, keysIn, nounsIn } = await import('../scripts/spanish.js');
  const source = [
    'const NOTE = \'-# A note\';',
    'const LIST = [\'One\', "Two"];',
    'reply(t`Hi ${name}, you have ${count(n, \'set\')} left`);',
    'reply(t(\'Plain\'), t(NOTE), t(LIST[i]), t(variable), don\'t`);',
    'count(list.filter((a, b) => a), \'singles set\', \'singles sets\');',
  ].join('\n');
  assert.deepEqual(keysIn(source), ['Hi {0}, you have {1} left', 'Plain']);
  assert.deepEqual(constantKeysIn(source), ['-# A note', 'One', 'Two']);
  assert.deepEqual(nounsIn(source), ['set', 'singles set']);
});
