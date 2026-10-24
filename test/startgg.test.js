import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import {
  UNPLAYED_STATES, getActivePlayers, getCharacterSets, getEventHistory, getEventSets, getHeadToHead, getNextSets, getSetHistory, getSetPairings, getStats,
  getUnplayedEventSets, queueLength,
} from '../src/startgg.js';
import { predict } from '../src/predict.js';
import { settle } from './fixtures.js';

const originalFetch = globalThis.fetch;
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
after(() => { mock.timers.reset(); globalThis.fetch = originalFetch; });

function reply(data) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data }) });
}

const event = { slug: 'tournament/t/event/e', name: 'Singles', videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'T' } };
const slots = [10, 20].map((id) => ({ entrant: { id, name: `P${id}`, initialSeedNum: 1, participants: [{ player: { id } }] }, standing: { stats: { score: { value: 1 } } } }));

test('game stats fetch older pages until they have 30 matching sets', async () => {
  const melee = { ...event, videogame: { id: 1, displayName: 'Melee' } };
  const nodes = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, completedAt: 100 - i, winnerId: 10, event: i < 35 ? event : melee, slots }));
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    calls.push(variables.page ?? 1);
    const gameStandings = /recentStandings\([^)]*videogameId:\s*\$videogameId/.test(query) && variables.videogameId === 1;
    const standings = [{ placement: 2, isFinal: true, entrant: { initialSeedNum: 3, isDisqualified: false, event: gameStandings ? melee : event } }];
    const page = variables.page ?? 1;
    const perPage = Number(query.match(/perPage:\s*(\d+)/)?.[1] ?? variables.perPage);
    return { ok: true, json: async () => ({ data: { player: { recentStandings: standings, sets: { pageInfo: { totalPages: Math.ceil(nodes.length / perPage) }, nodes: nodes.slice((page - 1) * perPage, page * perPage) } } } }) };
  };

  const stats = await settle(getStats(10, { videogameId: 1 }));
  assert.deepEqual(stats.standings.map((standing) => standing.event.videogame.id), [1]);
  assert.deepEqual(stats.sets.map((set) => set.id), Array.from({ length: 30 }, (_, i) => String(i + 36)));
  assert.deepEqual(calls, [1, 2, 3]);
});

test('game stats stop at totalPages when fewer than 30 matching sets exist', async () => {
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const { variables } = JSON.parse(options.body);
    const page = variables.page ?? 1;
    calls.push(page);
    const nodes = page === 2 ? [{ id: 'older-melee', winnerId: 10, event: { ...event, videogame: { id: 1 } }, slots }] : [];
    return { ok: true, json: async () => ({ data: { player: { recentStandings: [], sets: { pageInfo: { totalPages: 2 }, nodes } } } }) };
  };

  assert.deepEqual((await settle(getStats(10, { videogameId: 1 }))).sets.map((set) => set.id), ['older-melee']);
  assert.deepEqual(calls, [1, 2]);
});

test('stats without a game filter keep the single-request recent window', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ data: { player: { recentStandings: [], sets: { pageInfo: { totalPages: 20 }, nodes: [{ id: 1, winnerId: 10, event, slots }] } } } }) };
  };
  assert.deepEqual((await settle(getStats(10))).sets.map((set) => set.id), ['1']);
  assert.equal(calls, 1);
});

test('head-to-head requests every opponent-filtered page and preserves normalized non-DQ meetings', async () => {
  const nodes = Array.from({ length: 81 }, (_, i) => ({ id: i + 1, completedAt: 100 - i, winnerId: 10, event, slots }));
  nodes.push(
    { id: 'dq', completedAt: 2, winnerId: 10, event, slots: slots.map((slot, i) => i ? slot : { ...slot, standing: { stats: { score: { value: -1 } } } }) },
    { id: 'deleted', completedAt: 1, winnerId: 10, event: null, slots },
    { id: 'teams', completedAt: 1, winnerId: 10, event, slots: slots.map((slot) => ({ ...slot, entrant: { ...slot.entrant, participants: [...slot.entrant.participants, { player: { id: 30 } }] } })) },
    { ...nodes[0] },
  );
  [nodes[0], nodes[1]] = [nodes[1], nodes[0]];
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    assert.match(query, /sets\([^)]*opponentId:\s*\$opponentId/);
    assert.equal(variables.id, 10);
    assert.equal(variables.opponentId, 20);
    // start.gg rejects entrantSize together with opponentId, so singles must be checked after fetching
    assert.deepEqual(variables.filters, { state: [3] });
    calls.push(variables.page);
    const perPage = Number(query.match(/perPage:\s*(\d+)/)?.[1] ?? variables.perPage);
    return { ok: true, json: async () => ({ data: { player: { sets: { pageInfo: { totalPages: Math.ceil(nodes.length / perPage) }, nodes: nodes.slice((variables.page - 1) * perPage, variables.page * perPage) } } } }) };
  };

  const sets = await settle(getHeadToHead(10, 20));
  assert.deepEqual(sets.map((set) => set.id), Array.from({ length: 81 }, (_, i) => String(i + 1)));
  assert.deepEqual(sets[0].sides[0].playerIds, [10]);
  assert.deepEqual(calls, [1, 2, 3]);
});

