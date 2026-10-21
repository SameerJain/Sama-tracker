import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { characterUsage, leans } from '../src/characters.js';
import { getCharacterSets, setRequestGap } from '../src/startgg.js';

setRequestGap(0);

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

const game = (character, against, stage, won) => ({ character, against, stage, won });

test('usage adds up matchups and stages across every character they played', () => {
  const usage = characterUsage([
    { completedAt: 2, games: [game('Fox', 'Sheik', 'Battlefield', true), game('Falco', 'Sheik', 'Smashville', false)] },
    { completedAt: 1, games: [game('Fox', 'Marth', 'Battlefield', true), game('Fox', undefined, undefined, false)] },
    // nothing reported, still counts as looked at
    { completedAt: 0, games: [] },
  ]);
  assert.deepEqual([usage.scanned, usage.reported, usage.games], [3, 2, 4]);
  assert.deepEqual(usage.characters.map(({ name, games, wins, sets, last }) => [name, games, wins, sets, last]), [['Fox', 3, 2, 2, 2], ['Falco', 1, 0, 1, 2]]);
  // whichever of their characters it was
  assert.deepEqual(usage.against, [{ name: 'Sheik', games: 2, wins: 1 }, { name: 'Marth', games: 1, wins: 1 }]);
  assert.deepEqual(usage.stages, [{ name: 'Battlefield', games: 2, wins: 2 }, { name: 'Smashville', games: 1, wins: 0 }]);
  // per character too, for /characters' best matchup
  assert.deepEqual([...usage.characters[0].matchups.values()], [{ name: 'Sheik', games: 1, wins: 1 }, { name: 'Marth', games: 1, wins: 1 }]);
});

test('leans need 3 games and leave even records out', () => {
  const { good, bad } = leans([
    { name: 'Two games', games: 2, wins: 0 },
    { name: 'Even', games: 4, wins: 2 },
    { name: 'Bad', games: 3, wins: 1 },
    { name: 'Worse', games: 5, wins: 1 },
    { name: 'Good', games: 3, wins: 2 },
    { name: 'Better', games: 4, wins: 4 },
  ]);
  assert.deepEqual(bad.map(({ name }) => name), ['Worse', 'Bad']);
  assert.deepEqual(good.map(({ name }) => name), ['Better', 'Good']);
});

test('character sets keep each game\'s stage, and drop games without a character or a winner', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [{
    id: 1, completedAt: 100, event: { videogame: { id: 1386, displayName: 'Ultimate' } },
    slots: [{ entrant: { id: 5, participants: [{ player: { id: 10 } }] } }, { entrant: { id: 6, participants: [{ player: { id: 20 } }] } }],
    games: [
      { winnerId: 5, stage: { name: 'Battlefield' }, selections: [{ entrant: { id: 5 }, character: { name: 'Fox' } }, { entrant: { id: 6 }, character: { name: 'Sheik' } }] },
      { winnerId: 6, stage: null, selections: [{ entrant: { id: 5 }, character: { name: 'Fox' } }] },
      { winnerId: null, stage: { name: 'Smashville' }, selections: [{ entrant: { id: 5 }, character: { name: 'Fox' } }] },
      { winnerId: 5, stage: { name: 'Smashville' }, selections: [] },
    ],
  }] } } } }) });
  const { sets } = await getCharacterSets(10, 1);
  assert.deepEqual(sets[0].games, [
    { character: 'Fox', against: 'Sheik', stage: 'Battlefield', won: true },
    { character: 'Fox', against: undefined, stage: undefined, won: false },
  ]);
});
