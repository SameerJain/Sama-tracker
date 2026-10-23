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
const { ensureDiscordEvent, syncDiscordEvents } = await import('../src/discord-events.js');
const embeds = await import('../src/embeds/index.js');
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
// cover photos downloaded straight from their urls, not through the start.gg api
const downloaded = [];
// what start.gg has for a tournament looked up by id, for the sync. one left out is soon under that id, and null
// means it was deleted
let byId = {};
globalThis.fetch = async (_url, options) => {
  lastFetch = Date.now();
  if (typeof _url === 'string' && !_url.includes('api.start.gg')) {
    downloaded.push(_url);
    if (_url.includes('gone.jpg')) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  }
  const { query, variables } = JSON.parse(options.body);
  if (query.includes('registrationClosesAt') && variables.id !== undefined) {
    asked.push(`registration ${variables.id}`);
    const tournament = Object.hasOwn(byId, variables.id) ? byId[variables.id] : { ...soon, id: Number(variables.id) };
    return { ok: true, json: async () => ({ data: { tournament } }) };
  }
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

// a server whose scheduled events live in store. allowed is whether the bot has Manage Events. roles is the
// server's roles, edited what the sync changed
function fakeGuild({ events = null, guildId = 'guild-1', allowed = true, roles = new Map() } = {}) {
  const created = [];
  const edited = [];
  const store = events ?? new Map();
  const guild = {
    id: guildId,
    roles: { cache: Object.assign(roles, { find: (fn) => [...roles.values()].find(fn) }) },
    members: { me: { permissions: { has: () => allowed } } },
    scheduledEvents: {
      fetch: async () => store,
      create: async (options) => {
        const event = { id: `event-${created.length + 1}`, url: `https://discord.com/events/${guildId}/event-${created.length + 1}`, status: 1, ...options };
        created.push(event);
        store.set(event.id, event);
        return event;
      },
      edit: async (event, options) => {
        edited.push([event.id, options]);
        Object.assign(event, options);
        return event;
      },
    },
  };
  return { guild, created, edited };
}

// the TO role, for a server that has one
const TO_ROLE = { id: 'to-role', name: 'TO' };

// manager is Manage Server, and to whether they have the TO role, which only counts once the server has one.
// /t-o tournament event by default, or another /t-o tournament subcommand
function interaction(values, { user = 'crew-discord', manager = true, to = null, events = null, command = 't-o', group = 'tournament', subcommand = 'event' } = {}) {
  const calls = [];
  const { guild, created } = fakeGuild({ events, roles: new Map(to === null ? [] : [[TO_ROLE.id, TO_ROLE]]) });
  const run = {
    calls, created,
    commandName: command,
    user: { id: user, bot: false, displayName: 'Crew' },
    guild,
    member: { roles: { cache: new Set(to ? [TO_ROLE.id] : []) } },
    memberPermissions: { has: () => manager },
    options: { getSubcommandGroup: () => group, getSubcommand: () => subcommand, getString: (name) => values[name] ?? null },
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
  state.tournaments = {};
  state.discordEvents = {};
  state.toRole = { id: null, members: [], seeded: false };
  state.messages = {};
  byId = {};
  asked.length = 0;
  downloaded.length = 0;
}

test('with no TO role yet, a manager makes a discord event from a start.gg link', async () => {
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

test('once the server has a TO role, a TO without Manage Server makes one, and Manage Server alone is not enough', async () => {
  await reset();
  const run = interaction({ tournament: 'start.gg/tournament/soon' }, { user: 'to-discord', manager: false, to: true });
  await handleCommand(run);
  assert.equal(run.created.length, 1);
  assert.match(edited(run).content, /Made a Discord event for Soon/);
  // whoever used it with the role is remembered for /t-o role list
  assert.deepEqual(state.toRole.members, ['to-discord']);

  const manager = interaction({ tournament: 'start.gg/tournament/soon' }, { user: 'manager-discord', manager: true, to: false });
  await handleCommand(manager);
  assert.equal(manager.created.length, 0);
  assert.match(manager.calls[0][1].content, /^Only TOs can make Discord events/);
});

test('anyone else is told privately, with no lookup', async () => {
  await reset();
  const lone = interaction({ tournament: 'start.gg/tournament/soon' }, { user: 'stranger-discord', manager: false });
  await handleCommand(lone);
  assert.equal(lone.created.length, 0);
  assert.deepEqual(asked, []);
  const [[kind, reply]] = lone.calls;
  assert.equal(kind, 'reply');
  assert.match(reply.content, /^Only TOs can make Discord events\. `\/t-o role list` shows who they are\.$/);
  assert.equal(reply.flags, MessageFlags.Ephemeral);
});

test('a tournament that already has an event links it instead of making another', async () => {
  await reset();
  const existing = new Map([['event-9', { id: 'event-9', url: 'https://discord.com/events/guild-1/event-9', description: 'Soon on start.gg\nhttps://www.start.gg/tournament/soon' }]]);
  const run = interaction({ tournament: 'start.gg/tournament/soon' }, { events: existing });
  await handleCommand(run);
  assert.equal(run.created.length, 0);
  assert.match(edited(run).content, /already has a Discord event/);
  // not tracked, but saved by tournament id so the sync follows it, and found by link it gets start.gg's details then
  assert.deepEqual(state.tournaments, {});
  assert.deepEqual(state.discordEvents[6], { eventId: 'event-9', slug: 'tournament/soon', startAt: soon.startAt, synced: null });
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

test('making an event leaves tracking to /t-o tournament add', async () => {
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
  assert.equal(state.discordEvents[6].eventId, 'event-1');
  assert.match(edited(run).content, /^Made a Discord event for Soon/);
});

test('adding with add_event makes the event, without it does not', async () => {
  await reset();
  const plain = interaction({ tournament: 'start.gg/tournament/soon' }, { subcommand: 'add' });
  await handleCommand(plain);
  assert.equal(plain.created.length, 0);
  assert.ok(state.tournaments[6].tracked);
  assert.match(edited(plain).content, /Tracking Soon/);

  await reset();
  const flagged = interaction({ tournament: 'start.gg/tournament/soon', add_event: 'on' }, { subcommand: 'add' });
  await handleCommand(flagged);
  assert.equal(flagged.created.length, 1);
  assert.ok(state.tournaments[6].tracked);
  assert.equal(state.discordEvents[6].eventId, 'event-1');
  const reply = edited(flagged);
  assert.match(reply.content, /Tracking Soon/);
  assert.match(reply.content, /Made a Discord event for Soon/);
});

test('/t-o tournament event then add_event lands on the same event, and only the add tracks', async () => {
  await reset();
  const store = new Map();
  const first = interaction({ tournament: 'start.gg/tournament/soon' }, { events: store });
  await handleCommand(first);
  assert.equal(first.created.length, 1);
  assert.deepEqual(state.tournaments, {});
  const second = interaction({ tournament: 'start.gg/tournament/soon', add_event: 'on' }, { subcommand: 'add', events: store });
  await handleCommand(second);
  assert.equal(second.created.length, 0);
  const reply = edited(second);
  assert.match(reply.content, /Tracking Soon/);
  assert.match(reply.content, /already has a Discord event/);
  assert.deepEqual(Object.keys(state.tournaments), ['6']);
  assert.equal(state.discordEvents[6].eventId, first.created[0].id);
});

// /settings posts events, for tracked tournaments. 6 was tracked for a tournament admin before the TO role
function trackedTournaments() {
  const tracked = (by) => ({ by, at: now, sets: true, stream: true, top8: true, reminders: true });
  state.discordEvents = { 11: { eventId: 'event-old', slug: 'tournament/has-one', startAt: soon.startAt, synced: null } };
  return {
    6: { ...soon, entries: [], userIds: [], tracked: tracked('admin'), reminder: {} },
    10: { ...soon, id: 10, slug: 'tournament/manual', entries: [], userIds: [], tracked: tracked('manual'), reminder: {} },
    11: { ...soon, id: 11, slug: 'tournament/has-one', entries: [], userIds: [], tracked: tracked('manual'), reminder: {} },
    12: { ...live, id: 12, slug: 'tournament/started', entries: [], userIds: [], tracked: tracked('manual'), reminder: {} },
    13: { ...soon, id: 13, slug: 'tournament/untracked', entries: [], userIds: [] },
  };
}

test('with /settings posts events off, tracked tournaments get no events and nothing is asked', async () => {
  await reset();
  state.tournaments = trackedTournaments();
  const { guild, created } = fakeGuild();
  await tracker.makeTournamentEvents(guild);
  assert.equal(created.length, 0);
  assert.deepEqual(asked, []);
});

test('with /settings posts events on, each upcoming tracked tournament gets one event, once', async () => {
  await reset();
  state.messages = { events: true };
  state.tournaments = trackedTournaments();
  byId = { 10: { ...soon, id: 10, slug: 'tournament/manual' } };
  const { guild, created } = fakeGuild();
  await tracker.makeTournamentEvents(guild);
  assert.equal(created.length, 2);
  assert.equal(state.discordEvents[6].eventId, 'event-1');
  assert.equal(state.discordEvents[10].eventId, 'event-2');
  // already has one, already started or not tracked: none of those
  assert.equal(state.discordEvents[11].eventId, 'event-old');
  assert.equal(state.discordEvents[12], undefined);
  assert.equal(state.discordEvents[13], undefined);

  // a mod deleting them doesn't bring them back, the saved ids say they were made
  await tracker.makeTournamentEvents(fakeGuild().guild);
  assert.equal(created.length, 2);
  assert.deepEqual(asked, ['registration 6', 'registration 10']);
});

test('without Manage Events, automatic events ask start.gg nothing', async () => {
  await reset();
  state.messages = { events: true };
  state.tournaments = trackedTournaments();
  const { guild, created } = fakeGuild({ allowed: false });
  await tracker.makeTournamentEvents(guild);
  assert.equal(created.length, 0);
  assert.deepEqual(asked, []);
  state.messages = {};
});

test('an event shows the venue and its address when start.gg has them, and the city otherwise', async () => {
  await reset();
  const addressed = { ...soon, venueName: 'Gamers Lounge', venueAddress: '123 Main St, Buffalo, NY 14201, USA' };
  const { guild, created } = fakeGuild();
  await ensureDiscordEvent(addressed, guild);
  assert.equal(created[0].entityMetadata.location, 'Gamers Lounge, 123 Main St, Buffalo, NY 14201, USA');
  assert.ok(created[0].description.split('\n').includes('Gamers Lounge, 123 Main St, Buffalo, NY 14201, USA'));

  // the name left off when the address starts with it, and the address alone when both don't fit in discord's 100
  state.discordEvents = {};
  const long = { ...soon, id: 8, slug: 'tournament/long', venueName: 'V'.repeat(70), venueAddress: '123 Main St, Buffalo, NY 14201, USA' };
  await ensureDiscordEvent(long, guild);
  assert.equal(created[1].entityMetadata.location, '123 Main St, Buffalo, NY 14201, USA');
  const named = { ...soon, id: 9, slug: 'tournament/named', venueName: 'Main St Arcade', venueAddress: 'Main St Arcade, 5 Elm St, Buffalo, NY' };
  await ensureDiscordEvent(named, guild);
  assert.equal(created[2].entityMetadata.location, 'Main St Arcade, 5 Elm St, Buffalo, NY');
});

test('a made event lists the tournament\'s streams in its description', async () => {
  await reset();
  const { guild, created } = fakeGuild();
  const streamed = {
    ...soon, id: 30, slug: 'tournament/streamed',
    streams: [
      { streamName: 'buffalosmash', streamSource: 'TWITCH' },
      { streamName: 'https://youtube.com/@buffalosmash/live', streamSource: 'YOUTUBE' },
      { streamName: 'somestreamer', streamSource: 'YOUTUBE' },
    ],
  };
  await ensureDiscordEvent(streamed, guild);
  assert.ok(created[0].description.split('\n').includes('Streams: https://twitch.tv/buffalosmash, https://youtube.com/@buffalosmash/live, somestreamer (Youtube)'));

  // none on start.gg, so no line
  state.discordEvents = {};
  await ensureDiscordEvent({ ...soon, id: 31, slug: 'tournament/quiet', streams: [] }, guild);
  assert.doesNotMatch(created[1].description, /Streams:/);
});

test('a made event carries start.gg\'s banner as its cover, the logo when there\'s no banner, and none without either', async () => {
  await reset();
  const { guild, created } = fakeGuild();
  const bannered = {
    ...soon, id: 20, slug: 'tournament/bannered',
    images: [{ type: 'profile', url: 'https://images.example/logo.png' }, { type: 'banner', url: 'https://images.example/banner.png' }],
  };
  await ensureDiscordEvent(bannered, guild);
  assert.ok(Buffer.isBuffer(created[0].image));
  assert.deepEqual(downloaded, ['https://images.example/banner.png']);

  state.discordEvents = {};
  const logoless = { ...soon, id: 21, slug: 'tournament/logoless', images: [{ type: 'profile', url: 'https://images.example/logo.png' }] };
  await ensureDiscordEvent(logoless, guild);
  assert.ok(Buffer.isBuffer(created[1].image));
  assert.ok(downloaded.includes('https://images.example/logo.png'));

  state.discordEvents = {};
  const bare = { ...soon, id: 22, slug: 'tournament/bare', images: [] };
  await ensureDiscordEvent(bare, guild);
  assert.equal(created[2].image, undefined);
});

test('a cover that won\'t download leaves the event without one instead of failing', async () => {
  await reset();
  const { guild, created } = fakeGuild();
  const broken = { ...soon, id: 23, slug: 'tournament/broken', images: [{ type: 'banner', url: 'https://images.example/gone.jpg' }] };
  const result = await ensureDiscordEvent(broken, guild);
  assert.equal(created.length, 1);
  assert.equal(created[0].image, undefined);
  assert.match(result.url, /discord\.com\/events/);
});

test('the event runs to start.gg\'s end time, or the tuned length when it has none', async () => {
  await reset();
  const { guild, created } = fakeGuild();
  await ensureDiscordEvent(soon, guild);
  assert.deepEqual(created[0].scheduledEndTime, new Date(soon.endAt * 1000));

  // no end time: untuned servers get 5 hours, tuned ones get theirs
  const open = (id, slug, extra) => ({ ...soon, id, slug, endAt: null, ...extra });
  const ends = async (tournament) => {
    state.discordEvents = {};
    await ensureDiscordEvent(tournament, guild);
    return created.at(-1).scheduledEndTime;
  };
  state.messages = {};
  assert.deepEqual(await ends(open(24, 'tournament/open')), new Date((soon.startAt + 5 * 3600) * 1000));
  state.messages = { eventLength: 3 };
  assert.deepEqual(await ends(open(25, 'tournament/short', { numAttendees: 20 })), new Date((soon.startAt + 3 * 3600) * 1000));
  state.messages = { eventLength: 8 };
  assert.deepEqual(await ends(open(26, 'tournament/long', { numAttendees: 20 })), new Date((soon.startAt + 8 * 3600) * 1000));
});

test('a major or regional with no end time gets pushed to 12 hours, never pulled in', async () => {
  await reset();
  const { guild, created } = fakeGuild();
  const ends = async (tournament) => {
    state.discordEvents = {};
    await ensureDiscordEvent(tournament, guild);
    return created.at(-1).scheduledEndTime;
  };
  const regional = (id, slug, extra) => ({ ...soon, id, slug, endAt: null, ...extra });
  // tuned short, still pushed back. a hidden entrant list still counts by its brackets
  state.messages = { eventLength: 3 };
  assert.deepEqual(await ends(regional(30, 'tournament/regional', { numAttendees: 200 })), new Date((soon.startAt + 12 * 3600) * 1000));
  assert.deepEqual(await ends(regional(31, 'tournament/five-events', { numAttendees: null, events: [{}, {}, {}, {}, {}] })), new Date((soon.startAt + 12 * 3600) * 1000));
  // tuned long, a small weekly keeps it instead of dropping to the failsafe or the default
  state.messages = { eventLength: 8 };
  assert.deepEqual(await ends(regional(32, 'tournament/weekly', { numAttendees: 20 })), new Date((soon.startAt + 8 * 3600) * 1000));
});

test('reminders, DMs and roll calls show the venue and address as a map link, or the city without them', async () => {
  const addressed = { ...soon, venueName: 'Gamers [Lounge]', venueAddress: '123 Main St (rear), Buffalo, NY' };
  const location = (card) => card.data.description.split('\n').find((line) => line.startsWith('**Location:**'));
  // brackets come out of the text, and parens in the link get encoded, so neither can break it
  const link = '[Gamers Lounge, 123 Main St (rear), Buffalo, NY](https://www.google.com/maps/search/?api=1&query=123%20Main%20St%20%28rear%29%2C%20Buffalo%2C%20NY)';
  assert.equal(location(embeds.startReminder(addressed)), `**Location:** ${link}`);
  assert.equal(location(embeds.regReminder(addressed, soon.registrationClosesAt, false)), `**Location:** ${link}`);
  assert.equal(embeds.rollCall({ ...addressed, entries: [] }, {})[0].data.description.split('\n')[1], link);

  // a venue name with no address goes with the city, and neither leaves the city
  assert.equal(location(embeds.startReminder({ ...soon, venueName: 'Gamers Lounge' })), '**Location:** Gamers Lounge, Buffalo, NY');
  assert.equal(location(embeds.startReminder(soon)), '**Location:** Buffalo, NY');
  assert.equal(location(embeds.startReminder({ ...addressed, isOnline: true })), '**Location:** Online');
});

// a made event the sync keeps up with, from a tournament start.gg has as soon
async function madeEvent() {
  const { guild, created, edited } = fakeGuild();
  await ensureDiscordEvent(soon, guild);
  return { guild, event: created[0], edited };
}

test('the sync moves a discord event when the TO moves the tournament on start.gg, and leaves it alone otherwise', async () => {
  await reset();
  const { guild, event, edited } = await madeEvent();
  // nothing changed on start.gg, so nothing gets edited, even with a mod's own description on it
  event.description = 'a mod wrote this';
  await syncDiscordEvents(guild);
  assert.deepEqual(edited, []);
  assert.deepEqual(asked, ['registration 6']);

  const moved = { ...soon, startAt: soon.startAt + 7200, endAt: soon.endAt + 7200, venueName: 'Gamers Lounge', venueAddress: '123 Main St, Buffalo, NY' };
  byId = { 6: moved };
  await syncDiscordEvents(guild);
  assert.equal(edited.length, 1);
  const [[id, changes]] = edited;
  assert.equal(id, 'event-1');
  assert.deepEqual(changes.scheduledStartTime, new Date(moved.startAt * 1000));
  assert.deepEqual(changes.scheduledEndTime, new Date(moved.endAt * 1000));
  assert.equal(changes.entityMetadata.location, 'Gamers Lounge, 123 Main St, Buffalo, NY');
  assert.equal(state.discordEvents[6].startAt, moved.startAt);

  // once synced, the same start.gg details don't edit it again
  await syncDiscordEvents(guild);
  assert.equal(edited.length, 1);
});

test('the sync edits in a new cover photo when the TO changes it on start.gg', async () => {
  await reset();
  const { guild, created, edited } = fakeGuild();
  await ensureDiscordEvent({ ...soon, images: [{ type: 'banner', url: 'https://images.example/old.png' }] }, guild);
  assert.ok(Buffer.isBuffer(created[0].image));
  downloaded.length = 0;

  byId = { 6: { ...soon, images: [{ type: 'banner', url: 'https://images.example/new.png' }] } };
  await syncDiscordEvents(guild);
  assert.equal(edited.length, 1);
  assert.ok(Buffer.isBuffer(edited[0][1].image));
  assert.deepEqual(downloaded, ['https://images.example/new.png']);

  // once synced, the same cover doesn't edit it again
  await syncDiscordEvents(guild);
  assert.equal(edited.length, 1);
});

test('the sync edits in streams the TO adds on start.gg', async () => {
  await reset();
  const { guild, event, edited } = await madeEvent();
  assert.doesNotMatch(event.description, /Streams:/);

  byId = { 6: { ...soon, streams: [{ streamName: 'buffalosmash', streamSource: 'TWITCH' }] } };
  await syncDiscordEvents(guild);
  assert.equal(edited.length, 1);
  assert.ok(edited[0][1].description.split('\n').includes('Streams: https://twitch.tv/buffalosmash'));

  // once synced, the same streams don't edit it again
  await syncDiscordEvents(guild);
  assert.equal(edited.length, 1);
});

test('the sync cancels the event of a tournament deleted on start.gg, and stops there', async () => {
  await reset();
  const { guild, event, edited } = await madeEvent();
  byId = { 6: null };
  await syncDiscordEvents(guild);
  assert.deepEqual(edited, [['event-1', { status: 4 }]]);
  assert.equal(event.status, 4);
  assert.equal(state.discordEvents[6].gone, true);
  asked.length = 0;
  await syncDiscordEvents(guild);
  assert.deepEqual(asked, []);
});

test('the sync leaves alone an event a mod deleted or that started, without asking start.gg, and forgets old ones', async () => {
  await reset();
  const { guild, event, edited } = await madeEvent();
  // started in discord, which won't move an event that's going
  event.status = 2;
  await syncDiscordEvents(guild);
  assert.equal(state.discordEvents[6].gone, true);
  assert.deepEqual(asked, []);

  const deleted = await madeEvent();
  state.discordEvents[6].gone = false;
  deleted.guild.scheduledEvents.fetch = async () => new Map();
  await syncDiscordEvents(deleted.guild);
  assert.equal(state.discordEvents[6].gone, true);
  assert.deepEqual(asked, []);
  assert.deepEqual([...edited, ...deleted.edited], []);

  // a week after the start it's forgotten
  await syncDiscordEvents(guild, soon.startAt + 8 * 86400);
  assert.deepEqual(state.discordEvents, {});
});

test('an event saved before the sync gets start.gg\'s details once', async () => {
  await reset();
  const { guild, created, edited } = fakeGuild();
  const event = await guild.scheduledEvents.create({ name: 'Old name', description: 'old', entityMetadata: { location: 'Buffalo, NY' } });
  state.tournaments = { 6: { ...soon, entries: [], userIds: [], discordEventId: event.id } };
  tracker.migrateTracking();
  assert.equal(state.tournaments[6].discordEventId, undefined);
  assert.deepEqual(state.discordEvents[6], { eventId: event.id, slug: 'tournament/soon', startAt: soon.startAt, synced: null });
  await syncDiscordEvents(guild);
  assert.equal(edited.length, 1);
  assert.equal(created[0].name, 'Soon');
  await syncDiscordEvents(guild);
  assert.equal(edited.length, 1);
});

// let the last ones finish while the fake is still in place
test('background checks settle with nothing left waiting on start.gg', async () => {
  await settle();
  assert.equal(startgg.queueLength(), 0);
});
