import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// scrub for misclicks, bad ids and double posts: each test proves the fix, not the mock
const directory = mkdtempSync(join(tmpdir(), 'sama-hardening-'));
process.env.STATE_DIR = directory;
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const startgg = await import('../src/startgg.js');
const tracker = await import('../src/tracker.js');
const { confirmable, handleChoice } = await import('../src/commands/confirm.js');
const { writeTrackRequest } = await import('../src/track-request.js');
const { post } = await import('../src/fun/index.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
let asked = [];
function mockStartgg(respond) {
  asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    asked.push(query);
    return { ok: true, json: async () => ({ data: respond(query) }) };
  };
}

function fakeChannel({ editThrows = null } = {}) {
  const sent = [];
  const edits = [];
  const posted = new Map();
  const messages = {
    fetch: async (id) => {
      if (!posted.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      return posted.get(id);
    },
    edit: async (id, payload) => {
      if (editThrows) throw editThrows;
      if (!posted.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      edits.push([id, payload]);
    },
  };
  return {
    sent, edits,
    send: async (payload) => {
      sent.push(payload);
      const message = { id: `m${sent.length}`, channelId: 'c1', embeds: (payload.embeds ?? []).map((embed) => embed.toJSON?.() ?? embed) };
      posted.set(message.id, message);
      return message;
    },
    client: { channels: { fetch: async () => ({ messages }) } },
  };
}

test('a track request with __proto__ or bad ids adds nobody and pollutes nothing', () => {
  state.players = {};
  writeTrackRequest({
    source: 'evil host file',
    players: [
      { userId: '__proto__', playerId: 10, tag: 'Evil' },
      { userId: 1, playerId: '1; evil', tag: 'Evil' },
      { userId: 2, playerId: 20, tag: 'Good' },
    ],
  });
  tracker.importTrackRequest();
  assert.deepEqual(Object.keys(state.players), ['2']);
  assert.equal({}.polluted, undefined);
  assert.equal(state.players.polluted, undefined);
});

test('a start.gg id with graphql in it never reaches the query', async () => {
  mockStartgg(() => assert.fail('bad id reached start.gg'));
  await assert.rejects(startgg.getSetStates(['1) { evil }']), /bad start\.gg id/);
  await assert.rejects(startgg.getProfiles(['__proto__']), /bad start\.gg id/);
  await assert.rejects(startgg.getSetsById(['10\nquery']), /bad start\.gg id/);
  assert.equal(asked.length, 0);
});

test('a bad discord id from start.gg never becomes a mention or a ping', async () => {
  // a warned call with one good id and two bad values: only the good one pings
  state.messages = { calls: true };
  state.callPosts = [{ setId: '802', channelId: 'c1', messageId: 'm1', calledAt: now - 6 * 60, discordIds: ['@everyone', '123', 'bad id'], warned: false }];
  mockStartgg(() => ({ s802: { state: 6 } }));
  const channel = fakeChannel();
  // the warning reply needs its original message to exist
  await channel.send({ content: 'original call' });
  channel.sent.length = 0;
  state.callPosts[0].messageId = 'm1';
  await tracker.followCalls(channel);
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].content, '<@123> called 6 min ago, TOs usually DQ at 10');
  assert.deepEqual(channel.sent[0].allowedMentions, { users: ['123'] });
});

test('expired result posts are saved away, not left to come back on restart', async () => {
  state.resultPosts = [{ setId: '701', channelId: 'c1', messageId: 'm1', at: now - 61 * 60, outcome: '1:2:1', reset: false }];
  mockStartgg(() => assert.fail('expired posts are never asked about'));
  await tracker.fixCorrectedResults(fakeChannel());
  assert.deepEqual(state.resultPosts, []);
});

test('an uncalled edit that fails stays watched for the next check', async () => {
  state.callPosts = [{ setId: '802', channelId: 'c1', messageId: 'm1', calledAt: now - 60, discordIds: ['123'], warned: false }];
  state.called = ['802'];
  mockStartgg(() => ({ s802: { state: 1 } }));
  const channel = fakeChannel({ editThrows: Object.assign(new Error('discord is down'), { code: 500 }) });
  await tracker.followCalls(channel);
  assert.equal(state.callPosts.length, 1);
  assert.deepEqual(state.called, []);
});

test('a confirm pressed twice at once runs once, and a colon in the target stays whole', async () => {
  let runs = 0;
  confirmable('hardening-kind', {
    command: '/hardening',
    run: (target) => {
      runs++;
      return { content: `ran ${target}` };
    },
    cancel: () => 'cancelled',
  });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const press = (customId) => handleChoice({
    customId, user: { id: 'runner' },
    update: async () => { await gate; return 'updated'; },
    reply: async (result) => result,
  });
  const firstPress = press('confirm:hardening-kind:a:b:c:runner');
  // let the first press take the lock before the double lands
  await new Promise(setImmediate);
  const second = await press('confirm:hardening-kind:a:b:c:runner');
  release();
  const first = await firstPress;
  assert.equal(runs, 1);
  assert.equal(first, 'updated');
  assert.match(second.content, /one press is enough/);

  let saw;
  confirmable('hardening-target', {
    command: '/hardening',
    run: (target) => { saw = target; return { content: 'ok' }; },
    cancel: () => 'cancelled',
  });
  await handleChoice({ customId: 'confirm:hardening-target:a:b:c:runner', user: { id: 'runner' }, update: async () => 'ok' });
  assert.equal(saw, 'a:b:c');
});

test('a fun post never pings, even when haiku quotes @everyone', async () => {
  const edited = [];
  const interaction = {
    reply: async () => {},
    deferReply: async () => {},
    editReply: async (payload) => { edited.push(payload); },
  };
  const fun = {
    name: 'melee', line: 'wavedash', enabled: true,
    takePost: async () => ({ text: '@everyone look at this', screenshot: { name: 'wiki', page: 'https://example.com' }, image: { name: 'x.png' } }),
    format: () => ({ content: '@everyone look at this', embeds: [] }),
  };
  await post(interaction, fun);
  assert.deepEqual(edited[0].allowedMentions, { parse: [] });
});

test('stress: 120 set ids go out as small pages and still map back', async () => {
  const ids = Array.from({ length: 120 }, (_, i) => String(9000 + i));
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    seen.push(query);
    const out = {};
    for (const match of query.matchAll(/s(\d+): set\(id/g)) out[`s${match[1]}`] = { state: 3 };
    return { ok: true, json: async () => ({ data: out }) };
  };
  const states = await startgg.getSetStates(ids);
  assert.equal(states.size, 120);
  assert.ok(ids.every((id) => states.get(id) === 3));
  // 50 to a request means 3 requests, not 120
  assert.ok(seen.length <= 5);
});

test('adversarial: start.gg nodes:null and missing pages come back as no sets, not a crash', async () => {
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    if (query.includes('sets(perPage: $perPage')) return { ok: true, json: async () => ({ data: { p10: { sets: { nodes: null } } } }) };
    return { ok: true, json: async () => ({ data: {} }) };
  };
  assert.deepEqual(await startgg.getSets([10], { since: now - 60 }), []);
  // unknown set ids map to null instead of throwing, so unfollowed buttons drop cleanly
  assert.equal((await startgg.getSetStates(['9100'])).get('9100'), null);
});
