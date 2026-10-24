import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// the refresh goes through the bot's start.gg queue, so a fake fetch answers it the way it answers the bot
const { runSeries } = await import('../series/refresh.mjs');
const { setRequestGap } = await import('../src/startgg/queue.js');
setRequestGap(0);
const directory = mkdtempSync(join(tmpdir(), 'sama-refresh-'));
const originalFetch = globalThis.fetch;
const originalToken = process.env.STARTGG_TOKEN;
after(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.STARTGG_TOKEN;
  else process.env.STARTGG_TOKEN = originalToken;
  rmSync(directory, { recursive: true, force: true });
});

const write = (name, value) => writeFileSync(join(directory, name), typeof value === 'string' ? value : JSON.stringify(value));
const read = (name) => JSON.parse(readFileSync(join(directory, name), 'utf8'));
const lines = (name) => readFileSync(join(directory, name), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

const day = 86400;
const now = Math.floor(Date.now() / 1000);
const ultimate = { id: 1386, displayName: 'Ultimate' };
const tag = (n) => ({ name: `P${n}`, participants: [{ player: { id: n, gamerTag: `P${n}` } }] });
// a night the scan saved the day before it ran, with the 18 entrants registered by then
const early = {
  id: 966964, name: 'SMASH ROYALE #49', slug: 'tournament/smash-royale-49', city: 'Buffalo', addrState: 'NY', venueName: null,
  venueAddress: 'Clemens Hall, Buffalo, NY', numAttendees: 21, startAt: now - day, endAt: now, isOnline: false,
};
const singles = { id: 1738930, name: 'Ultimate Singles', slug: 'tournament/smash-royale-49/event/ultimate-singles', numEntrants: 18, videogame: ultimate };

test('the recheck gives a night saved before it ran start.gg\'s counts, events and attendance from after it, melee included', async (t) => {
  t.mock.method(console, 'log', () => {});
  process.env.STARTGG_TOKEN = 'test-token';
  write('tournaments-events.json', [{ ...early, events: [singles] }]);
  write('tournaments.json', [{ ...early, owner: { id: 7 } }]);
  write('attendance-ultimate.json', [{ eventId: singles.id, tournamentId: early.id, entrants: Array.from({ length: 18 }, (_, i) => tag(i + 1)) }]);
  write('standings.json', [{ tournamentId: early.id, eventId: singles.id, numEntrants: 18, numAttendees: 21, standings: [] }]);
  write('noop-build.mjs', '');

  const melee = { id: 1738932, name: 'Melee Singles', slug: 'tournament/smash-royale-49/event/melee-singles', numEntrants: 9, videogame: { id: 1, displayName: 'Melee' } };
  const asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    const reply = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
    if (query.includes('tournaments(query')) return reply({ tournaments: { pageInfo: { total: 0, totalPages: 1 }, nodes: [] } });
    if (query.includes('numAttendees')) {
      asked.push('tournament');
      return reply({ tournament: { ...early, numAttendees: 48, events: [{ ...singles, numEntrants: 40 }, melee] } });
    }
    if (query.includes('standings(')) return reply({ event: { standings: { nodes: [{ placement: 1, entrant: tag(1) }] } } });
    if (query.includes('entrants(')) {
      asked.push(`entrants ${variables.id}`);
      return reply({ event: { entrants: { pageInfo: { totalPages: 1 }, nodes: Array.from({ length: 40 }, (_, i) => ({ id: i, ...tag(i + 1) })) } } });
    }
    if (query.includes('sets(')) return reply({ event: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } });
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  };

  const cfg = {
    researchDir: directory, build: join(directory, 'noop-build.mjs'), outDir: directory,
    discover: { states: ['NY'], venues: ['Clemens'], nameRe: 'smash royale' },
    mainEventRe: 'ultimate singles', skipGames: [], standingsMinEntrants: 0,
    charEventsRes: ['ultimate singles', 'melee singles'], entrantsEventsRes: ['ultimate singles'], recheckDays: 45,
  };
  const stats = await runSeries('test-series', cfg, { dryRun: false, noDeploy: true, lastRunMs: Date.now() - day * 1000 });
  assert.deepEqual(stats, { newTournaments: 0, refreshed: 1 });
  assert.deepEqual(asked, ['tournament', `entrants ${singles.id}`, `entrants ${melee.id}`]);

  // the counts and the event added after the scan, with what only the first scrape had kept
  const [saved] = read('tournaments-events.json');
  assert.equal(saved.numAttendees, 48);
  assert.deepEqual(saved.events.map((e) => [e.name, e.numEntrants]), [['Ultimate Singles', 40], ['Melee Singles', 9]]);
  assert.deepEqual(read('tournaments.json'), [{ ...early, numAttendees: 48, owner: { id: 7 } }]);
  // everyone who entered, not the 18 registered when it was saved
  assert.equal(read('attendance-ultimate.json').find((row) => row.eventId === singles.id).entrants.length, 40);
  const standings = read('standings.json').find((row) => row.eventId === singles.id);
  assert.deepEqual([standings.numEntrants, standings.numAttendees, standings.standings[0].name], [40, 48, 'P1']);
  assert.deepEqual(lines('chars-by-event.jsonl').map((row) => [row.eventName, row.numEntrants]), [['Ultimate Singles', 40], ['Melee Singles', 9]]);
  // melee players count toward attendance, from a file of their own so the ultimate bracket's list stays as it is
  assert.deepEqual(read('attendance-melee.json').map((row) => [row.eventId, row.tournamentId, row.entrants.length]), [[melee.id, early.id, 40]]);
});

test('a night start.gg no longer has keeps what was saved', async (t) => {
  t.mock.method(console, 'log', () => {});
  process.env.STARTGG_TOKEN = 'test-token';
  write('tournaments-events.json', [{ ...early, events: [singles] }]);
  write('tournaments.json', [early]);
  write('attendance-ultimate.json', []);
  write('standings.json', []);
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    const reply = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
    if (query.includes('tournaments(query')) return reply({ tournaments: { pageInfo: { total: 0, totalPages: 1 }, nodes: [] } });
    if (query.includes('numAttendees')) return reply({ tournament: null });
    throw new Error(`nothing else should be asked: ${query.slice(0, 60)}`);
  };
  const cfg = {
    researchDir: directory, build: join(directory, 'noop-build.mjs'), outDir: directory,
    discover: { states: ['NY'], venues: ['Clemens'], nameRe: 'smash royale' },
    mainEventRe: 'ultimate singles', skipGames: [], standingsMinEntrants: 0, charEventsRes: [], entrantsEventsRes: ['ultimate singles'], recheckDays: 45,
  };
  assert.deepEqual(await runSeries('test-series', cfg, { dryRun: false, noDeploy: true, lastRunMs: Date.now() }), { newTournaments: 0, refreshed: 0 });
  assert.deepEqual(read('tournaments-events.json'), [{ ...early, events: [singles] }]);
  assert.deepEqual(read('tournaments.json'), [early]);
});
