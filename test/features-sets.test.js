import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbedBuilder } from 'discord.js';
import { crewPlayer, tracked, event, node, result } from './fixtures.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-features-sets-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands/index.js');
const embeds = await import('../src/embeds/index.js');
const tracker = await import('../src/tracker.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ data: respond(JSON.parse(options.body)) }) });
}

test('every message gets a picture, the bot avatar on its first card when nothing in it has one', () => {
  const avatar = 'https://cdn.discordapp.com/avatars/bot/avatar.png';
  const plain = (n) => new EmbedBuilder().setTitle(`Card ${n}`).setDescription('text');
  // before discord says who the bot is there's nothing to fall back on
  assert.equal(embeds.messages([plain(0)])[0][0].data.thumbnail, undefined);

  embeds.setFallbackImage(avatar);
  try {
    // one per message, not one per card
    const batches = embeds.messages(Array.from({ length: 12 }, (_, i) => plain(i)));
    assert.deepEqual(batches.map((batch) => batch.map((card) => card.data.thumbnail?.url ?? null)),
      [[avatar, ...Array(9).fill(null)], [avatar, null]]);
    // a picture anywhere in the message is enough
    const [[first, pictured]] = embeds.messages([plain(1), plain(2).setImage('https://example.com/banner.png')]);
    assert.equal(first.data.thumbnail, undefined);
    assert.equal(pictured.data.image.url, 'https://example.com/banner.png');
    assert.equal(embeds.withImage([plain(3)])[0].data.thumbnail.url, avatar);

    // a set card at a tournament with no picture shows the tracked player's, bigger than the bot's
    const players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', image: 'https://images.start.gg/active.png' } };
    const parsed = result('no-art', 100, [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 1]);
    const set = { ...parsed, event: { ...parsed.event, name: 'Singles' }, sides: parsed.sides.map((side) => ({ ...side, characters: [] })) };
    assert.equal(embeds.setResult(set, players).data.thumbnail.url, 'https://images.start.gg/active.png');
  } finally {
    embeds.setFallbackImage(null);
  }
});

test('set result cards link the VOD when the TO added one, and skip it otherwise', () => {
  const players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' } };
  const sides = [[10, 'Active', 9], [99, 'Opponent', 2]];
  const named = (set) => ({ ...set, event: { ...set.event, name: 'Singles' }, sides: set.sides.map((side) => ({ ...side, characters: [] })) });
  const withVod = { ...named(result('v1', 100, sides[0], sides[1], true, [2, 1])), vod: 'https://youtube.example/vod' };
  const fields = embeds.setResult(withVod, players).data.fields ?? [];
  assert.match(fields.find((field) => field.name === 'VOD').value, /\[Watch the VOD\]\(https:\/\/youtube\.example\/vod\)/);
  const plain = embeds.setResult(named(result('v2', 100, sides[0], sides[1], true, [2, 1])), players);
  assert.ok(!(plain.data.fields ?? []).some((field) => field.name === 'VOD'));
});

test('set result cards put the winner on the left with a W and the loser on the right with an L', async () => {
  const { colors } = await import('../src/embeds/shared.js');
  const players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' } };
  const card = (id, me, them, won, score) => {
    const set = result(id, 100, me, them, won, score);
    return embeds.setResult({ ...set, event: { ...set.event, name: 'Singles' }, sides: set.sides.map((side, i) => ({ ...side, characters: [i ? 'Wario' : 'Pac-Man'] })) }, players).data;
  };

  const win = card('w', [10, 'Active', 2], [99, 'Opponent', 3], true, [3, 0]);
  assert.equal(win.title, 'Set result · W · Active 3-0 Opponent · L');
  assert.equal(win.color, colors.win);

  // a tracked player losing to someone untracked: the winner still goes first, the card stays theirs
  const loss = card('l', [10, 'Active', 2], [99, 'Opponent', 3], false, [1, 3]);
  assert.equal(loss.title, 'Set result · W · Opponent 3-1 Active · L');
  assert.equal(loss.color, colors.win);
  assert.equal(loss.author, undefined);
  assert.equal(loss.fields.find((field) => field.name === 'Characters').value, 'Opponent: Wario\nActive: Pac-Man');
  assert.doesNotMatch(loss.description, /Major upset/);

  // nobody tracked, from a tracked tournament, and two tracked players fighting are green too
  const stranger = card('s', [98, 'Visitor', 1], [99, 'Guest', 2], true, [2, 1]);
  assert.equal(stranger.color, colors.win);
  const both = { ...players, 2: { userId: 2, playerId: 99, tag: 'Opponent', slug: 'user/opponent' } };
  const clashSet = result('c', 100, [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 0]);
  const clash = embeds.setResult({ ...clashSet, event: { ...clashSet.event, name: 'Singles' }, sides: clashSet.sides.map((side) => ({ ...side, characters: [] })) }, both).data;
  assert.equal(clash.color, colors.win);

  // seed 17 over seed 2 is a major upset whoever won it. seed 9 over seed 2 is short of it
  const upset = card('u', [10, 'Active', 2], [99, 'Opponent', 17], false, [1, 2]);
  assert.equal(upset.title, 'Set result · W · Opponent 2-1 Active · L');
  assert.match(upset.description, /^\*\*Major upset\*\* · seed 17 beat seed 2\n\*\*Winners round 1\*\*/);
  assert.doesNotMatch(card('n', [10, 'Active', 2], [99, 'Opponent', 9], false, [1, 2]).description, /Major upset/);
  // DQ wins aren't upsets
  assert.doesNotMatch(card('d', [10, 'Active', 2], [99, 'Opponent', 17], false, [-1, 0]).description, /Major upset/);
});