test('head-to-head fits in one request when its filtered history has one page', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ data: { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [{ id: 1, winnerId: 20, event, slots }] } } } }) };
  };
  assert.deepEqual((await settle(getHeadToHead(10, 20))).map((set) => set.id), ['1']);
  assert.equal(calls, 1);
});

test('head-to-head pages stay below the object limit when opponent results include doubles', async () => {
  const doubles = slots.map((slot) => ({ ...slot, entrant: { ...slot.entrant, participants: [...slot.entrant.participants, { player: { id: 30 } }] } }));
  const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `doubles-${i}`, winnerId: 10, event, slots: doubles }));
  nodes.push({ id: 'singles', winnerId: 10, event, slots });
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    const perPage = Number(query.match(/perPage:\s*(\d+)/)?.[1] ?? variables.perPage);
    const selected = nodes.slice((variables.page - 1) * perPage, variables.page * perPage);
    // A doubles set adds four participant/player objects to the usual ~24.
    const body = selected.length * 28 + 4 > 1000
      ? { errors: [{ message: 'Query complexity exceeds 1000 objects' }] }
      : { data: { player: { sets: { pageInfo: { totalPages: Math.ceil(nodes.length / perPage) }, nodes: selected } } } };
    return { ok: true, json: async () => body };
  };
  assert.deepEqual((await settle(getHeadToHead(10, 20))).map((set) => set.id), ['singles']);
});

// a top player's history page came back at 1003 objects from an h2h button on a stream alert
test('a history page over the object limit gets asked for again as two halves covering the same sets', async () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, completedAt: 1000 - i, winnerId: 10, event, slots }));
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const { variables: { page, perPage } } = JSON.parse(options.body);
    calls.push([page, perPage]);
    const selected = nodes.slice((page - 1) * perPage, page * perPage);
    const body = selected.length * 26 + 4 > 1000
      ? { errors: [{ message: 'Your query complexity is too high. A maximum of 1000 objects may be returned by each request. (actual: 1003)' }] }
      : { data: { player: { sets: { pageInfo: { totalPages: Math.ceil(nodes.length / perPage) }, nodes: selected } } } };
    return { ok: true, json: async () => body };
  };

  const { totalPages, sets } = await settle(getSetHistory(10, 2));
  assert.deepEqual(calls, [[2, 40], [3, 20], [4, 20]]);
  assert.equal(totalPages, 3);
  assert.deepEqual(sets.map((set) => set.id), Array.from({ length: 40 }, (_, i) => String(i + 41)));
});

test('stats keep their standings when the first page gets split', async () => {
  const nodes = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, completedAt: 100 - i, winnerId: 10, event, slots }));
  const standings = [{ placement: 2, isFinal: true, entrant: { initialSeedNum: 3, isDisqualified: false, event } }];
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const { variables: { page, perPage, standings: withStandings } } = JSON.parse(options.body);
    calls.push([page, perPage, withStandings]);
    const selected = nodes.slice((page - 1) * perPage, page * perPage);
    const body = selected.length * 34 > 1000
      ? { errors: [{ message: 'Query complexity exceeds 1000 objects' }] }
      : { data: { player: { recentStandings: withStandings ? standings : undefined, sets: { pageInfo: { totalPages: Math.ceil(nodes.length / perPage) }, nodes: selected } } } };
    return { ok: true, json: async () => body };
  };

  const stats = await settle(getStats(10));
  assert.deepEqual(calls, [[1, 30, true], [1, 15, true], [2, 15, false]]);
  assert.equal(stats.standings.length, 1);
  assert.equal(stats.sets.length, 30);
});

