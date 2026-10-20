import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

// the TO role: who can hand it out, what it lets someone change for other people, and the first TO
const directory = mkdtempSync(join(tmpdir(), 'sama-to-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands/index.js');
const { seedFirstTO, FIRST_TO } = await import('../src/commands/to.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

// start.gg has the first TO with this discord connected, unless firstDiscord is null. slippi has these codes
let firstDiscord = 'sama-discord';
let startggAsked = 0;
const slippiUsers = ['FAN#1', 'OTHER#2'].map((code, i) => ({
  fbUid: `uid-${i}`, displayName: code.split('#')[0], connectCode: { code },
  rankedNetplayProfile: { id: `RANKED_SINGLES-uid-${i}-season-5`, ratingOrdinal: 1500, ratingUpdateCount: 20, wins: 10, losses: 5, characters: [] },
  rankedNetplayProfileHistory: [],
}));
globalThis.fetch = async (url, options) => {
  const { query, variables } = JSON.parse(options.body);
  if (String(url).includes('internal.slippi.gg')) {
    const found = (value) => slippiUsers.find((each) => each.fbUid === value || each.connectCode.code === value) ?? null;
    return { ok: true, json: async () => ({ data: Object.fromEntries(Object.entries(variables).map(([name, value]) => [name.replace('v', 'u'), found(value)])) }) };
  }
  startggAsked++;
  if (query.includes('user(slug:')) {
    const authorizations = firstDiscord ? [{ externalId: firstDiscord }] : [];
    return { ok: true, json: async () => ({ data: { user: { id: 1, slug: variables.slug, images: [], player: { id: 10, gamerTag: 'Samatron' }, authorizations } } }) };
  }
  throw new Error(`no fake for ${query.slice(0, 80)}`);
};

// a server member whose roles the bot can change, unless locked says discord won't let it
function member(id, { roles = [], locked = false } = {}) {
  const cache = new Set(roles);
  const change = (fn) => async (role) => {
    if (locked) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
    fn(role.id);
  };
  return { id, displayName: id.replace('-discord', ''), roles: { cache, add: change((role) => cache.add(role)), remove: change((role) => cache.delete(role)) } };
}

// the server: its roles, and who's in it
let roles;
let members;
const guild = {
  roles: {
    get cache() { return Object.assign(roles, { find: (fn) => [...roles.values()].find(fn) }); },
    create: async ({ name, permissions }) => {
      assert.deepEqual(permissions, []);
      const role = { id: 'made-role', name };
      roles.set(role.id, role);
      return role;
    },
  },
  members: {
    fetch: async (arg) => {
      if (typeof arg === 'string') {
        if (!members.has(arg)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
        return members.get(arg);
      }
      return new Map(arg.user.filter((id) => members.has(id)).map((id) => [id, members.get(id)]));
    },
  },
};

// a command run by someone in the server. manager is Manage Server. picked is the member or role an option picked
async function run(commandName, user, { group = commandName === 't-o' ? 'role' : null, subcommand = null, values = {}, manager = false, picked = null, pickedRole = null } = {}) {
  const calls = [];
  const interaction = {
    calls, commandName, guild,
    user: { id: user },
    member: members.get(user) ?? member(user),
    memberPermissions: { has: () => manager },
    options: {
      getSubcommandGroup: () => group, getSubcommand: () => subcommand,
      getString: (name) => values[name] ?? null, getBoolean: (name) => values[name] ?? null,
      getUser: () => picked && { id: picked.id, bot: Boolean(picked.bot), displayName: picked.displayName },
      getMember: () => (picked && !picked.bot ? picked : null),
      getRole: () => pickedRole,
    },
    reply: async (result) => calls.push(['reply', result]),
    deferReply: async () => { interaction.deferred = true; calls.push(['defer']); },
    editReply: async (result) => calls.push(['edit', result]),
    deleteReply: async () => calls.push(['delete']),
    followUp: async (result) => calls.push(['followUp', result]),
  };
  await handleCommand(interaction);
  return calls;
}

// what the command said last, and whether only they saw it
const said = (calls) => {
  const [, result] = calls.findLast(([kind]) => kind !== 'defer' && kind !== 'delete');
  return { content: result.content, private: result.flags === MessageFlags.Ephemeral };
};

beforeEach(() => {
  roles = new Map();
  members = new Map();
  firstDiscord = 'sama-discord';
  startggAsked = 0;
  Object.assign(state, {
    toRole: { id: null, members: [], seeded: false }, players: {}, links: {}, slippi: {}, slippiSkipped: [], messages: {},
  });
});

test('until the server has a TO role Manage Server counts as one, and /t-o role add makes the role and hands it out', async () => {
  const x = member('x-discord');
  members.set(x.id, x);
  const first = said(await run('t-o', 'admin-discord', { subcommand: 'add', manager: true, picked: x }));
  assert.equal(first.content, 'x is a TO now. TOs can control automatic messages, track, untrack, change posts and set pings for anyone, take anyone off the Slippi watchlist, and use `/t-o tournament`, `/t-o calls` and `/t-o cleanup`.');
  assert.equal(first.private, false);
  assert.deepEqual([...roles.values()], [{ id: 'made-role', name: 'TO' }]);
  assert.ok(x.roles.cache.has('made-role'));
  assert.equal(state.toRole.id, 'made-role');
  assert.deepEqual(state.toRole.members, ['x-discord']);

  // now there's a role, Manage Server alone can't, but a TO can
  const y = member('y-discord');
  members.set(y.id, y);
  const refused = said(await run('t-o', 'admin-discord', { subcommand: 'add', manager: true, picked: y }));
  assert.deepEqual(refused, { content: 'Only TOs can add TOs. `/t-o role list` shows who they are.', private: true });
  assert.equal(said(await run('t-o', 'x-discord', { subcommand: 'add', picked: y })).content.split('.')[0], 'y is a TO now');
  assert.ok(y.roles.cache.has('made-role'));

  assert.deepEqual(said(await run('t-o', 'x-discord', { subcommand: 'add', picked: y })), { content: 'y is already a TO.', private: true });
  assert.deepEqual(said(await run('t-o', 'x-discord', { subcommand: 'add', picked: { id: 'bot', bot: true, displayName: 'Bot' } })), { content: 'Bots can\'t be TOs.', private: true });
});

test('a TO role made by hand counts by its name, and keeps counting once renamed', async () => {
  roles.set('hand-role', { id: 'hand-role', name: 'TO' });
  const x = member('x-discord', { roles: ['hand-role'] });
  members.set(x.id, x);
  const z = member('z-discord');
  members.set(z.id, z);
  assert.match(said(await run('t-o', 'x-discord', { subcommand: 'add', picked: z })).content, /^z is a TO now/);
  assert.equal(state.toRole.id, 'hand-role');
  // handed the role in server settings, so the bot learns about them when they use it
  assert.deepEqual(state.toRole.members, ['x-discord', 'z-discord']);

  roles.get('hand-role').name = 'Tournament Organizers';
  assert.match(said(await run('t-o', 'z-discord', { subcommand: 'remove', picked: x })).content, /^x isn't a TO anymore\.$/);
});

test('a server manager can set any existing role as the TO role', async () => {
  const buffalo = { id: 'buffalo-role', name: 'TO(Buffalo)' };
  roles.set(buffalo.id, buffalo);
  const x = member('x-discord', { roles: [buffalo.id] });
  members.set(x.id, x);

  assert.deepEqual(said(await run('t-o', 'admin-discord', { subcommand: 'set', manager: true, pickedRole: buffalo })), {
    content: 'TO(Buffalo) is the TO role now.', private: false,
  });
  assert.equal(state.toRole.id, buffalo.id);
  const y = member('y-discord');
  members.set(y.id, y);
  assert.match(said(await run('t-o', x.id, { subcommand: 'add', picked: y })).content, /^y is a TO now/);

  const refused = said(await run('t-o', x.id, { subcommand: 'set', pickedRole: { id: 'other', name: 'Other' } }));
  assert.deepEqual(refused, { content: 'You need Manage Server permission to set the TO role.', private: true });
  assert.equal(state.toRole.id, buffalo.id);
});

test('/t-o role remove refuses to remove the last known TO', async () => {
  roles.set('to-role', { id: 'to-role', name: 'TO' });
  const x = member('x-discord', { roles: ['to-role'] });
  const y = member('y-discord', { roles: ['to-role'] });
  const z = member('z-discord');
  for (const each of [x, y, z]) members.set(each.id, each);

  assert.deepEqual(said(await run('t-o', 'z-discord', { subcommand: 'remove', picked: y })), { content: 'Only TOs can remove TOs. `/t-o role list` shows who they are.', private: true });
  assert.ok(y.roles.cache.has('to-role'));
  assert.deepEqual(said(await run('t-o', 'x-discord', { subcommand: 'remove', picked: z })), { content: 'z isn\'t a TO.', private: true });

  assert.equal(said(await run('t-o', 'x-discord', { subcommand: 'remove', picked: y })).content, 'y isn\'t a TO anymore.');
  assert.ok(!y.roles.cache.has('to-role'));
  assert.equal(said(await run('t-o', 'x-discord', { subcommand: 'remove', picked: x })).content, 'x is the last known TO. Add another TO first, or have someone with Manage Server set the TO role.');
  assert.ok(x.roles.cache.has('to-role'));
  assert.deepEqual(state.toRole.members, ['x-discord']);
});

test('a role discord won\'t let the bot hand out says what it needs', async () => {
  roles.set('to-role', { id: 'to-role', name: 'TO' });
  const x = member('x-discord', { roles: ['to-role'] });
  const stuck = member('stuck-discord', { locked: true });
  members.set(x.id, x);
  assert.equal(said(await run('t-o', 'x-discord', { subcommand: 'add', picked: stuck })).content, 'I couldn\'t give stuck the TO role. That needs Manage Roles, with my role above TO.');
  assert.deepEqual(state.toRole.members, ['x-discord']);
});

test('/t-o role list shows the TOs the bot has seen, dropping anyone who left or lost the role', async () => {
  roles.set('to-role', { id: 'to-role', name: 'TO' });
  const kept = member('kept-discord', { roles: ['to-role'] });
  const lost = member('lost-discord');
  members.set(kept.id, kept);
  members.set(lost.id, lost);
  state.toRole = { id: 'to-role', members: ['kept-discord', 'lost-discord', 'left-discord'], seeded: true };
  const calls = await run('t-o', 'anyone-discord', { subcommand: 'list' });
  const card = JSON.stringify(calls.findLast(([kind]) => kind === 'edit')[1].embeds[0]);
  assert.match(card, /TOs · 1/);
  assert.match(card, /<@kept-discord>/);
  assert.doesNotMatch(card, /lost-discord|left-discord/);
  assert.deepEqual(state.toRole.members, ['kept-discord']);

  roles.clear();
  const none = JSON.stringify((await run('t-o', 'anyone-discord', { subcommand: 'list' })).at(-1)[1].embeds[0]);
  assert.match(none, /There's no TO role yet, so anyone with Manage Server counts as a TO/);
});

test('the first TO gets the role once, by the discord on their start.gg, and another TO can take it off for good', async () => {
  assert.equal(FIRST_TO, 'user/f64a83c8');
  const sama = member('sama-discord');
  members.set(sama.id, sama);
  await seedFirstTO(guild);
  assert.ok(sama.roles.cache.has('made-role'));
  assert.deepEqual(state.toRole, { id: 'made-role', members: ['sama-discord'], seeded: true });

  // taken off by another TO, a restart doesn't hand it back or ask start.gg again
  sama.roles.cache.clear();
  startggAsked = 0;
  await seedFirstTO(guild);
  assert.equal(startggAsked, 0);
  assert.ok(!sama.roles.cache.has('made-role'));
});

test('the first TO waits for their start.gg to have their discord, and for them to be in the server', async () => {
  firstDiscord = null;
  await seedFirstTO(guild);
  assert.equal(state.toRole.seeded, false);
  firstDiscord = 'sama-discord';
  await seedFirstTO(guild);
  assert.equal(state.toRole.seeded, false);
  assert.deepEqual([...roles.values()], []);
  members.set('sama-discord', member('sama-discord'));
  await seedFirstTO(guild);
  assert.equal(state.toRole.seeded, true);
});

test('anyone can put their own code on the slippi watchlist and take it off, and only TOs someone else\'s', async () => {
  roles.set('to-role', { id: 'to-role', name: 'TO' });
  members.set('to-discord', member('to-discord', { roles: ['to-role'] }));

  // a typed code goes on as whoever typed it
  assert.match(said(await run('slippi', 'fan-discord', { subcommand: 'add', values: { code: 'fan#1' } })).content, /^Added FAN to the Slippi watchlist/);
  assert.equal(state.slippi['uid-0'].discordId, 'fan-discord');
  // one each, and the same one again is fine
  assert.deepEqual(said(await run('slippi', 'fan-discord', { subcommand: 'add', values: { code: 'OTHER#2' } })), {
    content: 'You\'re on the watchlist as FAN (FAN#1). Only TOs can add someone else. `/slippi remove` takes you off first if your code changed.', private: true,
  });
  assert.match(said(await run('slippi', 'fan-discord', { subcommand: 'add', values: { code: 'FAN#1' } })).content, /^FAN is already on the Slippi watchlist/);
  assert.equal(state.slippi['uid-1'], undefined);

  // a TO's typed code belongs to nobody
  assert.match(said(await run('slippi', 'to-discord', { subcommand: 'add', values: { code: 'OTHER#2' } })).content, /^Added OTHER/);
  assert.equal(state.slippi['uid-1'].discordId, undefined);

  // someone else's stays put
  assert.deepEqual(said(await run('slippi', 'other-discord', { subcommand: 'remove', values: { player: 'uid-0' } })), {
    content: 'Only TOs can take someone else off the watchlist. Leave out `player` to take yourself off. `/t-o role list` shows who they are.', private: true,
  });
  assert.deepEqual(said(await run('slippi', 'other-discord', { subcommand: 'remove' })), { content: 'You aren\'t on the Slippi watchlist. Pick someone to take off, if you\'re a TO.', private: true });
  assert.ok(state.slippi['uid-0']);

  // their own, left out, and a TO's pick
  assert.equal(said(await run('slippi', 'fan-discord', { subcommand: 'remove' })).content, 'Took FAN (FAN#1) off the Slippi watchlist.');
  assert.equal(said(await run('slippi', 'to-discord', { subcommand: 'remove', values: { player: 'OTHER#2' } })).content, 'Took OTHER (OTHER#2) off the Slippi watchlist.');
  assert.deepEqual(state.slippi, {});
});

test('a watchlist entry found on someone\'s start.gg is theirs to take off', async () => {
  roles.set('to-role', { id: 'to-role', name: 'TO' });
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', discordId: 'crew-discord' } };
  state.slippi = { 'uid-0': { uid: 'uid-0', code: 'FAN#1', name: 'FAN', userId: 1, rank: 'Gold 1' } };
  assert.equal(said(await run('slippi', 'crew-discord', { subcommand: 'remove', values: { player: 'FAN#1' } })).content, 'Took FAN (FAN#1) off the Slippi watchlist.');
});
