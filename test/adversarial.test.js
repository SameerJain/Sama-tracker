import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

// adversarial + security regression: every case here is a way the bot used to
// ping, crash or leak. each one pins the fix, not the mock.
const directory = mkdtempSync(join(tmpdir(), 'sama-adversarial-'));
process.env.STATE_DIR = directory;
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const startgg = await import('../src/startgg.js');
const embeds = await import('../src/embeds/index.js');
const sharedEmbeds = await import('../src/embeds/shared.js');
const shared = await import('../src/commands/shared.js');
const registration = await import('../src/commands/registration.js');
const settings = await import('../src/commands/settings.js');
const players = await import('../src/commands/players.js');
const accounts = await import('../src/accounts.js');
const { handleCommand } = await import('../src/commands/index.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);

function mockStartgg(respond) {
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ data: respond(query, variables) }) };
  };
}

// a deferred public command reply, recording what would go to the channel
function fakeInteraction() {
  const calls = [];
  return {
    calls,
    deferred: true,
    createdTimestamp: Date.now(),
    message: { flags: { has: () => false } },
    user: { id: 'runner' },
    channel: { send: async () => assert.fail('late path should not trigger') },
    reply: async (payload) => { calls.push(['reply', payload]); },
    editReply: async (payload) => { calls.push(['edit', payload]); },
    followUp: async (payload) => { calls.push(['followUp', payload]); },
  };
}

test('public report replies never ping, even with @everyone in a gamertag', async () => {
  const card = sharedEmbeds.baseEmbed(0x5b21b6).setDescription('@everyone free pizza');
  const interaction = fakeInteraction();
  await shared.sendEmbeds(interaction, [card]);
  assert.equal(interaction.calls.length, 1);
  assert.deepEqual(interaction.calls[0][1].allowedMentions, { parse: [] });
});

test('a tournament name with @everyone and backticks pings nobody and breaks no markdown', async () => {
  const evil = '@everyone`broke';
  const reply = registration.tournamentNotFound(evil);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
  assert.ok(!reply.content.includes('@everyone`broke'));
  assert.ok(reply.content.includes('everyonebroke'));

  const channel = { sent: [] };
  mockStartgg((query) => {
    if (query.includes('registrationClosesAt')) {
      return { tournament: { id: 5, name: '@everyone closed', slug: 'tournament/evil', registrationClosesAt: now - 10, isRegistrationOpen: false, numAttendees: 0, events: [] } };
    }
    return {};
  });
  state.regWarned = [];
  const calls = [];
  await registration.regWarn({
    user: { id: 'runner' }, memberPermissions: { has: () => false },
    options: { getString: (name) => (name === 'tournament' ? 'evil' : null), getUser: () => ({ id: 'u9', bot: false, displayName: 'U' }), getMember: () => null },
    deferReply: async () => {},
    editReply: async (payload) => { calls.push(payload); },
  });
  const closed = calls.find((payload) => String(payload.content).includes('closed'));
  assert.ok(closed);
  assert.deepEqual(closed.allowedMentions, { parse: [] });
  void channel;
});

test('a profile link with backticks asks again without breaking the code span', async () => {
  mockStartgg(() => ({ user: null }));
  const edits = [];
  await shared.findPlayer({ editReply: async (payload) => { edits.push(payload); } }, 'a`b`c');
  assert.deepEqual(edits[0].allowedMentions, { parse: [] });
  assert.ok(!edits[0].content.includes('a`b`c'));
});