test('a page still over the limit at 5 sets fails with start.gg’s error instead of splitting forever', async () => {
  const sizes = [];
  // other errors don't split
  globalThis.fetch = async (_url, options) => {
    sizes.push(JSON.parse(options.body).variables.perPage);
    return { ok: true, json: async () => ({ errors: [{ message: 'Player not found' }] }) };
  };
  await assert.rejects(settle(getSetHistory(10, 1)), /Player not found/);
  assert.deepEqual(sizes, [40]);

  sizes.length = 0;
  globalThis.fetch = async (_url, options) => {
    sizes.push(JSON.parse(options.body).variables.perPage);
    return { ok: true, json: async () => ({ errors: [{ message: 'Query complexity exceeds 1000 objects' }] }) };
  };
  await assert.rejects(settle(getHeadToHead(10, 20)), /complexity/);
  // 30, then two 15s, then 15s as three 5s, and the first 5 that goes over ends it
  assert.deepEqual(sizes.slice(0, 3), [30, 15, 15]);
  assert.deepEqual([...new Set(sizes)], [30, 15, 5]);
  // the other 5s were already queued, so they go out before the next test's fake goes in
  while (queueLength()) {
    mock.timers.tick(100);
    await new Promise((resolve) => setImmediate(resolve));
  }
});

// old sets far back in someone's history can have their event deleted. /scout verbose crashed on one in predict
test('sets from a deleted event get left out instead of breaking everything after', async () => {
  reply({ player: { sets: { pageInfo: { totalPages: 1 }, nodes: [
    { id: 'kept', completedAt: 2, winnerId: 10, fullRoundText: 'Winners Round 1', event, slots },
    { id: 'deleted', completedAt: 1, winnerId: 10, fullRoundText: 'Winners Round 1', event: null, slots },
    { id: 'no players', completedAt: 1, winnerId: 10, event, slots: slots.map((slot) => ({ ...slot, entrant: { ...slot.entrant, participants: null } })) },
  ] } } });
  const { sets } = await settle(getSetHistory(10, 1));
  assert.deepEqual(sets.map((set) => set.id), ['kept', 'no players']);
  assert.deepEqual(sets[1].sides[0].playerIds, []);
  assert.equal(predict({ playerId: 10 }, { playerId: 20 }, sets, sets).game, 'Ultimate');
});

test('set histories ask for the tournament online flag the venue filter goes by', async () => {
  let query;
  globalThis.fetch = async (_url, options) => {
    query = JSON.parse(options.body).query;
    return { ok: true, json: async () => ({ data: { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } } }) };
  };
  await settle(getSetHistory(10, 1));
  assert.match(query, /tournament \{ name isOnline \}/);
});

test('character sets from a deleted event, or one without a game, get left out', async () => {
  const games = [{ winnerId: 10, stage: null, selections: [{ entrant: { id: 10 }, character: { name: 'Fox' } }] }];
  reply({ player: { sets: { pageInfo: { totalPages: 1 }, nodes: [
    { id: 1, completedAt: 3, event: { videogame: event.videogame }, slots, games },
    { id: 2, completedAt: 2, event: null, slots, games },
    { id: 3, completedAt: 1, event: { videogame: null }, slots, games },
    { id: 4, completedAt: 1, event: { videogame: event.videogame }, slots: null, games },
  ] } } });
  const { sets } = await settle(getCharacterSets(10, 1));
  assert.deepEqual(sets.map((set) => set.id), ['1', '4']);
  assert.equal(sets[0].games[0].character, 'Fox');
  // no slots means it can't tell whose picks were whose
  assert.deepEqual(sets[1].games, []);
});

test('events whose tournament is gone get left out', async () => {
  const entrant = { initialSeedNum: 3, isDisqualified: false, standing: { placement: 2 } };
  reply({ user: { events: { pageInfo: { totalPages: 1 }, nodes: [
    { ...event, startAt: 2, numEntrants: 8, state: 'COMPLETED', userEntrant: entrant },
    { ...event, slug: 'gone', tournament: null, startAt: 1, numEntrants: 8, state: 'COMPLETED', userEntrant: entrant },
  ] } } });
  assert.deepEqual((await settle(getEventHistory(1))).map(({ event: { slug } }) => slug), ['tournament/t/event/e']);
});

