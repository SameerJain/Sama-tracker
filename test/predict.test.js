import assert from 'node:assert/strict';
import test from 'node:test';
import { predict } from '../src/predict.js';
import * as embeds from '../src/embeds/index.js';

const DAY = 86400;
const now = 2_000_000_000;
const a = { playerId: 1, tag: 'A', slug: 'user/a' };
const b = { playerId: 2, tag: 'B', slug: 'user/b' };
let id = 0;

// a set from me's side, the way the set histories have it
function set(me, them, won, { mySeed = null, theirSeed = null, event = `e${++id}`, entrants = 32, daysAgo = 10, game = 'Ultimate' } = {}) {
  return {
    id: `s${++id}`, completedAt: now - daysAgo * DAY, winnerId: won ? me : them,
    event: { slug: `tournament/${event}/event/singles`, videogame: { displayName: game }, tournament: { name: event }, numEntrants: entrants },
    sides: [
      { id: me, name: `P${me}`, playerIds: [me], score: won ? 2 : 0, seed: mySeed },
      { id: them, name: `P${them}`, playerIds: [them], score: won ? 0 : 2, seed: theirSeed },
    ],
  };
}
// the same sets as they show up in the other player's history
const mirror = (sets) => sets.map((each) => ({ ...each, sides: [each.sides[1], each.sides[0]] }));
// one event history entry per bracket, with their seed and its size
const eventsOf = (sets) => [...new Map(sets.map((each) => [each.event.slug, { seed: each.sides[0].seed, placement: 9, event: { ...each.event, startAt: each.completedAt } }])).values()];

test('the odds are the same from either side', () => {
  const historyA = [set(1, 2, true, { mySeed: 2, theirSeed: 6 }), set(1, 9, true, { mySeed: 2, theirSeed: 12 }), set(1, 9, false, { mySeed: 3, theirSeed: 1 })];
  const historyB = [...mirror(historyA.slice(0, 1)), set(2, 9, false, { mySeed: 6, theirSeed: 12 }), set(2, 8, true, { mySeed: 5, theirSeed: 9 })];
  const forward = predict(a, b, historyA, historyB, { now });
  const backward = predict(b, a, historyB, historyA, { now });
  assert.ok(Math.abs(forward.chance + backward.chance - 1) < 1e-9);
});

test('a lopsided head-to-head goes well past 75%, and an even one stays near 50%', () => {
  const tenOh = Array.from({ length: 10 }, (_, i) => set(1, 2, true, { daysAgo: i * 15 }));
  assert.ok(predict(a, b, tenOh, mirror(tenOh), { now }).chance > 0.85);
  const even = Array.from({ length: 12 }, (_, i) => set(1, 2, i % 2 === 0, { daysAgo: i * 15 }));
  assert.ok(Math.abs(predict(a, b, even, mirror(even), { now }).chance - 0.5) < 0.03);
});

test('seeding counts by how much higher, not just how often', () => {
  // seeded 4 and 5 every week and 6-6 against each other: always "higher", but barely
  const close = Array.from({ length: 12 }, (_, i) => set(1, 2, i % 2 === 0, { mySeed: 4, theirSeed: 5, event: `w${i}`, daysAgo: i * 10 }));
  const odds = predict(a, b, close, mirror(close), { now });
  assert.equal(odds.seeding.higher, 12);
  assert.ok(odds.chance > 0.45 && odds.chance < 0.58, `${odds.chance}`);
  // seeded 1 and 14 every week. with only these 6 sets there's little to say how much seeding matters
  // in this game, so it stays short of what a full history would give
  const far = Array.from({ length: 6 }, (_, i) => set(1, 2, i !== 3, { mySeed: 1, theirSeed: 14, event: `w${i}`, daysAgo: i * 10 }));
  const farOdds = predict(a, b, far, mirror(far), { now });
  assert.ok(farOdds.chance > 0.75 && farOdds.chance - odds.chance > 0.2, `${farOdds.chance}`);
});

