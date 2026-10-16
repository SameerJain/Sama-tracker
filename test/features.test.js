import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-features-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
// the jokes would call claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleCommand } = await import('../src/commands.js');
const api = await import('../src/startgg.js');
const embeds = await import('../src/embeds.js');
const { postWeeklyRecap } = await import('../src/tracker.js');
const tracker = await import('../src/tracker.js');
const { periodSummary } = await import('../src/reports.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ data: respond(JSON.parse(options.body)) }) });
}

const crewPlayer = { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' };
const event = { name: 'Singles', slug: 'tournament/local/event/singles', startAt: 150, numEntrants: 32,
  videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'Local' } };
const node = (id, completedAt, playerId = 10, dq = false) => ({
  id, completedAt, winnerId: playerId, fullRoundText: 'Winners round 1', event,
  slots: [playerId, 99].map((id, i) => ({
    entrant: { id, name: i ? 'Opponent' : 'Active', initialSeedNum: i ? 2 : 9, participants: [{ player: { id } }] },
    standing: { stats: { score: { value: dq && !i ? -1 : i ? 1 : 2 } } },
  })),
});

test('registers run, scout, and progress with their required inputs', () => {
  for (const name of ['run', 'progress']) {
    const command = commands.find(c => c.name === name);
    assert.equal(command?.options[0].name, 'player');
    assert.equal(command.options[0].autocomplete, true);
  }
  assert.equal(commands.find(c => c.name === 'scout')?.options[0].name, 'profile');
});

test('scout refuses untracked Discord callers before fetching an opponent', async () => {
  state.players = { 1: { ...crewPlayer, discordId: 'outsider' } };
  mockApi(({ query }) => {
    assert.match(query, /authorizations/);
    return { u1: { player: { gamerTag: 'Active' }, authorizations: [{ externalId: 'allowed' }] } };
  });
  const replies = [];
  await handleCommand({
    commandName: 'scout', user: { id: 'outsider' },
    options: { getSubcommand: () => null, getString: () => 'target' },
    deferReply: async () => {}, editReply: async r => replies.push(r),
  });
  assert.match(replies.at(-1), /tracked/i);
});

test('tracked callers can scout an untracked opponent without adding them', async () => {
  state.players = { 1: crewPlayer };
  const set = node('scout-meeting', 150);
  mockApi(({ query }) => {
    if (query.includes('user(slug:')) return { user: { id: 2, slug: 'user/target', player: { id: 99, gamerTag: 'Target' } } };
    if (query.includes('authorizations')) return { u1: { player: { gamerTag: 'Active' }, authorizations: [{ externalId: 'allowed' }] } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [{ ...set,
      games: [{ winnerId: 10, selections: [{ entrant: { id: 99 }, character: { name: 'Fox' } }] }],
    }] } } };
  });
  let reply;
  await handleCommand({
    commandName: 'scout', user: { id: 'allowed' }, deferred: true,
    options: { getSubcommand: () => null, getString: () => 'https://www.start.gg/user/target' },
    deferReply: async options => assert.ok(options.flags), editReply: async result => { reply = result; },
  });
  const text = reply.embeds.map(e => e.toJSON().description).join('\n');
  assert.match(text, /Fox/);
  assert.match(text, /Your head-to-head/);
  assert.match(text, /Ultimate: 1-0/);
  assert.deepEqual(Object.keys(state.players), ['1']);
});

test('period history paginates through edits and filters by completion time', async () => {
  const node = (id, completedAt) => ({
    id, completedAt, winnerId: 10, event: { slug: 'event/test' },
    slots: [10, 20].map(id => ({ entrant: { id, name: 'P', participants: [{ player: { id } }] } })),
  });
  mockApi(({ variables }) => ({ player: { sets: {
    pageInfo: { totalPages: 2 },
    nodes: variables.page === 1 ? [node('old-edit', 10)] : [node('inside', 150), node('end', 200)],
  } } }));
  assert.deepEqual((await api.getPeriodHistory(10, 100, 200)).map(s => s.id), ['inside']);
});

