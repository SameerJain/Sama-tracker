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

// a long answer carries on in follow-ups, each held to discord's 2000 characters, read here as one
async function setup(guildId, channel) {
  const parts = [];
  await handleCommand({
    commandName: 't-o', guildId, guild: { id: guildId }, user: { id: 'me' },
    client: { user: { id: 'bot' } },
    memberPermissions: { has: () => true },
    options: {
      getSubcommandGroup: () => null, getSubcommand: () => 'settings', getChannel: () => channel,
      getBoolean: () => null, getString: () => null, getInteger: () => null,
    },
    reply: async (result) => { parts.push(result); },
    followUp: async (result) => { parts.push(result); },
  });
  for (const part of parts) assert.ok(part.content.length <= 2000, `${part.content.length} characters in one message`);
  return { ...parts[0], content: parts.map((part) => part.content).join('\n') };
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
  // a second boot keeps what the server changed since, even with nothing tracked anymore
  await guildLocal.run('legacy-guild', async () => {
    state.players = {};
    state.tournaments = {};
    state.messages = { commandChannels: ['bots'] };
  });
  migrateLegacyToGuild('legacy-guild', 'legacy-channel');
  assert.deepEqual(forGuild('legacy-guild').players, {});
  assert.deepEqual(forGuild('legacy-guild').tournaments, {});
  assert.deepEqual(forGuild('legacy-guild').messages, { commandChannels: ['bots'] });
  assert.ok(guildIds().includes('legacy-guild'));
  save();
});

test('bad guild shapes fall back instead of crashing', async () => {
  const cleaned = cleanState({ players: {}, guilds: { broken: null, half: { players: 'nope' } } });
  assert.deepEqual(cleaned.guilds.broken.players, {});
  assert.deepEqual(cleaned.guilds.half.players, {});
});

test('switching to multi-server keeps the saved bot channel instead of the old environment default', () => {
  const before = state.channelId;
  try {
    state.channelId = 'saved-channel';
    migrateLegacyToGuild('saved-channel-guild', 'environment-channel');
    assert.equal(forGuild('saved-channel-guild').channelId, 'saved-channel');
    forGuild('saved-channel-guild').channelId = 'new-channel';
    migrateLegacyToGuild('saved-channel-guild', 'environment-channel');
    assert.equal(forGuild('saved-channel-guild').channelId, 'new-channel');
  } finally {
    state.channelId = before;
  }
});

test('keys nothing reads anymore come out of old files, root and servers alike', () => {
  const threads = [{ id: 'thread-1', at: 1 }];
  const cleaned = cleanState({ matchmakingThreads: threads, guilds: { old: { matchmakingThreads: threads, matchmaking: { melee: 'role' } } } });
  assert.equal(cleaned.matchmakingThreads, undefined);
  assert.equal(cleaned.guilds.old.matchmakingThreads, undefined);
  assert.deepEqual(cleaned.guilds.old.matchmaking, { melee: 'role' });
});

test('global commands only work in a server, never in a DM with the bot', () => {
  for (const command of commands) assert.deepEqual(command.contexts, [InteractionContextType.Guild], command.name);
});

test('/t-o settings includes the posts channel and shows in help', async () => {
  const to = commands.find((command) => command.name === 't-o');
  const settings = to.options.find((option) => option.name === 'settings');
  assert.ok(settings?.options.some((option) => option.name === 'channel'), 'no channel option');
  assert.equal(to.default_member_permissions, undefined);
  const short = JSON.stringify(help(false));
  assert.match(short, /\/t-o settings channel:/);
  const verbose = JSON.stringify(help(true));
  assert.match(verbose, /`\/t-o settings`/);
});

