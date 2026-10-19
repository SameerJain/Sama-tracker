import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-registration-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleAutocomplete, handleCommand } = await import('../src/commands/index.js');
const { queueLength } = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
const tournament = (closesAt = now + 3600) => ({
  id: 5, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000,
  registrationClosesAt: closesAt, isRegistrationOpen: true, images: [], events: [],
});
const participants = [
  { gamerTag: 'Here', player: { id: 10, gamerTag: 'Here' }, user: { id: 1, slug: 'user/here', images: [], authorizations: [{ externalId: 'in-server' }] } },
  { gamerTag: 'Elsewhere', player: { id: 20, gamerTag: 'Elsewhere' }, user: { id: 2, slug: 'user/elsewhere', images: [], authorizations: [{ externalId: 'not-in-server' }] } },
  { gamerTag: 'No Discord', player: { id: 30, gamerTag: 'No Discord' }, user: { id: 3, slug: 'user/no-discord', images: [], authorizations: [] } },
  { gamerTag: 'Added by the TO', player: null, user: null },
];

// hidden is a TO hiding who's registered: no participants and no count
let lastFetch = 0;
function mockStartgg(closesAt, { hidden = false } = {}) {
  globalThis.fetch = async (_url, options) => {
    lastFetch = Date.now();
    const { query } = JSON.parse(options.body);
    let data;
    if (query.includes('registrationClosesAt')) data = { tournament: { ...tournament(closesAt), numAttendees: hidden ? null : participants.length } };
    else if (query.includes('participants(')) {
      data = { tournament: { participants: hidden ? { pageInfo: { totalPages: 0 }, nodes: [] } : { pageInfo: { totalPages: 1 }, nodes: participants } } };
    }
    else if (query.includes('tournaments(query:')) {
      data = Object.fromEntries([...query.matchAll(/\bu(\d+): user/g)].map(([, id]) => [`u${id}`, { tournaments: { nodes: [] } }]));
    }
    // a tracked tournament nobody from the crew is in yet gets asked about with no users
    else if (query.includes('tournament(id: $id)')) {
      data = { tournament: { ...tournament(closesAt), events: [
        { id: 50, name: 'Ultimate Singles', slug: 'tournament/local/event/singles', state: 'CREATED', numEntrants: 40, u1: { id: 9, standing: null } },
        { id: 51, name: 'Melee Singles', slug: 'tournament/local/event/melee', state: 'CREATED', numEntrants: 12, u1: null },
      ] } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
}

// records every reply, edit, delete, follow-up and channel message in order. manager is Manage Server
function interaction(commandName, values, user, send = async () => ({}), { subcommand = null, manager = true } = {}) {
  const calls = [];
  return {
    calls,
    commandName,
    guild: { members: { fetch: async ({ user: ids }) => new Map(ids.filter(id => id === 'in-server').map(id => [id, { displayName: 'Herb' }])) } },
    channel: { send: async r => { calls.push(['send', r]); return send(r); } },
    memberPermissions: { has: () => manager },
    options: {
      getSubcommand: () => subcommand, getString: name => values[name] ?? null, getBoolean: name => values[name] ?? null,
      getUser: () => user, getMember: () => user && { displayName: user.displayName },
    },
    reply: async r => calls.push(['reply', r]),
    deferReply: async () => calls.push(['defer']),
    editReply: async r => calls.push(['edit', r]),
    deleteReply: async () => calls.push(['delete']),
    followUp: async r => calls.push(['followUp', r]),
  };
}

test('participants come from every page, including ones with no account', async () => {
  const pagesAsked = [];
  globalThis.fetch = async (_url, options) => {
    const { variables } = JSON.parse(options.body);
    pagesAsked.push(variables.page);
    const nodes = variables.page === 1 ? participants.slice(0, 2) : participants.slice(2);
    return { ok: true, json: async () => ({ data: { tournament: { participants: { pageInfo: { totalPages: 2 }, nodes } } } }) };
  };
  const { getParticipants } = await import('../src/startgg.js');
  assert.deepEqual(await getParticipants(5), [
    { tag: 'Here', userId: 1, slug: 'user/here', discordId: 'in-server' },
    { tag: 'Elsewhere', userId: 2, slug: 'user/elsewhere', discordId: 'not-in-server' },
    { tag: 'No Discord', userId: 3, slug: 'user/no-discord', discordId: undefined },
    { tag: 'Added by the TO', userId: undefined, slug: undefined, discordId: undefined },
  ]);
  assert.deepEqual(pagesAsked.sort(), [1, 2]);
});

test('registered lists only server members by name, with their events, and mentions nobody', async () => {
  state.players = {};
  mockStartgg();
  const run = interaction('registered', { tournament: 'https://www.start.gg/tournament/local/details' });
  await handleCommand(run);
  const [, reply] = run.calls.at(-1);
  const text = reply.embeds.map(e => e.data.description).join('\n');
  assert.match(text, /^\*\*Here\*\* \(Herb\)\n- Ultimate Singles$/m);
  assert.doesNotMatch(JSON.stringify(reply), /<@/);
  assert.doesNotMatch(text, /Elsewhere|No Discord|Added by the TO/);
  assert.doesNotMatch(text, /of the \d+ registered/);
  assert.match(reply.embeds[0].data.author.name, /Registered from this server · 1/);
  // everyone with discord connected, in the server or not, for /profile
  assert.deepEqual(state.accounts, { 'in-server': 1, 'not-in-server': 2 });
});

test('registered puts a gap between people, names in bold and their events under them', async () => {
  const { registered } = await import('../src/embeds/index.js');
  const entries = [
    { userId: 1, event: 'Ultimate Singles' }, { userId: 1, event: 'Doubles *pot bonus*' },
    { userId: 2, event: 'Melee Singles' },
  ];
  const members = [{ tag: 'Zed', userId: 2, name: 'zed' }, { tag: 'Amy', userId: 1, name: 'Amelia' }, { tag: 'Spectator', userId: 3 }];
  const [card] = registered({ ...tournament(), entries }, members);
  assert.equal(card.data.description.split('\n').slice(2).join('\n'), [
    '',
    '**Amy** (Amelia)', '- Ultimate Singles', '- Doubles \\*pot bonus\\*',
    '',
    '**Spectator**',
    '',
    '**Zed**', '- Melee Singles',
  ].join('\n'));
  assert.match(registered(tournament(), [])[0].data.description, /\n\nNobody from this server yet\.$/);
});

test('registered by_event lists the event with the most people first, then anyone in no event', async () => {
  const { registered } = await import('../src/embeds/index.js');
  const entries = [
    { userId: 1, event: 'Melee *Singles*', eventSlug: 'melee', entrants: 12 },
    { userId: 1, event: 'Ultimate Singles', eventSlug: 'ult', entrants: 40 },
    { userId: 2, event: 'Ultimate Singles', eventSlug: 'ult', entrants: 40 },
    { userId: 2, event: 'Raffle', eventSlug: 'raffle' },
  ];
  const members = [{ tag: 'Zed', userId: 2 }, { tag: 'Amy', userId: 1, name: 'Amelia' }, { tag: 'Spectator', userId: 3 }];
  const [card] = registered({ ...tournament(), entries }, members, { byEvent: true });
  assert.equal(card.data.description.split('\n').slice(2).join('\n'), [
    '',
    '**Ultimate Singles** · 2 of 40 entrants', '- Amy (Amelia)', '- Zed',
    '',
    '**Melee \\*Singles\\*** · 1 of 12 entrants', '- Amy (Amelia)',
    '',
    '**Raffle** · 1', '- Zed',
    '',
    '**Not in an event**', '- Spectator',
  ].join('\n'));
  assert.equal(card.data.author.name, 'Registered from this server · 3');
});

test('registered by_event goes through the command too', async () => {
  mockStartgg();
  const run = interaction('registered', { tournament: 'start.gg/tournament/local', by_event: true });
  await handleCommand(run);
  const [, reply] = run.calls.at(-1);
  assert.match(reply.embeds[0].data.description, /\*\*Ultimate Singles\*\* · 1 of 40 entrants\n- Here \(Herb\)$/);
});

test('registered says when start.gg hides who is registered, instead of an empty list', async () => {
  mockStartgg(undefined, { hidden: true });
  const run = interaction('registered', { tournament: 'start.gg/tournament/local' });
  await handleCommand(run);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.match(run.calls[1][1].content, /hides who's registered for Local/);
});

test('reg_warn says already registered without a mention or a ping', async () => {
  mockStartgg();
  const run = interaction('reg_warn', { tournament: 'start.gg/tournament/local' }, { id: 'in-server', displayName: 'Here' });
  await handleCommand(run);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['defer', 'edit']);
  const [, { content }] = run.calls[1];
  assert.match(content, /^Already registered\./);
  assert.doesNotMatch(content, /<@/);
});

test('reg_warn pings someone who is not registered in a channel message, not a follow-up', async () => {
  mockStartgg();
  state.regWarned = [];
  const run = interaction('reg_warn', { tournament: 'start.gg/tournament/local' }, { id: 'slacker', displayName: 'Slacker' });
  await handleCommand(run);
  // a follow-up would show "Original message was deleted" above it
  assert.deepEqual(run.calls.map(([kind]) => kind), ['defer', 'send', 'delete']);
  const [, warning] = run.calls[1];
  assert.equal(warning.content, '<@slacker>');
  assert.deepEqual(warning.allowedMentions, { users: ['slacker'] });
  assert.equal(warning.embeds[0].data.title, 'Local');
  assert.match(warning.embeds[0].data.description, /^\*\*NOT REGISTERED YET!!!!\*\* Registration closes <t:\d+:R>\./);
  assert.match(warning.embeds[0].data.description, /start\.gg\/tournament\/local\/register/);
  assert.doesNotMatch(warning.embeds[0].data.description, /Connect Discord/);
});

test('a reminder out after the deadline reads closed, not closes', async () => {
  const { regReminder } = await import('../src/embeds/index.js');
  const late = regReminder(tournament(now - 3600), now - 3600, true).data.description;
  assert.match(late, /## Registration closed <t:\d+:R>/);
  assert.match(late, /\*\*Closed:\*\* <t:\d+:F>/);
  assert.doesNotMatch(late, /closes|Closes/);

  const upcoming = regReminder(tournament(now + 3600), now + 3600, true).data.description;
  assert.match(upcoming, /## Registration closes <t:\d+:R>/);
  assert.match(upcoming, /\*\*Closes:\*\* <t:\d+:F>/);
  assert.doesNotMatch(upcoming, /closed|Closed/);
});

test('reg_warn sends nothing when start.gg hides who is registered', async () => {
  mockStartgg(undefined, { hidden: true });
  const run = interaction('reg_warn', { tournament: 'local' }, { id: 'in-server', displayName: 'Here' });
  await handleCommand(run);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['defer', 'edit']);
  const [, { content }] = run.calls[1];
  assert.match(content, /hides who's registered for Local.*No warning sent/);
  assert.doesNotMatch(content, /<@/);
});

test('a second reg_warn for the same person and tournament within 12 hours sends nothing, and tells only whoever ran it', async () => {
  mockStartgg();
  state.regWarned = [];
  const first = interaction('reg_warn', { tournament: 'local' }, { id: 'slacker', displayName: 'Slacker' });
  await handleCommand(first);
  assert.ok(first.calls.some(([kind]) => kind === 'send'));

  const again = interaction('reg_warn', { tournament: 'local' }, { id: 'slacker', displayName: 'Slacker' });
  await handleCommand(again);
  assert.ok(!again.calls.some(([kind]) => kind === 'send'), 'warned twice');
  const [, told] = again.calls.at(-1);
  assert.match(told.content, /^Slacker was already warned about Local <t:\d+:R>\. They can be warned again <t:\d+:R>\.$/);
  assert.ok(told.flags, 'the cooldown reply is ephemeral');

  // someone else, or the same person 12 hours on, still gets warned
  const other = interaction('reg_warn', { tournament: 'local' }, { id: 'other', displayName: 'Other' });
  await handleCommand(other);
  assert.ok(other.calls.some(([kind]) => kind === 'send'));
  state.regWarned = state.regWarned.map((each) => ({ ...each, at: each.at - 12 * 3600 - 1 }));
  const later = interaction('reg_warn', { tournament: 'local' }, { id: 'slacker', displayName: 'Slacker' });
  await handleCommand(later);
  assert.ok(later.calls.some(([kind]) => kind === 'send'));
});

test('reg_warn falls back to a follow-up when it cannot post in the channel', async () => {
  mockStartgg();
  state.regWarned = [];
  const missingAccess = async () => { throw new Error('Missing Permissions'); };
  const run = interaction('reg_warn', { tournament: 'local' }, { id: 'slacker', displayName: 'Slacker' }, missingAccess);
  await handleCommand(run);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['defer', 'send', 'delete', 'followUp']);
  const [, warning] = run.calls[3];
  assert.equal(warning.content, '<@slacker>');
  assert.deepEqual(warning.allowedMentions, { users: ['slacker'] });
});

test('reg_warn does not ping once registration closed, or for bots', async () => {
  mockStartgg(now - 60);
  state.regWarned = [];
  const closed = interaction('reg_warn', { tournament: 'local' }, { id: 'slacker', displayName: 'Slacker' });
  await handleCommand(closed);
  assert.deepEqual(closed.calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.match(closed.calls[1][1].content, /already closed/);

  globalThis.fetch = async () => assert.fail('no start.gg lookup for a bot');
  const bot = interaction('reg_warn', { tournament: 'local' }, { id: 'bot', bot: true });
  await handleCommand(bot);
  assert.deepEqual(bot.calls.map(([kind]) => kind), ['reply']);
});

test('tournament add tracks the tournament with everything on and its reminders set, tracking nobody', async () => {
  state.players = {};
  state.tournaments = {};
  // untracked before, so a reg admin's would have stayed out
  state.regSkipped = [5];
  // the reminder's own send is covered elsewhere, here it would post to no channel
  state.messages = { registration: false };
  mockStartgg();
  const run = interaction('tournament', { tournament: 'start.gg/tournament/local' }, undefined, undefined, { subcommand: 'add' });
  await handleCommand(run);
  assert.deepEqual(state.players, {});
  const tracked = state.tournaments[5];
  assert.equal(tracked.name, 'Local');
  assert.deepEqual({ ...tracked.tracked, at: undefined }, { by: 'manual', at: undefined, sets: true, stream: true, top8: true, reminders: true });
  // sets from before it was tracked stay out of its thread
  assert.ok(tracked.lastCheck >= now);
  // closes in an hour, so the last call is all that's left
  assert.equal(tracked.reminder.deadline, now + 3600);
  assert.ok(tracked.reminder.next >= 3);
  assert.deepEqual(state.regSkipped, []);
  const edit = run.calls.find(([kind]) => kind === 'edit');
  assert.match(edit[1].content, /^Tracking Local\. Every set and stream alert from it posts in its own thread.*\nRegistration ends <t:\d+:R>, sending the last call now\./);
  assert.deepEqual(edit[1].allowedMentions, { parse: [] });

  // a second time just says so
  const again = interaction('tournament', { tournament: 'local' }, undefined, undefined, { subcommand: 'add' });
  await handleCommand(again);
  assert.match(again.calls.find(([kind]) => kind === 'edit')[1].content, /Local is already tracked/);
});

test('tournament add with reminders off or registration closed still tracks it, without reminders', async () => {
  state.tournaments = {};
  state.messages = { registration: false };
  mockStartgg();
  const off = interaction('tournament', { tournament: 'local', reminders: 'off' }, undefined, undefined, { subcommand: 'add' });
  await handleCommand(off);
  assert.equal(state.tournaments[5].tracked.reminders, false);
  assert.match(off.calls.find(([kind]) => kind === 'edit')[1].content, /\nNo reg reminders\./);

  state.tournaments = {};
  mockStartgg(now - 60);
  const closed = interaction('tournament', { tournament: 'local' }, undefined, undefined, { subcommand: 'add' });
  await handleCommand(closed);
  assert.ok(state.tournaments[5].tracked);
  assert.match(closed.calls.find(([kind]) => kind === 'edit')[1].content, /Registration is closed, so no reg reminders\./);
});

test('tournament commands go by discord, so a role handed /tournament can use it without Manage Server', async () => {
  mockStartgg();
  state.tournaments = {};
  const run = interaction('tournament', { tournament: 'local' }, undefined, undefined, { subcommand: 'add', manager: false });
  await handleCommand(run);
  assert.ok(state.tournaments[5].tracked);
  assert.doesNotMatch(JSON.stringify(run.calls), /Manage Server/);
});

async function autocomplete(commandName, typed, subcommand = null) {
  let choices;
  await handleAutocomplete({ commandName, options: { getSubcommand: () => subcommand, getFocused: () => typed }, respond: async (result) => { choices = result; } });
  return choices;
}

test('tournament options offer tracked ones and tracked players\' tournaments, soonest first, without finished ones', async () => {
  const day = 86400;
  state.tournaments = {
    5: { id: 5, slug: 'tournament/local', name: 'Local', startAt: now + day, endAt: now + day + 3600, tracked: { by: 'manual' } },
    6: { id: 6, slug: 'tournament/live', name: 'Live Now', startAt: now - 3600, endAt: now + 3600 },
    7: { id: 7, slug: 'tournament/last-week', name: 'Last Week', startAt: now - 8 * day, endAt: now - 7 * day, tracked: { by: 'manual' } },
    // a reg admin's, before the tournament check fills in its dates
    8: { id: 8, slug: 'tournament/admin-weekly', name: 'Admin Weekly', tracked: { by: 'admin' } },
    9: { id: 9, slug: 'tournament/next-month', name: 'Next Month', startAt: now + 30 * day, endAt: now + 30 * day + 3600 },
  };
  const names = async (commandName, typed, subcommand) => (await autocomplete(commandName, typed, subcommand)).map(({ name }) => name);
  assert.deepEqual(await autocomplete('registered', ''), [
    { name: 'Live Now', value: 'tournament/live' }, { name: 'Local', value: 'tournament/local' },
    { name: 'Next Month', value: 'tournament/next-month' }, { name: 'Admin Weekly', value: 'tournament/admin-weekly' },
  ]);
  assert.deepEqual(await names('reg_warn', 'LOC'), ['Local']);
  // a pasted link to one it knows shows its name
  assert.deepEqual(await names('registered', 'https://www.start.gg/tournament/live/details'), ['Live Now']);
  // tracking one offers only the ones that aren't tracked or over
  assert.deepEqual(await names('tournament', '', 'add'), ['Live Now', 'Next Month']);
  // and untracking or changing one only the tracked ones, over or not
  assert.deepEqual(await names('tournament', '', 'remove'), ['Last Week', 'Local', 'Admin Weekly']);
  assert.deepEqual(await names('tournament', 'week', 'posts'), ['Last Week', 'Admin Weekly']);

  // anything else typed comes back as it is, so a pasted link still goes through
  assert.deepEqual(await autocomplete('registered', ' start.gg/tournament/genesis-x '), [{ name: 'start.gg/tournament/genesis-x', value: 'start.gg/tournament/genesis-x' }]);
  state.tournaments = {};
  assert.deepEqual(await autocomplete('tournament', '', 'add'), [{ name: 'No tournaments to pick yet, paste a start.gg link', value: 'none' }]);
  assert.deepEqual(await autocomplete('tournament', '', 'posts'), [{ name: 'No tracked tournaments yet, /tournament add one', value: 'none' }]);
});

test('a picked tournament goes to start.gg by its slug, the same as a pasted link', async () => {
  state.players = {};
  state.tournaments = {};
  mockStartgg();
  // start.gg only knows it as local here. a reminder check from the tests above can still be asking in the background
  const answer = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('registrationClosesAt') && variables.slug !== 'local') return { ok: true, json: async () => ({ data: { tournament: null } }) };
    return answer(url, options);
  };
  const picked = interaction('registered', { tournament: 'tournament/local' });
  await handleCommand(picked);
  const pasted = interaction('registered', { tournament: 'https://www.start.gg/tournament/local/details' });
  await handleCommand(pasted);
  assert.match(picked.calls.at(-1)[1].embeds[0].data.author.name, /Registered from this server · 1/);
  assert.equal(JSON.stringify(picked.calls.at(-1)), JSON.stringify(pasted.calls.at(-1)));
});

// the reminder and tournament checks above run in the background, let them finish
// while the fake is still answering so nothing reaches the real start.gg
test('background checks finish before the fake goes away', async () => {
  while (queueLength() || Date.now() - lastFetch < 2000) await new Promise((resolve) => setTimeout(resolve, 200));
});

// /stream_link with these tournaments going on and start.gg answering streams. records each answer
async function streamLink({ tournaments = {}, streams = () => [] } = {}) {
  state.tournaments = tournaments;
  const asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    const ids = [...query.matchAll(/\bt(\d+): tournament/g)].map(([, id]) => Number(id));
    asked.push(ids);
    if (streams === 'down') return { ok: false, status: 500, json: async () => ({ message: 'down' }) };
    return { ok: true, json: async () => ({ data: Object.fromEntries(ids.map((id) => [`t${id}`, { streams: streams(id) }])) }) };
  };
  const calls = [];
  const run = {
    commandName: 'stream_link', user: { id: 'anyone' }, options: { getSubcommand: () => null },
    reply: async (result) => calls.push(['reply', result]),
    deferReply: async () => { calls.push(['defer']); run.deferred = true; },
    editReply: async (result) => calls.push(['edit', result]),
  };
  await handleCommand(run);
  return { calls, asked };
}

const going = (id, name, extra = {}) => ({ id, name, slug: `tournament/${name.toLowerCase()}`, startAt: now - 3600, endAt: now + 3600, images: [], ...extra });

test('stream_link links each going-on tournament\'s streams, tracked or with tracked players in it', async () => {
  const { calls, asked } = await streamLink({
    tournaments: { 5: going(5, 'Local', { entries: [], tracked: { by: 'manual' } }), 6: going(6, 'Weekly', { entries: [] }), 7: going(7, 'Over', { resultsPosted: true }) },
    streams: (id) => (id === 5 ? [{ streamName: 'localstream', streamSource: 'TWITCH' }, { streamName: 'LocalTube', streamSource: 'YOUTUBE' }] : []),
  });
  // one request for the lot, and finished ones aren't asked about
  assert.deepEqual(asked, [[5, 6]]);
  const cards = calls.at(-1)[1].embeds.map((embed) => embed.data);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'Local');
  assert.match(cards[0].description, /\[twitch\.tv\/localstream\]\(https:\/\/twitch\.tv\/localstream\)/);
  assert.match(cards[0].description, /LocalTube \(Youtube\)/);
});

test('stream_link says to ask a TO when nothing is going on, nothing has a stream, or start.gg is down', async () => {
  const quiet = await streamLink({ tournaments: { 8: going(8, 'Later', { startAt: now + 86400, endAt: now + 90000 }) } });
  assert.deepEqual(quiet.asked, []);
  assert.match(quiet.calls[0][1], /^No tracked tournaments are going on right now\. If you were expecting a stream, ask a TO in another channel\./);

  const none = await streamLink({ tournaments: { 5: going(5, 'Local') } });
  assert.equal(none.calls.at(-1)[1].content, 'No stream links on start.gg for Local. If you were expecting a stream, ask a TO in another channel. `/socials` has the server\'s saved streams.');
  assert.deepEqual(none.calls.at(-1)[1].allowedMentions, { parse: [] });

  const logged = console.error;
  console.error = () => {};
  try {
    const down = await streamLink({ tournaments: { 5: going(5, 'Local') }, streams: 'down' });
    assert.match(down.calls.at(-1)[1], /^Couldn't get stream links from start\.gg right now\. If you were expecting a stream, ask a TO/);
  } finally {
    console.error = logged;
  }
});
