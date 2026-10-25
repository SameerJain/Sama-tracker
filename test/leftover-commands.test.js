import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// switching between single-server and multi-server leaves the other mode's commands registered, which
// discord lists next to the new ones
const directory = mkdtempSync(join(tmpdir(), 'sama-leftover-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { clearLeftoverCommands } = await import('../src/commands/index.js');
after(() => rmSync(directory, { recursive: true, force: true }));

// a command manager, like guild.commands or client.application.commands, that keeps what it was set to
function manager(fails = false) {
  const each = { setTo: null };
  each.set = async (commands) => {
    if (fails) throw new Error('Missing Access');
    each.setTo = commands;
  };
  return each;
}

test('each leftover command list is cleared', async () => {
  const servers = [manager(), manager()];
  await clearLeftoverCommands(servers);
  assert.deepEqual(servers.map((each) => each.setTo), [[], []]);
});

test('a server that won\'t clear only gets logged, and the rest still clear', async () => {
  const logged = mock.method(console, 'error', () => {});
  const servers = [manager(true), manager()];
  await clearLeftoverCommands(servers);
  assert.equal(servers[1].setTo.length, 0);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(logged.mock.calls[0].arguments[0], /Missing Access/);
  logged.mock.restore();
});
