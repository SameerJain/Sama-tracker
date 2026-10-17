import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-characters-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleCommand } = await import('../src/commands/index.js');
const { ULTIMATE, MELEE } = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const games = {
  ultimate: { id: ULTIMATE, displayName: 'Ultimate' }, melee: { id: MELEE, displayName: 'Melee' },
  sm4sh: { id: 3, displayName: 'Smash 4' }, brawl: { id: 5, displayName: 'Brawl' },
};

// a set in that game, with the character they played if one got reported
const set = (videogame, character) => ({
  id: Math.random(), completedAt: 100, event: { videogame },
  slots: [{ entrant: { id: 1, participants: [{ player: { id: 0 } }] } }, { entrant: { id: 2, participants: [{ player: { id: 99 } }] } }],
  games: character ? [{ winnerId: 1, stage: null, selections: [{ entrant: { id: 1 }, character: { name: character } }, { entrant: { id: 2 }, character: { name: 'Sheik' } }] }] : [],
});

// the history is cached per player, so each test gets its own
let nextPlayer = 100;
async function characters(sets, values = {}) {
  const playerId = nextPlayer++;
  for (const each of sets) each.slots[0].entrant.participants[0].player.id = playerId;
  state.players = { 1: { userId: 1, playerId, tag: 'Crew', slug: 'user/crew' } };
  globalThis.fetch = async (url, options) => {
    // character art
    if (!String(url).includes('api.start.gg')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    const { query } = JSON.parse(options.body);
    const data = query.includes('videogame(id:')
      ? { videogame: { characters: ['Fox', 'Pikachu', 'Marth', 'Cloud'].map((name) => ({ name, images: [{ url: `https://images.example/${name}.png` }] })) } }
      : { player: { sets: { pageInfo: { totalPages: 1 }, nodes: sets } } };
    return { ok: true, json: async () => ({ data }) };
  };

  let reply;
  let deferred;
  await handleCommand({
    commandName: 'characters',
    user: { id: 'crew-discord' },
    options: {
      getSubcommand: () => null, getString: () => '1',
      getBoolean: (name) => values[name] ?? null, getInteger: (name) => values[name] ?? null,
    },
    deferReply: async (options) => { deferred = options; },
    editReply: async (result) => { reply = result; },
  });
  assert.ok(!deferred?.flags, 'everyone in the channel sees it');
  return reply.embeds.map((embed) => ({ game: embed.data.footer.text.replace('Sama-tracker by Samatron · ', ''), text: embed.data.description }));
}

test('game is an optional choice of ultimate or melee', () => {
  const option = commands.find((command) => command.name === 'characters').options.find((each) => each.name === 'game');
  assert.ok(!option.required);
  assert.deepEqual(option.choices, [{ name: 'Ultimate', value: ULTIMATE }, { name: 'Melee', value: MELEE }]);
});

test('left out, it shows whichever of the two has more games reported', async () => {
  const cards = await characters([set(games.melee, 'Fox'), set(games.melee, 'Fox'), set(games.ultimate, 'Pikachu')]);
  assert.deepEqual(cards.map(({ game }) => game), ['Melee']);
  assert.match(cards[0].text, /\*\*Fox\*\*/);
});

test('picking a game shows it even when the other has more reported', async () => {
  const cards = await characters([set(games.melee, 'Fox'), set(games.melee, 'Fox'), set(games.ultimate, 'Pikachu')], { game: ULTIMATE });
  assert.deepEqual(cards.map(({ game }) => game), ['Ultimate']);
  assert.match(cards[0].text, /\*\*Pikachu\*\*/);
});

test('with nothing reported in either, it goes by who they played more sets in', async () => {
  const cards = await characters([set(games.melee), set(games.melee), set(games.melee), set(games.ultimate)]);
  assert.deepEqual(cards, [{ game: 'Melee', text: 'No characters reported in their last 3 Melee singles sets. Lots of tournaments don\'t bother.' }]);
});

test('a picked game they have no sets in says how far back it looked', async () => {
  const cards = await characters([set(games.ultimate, 'Pikachu'), set(games.ultimate)], { game: MELEE });
  assert.deepEqual(cards, [{ game: 'Melee', text: 'No Melee singles sets in their last 2 singles sets.' }]);
});

test('verbose puts the picked game on top, then every other reported game by most games', async () => {
  const cards = await characters([
    set(games.ultimate, 'Pikachu'), set(games.ultimate, 'Pikachu'), set(games.ultimate, 'Cloud'),
    set(games.melee, 'Fox'),
    set(games.sm4sh, 'Marth'), set(games.sm4sh, 'Marth'),
    set(games.brawl),
  ], { game: MELEE, verbose: true });
  assert.deepEqual(cards.map(({ game }) => game), ['Melee', 'Ultimate', 'Smash 4']);
  assert.match(cards.at(-1).text, /No characters reported for Brawl$/);
});

test('verbose keeps a picked game on top with nothing reported, and leaves it out of the note', async () => {
  const cards = await characters([set(games.melee), set(games.ultimate, 'Pikachu'), set(games.brawl)], { game: MELEE, verbose: true });
  assert.deepEqual(cards.map(({ game }) => game), ['Melee', 'Ultimate']);
  assert.match(cards[0].text, /^No characters reported in their last 1 Melee singles set\./);
  assert.match(cards[1].text, /No characters reported for Brawl$/);
});

test('verbose left out skips the two when neither has anything reported', async () => {
  const cards = await characters([set(games.melee), set(games.ultimate), set(games.ultimate), set(games.sm4sh, 'Marth')], { verbose: true });
  assert.deepEqual(cards.map(({ game }) => game), ['Smash 4']);
  assert.match(cards[0].text, /No characters reported for Ultimate and Melee$/);
});