test('run cards use final standings and show completed and pending opponents', () => {
  const player = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew' };
  const tournament = { name: 'Local', slug: 'tournament/local' };
  const entry = { event: 'Singles', eventSlug: 'tournament/local/event/singles', entrants: 32, final: false, done: false };
  const sides = [{ id: 1, name: 'Crew', playerIds: [10], score: 2 }, { id: 2, name: 'Rival', playerIds: [20], score: 1 }];
  const sets = [
    { id: '1', state: 3, winnerId: 1, completedAt: 100, round: 'Winners round 1', sides },
    { id: '2', state: 6, round: 'Winners round 2', sides },
  ].map(s => ({ ...s, event: { slug: entry.eventSlug } }));
  const text = embeds.run(player, tournament, entry, sets).map(e => e.data.description).join('\n');
  assert.match(text, /Still in/i);
  assert.match(text, /W 2-1.*Rival/);
  assert.match(text, /Next.*Rival/);
  const ended = embeds.run(player, tournament, { ...entry, final: true, placement: 5 }, sets).map(e => e.data.description).join('\n');
  assert.match(ended, /Finished.*5th/i);
  assert.doesNotMatch(ended, /Next.*Rival/);
});

test('progress handles placements without sets or seeds without inventing win rates', () => {
  const current = periodSummary(crewPlayer, [], [{ event, placement: 5, seed: null }], 100, 200);
  const previous = periodSummary(crewPlayer, [], [], 0, 100);
  const text = embeds.progress(crewPlayer, current, previous, { since: 0, middle: 100, until: 200 })
    .map(e => e.toJSON().description).join('\n');
  assert.doesNotMatch(text, /NaN|0%/);
  assert.match(text, /5th/);
  assert.match(text, /no seeded finishes/i);
});

test('recap includes spanning-week finishes, excludes inactive players, and persists completion', async () => {
  const until = Date.parse('2026-10-26T01:00:00Z') / 1000;
  const next = Date.parse('2026-11-02T02:00:00Z') / 1000;
  state.weeklyRecap = undefined;
  state.players = { 1: crewPlayer, 2: { userId: 2, playerId: 20, tag: 'Inactive' }, 3: { userId: 3, playerId: 30, tag: 'DQ-only' } };
  state.tournaments = { 1: { name: 'Next local', slug: 'tournament/next', startAt: until + 86400, entries: [{ userId: 1 }, { userId: 2 }] } };
  state.tournaments[2] = { name: 'Late Sunday', slug: 'tournament/late', startAt: next - 1800, entries: [{ userId: 1 }] };
  state.tournaments[3] = { name: 'Following week', slug: 'tournament/following', startAt: next, entries: [{ userId: 1 }] };
  mockApi(({ query, variables }) => query.includes('user(id:')
    ? { user: { events: { pageInfo: { totalPages: 1 }, nodes: [{ ...event, startAt: until - 8 * 86400, state: 'COMPLETED', userEntrant: { initialSeedNum: 9, standing: { placement: 5 } } }] } } }
    : { player: { sets: { pageInfo: { totalPages: 1 }, nodes: variables.id === 20 ? [] : [node('weekly', until - 10, variables.id, variables.id === 30)] } } });
  const sent = [];
  const channel = { send: async r => sent.push(r) };
  await postWeeklyRecap(channel, until);
  assert.equal(sent.length, 1);
  const text = sent.flatMap(r => r.embeds.map(e => (e.data ?? e).description)).join('\n');
  assert.match(text, /Active/);
  assert.match(text, /Next local/);
  assert.match(text, /Late Sunday/);
  assert.match(text, /Biggest upset/);
  assert.match(text, /Best finish/);
  assert.doesNotMatch(text, /Inactive|DQ-only|Following week/);
  state.weeklyRecap = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).weeklyRecap;
  mockApi(() => assert.fail('A completed recap must not be fetched again'));
  await postWeeklyRecap(channel, until + 60);
  assert.equal(sent.length, 1);
});