test('bracket sizes from the event histories tell a top seed at majors from one at locals', () => {
  const pro = Array.from({ length: 40 }, (_, i) => set(1, 100 + i, i % 4 !== 0, { mySeed: 10, theirSeed: i % 4 ? 60 : 5, entrants: 500, event: `major${i % 8}` }));
  const local = Array.from({ length: 40 }, (_, i) => set(2, 200 + i, i % 2 === 0, { mySeed: 18, theirSeed: i % 2 ? 6 : 22, entrants: 24, event: `local${i % 10}` }));
  const odds = predict(a, b, pro, local, { now, eventsA: eventsOf(pro), eventsB: eventsOf(local) });
  assert.ok(odds.chance > 0.85, `${odds.chance}`);
  assert.equal(Math.round(odds.level.a.share * 100), 2);
  // they never met and never shared a bracket, so without the sizes there's nothing to go on
  assert.ok(Math.abs(predict(a, b, pro, local, { now }).chance - 0.5) < 0.05);
});

test('newer sets count more than old ones', () => {
  const sets = [
    ...Array.from({ length: 4 }, (_, i) => set(1, 2, true, { daysAgo: 5 + i })),
    ...Array.from({ length: 4 }, (_, i) => set(1, 2, false, { daysAgo: 1100 + i })),
  ];
  assert.ok(predict(a, b, sets, mirror(sets), { now }).chance > 0.6);
});

test('a picked game is used even if they play another more, and null if they never both played it', () => {
  const ultimate = Array.from({ length: 6 }, (_, i) => set(1, 2, true, { daysAgo: i }));
  const melee = [set(1, 2, false, { game: 'Melee' })];
  const sets = [...ultimate, ...melee];
  assert.equal(predict(a, b, sets, mirror(sets), { now }).game, 'Ultimate');
  const odds = predict(a, b, sets, mirror(sets), { now, game: 'Melee' });
  assert.equal(odds.game, 'Melee');
  assert.equal(odds.h2h.total, 1);
  assert.equal(predict(a, b, ultimate, mirror(ultimate), { now, game: 'Melee' }), null);
});

test('verbose says how the parts add up and how much a seed is worth', () => {
  const sets = Array.from({ length: 8 }, (_, i) => set(1, 2, i < 6, { mySeed: 2, theirSeed: 6, event: `w${i}`, daysAgo: i * 7 }));
  const odds = predict(a, b, sets, mirror(sets), { now });
  const text = embeds.prediction(a, b, odds, true).map((embed) => embed.data.description).join('\n');
  assert.match(text, /\*\*Head-to-head:\*\* counts for \d+% · on its own, \*\*A\*\* \d+%/);
  assert.match(text, /\*\*Seeding and form:\*\* counts for \d+%/);
  assert.match(text, /\*\*Starting from even:\*\* counts for \d+%/);
  assert.match(text, /when one seed number was double the other's, the player with the lower one won \d+% of the time/);
  assert.match(text, /Seeding:\*\* \*\*A\*\* got the better seed in 8 of 8 shared brackets, \*\*B\*\*'s average seed number was 3\.0x \*\*A\*\*'s/);
  const short = embeds.prediction(a, b, odds, false)[0].data.description;
  assert.match(short, /Form, last 40 sets:/);
  assert.doesNotMatch(short, /How it adds up/);
});

test('form says what seeding expected of their seeded sets', () => {
  const historyA = [set(1, 100, true, { mySeed: 2, theirSeed: 8 }), set(1, 100, false, { mySeed: 2, theirSeed: 4 })];
  const historyB = [set(2, 101, true, { mySeed: 4, theirSeed: 6 })];
  const odds = predict(a, b, historyA, historyB, { now });
  const short = embeds.prediction(a, b, odds, false)[0].data.description;
  assert.match(short, /Form, last 40 sets:\*\* \*\*A\*\* 1-1 in seeded sets, seeding expected \d+-\d+ · \*\*B\*\* 1-0 in seeded sets, seeding expected \d+-\d+/);
});

test('common opponents name who did better and how many are even', () => {
  const historyA = [set(1, 100, true), set(1, 100, true), set(1, 101, true), set(1, 101, false)];
  const historyB = [set(2, 100, false), set(2, 100, false), set(2, 101, true), set(2, 101, false)];
  const odds = predict(a, b, historyA, historyB, { now });
  const short = embeds.prediction(a, b, odds, false)[0].data.description;
  assert.equal(odds.common.total, 2);
  assert.match(short, /Common opponents:\*\* 2 shared\. \*\*A\*\* did better against 1, \*\*B\*\* against 0, even against the other 1/);
});
