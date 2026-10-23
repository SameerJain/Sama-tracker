import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// single-server mode is the default: no MULTI_GUILD flag, so /t-o settings channel stays out and
// everything reads the root state, exactly like before multi-server support
const directory = mkdtempSync(join(tmpdir(), 'sama-single-'));
process.env.STATE_DIR = directory;
delete process.env.MULTI_GUILD;
delete process.env.ANTHROPIC_API_KEY;
const { isMultiGuild } = await import('../src/store.js');
const { commands } = await import('../src/commands/definitions.js');
const { help } = await import('../src/embeds/system.js');
after(() => rmSync(directory, { recursive: true, force: true }));

test('single-server builds have no channel setting and read the root', async () => {
  assert.equal(isMultiGuild(), false);
  const settings = commands.find((command) => command.name === 't-o').options.find((option) => option.name === 'settings');
  assert.equal(settings.options.some((option) => option.name === 'channel'), false, 'single-server builds post in CHANNEL_ID');
  // registered to the one server, so they never show in DMs and need no contexts
  assert.ok(commands.every((command) => command.contexts === undefined));
  assert.doesNotMatch(JSON.stringify(help(false)), /\/t-o settings channel:/);
});
