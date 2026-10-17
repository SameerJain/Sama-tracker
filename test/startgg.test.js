import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { getCharacterSets, getEventHistory, getSetHistory } from '../src/startgg.js';
import { predict } from '../src/predict.js';

const originalFetch = globalThis.fetch;
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
after(() => { mock.timers.reset(); globalThis.fetch = originalFetch; });

async function settle(promise) {
  let done = false;
  promise.finally(() => { done = true; }).catch(() => {});
  while (!done) {
    mock.timers.tick(100);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return promise;
}

function reply(data) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data }) });
}

const event = { slug: 'tournament/t/event/e', name: 'Singles', videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'T' } };
const slots = [10, 20].map((id) => ({ entrant: { id, name: `P${id}`, initialSeedNum: 1, participants: [{ player: { id } }] }, standing: { stats: { score: { value: 1 } } } }));

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