test('set_colors paints set result cards green for a win, red for a loss, gold for crew vs crew', async () => {
  const { colors } = await import('../src/embeds/shared.js');
  const players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' } };
  const card = (id, me, them, won, score, list = players) => {
    const set = result(id, 100, me, them, won, score);
    return embeds.setResult({ ...set, event: { ...set.event, name: 'Singles' }, sides: set.sides.map((side) => ({ ...side, characters: [] })) }, list, { setColors: true }).data;
  };

  assert.equal(card('w', [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 1]).color, colors.win);
  assert.equal(card('l', [10, 'Active', 2], [99, 'Opponent', 3], false, [1, 3]).color, colors.loss);
  // nobody tracked, from a tracked tournament
  assert.equal(card('s', [98, 'Visitor', 1], [99, 'Guest', 2], true, [2, 1]).color, colors.brand);
  const both = { ...players, 2: { userId: 2, playerId: 99, tag: 'Opponent', slug: 'user/opponent' } };
  assert.equal(card('c', [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 0], both).color, colors.clash);
  // a corrected card keeps its colors
  const set = result('w', 100, [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 1]);
  const corrected = embeds.correctedResult({ ...set, event: { ...set.event, name: 'Singles' }, sides: set.sides.map((side) => ({ ...side, characters: [] })) }, players, { setColors: true }).data;
  assert.equal(corrected.color, colors.win);
  assert.match(corrected.description, /Corrected by TO/);
});

test('muted automatic messages are consumed without posting or replaying them later', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120, discordId: 'crew-discord' } };
  state.callPings = ['crew-discord'];
  state.messages = { sets: false, streams: false, calls: false, rollcall: false, results: false, registration: false };
  state.posted = [];
  state.dqs = [];
  state.streamed = [];
  state.called = [];
  state.tournaments = {};
  let current = { ...node('muted-set', now), state: 3 };
  mockApi(() => ({ p10: { sets: { nodes: [current] } } }));
  await tracker.postNewSets(channel);
  assert.ok(state.posted.includes('muted-set'));
  state.messages.sets = true;
  await tracker.postNewSets(channel);
  assert.equal(sent.length, 0);
  current = { ...node('new-set', now), state: 3 };
  await tracker.postNewSets(channel);
  assert.equal(sent.length, 1);

  current = { ...node('muted-stream', now), state: 2, stream: { streamName: 'example', streamSource: 'TWITCH' } };
  await tracker.postStreamAlerts(channel, 0);
  assert.ok(state.streamed.includes('muted-stream'));
  state.messages.streams = true;
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 1);

  current = { ...node('muted-call', now), state: 6, updatedAt: now };
  await tracker.postMatchCalls(channel);
  assert.ok(state.called.includes('muted-call'));
  state.messages.calls = true;
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 1);

  const upcoming = { startAt: now + 1800, entries: [1, 2, 3].map(userId => ({ userId })) };
  await tracker.postRollCall(upcoming, channel);
  assert.equal(upcoming.rollCallPosted, true);
  const finished = { startAt: now - 27 * 3600, endAt: now - 26 * 3600, entries: [{ started: true }] };
  await tracker.postResults(finished, channel);
  assert.equal(finished.resultsPosted, true);

  state.tournaments = { 1: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, entries: [], tracked, reminder: { next: 0 } } };
  mockApi(() => ({ tournament: { id: 1, startAt: now + 86400, endAt: now + 2 * 86400,
    registrationClosesAt: now + 3600, isRegistrationOpen: true, events: [] } }));
  await tracker.postRegReminders(channel);
  assert.equal(state.tournaments[1].reminder.next, 4);
  assert.equal(sent.length, 1);
});

