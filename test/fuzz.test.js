import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// thousands of made-up inputs through the code that reads what people type and what start.gg and slippi send.
// each one checks a rule that has to hold for every input, not one example. the seed is fixed, so a failure
// names the input and happens again on the next run
const directory = mkdtempSync(join(tmpdir(), 'sama-fuzz-'));
process.env.STATE_DIR = directory;
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { t } = await import('../src/i18n.js');
const { split, withLines, baseEmbed } = await import('../src/embeds/shared.js');
const { readCode } = await import('../src/slippi/shared.js');
const { parseSchedule } = await import('../src/commands/tournaments.js');
const { looksLikeProfile, nameMatches } = await import('../src/commands/shared.js');
const { MAX_REMINDERS, MAX_REMINDER_HOURS } = await import('../src/tracker/shared.js');
after(() => rmSync(directory, { recursive: true, force: true }));

// mulberry32, small and the same everywhere
function random(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// the characters that have broken things before or could: markdown, mentions, template braces, regex
// replacement patterns, a surrogate pair, a zero-width joiner and plenty of the ordinary ones
const ALPHABET = [...'abcxyzABC0189#-_ ./:,@`*|~{}[]()$&\\\n', '{0}', '{1}', '$&', '$1', '@everyone', '<@123>', '😀', '‍', 'ñ', 'é'];
function text(next, max = 40) {
  return Array.from({ length: Math.floor(next() * max) }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join('');
}

const RUNS = 3000;

test('t puts every value in exactly as given, whatever it holds', () => {
  const next = random(1);
  for (let i = 0; i < RUNS; i++) {
    const [a, b] = [text(next), text(next)];
    assert.equal(t`Tracking ${a} and ${b}.`, `Tracking ${a} and ${b}.`, JSON.stringify([a, b]));
  }
  // and the same in spanish, where the values can move
  state.messages = { language: 'es' };
  try {
    for (let i = 0; i < 500; i++) {
      const name = text(next);
      assert.equal(t`Tracking ${name}.`.includes(name), true, JSON.stringify(name));
    }
    assert.equal(t('constructor'), 'constructor');
    assert.equal(t('toString'), 'toString');
  } finally {
    state.messages = {};
  }
});

test('connect codes come out as ABCD#123 or not at all', () => {
  const next = random(2);
  for (let i = 0; i < RUNS; i++) {
    const input = text(next, 20);
    const code = readCode(input);
    if (code !== null) assert.match(code, /^[A-Z0-9]{1,8}#\d{1,7}$/, JSON.stringify(input));
  }
  for (const [input, code] of [['abcd#123', 'ABCD#123'], ['  ab-9 ', 'AB#9'], ['https://slippi.gg/user/xyz-42/', 'XYZ#42'], ['#123', null], ['abcdefghi#1', null]]) {
    assert.equal(readCode(input), code, input);
  }
});

test('reminder schedules are a sorted list inside the limits, an error, or nothing', () => {
  const next = random(3);
  const pieces = ['7d', '3d', '1d', '6h', '0', '0.5', '1.5h', '31d', '720', '721', 'x', '', ' ', ',', '1e3', '-2h', '24H', '2D'];
  for (let i = 0; i < RUNS; i++) {
    const input = Array.from({ length: Math.floor(next() * 14) }, () => pieces[Math.floor(next() * pieces.length)]).join(next() < 0.5 ? ',' : ' ');
    const schedule = parseSchedule(input);
    if (schedule === null || schedule.error) continue;
    const where = JSON.stringify(input);
    assert.ok(schedule.length >= 1 && schedule.length <= MAX_REMINDERS, where);
    assert.deepEqual(schedule, [...new Set(schedule)].sort((x, y) => y - x), where);
    assert.ok(schedule.every((hours) => hours >= 1 && hours <= MAX_REMINDER_HOURS), where);
  }
});

test('long text always splits under the limit, with nothing lost', () => {
  const next = random(4);
  for (let i = 0; i < 400; i++) {
    const max = 50 + Math.floor(next() * 400);
    // now and then a line far past the limit, the case split used to pass through whole
    const lines = Array.from({ length: Math.floor(next() * 30) }, () => text(next, next() < 0.1 ? 2000 : 80));
    const groups = split(lines, max);
    for (const group of groups) assert.ok(group.join('\n').length <= max, `${group.join('\n').length} > ${max}`);
    const squash = (list) => list.join('').replace(/[\s]/g, '');
    assert.equal(squash(groups.flat()), squash(lines));
    // never half an emoji at a cut
    for (const piece of groups.flat()) assert.doesNotMatch(piece, /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
  }
});

test('a card with one enormous line still fits discord', () => {
  const cards = withLines(baseEmbed(0), ['header', 'word '.repeat(3000), 'footer']);
  assert.ok(cards.length >= 2);
  for (const card of cards) assert.ok(card.data.description.length <= 4096);
});

test('the player box never throws on what someone types', () => {
  const next = random(5);
  for (let i = 0; i < RUNS; i++) {
    const typed = text(next, 60);
    assert.equal(typeof looksLikeProfile(typed), 'boolean', JSON.stringify(typed));
    assert.equal(typeof nameMatches(text(next), typed), 'boolean');
  }
});
