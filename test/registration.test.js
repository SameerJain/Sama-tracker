import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-registration-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
// the jokes would call claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
const tournament = (closesAt = now + 3600) => ({
  id: 5, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000,
  registrationClosesAt: closesAt, isRegistrationOpen: true, images: [], events: [],
});
const participants = [
  { gamerTag: 'Here', user: { id: 1, authorizations: [{ externalId: 'in-server' }] } },
  { gamerTag: 'Elsewhere', user: { id: 2, authorizations: [{ externalId: 'not-in-server' }] } },
  { gamerTag: 'No Discord', user: { id: 3, authorizations: [] } },
  { gamerTag: 'Added by the TO', user: null },
];

function mockStartgg(closesAt) {
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    let data;
    if (query.includes('registrationClosesAt')) data = { tournament: tournament(closesAt) };
    else if (query.includes('participants(')) data = { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: participants } } };
    else if (query.includes('userEntrant')) {
      data = { tournament: { ...tournament(closesAt), events: [
        { id: 50, name: 'Ultimate Singles', slug: 'tournament/local/event/singles', state: 'CREATED', numEntrants: 40, u1: { id: 9, standing: null } },
        { id: 51, name: 'Melee Singles', slug: 'tournament/local/event/melee', state: 'CREATED', numEntrants: 12, u1: null },
      ] } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
}

// records every reply, edit, delete and follow-up in order
function interaction(commandName, values, user) {
  const calls = [];
  return {
    calls,
    commandName,
    guild: { members: { fetch: async ({ user: ids }) => new Map(ids.filter(id => id === 'in-server').map(id => [id, {}])) } },
    options: {
      getSubcommand: () => null, getString: name => values[name] ?? null,
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

test('registered lists only server members, with their events', async () => {
  state.players = {};
  mockStartgg();
  const run = interaction('registered', { tournament: 'https://www.start.gg/tournament/local/details' });
  await handleCommand(run);
  const [, reply] = run.calls.at(-1);
  const text = reply.embeds.map(e => e.data.description).join('\n');
  assert.match(text, /<@in-server> · Here: Ultimate Singles$/m);
  assert.doesNotMatch(text, /Elsewhere|No Discord|Added by the TO/);
  assert.match(text, /2 of the 4 registered/);
  assert.match(reply.embeds[0].data.author.name, /Registered from this server · 1/);
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

test('reg_warn pings someone who is not registered in a new message', async () => {
  mockStartgg();
  const run = interaction('reg_warn', { tournament: 'start.gg/tournament/local' }, { id: 'slacker', displayName: 'Slacker' });
  await handleCommand(run);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['defer', 'delete', 'followUp']);
  const [, warning] = run.calls[2];
  assert.equal(warning.content, '<@slacker>');
  assert.deepEqual(warning.allowedMentions, { users: ['slacker'] });
  assert.equal(warning.embeds[0].data.title, 'Local');
  assert.match(warning.embeds[0].data.description, /start\.gg\/tournament\/local\/register/);
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
