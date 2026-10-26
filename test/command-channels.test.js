import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-channels-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleButton, handleCommand } = await import('../src/commands/index.js');
after(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
  state.messages = {};
});

// a server with these channels, so a saved one that was deleted can be told apart
const guild = (...ids) => ({ id: 'server', channels: { cache: new Map(ids.map((id) => [id, { id }])) } });

// runs a command in a channel, or in a thread of parent, with these option values, and says what it answered.
// a long answer's follow-ups are joined onto the reply
async function run(commandName, { channelId = 'general', parent = null, subcommand = null, values = {}, server = guild('bots', 'stats', 'general') } = {}) {
  const parts = [];
  const channel = parent ? { id: channelId, parentId: parent, isThread: () => true } : { id: channelId, isThread: () => false };
  const value = (name) => values[name] ?? null;
  await handleCommand({
    commandName, channelId, channel, guild: server, user: { id: 'someone' },
    memberPermissions: { has: () => true },
    options: {
      getSubcommandGroup: () => null, getSubcommand: () => subcommand, getBoolean: value, getString: value,
      getInteger: value, getChannel: value,
    },
    reply: async (result) => { parts.push(result); },
    followUp: async (result) => { parts.push(result); },
  });
  return parts.length > 1 ? { ...parts[0], content: parts.map((part) => part.content).join('\n') } : parts[0];
}

const settings = (values) => run('t-o', { subcommand: 'settings', values });

test('the posts channel is the one place for public commands, including its threads', async () => {
  state.channelId = 'bots';
  state.messages.commandChannels = ['stats'];
  const refused = await run('help', { channelId: 'general' });
  assert.match(refused.content, /Use the bot in <#bots>/);
  assert.ok(refused.flags & MessageFlags.Ephemeral);
  assert.ok((await run('help', { channelId: 'bots' })).embeds?.length);
  assert.ok((await run('help', { channelId: 'a-thread', parent: 'bots' })).embeds?.length);
  assert.match((await run('help', { channelId: 'stats' })).content, /Use the bot in <#bots>/);
});

test('settings remain available privately anywhere, including before a channel is set', async () => {
  state.channelId = 'bots';
  const reply = await settings({});
  assert.match(reply.content, /Posts channel:\*\* <#bots>/);
  assert.ok(reply.flags & MessageFlags.Ephemeral);
  state.channelId = null;
  assert.match((await run('help')).content, /t-o settings channel:/);
});

test('the separate command-channel options are gone in both modes', async () => {
  const { commands } = await import('../src/commands/definitions.js');
  const options = commands.find(command => command.name === 't-o').options.find(option => option.name === 'settings').options;
  assert.ok(options.some(option => option.name === 'channel'));
  assert.ok(!options.some(option => ['commands_channel', 'commands_anywhere'].includes(option.name)));
});

test('matchmaking keeps its channel choice outside the bot channel', async () => {
  state.channelId = 'bots';
  const reply = await run('matchmaking', { subcommand: 'channel', values: { game: 'ult' } });
  assert.match(reply.content, /Ultimate.*searches post wherever the command runs/);
});

test('changing the single-server channel switches replies and background posts together', async () => {
  const { currentChannel } = await import('../src/tracker.js');
  const { postsChannelId } = await import('../src/store.js');
  const channel = { id: 'stats', isTextBased: () => true };
  const reply = await settings({ channel });
  assert.ok(reply.flags & MessageFlags.Ephemeral);
  assert.equal(postsChannelId(), 'stats');
  assert.equal(currentChannel(), channel);
  assert.ok((await run('help', { channelId: 'stats' })).embeds?.length);
  assert.match((await run('help', { channelId: 'bots' })).content, /Use the bot in <#stats>/);
});

test('public report buttons in the old channel point to the new bot channel', async () => {
  state.channelId = 'bots';
  let reply;
  await handleButton({
    channelId: 'old', customId: 'new:stats:crew:::::', user: { id: 'someone' },
    reply: async (result) => { reply = result; },
    deferReply: async () => assert.fail('old channel must not start a public report'),
  });
  assert.match(reply.content, /Use the bot in <#bots>/);
  assert.ok(reply.flags & MessageFlags.Ephemeral);
});
