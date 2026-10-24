import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

// adversarial extras: malformed start.gg payloads, button presses from the wrong
// place or after a restart, posts channels that fail, and servers leaking into
// each other. every case pins the graceful fallback, not the mock.
const directory = mkdtempSync(join(tmpdir(), 'sama-adversarial-extra-'));
process.env.STATE_DIR = directory;
process.env.MULTI_GUILD = 'true';
delete process.env.ANTHROPIC_API_KEY;
const { state, forGuild, guildLocal } = await import('../src/store.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const tracker = await import('../src/tracker.js');
const { handleCommand } = await import('../src/commands/index.js');
const { confirmable, handleChoice, undoRow } = await import('../src/commands/confirm.js');
const { failureMessage } = await import('../src/commands/shared.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
const event = {
  name: 'Ultimate Singles', slug: 'tournament/local/event/singles', videogame: { id: 1386, displayName: 'Ultimate' },
  tournament: { name: 'Local', slug: 'tournament/local', isOnline: false, images: [] },
};
// crew (player 10, entrant 1) against rival (player 20, entrant 2)
const setNode = (id, { winner = 1, scores = [2, 1], completedAt = now - 60, sides = [[1, 10, 'Crew'], [2, 20, 'Rival']] } = {}) => ({
  id, state: 3, completedAt, updatedAt: completedAt, fullRoundText: 'Winners Final',
  winnerId: winner, stream: null, event,
  slots: sides.map(([entrantId, playerId, name], i) => ({
    entrant: { id: entrantId, name, initialSeedNum: i + 1, participants: [{ player: { id: playerId } }] },
    standing: { stats: { score: { value: scores[i] } } },
  })),
  games: [],
});

// a posts channel keeping what was sent, with ids its messages can be found by
function fakeChannel(id, { failSend = false } = {}) {
  const sent = [];
  return {
    id, sent, isTextBased: () => true,
    send: async (payload) => {
      if (failSend) throw new Error('discord down');
      sent.push(payload);
      return { id: `m${sent.length}`, channelId: id };
    },
  };
}

test('a set start.gg never gave a winner, seeds or scores to still parses with nulls, never a crash', async () => {
  globalThis.fetch = async () => ({
    ok: true, status: 200, json: async () => ({
      data: {
        p10: {
          sets: {
            nodes: [
              {
                id: 'null-win', state: 3, completedAt: now - 60, updatedAt: now - 60, fullRoundText: 'Winners Final',
                winnerId: null, stream: null, event,
                slots: [
                  { entrant: { id: 1, name: 'Crew', initialSeedNum: null, participants: [{ player: { id: 10 } }] }, standing: null },
                  { entrant: { id: 2, name: 'Rival', initialSeedNum: null, participants: [{ player: { id: 20 } }] }, standing: { stats: null } },
                ],
                games: [{ winnerId: null, selections: [{ entrant: { id: 1 }, character: null }] }],
              },
            ],
          },
        },
      },
    }),
  });
  const sets = await startgg.getSets([10], { since: now - 3600 });
  assert.equal(sets.length, 1);
  assert.equal(sets[0].winnerId, null);
  assert.deepEqual(sets[0].sides.map((side) => [side.seed, side.score]), [[null, null], [null, null]]);
  assert.deepEqual(sets[0].sides[0].characters, []);
  assert.equal(sets[0].vod, null);
});

test('sets with no event, one slot or no entrants get left out instead of breaking the check', async () => {
  globalThis.fetch = async () => ({
    ok: true, status: 200, json: async () => ({
      data: {
        p10: {
          sets: {
            nodes: [
              { ...setNode('kept'), id: 'kept' },
              { ...setNode('no-event'), id: 'no-event', event: null },
              { ...setNode('one-slot'), id: 'one-slot', slots: [setNode('one-slot').slots[0]] },
              { ...setNode('no-entrant'), id: 'no-entrant', slots: [{ entrant: null, standing: null }, setNode('no-entrant').slots[1]] },
            ],
          },
        },
      },
    }),
  });
  assert.deepEqual((await startgg.getSets([10], { since: now - 3600 })).map((set) => set.id), ['kept']);
});

test('a history page that comes back empty still parses as no sets, not a crash', async () => {
  globalThis.fetch = async () => ({
    ok: true, status: 200, json: async () => ({ data: { player: { sets: { pageInfo: { totalPages: 5 }, nodes: [] } } } }),
  });
  const { totalPages, sets } = await startgg.getSetHistory(10, 3);
  assert.equal(totalPages, 5);
  assert.deepEqual(sets, []);
});

test('a set with no winner still posts its card, naming both sides with no upset line', async () => {
  await guildLocal.run('malformed', async () => {
    state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', setResults: true, lastCheck: now } };
    state.messages = {};
    state.posted = [];
    state.dqs = [];
    state.tournaments = {};
  });
  globalThis.fetch = async () => ({
    ok: true, status: 200, json: async () => ({
      data: { p10: { sets: { nodes: [{ ...setNode('801', { winner: null, scores: [null, null] }), id: '801' }] } } },
    }),
  });
  const channel = fakeChannel('c-malformed');
  tracker.setBotClient({ guilds: { cache: new Map([['malformed', {}]]) }, channels: { fetch: async (id) => (id === 'c-malformed' ? channel : null) } });
  forGuild('malformed').channelId = 'c-malformed';
  await tracker.eachGuild(async () => { await tracker.postNewSets(); });
  assert.equal(channel.sent.length, 1);
  const [card] = channel.sent[0].embeds;
  assert.match(card.data.title, /^Set result · W · Crew vs Rival · L$/);
  assert.doesNotMatch(card.data.description ?? '', /Major upset/);
  assert.deepEqual(guildLocal.run('malformed', () => state.posted), ['801']);
});

test('an Undo pressed by the wrong user is refused and stays for whoever ran it', async () => {
  confirmable('wrong-undo-kind', {
    command: '/wrong-undo',
    run: () => ({ content: 'gone', undo: { tag: 'Rival' } }),
    cancel: () => 'cancelled',
    tooLate: () => 'Too late to undo.',
    undo: (record) => `Tracking ${record.tag} again.`,
  });
  undoRow({ user: { id: 'runner' }, guildId: 'g1', editReply: async () => {} }, 'wrong-undo-kind', 'target', { tag: 'Rival' });
  const pressAs = (user) => handleChoice({
    customId: 'undo:wrong-undo-kind:target:runner', guildId: 'g1', user: { id: user },
    update: async (payload) => payload,
    reply: async (payload) => payload,
    followUp: async (payload) => payload,
  });
  const refused = await pressAs('someone-else');
  assert.equal(refused.content, 'Only whoever ran `/wrong-undo` can press this.');
  const home = await pressAs('runner');
  assert.equal(home.content, 'Tracking Rival again.');
});

test('an Undo press with nothing remembered says it is too late, the way one after a restart does', async () => {
  // a fresh copy of the module, the way a restart leaves the in-memory Undo map: empty
  const fresh = await import('../src/commands/confirm.js?restart-loss');
  fresh.confirmable('gone-kind', {
    command: '/gone',
    run: () => ({ content: 'ran' }),
    cancel: () => 'cancelled',
    tooLate: () => 'Too late to undo.',
    undo: () => 'back',
  });
  const calls = [];
  await fresh.handleChoice({
    // the button from before the restart: well formed, but nothing remembers it
    customId: 'undo:gone-kind:target:runner', guildId: 'g1', user: { id: 'runner' },
    update: async (payload) => { calls.push(['update', payload]); },
    reply: async (payload) => { calls.push(['reply', payload]); return payload; },
    followUp: async (payload) => { calls.push(['followUp', payload]); return payload; },
  });
  assert.deepEqual(calls[0], ['update', { components: [] }]);
  assert.match(calls[1][1].content, /Too late to undo/);
  assert.equal(calls[1][1].flags, MessageFlags.Ephemeral);
});

test('a start.gg page that stays over the object cap fails the command with the plain fallback', async () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', lastCheck: now } };
  state.links = {};
  state.messages = {};
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'Query complexity exceeds 1000 objects' }] }) });
  const calls = [];
  const run = {
    commandName: 'stats',
    user: { id: 'runner' },
    options: { getSubcommandGroup: () => null, getSubcommand: () => null, getString: (name) => (name === 'player' ? '1' : null), getBoolean: () => null, getInteger: () => null },
    reply: async (payload) => { calls.push(['reply', payload]); },
    deferReply: async () => { run.deferred = true; },
    editReply: async (payload) => { calls.push(['edit', payload]); },
    followUp: async (payload) => { calls.push(['followUp', payload]); },
  };
  const err = await handleCommand(run).catch((caught) => caught);
  assert.ok(err, 'the too-complex page fails instead of splitting forever');
  // the user hears whose side failed, never start.gg's raw wording or the query
  assert.equal(failureMessage(err), 'Couldn\'t get that from start.gg right now. Try again in a minute.');
  assert.ok(!err.message.includes('perPage'));
});

