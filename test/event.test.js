import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-event-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands/index.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
const soon = {
  id: 6, name: 'Soon', slug: 'tournament/soon', startAt: now + 86400, endAt: now + 90000,
  registrationClosesAt: now + 82800, isRegistrationOpen: true, numAttendees: 2,
  city: 'Buffalo', addrState: 'NY', isOnline: false, images: [], events: [{ name: 'Ultimate Singles', slug: 'tournament/soon/event/singles' }],
};
const live = { ...soon, id: 5, name: 'Local', slug: 'tournament/local', startAt: now - 3600, endAt: now + 3600 };
const notimed = { ...soon, id: 7, name: 'Timeless', slug: 'tournament/timeless', startAt: null, endAt: null };

let lastFetch = 0;
globalThis.fetch = async (_url, options) => {
  lastFetch = Date.now();
  const { query, variables } = JSON.parse(options.body);
  if (query.includes('registrationClosesAt')) {
    const tournament = variables.slug === 'live' ? live : variables.slug === 'notimed' ? notimed : soon;
    return { ok: true, json: async () => ({ data: { tournament } }) };
  }
  // the background checks a track kicks off: nobody tracked, an empty crew, and nothing to post yet
  if (query.includes('tournaments(query:')) {
    return { ok: true, json: async () => ({ data: Object.fromEntries([...query.matchAll(/\bu(\d+): user/g)].map(([, id]) => [`u${id}`, { tournaments: { nodes: [] } }])) }) };
  }
  if (query.includes('tournament(id: $id)')) {
    return { ok: true, json: async () => ({ data: { tournament: { ...soon, events: [] } } }) };
  }
  // verifiedCaller and findAccount check the discord connected on start.gg live
  if (query.includes('user(id:')) {
    const data = {};
    for (const match of query.matchAll(/\bu(\d+): user/g)) {
      const id = match[1];
      data[`u${id}`] = id === '9'
        ? { slug: 'user/to', player: { gamerTag: 'To' }, images: [], authorizations: [{ externalId: 'to-discord' }] }
        : null;
    }
    return { ok: true, json: async () => ({ data }) };
  }
  if (query.includes('participants(')) {
    return { ok: true, json: async () => ({ data: { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [] } } } }) };
  }
  throw new Error(`no fake for ${query.slice(0, 80)}`);
};

// manager is Manage Server. events controls the fake guild scheduled events
function interaction(values, { user = 'crew-discord', manager = true, events = null, guildId = 'guild-1', subcommand = 'event' } = {}) {
  const calls = [];
  const created = [];
  const store = events ?? new Map();
  return {
    calls, created,
    commandName: 'tournament',
    user: { id: user, bot: false, displayName: 'Crew' },
    guild: {
      id: guildId,
      scheduledEvents: {
        fetch: async () => store,
        create: async (options) => {
          const event = { id: `event-${created.length + 1}`, url: `https://discord.com/events/${guildId}/event-${created.length + 1}`, ...options };
          created.push(event);
          store.set(event.id, event);
          return event;
        },
      },
    },
    memberPermissions: { has: () => manager },
    options: { getSubcommandGroup: () => null, getSubcommand: () => subcommand, getString: (name) => values[name] ?? null },
    reply: async (result) => calls.push(['reply', result]),
    deferReply: async () => calls.push(['defer']),
    editReply: async (result) => calls.push(['edit', result]),
    followUp: async (result) => calls.push(['followUp', result]),
  };
}

function reset() {
  state.players = {};
  state.links = {};
  state.regAdmins = {};
  state.tournaments = {};
}

