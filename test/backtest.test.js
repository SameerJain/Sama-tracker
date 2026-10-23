import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-backtest-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { backtest, score, report } = await import('../scripts/backtest.js');
after(() => rmSync(directory, { recursive: true, force: true }));

const DAY = 86400;
const start = 1_700_000_000;
const players = [1, 2, 3, 4].map((playerId) => ({ playerId, tag: `P${playerId}`, slug: `user/p${playerId}` }));
let id = 0;

// a finished singles set the way getSetHistory has it, from the first player's side
function set(me, them, won, day, { mySeed = null, theirSeed = null } = {}) {
  const sides = [
    { id: me * 100 + day, name: `P${me}`, playerIds: [me], score: won ? 2 : 0, seed: mySeed },
    { id: them * 100 + day, name: `P${them}`, playerIds: [them], score: won ? 0 : 2, seed: theirSeed },
  ];
  return {
    id: `s${++id}`, completedAt: start + day * DAY, winnerId: won ? sides[0].id : sides[1].id,
    event: { slug: `tournament/w${day}/event/singles`, videogame: { displayName: 'Ultimate' }, tournament: { name: `Weekly ${day}` } },
    sides,
  };
}

// each player's history holds every set they played, newest first, with the opponent's side first in theirs
function histories(sets) {
  const flipped = (each) => ({ ...each, sides: [each.sides[1], each.sides[0]] });
  return new Map(players.map((player) => [String(player.playerId), {
    player,
    sets: sets.filter((each) => each.sides.some((side) => side.playerIds[0] === player.playerId))
      .map((each) => (each.sides[0].playerIds[0] === player.playerId ? each : flipped(each)))
      .sort((x, y) => y.completedAt - x.completedAt),
    events: null,
  }]));
}

// player 1 is best and 4 worst, and upsets happen a quarter of the time. a fixed pattern keeps it repeatable
function season() {
  const sets = [];
  let day = 0;
  for (let week = 0; week < 12; week++) {
    for (const [x, y] of [[1, 2], [1, 3], [2, 4], [3, 4], [1, 4], [2, 3]]) {
      sets.push(set(x, y, (week + x + y) % 4 !== 0, ++day, { mySeed: x, theirSeed: y }));
    }
  }
  // an opponent outside the pool counts as history but isn't scored
  sets.push(set(1, 99, true, ++day));
  return sets;
}

test('every set between two of the players gets scored once, oldest first, and outside opponents only count as history', () => {
  const sets = season();
  const results = backtest(histories(sets));
  const ids = results.map((result) => result.setId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes(sets.at(-1).id));
  assert.deepEqual(results.map((result) => result.at), [...results.map((result) => result.at)].sort((x, y) => x - y));
  // the very first meeting has nothing before it to go on
  assert.ok(!ids.includes(sets[0].id));
  assert.ok(results.length > 60, `${results.length}`);
});

test('a set\'s own result never counts toward its odds', () => {
  const sets = season();
  const before = backtest(histories(sets));
  const last = sets.findLast((each) => each.sides[1].playerIds[0] !== 99);
  const flipped = sets.map((each) => (each === last ? { ...each, winnerId: each.sides.find((side) => side.id !== each.winnerId).id } : each));
  const after = backtest(histories(flipped));
  const odds = (results) => results.find((result) => result.setId === last.id);
  assert.equal(odds(after).chance, odds(before).chance);
  assert.notEqual(odds(after).won, odds(before).won);
});

test('a crew where the better player usually wins beats a coin flip', () => {
  const { n, logLoss, brier, favouriteWon } = score(backtest(histories(season())));
  assert.ok(n > 60);
  assert.ok(logLoss < Math.LN2, `${logLoss}`);
  assert.ok(brier < 0.25, `${brier}`);
  assert.ok(favouriteWon > 0.6, `${favouriteWon}`);
});

test('scores, calibration and the printout come out right on known odds', () => {
  const scored = score([{ chance: 0.8, won: true }, { chance: 0.8, won: false }, { chance: 0.3, won: false }]);
  assert.equal(scored.n, 3);
  assert.ok(Math.abs(scored.logLoss - -(Math.log(0.8) + Math.log(0.2) + Math.log(0.7)) / 3) < 1e-12);
  assert.ok(Math.abs(scored.brier - (0.04 + 0.64 + 0.09) / 3) < 1e-12);
  // side 1 was the favourite at 70% in the last one, and won
  assert.ok(Math.abs(scored.favouriteWon - 2 / 3) < 1e-12);
  const [, , seventies, eighties] = scored.buckets;
  assert.deepEqual([seventies.n, seventies.won], [1, 1]);
  assert.equal(eighties.n, 2);
  assert.ok(Math.abs(eighties.said - 0.8) < 1e-12);
  assert.equal(eighties.won, 0.5);

  const printed = report(scored);
  assert.match(printed, /^3 sets\nlog loss 0\.7298 \(coin flip 0\.6931\)\nbrier 0\.2567 \(coin flip 0\.2500\)\nfavourite won 66\.7%/);
  assert.match(printed, /80\.0%-90\.0%\s+2\s+80\.0%\s+50\.0%/);
  assert.match(report(score([])), /No sets/);
});