// answers only for the players a query names, like start.gg does, and keeps who got asked about
function mockSetCheck(nodesFor) {
  const asked = [];
  mockApi(({ query }) => {
    const aliases = [...query.matchAll(/(p\d+): player\(/g)].map(([, alias]) => alias);
    asked.push(aliases);
    return Object.fromEntries(aliases.map(alias => [alias, { sets: { nodes: nodesFor[alias] ?? [] } }]));
  });
  return asked;
}

const setsCommand = (values) => {
  const interaction = {
    // Manage Server counts as a TO while the server has no TO role, and only a TO can change someone else's posts
    commandName: 'track', user: { id: 'someone' }, memberPermissions: { has: () => true },
    options: { getSubcommand: () => 'posts', getString: name => values[name] ?? null },
    reply: async r => { interaction.replied = r; },
  };
  return handleCommand(interaction).then(() => interaction.replied);
};

test('set results off keeps a player out of the set check and /track posts sets:on doesn\'t dump the backlog', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, lastCheck: now - 120, setResults: false },
    // saved before set results started off, so no field still means on
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastCheck: now - 120 },
  };
  state.posted = [];
  state.dqs = [];
  const nodes = { p10: [{ ...node('while-off', now - 60), state: 3 }], p20: [{ ...node('shown-set', now - 60, 20), state: 3 }] };
  const asked = mockSetCheck(nodes);

  await tracker.postNewSets(channel);
  assert.deepEqual(asked, [['p20']]);
  assert.ok(sent.every(({ embeds: [card] }) => card.data.author === undefined));
  assert.match(sent[0].embeds[0].data.title, /^Set result · /);
  // the set's over, so no head to head button
  assert.equal(sent[0].components, undefined);

  assert.equal((await setsCommand({ player: '1', sets: 'on' })).content, 'Set results on for Active.');
  assert.ok(state.players[1].setResultsOnAt >= now);

  // the set from while they were off is in the fetch window now, but it stays out
  await tracker.postNewSets(channel);
  assert.deepEqual(asked.at(-1), ['p10', 'p20']);
  assert.equal(sent.length, 1);
  assert.ok(state.posted.includes('while-off'));

  nodes.p10.push({ ...node('after-on', state.players[1].setResultsOnAt), state: 3 });
  await tracker.postNewSets(channel);
  assert.ok(sent.every(({ embeds: [card] }) => card.data.author === undefined));
  assert.deepEqual(sent.map(({ embeds: [card] }) => card.data.title.slice(0, 12)), ['Set result ·', 'Set result ·']);
});

test('the set check sends nothing to start.gg when nobody has set results on', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120, setResults: false } };
  globalThis.fetch = async () => assert.fail('nobody to ask about');
  await tracker.postNewSets({ send: async () => assert.fail('nothing to post') });
  // still counts as a check, so a restart doesn't think the bot was down
  assert.equal(tracker.health.setError, null);
  assert.ok(state.players[1].lastCheck >= now);
});

test('/track posts sets:on only marks when results came on for players switching from off', async () => {
  state.players = {
    1: { ...crewPlayer, setResults: false },
    2: { userId: 2, playerId: 20, tag: 'On', slug: 'user/on', setResults: true, setResultsOnAt: 5 },
    3: { userId: 3, playerId: 30, tag: 'Old', slug: 'user/old' },
  };
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await setsCommand({ player: 'all', sets: 'on' })).content, 'Set results on for everyone.');
  assert.ok(state.players[1].setResultsOnAt >= now);
  // already on, so sets they finished before this still count
  assert.equal(state.players[2].setResultsOnAt, 5);
  assert.equal(state.players[3].setResultsOnAt, undefined);
  assert.ok(Object.values(state.players).every(player => player.setResults === true));

  // everyone at once asks first, confirm.test.js presses the buttons
  assert.match((await setsCommand({ player: 'all', sets: 'off' })).content, /^Turn set results off for all 3 tracked players\?/);
  assert.equal(state.players[1].setResults, true);
  assert.equal((await setsCommand({ player: '1', sets: 'off' })).content, 'Set results off for Active.');
  assert.equal(state.players[1].setResults, false);
});

