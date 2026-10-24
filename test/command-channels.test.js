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
const { handleCommand } = await import('../src/commands/index.js');
after(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
  state.messages = {};
});

// a server with these channels, so a saved one that was deleted can be told apart
const guild = (...ids) => ({ id: 'server', channels: { cache: new Map(ids.map((id) => [id, { id }])) } });

// runs a command in a channel, or in a thread of parent, and says what it answered
async function run(commandName, { channelId = 'general', parent = null, subcommand = null, server = guild('bots', 'stats', 'general') } = {}) {
  let reply;
  const channel = parent ? { id: channelId, parentId: parent, isThread: () => true } : { id: channelId, isThread: () => false };
  await handleCommand({
    commandName, channelId, channel, guild: server, user: { id: 'someone' },
    memberPermissions: { has: () => true },
    options: {
      getSubcommandGroup: () => null, getSubcommand: () => subcommand, getBoolean: () => null, getString: () => null,
      getInteger: () => null, getChannel: () => null,
    },
    reply: async (result) => { reply = result; },
  });
  return reply;
}

test('with no channels picked, commands work everywhere', async () => {
  const reply = await run('help');
  assert.ok(reply.embeds?.length, 'help answered');
});

test('picked channels are the only place commands work, threads in them included', async () => {
  state.messages = { commandChannels: ['bots', 'stats'] };
  const refused = await run('help', { channelId: 'general' });
  assert.equal(refused.content, 'Use the bot in <#bots> and <#stats>. A TO picks where with `/t-o settings commands_channel:`.');
  assert.ok(refused.flags & MessageFlags.Ephemeral, 'only whoever ran it sees it');
  assert.ok((await run('help', { channelId: 'bots' })).embeds?.length);
  assert.ok((await run('help', { channelId: 'a-thread', parent: 'stats' })).embeds?.length);
});

test('/t-o works anywhere, so a TO can always change where commands go', async () => {
  state.messages = { commandChannels: ['bots'] };
  const reply = await run('t-o', { channelId: 'general', subcommand: 'settings' });
  assert.doesNotMatch(reply.content, /^Use the bot in/);
});

test('a picked channel that was deleted stops counting, so the bot is never locked out', async () => {
  state.messages = { commandChannels: ['gone'] };
  assert.ok((await run('help', { channelId: 'general' })).embeds?.length);
  state.messages = { commandChannels: ['gone', 'bots'] };
  assert.match((await run('help', { channelId: 'general' })).content, /^Use the bot in <#bots>\./);
});

test('the refusal reads in the server\'s language', async () => {
  state.messages = { commandChannels: ['bots'], language: 'es' };
  assert.match((await run('help', { channelId: 'general' })).content, /<#bots>/);
  assert.doesNotMatch((await run('help', { channelId: 'general' })).content, /^Use the bot/);
});