test('a manager makes a discord event from a start.gg link', async () => {
  reset();
  const run = interaction({ tournament: 'start.gg/tournament/soon' });
  await handleCommand(run);
  assert.equal(run.created.length, 1);
  const [event] = run.created;
  assert.equal(event.name, 'Soon');
  assert.deepEqual(event.scheduledStartTime, new Date(soon.startAt * 1000));
  assert.deepEqual(event.scheduledEndTime, new Date(soon.endAt * 1000));
  assert.equal(event.entityType, 3);
  assert.equal(event.privacyLevel, 2);
  assert.equal(event.entityMetadata.location, 'Buffalo, NY');
  assert.match(event.description, /https:\/\/www\.start\.gg\/tournament\/soon/);
  const [, reply] = run.calls.find(([kind]) => kind === 'edit');
  assert.match(reply.content, /Made a Discord event for Soon/);
  assert.match(reply.content, /https:\/\/discord\.com\/events\/guild-1\/event-1/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test('a tournament admin without manage server can make one too', async () => {
  reset();
  state.links = { 'to-discord': { userId: '9', slug: 'user/to', tag: 'To' } };
  state.regAdmins = { 9: { userId: '9', slug: 'user/to', tag: 'To' } };
  const run = interaction({ tournament: 'start.gg/tournament/soon' }, { user: 'to-discord', manager: false });
  await handleCommand(run);
  assert.equal(run.created.length, 1);
  const [, reply] = run.calls.find(([kind]) => kind === 'edit');
  assert.match(reply.content, /Made a Discord event for Soon/);
});

test('anyone else gets told only admins can', async () => {
  reset();
  const run = interaction({ tournament: 'start.gg/tournament/soon' }, { user: 'stranger-discord', manager: false });
  await handleCommand(run);
  assert.equal(run.created.length, 0);
  const [, reply] = run.calls.find(([kind]) => kind === 'edit');
  assert.match(reply.content, /Only tournament admins/);
});

test('a tournament that already has an event links it instead of making another', async () => {
  reset();
  const existing = new Map([['event-9', { id: 'event-9', url: 'https://discord.com/events/guild-1/event-9', description: 'Soon on start.gg\nhttps://www.start.gg/tournament/soon' }]]);
  const run = interaction({ tournament: 'start.gg/tournament/soon' }, { events: existing });
  await handleCommand(run);
  assert.equal(run.created.length, 0);
  const [, reply] = run.calls.find(([kind]) => kind === 'edit');
  assert.match(reply.content, /already has a Discord event/);
});

test('an already started tournament and one with no start time say so', async () => {
  reset();
  const started = interaction({ tournament: 'start.gg/tournament/live' });
  await handleCommand(started);
  assert.equal(started.created.length, 0);
  assert.match(started.calls.find(([kind]) => kind === 'edit')[1].content, /already started/);

  const missing = interaction({ tournament: 'start.gg/tournament/notimed' });
  await handleCommand(missing);
  assert.equal(missing.created.length, 0);
  assert.match(missing.calls.find(([kind]) => kind === 'edit')[1].content, /no start time/);
});

test('missing manage events permission says so instead of throwing', async () => {
  reset();
  const run = interaction({ tournament: 'start.gg/tournament/soon' });
  run.guild.scheduledEvents.create = async () => {
    const err = new Error('Missing Permissions');
    err.code = 50013;
    throw err;
  };
  await handleCommand(run);
  const [, reply] = run.calls.find(([kind]) => kind === 'edit');
  assert.match(reply.content, /Manage Events/);
});

test('making an event tracks the tournament too', async () => {
  reset();
  const run = interaction({ tournament: 'start.gg/tournament/soon' });
  await handleCommand(run);
  const tournament = state.tournaments[6];
  assert.ok(tournament.tracked);
  assert.equal(tournament.tracked.reminders, true);
  assert.equal(tournament.reminder.next, 3);
  assert.equal(tournament.reminder.deadline, soon.registrationClosesAt);
  assert.equal(tournament.discordEventId, 'event-1');
  const [, reply] = run.calls.find(([kind]) => kind === 'edit');
  assert.match(reply.content, /Tracking Soon/);
  assert.match(reply.content, /Made a Discord event for Soon/);
});

test('an event for an already tracked tournament keeps its switches', async () => {
  reset();
  const lastCheck = now - 100;
  state.tournaments = {
    6: {
      ...soon, entries: [], userIds: [], lastCheck,
      tracked: { by: 'manual', at: lastCheck, sets: true, stream: true, top8: true, reminders: false },
    },
  };
  const run = interaction({ tournament: 'start.gg/tournament/soon' });
  await handleCommand(run);
  const tournament = state.tournaments[6];
  assert.equal(tournament.tracked.reminders, false);
  assert.equal(tournament.lastCheck, lastCheck);
  const [, reply] = run.calls.find(([kind]) => kind === 'edit');
  assert.match(reply.content, /Already tracking Soon/);
  assert.match(reply.content, /Made a Discord event for Soon/);
});

test('adding with add_event makes the event, without it does not', async () => {
  reset();
  const plain = interaction({ tournament: 'start.gg/tournament/soon' }, { subcommand: 'add' });
  await handleCommand(plain);
  assert.equal(plain.created.length, 0);
  assert.ok(state.tournaments[6].tracked);
  assert.match(plain.calls.find(([kind]) => kind === 'edit')[1].content, /Tracking Soon/);

  reset();
  const flagged = interaction({ tournament: 'start.gg/tournament/soon', add_event: 'on' }, { subcommand: 'add' });
  await handleCommand(flagged);
  assert.equal(flagged.created.length, 1);
  assert.ok(state.tournaments[6].tracked);
  assert.equal(state.tournaments[6].discordEventId, 'event-1');
  const [, reply] = flagged.calls.find(([kind]) => kind === 'edit');
  assert.match(reply.content, /Tracking Soon/);
  assert.match(reply.content, /Made a Discord event for Soon/);
});

test('event then add_event lands on the same tracked tournament and event', async () => {
  reset();
  const store = new Map();
  const first = interaction({ tournament: 'start.gg/tournament/soon' }, { events: store });
  await handleCommand(first);
  assert.equal(first.created.length, 1);
  const second = interaction({ tournament: 'start.gg/tournament/soon', add_event: 'on' }, { subcommand: 'add', events: store });
  await handleCommand(second);
  assert.equal(second.created.length, 0);
  const [, reply] = second.calls.find(([kind]) => kind === 'edit');
  assert.match(reply.content, /Already tracking Soon/);
  assert.match(reply.content, /already has a Discord event/);
  assert.deepEqual(Object.keys(state.tournaments), ['6']);
  assert.equal(state.tournaments[6].discordEventId, first.created[0].id);
});

// the track kicks background checks off, let them finish while the fake is still in place
test('background checks settle', async () => {
  while (startgg.queueLength() || Date.now() - lastFetch < 500) await new Promise((resolve) => setTimeout(resolve, 200));
});