test('recap retries unfinished message batches without reposting successful batches', async () => {
  const until = Date.parse('2026-10-19T01:00:00Z') / 1000;
  state.players = { 1: crewPlayer };
  state.tournaments = {};
  state.weeklyRecap = undefined;
  mockApi(({ query }) => query.includes('user(id:')
    ? { user: { events: { pageInfo: { totalPages: 1 }, nodes: Array.from({ length: 30 }, (_, i) => ({
      ...event, slug: `tournament/long/event/${i}`, tournament: { name: `Local ${i} ${'x'.repeat(100)}` }, startAt: until - 100,
      state: 'COMPLETED', userEntrant: { standing: { placement: 5 } },
    })) } } }
    : { player: { sets: { pageInfo: { totalPages: 1 }, nodes: Array.from({ length: 30 }, (_, i) => ({
      ...node(`long-weekly-${i}`, until - 10), event: { ...event, slug: `tournament/long/event/${i}` },
    })) } } });
  let sends = 0;
  await assert.rejects(postWeeklyRecap({ send: async () => {
    if (++sends === 2) throw new Error('Discord unavailable');
  } }, until), /Discord unavailable/);
  assert.equal(state.weeklyRecap.sent, 1);
  assert.equal(state.weeklyRecap.done, false);
  assert.ok(state.weeklyRecap.batches.length > 1);
  const pending = state.weeklyRecap.batches.slice(state.weeklyRecap.sent);
  state.players = {};
  mockApi(() => assert.fail('Retry the saved recap instead of rebuilding different message batches'));
  const retried = [];
  await postWeeklyRecap({ send: async r => retried.push(r) }, until + 60);
  assert.ok(retried.length > 0);
  assert.deepEqual(retried.map(r => r.embeds), pending);
  assert.equal(state.weeklyRecap.done, true);
});

test('a week with no activity posts nothing', async () => {
  state.players = { 1: crewPlayer };
  state.weeklyRecap = undefined;
  mockApi(() => ({ player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } }));
  await postWeeklyRecap({ send: async () => assert.fail('No empty recap') }, Date.parse('2026-10-19T01:00:00Z') / 1000);
  assert.equal(state.weeklyRecap.done, true);
});

test('muted automatic messages are consumed without posting or replaying them later', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120 } };
  state.messages = { sets: false, streams: false, rollcall: false, results: false, registration: false };
  state.posted = [];
  state.dqs = [];
  state.streamed = [];
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
  await tracker.postStreamAlerts(channel);
  assert.ok(state.streamed.includes('muted-stream'));
  state.messages.streams = true;
  await tracker.postStreamAlerts(channel);
  assert.equal(sent.length, 1);

  const upcoming = { startAt: now + 1800, entries: [1, 2, 3].map(userId => ({ userId })) };
  await tracker.postRollCall(upcoming, channel);
  assert.equal(upcoming.rollCallPosted, true);
  const finished = { startAt: now - 27 * 3600, endAt: now - 26 * 3600, entries: [{ started: true }] };
  await tracker.postResults(finished, channel);
  assert.equal(finished.resultsPosted, true);

  state.regAdmins = {};
  state.regReminders = { 1: { id: 1, name: 'Local', slug: 'tournament/local', next: 0 } };
  mockApi(() => ({ tournament: { id: 1, startAt: now + 86400, endAt: now + 2 * 86400,
    registrationClosesAt: now + 3600, isRegistrationOpen: true, events: [] } }));
  await tracker.postRegReminders(channel);
  assert.equal(state.regReminders[1].next, 4);
  assert.equal(sent.length, 1);
});

test('re-enabling between polls skips events that became due before re-enabling', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = { enabledAt: Object.fromEntries(['sets', 'streams', 'rollcall', 'results', 'registration'].map(type => [type, now])) };
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120 } };
  state.posted = [];
  state.dqs = [];
  state.streamed = [];
  state.tournaments = {};
  let current = { ...node('unpolled-muted-set', now - 60), state: 3, updatedAt: now - 60 };
  mockApi(() => ({ p10: { sets: { nodes: [current] } } }));
  await tracker.postNewSets(channel);
  current = { ...current, id: 'unpolled-muted-stream', state: 2, stream: { streamName: 'example', streamSource: 'TWITCH' } };
  await tracker.postStreamAlerts(channel);
  for (const userId of [2, 3]) state.players[userId] = { userId, playerId: userId * 10, tag: `Player ${userId}`, slug: `user/player${userId}` };
  await tracker.postRollCall({ name: 'Local', slug: 'tournament/local', startAt: now + 1800,
    entries: [1, 2, 3].map(userId => ({ userId, event: 'Singles', eventSlug: event.slug, entrants: 32 })) }, channel);
  await tracker.postResults({ name: 'Local', slug: 'tournament/local', startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries: [{ userId: 1, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 5, final: true }] }, channel);
  state.regAdmins = {};
  state.regReminders = { 1: { id: 1, name: 'Local', slug: 'tournament/local', next: 0 } };
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
  await tracker.postStreamAlerts({ send: async payload => sent.push(payload) });
  assert.equal(sent.length, 1);
});