test('sets carry the TO’s VOD link when present, null when missing or junk', async () => {
  let query;
  globalThis.fetch = async (_url, options) => {
    query = JSON.parse(options.body).query;
    return { ok: true, json: async () => ({ data: { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [
      { id: 'vod', completedAt: 3, winnerId: 10, vodUrl: 'https://youtube.example/vod', event, slots },
      { id: 'none', completedAt: 2, winnerId: 10, event, slots },
      { id: 'junk', completedAt: 1, winnerId: 10, vodUrl: 'not a url', event, slots },
    ] } } } }) };
  };
  const { sets } = await settle(getSetHistory(10, 1));
  assert.match(query, /vodUrl/);
  assert.equal(sets.find((set) => set.id === 'vod').vod, 'https://youtube.example/vod');
  assert.equal(sets.find((set) => set.id === 'none').vod, null);
  assert.equal(sets.find((set) => set.id === 'junk').vod, null);
});

test('dense five-game character history keeps logical pages complete when 20 sets still exceed the limit', async () => {
  const nodes = Array.from({ length: 85 }, (_, i) => ({
    id: i + 1, completedAt: 1000 - i, event: { videogame: event.videogame },
    slots: [10, 20].map((id) => ({ entrant: { id, participants: [{ player: { id } }] } })),
    games: Array.from({ length: 5 }, () => ({
      winnerId: 10, stage: { name: 'Battlefield' },
      selections: [10, 20].map((id) => ({ entrant: { id }, character: { name: id === 10 ? 'Fox' : 'Falco' } })),
    })),
  }));
  globalThis.fetch = async (_url, options) => {
    const { variables: { page, perPage } } = JSON.parse(options.body);
    const selected = nodes.slice((page - 1) * perPage, page * perPage);
    // Each fully reported BO5 has 51 objects, plus four around the connection.
    const body = selected.length * 51 + 4 > 1000
      ? { errors: [{ message: 'Query complexity exceeds 1000 objects' }] }
      : { data: { player: { sets: { pageInfo: { totalPages: Math.ceil(nodes.length / perPage) }, nodes: selected } } } };
    return { ok: true, json: async () => body };
  };

  const first = await settle(getCharacterSets(10, 1));
  const rest = await settle(Promise.all([getCharacterSets(10, 2), getCharacterSets(10, 3)]));
  const pages = [first, ...rest];
  assert.deepEqual(pages.map(({ totalPages, sets }) => [totalPages, sets.length]), [[3, 40], [3, 40], [3, 5]]);
  const sets = pages.flatMap((page) => page.sets);
  assert.deepEqual(sets.map((set) => set.id), Array.from({ length: 85 }, (_, i) => String(i + 1)));
  assert.ok(sets.every((set) => set.games.length === 5));
  assert.deepEqual(sets[0].games[0], { character: 'Fox', against: 'Falco', stage: 'Battlefield', won: true });
});

test('the recap first asks which players played, 50 a request, about singles sets updated since the week began', async () => {
  const asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    const ids = [...query.matchAll(/p(\d+): player/g)].map(([, id]) => Number(id));
    asked.push({ ids, filters: variables.filters });
    // only even ids played
    const data = Object.fromEntries(ids.map((id) => [`p${id}`, { sets: { nodes: id % 2 ? [] : [{ id }] } }]));
    return { ok: true, json: async () => ({ data }) };
  };
  const players = Array.from({ length: 120 }, (_, i) => i + 1);
  const played = await settle(getActivePlayers(players, 1000));
  assert.deepEqual(asked.map(({ ids }) => ids.length), [50, 50, 20]);
  assert.deepEqual(asked[0].filters, { state: [3], entrantSize: [1], updatedAfter: 999 });
  assert.equal(played.size, 60);
  assert.ok(played.has(2) && !played.has(1));
});