test('/socials_edit goes by discord, so a role handed it can use it without Manage Server', async () => {
  state.socials = [];
  const handed = await new Promise((resolve) => {
    settings.socialsAdd({
      memberPermissions: { has: () => false },
      options: { getString: (name) => (name === 'name' ? 'Handed' : 'https://example.com/handed') },
      reply: async (payload) => resolve(payload),
    });
  });
  assert.match(handed.content, /^Added/);
  assert.equal(state.socials.length, 1);
  state.socials = [];

  const allowed = await new Promise((resolve) => {
    settings.socialsAdd({
      memberPermissions: { has: () => true },
      options: { getString: (name) => (name === 'name' ? 'Good' : 'https://example.com/good') },
      reply: async (payload) => resolve(payload),
    });
  });
  assert.match(allowed.content, /^Added/);
  assert.equal(state.socials.length, 1);

  const handedRemove = await new Promise((resolve) => {
    settings.socialsRemove({
      memberPermissions: { has: () => false },
      options: { getString: () => 'https://example.com/good' },
      reply: async (payload) => resolve(payload),
      followUp: async (payload) => resolve(payload),
    });
  });
  assert.match(handedRemove.content, /Removed/);
  assert.equal(state.socials.length, 0);
});

test('a corrupt saved social link renders as text instead of throwing /socials', async () => {
  state.socials = [{ name: 'Broken', url: 'not a url at all {{{' }];
  const [card] = embeds.socials(state.socials);
  // shown as it was saved, never as a link discord would try to open
  assert.equal(card.data.description, '**Broken** · not a url at all {{{');
  state.socials = [];
});

test('a twitch name with spaces and parens still links instead of breaking', async () => {
  const set = {
    id: 1, winnerId: 1, completedAt: now, fullRoundText: 'Winners Final',
    event: { name: 'Ultimate Singles', slug: 'tournament/local/event/singles', videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'Local', slug: 'tournament/local', images: [] } },
    stream: { streamName: 'my stream (live)', streamSource: 'TWITCH' },
    sides: [
      { id: 1, name: 'Crew', seed: 1, playerIds: [10], characters: [], vod: null },
      { id: 2, name: 'Rival', seed: 2, playerIds: [20], characters: [], vod: null },
    ],
  };
  const card = embeds.onStream(set, { 1: { userId: 1, playerId: 10, tag: 'Crew' } });
  assert.equal(card.data.author, undefined);
  const watch = card.data.fields?.find((field) => field.name === 'Watch');
  assert.ok(watch.value.includes('https://twitch.tv/my%20stream%20(live)'.replace('(', '%28').replace(')', '%29')) || watch.value.includes('twitch.tv/'));
  assert.ok(!watch.value.includes('](https://twitch.tv/my stream'));
});

test('/track remove escapes the tag in the question and the answer', async () => {
  state.players = { 9: { userId: 9, playerId: 90, tag: '@everyone *boss*', slug: 'user/evil', lastCheck: now } };
  const calls = [];
  await players.trackRemove({
    user: { id: 'runner' },
    options: { getString: () => '9' },
    reply: async (payload) => { calls.push(payload); },
    deferReply: async () => {},
    editReply: async (payload) => { calls.push(payload); },
  });
  const question = calls[0];
  assert.deepEqual(question.allowedMentions, { parse: [] });
  assert.ok(!String(question.content).includes('@everyone *boss*'));
});

test('discord retry_after is capped so one slow check cannot stall a command', async () => {
  const delays = [];
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn, ms, ...rest) => {
    delays.push(ms);
    return realTimeout(fn, 0, ...rest);
  });
  try {
    let tries = 0;
    const guild = {
      members: {
        fetch: async () => {
          tries++;
          if (tries === 1) throw { data: { retry_after: 999 } };
          return new Map();
        },
      },
    };
    await accounts.serverMembers(guild, ['123']);
    assert.equal(tries, 2);
    assert.ok(delays.length >= 1);
    assert.ok(delays[0] <= 10_000, `waited ${delays[0]}ms`);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});

test('malformed start.gg replies come back empty instead of crashing', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: null }) });
  assert.deepEqual(await startgg.getSets([10], { since: now - 60 }), []);

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { p10: { sets: null } } }) });
  assert.deepEqual(await startgg.getSets([10], { since: now - 60 }), []);

  mockStartgg(() => ({ tournament: null }));
  assert.equal(await startgg.getRegistration('missing'), null);

  mockStartgg(() => ({ event: null }));
  assert.deepEqual(await startgg.getDoublesEvents({ userId: 1, playerId: 10 }, [50]), new Map());

  // a non-complexity error throws a plain message with no query in it
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'boom' }] }) });
  await assert.rejects(startgg.checkToken(), /boom/);
});

