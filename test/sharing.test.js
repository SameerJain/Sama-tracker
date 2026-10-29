import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { node } from './fixtures.js';

// every server's checks share start.gg's 80 a minute. a pass of one check across the servers asks once for
// what two servers both need, and commands take turns by server so one busy server can't take every slot
const directory = mkdtempSync(join(tmpdir(), 'sama-sharing-'));
process.env.STATE_DIR = directory;
process.env.MULTI_GUILD = 'true';
delete process.env.ANTHROPIC_API_KEY;
const startgg = await import('../src/startgg.js');
const { query } = await import('../src/startgg/queue.js');
const tracker = await import('../src/tracker.js');
const { forGuild } = await import('../src/store.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

// start.gg answering with whatever reply gives back for each request body, counting them
let asked = [];
function answer(reply) {
  asked = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    asked.push(body);
    const data = reply(body);
    if (data instanceof Error) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
}

beforeEach(() => startgg.resetOutage());

test('the same request twice in one pass goes to start.gg once, and each server gets its own copy', async () => {
  answer(() => ({ tournament: { name: 'Local', events: [{ id: 1, state: 'ACTIVE' }] } }));
  const text = '{ tournament(id: 5) { name } }';
  const [first, second, together] = await startgg.inBackground(() => startgg.sharingAcrossServers(async () => {
    const one = await query(text);
    // one server changing what it got, the way Object.assign onto a saved tournament does
    one.tournament.events[0].state = 'COMPLETED';
    const two = await query(text);
    // asked at the same moment shares too
    const both = await Promise.all([query('{ other }'), query('{ other }')]);
    return [one, two, both];
  }));
  assert.equal(asked.length, 2);
  assert.equal(first.tournament.events[0].state, 'COMPLETED');
  assert.equal(second.tournament.events[0].state, 'ACTIVE');
  assert.notEqual(together[0], together[1]);

  // outside a pass nothing is shared, so commands and single-server builds ask every time
  await startgg.inBackground(() => query(text));
  await startgg.inBackground(() => query(text));
  assert.equal(asked.length, 4);
});

test('a request that failed for one server is asked again for the next', async () => {
  let failing = true;
  answer(() => (failing ? new Error('down') : { ok: 1 }));
  const results = await startgg.inBackground(() => startgg.sharingAcrossServers(async () => {
    const first = await query('{ flaky }').catch((err) => err.message);
    failing = false;
    const second = await query('{ flaky }');
    return [first, second];
  }));
  assert.match(results[0], /start\.gg/);
  assert.deepEqual(results[1], { ok: 1 });
  // three tries for the first, one for the second
  assert.equal(asked.length, 4);
});

test('two servers\' set checks seconds apart share one request, and each keeps only its own window', async () => {
  // a multiple of the 5 minute step, so both times below round down to it
  const base = 1_800_000_000 - (1_800_000_000 % 300);
  const set = (id, updatedAt) => ({ ...node(id, updatedAt), updatedAt });
  answer(({ variables }) => {
    const after = variables.filters.updatedAfter;
    return { e7: { sets: { pageInfo: { totalPages: 1 }, nodes: [set('a', base + 10), set('b', base + 100), set('c', base + 200)].filter((each) => each.updatedAt >= after) } } };
  });
  const [one, two] = await startgg.inBackground(() => startgg.sharingAcrossServers(async () => [
    await startgg.getEventSets([7], base + 50),
    await startgg.getEventSets([7], base + 150),
  ]));
  assert.equal(asked.length, 1);
  assert.equal(asked[0].variables.filters.updatedAfter, base);
  assert.deepEqual(one.map((each) => each.id), ['b', 'c']);
  assert.deepEqual(two.map((each) => each.id), ['c']);

  // on its own it asks for exactly the time it was given
  await startgg.inBackground(() => startgg.getEventSets([7], base + 50));
  assert.equal(asked.at(-1).variables.filters.updatedAfter, base + 50);
});

test('a background check across two servers asks once for a tournament both track', async () => {
  // a posts channel the bot can post in
  const channel = (id) => ({ id, client: { user: { id: 'bot' } }, isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async () => ({}) });
  const channels = { 'posts-a': channel('posts-a'), 'posts-b': channel('posts-b') };
  tracker.setBotClient({ channels: { fetch: async (id) => channels[id] ?? null } });
  forGuild('server-a').channelId = 'posts-a';
  forGuild('server-b').channelId = 'posts-b';
  answer(() => ({ tournament: { streamQueue: [] } }));
  const seen = [];
  await startgg.inBackground(() => tracker.eachGuild(async (id) => {
    seen.push(id);
    await startgg.getStreamQueues(5);
  }));
  assert.ok(seen.includes('server-a') && seen.includes('server-b'));
  assert.equal(asked.length, 1);
});

test('commands take turns by server, so one busy server can\'t hold up another', async () => {
  answer(() => ({}));
  const order = [];
  const command = (server, label, requests) => startgg.asCommand(async () => {
    for (let n = 0; n < requests; n++) {
      await query(`{ ${label}${n} }`);
      order.push(server);
    }
  }, null, server);
  // five commands at once in the busy server, one in the quiet one
  await Promise.all([
    ...Array.from({ length: 5 }, (_, i) => command('busy', `busy${i}x`, 4)),
    command('quiet', 'quietx', 4),
  ]);
  // the quiet server's four go out within its first eight turns, every other request, instead of one in six
  const lastQuiet = order.lastIndexOf('quiet');
  assert.ok(lastQuiet < 8, `quiet's last request was number ${lastQuiet + 1}: ${order.join(' ')}`);
  assert.equal(order.filter((server) => server === 'busy').length, 20);
  assert.equal(startgg.queueLength(), 0);
});