test('a tracked tournament\'s events share one request for new sets, and an event with more gets its other pages on its own', async () => {
  const set = (id) => ({ id, completedAt: 100, winnerId: 10, event, slots });
  const asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('e601: event')) {
      asked.push(`events ${[...query.matchAll(/\be(\d+): event/g)].map(([, id]) => id).join(',')} since ${variables.filters.updatedAfter}`);
      return { ok: true, json: async () => ({ data: {
        e601: { sets: { pageInfo: { totalPages: 2 }, nodes: Array.from({ length: 10 }, (_, i) => set(`a${i}`)) } },
        e602: { sets: { pageInfo: { totalPages: 0 }, nodes: [] } },
      } }) };
    }
    asked.push(`event ${variables.id} page ${variables.page} of ${variables.perPage}`);
    return { ok: true, json: async () => ({ data: { event: { sets: { pageInfo: { totalPages: 2 }, nodes: [set('a10')] } } } }) };
  };
  const sets = await settle(getEventSets([601, 602], 500));
  assert.deepEqual(asked, ['events 601,602 since 500', 'event 601 page 2 of 10']);
  assert.equal(sets.length, 11);
  assert.deepEqual(sets.map((each) => each.id).slice(-2), ['a9', 'a10']);
});

test('getNextSets asks for unplayed sets and keeps only filled ones', async () => {
  const requests = [];
  const filled = { id: 501, state: 1, round: 2, fullRoundText: 'Winners Round 2', phaseGroup: { id: 77 }, station: { number: 3 }, event: { ...event, tournament: { name: 'T', startAt: 100, endAt: 200 } }, slots };
  const open = { id: 502, state: 1, round: 3, event, slots: [slots[0], { entrant: null }] };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { ok: true, json: async () => ({ data: { p10: { sets: { nodes: [filled, open] } } } }) };
  };

  const sets = await settle(getNextSets([10]));
  assert.deepEqual(sets.map((set) => [set.id, set.roundNumber, set.state]), [['501', 2, 1]]);
  assert.equal(sets[0].groupId, 77);
  assert.equal(sets[0].station, 3);
  assert.deepEqual(sets[0].event.tournament.startAt, 100);
  assert.deepEqual(sets[0].event.tournament.endAt, 200);
  assert.deepEqual(requests[0].variables.filters, { state: [1, 4, 6, 7] });
  assert.deepEqual(UNPLAYED_STATES, [1, 4, 6, 7]);
  const text = requests[0].query;
  assert.match(text, /perPage:\s*4/);
  for (const field of ['round', 'phaseGroup { id }', 'startAt', 'station', 'startAt endAt']) assert.ok(text.includes(field), field);
  for (const field of ['games', 'vodUrl', 'standing']) assert.ok(!text.includes(field), field);
});

test('getNextSets dedupes a set both players share', async () => {
  const node = { id: 9, state: 6, round: 1, event, slots };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { p10: { sets: { nodes: [node] } }, p20: { sets: { nodes: [node] } } } }) });
  assert.deepEqual((await settle(getNextSets([10, 20]))).map((set) => set.id), ['9']);
});

test('getUnplayedEventSets reads every page at 40 a page', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    requests.push({ query, variables });
    const page = variables.page ?? 1;
    const nodes = [{ id: page * 10, state: 1, round: page, event, slots }];
    return { ok: true, json: async () => ({ data: { e601: { sets: { pageInfo: { totalPages: 2 }, nodes } }, event: { sets: { pageInfo: { totalPages: 2 }, nodes } } } }) };
  };

  const sets = await settle(getUnplayedEventSets([601]));
  assert.deepEqual(sets.map((set) => set.id), ['10', '20']);
  assert.equal(requests.length, 2);
  assert.match(requests[0].query, /perPage:\s*40/);
  assert.equal(requests[1].variables.perPage, 40);
  assert.deepEqual(requests[0].variables.filters, { state: [1, 4, 6, 7], showByes: false });
  assert.ok(!requests[0].query.includes('games'));
});

test('getSetPairings gives each set its players by side, null once deleted', async () => {
  let text;
  globalThis.fetch = async (_url, options) => {
    text = JSON.parse(options.body).query;
    const side = (id) => ({ entrant: { participants: [{ player: { id } }] } });
    return { ok: true, json: async () => ({ data: { s501: { state: 1, slots: [side(10), side(20)] }, s502: null } }) };
  };
  const pairings = await settle(getSetPairings(['501', '502']));
  assert.deepEqual(pairings.get('501'), { state: 1, playerIds: [[10], [20]] });
  assert.equal(pairings.get('502'), null);
  assert.equal((text.match(/query/g) ?? []).length, 1);
});