test('re-enabling between polls skips events that became due before re-enabling', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = { calls: true, enabledAt: Object.fromEntries(['sets', 'streams', 'calls', 'rollcall', 'results', 'registration'].map(type => [type, now])) };
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120, discordId: 'crew-discord' } };
  state.callPings = ['crew-discord'];
  state.posted = [];
  state.dqs = [];
  state.streamed = [];
  state.called = [];
  state.tournaments = {};
  let current = { ...node('unpolled-muted-set', now - 60), state: 3, updatedAt: now - 60 };
  mockApi(() => ({ p10: { sets: { nodes: [current] } } }));
  await tracker.postNewSets(channel);
  current = { ...current, id: 'unpolled-muted-stream', state: 2, stream: { streamName: 'example', streamSource: 'TWITCH' } };
  await tracker.postStreamAlerts(channel, 0);
  current = { ...current, id: 'unpolled-muted-call', state: 6, updatedAt: now - 60 };
  await tracker.postMatchCalls(channel);
  assert.ok(state.called.includes('unpolled-muted-call'));
  for (const userId of [2, 3]) state.players[userId] = { userId, playerId: userId * 10, tag: `Player ${userId}`, slug: `user/player${userId}` };
  await tracker.postRollCall({ name: 'Local', slug: 'tournament/local', startAt: now + 1800,
    entries: [1, 2, 3].map(userId => ({ userId, event: 'Singles', eventSlug: event.slug, entrants: 32 })) }, channel);
  await tracker.postResults({ name: 'Local', slug: 'tournament/local', startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries: [{ userId: 1, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 5, final: true }] }, channel);
  state.tournaments = { 1: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, entries: [], tracked, reminder: { next: 0 } } };
  mockApi(() => ({ tournament: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 2 * 86400,
    registrationClosesAt: now + 3600, isRegistrationOpen: true, events: [] } }));
  await tracker.postRegReminders(channel);
  assert.equal(sent.length, 0);
});

test('a set only waiting at the front of a stream queue still posts after streams come back on', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  state.messages = { enabledAt: { streams: now } };
  state.players = { 1: { ...crewPlayer, lastCheck: now } };
  state.streamed = [];
  state.tournaments = { 1: { id: 1, name: 'Local', startAt: now - 3600, endAt: now + 3600, entries: [{ userId: 1 }] } };
  // queued an hour ago, never called
  const queued = { ...node('queued', null), state: 1, updatedAt: now - 3600, stream: null };
  mockApi(({ query }) => (query.includes('streamQueue')
    ? { tournament: { streamQueue: [{ stream: { streamName: 'local', streamSource: 'TWITCH' }, sets: [queued] }] } }
    : { p10: { sets: { nodes: [] } } }));
  await tracker.postStreamAlerts({ send: async payload => sent.push(payload) }, 0);
  assert.equal(sent.length, 1);
});

test('a stream alert links the queue the set is in, not a stream it was moved off', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  state.messages = {};
  state.players = { 1: { ...crewPlayer, lastCheck: now } };
  state.streamed = [];
  state.tournaments = { 1: { id: 1, name: 'Local', startAt: now - 3600, endAt: now + 3600, entries: [{ userId: 1 }] } };
  const moved = { ...node('moved', null), state: 2, updatedAt: now, stream: { streamName: 'winters_hq', streamSource: 'TWITCH' } };
  mockApi(({ query }) => (query.includes('streamQueue')
    ? { tournament: { streamQueue: [{ stream: { streamName: '716esports', streamSource: 'TWITCH' }, sets: [moved] }] } }
    : { p10: { sets: { nodes: [] } } }));
  await tracker.postStreamAlerts({ send: async payload => sent.push(payload) }, 0);
  assert.equal(sent.length, 1);
  const card = JSON.stringify(sent[0].embeds);
  assert.ok(card.includes('https://twitch.tv/716esports'));
  assert.ok(!card.includes('winters_hq'));
});

