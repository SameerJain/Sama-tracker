import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InteractionContextType } from 'discord.js';

// per-server store: one state.json holds every guild under state.guilds[guildId]
const directory = mkdtempSync(join(tmpdir(), 'sama-guilds-'));
process.env.STATE_DIR = directory;
process.env.MULTI_GUILD = 'true';
delete process.env.ANTHROPIC_API_KEY;
const { state, save, forGuild, guildIds, guildLocal, migrateLegacyToGuild, cleanState, postsChannelId } = await import('../src/store.js');
const { commands } = await import('../src/commands/definitions.js');
const { help } = await import('../src/embeds/system.js');
const { handleCommand } = await import('../src/commands/index.js');
const tracker = await import('../src/tracker.js');
const { PermissionFlagsBits } = await import('discord.js');
after(() => rmSync(directory, { recursive: true, force: true }));

const THREADS = ['CreatePublicThreads', 'SendMessagesInThreads'];

// a text channel that keeps what was sent to it, with only these permissions for the bot
function fakeChannel(id, allowed = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', ...THREADS]) {
  return {
    id, sent: [], threads: {}, client: { user: { id: 'bot' } },
    isTextBased: () => true,
    permissionsFor: () => ({ has: (flag) => allowed.some((name) => PermissionFlagsBits[name] === flag) }),
    send(message) {
      this.sent.push(message);
    },
  };
}

async function setup(guildId, channel) {
  let reply;
  await handleCommand({
    commandName: 'settings', guildId, guild: { id: guildId }, user: { id: 'me' },
    client: { user: { id: 'bot' } },
    memberPermissions: { has: () => true },
    options: { getSubcommandGroup: () => null, getSubcommand: () => 'channel', getChannel: () => channel },
    reply: async (result) => { reply = result; },
  });
  return reply;
}

test('servers get their own track lists, settings and channels', async () => {
  await guildLocal.run('g1', async () => {
    state.players = { 1: { userId: 1, tag: 'Crew' } };
    state.messages = { sets: false };
    state.channelId = 'channel-1';
  });
  await guildLocal.run('g2', async () => {
    state.players = { 2: { userId: 2, tag: 'Rival' } };
    state.messages = {};
    state.channelId = 'channel-2';
  });
  const g1 = await guildLocal.run('g1', () => ({ players: state.players, channelId: state.channelId }));
  const g2 = await guildLocal.run('g2', () => ({ players: state.players, channelId: state.channelId }));
  assert.deepEqual(Object.keys(g1.players), ['1']);
  assert.deepEqual(Object.keys(g2.players), ['2']);
  assert.equal(g1.channelId, 'channel-1');
  assert.equal(g2.channelId, 'channel-2');
  // deploy stays global
  state.deploy = { id: 'd1', at: 1 };
  const deploy = await guildLocal.run('g1', () => state.deploy);
  assert.deepEqual(deploy, { id: 'd1', at: 1 });
  state.deploy = null;
});

test('old single-server files migrate into their server once', async () => {
  state.players = { 7: { userId: 7, tag: 'Migrated' } };
  state.tournaments = { 5: { id: 5, name: 'Local' } };
  migrateLegacyToGuild('legacy-guild', 'legacy-channel');
  const guild = forGuild('legacy-guild');
  assert.equal(guild.players[7].tag, 'Migrated');
  assert.equal(guild.tournaments[5].name, 'Local');
  assert.equal(guild.channelId, 'legacy-channel');
  // a second boot keeps what the server changed since
  await guildLocal.run('legacy-guild', async () => {
    state.players = {};
  });
  migrateLegacyToGuild('legacy-guild', 'legacy-channel');
  assert.deepEqual(forGuild('legacy-guild').players, {});
  assert.ok(guildIds().includes('legacy-guild'));
  save();
});

test('bad guild shapes fall back instead of crashing', async () => {
  const cleaned = cleanState({ players: {}, guilds: { broken: null, half: { players: 'nope' } } });
  assert.deepEqual(cleaned.guilds.broken.players, {});
  assert.deepEqual(cleaned.guilds.half.players, {});
});

test('global commands only work in a server, never in a DM with the bot', () => {
  for (const command of commands) assert.deepEqual(command.contexts, [InteractionContextType.Guild], command.name);
});

test('/settings channel is registered, fits limits and shows in help', async () => {
  const settings = commands.find((command) => command.name === 'settings');
  assert.ok(settings?.options.some((option) => option.name === 'channel'), 'no /settings channel');
  // the handler checks Manage Server or the TO role, so discord can't be the one hiding it
  assert.equal(settings.default_member_permissions, undefined);
  const short = JSON.stringify(help(false));
  assert.match(short, /\/settings channel channel:/);
  const verbose = JSON.stringify(help(true));
  assert.match(verbose, /`\/settings channel`/);
});

test('/settings channel with a guild id writes to that server, not the root', async () => {
  const { handleCommand } = await import('../src/commands/index.js');
  const calls = [];
  const interaction = {
    commandName: 'settings', guildId: 'setup-guild',
    guild: { id: 'setup-guild' },
    user: { id: 'me' },
    memberPermissions: { has: () => true },
    options: {
      getSubcommandGroup: () => null, getSubcommand: () => 'channel',
      getChannel: () => ({ id: 'posts-1', isTextBased: () => true }),
    },
    reply: async (result) => calls.push(result),
  };
  await handleCommand(interaction);
  assert.match(calls[0].content, /posts-1/);
  assert.equal(forGuild('setup-guild').channelId, 'posts-1');
  assert.notEqual(state.channelId, 'posts-1');
});

