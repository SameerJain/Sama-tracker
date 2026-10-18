import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-track-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { parseTournamentLink, readTrackRequest, writeTrackRequest } = await import('../src/track-request.js');
const { importTrackRequest } = await import('../src/tracker.js');
const { getAttendees, queueLength } = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const requestFile = join(directory, 'track-request.json');

// the fake answers a queued background check from importTrackRequest too.
// the check starts in a microtask, so let that happen before looking at the queue
async function settleFetch() {
  await new Promise((resolve) => setImmediate(resolve));
  const deadline = Date.now() + 3000;
  while (queueLength() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

test('tournament links keep the attendees page event filter', () => {
  assert.deepEqual(
    parseTournamentLink('https://www.start.gg/tournament/smashcade-2-4/attendees?filter=%7B%22eventIds%22%3A%5B%221682422%22%5D%7D'),
    { slug: 'smashcade-2-4', eventIds: ['1682422'] },
  );
  assert.deepEqual(parseTournamentLink('start.gg/tournament/genesis-x/details'), { slug: 'genesis-x', eventIds: null });
  assert.deepEqual(parseTournamentLink('genesis-x'), { slug: 'genesis-x', eventIds: null });
  // a filter that isn't eventIds, or isn't JSON, leaves the whole tournament in
  assert.deepEqual(parseTournamentLink('https://start.gg/tournament/x?filter=nope'), { slug: 'x', eventIds: null });
  assert.deepEqual(parseTournamentLink('https://start.gg/tournament/x?filter=%7B%22poolIds%22%3A%5B1%5D%7D'), { slug: 'x', eventIds: null });
  // not a tournament
  assert.equal(parseTournamentLink('https://www.start.gg/user/f64a83c8'), null);
});

test('attendees come back with the account behind each one, and the filter goes with the request', async () => {
  const calls = [];
  const nodes = [
    { gamerTag: 'Crew', player: { id: 10, gamerTag: 'Crew' }, user: { id: '1', slug: 'user/crew', images: [{ url: 'https://images.example/crew.png' }], authorizations: [{ externalId: 'crew-discord' }] } },
    { gamerTag: 'Walk Up', player: { id: 11, gamerTag: 'Walk Up' }, user: null },
  ];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    calls.push({ query, variables });
    return { ok: true, json: async () => ({ data: { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes } } } }) };
  };

  const attendees = await getAttendees(9, { eventIds: ['1682422'] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].variables, { id: 9, page: 1, eventIds: ['1682422'] });
  assert.match(calls[0].query, /participants\(query: \{ page: \$page, perPage: 100, filter: \{ eventIds: \$eventIds \} \}\)/);
  assert.deepEqual(attendees[0], { userId: '1', playerId: 10, slug: 'user/crew', tag: 'Crew', image: 'https://images.example/crew.png', discordId: 'crew-discord' });
  // a TO can add people who never made an account
  assert.equal(attendees[1].userId, undefined);
  assert.equal(attendees[1].tag, 'Walk Up');

  await getAttendees(9);
  assert.deepEqual(calls[1].variables, { id: 9, page: 1 });
  assert.ok(!calls[1].query.includes('$eventIds'));
});

test('queued attendees are added like /track add and the request is cleared', async () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', lastCheck: 1, streamAlerts: true, setResults: true } };
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    assert.match(query, /tournaments\(query:/);
    return { ok: true, json: async () => ({ data: { u2: { tournaments: { nodes: [] } } } }) };
  };
  writeTrackRequest({ source: 'Smashcade 2.4', players: [
    { userId: '2', playerId: 20, tag: 'Rival', slug: 'user/rival' },
    { userId: 1, playerId: 10, tag: 'Crew' },
  ] });

  importTrackRequest();
  assert.deepEqual(Object.keys(state.players), ['1', '2']);
  assert.equal(state.players[2].playerId, 20);
  assert.equal(state.players[2].streamAlerts, false);
  assert.equal(state.players[2].setResults, false);
  assert.equal(state.players[2].callPings, false);
  assert.ok(state.players[2].lastCheck > 1);
  assert.equal(readTrackRequest(), null);
  assert.equal(existsSync(requestFile), false);
  await settleFetch();
});

test('an all-tracked request is cleared so it does not come back forever', () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', lastCheck: 1, streamAlerts: true, setResults: true } };
  writeTrackRequest({ source: 'Smashcade 2.4', players: [{ userId: 1, playerId: 10, tag: 'Crew' }] });
  importTrackRequest();
  assert.deepEqual(Object.keys(state.players), ['1']);
  assert.equal(existsSync(requestFile), false);
});