test('a set put on stream by mistake and taken back before the confirm look is not posted', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = { 1: { ...crewPlayer, lastCheck: now } };
  state.streamed = [];
  state.tournaments = {};
  const on = streamName => ({ ...node('flub', null), state: 2, updatedAt: now, stream: { streamName, streamSource: 'TWITCH' } });
  // each check asks twice: what's on stream, then again after the wait
  let answers = [[on('local')], []];
  mockApi(() => ({ p10: { sets: { nodes: answers.shift() ?? [] } } }));
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 0);
  assert.ok(!state.streamed.includes('flub'));

  // moved to another stream during the wait, so it waits for it to settle
  answers = [[on('local')], [on('other')]];
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 0);

  // put back on stream later and left there
  answers = [[on('other')], [on('other')]];
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 1);
  assert.ok(JSON.stringify(sent[0].embeds).includes('twitch.tv/other'));
  assert.ok(state.streamed.includes('flub'));

  // nothing new, so no second look
  let asked = 0;
  mockApi(() => (asked++, { p10: { sets: { nodes: [on('other')] } } }));
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(asked, 1);
});

test('stream alerts ping only whoever is playing with /notify streams on', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, discordId: 'crew-discord', lastCheck: now },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord', lastCheck: now },
  };
  state.links = {};
  state.streamed = [];
  state.tournaments = {};
  state.streamPings = [];
  let current;
  mockApi(() => ({ p10: { sets: { nodes: [current] } } }));
  const streamed = id => ({ ...node(id, null), state: 2, updatedAt: now, stream: { streamName: 'local', streamSource: 'TWITCH' } });

  const replies = [];
  const fromInteraction = (id, ping) => ({ user: { id }, options: { getString: (name) => (name === 'streams' ? ping : null), getUser: () => null }, reply: async (result) => replies.push(result) });
  const { notify } = await import('../src/commands/settings.js');
  // nobody to look up, so it stays off
  await notify(fromInteraction('fan', 'on'));
  assert.match(replies.at(-1).content, /Stream alert pings need your start\.gg/);
  assert.deepEqual(state.streamPings, []);
  // tracked with this discord on start.gg counts
  await notify(fromInteraction('crew-discord', 'on'));
  await notify(fromInteraction('crew-discord', 'on'));
  await notify(fromInteraction('rival-discord', 'on'));
  await notify(fromInteraction('rival-discord', 'off'));
  assert.deepEqual(state.streamPings, ['crew-discord']);

  // a player who opts in while the same set is still on stream gets the alert too
  state.streamPings = [];
  current = streamed('mid-tournament-opt-in');
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent[0].content, undefined);
  state.streamPings = ['crew-discord'];
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent[1].content, '<@crew-discord> on stream');

  current = streamed('one-fan');
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].content, '<@crew-discord> on stream');
  assert.deepEqual(sent[2].allowedMentions, { users: ['crew-discord'] });
  assert.equal(sent[2].embeds.length, 1);
  // against someone only known from the set, by player id, answered just to whoever presses it
  const [button] = sent[2].components[0].toJSON().components;
  assert.deepEqual([button.label, button.custom_id], ['Head to head', 'private:h2h:active:#99::::']);

  // someone with pings on who isn't playing gets no ping, but the card still posts
  state.streamPings = ['rival-discord'];
  current = streamed('not-playing');
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent[3].content, undefined);
  assert.deepEqual(sent[3].allowedMentions, { users: [] });
  assert.equal(sent[3].components.length, 1);

  // nobody opted in still posts the card, pinging no one
  state.streamPings = [];
  current = streamed('no-fans');
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent[4].content, undefined);
  assert.deepEqual(sent[4].allowedMentions, { users: [] });
  assert.equal(sent[4].components.length, 1);
  state.streamPings = [];
});

test('opting into match calls mid-tournament catches a call already posted for the opponent', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => { sent.push(payload); return { id: `m${sent.length}`, channelId: 'c1' }; } };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, discordId: 'crew-discord' },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
  };
  state.links = {};
  state.callPings = ['rival-discord'];
  state.called = [];
  state.callPosts = [];
  const called = {
    ...node('701', null), state: 6, updatedAt: now - 60,
    slots: [[1, 10, 'Active'], [2, 20, 'Rival']].map(([entrant, player, name]) => ({
      entrant: { id: entrant, name, initialSeedNum: entrant, participants: [{ player: { id: player } }] }, standing: null,
    })),
  };
  mockApi(() => ({ p10: { sets: { nodes: [called] } }, p20: { sets: { nodes: [called] } } }));

  await tracker.postMatchCalls(channel);
  assert.equal(sent[0].content, `<@rival-discord> You're up`);

  state.callPings.push('crew-discord');
  await tracker.postMatchCalls(channel);
  assert.equal(sent[1].content, `<@crew-discord> You're up`);
  assert.deepEqual(sent[1].allowedMentions, { users: ['crew-discord'] });
});

