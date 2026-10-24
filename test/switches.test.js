import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// tournament switches: the server setting is the default, a tournament's own override beats it
const directory = mkdtempSync(join(tmpdir(), 'sama-switches-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { postsOn, TOURNAMENT_POSTS, MESSAGE_TYPES } = await import('../src/message-settings.js');
const { posting } = await import('../src/tracker/shared.js');
const { migrateTournamentPosts, migrateTracking, trackTournament } = await import('../src/tracker/maintenance.js');
after(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => { state.messages = {}; state.tournaments = {}; });

test('a tournament with no override follows the server switch, live', () => {
  const tournament = { tracked: { by: 'manual', at: 0, posts: {} } };
  state.messages = {};
  assert.equal(postsOn('streams', tournament), true);
  state.messages = { streams: false };
  assert.equal(postsOn('streams', tournament), false);
  assert.equal(posting(tournament, 'streams'), false);
});

test('a tournament override beats the server switch either way', () => {
  state.messages = { streams: false, sets: true };
  const tournament = { tracked: { by: 'manual', at: 0, posts: { streams: true, sets: false } } };
  assert.equal(postsOn('streams', tournament), true);
  assert.equal(postsOn('sets', tournament), false);
});

test('an override turned on skips what came due before it, and the default skips by enabledAt', () => {
  const tournament = { tracked: { by: 'manual', at: 0, posts: { sets: true }, onAt: { sets: 1000 } } };
  assert.equal(postsOn('sets', tournament, 999), false);
  assert.equal(postsOn('sets', tournament, 1000), true);
  state.messages = { enabledAt: { sets: 500 } };
  assert.equal(postsOn('sets', null, 499), false);
});

test('next opponents and match calls start on server-wide', () => {
  state.messages = {};
  assert.equal(postsOn('next'), true);
  assert.equal(postsOn('calls'), true);
});

test('an untracked tournament posts nothing, and the kinds are in order', () => {
  assert.equal(posting({}, 'sets'), false);
  assert.deepEqual(TOURNAMENT_POSTS, ['sets', 'streams', 'calls', 'next', 'top8', 'registration']);
  assert.equal(MESSAGE_TYPES.next, 'Next opponents');
  assert.deepEqual(Object.keys(MESSAGE_TYPES).slice(0, 4), ['sets', 'streams', 'calls', 'next']);
});

test('tracking a tournament saves no switches', () => {
  const tournament = trackTournament({ id: 9 }, 'manual', 50);
  assert.deepEqual(tournament.tracked, { by: 'manual', at: 50, posts: {} });
});

test('old saved switches move to overrides only where a TO changed them, once', () => {
  state.tournaments = {
    1: { id: 1, tracked: { by: 'manual', at: 0, sets: true, stream: true, top8: true, reminders: true, calls: false } },
    2: { id: 2, tracked: { by: 'manual', at: 0, sets: false, stream: true, top8: true, reminders: false, calls: true } },
    3: { id: 3, tracked: { by: 'admin', at: 0, sets: true, stream: true, top8: true, reminders: true } },
  };
  migrateTournamentPosts();
  assert.deepEqual(state.tournaments[1].tracked, { by: 'manual', at: 0, posts: {} });
  assert.deepEqual(state.tournaments[2].tracked.posts, { sets: false, registration: false, calls: true });
  assert.deepEqual(state.tournaments[3].tracked.posts, {});
  // a TO's sets:on made after the move survives the next startup
  state.tournaments[1].tracked.posts.sets = true;
  migrateTracking();
  assert.deepEqual(state.tournaments[1].tracked.posts, { sets: true });
});

// every existing post goes by the resolver
const { mockApi, crewPlayer, event } = await import('./fixtures.js');
const tracker = await import('../src/tracker.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const clock = () => Math.floor(Date.now() / 1000);
const local = { name: 'Weekly', slug: 'tournament/weekly' };
const live = (now, posts = {}) => ({
  7: {
    id: 7, name: 'Weekly', slug: 'tournament/weekly', startAt: now - 3600, endAt: now + 3600, entries: [], userIds: [],
    events: [{ id: 70, name: 'Singles', slug: 'tournament/weekly/event/singles', state: 'ACTIVE' }],
    tracked: { by: 'manual', at: now - 3600, posts }, lastCheck: now - 120,
  },
});
const setIn = (id, state, now) => ({
  id, state, completedAt: state === 3 ? now - 5 : null, updatedAt: now - 3600, winnerId: state === 3 ? 10 : null, fullRoundText: 'Winners round 1',
  stream: state === 3 ? null : { streamName: 'example', streamSource: 'TWITCH' },
  event: { ...event, tournament: local },
  slots: [10, 99].map((entrant, i) => ({
    entrant: { id: entrant, name: i ? 'Opponent' : 'Active', initialSeedNum: i + 1, participants: [{ player: { id: entrant } }] },
    standing: { stats: { score: { value: state === 3 ? (i ? 1 : 2) : null } } },
  })),
});
const collect = () => {
  const sent = [];
  return { sent, channel: { send: async (payload) => sent.push(payload) } };
};

test('server streams turned on mid-set announces a set already on stream', async () => {
  const now = clock();
  state.messages = { streams: true, enabledAt: { streams: now } };
  state.players = {};
  state.streamed = [];
  state.tournaments = live(now);
  mockApi(({ query }) => (query.includes('streamQueue')
    ? { tournament: { streamQueue: [{ stream: { streamName: 'example', streamSource: 'TWITCH' }, sets: [setIn('s1', 2, now)] }] } }
    : { p10: { sets: { nodes: [] } } }));
  const { sent, channel } = collect();
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].data.title, /Stream alert/);
});

test('a tracked tournament with sets off posts nothing from it, even for /track posts players', async () => {
  const now = clock();
  state.messages = {};
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120 } };
  state.dqs = [];
  const run = async (posts) => {
    state.posted = [];
    state.tournaments = live(now, posts);
    mockApi(({ query }) => (query.includes('event(id:')
      ? { e70: { sets: { pageInfo: { totalPages: 1 }, nodes: [setIn('f1', 3, now)] } } }
      : { p10: { sets: { nodes: [setIn('f1', 3, now)] } } }));
    const { sent, channel } = collect();
    await tracker.postNewSets(channel);
    return sent.length;
  };
  assert.equal(await run({}), 1);
  assert.equal(await run({ sets: false }), 0);
});

