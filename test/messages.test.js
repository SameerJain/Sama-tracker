import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-messages-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleCommand } = await import('../src/commands/index.js');
const { postWeeklyRecap } = await import('../src/tracker.js');
after(() => rmSync(directory, { recursive: true, force: true }));

async function configure(values = {}, allowed = true, guild = undefined) {
  let reply;
  await handleCommand({
    commandName: 'messages', guild, memberPermissions: { has: permission => allowed && permission === PermissionFlagsBits.ManageGuild },
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
    ['sets', 'streams', 'calls', 'rollcall', 'results', 'top8', 'registration', 'events', 'slippi', 'recap', 'bills', 'set_colors']);
  // three modes, picked by name
  const threads = command.options.find(o => o.name === 'threads');
  assert.equal(threads.type, 3);
  assert.deepEqual(threads.choices.map(c => c.value), ['off', 'tournament', 'event']);
  assert.ok([threads.description, ...threads.choices.map(c => c.name)].every(text => text.length <= 100));
});

test('status answers where everyone sees it', async () => {
  let reply;
  await handleCommand({
    commandName: 'status',
    options: { getSubcommand: () => null },
    client: { user: { displayAvatarURL: () => 'https://cdn.example/avatar.png' } },
    reply: async (result) => { reply = result; },
  });
  assert.match(JSON.stringify(reply.embeds), /Status/);
  assert.equal(reply.flags, undefined);
});

test('only managers can change settings', async () => {
  state.messages = {};
  const reply = await configure({ sets: false }, false);
  assert.match(reply.content, /Manage Server/);
  assert.ok(reply.flags);
  assert.deepEqual(state.messages, {});
});

test('message switches and recap schedule save immediately and answer where everyone sees them', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-15T12:00:00Z') });
  state.messages = {};
  const reply = await configure({ sets: false, streams: false, recap_day: 0, recap_time: '18:30', timezone: 'America/Los_Angeles' });
  assert.equal(reply.flags, undefined);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
  assert.match(reply.content, /Set results:\*\* off/);
  assert.match(reply.content, /Sunday 18:30 PST/);
  const saved = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).messages;
  assert.equal(saved.sets, false);
  assert.equal(saved.results, undefined);
  assert.equal(saved.recapDay, 0);
  assert.equal(saved.recapTime, '18:30');
  assert.ok(saved.recapChangedAt > 0);
});

test('set result colors save and show, off until a small crew turns them on', async () => {
  const { setResultColors } = await import('../src/message-settings.js');
  state.messages = {};
  assert.equal(setResultColors(), false);
  assert.match((await configure()).content, /Set result colors:\*\* off/);

  const reply = await configure({ set_colors: true });
  assert.match(reply.content, /Set result colors:\*\* on/);
  assert.match(reply.content, /green for a tracked win, red for a loss, gold when two tracked players meet/);
  assert.equal(state.messages.setColors, true);
  assert.equal(setResultColors(), true);

  await configure({ set_colors: false });
  assert.equal(state.messages.setColors, false);
  assert.equal(setResultColors(), false);
});

test('invalid schedules do not partially apply accompanying switches', async () => {
  for (const invalid of [{ recap_time: '25:00' }, { recap_time: '7:30' }, { timezone: 'no/such-zone' }]) {
    state.messages = {};
    const reply = await configure({ sets: false, ...invalid });
    assert.match(reply.content, /HH:MM|timezone/i);
    assert.ok(reply.flags);
    assert.deepEqual(state.messages, {});
  }
});

test('running messages without options shows defaults without writing settings', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-15T12:00:00Z') });
  state.messages = {};
  const reply = await configure();
  assert.equal(reply.flags, undefined);
  assert.match(reply.content, /Set results:\*\* on/);
  // each person turns their own match calls on, and top 8s only come from tracked tournaments
  assert.match(reply.content, /Match call pings:\*\* on/);
  assert.match(reply.content, /Top 8s:\*\* on/);
  assert.match(reply.content, /Bills final results:\*\* off/);
  assert.match(reply.content, /Sunday 21:00 EST/);
  assert.deepEqual(state.messages, {});
});

test('threads footnote says each thread pins its card until the tournament or event ends', async () => {
  state.messages = {};
  const reply = await configure();
  assert.match(reply.content, /Each thread pins its channel card until the tournament or event ends/);
});

test('message timezone labels follow daylight saving', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-07-15T12:00:00Z') });
  state.messages = {};
  assert.match((await configure()).content, /Sunday 21:00 EDT/);
  assert.match((await configure({ timezone: 'America/Los_Angeles' })).content, /Sunday 21:00 PDT/);
});

test('message timezone labels keep the IANA zone when there is no short abbreviation', async () => {
  state.messages = {};
  assert.match((await configure({ timezone: 'Asia/Tokyo' })).content, /Sunday 21:00 Asia\/Tokyo/);
});

test('re-enabling categories saves cutoffs even if no muted poll happened', async () => {
  state.messages = { sets: false, streams: false, registration: false };
  await configure({ sets: true, streams: true, registration: true });
  assert.ok(state.messages.enabledAt?.sets > 0);
  assert.ok(state.messages.enabledAt.streams > 0);
  assert.ok(state.messages.enabledAt.registration > 0);
});

test('only Bills finals and Discord events start off server-wide, and turning match calls back on skips what came due', async () => {
  const { messageEnabled, messageSettings } = await import('../src/message-settings.js');
  state.messages = {};
  assert.equal(messageSettings().calls, true);
  assert.equal(messageSettings().top8, true);
  assert.equal(messageSettings().bills, false);
  assert.equal(messageEnabled('bills'), false);
  assert.equal(messageSettings().events, false);
  assert.equal(messageEnabled('events'), false);
  assert.equal(messageSettings().sets, true);

  state.messages = { calls: false };
  await configure({ calls: true });
  assert.equal(state.messages.calls, true);
  assert.ok(state.messages.enabledAt?.calls > 0);
  assert.equal(messageEnabled('calls', state.messages.enabledAt.calls - 60), false);
  assert.equal(messageEnabled('calls', state.messages.enabledAt.calls), true);
});

test('turning Discord events on checks for Manage Events first', async () => {
  state.messages = {};
  const guild = (allowed) => ({
    scheduledEvents: { create: async () => ({}) },
    members: { me: { permissions: { has: () => allowed } } },
  });
  const refused = await configure({ events: true }, true, guild(false));
  assert.match(refused.content, /Manage Events/);
  assert.equal(refused.flags, MessageFlags.Ephemeral);
  assert.equal(state.messages.events, undefined);

  const turnedOn = await configure({ events: true }, true, guild(true));
  assert.match(turnedOn.content, /Discord events for tracked tournaments:\*\* on/);
  assert.equal(state.messages.events, true);
  // already on, so turning something else on doesn't check again
  const other = await configure({ sets: true }, true, guild(false));
  assert.match(other.content, /Set results:\*\* on/);
  state.messages = {};
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