test('stream alerts start off, keeping a new player out of the stream check and their tournament\'s queues', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: tracker.newTracked(crewPlayer),
    // saved before stream alerts started off, so no field still means on
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival' },
  };
  state.streamed = [];
  // only the new player is in it, so its stream queue isn't worth a request
  state.tournaments = { 1: { id: 1, name: 'Local', startAt: now - 3600, endAt: now + 3600, entries: [{ userId: 1 }] } };
  const live = (id, playerId) => ({ ...node(id, null, playerId), state: 2, updatedAt: now - 60, stream: { streamName: 'local', streamSource: 'TWITCH' } });
  const nodes = { p10: [live('new-on-stream', 10)], p20: [live('rival-on-stream', 20)] };
  const asked = [];
  mockApi(({ query }) => {
    if (query.includes('streamQueue')) {
      asked.push('queue');
      return { tournament: { streamQueue: [] } };
    }
    const aliases = [...query.matchAll(/(p\d+): player\(/g)].map(([, alias]) => alias);
    asked.push(...aliases);
    return Object.fromEntries(aliases.map(alias => [alias, { sets: { nodes: nodes[alias] } }]));
  });
  await tracker.postStreamAlerts(channel, 0);
  // asked twice, the second to confirm it's still on stream
  assert.deepEqual(asked, ['p20', 'p20']);
  assert.equal(sent.length, 1);

  const interaction = {
    // a TO, since it's someone else's
    commandName: 'track', user: { id: 'someone' }, memberPermissions: { has: () => true },
    options: { getSubcommand: () => 'posts', getString: name => ({ player: '1', stream: 'on' })[name] ?? null },
    reply: async r => { interaction.replied = r; },
  };
  await handleCommand(interaction);
  assert.equal(interaction.replied.content, 'Stream alerts on for Active.');
  // a set on stream right now is still worth announcing, so there's no cutoff like set results have
  await tracker.postStreamAlerts(channel, 0);
  assert.deepEqual(asked.slice(2).toSorted(), ['p10', 'p10', 'p20', 'p20', 'queue', 'queue']);
  assert.equal(sent.length, 2);
});

test('match call pings only go to people who turned them on, and the server switch still mutes them', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: tracker.newTracked({ ...crewPlayer, discordId: 'crew-discord' }),
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
  };
  state.links = {};
  // nobody turned them on, and someone who did has no start.gg to go by
  state.callPings = ['stranger-discord'];
  state.called = [];
  const called = (id, playerId) => ({ ...node(id, null, playerId), state: 6, updatedAt: now - 60 });
  const asked = [];
  mockApi(({ query }) => {
    const aliases = [...query.matchAll(/(p\d+): player\(/g)].map(([, alias]) => alias);
    asked.push(...aliases);
    return Object.fromEntries(aliases.map(alias => [alias, { sets: { nodes: [] } }]));
  });
  await tracker.postMatchCalls(channel);
  assert.deepEqual(asked, []);
  assert.equal(sent.length, 0);
  assert.deepEqual(state.called, []);

  // turned on, but the server switch is off
  state.callPings = ['crew-discord'];
  state.messages = { calls: false };
  mockApi(() => ({ p10: { sets: { nodes: [called('server-off', 10)] } } }));
  await tracker.postMatchCalls(channel);
  assert.ok(state.called.includes('server-off'));
  assert.equal(sent.length, 0);
  state.callPings = [];
});

