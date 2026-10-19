import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits, RESTJSONErrorCodes } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-threads-'));
process.env.STATE_DIR = directory;
process.env.CHANNEL_ID = 'posts';
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands/index.js');
const tracker = await import('../src/tracker.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const BOTH = ['CreatePublicThreads', 'SendMessagesInThreads'];
let threadCount = 0;

// a text channel that keeps what was sent to it and the threads started on its messages.
// threads outlive the channel object, like they outlive a restart
function fakeChannel({ allowed = BOTH, threads = new Map(), pinFails = false } = {}) {
  const channel = {
    id: 'posts', sent: [], pinned: [], unpinned: [], cards: new Map(), threads: null,
    client: { user: { id: 'bot' } },
    permissionsFor: () => ({ has: flag => allowed.some(name => PermissionFlagsBits[name] === flag) }),
    send: async message => {
      channel.sent.push(message);
      const card = {
        id: `card-${channel.sent.length}`, channelId: 'posts',
        pin: async () => {
          if (pinFails) throw new Error('Missing Permissions');
          channel.pinned.push(card.id);
        },
        startThread: async ({ name }) => {
          const thread = { id: `thread-${++threadCount}`, name, sent: [], locked: false };
          thread.send = async sent => {
            if (thread.locked) throw new Error('Thread is locked');
            thread.sent.push(sent);
          };
          threads.set(thread.id, thread);
          return thread;
        },
      };
      channel.cards.set(card.id, card);
      return card;
    },
  };
  channel.client.channels = {
    fetch: async id => {
      if (id !== 'posts') throw Object.assign(new Error('Unknown Channel'), { code: RESTJSONErrorCodes.UnknownChannel });
      return {
        messages: {
          unpin: async messageId => {
            if (!channel.cards.has(messageId)) throw Object.assign(new Error('Unknown Message'), { code: RESTJSONErrorCodes.UnknownMessage });
            channel.unpinned.push(messageId);
            channel.pinned = channel.pinned.filter(each => each !== messageId);
          },
        },
      };
    },
  };
  channel.threads = {
    all: threads,
    fetch: async id => {
      if (threads.has(id)) return threads.get(id);
      throw Object.assign(new Error('Unknown Channel'), { code: RESTJSONErrorCodes.UnknownChannel });
    },
  };
  return channel;
}

const tournament = (name) => ({ name, slug: `tournament/${name.toLowerCase()}`, images: [] });
const node = (id, at, inTournament, state = 3, eventName = 'Singles') => ({
  id, state, completedAt: at, updatedAt: at, winnerId: 10, fullRoundText: 'Winners round 1',
  stream: state === 3 ? null : { streamName: 'example', streamSource: 'TWITCH' },
  event: { name: eventName, slug: `${inTournament.slug}/event/${eventName.toLowerCase()}`, videogame: { displayName: 'Ultimate' }, tournament: inTournament },
  slots: [10, 99].map((id, i) => ({
    entrant: { id, name: i ? 'Opponent' : 'Active', initialSeedNum: i + 1, participants: [{ player: { id } }] },
    standing: { stats: { score: { value: i ? 1 : 2 } } },
  })),
});

let sets = [];
globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { p10: { sets: { nodes: sets } } } }) });

const now = () => Math.floor(Date.now() / 1000);
beforeEach(() => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', lastCheck: now() - 120, setResults: true, streamAlerts: true } };
  state.messages = { threads: 'tournament' };
  Object.assign(state, { posted: [], dqs: [], streamed: [], called: [], tournaments: {}, threads: {}, streamPings: [] });
  tracker.health.threadError = null;
});

test('with threads off, set results post in the channel and no thread starts', async () => {
  state.messages = {};
  const channel = fakeChannel();
  sets = [node('off', now(), tournament('Local'))];
  await tracker.postNewSets(channel);
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].embeds[0].data.author.name, 'Active');
  assert.equal(channel.threads.all.size, 0);
});

test('one thread per tournament, started by a card in the channel and reused by later sets', async () => {
  const channel = fakeChannel();
  sets = [node('a1', now() - 30, tournament('Local')), node('a2', now() - 20, tournament('Local')), node('b1', now() - 10, tournament('Weekly'))];
  await tracker.postNewSets(channel);

  // the two cards that start threads, nothing else in the channel
  assert.deepEqual(channel.sent.map(message => message.embeds[0].data.title), ['Local', 'Weekly']);
  assert.deepEqual(channel.sent.map(message => message.allowedMentions), [{ parse: [] }, { parse: [] }]);
  const [local, weekly] = channel.threads.all.values();
  assert.equal(local.name, 'Local');
  assert.equal(local.sent.length, 2);
  assert.equal(weekly.sent.length, 1);
  // saved, so a restart finds them
  const saved = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).threads;
  assert.equal(saved['tournament/local'].id, local.id);
  assert.equal(saved['tournament/weekly'].id, weekly.id);
});