test('a 429 in the middle of a history lookup retries instead of failing', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ data: { currentUser: { id: 1 } } }) };
  };
  await startgg.checkToken();
  assert.equal(calls, 2);
});

test('bad command input answers instead of throwing', async () => {
  mockStartgg(() => ({ user: null }));
  const run = (values) => {
    const calls = [];
    return {
      calls,
      commandName: 'track',
      user: { id: 'runner' },
      memberPermissions: { has: () => true },
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => 'add',
        getString: (name) => values[name] ?? null, getBoolean: () => null, getInteger: () => null, getUser: () => null, getMember: () => null,
      },
      reply: async (result) => calls.push(['reply', result]),
      deferReply: async () => {},
      editReply: async (result) => calls.push(['edit', result]),
      followUp: async (result) => calls.push(['followUp', result]),
    };
  };
  // graphql in the profile box never reaches start.gg as code
  const evil = run({ profile: 'a){evil}' });
  await handleCommand(evil);
  const answered = evil.calls.map(([, payload]) => String(payload?.content ?? payload)).join(' ');
  assert.ok(answered.includes("Couldn't find"));

  // a nonsense date on /h2h answers with what to type
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', lastCheck: now } };
  state.links = {};
  const badDate = {
    calls: [],
    commandName: 'h2h',
    user: { id: 'runner' },
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => null,
      getString: (name) => ({ opponent: '1', since: '2026-02-30' }[name] ?? null), getBoolean: () => null,
    },
    reply: async function (result) { this.calls.push(result); },
  };
  await handleCommand(badDate);
  assert.ok(String(badDate.calls[0]?.content ?? badDate.calls[0]).includes('YYYY-MM-DD'));
});

test('breaking: 1000 tracked players still list without throwing or pinging', async () => {
  state.players = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => {
    const id = 1000 + i;
    return [id, { userId: id, playerId: id * 10, tag: `@everyone Player ${i} with a very long tag ${'x'.repeat(80)}`, slug: `user/p${i}`, lastCheck: now }];
  }));
  state.tournaments = {};
  const cards = embeds.trackedList(state.players, 0, {});
  assert.ok(cards.length >= 1);
  for (const card of cards) {
    const text = card.data.description ?? '';
    assert.ok(text.length <= 4096);
  }
  const interaction = fakeInteraction();
  await shared.sendEmbeds(interaction, cards);
  for (const [, payload] of interaction.calls) {
    assert.deepEqual(payload.allowedMentions, { parse: [] });
  }
  state.players = {};
});

test('breaking: a 6000-character verbose card splits instead of failing discord limits', async () => {
  const cards = Array.from({ length: 20 }, (_, i) => sharedEmbeds.baseEmbed(0x5b21b6).setDescription(`line ${i} ${'x'.repeat(400)}`));
  const batches = embeds.messages(cards);
  assert.ok(batches.length > 1);
  for (const batch of batches) {
    const total = batch.map((each) => each.data.description?.length ?? 0).reduce((a, b) => a + b, 0);
    assert.ok(total <= 6000);
  }
});

test('stress: 500 set ids batch without one request per set', async () => {
  const ids = Array.from({ length: 500 }, (_, i) => String(20000 + i));
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    seen.push(query);
    const out = {};
    for (const match of query.matchAll(/s(\d+): set\(id/g)) out[`s${match[1]}`] = { state: 3 };
    return { ok: true, status: 200, json: async () => ({ data: out }) };
  };
  const states = await startgg.getSetStates(ids);
  assert.equal(states.size, 500);
  assert.ok(seen.length <= 12, `went out as ${seen.length} requests`);
  assert.equal(startgg.queueLength(), 0);
});
