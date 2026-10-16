import assert from 'node:assert/strict';
import test from 'node:test';
import { periodSummary, weeklyPeriod } from '../src/reports.js';

const player = { playerId: 1 };
const event = (game, startAt) => ({ videogame: { displayName: game }, startAt, numEntrants: 32 });
const set = (id, completedAt, won = true, game = 'Ultimate', dq = false) => ({
  id, completedAt, winnerId: won ? 10 : 20, event: event(game, completedAt),
  sides: [{ id: 10, playerIds: [1], score: dq ? -1 : 2 }, { id: 20, playerIds: [2], score: 1 }],
});

test('period summaries use exact boundaries, exclude DQs, and separate games', () => {
  const summary = periodSummary(player, [
    set('old', 99), set('start', 100), set('loss', 150, false),
    set('dq', 160, false, 'Ultimate', true), set('melee', 170, true, 'Melee'), set('end', 200),
  ], [
    { event: event('Ultimate', 100), placement: 5, seed: 9 },
    { event: event('Ultimate', 150), placement: 9, seed: null },
    { event: event('Ultimate', 160), placement: 32, seed: 1, dq: true },
  ], 100, 200);
  assert.equal(summary.played.length, 3);
  assert.deepEqual(summary.games.map(g => [g.game, g.wins, g.losses]), [['Ultimate', 1, 1], ['Melee', 1, 0]]);
  assert.equal(summary.games[0].events.length, 2);
  assert.equal(summary.games[0].events[0].seed, 9);
});

test('a DQ alone does not count as competing', () => {
  assert.equal(periodSummary(player, [set('dq', 150, false, 'Ultimate', true)], [], 100, 200).played.length, 0);
});

test('Sunday recap runs at 9 pm New York time and allows one day to catch up', () => {
  const due = Date.parse('2026-10-19T01:00:00Z') / 1000;
  assert.equal(weeklyPeriod(due - 1), null);
  assert.deepEqual(weeklyPeriod(due), { since: due - 7 * 86400, until: due, next: due + 7 * 86400 });
  assert.deepEqual(weeklyPeriod(due + 3600), { since: due - 7 * 86400, until: due, next: due + 7 * 86400 });
  assert.equal(weeklyPeriod(due + 86400), null);
});

test('recap boundaries follow daylight saving time in both directions', () => {
  const fall = weeklyPeriod(Date.parse('2026-11-02T02:00:00Z') / 1000);
  assert.equal(fall.until - fall.since, 169 * 3600);
  const spring = weeklyPeriod(Date.parse('2026-03-09T01:00:00Z') / 1000);
  assert.equal(spring.until - spring.since, 167 * 3600);
});

test('the upcoming week ends at next Sunday 9 pm across daylight saving changes', () => {
  const fall = weeklyPeriod(Date.parse('2026-10-26T01:00:00Z') / 1000);
  assert.equal(fall.next - fall.until, 169 * 3600);
  const spring = weeklyPeriod(Date.parse('2026-03-02T02:00:00Z') / 1000);
  assert.equal(spring.next - spring.until, 167 * 3600);
});

test('recap supports a custom day, minute and timezone', () => {
  const until = Date.parse('2026-10-21T13:45:00Z') / 1000;
  const schedule = { recapDay: 3, recapTime: '19:30', timezone: 'Asia/Kathmandu' };
  assert.equal(weeklyPeriod(until, schedule).until, until);
  assert.equal(weeklyPeriod(until - 1, schedule), null);
});

test('recap shifts nonexistent local times forward and chooses the first repeated time', () => {
  const spring = Date.parse('2026-03-08T07:30:00Z') / 1000;
  assert.equal(weeklyPeriod(spring, { recapTime: '02:30' }).until, spring);
  const fall = Date.parse('2026-11-01T05:30:00Z') / 1000;
  assert.equal(weeklyPeriod(fall, { recapTime: '01:30' }).until, fall);
});
