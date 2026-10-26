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

test('commands_anywhere:False with a channel only adds it, so a second pick can\'t lift the limit', async () => {
  const added = await settings({ commands_channel: { id: 'bots' }, commands_anywhere: false });
  assert.match(added.content, /^Bot commands only work in <#bots> now\./);
  assert.deepEqual(state.messages.commandChannels, ['bots']);
  assert.match((await run('help', { channelId: 'general' })).content, /^Use the bot in <#bots>\./);

  const again = await settings({ commands_channel: { id: 'bots' }, commands_anywhere: false });
  assert.deepEqual(state.messages.commandChannels, ['bots']);
  assert.match(again.content, /\*\*Bot commands:\*\* <#bots>/);
  assert.match((await run('help', { channelId: 'general' })).content, /^Use the bot in <#bots>\./);
});

test('picking a listed channel takes it off, and the reply says so first', async () => {
  await settings({ commands_channel: { id: 'bots' } });
  const both = await settings({ commands_channel: { id: 'stats' } });
  assert.match(both.content, /^Bot commands only work in <#bots> and <#stats> now\./);
  const one = await settings({ commands_channel: { id: 'bots' } });
  assert.match(one.content, /^Took <#bots> off the list\. Bot commands only work in <#stats> now\./);
  const none = await settings({ commands_channel: { id: 'stats' } });
  assert.match(none.content, /^Took <#stats> off the list\. Bot commands work in every channel now\./);
  assert.ok((await run('help', { channelId: 'general' })).embeds?.length);
});

test('commands_anywhere:False alone, with nothing picked, asks for a channel', async () => {
  const reply = await settings({ commands_anywhere: false });
  assert.equal(reply.content, 'Pick the channel bot commands should work in with `commands_channel`.');
  assert.ok(reply.flags & MessageFlags.Ephemeral);
  assert.equal(state.messages.commandChannels, undefined);
});
