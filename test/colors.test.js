import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-colors-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { colors } = await import('../src/embeds/shared.js');
const embeds = await import('../src/embeds/index.js');
after(() => rmSync(directory, { recursive: true, force: true }));

// what /messages set_colors paints set results with
const OUTCOMES = ['win', 'loss', 'clash', 'setDefault'];
// cards that land in the channel next to set results. slippi and the games keep their own brand colors
const NEAR_RESULTS = ['brand', 'live', 'stream', 'regEarly', 'reg', 'results', 'thread', 'system', 'reset'];

// how far apart two colors look, weighting red, green and blue the way eyes do ("redmean")
function distance(a, b) {
  const [r1, g1, b1] = [a >> 16, (a >> 8) & 0xff, a & 0xff];
  const [r2, g2, b2] = [b >> 16, (b >> 8) & 0xff, b & 0xff];
  const r = (r1 + r2) / 2;
  return Math.sqrt((2 + r / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - r) / 256) * (b1 - b2) ** 2);
}

test('every color means one thing', () => {
  const byHex = Map.groupBy(Object.entries(colors), ([, hex]) => hex);
  const shared = [...byHex.values()].filter((keys) => keys.length > 1).map((keys) => keys.map(([key]) => key).join(' and '));
  assert.deepEqual(shared, []);
});

test('nothing next to set results looks like a win, a loss or crew vs crew', () => {
  for (const key of NEAR_RESULTS) {
    for (const outcome of OUTCOMES) {
      // above where the old rose match calls (52 from the loss red) and red last calls (81) sat, which read as losses
      assert.ok(distance(colors[key], colors[outcome]) > 85, `${key} is too close to ${outcome}`);
    }
  }
  // the old ones, so the check above would have caught them
  assert.ok(distance(0xe11d48, colors.loss) < 85);
  assert.ok(distance(0xdc2626, colors.loss) < 85);
});

const soon = { id: 1, slug: 'tournament/local', name: 'Local', startAt: Math.floor(Date.now() / 1000) + 3600, city: 'Buffalo', images: [] };
const set = {
  id: 9, round: 'Winners Round 1', station: 4,
  event: { name: 'Ultimate Singles', videogame: { displayName: 'Ultimate' }, tournament: { name: 'Local', slug: 'tournament/local' } },
  sides: [{ id: 1, name: 'Crew', playerIds: [10] }, { id: 2, name: 'Rival', playerIds: [20] }],
};

test('cards take their color from what they are', () => {
  // during a tournament
  assert.equal(embeds.matchCall(set, {}).data.color, colors.live);
  assert.equal(embeds.onStream(set, {}).data.color, colors.stream);
  // reminders get more urgent toward the deadline. the start DM is a reminder too, not a live card
  assert.equal(embeds.regReminder(soon, soon.startAt, false).data.color, colors.regEarly);
  assert.equal(embeds.startReminder(soon).data.color, colors.regEarly);
  assert.equal(embeds.regReminder(soon, soon.startAt, true).data.color, colors.reg);
  assert.equal(embeds.regWarning(soon, soon.startAt).data.color, colors.reg);
  // slippi cards without a rank
  assert.equal(embeds.slippiLeaderboard({}, {})[0].data.color, colors.slippi);
});