test('a check waiting on start.gg posts in its own server while another server\'s check runs', async () => {
  const channels = { 'channel-1': fakeChannel('channel-1'), 'channel-2': fakeChannel('channel-2') };
  tracker.setBotClient({ channels: { fetch: async (id) => channels[id] ?? null } });
  let reachedG2;
  const g2Reached = new Promise((resolve) => { reachedG2 = resolve; });
  // the set check in g1 is still waiting on start.gg when the tournament check gets to g2
  const sets = tracker.eachGuild(async (id) => {
    if (id !== 'g1') return;
    await g2Reached;
    tracker.currentChannel().send('set result for g1');
  });
  const tournaments = tracker.eachGuild(async (id) => {
    if (id === 'g2') reachedG2();
  });
  await Promise.all([sets, tournaments]);
  assert.deepEqual(channels['channel-1'].sent, ['set result for g1']);
  assert.deepEqual(channels['channel-2'].sent, []);
  // outside a check there's no server to post for
  assert.equal(tracker.currentChannel(), null);
});

test('/settings channel moving the posts channel takes effect on the next check, without a restart', async () => {
  const channels = { 'old-posts': fakeChannel('old-posts'), 'new-posts': fakeChannel('new-posts') };
  tracker.setBotClient({ channels: { fetch: async (id) => channels[id] ?? null } });
  forGuild('moving').channelId = 'old-posts';
  assert.equal((await tracker.guildChannel('moving')).id, 'old-posts');
  assert.match((await setup('moving', channels['new-posts'])).content, /^Automatic posts go in <#new-posts>\.$/);
  assert.equal((await tracker.guildChannel('moving')).id, 'new-posts');
});

test('anyone can see the posts channel, but only Manage Server or a TO changes it', async () => {
  forGuild('open').channelId = 'posts-open';
  const ask = async (channel) => {
    let reply;
    await handleCommand({
      commandName: 'settings', guildId: 'open', guild: { id: 'open' }, user: { id: 'member' }, member: { roles: { cache: new Map() } },
      memberPermissions: { has: () => false },
      options: { getSubcommandGroup: () => null, getSubcommand: () => 'channel', getChannel: () => channel },
      reply: async (result) => { reply = result; },
    });
    return reply;
  };
  const looked = await ask(null);
  assert.equal(looked.content, 'Automatic posts go in <#posts-open>.');
  assert.ok(looked.flags, 'looking is private');
  const refused = await ask(fakeChannel('elsewhere'));
  assert.match(refused.content, /need Manage Server or the TO role/);
  assert.ok(refused.flags);
  assert.equal(forGuild('open').channelId, 'posts-open');
});

test('/settings channel turns down a channel the bot can\'t post in, and notes what only some posts need', async () => {
  forGuild('picky').channelId = 'posts-ok';
  const muted = await setup('picky', fakeChannel('muted', ['ViewChannel', 'AttachFiles', ...THREADS]));
  assert.equal(muted.content, 'I need Send Messages and Embed Links in <#muted> to post there. Add them to my role or the channel, then try again.');
  assert.ok(muted.flags, 'private');
  assert.equal(forGuild('picky').channelId, 'posts-ok');

  const bare = await setup('picky', fakeChannel('bare', ['ViewChannel', 'SendMessages', 'EmbedLinks']));
  assert.equal(forGuild('picky').channelId, 'bare');
  assert.match(bare.content, /^Automatic posts go in <#bare>\.\n-# Without Attach Files there.*\n-# Without Create Public Threads and Send Messages in Threads there/);
});

test('each server\'s posts channel is its own /settings channel pick, with CHANNEL_ID only for the migrated server', async () => {
  process.env.GUILD_ID = 'home';
  process.env.CHANNEL_ID = 'home-posts';
  try {
    assert.equal(postsChannelId('home'), 'home-posts');
    forGuild('home').channelId = 'home-setup';
    assert.equal(postsChannelId('home'), 'home-setup');
    assert.equal(postsChannelId('stranger'), null);
    assert.equal(guildLocal.run('g1', () => postsChannelId()), 'channel-1');
    assert.equal(postsChannelId(), null);
    // single-server builds always post in CHANNEL_ID
    process.env.MULTI_GUILD = 'false';
    assert.equal(postsChannelId('g1'), 'home-posts');
  } finally {
    process.env.MULTI_GUILD = 'true';
    delete process.env.GUILD_ID;
    delete process.env.CHANNEL_ID;
  }
});

test('the fun queues and the bills rotation are one per bot, not per server', async () => {
  state.funQueue = { melee: [{ id: 'made-at-startup' }] };
  state.billsMeta = { lastImage: 'a.jpg', kinds: [0] };
  // posts made ahead at startup, outside any server, are the ones a server's command serves
  const seen = guildLocal.run('g1', () => ({ funQueue: state.funQueue, billsMeta: state.billsMeta }));
  assert.deepEqual(seen.funQueue.melee, [{ id: 'made-at-startup' }]);
  assert.equal(seen.billsMeta.lastImage, 'a.jpg');
  guildLocal.run('g2', () => { state.funQueue.melee = []; });
  assert.deepEqual(state.funQueue.melee, []);
  assert.equal(forGuild('g2').funQueue, undefined);

  // a server saved with its own copy from before drops it, and the bot's copy loads as usual
  const cleaned = cleanState({ funQueue: { bills: [{ id: 'kept' }] }, guilds: { old: { funQueue: { melee: [] }, billsMeta: { kinds: [1] } } } });
  assert.equal('funQueue' in cleaned.guilds.old, false);
  assert.equal('billsMeta' in cleaned.guilds.old, false);
  assert.deepEqual(cleaned.funQueue, { bills: [{ id: 'kept' }] });
  assert.deepEqual(cleaned.billsMeta, {});
});
