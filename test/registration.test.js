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
const { handleCommand } = await import('../src/commands/index.js');
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
    else if (query.includes('userEntrant')) {
      data = { tournament: { ...tournament(closesAt), events: [
        { id: 50, name: 'Ultimate Singles', slug: 'tournament/local/event/singles', state: 'CREATED', numEntrants: 40, u1: { id: 9, standing: null } },
        { id: 51, name: 'Melee Singles', slug: 'tournament/local/event/melee', state: 'CREATED', numEntrants: 12, u1: null },
      ] } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
}

// records every reply, edit, delete, follow-up and channel message in order
function interaction(commandName, values, user, send = async () => ({})) {
  const calls = [];
  return {
    calls,
    commandName,
    guild: { members: { fetch: async ({ user: ids }) => new Map(ids.filter(id => id === 'in-server').map(id => [id, { displayName: 'Herb' }])) } },
    channel: { send: async r => { calls.push(['send', r]); return send(r); } },
    options: {
      getSubcommand: () => null, getString: name => values[name] ?? null, getBoolean: name => values[name] ?? null,
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
    { tag: 'Here', userId: 1, discordId: 'in-server' },
    { tag: 'Elsewhere', userId: 2, discordId: 'not-in-server' },
    { tag: 'No Discord', userId: 3, discordId: undefined },
    { tag: 'Added by the TO', userId: undefined, discordId: undefined },
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
  assert.match(run.calls[1][1], /hides who's registered for Local/);
});

test('reg_warn says already registered without a mention or a ping', async () => {
  mockStartgg();
  const run = interaction('reg_warn', { tournament: 'start.gg/tournament/local' }, { id: 'in-server', displayName: 'Here' });
  await handleCommand(run);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['defer', 'edit']);
  const [, content] = run.calls[1];
  assert.match(content, /^Already registered\./);
  assert.doesNotMatch(content, /<@/);
});

test('reg_warn pings someone who is not registered in a channel message, not a follow-up', async () => {
  mockStartgg();
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

test('reg_warn sends nothing when start.gg hides who is registered', async () => {
  mockStartgg(undefined, { hidden: true });
  const run = interaction('reg_warn', { tournament: 'local' }, { id: 'in-server', displayName: 'Here' });
  await handleCommand(run);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['defer', 'edit']);
  const [, content] = run.calls[1];
  assert.match(content, /hides who's registered for Local.*No warning sent/);
  assert.doesNotMatch(content, /<@/);
});

test('reg_warn falls back to a follow-up when it cannot post in the channel', async () => {
  mockStartgg();
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
  const closed = interaction('reg_warn', { tournament: 'local' }, { id: 'slacker', displayName: 'Slacker' });
  await handleCommand(closed);
  assert.deepEqual(closed.calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.match(closed.calls[1][1], /already closed/);

  globalThis.fetch = async () => assert.fail('no start.gg lookup for a bot');
  const bot = interaction('reg_warn', { tournament: 'local' }, { id: 'bot', bot: true });
  await handleCommand(bot);
  assert.deepEqual(bot.calls.map(([kind]) => kind), ['reply']);
});

test('set_reg_reminder tracks everyone registered for the tournament', async () => {
  state.players = {};
  state.regReminders = {};
  // the reminder's own send is covered elsewhere, here it would post to no channel
  state.messages = { registration: false };
  mockStartgg();
  const run = interaction('set_reg_reminder', { tournament: 'start.gg/tournament/local' });
  await handleCommand(run);
  // the TO-added entry has no account, so there's nothing to track
  assert.deepEqual(Object.keys(state.players).sort(), ['1', '2', '3']);
  assert.equal(state.players[1].playerId, 10);
  assert.equal(state.players[1].streamAlerts, true);
  assert.equal(state.players[1].setResults, true);
  assert.ok(state.players[1].lastCheck >= now);
  assert.ok(state.regReminders[5]);
  // the reminder's own channel send can land anywhere around the reply
  const edit = run.calls.find(([kind]) => kind === 'edit');
  assert.match(edit[1], /sending the last call now\. 3 players from Local are now tracked\./);
});

test('set_reg_reminder still sets the reminder when the list is hidden, tracking nobody', async () => {
  state.players = {};
  state.regReminders = {};
  state.messages = { registration: false };
  mockStartgg(undefined, { hidden: true });
  const run = interaction('set_reg_reminder', { tournament: 'start.gg/tournament/local' });
  await handleCommand(run);
  assert.deepEqual(state.players, {});
  assert.ok(state.regReminders[5]);
  const edit = run.calls.find(([kind]) => kind === 'edit');
  assert.doesNotMatch(edit[1], /now tracked/);
});

// the reminder and tournament checks above run in the background, let them finish
// while the fake is still answering so nothing reaches the real start.gg
test('background checks finish before the fake goes away', async () => {
  while (queueLength() || Date.now() - lastFetch < 2000) await new Promise((resolve) => setTimeout(resolve, 200));
});