test('one thread per event, named for the tournament and event, apart from the per-tournament threads', async () => {
  state.messages = { threads: 'event' };
  const channel = fakeChannel();
  sets = [
    node('s1', now() - 40, tournament('Local')), node('d1', now() - 30, tournament('Local'), 3, 'Doubles'),
    node('s2', now() - 20, tournament('Local')), node('w1', now() - 10, tournament('Weekly')),
  ];
  await tracker.postNewSets(channel);

  assert.deepEqual(channel.sent.map(message => message.embeds[0].data.author.name), ['Event thread', 'Event thread', 'Event thread']);
  assert.deepEqual(channel.sent.map(message => message.embeds[0].data.title), ['Local', 'Local', 'Weekly']);
  assert.match(channel.sent[1].embeds[0].data.description, /^\*\*Doubles\*\* · Ultimate\n/);
  const [singles, doubles, weekly] = channel.threads.all.values();
  assert.deepEqual([singles.name, doubles.name, weekly.name], ['Local · Singles', 'Local · Doubles', 'Weekly · Singles']);
  assert.deepEqual([singles.sent.length, doubles.sent.length, weekly.sent.length], [2, 1, 1]);
  assert.deepEqual(Object.keys(state.threads), ['tournament/local/event/singles', 'tournament/local/event/doubles', 'tournament/weekly/event/singles']);

  // the per-tournament thread is its own, and both stay saved for switching back
  state.messages = { threads: 'tournament' };
  sets = [node('s3', now(), tournament('Local'))];
  await tracker.postNewSets(channel);
  assert.equal(channel.sent.at(-1).embeds[0].data.author.name, 'Tournament thread');
  assert.equal(channel.threads.all.size, 4);
  assert.equal(Object.keys(state.threads).length, 4);
});

test('a long tournament name is cut so the event name still fits in 100 characters', async () => {
  state.messages = { threads: 'event' };
  const channel = fakeChannel();
  sets = [node('long', now(), tournament('X'.repeat(120)), 3, 'Ultimate Singles')];
  await tracker.postNewSets(channel);
  const [thread] = channel.threads.all.values();
  assert.equal(thread.name.length, 100);
  assert.ok(thread.name.endsWith('X · Ultimate Singles'));
});

test('threads saved as true before the three modes mean one per tournament', async () => {
  const { messageSettings } = await import('../src/message-settings.js');
  for (const [saved, mode] of [[true, 'tournament'], [false, 'off'], [undefined, 'off'], ['event', 'event'], ['nonsense', 'off']]) {
    state.messages = { threads: saved };
    assert.equal(messageSettings().threads, mode, `saved ${saved}`);
  }
  state.messages = { threads: true };
  const channel = fakeChannel();
  sets = [node('legacy', now(), tournament('Local'))];
  await tracker.postNewSets(channel);
  assert.equal(channel.sent[0].embeds[0].data.author.name, 'Tournament thread');
});

test('after a restart the saved thread is used again, and a deleted one is replaced', async () => {
  const threads = new Map();
  sets = [node('first', now() - 20, tournament('Local'))];
  await tracker.postNewSets(fakeChannel({ threads }));
  const first = state.threads['tournament/local'].id;

  // a new channel object, same threads on discord
  const restarted = fakeChannel({ threads });
  sets = [node('second', now() - 10, tournament('Local'))];
  await tracker.postNewSets(restarted);
  assert.equal(restarted.sent.length, 0);
  assert.equal(threads.get(first).sent.length, 2);

  threads.delete(first);
  sets = [node('third', now(), tournament('Local'))];
  await tracker.postNewSets(restarted);
  assert.equal(restarted.sent.length, 1, 'a new card for the new thread');
  const replacement = state.threads['tournament/local'].id;
  assert.notEqual(replacement, first);
  assert.equal(threads.get(replacement).sent.length, 1);
});