test('/t-o settings with a guild id writes the channel to that server, not the root', async () => {
  const { handleCommand } = await import('../src/commands/index.js');
  const calls = [];
  const interaction = {
    commandName: 't-o', guildId: 'setup-guild',
    guild: { id: 'setup-guild' },
    user: { id: 'me' },
    memberPermissions: { has: () => true },
    options: {
      getSubcommandGroup: () => null, getSubcommand: () => 'settings',
      getChannel: () => ({ id: 'posts-1', isTextBased: () => true }),
      getBoolean: () => null, getString: () => null, getInteger: () => null,
    },
    reply: async (result) => calls.push(result),
    followUp: async (result) => calls.push(result),
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

test('/t-o settings moving the posts channel takes effect on the next check, without a restart', async () => {
  const channels = { 'old-posts': fakeChannel('old-posts'), 'new-posts': fakeChannel('new-posts') };
  tracker.setBotClient({ channels: { fetch: async (id) => channels[id] ?? null } });
  forGuild('moving').channelId = 'old-posts';
  assert.equal((await tracker.guildChannel('moving')).id, 'old-posts');
  assert.match((await setup('moving', channels['new-posts'])).content, /Automatic posts go in <#new-posts>\./);
  assert.equal((await tracker.guildChannel('moving')).id, 'new-posts');
});

test('anyone can see the settings, but only a TO changes the posts channel', async () => {
  forGuild('open').channelId = 'posts-open';
  const ask = async (channel) => {
    let reply;
    await handleCommand({
      commandName: 't-o', guildId: 'open', guild: { id: 'open' }, user: { id: 'member' }, member: { roles: { cache: new Map() } },
      memberPermissions: { has: () => false },
      options: {
        getSubcommandGroup: () => null, getSubcommand: () => 'settings', getChannel: () => channel,
        getBoolean: () => null, getString: () => null, getInteger: () => null,
      },
      reply: async (result) => { reply = result; },
    });
    return reply;
  };
  const looked = await ask(null);
  assert.match(looked.content, /Posts channel:\*\* <#posts-open>/);
  assert.ok(looked.flags, 'looking is private');
  const refused = await ask(fakeChannel('elsewhere'));
  assert.match(refused.content, /Only TOs can change server settings/);
  assert.ok(refused.flags);
  assert.equal(forGuild('open').channelId, 'posts-open');
});

test('/t-o settings turns down a channel the bot can\'t post in, and notes what only some posts need', async () => {
  forGuild('picky').channelId = 'posts-ok';
  const muted = await setup('picky', fakeChannel('muted', ['ViewChannel', 'AttachFiles', ...THREADS]));
  assert.equal(muted.content, 'I need Send Messages and Embed Links in <#muted> to post there. Add them to my role or the channel, then try again.');
  assert.ok(muted.flags, 'private');
  assert.equal(forGuild('picky').channelId, 'posts-ok');

  const bare = await setup('picky', fakeChannel('bare', ['ViewChannel', 'SendMessages', 'EmbedLinks']));
  assert.equal(forGuild('picky').channelId, 'bare');
  assert.match(bare.content, /Automatic posts go in <#bare>\.\n-# Without Attach Files there.*\n-# Without Create Public Threads and Send Messages in Threads there/);

  // threads work without Pin Messages, so it's only a note, and one that can pin gets none
  const unpinned = await setup('picky', fakeChannel('unpinned'));
  assert.equal(forGuild('picky').channelId, 'unpinned');
  assert.match(unpinned.content, /Automatic posts go in <#unpinned>\.\n-# Without Pin Messages there, thread cards don't get pinned\./);
  const pinning = await setup('picky', fakeChannel('pinning', ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', ...THREADS, 'PinMessages']));
  assert.doesNotMatch(pinning.content, /Pin Messages/);
});

test('each server\'s posts channel is its own /t-o settings pick, with CHANNEL_ID only for the migrated server', async () => {
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

test('looking at a new server never saves an empty entry for it', async () => {
  delete process.env.GUILD_ID;
  delete process.env.CHANNEL_ID;
  assert.ok(!guildIds().includes('lurker'));
  await guildLocal.run('lurker', async () => {
    assert.deepEqual(state.buttons, []);
    assert.equal(postsChannelId(), null);
  });
  assert.ok(!guildIds().includes('lurker'));
});

test('dropping a server\'s cached channel makes the next check fetch it again', async () => {
  let fetches = 0;
  tracker.setBotClient({ channels: { fetch: async (id) => { fetches++; return { id, isTextBased: () => true }; } } });
  forGuild('dropped').channelId = 'cached-posts';
  assert.equal((await tracker.guildChannel('dropped')).id, 'cached-posts');
  assert.equal((await tracker.guildChannel('dropped')).id, 'cached-posts');
  assert.equal(fetches, 1, 'the second look costs no fetch');
  tracker.dropGuildChannel('dropped');
  assert.equal((await tracker.guildChannel('dropped')).id, 'cached-posts');
  assert.equal(fetches, 2);
});

test('checks skip servers the bot already left instead of fetching their channels', async () => {
  forGuild('left-behind').channelId = 'gone-posts';
  forGuild('gone-too').channelId = 'gone-posts';
  const fetched = [];
  tracker.setBotClient({
    guilds: { cache: new Map([['elsewhere', {}]]) },
    channels: { fetch: async (id) => { fetched.push(id); return null; } },
  });
  const seen = [];
  await tracker.eachGuild(async (id) => { seen.push(id); });
  assert.deepEqual(seen, []);
  assert.ok(!fetched.includes('gone-posts'), 'a left server costs no channel fetch');
  // the entry stays for if the bot rejoins
  assert.equal(forGuild('left-behind').channelId, 'gone-posts');
});

test('only the migrated server claims saved reg reminders in a multi-server build', async () => {
  process.env.GUILD_ID = 'home';
  try {
    state.regReminders = { 5: { id: 5, name: 'Local', slug: 'tournament/local', deadline: 99, next: 1, startAt: 100, endAt: 200, images: [] } };
    state.tournaments = {};
    // another server's pass leaves the root's reminders alone
    await guildLocal.run('away', async () => tracker.migrateTracking(1000));
    assert.ok(state.regReminders?.[5], 'another server must not take them');
    assert.equal(guildLocal.run('away', () => state.tournaments[5]), undefined);
    // the migrated server's pass claims them into its own tournaments
    await guildLocal.run('home', async () => tracker.migrateTracking(1000));
    assert.equal(guildLocal.run('home', () => state.tournaments[5]?.tracked?.by), 'manual');
    assert.equal(state.regReminders, undefined);
  } finally {
    delete process.env.GUILD_ID;
  }
});

test('finding your own start.gg also goes by what another server already knows, once start.gg confirms it', async () => {
  const startgg = await import('../src/startgg.js');
  const { findAccount } = await import('../src/accounts.js');
  startgg.setRequestGap(0);
  const originalFetch = globalThis.fetch;
  const asked = [];
  // start.gg has user 77 with this discord connected, and user 88 with someone else's
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    asked.push(query);
    const user = (id, discord) => ({ slug: `user/${id}`, images: [], player: { gamerTag: `Player ${id}` }, authorizations: [{ externalId: discord }] });
    return { ok: true, json: async () => ({ data: { u77: user(77, 'known-discord'), u88: user(88, 'someone-else') } }) };
  };
  try {
    forGuild('first-server').links['known-discord'] = { userId: 77, tag: 'Player 77' };
    forGuild('first-server').accounts['stale-discord'] = 88;
    forGuild('new-server');
    const found = await guildLocal.run('new-server', () => findAccount('known-discord'));
    assert.equal(found?.slug, 'user/77');
    assert.match(asked[0], /u77: user\(id: 77\)/);
    // a saved account start.gg no longer connects to this discord finds nobody
    assert.equal(await guildLocal.run('new-server', () => findAccount('stale-discord')), null);
    // nothing about the first server got copied into the new one
    assert.deepEqual(forGuild('new-server').links, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});
