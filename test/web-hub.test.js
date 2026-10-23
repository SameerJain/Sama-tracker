import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-webhub-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { dataPages } = await import('../src/embeds/system.js');
const { commands } = await import('../src/commands/definitions.js');
const { buildHub } = await import('../web/build.mjs');
import { after } from 'node:test';
after(() => rmSync(directory, { recursive: true, force: true }));

test('/data lists both series pages plus the hub now that it deploys', () => {
  const text = dataPages()[0].data.description;
  assert.ok(text.includes('monday-night-smashball.vercel.app'));
  assert.ok(text.includes('ub-smash-royale.vercel.app'));
  // HUB.url names the deployed hub, so the hub line goes out with the two series
  assert.ok(text.includes('https://samatracker.vercel.app'));
});

test('/data description names Samatracker within discord limits', () => {
  const def = commands.find((c) => c.name === 'data');
  assert.ok(def.description.includes('Samatracker'));
  assert.ok(def.description.length <= 100);
});

test('hub bundle builds from the committed series data', () => {
  const bundle = buildHub();
  assert.equal(bundle.series.length, 2);
  assert.ok(bundle.players.length > 100);
  assert.ok(bundle.bothSeries.length > 0);
  for (const s of bundle.series) {
    assert.ok(s.tournaments > 0);
    assert.ok(s.recent.length > 0 && s.recent.length <= 8);
    assert.ok(s.topWinners.length > 0);
  }
  assert.ok(existsSync(join('web', 'data', 'buffalo.json')));
  // every unified player sorts by events first, and name: ids never join
  assert.ok(bundle.players.every((p) => !String(p.id).startsWith('name:')));
  const events = bundle.players.map((p) => p.totalEvents);
  assert.deepEqual(events, [...events].sort((a, b) => b - a));
});

test('bundle carries podiums, characters, tournaments and finals', () => {
  const bundle = buildHub();
  const champ = bundle.players.find((p) => p.totalWins > 10);
  assert.ok(champ.seconds + champ.thirds + champ.fourths > 0);
  assert.ok(champ.first && champ.last && champ.first <= champ.last);
  assert.ok(champ.aliases.length >= 1);
  // tournament lists line up with the events-entered counts
  assert.ok(bundle.players.every((p) => p.tids.length <= p.totalEvents));
  assert.ok(bundle.players.some((p) => p.tids.length > 50));
  // finals point at real tournaments, characters come most-played first
  assert.ok(bundle.events.length > 100);
  const final = bundle.events.find((e) => e.w && e.r);
  assert.ok(bundle.tmap[final.t].u.startsWith('https://'));
  const ch = bundle.players.find((p) => p.topChars.length >= 2);
  assert.ok(ch.topChars[0].g >= ch.topChars[1].g);
});

test('shared bundle math: search, shared events, finals, titles', async () => {
  await import('../web/stats.js');
  const { searchPlayers, sharedEvents, finalsBetween, recentTitles } = globalThis.SamaStats;
  const players = [{ id: '1', tag: 'Ann' }, { id: '2', tag: 'Annie' }, { id: '3', tag: 'Bo' }];
  assert.deepEqual(searchPlayers(players, 'an').map((p) => p.id), ['1', '2']);
  assert.deepEqual(searchPlayers(players, 'ANN').map((p) => p.id), ['1']);
  assert.deepEqual(searchPlayers(players, '  '), []);
  const tmap = { 10: { d: '2024-01-01' }, 20: { d: '2024-02-01' }, 30: { d: '2024-03-01' } };
  assert.deepEqual(sharedEvents([10, 20, 30], [30, 10], tmap), [30, 10]);
  const events = [{ t: 10, w: '1', r: '2' }, { t: 20, w: '2', r: '1' }, { t: 30, w: '1', r: '3' }];
  assert.deepEqual(finalsBetween('1', '2', events), [events[0], events[1]]);
  assert.deepEqual(finalsBetween('1', '3', events), [events[2]]);
  assert.deepEqual(recentTitles('1', events, 1), [events[2]]);
});

test('head-to-head set records read the same from either side', async () => {
  await import('../web/stats.js');
  const { setRecord } = globalThis.SamaStats;
  // keyed lower id first: 10 won 7 sets and 15 games, 20 won 5 and 12, 9 sets had a score
  const h2h = { '10|20': [7, 5, 15, 12, 9, '2026-10-19'] };
  assert.deepEqual(setRecord('10', '20', h2h), { sets: 12, aSets: 7, bSets: 5, aGames: 15, bGames: 12, scored: 9, last: '2026-10-19' });
  assert.deepEqual(setRecord('20', '10', h2h), { sets: 12, aSets: 5, bSets: 7, aGames: 12, bGames: 15, scored: 9, last: '2026-10-19' });
  assert.equal(setRecord('10', '30', h2h), null);

  // the built bundle keys every pair lower id first, with every set they played
  const { h2h: built } = buildHub();
  for (const [key, row] of Object.entries(built).slice(0, 200)) {
    const [lo, hi] = key.split('|');
    assert.ok(lo < hi, key);
    assert.equal(row.length, 6);
    assert.ok(row[0] + row[1] >= 1 && row[4] <= row[0] + row[1]);
  }
});
