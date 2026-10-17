import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-messages-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleCommand } = await import('../src/commands/index.js');
const { postWeeklyRecap } = await import('../src/tracker.js');
after(() => rmSync(directory, { recursive: true, force: true }));

async function configure(values = {}, allowed = true) {
  let reply;
  await handleCommand({
    commandName: 'messages', memberPermissions: { has: permission => allowed && permission === PermissionFlagsBits.ManageGuild },
    options: { getSubcommand: () => null, getBoolean: name => values[name] ?? null,
      getString: name => values[name] ?? null, getInteger: name => values[name] ?? null },
    reply: async result => { reply = result; },
  });
  return reply;
}

test('message controls are registered for server managers', () => {
  const command = commands.find(c => c.name === 'messages');
  assert.equal(command?.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
  assert.deepEqual(command.options.filter(o => o.type === 5).map(o => o.name),
    ['sets', 'streams', 'rollcall', 'results', 'registration', 'recap']);
});

test('only managers can change settings', async () => {
  state.messages = {};
  const reply = await configure({ sets: false }, false);
  assert.match(reply.content, /Manage Server/);
  assert.deepEqual(state.messages, {});
});

test('message switches and recap schedule save immediately and return private settings', async () => {
  state.messages = {};
  const reply = await configure({ sets: false, streams: false, recap_day: 0, recap_time: '18:30', timezone: 'America/Los_Angeles' });
  assert.ok(reply.flags);
  assert.match(reply.content, /Set results: off/);
  assert.match(reply.content, /Sunday.*18:30.*America\/Los_Angeles/);
  const saved = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).messages;
  assert.equal(saved.sets, false);
  assert.equal(saved.results, undefined);
  assert.equal(saved.recapDay, 0);
  assert.equal(saved.recapTime, '18:30');
  assert.ok(saved.recapChangedAt > 0);
});

test('invalid schedules do not partially apply accompanying switches', async () => {
  for (const invalid of [{ recap_time: '25:00' }, { recap_time: '7:30' }, { timezone: 'no/such-zone' }]) {
    state.messages = {};
    const reply = await configure({ sets: false, ...invalid });
    assert.match(reply.content, /HH:MM|timezone/i);
    assert.deepEqual(state.messages, {});
  }
});

test('running messages without options shows defaults without writing settings', async () => {
  state.messages = {};
  const reply = await configure();
  assert.match(reply.content, /Set results: on/);
  assert.match(reply.content, /Sunday.*21:00.*America\/New_York/);
  assert.deepEqual(state.messages, {});
});

test('re-enabling categories saves cutoffs even if no muted poll happened', async () => {
  state.messages = { sets: false, streams: false, registration: false };
  await configure({ sets: true, streams: true, registration: true });
  assert.ok(state.messages.enabledAt?.sets > 0);
  assert.ok(state.messages.enabledAt.streams > 0);
  assert.ok(state.messages.enabledAt.registration > 0);
});

test('muting recap prevents fetches and pending message sends', async () => {
  state.messages = { recap: false };
  const until = Date.parse('2026-10-19T01:00:00Z') / 1000;
  state.weeklyRecap = { until, sent: 0, done: false, batches: [[{ description: 'Pending' }]] };
  await postWeeklyRecap({ send: async () => assert.fail('Recap is disabled') }, until);
});

test('turning the recap back on skips the overdue one', async () => {
  state.messages = { recap: false };
  await configure({ recap: true });
  assert.ok(state.messages.enabledAt.recap > 0);
  assert.equal(state.messages.recapChangedAt, undefined);

  const until = Date.parse('2026-10-19T01:00:00Z') / 1000;
  state.messages.enabledAt.recap = until + 60;
  state.weeklyRecap = undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => assert.fail('a skipped recap fetches nothing');
  try {
    await postWeeklyRecap({ send: async () => assert.fail('the overdue recap stays skipped') }, until + 120);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('schedule changes and re-enabling recap wait for the next due time', async () => {
  const until = Date.parse('2026-10-19T01:00:00Z') / 1000;
  state.messages = { recap: true, recapChangedAt: until + 60 };
  state.weeklyRecap = { until, sent: 0, done: false, batches: [[{ description: 'Old schedule' }]] };
  await postWeeklyRecap({ send: async () => assert.fail('Do not send the old recap') }, until + 120);
});