test('guild A\'s sets never post in guild B, and a failing channel in one never stops the other', async () => {
  const channels = { c1: fakeChannel('c1'), c2: fakeChannel('c2', { failSend: true }) };
  tracker.setBotClient({
    guilds: { cache: new Map([['g1', {}], ['g2', {}]]) },
    channels: { fetch: async (id) => channels[id] ?? null },
  });
  forGuild('g1').channelId = 'c1';
  forGuild('g2').channelId = 'c2';
  await guildLocal.run('g1', async () => {
    state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', setResults: true, lastCheck: now } };
    state.messages = {};
    state.posted = [];
    state.dqs = [];
    state.tournaments = {};
    state.resultPosts = [];
  });
  await guildLocal.run('g2', async () => {
    state.players = { 2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', setResults: true, lastCheck: now } };
    state.messages = {};
    state.posted = [];
    state.dqs = [];
    state.tournaments = {};
    state.resultPosts = [];
  });
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    const nodes = query.includes('p10:')
      ? [setNode('701')]
      : [setNode('702', { sides: [[1, 20, 'Rival'], [2, 30, 'Opponent']] })];
    return { ok: true, status: 200, json: async () => ({ data: Object.fromEntries(nodes.map((node) => [`p${node.slots[0].entrant.participants[0].player.id}`, { sets: { nodes } }])) }) };
  };
  await tracker.eachGuild(async () => { await tracker.postNewSets(); });
  // g1's good channel got only crew's set
  assert.equal(channels.c1.sent.length, 1);
  assert.match(channels.c1.sent[0].embeds[0].data.title, /^Set result · W · Crew 2-1 Rival · L$/);
  assert.deepEqual(guildLocal.run('g1', () => state.posted), ['701']);
  // g2's channel rejected the send, so nothing went out and the set stays unposted for the next check
  assert.equal(channels.c2.sent.length, 0);
  assert.deepEqual(guildLocal.run('g2', () => state.posted), []);
  // and neither server saw the other's set
  assert.ok(!channels.c1.sent.some((payload) => payload.embeds[0].data.title.includes('Rival 2-1 Crew')));
});
