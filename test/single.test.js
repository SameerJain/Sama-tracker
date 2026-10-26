import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// single-server mode is the default: its channel setting and other data live on the root
const directory = mkdtempSync(join(tmpdir(), 'sama-single-'));
process.env.STATE_DIR = directory;
delete process.env.MULTI_GUILD;
delete process.env.ANTHROPIC_API_KEY;
const { isMultiGuild } = await import('../src/store.js');
const { commands } = await import('../src/commands/definitions.js');
const { help } = await import('../src/embeds/system.js');
after(() => rmSync(directory, { recursive: true, force: true }));

test('single-server builds can pick one channel and read the root', async () => {
  assert.equal(isMultiGuild(), false);
  const settings = commands.find((command) => command.name === 't-o').options.find((option) => option.name === 'settings');
  assert.equal(settings.options.some((option) => option.name === 'channel'), true, 'single-server builds can replace CHANNEL_ID with their saved channel');
  // registered to the one server, so they never show in DMs and need no contexts
  assert.ok(commands.every((command) => command.contexts === undefined));
  assert.match(JSON.stringify(help(false)), /\/t-o settings channel:/);
});


test('the saved single-server channel overrides the environment default', async () => {
  const { state, postsChannelId } = await import('../src/store.js');
  const previous = process.env.CHANNEL_ID;
  try {
    process.env.CHANNEL_ID = 'default';
    state.channelId = null;
    assert.equal(postsChannelId(), 'default');
    state.channelId = 'picked';
    assert.equal(postsChannelId(), 'picked');
  } finally {
    state.channelId = null;
    if (previous === undefined) delete process.env.CHANNEL_ID;
    else process.env.CHANNEL_ID = previous;
  }
});