test('match call pings mention connected discords, one message per set', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, discordId: 'crew-discord' },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
  };
  // linked, so known without being tracked
  state.links = { 'quiet-discord': { userId: 3, playerId: 30, tag: 'Quiet', slug: 'user/quiet', discordId: 'quiet-discord' } };
  state.callPings = ['crew-discord', 'rival-discord', 'quiet-discord'];
  state.called = [];
  // both tracked players in the same called set, on a station
  const both = {
    id: 'both-called', state: 6, completedAt: null, updatedAt: now - 60, fullRoundText: 'Winners round 1', winnerId: null, stream: null, station: { number: 4 }, event,
    slots: [[1, 10, 'Active'], [2, 20, 'Rival']].map(([entrant, player, name]) => ({
      entrant: { id: entrant, name, initialSeedNum: entrant, participants: [{ player: { id: player } }] },
      standing: null,
    })),
  };
  const solo = {
    id: 'solo-called', state: 6, completedAt: null, updatedAt: now - 60, fullRoundText: 'Losers round 1', winnerId: null, stream: null, event,
    slots: [[3, 30, 'Quiet'], [4, 99, 'Opponent']].map(([entrant, player, name]) => ({
      entrant: { id: entrant, name, initialSeedNum: entrant, participants: [{ player: { id: player } }] },
      standing: null,
    })),
  };
  mockApi(({ query }) => {
    if (query.includes('p10')) return { p10: { sets: { nodes: [both] } }, p20: { sets: { nodes: [both] } }, p30: { sets: { nodes: [solo] } } };
    return { p20: { sets: { nodes: [both] } }, p30: { sets: { nodes: [solo] } } };
  });
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 2);
  // one message for the shared set, with both pings in it
  assert.match(sent[0].content, /<@crew-discord>.*<@rival-discord>|<@rival-discord>.*<@crew-discord>/);
  assert.match(sent[0].content, /You're up - Station 4/);
  assert.deepEqual(sent[0].allowedMentions, { users: ['crew-discord', 'rival-discord'] });
  assert.match(sent[0].embeds[0].data.title, /Match call · /);
  assert.match(sent[0].embeds[0].data.description, /Station 4/);
  // only linked, and the card and button are still about them. no station on start.gg, so none shows
  assert.equal(sent[1].content, `<@quiet-discord> You're up`);
  assert.doesNotMatch(sent[1].content, /Station/);
  assert.doesNotMatch(sent[1].embeds[0].data.description, /Station/);
  assert.deepEqual(sent[1].allowedMentions, { users: ['quiet-discord'] });
  assert.equal(sent[1].embeds[0].data.author.name, 'Quiet');
  assert.deepEqual([...state.called].sort(), ['both-called', 'solo-called']);
  // both tracked, it's about whoever's first on the list, and the other is only known from the set by player id
  assert.equal(sent[0].components[0].toJSON().components[0].custom_id, 'private:h2h:active:#20::::');
  assert.equal(sent[1].components[0].toJSON().components[0].custom_id, 'private:h2h:quiet:#99::::');

  // a second check sends nothing new
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 2);
  state.links = {};
  state.callPings = [];
});

test('match call pings put all four doubles players in one message', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, discordId: 'crew-discord' },
    2: { userId: 2, playerId: 11, tag: 'Partner', slug: 'user/partner', discordId: 'partner-discord' },
    3: { userId: 3, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
    4: { userId: 4, playerId: 21, tag: 'Fourth', slug: 'user/fourth' },
  };
  state.links = {};
  state.callPings = ['crew-discord', 'partner-discord', 'rival-discord'];
  state.called = [];
  const team = (entrant, name, seed, ids) => ({
    entrant: { id: entrant, name, initialSeedNum: seed, participants: ids.map((id) => ({ player: { id } })) },
    standing: null,
  });
  // all four tracked players in one 2v2 set. the fourth never turned pings on
  const doubles = {
    id: 'doubles-called', state: 6, completedAt: null, updatedAt: now - 60, fullRoundText: 'Winners semifinal', winnerId: null, stream: null, event,
    slots: [team(1, 'Crew + Partner', 1, [10, 11]), team(2, 'Rival + Fourth', 2, [20, 21])],
  };
  // 99 is nobody tracked, so only the ones with pings on get pinged
  const mixed = {
    id: 'mixed-called', state: 6, completedAt: null, updatedAt: now - 60, fullRoundText: 'Losers round 1', winnerId: null, stream: null, event,
    slots: [team(3, 'Crew + Stranger', 1, [10, 99]), team(4, 'Rival + Fourth', 2, [20, 21])],
  };
  mockApi(() => ({
    p10: { sets: { nodes: [doubles, mixed] } }, p11: { sets: { nodes: [doubles] } },
    p20: { sets: { nodes: [doubles, mixed] } }, p21: { sets: { nodes: [doubles, mixed] } },
  }));
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 2);
  // one message for the 2v2 set, with every connected discord in it
  assert.deepEqual(sent[0].allowedMentions, { users: ['crew-discord', 'partner-discord', 'rival-discord'] });
  assert.match(sent[0].content, /You're up/);
  assert.match(sent[0].embeds[0].data.title, /Match call · /);
  // the untracked stranger adds no ping, still one message
  assert.deepEqual(sent[1].allowedMentions, { users: ['crew-discord', 'rival-discord'] });
  // /h2h is singles, so no button
  assert.deepEqual(sent.map((each) => each.components), [[], []]);
  assert.deepEqual([...state.called].sort(), ['doubles-called', 'mixed-called']);

  // a second check sends nothing new
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 2);
  state.callPings = [];
});

