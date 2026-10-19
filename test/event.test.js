import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-event-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands/index.js');
const tracker = await import('../src/tracker.js');
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
// what got asked, by the kind of lookup
const asked = [];
globalThis.fetch = async (_url, options) => {
  lastFetch = Date.now();
  const { query, variables } = JSON.parse(options.body);
  if (query.includes('registrationClosesAt')) {
    asked.push('registration');
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
  // the admin check reads the discord connected on each admin's start.gg live
  if (query.includes('user(id:')) {
    asked.push('profiles');
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

// a server whose scheduled events live in store. allowed is whether the bot has Manage Events
function fakeGuild({ events = null, guildId = 'guild-1', allowed = true } = {}) {
  const created = [];
  const store = events ?? new Map();
  const guild = {
    id: guildId,
    members: { me: { permissions: { has: () => allowed } } },
    scheduledEvents: {
      fetch: async () => store,
      create: async (options) => {
        const event = { id: `event-${created.length + 1}`, url: `https://discord.com/events/${guildId}/event-${created.length + 1}`, ...options };
        created.push(event);
        store.set(event.id, event);
        return event;
      },
    },
  };
  return { guild, created };
}

// manager is Manage Server. /discord_event by default, or a /tournament subcommand
function interaction(values, { user = 'crew-discord', manager = true, events = null, command = 'discord_event', subcommand = null } = {}) {
  const calls = [];
  const { guild, created } = fakeGuild({ events });
  const run = {
    calls, created,
    commandName: command,
    user: { id: user, bot: false, displayName: 'Crew' },
    guild,
    memberPermissions: { has: () => manager },
    options: { getSubcommandGroup: () => null, getSubcommand: () => subcommand, getString: (name) => values[name] ?? null },
    reply: async (result) => calls.push(['reply', result]),
    deferReply: async () => { run.deferred = true; calls.push(['defer']); },
    editReply: async (result) => calls.push(['edit', result]),
    deleteReply: async () => calls.push(['delete']),
    followUp: async (result) => calls.push(['followUp', result]),
  };
  return run;
}

const edited = (run) => run.calls.find(([kind]) => kind === 'edit')?.[1];

// tracking kicks background checks off. waiting them out keeps their requests out of the next test's count
async function settle() {
  while (startgg.queueLength() || Date.now() - lastFetch < 300) await new Promise((resolve) => setTimeout(resolve, 50));
}

async function reset() {
  await settle();
  state.players = {};
  state.links = {};
  state.regAdmins = {};
  state.tournaments = {};
  state.messages = {};
  asked.length = 0;
}

test('a manager makes a discord event from a start.gg link', async () => {
  await reset();
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
  assert.ok(event.description.split('\n').includes('https://www.start.gg/tournament/soon'));
  // written out, since an event description may not show discord timestamps
  assert.match(event.description, /Registration closes \w{3}, \w{3} \d+, \d+:\d{2} [AP]M/);
  assert.doesNotMatch(event.description, /<t:/);
  assert.match(event.description, /Events: Ultimate Singles/);
  const reply = edited(run);
  assert.match(reply.content, /Made a Discord event for Soon/);
  assert.match(reply.content, /https:\/\/discord\.com\/events\/guild-1\/event-1/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test('a tournament admin without manage server can make one too', async () => {
  await reset();
  state.regAdmins = { 9: { userId: '9', slug: 'user/to', tag: 'To' } };
  const run = interaction({ tournament: 'start.gg/tournament/soon' }, { user: 'to-discord', manager: false });
  await handleCommand(run);
  assert.equal(run.created.length, 1);
  assert.match(edited(run).content, /Made a Discord event for Soon/);
  // one lookup for the admins' discord, nothing else about the caller
  assert.deepEqual(asked.filter((kind) => kind === 'profiles'), ['profiles']);
});

test('anyone else is told privately, with no lookup when there are no admins', async () => {
  await reset();
  const lone = interaction({ tournament: 'start.gg/tournament/soon' }, { user: 'stranger-discord', manager: false });
  await handleCommand(lone);
  assert.equal(lone.created.length, 0);
  assert.deepEqual(asked, []);
  const [[kind, reply]] = lone.calls;
  assert.equal(kind, 'reply');
  assert.match(reply.content, /Only tournament admins/);
  assert.equal(reply.flags, MessageFlags.Ephemeral);

  // with admins to check, the thinking reply goes and the answer is still private
  state.regAdmins = { 9: { userId: '9', slug: 'user/to', tag: 'To' } };
  const checked = interaction({ tournament: 'start.gg/tournament/soon' }, { user: 'stranger-discord', manager: false });
  await handleCommand(checked);
  assert.equal(checked.created.length, 0);
  assert.ok(!asked.includes('registration'));
  assert.deepEqual(checked.calls.map(([each]) => each), ['defer', 'delete', 'followUp']);
  assert.match(checked.calls[2][1].content, /Only tournament admins/);
  assert.equal(checked.calls[2][1].flags, MessageFlags.Ephemeral);
});

test('a tournament that already has an event links it instead of making another', async () => {
  await reset();
  const existing = new Map([['event-9', { id: 'event-9', url: 'https://discord.com/events/guild-1/event-9', description: 'Soon on start.gg\nhttps://www.start.gg/tournament/soon' }]]);
  const run = interaction({ tournament: 'start.gg/tournament/soon' }, { events: existing });
  await handleCommand(run);
  assert.equal(run.created.length, 0);
  assert.match(edited(run).content, /already has a Discord event/);
  // nothing tracked to save the id on, the link in its description finds it next time
  assert.deepEqual(state.tournaments, {});
});

test('an event for a tournament whose link starts the same is not the same event', async () => {
  await reset();
  const other = new Map([['event-9', { id: 'event-9', description: 'Soon 2 on start.gg\nhttps://www.start.gg/tournament/soon-2' }]]);
  const run = interaction({ tournament: 'start.gg/tournament/soon' }, { events: other });
  await handleCommand(run);
  assert.equal(run.created.length, 1);
  assert.match(edited(run).content, /Made a Discord event for Soon/);
});

test('an already started tournament and one with no start time say so', async () => {
  await reset();
  const started = interaction({ tournament: 'start.gg/tournament/live' });
  await handleCommand(started);
  assert.equal(started.created.length, 0);
  assert.match(edited(started).content, /already started/);

  const missing = interaction({ tournament: 'start.gg/tournament/notimed' });
  await handleCommand(missing);
  assert.equal(missing.created.length, 0);
  assert.match(edited(missing).content, /no start time/);
});

test('missing manage events permission says so instead of throwing', async () => {
  await reset();
  const run = interaction({ tournament: 'start.gg/tournament/soon' });
  run.guild.scheduledEvents.create = async () => {
    const err = new Error('Missing Permissions');
    err.code = 50013;
    throw err;
  };
  await handleCommand(run);
  assert.match(edited(run).content, /Manage Events/);
});

test('making an event leaves tracking to /tournament add', async () => {
  await reset();
  const run = interaction({ tournament: 'start.gg/tournament/soon' });
  await handleCommand(run);
  assert.equal(run.created.length, 1);
  assert.deepEqual(state.tournaments, {});
  const reply = edited(run);
  assert.match(reply.content, /^Made a Discord event for Soon/);
  assert.doesNotMatch(reply.content, /Tracking/);
});

test('an event for an already tracked tournament keeps its switches and saves the event', async () => {
  await reset();
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
  assert.equal(tournament.discordEventId, 'event-1');
  assert.match(edited(run).content, /^Made a Discord event for Soon/);
});

test('adding with add_event makes the event, without it does not', async () => {
  await reset();
  const plain = interaction({ tournament: 'start.gg/tournament/soon' }, { command: 'tournament', subcommand: 'add' });
  await handleCommand(plain);
  assert.equal(plain.created.length, 0);
  assert.ok(state.tournaments[6].tracked);
  assert.match(edited(plain).content, /Tracking Soon/);

  await reset();
  const flagged = interaction({ tournament: 'start.gg/tournament/soon', add_event: 'on' }, { command: 'tournament', subcommand: 'add' });
  await handleCommand(flagged);
  assert.equal(flagged.created.length, 1);
  assert.ok(state.tournaments[6].tracked);
  assert.equal(state.tournaments[6].discordEventId, 'event-1');
  const reply = edited(flagged);
  assert.match(reply.content, /Tracking Soon/);
  assert.match(reply.content, /Made a Discord event for Soon/);
});

test('discord_event then add_event lands on the same event, and only the add tracks', async () => {
  await reset();
  const store = new Map();
  const first = interaction({ tournament: 'start.gg/tournament/soon' }, { events: store });
  await handleCommand(first);
  assert.equal(first.created.length, 1);
  assert.deepEqual(state.tournaments, {});
  const second = interaction({ tournament: 'start.gg/tournament/soon', add_event: 'on' }, { command: 'tournament', subcommand: 'add', events: store });
  await handleCommand(second);
  assert.equal(second.created.length, 0);
  const reply = edited(second);
  assert.match(reply.content, /Tracking Soon/);
  assert.match(reply.content, /already has a Discord event/);
  assert.deepEqual(Object.keys(state.tournaments), ['6']);
  assert.equal(state.tournaments[6].discordEventId, first.created[0].id);
});

// /messages events, for tournaments the reg admin list tracks
function adminTournaments() {
  const tracked = (by) => ({ by, at: now, sets: true, stream: true, top8: true, reminders: true });
  return {
    6: { ...soon, entries: [], userIds: [], tracked: tracked('admin'), reminder: {} },
    10: { ...soon, id: 10, slug: 'tournament/manual', entries: [], userIds: [], tracked: tracked('manual'), reminder: {} },
    11: { ...soon, id: 11, slug: 'tournament/has-one', entries: [], userIds: [], tracked: tracked('admin'), reminder: {}, discordEventId: 'event-old' },
    12: { ...live, id: 12, slug: 'tournament/started', entries: [], userIds: [], tracked: tracked('admin'), reminder: {} },
    13: { ...soon, id: 13, slug: 'tournament/untracked', entries: [], userIds: [] },
  };
}

test('with /messages events off, admin tournaments get no events and nothing is asked', async () => {
  await reset();
  state.tournaments = adminTournaments();
  const { guild, created } = fakeGuild();
  await tracker.makeAdminEvents(guild);
  assert.equal(created.length, 0);
  assert.deepEqual(asked, []);
});

test('with /messages events on, each upcoming admin tournament gets one event, once', async () => {
  await reset();
  state.messages = { events: true };
  state.tournaments = adminTournaments();
  const { guild, created } = fakeGuild();
  await tracker.makeAdminEvents(guild);
  assert.deepEqual(created.map((event) => event.name), ['Soon']);
  assert.equal(state.tournaments[6].discordEventId, 'event-1');
  // tracked by hand, already has one, already started or not tracked: none of those
  assert.equal(state.tournaments[10].discordEventId, undefined);
  assert.equal(state.tournaments[11].discordEventId, 'event-old');
  assert.equal(state.tournaments[12].discordEventId, undefined);
  assert.equal(state.tournaments[13].discordEventId, undefined);

  // a mod deleting it doesn't bring it back, the saved id says it was made
  await tracker.makeAdminEvents(fakeGuild().guild);
  assert.equal(created.length, 1);
  assert.deepEqual(asked, ['registration']);
});

test('without Manage Events, automatic events ask start.gg nothing', async () => {
  await reset();
  state.messages = { events: true };
  state.tournaments = adminTournaments();
  const { guild, created } = fakeGuild({ allowed: false });
  await tracker.makeAdminEvents(guild);
  assert.equal(created.length, 0);
  assert.deepEqual(asked, []);
  state.messages = {};
});

// let the last ones finish while the fake is still in place
test('background checks settle', settle);
