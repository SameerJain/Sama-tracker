import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { getCharacterSets, getEventHistory, getSetHistory } from '../src/startgg.js';
import { predict } from '../src/predict.js';

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

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
  const { sets } = await getSetHistory(10, 1);
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
  const { sets } = await getCharacterSets(10, 1);
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
  assert.deepEqual((await getEventHistory(1)).map(({ event: { slug } }) => slug), ['tournament/t/event/e']);
});