test('match calls and stream alerts lose their Head to head button once the set is over', async () => {
  const now = Math.floor(Date.now() / 1000);
  const edits = [];
  let nextId = 0;
  const messages = {
    edit: async (id, payload) => {
      if (id === 'gone') throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      edits.push([id, payload]);
    },
  };
  const channel = {
    send: async () => ({ id: `m${++nextId}`, channelId: 'c1' }),
    client: { channels: { fetch: async (id) => { assert.equal(id, 'c1'); return { messages }; } } },
  };
  state.messages = {};
  state.players = { 1: { ...crewPlayer, discordId: 'crew-discord', streamAlerts: false } };
  state.links = {};
  state.callPings = ['crew-discord'];
  state.called = [];
  state.buttons = [];
  const called = { ...node('501', null), state: 6, updatedAt: now - 60, stream: null };
  let states = {};
  const asked = [];
  mockApi(({ query }) => {
    if (query.includes('set(id:')) {
      const ids = [...query.matchAll(/s(\d+): set/g)].map(([, id]) => id);
      asked.push(ids);
      return Object.fromEntries(ids.map((id) => [`s${id}`, id in states ? { state: states[id] } : null]));
    }
    return { p10: { sets: { nodes: [called] } } };
  });
  await tracker.postMatchCalls(channel);
  assert.deepEqual(state.buttons.map(({ setId, channelId, messageId }) => [setId, channelId, messageId]), [['501', 'c1', 'm1']]);

  // still being played, so it keeps the button
  states = { 501: 2 };
  await tracker.clearFinishedButtons(channel);
  assert.deepEqual(edits, []);
  assert.equal(state.buttons.length, 1);

  states = { 501: 3 };
  await tracker.clearFinishedButtons(channel);
  assert.deepEqual(edits, [['m1', { components: [] }]]);
  assert.deepEqual(state.buttons, []);

  // a deleted set or post counts as over, and one 12 hours old goes without asking start.gg
  states = { 502: 2 };
  state.buttons = [
    { setId: '502', channelId: 'c1', messageId: 'live', at: now },
    { setId: '503', channelId: 'c1', messageId: 'gone', at: now },
    { setId: '504', channelId: 'c1', messageId: 'old', at: now - 13 * 3600 },
  ];
  asked.length = 0;
  await tracker.clearFinishedButtons(channel);
  assert.deepEqual(asked, [['502', '503']]);
  assert.deepEqual(edits.slice(1).map(([id]) => id), ['old']);
  assert.deepEqual(state.buttons.map(({ messageId }) => messageId), ['live']);

  // with nothing saved it asks start.gg nothing
  state.buttons = [];
  asked.length = 0;
  await tracker.clearFinishedButtons(channel);
  assert.deepEqual(asked, []);
});

test('a stream alert saves the message with the card', async () => {
  const now = Math.floor(Date.now() / 1000);
  let nextId = 0;
  const channel = { send: async () => ({ id: `m${++nextId}`, channelId: 'c1' }) };
  state.messages = {};
  state.players = { 1: { ...crewPlayer, discordId: 'crew-discord', lastCheck: now } };
  state.links = {};
  state.streamed = [];
  state.tournaments = {};
  state.buttons = [];
  // only whoever is playing gets pinged, so one message with the card
  state.streamPings = ['crew-discord', 'rival-discord'];
  const live = { ...node('601', null), state: 2, updatedAt: now, stream: { streamName: 'local', streamSource: 'TWITCH' } };
  mockApi(() => ({ p10: { sets: { nodes: [live] } } }));
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(nextId, 1);
  assert.deepEqual(state.buttons.map(({ setId, messageId }) => [setId, messageId]), [['601', 'm1']]);
  state.streamPings = [];
  state.buttons = [];
});