test('without thread permissions posts go in the channel, with no card left behind', async () => {
  for (const allowed of [['SendMessagesInThreads'], ['CreatePublicThreads'], []]) {
    state.posted = [];
    const channel = fakeChannel({ allowed });
    sets = [node(`perms-${allowed.length}`, now(), tournament('Local'))];
    await tracker.postNewSets(channel);
    assert.equal(channel.sent.length, 1);
    assert.equal(channel.sent[0].embeds[0].data.author.name, 'Active', 'the set itself, not a thread card');
    assert.equal(channel.threads.all.size, 0);
    assert.match(tracker.health.threadError, /^missing /);
    for (const name of BOTH) {
      const label = name === 'CreatePublicThreads' ? 'Create Public Threads' : 'Send Messages in Threads';
      assert.equal(tracker.health.threadError.includes(label), !allowed.includes(name));
    }
  }
});

test('a thread that rejects the post sends it to the channel, and a working one clears the error', async () => {
  const channel = fakeChannel();
  sets = [node('ok', now() - 20, tournament('Local'))];
  await tracker.postNewSets(channel);
  const [thread] = channel.threads.all.values();

  thread.locked = true;
  sets = [node('locked', now() - 10, tournament('Local'))];
  await tracker.postNewSets(channel);
  assert.equal(channel.sent.length, 2);
  assert.equal(channel.sent[1].embeds[0].data.author.name, 'Active');
  assert.equal(tracker.health.threadError, 'Thread is locked');

  thread.locked = false;
  sets = [node('unlocked', now(), tournament('Local'))];
  await tracker.postNewSets(channel);
  assert.equal(thread.sent.length, 2);
  assert.equal(tracker.health.threadError, null);
});

test('stream alerts and their pings go in the tournament thread', async () => {
  state.streamPings = ['fan'];
  const channel = fakeChannel();
  sets = [node('live', now(), tournament('Local'), 2)];
  await tracker.postStreamAlerts(channel, 0);
  const [thread] = channel.threads.all.values();
  assert.equal(channel.sent.length, 1);
  assert.equal(thread.sent.length, 1);
  assert.equal(thread.sent[0].content, '<@fan> on stream');
  assert.deepEqual(thread.sent[0].allowedMentions, { users: ['fan'] });
});

test('tournament threads pin their channel card, event threads do not', async () => {
  const channel = fakeChannel();
  sets = [node('a1', now() - 30, tournament('Local'))];
  await tracker.postNewSets(channel);
  assert.deepEqual(channel.pinned, ['card-1']);
  const entry = state.threads['tournament/local'];
  assert.equal(entry.messageId, 'card-1');
  assert.equal(entry.channelId, 'posts');
  assert.equal(entry.pinned, true);

  state.messages = { threads: 'event' };
  state.posted = [];
  const eventChannel = fakeChannel();
  sets = [node('s1', now(), tournament('Local'))];
  await tracker.postNewSets(eventChannel);
  assert.deepEqual(eventChannel.pinned, []);
  assert.equal(state.threads['tournament/local/event/singles'].pinned, undefined);
});

test('a thread still posts when pinning fails', async () => {
  const channel = fakeChannel({ pinFails: true });
  sets = [node('a1', now(), tournament('Local'))];
  await tracker.postNewSets(channel);
  assert.equal(channel.threads.all.size, 1);
  assert.deepEqual(channel.pinned, []);
  assert.equal(state.threads['tournament/local'].pinned, false);
});

test('a pinned starter is unpinned once its tournament is over', async () => {
  const channel = fakeChannel();
  sets = [node('a1', now() - 30, tournament('Local'))];
  await tracker.postNewSets(channel);
  assert.equal(state.threads['tournament/local'].pinned, true);

  // still running, so the pin stays
  state.tournaments = { 7: { id: 7, name: 'Local', slug: 'tournament/local', startAt: now() - 3600, endAt: now() + 3600, entries: [], userIds: [1] } };
  await tracker.unpinFinishedThreads(channel);
  assert.equal(state.threads['tournament/local'].pinned, true);
  assert.deepEqual(channel.unpinned, []);

  // past the end plus time for locals running late, so it comes off
  state.tournaments[7].endAt = now() - 7 * 3600;
  await tracker.unpinFinishedThreads(channel);
  assert.equal(state.threads['tournament/local'].pinned, false);
  assert.deepEqual(channel.unpinned, ['card-1']);

  // already off, so nothing more to unpin
  await tracker.unpinFinishedThreads(channel);
  assert.deepEqual(channel.unpinned, ['card-1']);
});

