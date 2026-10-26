import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-profile-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands/index.js');
const { rememberAccounts, forgetParticipants } = await import('../src/accounts.js');
const tracker = await import('../src/tracker.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
const ME = '200000000000000001';
const HERB = '200000000000000002';

// start.gg users by id, who's registered for every tournament, and what got asked for
let users;
let registered;
let asked;
const user = (slug, tag, discordId) => ({ slug, images: [{ url: `https://images.example/${tag}.png` }], player: { gamerTag: tag }, authorizations: discordId ? [{ externalId: discordId }] : [] });

beforeEach(() => {
  forgetParticipants();
  state.players = {};
  state.links = {};
  state.accounts = {};
  state.tournaments = {};
  users = {};
  registered = [];
  asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    let data;
    if (query.includes('participants(')) {
      asked.push('participants');
      data = { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: registered } } };
    } else if (query.includes('registrationClosesAt')) {
      data = { tournament: { id: 5, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000, registrationClosesAt: now + 3600, isRegistrationOpen: true, images: [], events: [] } };
    } else {
      asked.push('profiles');
      data = Object.fromEntries([...query.matchAll(/u(\d+): user/g)].map(([, id]) => [`u${id}`, users[id] ?? null]));
    }
    return { ok: true, json: async () => ({ data }) };
  };
});

const member = (name) => ({ displayName: name, displayAvatarURL: () => `https://cdn.example/${name}.png` });

// picked is the user option, player is the tracked or linked pick. left out it's whoever ran it
async function profile({ picked = null, pickedMember = picked && member('Herb'), player = null } = {}) {
  const calls = [];
  await handleCommand({
    commandName: 'profile',
    user: { id: ME, bot: false },
    member: member('Me'),
    options: { getSubcommand: () => null, getUser: () => picked, getMember: () => pickedMember, getString: () => player },
    reply: async (result) => calls.push(['reply', result]),
    deferReply: async () => calls.push(['defer']),
    editReply: async (result) => calls.push(['edit', result]),
  });
  return calls;
}

test('a tracked player comes up by the discord on their start.gg, with their profile linked', async () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Herbert', slug: 'user/herb', discordId: HERB } };
  users = { 1: user('user/herb', 'Herbert', HERB) };
  const calls = await profile({ picked: { id: HERB, bot: false } });
  assert.deepEqual(calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.doesNotMatch(JSON.stringify(calls), /<@/);
  const card = calls[1][1].embeds[0].data;
  assert.equal(card.title, 'Herbert');
  assert.equal(card.url, 'https://www.start.gg/user/herb');
  assert.match(card.description, /^\[start\.gg\/user\/herb\]\(https:\/\/www\.start\.gg\/user\/herb\)/);
  assert.equal(card.author.name, 'Herb');
  assert.equal(card.author.icon_url, 'https://cdn.example/Herb.png');
  assert.equal(card.thumbnail.url, 'https://images.example/Herbert.png');
  assert.deepEqual(asked, ['profiles']);
});

test('leaving the user out looks up whoever ran it, through /link', async () => {
  state.links = { [ME]: { userId: 4, slug: 'user/me', tag: 'Me' } };
  users = { 4: user('user/me', 'Me', ME) };
  const calls = await profile();
  assert.equal(calls[1][1].embeds[0].data.url, 'https://www.start.gg/user/me');
  assert.equal(calls[1][1].embeds[0].data.author.name, 'Me');
});

test('someone only registered for a tracked tournament gets found, then remembered', async () => {
  state.tournaments = { 5: { id: 5, slug: 'tournament/local', name: 'Local', tracked: { by: 'manual' } } };
  registered = [
    { gamerTag: 'Herbert', user: { id: 8, authorizations: [{ externalId: HERB }] } },
    { gamerTag: 'No Discord', user: { id: 9, authorizations: [] } },
  ];
  users = { 8: user('user/herb', 'Herbert', HERB) };
  const first = await profile({ picked: { id: HERB, bot: false } });
  assert.equal(first[1][1].embeds[0].data.url, 'https://www.start.gg/user/herb');
  assert.deepEqual(state.accounts, { [HERB]: 8 });

  asked = [];
  await profile({ picked: { id: HERB, bot: false } });
  assert.deepEqual(asked, ['profiles']);
});

test('someone nobody can find costs one read of the tracked tournaments in 10 minutes, however often they ask', async () => {
  state.tournaments = { 5: { id: 5, slug: 'tournament/local', name: 'Local', tracked: { by: 'manual' } } };
  registered = [{ gamerTag: 'No Discord', user: { id: 9, authorizations: [] } }];
  await profile();
  await profile();
  assert.deepEqual(asked, ['participants']);
});