test('a tracked tournament posts every called set by default', async () => {
  const now = clock();
  state.messages = {};
  state.players = {};
  state.callPings = [];
  state.called = [];
  state.callPosts = [];
  state.tournaments = live(now);
  mockApi(({ query }) => {
    if (query.includes('event(id:')) return { e70: { sets: { pageInfo: { totalPages: 1 }, nodes: [{ ...setIn('c1', 6, now), updatedAt: now - 60 }] } } };
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  const { sent, channel } = collect();
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].data.title, /Match call/);
});

test('registration off for a tournament stops its 1-hour DMs too', async () => {
  const now = clock();
  state.messages = {};
  state.regDmPings = ['fan'];
  state.startDmPings = [];
  state.accounts = {};
  state.tournaments = {
    7: { ...live(now)[7], startAt: now + 86400, endAt: now + 90000, reminder: { deadline: now + 1800, next: 4 } },
  };
  state.tournaments[7].tracked.posts = { registration: false };
  const registration = { tournament: { id: 7, name: 'Weekly', slug: 'tournament/weekly', startAt: now + 86400, endAt: now + 90000,
    registrationClosesAt: now + 1800, isRegistrationOpen: true, images: [], numAttendees: 0, events: [] } };
  let asked = 0;
  mockApi(({ query }) => {
    if (query.includes('participants(')) return { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    asked++;
    return registration;
  });
  let dmsSent = 0;
  const channel = {
    send: async () => ({}),
    client: { users: { fetch: async () => ({ send: async () => { dmsSent++; return {}; } }) } },
    guild: { members: { fetch: async ({ user: ids }) => new Map(ids.map((id) => [id, {}])) } },
  };
  await tracker.postDmReminders(channel);
  assert.equal(asked, 0);
  assert.equal(dmsSent, 0);

  // on again, the same tournament asks start.gg and the DM goes
  state.tournaments[7].tracked.posts = { registration: true };
  await tracker.postDmReminders(channel);
  assert.equal(dmsSent, 1);
});

// the TO commands
const { handleCommand } = await import('../src/commands/index.js');
const said = (calls) => calls.findLast(([kind]) => kind !== 'defer')[1].content;
const to = 'to-discord';
async function run(commandName, user, { group = null, subcommand = null, values = {} } = {}) {
  const calls = [];
  const interaction = {
    calls, commandName, user: { id: user }, member: { id: user, roles: { cache: new Map() } },
    guild: { id: 'guild' }, memberPermissions: { has: () => true },
    options: {
      getSubcommandGroup: () => group, getSubcommand: () => subcommand,
      getString: (name) => values[name] ?? null, getBoolean: (name) => values[name] ?? null,
    },
    reply: async (result) => calls.push(['reply', result]),
    deferReply: async () => calls.push(['defer']),
    editReply: async (result) => calls.push(['edit', result]),
    followUp: async (result) => calls.push(['followUp', result]),
  };
  await handleCommand(interaction);
  return calls;
}
const now = clock();
const trackedLocal = () => {
  state.toRole = { id: null, members: [], seeded: false };
  state.tournaments = {
    7: { id: 7, name: 'Local', slug: 'tournament/local', startAt: now + 3600, endAt: now + 7200, entries: [], userIds: [], tracked: { by: 'manual', at: now - 60, posts: {} }, reminder: {} },
  };
};

test('/t-o tournament posts saves an override, and default drops it', async () => {
  trackedLocal();
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', streams: 'off' } });
  assert.deepEqual(state.tournaments[7].tracked.posts, { streams: false });
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', streams: 'default' } });
  assert.deepEqual(state.tournaments[7].tracked.posts, {});
});

test('/t-o tournament posts with nothing picked marks the kinds following the server', async () => {
  trackedLocal();
  state.tournaments[7].tracked.posts = { calls: false };
  const content = said(await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local' } }));
  assert.match(content, /\*\*Match calls:\*\* off(?! \(default\))/);
  assert.match(content, /\*\*Stream alerts:\*\* on \(default\)/);
  assert.match(content, /default follows \/t-o settings/);
  state.messages = { next: false };
  assert.match(said(await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local' } })), /\*\*Next opponents:\*\* off \(default\)/);
});

test('turning sets on for one tournament starts from now, through either level', async () => {
  trackedLocal();
  state.messages = { sets: false };
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', sets: 'on' } });
  assert.ok(state.tournaments[7].tracked.onAt.sets >= now);
  assert.ok(state.tournaments[7].lastCheck >= now);
  // back to the server's off, then the server turns it on: default is off to on too
  state.messages = { sets: true };
  state.tournaments[7].tracked.posts = { sets: false };
  delete state.tournaments[7].tracked.onAt;
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', sets: 'default' } });
  assert.deepEqual(state.tournaments[7].tracked.posts, {});
  assert.ok(state.tournaments[7].tracked.onAt.sets >= now);
});

test('/t-o tournament add registration:off saves an override, and leaving it out saves none', async () => {
  trackedLocal();
  state.tournaments = {};
  state.messages = { registration: false };
  const registration = (id, slug, name) => ({ id, name, slug: `tournament/${slug}`, startAt: now + 86400, endAt: now + 90000, registrationClosesAt: now + 3600,
    isRegistrationOpen: true, numAttendees: 0, images: [], events: [] });
  mockApi(({ variables }) => ({ tournament: variables.slug === 'local' ? registration(7, 'local', 'Local') : variables.slug === 'weekly' ? registration(8, 'weekly', 'Weekly') : null }));
  await run('t-o', to, { group: 'tournament', subcommand: 'add', values: { tournament: 'local', registration: 'off' } });
  assert.deepEqual(state.tournaments[7].tracked.posts, { registration: false });
  await run('t-o', to, { group: 'tournament', subcommand: 'add', values: { tournament: 'weekly' } });
  assert.deepEqual(state.tournaments[8].tracked.posts, {});
  state.tournaments = {};
  await run('t-o', to, { group: 'tournament', subcommand: 'add', values: { tournament: 'local', registration: 'on' } });
  assert.deepEqual(state.tournaments[7].tracked.posts, { registration: true });
  assert.ok(state.tournaments[7].tracked.onAt.registration >= now);
});

test('/t-o settings says its switches are the default for every tournament', async () => {
  const { commands } = await import('../src/commands/definitions.js');
  const settings = commands.find((command) => command.name === 't-o').options.find((option) => option.name === 'settings');
  const describe = (name) => settings.options.find((option) => option.name === name).description;
  assert.equal(describe('streams'), 'Stream alerts on or off, the default for every tournament');
  assert.equal(describe('slippi'), 'Slippi rank changes and season wrap-ups on or off');
  const posts = commands.find((command) => command.name === 't-o').options.find((option) => option.name === 'tournament').options.find((option) => option.name === 'posts');
  assert.deepEqual(posts.options.map((option) => option.name), ['tournament', 'sets', 'streams', 'calls', 'next', 'top8', 'registration', 'schedule']);
  assert.deepEqual(posts.options[1].choices.map((choice) => choice.value), ['on', 'off', 'default']);
});

test('registration going off to on through posts clears the reminder progress', async () => {
  trackedLocal();
  state.messages = { registration: false };
  state.tournaments[7].reminder = { deadline: now + 3600, next: 2 };
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', registration: 'on' } });
  assert.equal(state.tournaments[7].reminder.next, undefined);
  assert.ok(state.tournaments[7].tracked.onAt.registration >= now);
  // already on stays as it was
  state.tournaments[7].reminder.next = 3;
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', registration: 'on' } });
  assert.equal(state.tournaments[7].reminder.next, 3);
});

test('an override on for a kind already on gets onAt from the server, or 0', async () => {
  trackedLocal();
  state.messages = {};
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', streams: 'on' } });
  assert.equal(state.tournaments[7].tracked.onAt.streams, 0);
  trackedLocal();
  state.messages = { enabledAt: { calls: 500 } };
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', calls: 'on' } });
  assert.equal(state.tournaments[7].tracked.onAt.calls, 500);
});