test('placements posted unpin even with a far-out end date, unknown tournaments wait', async () => {
  const channel = fakeChannel();
  sets = [node('a1', now() - 30, tournament('Local'))];
  await tracker.postNewSets(channel);
  state.tournaments = { 7: { id: 7, name: 'Local', slug: 'tournament/local', startAt: now() - 3600, endAt: now() + 86400, entries: [], userIds: [1], resultsPosted: true } };
  await tracker.unpinFinishedThreads(channel);
  assert.equal(state.threads['tournament/local'].pinned, false);
  assert.deepEqual(channel.unpinned, ['card-1']);

  const other = fakeChannel();
  sets = [node('b1', now(), tournament('Weekly'))];
  await tracker.postNewSets(other);
  assert.equal(state.threads['tournament/weekly'].pinned, true);
  // its tournament hasn't shown up in the tracked list yet, so the pin stays
  await tracker.unpinFinishedThreads(other);
  assert.equal(state.threads['tournament/weekly'].pinned, true);
  assert.deepEqual(other.unpinned, []);
});

test('replacing a deleted thread unpins its old card and pins the new one', async () => {
  const threads = new Map();
  const channel = fakeChannel({ threads });
  sets = [node('first', now() - 20, tournament('Local'))];
  await tracker.postNewSets(channel);
  const first = { ...state.threads['tournament/local'] };

  threads.delete(first.id);
  sets = [node('second', now() - 10, tournament('Local'))];
  await tracker.postNewSets(channel);
  assert.deepEqual(channel.unpinned, [first.messageId]);
  const replacement = state.threads['tournament/local'];
  assert.notEqual(replacement.id, first.id);
  assert.equal(replacement.pinned, true);
  assert.deepEqual(channel.pinned, [replacement.messageId]);
});

async function configure(values, channel) {
  let reply;
  await handleCommand({
    commandName: 'messages', memberPermissions: { has: permission => permission === PermissionFlagsBits.ManageGuild },
    client: { channels: { cache: new Map(channel ? [['posts', channel]] : []) } },
    options: { getSubcommand: () => null, getBoolean: name => values[name] ?? null, getString: name => values[name] ?? null, getInteger: () => null },
    reply: async result => { reply = result; },
  });
  return reply.content;
}

test('/messages threads checks the bot can start threads before turning them on', async () => {
  state.messages = {};
  let reply = await configure({ threads: 'tournament', sets: false }, fakeChannel({ allowed: ['CreatePublicThreads'] }));
  assert.equal(reply, 'I need Send Messages in Threads in <#posts> to start threads. Add them to my role or the channel, then try again.');
  assert.deepEqual(state.messages, {}, 'nothing else changes either');

  reply = await configure({ threads: 'event' }, fakeChannel({ allowed: [] }));
  assert.match(reply, /Create Public Threads and Send Messages in Threads/);

  // a voice channel's chat has no threads
  const voiceChat = { ...fakeChannel(), threads: undefined };
  reply = await configure({ threads: 'tournament' }, voiceChat);
  assert.equal(reply, 'Threads can\'t be started in <#posts>, so posts stay in the channel.');

  reply = await configure({ threads: 'tournament' }, fakeChannel());
  assert.match(reply, /\*\*Threads:\*\* One thread per tournament\n/);
  assert.match(reply, /`threads` has three modes/);
  assert.equal(state.messages.threads, 'tournament');

  reply = await configure({ threads: 'event' }, fakeChannel());
  assert.match(reply, /\*\*Threads:\*\* One thread per event\n/);
  assert.equal(state.messages.threads, 'event');

  // turning it off needs no permissions
  reply = await configure({ threads: 'off' });
  assert.match(reply, /\*\*Threads:\*\* Off, post in the channel\n/);
  assert.equal(state.messages.threads, 'off');
});

test('missingThreadPermissions names what the channel lacks', () => {
  assert.deepEqual(tracker.missingThreadPermissions(fakeChannel()), []);
  assert.deepEqual(tracker.missingThreadPermissions(fakeChannel({ allowed: [] })), ['Create Public Threads', 'Send Messages in Threads']);
  assert.equal(tracker.missingThreadPermissions({ ...fakeChannel(), isThread: () => true }), null);
  assert.equal(tracker.missingThreadPermissions(undefined), null);
});