test('a start.gg that disconnected their discord does not count, and gets forgotten', async () => {
  state.accounts = { [HERB]: 7 };
  users = { 7: user('user/old', 'Old', null) };
  const calls = await profile({ picked: { id: HERB, bot: false } });
  const [, miss] = calls[1];
  assert.match(miss.content, /^Couldn't find a start\.gg with Herb's Discord connected/);
  // says what they have to do, since start.gg has no way to search by discord
  assert.match(miss.content, /ask them to `\/link` it/);
  assert.match(miss.content, /\/track add/);
  // by name, so they don't get pinged or even mentioned
  assert.doesNotMatch(miss.content, /<@/);
  assert.deepEqual(miss.allowedMentions, { parse: [] });
  assert.deepEqual(state.accounts, {});
});

test('not finding yourself says how to fix it', async () => {
  const calls = await profile();
  assert.match(calls[1][1], /\/track add.*\/link/);
  // nothing saved for them and no reg reminder tournaments to look through
  assert.deepEqual(asked, []);
});

test('a tracked player can be picked straight from the list, without asking start.gg', async () => {
  globalThis.fetch = async () => assert.fail('no start.gg lookup for a list pick');
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Herbert', slug: 'user/herb', image: 'https://images.example/Herbert.png' } };
  const calls = await profile({ player: '1' });
  assert.deepEqual(calls.map(([kind]) => kind), ['defer', 'edit']);
  const card = calls[1][1].embeds[0].data;
  assert.equal(card.title, 'Herbert');
  assert.equal(card.url, 'https://www.start.gg/user/herb');
  assert.equal(card.author.name, 'Herbert');
  assert.equal(card.thumbnail.url, 'https://images.example/Herbert.png');
});

test('picking nobody on the list says who can be picked', async () => {
  globalThis.fetch = async () => assert.fail('no start.gg lookup for a miss');
  state.players = {};
  const calls = await profile({ player: 'nobody' });
  assert.deepEqual(calls.map(([kind]) => kind), ['reply']);
  assert.match(calls[0][1].content, /Only tracked or linked players can be picked/);
  assert.equal(calls[0][1].flags, MessageFlags.Ephemeral);
});

test('profile autocompletes tracked and linked players', async () => {
  const { handleAutocomplete } = await import('../src/commands/index.js');
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Herbert', slug: 'user/herb' } };
  state.links = { 'me-discord': { userId: 7, playerId: 70, tag: 'Me', slug: 'user/me' } };
  let choices;
  await handleAutocomplete({
    commandName: 'profile',
    user: { id: 'anyone' },
    options: { getSubcommand: () => null, getFocused: () => '' },
    respond: async (result) => { choices = result; },
  });
  assert.deepEqual(choices.map((choice) => choice.value).sort(), ['1', '7']);
  assert.ok(choices.some((choice) => choice.name === 'Me (linked)'));
});

test('only server members, and no bots, without asking start.gg', async () => {
  globalThis.fetch = async () => assert.fail('no start.gg lookup');
  const outsider = await profile({ picked: { id: HERB, bot: false }, pickedMember: null });
  assert.deepEqual(outsider, [['reply', { content: 'Pick someone in this server.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }]]);
  const bot = await profile({ picked: { id: HERB, bot: true } });
  assert.equal(bot[0][1].content, 'Bots don\'t have start.gg accounts.');
});

test('reg reminders remember who registered with discord connected', async () => {
  state.messages = {};
  state.regPings = [];
  state.tournaments = { 5: { id: 5, slug: 'tournament/local', name: 'Local', tracked: { by: 'manual' }, reminder: { next: 0 } } };
  registered = [{ gamerTag: 'Herbert', user: { id: 8, authorizations: [{ externalId: HERB }] } }, { gamerTag: 'Added by the TO', user: null }];
  await tracker.postRegReminders({ send: async () => ({}) });
  assert.deepEqual(state.accounts, { [HERB]: 8 });
});

test('remembers the newest 5000 discords, by when each was last seen', () => {
  const snowflake = (n) => String(300000000000000000n + BigInt(n));
  rememberAccounts(Array.from({ length: 3000 }, (_, i) => ({ discordId: snowflake(i), userId: i + 1 })));
  assert.equal(Object.keys(state.accounts).length, 3000);
  rememberAccounts(Array.from({ length: 2000 }, (_, i) => ({ discordId: snowflake(3000 + i), userId: 3001 + i })));

  // seeing the oldest again keeps it, so the next oldest goes. no discord or no account gets skipped
  rememberAccounts([{ discordId: snowflake(0), userId: 1 }, { discordId: snowflake(5000), userId: 5001 }, { userId: 9 }, { discordId: snowflake(9999) }]);
  const ids = Object.keys(state.accounts);
  assert.equal(ids.length, 5000);
  assert.equal(state.accounts[snowflake(1)], undefined);
  assert.deepEqual(ids.slice(-2), [snowflake(0), snowflake(5000)]);
});
