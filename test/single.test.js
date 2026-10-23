import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// single-server mode is the default: no MULTI_GUILD flag, so /settings channel stays out and
// everything reads the root state, exactly like before multi-server support
const directory = mkdtempSync(join(tmpdir(), 'sama-single-'));
process.env.STATE_DIR = directory;
delete process.env.MULTI_GUILD;
delete process.env.ANTHROPIC_API_KEY;
const { isMultiGuild } = await import('../src/store.js');
const { commands } = await import('../src/commands/definitions.js');
const { help } = await import('../src/embeds/system.js');
after(() => rmSync(directory, { recursive: true, force: true }));

test('single-server builds have no /settings channel and read the root', async () => {
  assert.equal(isMultiGuild(), false);
  const settings = commands.find((command) => command.name === 'settings');
  assert.deepEqual(settings.options.map((option) => option.name), ['posts', 'recap'], 'single-server builds post in CHANNEL_ID');
  // registered to the one server, so they never show in DMs and need no contexts
  assert.ok(commands.every((command) => command.contexts === undefined));
  assert.doesNotMatch(JSON.stringify(help(false)), /\/settings channel/);
  assert.doesNotMatch(JSON.stringify(help(true)), /`\/settings channel`/);
});
