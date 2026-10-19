import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

// backend scale: state survival, global queue cap, miss caching, old tournament prune, status numbers
const directory = mkdtempSync(join(tmpdir(), 'sama-scale-'));
process.env.STATE_DIR = directory;
delete process.env.ANTHROPIC_API_KEY;
// a half-written main file with a good backup: startup falls back instead of quitting
writeFileSync(join(directory, 'state.json'), '{broken');
writeFileSync(join(directory, 'state.json.bak'), JSON.stringify({ players: { 7: { userId: 7, tag: 'Backup' } } }));
const store = await import('../src/store.js');
const { state, save } = store;
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const { inTurn, QUEUED_GLOBAL_MAX } = await import('../src/commands/turns.js');
const tracker = await import('../src/tracker.js');
const { handleCommand } = await import('../src/commands/index.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);

test('a corrupt state file falls back to the backup instead of quitting', async () => {
  assert.equal(state.players[7].tag, 'Backup');
});

test('saves are counted and backed up', async () => {
  const before = store.saveCount;
  state.players = {};
  save();
  assert.equal(store.saveCount, before + 1);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).players, {});
  assert.ok(existsSync(join(directory, 'state.json.bak')));
});

test('past the global queue max, the newest command is turned away', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { currentUser: { id: 1 } } }) });
  // fired without awaiting, so nothing drains before the cap is checked
  const fired = Array.from({ length: QUEUED_GLOBAL_MAX + 5 }, () => startgg.checkToken());
  const extra = {
    commandName: 'stats',
    user: { id: 'u-busy' },
    options: { getSubcommandGroup: () => null, getSubcommand: () => null },
    answered: null,
    reply: async function (payload) { this.answered = payload; },
  };
  assert.equal(await inTurn(extra, () => {}), false);
  assert.match(extra.answered.content, /backed up/);
  assert.equal(extra.answered.flags, MessageFlags.Ephemeral);
  await Promise.all(fired);
  assert.equal(startgg.queueLength(), 0);
});

test('a profile or tournament link that misses stays missed for 5 minutes', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ data: { user: null, tournament: null } }) };
  };
  startgg.forgetMisses();
  assert.equal(await startgg.getPlayer('missing-person'), null);
  assert.equal(await startgg.getPlayer('missing-person'), null);
  assert.equal(await startgg.getRegistration('missing-tournament'), null);
  assert.equal(await startgg.getRegistration('missing-tournament'), null);
  assert.equal(calls, 2);
  startgg.forgetMisses();
  assert.equal(await startgg.getPlayer('missing-person'), null);
  assert.equal(calls, 3);
});

test('untracked tournaments a month past their end are forgotten, tracked ones stay', async () => {
  const old = { id: 1, name: 'Old', slug: 'tournament/old', startAt: now - 60 * 86400, endAt: now - 40 * 86400 };
  assert.equal(tracker.shouldForgetTournament(old, now), true);
  assert.equal(tracker.shouldForgetTournament({ ...old, tracked: { by: 'manual' } }, now), false);
  assert.equal(tracker.shouldForgetTournament({ ...old, startAt: now - 10 * 86400, endAt: now - 86400 }, now), false);
});

test('/status shows the state size and saves since start', async () => {
  state.players = {};
  state.tournaments = {};
  let reply;
  await handleCommand({
    commandName: 'status',
    options: { getSubcommandGroup: () => null, getSubcommand: () => null },
    client: { user: { displayAvatarURL: () => 'https://example.com/a.png' } },
    reply: async (result) => { reply = result; },
  });
  const text = reply.embeds[0].data.description;
  assert.match(text, /\*\*State:\*\* \d+ KB · \d+ saves? since start/);
});
