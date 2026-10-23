import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// what people see after the bot was off, and while start.gg is
const directory = mkdtempSync(join(tmpdir(), 'sama-outage-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { writeHeartbeat, readHeartbeat } = await import('../src/store.js');
const tracker = await import('../src/tracker.js');
const embeds = await import('../src/embeds/index.js');
after(() => rmSync(directory, { recursive: true, force: true }));

const now = 2_000_000_000;
const HOUR = 3600;

function channel() {
  const sent = [];
  return { sent, send: async (message) => { sent.push(message); return { id: `m${sent.length}`, channelId: 'c1' }; } };
}

test('an outage is from the last heartbeat, and only when it was long enough to notice', () => {
  assert.equal(tracker.lastOutage(now), null, 'first start, no heartbeat yet');
  writeHeartbeat(now - 2 * 60);
  assert.equal(readHeartbeat(), now - 2 * 60);
  assert.equal(tracker.lastOutage(now), null, 'a redeploy takes a minute or two');
  writeHeartbeat(now - 2 * HOUR);
  assert.deepEqual(tracker.lastOutage(now), { from: now - 2 * HOUR, to: now });
});

test('the back online card says when, for how long, to send commands again, and what catches up', () => {
  const short = embeds.backOnline({ from: now - 2 * HOUR, to: now }, 3);
  assert.equal(short.data.title, 'Back online');
  assert.equal(short.data.description, [
    `**Down:** <t:${now - 2 * HOUR}:f> to <t:${now}:f>, about 2 hours`,
    'Commands sent then got Discord\'s "The application did not respond" and never reached the bot, so send them again.',
    'Set results from while it was down are posting now.',
  ].join('\n'));
  const long = embeds.backOnline({ from: now - 3 * 24 * HOUR, to: now }, 3);
  assert.match(long.data.description, /about 3 days\n.*\nSet results from the last 3 hours are posting now, and older ones are skipped\.$/);
  assert.match(embeds.backOnline({ from: now - 25 * 60, to: now }).data.description, /about 25 minutes/);
});

test('a new version after an outage says both on one card, and an outage alone gets back online', async () => {
  const outage = { from: now - 5 * HOUR, to: now };
  const both = channel();
  await tracker.postStartNotice({ deploy: { id: 'd9', at: now, message: 'Fix the crash' }, outage }, both);
  assert.equal(both.sent.length, 1);
  const [card] = both.sent[0].embeds;
  assert.equal(card.data.title, 'Bot updated');
  assert.match(card.data.description, /Fix the crash\n\n\*\*Down:\*\*.*about 5 hours\nCommands sent then/);
  assert.deepEqual(both.sent[0].allowedMentions, { parse: [] });

  const alone = channel();
  await tracker.postStartNotice({ outage }, alone);
  assert.equal(alone.sent[0].embeds[0].data.title, 'Back online');

  const neither = channel();
  await tracker.postStartNotice({}, neither);
  assert.equal(neither.sent.length, 0);

  // a failed send logs instead of throwing
  await tracker.postStartNotice({ outage }, { send: async () => { throw new Error('down'); } });
});

test('the bot\'s discord status says when start.gg is down, and changes only when that does', () => {
  const calls = [];
  const client = { user: { setPresence: (presence) => calls.push(presence) } };
  tracker.updatePresence(client, null);
  assert.equal(calls.length, 0, 'already showing fine');
  tracker.updatePresence(client, now);
  tracker.updatePresence(client, now);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'idle');
  assert.equal(calls[0].activities[0].state, 'start.gg is down, lookups wait until it\'s back');
  tracker.updatePresence(client, null);
  assert.deepEqual(calls[1], { status: 'online', activities: [] });
});

test('/status says when start.gg isn\'t answering', () => {
  const info = { startedAt: 100, setCheck: 200, tournamentCheck: 300, players: 2, tournaments: 1, queued: 0 };
  assert.doesNotMatch(embeds.status(info).data.description, /not answering/);
  assert.match(embeds.status({ ...info, startggDownSince: now }).data.description, new RegExp(`\\*\\*start\\.gg:\\*\\* not answering since <t:${now}:R>`));
});
