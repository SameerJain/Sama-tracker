import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// the history cache every set and character lookup goes through, by way of the commands that use it
const directory = mkdtempSync(join(tmpdir(), 'sama-history-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
// start.gg requests go out 800ms apart, a fake clock gets through minutes of them right away
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands/index.js');
const { setHistory } = await import('../src/commands/history.js');
const startgg = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { mock.timers.reset(); globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

async function settle(promise) {
  let done = false;
  promise.finally(() => { done = true; }).catch(() => {});
  while (!done) {
    mock.timers.tick(100);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return promise;
}

// a start.gg where player id has pages[id] pages of history, a set each against player 5 or opponentId. fail says which
// requests error. asked lists 'sets 99 3' for the set history page 3 of player 99, and the like
function fakeStartgg(pages, { fail = () => false, newest = () => 0 } = {}) {
  const asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    const kind = query.includes('selections') ? 'characters' : 'sets';
    let data;
    if (query.includes('user(id:') && query.includes('authorizations')) data = { u1: { slug: 'user/me', player: { gamerTag: 'Me' }, authorizations: [{ externalId: 'me' }] } };
    else if (query.includes('user(slug:')) data = { user: { id: 2, slug: 'user/them', player: { id: 99, gamerTag: 'Them' } } };
    else if (query.includes('events(query:')) data = { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    else {
      const request = `${kind} ${variables.id} ${variables.page}`;
      asked.push(request);
      if (fail(request)) return { ok: false, status: 500, json: async () => ({}) };
      // sets played since push every page down by that many
      const index = (variables.page - 1) * 40 - newest(variables.id);
      const node = (id) => ({
        id, completedAt: 100_000 - index, fullRoundText: 'Winners Round 1', winnerId: variables.id,
        event: { slug: 'tournament/t/event/e', videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'T' } },
        slots: [variables.id, variables.opponentId ?? 5].map((player) => ({ entrant: { id: player, name: `P${player}`, initialSeedNum: 1, participants: [{ player: { id: player } }] }, standing: { stats: { score: { value: 1 } } } })),
        games: [],
      });
      const nodes = [node(`${variables.id}-${variables.page}`)];
      if (variables.page === 1 && newest(variables.id)) nodes.unshift(node(`${variables.id}-new`));
      data = { player: { sets: { pageInfo: { totalPages: pages[variables.id] ?? 1 }, nodes } } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
  return asked;
}

// runs a command as discord would, with its options. resolves to everything it replied
async function command(commandName, values = {}) {
  const replies = [];
  const interaction = {
    commandName, user: { id: 'me' },
    options: { getSubcommand: () => null, getString: (name) => values[name] ?? null, getBoolean: (name) => values[name] ?? null, getInteger: () => null },
    deferReply: async () => Object.assign(interaction, { deferred: true }),
    reply: async (result) => replies.push(result),
    editReply: async (result) => replies.push(result),
    followUp: async (result) => replies.push(result),
  };
  await settle(startgg.asCommand(() => handleCommand(interaction)));
  return replies;
}

const sets = (asked, player) => asked.filter((each) => each.startsWith(`sets ${player} `)).map((each) => Number(each.split(' ')[2]));

test('/h2h reads all opponent pages plus both histories for its predicted odds', async () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Me', slug: 'user/me', discordId: 'me' }, 3: { userId: 3, playerId: 30, tag: 'Busy', slug: 'user/busy' } };
  const asked = fakeStartgg({ 10: 3, 30: 40 });
  const replies = await command('h2h', { opponent: '3', verbose: true });
  // opponent-filtered meetings and the full history share the same request shape here, so page 1
  // shows up twice for player 10: once for the meetings, once for the odds
  assert.deepEqual(sets(asked, 10).toSorted(), [1, 1, 2, 2, 3, 3]);
  // the other player's history is only for the odds, 15 pages like /predict
  assert.deepEqual(sets(asked, 30), Array.from({ length: 15 }, (_, i) => i + 1));
  const card = replies.at(-1).embeds[0].toJSON();
  assert.equal(card.title, 'Me 3-0 Busy');
  assert.match(card.description, /\*\*Predicted:\*\*/);
});

test('/scout verbose builds on the pages /scout already has, without asking for any again', async () => {
  const asked = fakeStartgg({ 99: 40 });
  await command('scout', { profile: 'them' });
  assert.deepEqual(sets(asked, 99), Array.from({ length: 15 }, (_, i) => i + 1));
  const before = asked.length;
  await command('scout', { profile: 'them', verbose: true });
  assert.deepEqual(sets(asked.slice(before), 99), Array.from({ length: 15 }, (_, i) => i + 16));
  assert.equal(new Set(asked).size, asked.length, 'nothing asked for twice');
});

test('more pages failing keeps the copy it was adding to', async () => {
  // Them has 30 pages cached from /scout verbose. /stats verbose wants all 60, and page 40 fails
  state.players[2] = { userId: 2, playerId: 99, tag: 'Them', slug: 'user/them' };
  fakeStartgg({ 99: 60 }, { fail: (request) => request === 'sets 99 40' });
  await assert.rejects(settle(startgg.asCommand(() => handleCommand({
    commandName: 'stats', user: { id: 'me' },
    options: { getSubcommand: () => null, getString: () => '2', getBoolean: (name) => name === 'verbose' },
    deferReply: async () => {}, editReply: async () => {},
  }))), /HTTP 500/);
  // the 30 pages are still there, so /scout verbose needs none of them again
  const asked = fakeStartgg({ 99: 60 });
  await command('scout', { profile: 'them', verbose: true });
  assert.deepEqual(sets(asked, 99), []);
});

test('a first fetch that failed is not kept, so the next try asks again', async () => {
  let failed = false;
  const asked = fakeStartgg({ 40: 1 }, { fail: (request) => request === 'sets 40 1' && !failed && (failed = true) });
  await assert.rejects(settle(setHistory(40)), /HTTP 500/);
  const history = await settle(setHistory(40));
  assert.deepEqual(sets(asked, 40), [1, 1]);
  assert.deepEqual(history.map(({ id }) => id), ['40-1']);
});

test('after 10 minutes only their newest page gets asked for, and new sets show up', async () => {
  const asked = fakeStartgg({ 99: 60 }, { newest: (player) => (player === 99 ? 1 : 0) });
  mock.timers.tick(11 * 60 * 1000);
  const replies = await command('scout', { profile: 'them' });
  assert.deepEqual(sets(asked, 99), [1]);
  assert.match(JSON.stringify(replies.at(-1).embeds.map((embed) => embed.toJSON())), /set\/99-new/);
});

test('/predict counts every meeting, not just the ones still in the histories', async () => {
  // fresh ids so nothing is cached. every history set here is against player 5, so the only
  // meetings are the two the opponent-filtered lookup finds, like ones older than either history
  state.players = { 7: { userId: 7, playerId: 70, tag: 'Old', slug: 'user/old' }, 8: { userId: 8, playerId: 80, tag: 'Rival', slug: 'user/rival' } };
  const asked = fakeStartgg({ 70: 2, 80: 2 });
  const replies = await command('predict', { player: '7', opponent: '8' });
  // pages 1 and 2 twice for player 70: once for the meetings, once for the history
  assert.deepEqual(sets(asked, 70).toSorted(), [1, 1, 2, 2]);
  assert.deepEqual(sets(asked, 80), [1, 2]);
  assert.match(replies.at(-1).embeds[0].toJSON().description, /\*\*Head-to-head:\*\* \*\*Old\*\* leads 2-0/);
});