// a tracked tournament going on now, with one event and everything it can post on
const trackedLocal = (more = {}) => ({
  id: 5, name: 'Local', slug: 'tournament/local', startAt: now() - 3600, endAt: now() + 3600, entries: [], userIds: [],
  events: [{ id: 601, name: 'Singles', slug: 'tournament/local/event/singles', state: 'ACTIVE', numEntrants: 32 }],
  tracked: { by: 'manual', at: now(), sets: true, stream: true, top8: true, reminders: true }, lastCheck: now() - 120, ...more,
});
// a set between two people nobody tracks. a score of -1 is a DQ
const strangers = (id, at, inTournament, scores = [2, 1]) => ({
  ...node(id, at, inTournament),
  slots: [50, 60].map((id, i) => ({
    entrant: { id, name: i ? 'Guest' : 'Visitor', initialSeedNum: i + 1, participants: [{ player: { id } }] },
    standing: { stats: { score: { value: scores[i] } } },
  })),
});

test('a tracked tournament posts every finished set in its thread even with threads off, and one both checks find posts once', async () => {
  state.messages = {};
  const local = tournament('Local');
  state.tournaments = { 5: trackedLocal() };
  const lastCheck = state.tournaments[5].lastCheck;
  const channel = fakeChannel();
  // nobody tracked in the first, the crew's set comes back from both checks, and a no-show DQ
  const eventSets = [strangers('t1', now() - 30, local), node('t2', now() - 20, local), strangers('t3', now() - 10, local, [-1, 0])];
  const asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('e601: event')) {
      asked.push(`event since ${variables.filters.updatedAfter}`);
      return { ok: true, json: async () => ({ data: { e601: { sets: { pageInfo: { totalPages: 1 }, nodes: eventSets } } } }) };
    }
    asked.push('players');
    return { ok: true, json: async () => ({ data: { p10: { sets: { nodes: [node('t2', now() - 20, local)] } } } }) };
  };
  await tracker.postNewSets(channel);

  // from its own last check, with the 2 minutes of overlap
  assert.deepEqual(asked.toSorted(), [`event since ${lastCheck - 120}`, 'players']);
  // one card starts the thread, and the two sets go in it. the DQ'd one isn't tracked, so it stays out
  assert.deepEqual(channel.sent.map((message) => message.embeds[0].data.author.name), ['Tournament thread']);
  const [thread] = channel.threads.all.values();
  assert.deepEqual(thread.sent.map((message) => message.embeds[0].data.title), ['W · Visitor 2-1 Guest · L', 'W · Active 2-1 Opponent · L']);
  // nobody tracked is the brand color, a tracked winner is green
  assert.deepEqual(thread.sent.map((message) => message.embeds[0].data.color), [0x5b21b6, 0x22c55e]);
  assert.ok(state.tournaments[5].lastCheck > lastCheck);

  // a later check skips what's posted
  await tracker.postNewSets(channel);
  assert.equal(thread.sent.length, 2);

  // switched off for the tournament, the crew's sets still post where /messages threads says
  state.tournaments[5].tracked.sets = false;
  asked.length = 0;
  sets = [node('t4', now() - 5, local)];
  globalThis.fetch = async () => {
    asked.push('players');
    return { ok: true, json: async () => ({ data: { p10: { sets: { nodes: sets } } } }) };
  };
  await tracker.postNewSets(channel);
  assert.deepEqual(asked, ['players']);
  // still tracked, so it still goes in the tournament's thread
  assert.equal(thread.sent.length, 3);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { p10: { sets: { nodes: sets } } } }) });
});

test('a tracked tournament announces everything in its stream queue, with nobody tracked in it', async () => {
  state.messages = {};
  state.players = {};
  const local = tournament('Local');
  state.tournaments = { 5: trackedLocal() };
  const channel = fakeChannel();
  const queued = { ...strangers('q1', null, local), state: 2, updatedAt: now(), stream: null };
  const asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    asked.push(query.includes('streamQueue') ? 'queue' : 'players');
    return { ok: true, json: async () => ({ data: { tournament: { streamQueue: [{ stream: { streamName: 'local', streamSource: 'TWITCH' }, sets: [queued] }] } } }) };
  };
  await tracker.postStreamAlerts(channel, 0);
  // nobody has alerts on, so only the queue gets asked about, again for the confirm
  assert.deepEqual(asked, ['queue', 'queue']);
  const [thread] = channel.threads.all.values();
  assert.equal(thread.sent.length, 1);
  assert.match(thread.sent[0].embeds[0].data.title, /^On stream · /);

  // switched off for the tournament, its queue isn't asked about
  state.tournaments[5].tracked.stream = false;
  state.streamed = [];
  asked.length = 0;
  await tracker.postStreamAlerts(channel, 0);
  assert.deepEqual(asked, []);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { p10: { sets: { nodes: sets } } } }) });
});
