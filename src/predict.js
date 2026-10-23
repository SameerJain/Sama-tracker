import { singles } from './startgg.js';
import { rankOf } from './slippi/shared.js';

// form is someone's last this many sets in the game, against anyone but the other player
export const FORM_SETS = 40;
// slippi ranked needs this many sets in the season to count, the same as a rank
export const SLIPPI_MIN_UPDATES = 5;

const DAY = 86400;
// a set from a year ago counts half as much as one today
const HALF_LIFE_DAYS = 365;

// everything below is in log odds, where 0 is a coin flip, 1 is 73%, 2 is 88% and 3 is 95%. the three
// priors were widened after backtesting on 368 sets between tracked players, where narrower ones made the
// favourite win more often than the odds said. scripts/backtest.js reruns that kind of check after a change.
// how far apart two players could be before looking at anything
const GAP_PRIOR = 3;
// how much better or worse than the two of them a common opponent could be
const OPPONENT_PRIOR = 3;
// how far someone's results can run ahead of or behind their seeding
const FORM_PRIOR = 0.7;
// log odds a seed gains per e times higher seed, before their sets say otherwise. 1 means a seed
// twice as high wins 67%
const SEED_WEIGHT = { mean: 1, sd: 0.5 };
// how far off seeding can be, in ln(seed): one bracket's seeds, the part every bracket has in common
// since TOs seed off the same results, and comparing seeds from brackets with different fields
const SEED_NOISE = 0.7;
const SEED_SHARED_NOISE = 0.3;
const FIELD_NOISE = 1;
// slippi ratings are elo, so a gap in rating points turns into log odds this way. netplay form
// carries over to offline only so far, which is the noise, and a rating from few sets is noisier
// still, with the extra variance falling as each player's update count grows
const SLIPPI_SCALE = Math.LN10 / 400;
const SLIPPI_NOISE = 1;
const SLIPPI_UPDATE_SCALE = 5;

const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
// both seeds, so the set says something about seeding
const seeded = ({ me, them }) => me.seed > 0 && them.seed > 0;
// positive when they were the higher seed
const seedRatio = ({ me, them }) => Math.log(them.seed / me.seed);

// newton's method for the top of a curve that only bends down, from its slope and bend at x.
// steps are capped so a flat start can't send it far off
function maximize(slopeAndBend, start = 0) {
  let x = start;
  for (let i = 0; i < 100; i++) {
    const [slope, bend] = slopeAndBend(x);
    const step = Math.max(-1, Math.min(1, -slope / bend));
    x += step;
    if (Math.abs(step) < 1e-9) break;
  }
  return x;
}

// odds for a gap of mean with this much uncertainty. unsure pulls it toward 50%
export const chanceOf = (mean, variance) => sigmoid(mean / Math.sqrt(1 + (Math.PI * variance) / 8));

// the game they've both played the most singles sets in. DQs don't count, or a game someone only got
// DQ'd out of could win and leave nothing to predict with
export function sharedGame(a, b, historyA, historyB) {
  const count = (history, player) => {
    const games = new Map();
    for (const { set } of singles(history, player)) {
      const game = set.event.videogame?.displayName;
      if (game) games.set(game, (games.get(game) ?? 0) + 1);
    }
    return games;
  };
  const gamesB = count(historyB, b);

  let best;
  let bestCount = 0;
  for (const [game, n] of count(historyA, a)) {
    const shared = Math.min(n, gamesB.get(game) ?? 0);
    if (shared > bestCount) [best, bestCount] = [game, shared];
  }
  return best;
}

const recency = (at, now) => 0.5 ** (Math.max(0, now - at) / (HALF_LIFE_DAYS * DAY));

// the singles sets they played in this game, from their side. /predict names whoever has none
export function gameSets(history, player, game) {
  return singles(history.filter((set) => set.event.videogame?.displayName === game), player);
}

function results(history, player, game, now) {
  return gameSets(history, player, game)
    .map((result) => ({ ...result, opponent: result.them.playerIds[0], weight: recency(result.set.completedAt, now) }));
}

// each bracket in the game they had a seed in, by event slug. their event history has every finished event and
// its size, so that goes first. without it the seeds come from their sets, which don't say how big it was
function bracketsOf(list, events, game, now) {
  const brackets = events
    ? events.filter(({ event, seed }) => seed > 0 && event.videogame?.displayName === game && event.startAt <= now)
      .map(({ event, seed }) => ({ slug: event.slug, name: event.tournament.name, seed, entrants: event.numEntrants, weight: recency(event.startAt, now) }))
    : list.filter(({ me }) => me.seed > 0)
      .map(({ set, me, weight }) => ({ slug: set.event.slug, name: set.event.tournament.name, seed: me.seed, weight }));
  return new Map(brackets.map((bracket) => [bracket.slug, bracket]));
}

function recordsByOpponent(list, skip) {
  const records = new Map();
  for (const { opponent, them, won, weight } of list) {
    // no id when the opponent doesn't have a start.gg account
    if (!opponent || skip.includes(opponent)) continue;
    // newest first, so it's the name they entered with last
    const record = records.get(opponent) ?? { name: them.name, wins: 0, total: 0, sets: [] };
    record.total++;
    if (won) record.wins++;
    record.sets.push({ sign: won ? 1 : -1, weight });
    records.set(opponent, record);
  }
  return records;
}

// how much seeding predicts sets in this game, from every seeded set either of them played
function seedWeight(sets) {
  const prior = 1 / SEED_WEIGHT.sd ** 2;
  const slopeAndBend = (k) => {
    let slope = -(k - SEED_WEIGHT.mean) * prior;
    let bend = -prior;
    for (const result of sets) {
      const x = seedRatio(result);
      const p = sigmoid(k * x);
      slope += x * ((result.won ? 1 : 0) - p);
      bend -= x * x * p * (1 - p);
    }
    return [slope, bend];
  };
  const k = maximize(slopeAndBend, SEED_WEIGHT.mean);
  return { k, variance: -1 / slopeAndBend(k)[1] };
}

// their last FORM_SETS sets, and how far their seeded ones ran ahead of their seeding in log odds
function formVsSeeding(list, k) {
  const recent = list.slice(0, FORM_SETS);
  const withSeeds = recent.filter(seeded);
  const prior = 1 / FORM_PRIOR ** 2;
  const slopeAndBend = (edge) => {
    let slope = -edge * prior;
    let bend = -prior;
    for (const result of withSeeds) {
      const p = sigmoid(k * seedRatio(result) + edge);
      slope += (result.won ? 1 : 0) - p;
      bend -= p * (1 - p);
    }
    return [slope, bend];
  };
  const edge = maximize(slopeAndBend);
  return {
    wins: recent.filter(({ won }) => won).length,
    total: recent.length,
    seededWins: withSeeds.filter(({ won }) => won).length,
    seeded: withSeeds.length,
    // what seeding alone said they'd win
    expected: withSeeds.reduce((sum, result) => sum + sigmoid(k * seedRatio(result)), 0),
    edge,
    variance: -1 / slopeAndBend(edge)[1],
  };
}

// ln(entrants / seed) over their brackets, newer ones counting more: how high they're usually seeded for
// the size of the bracket. share is the same as a fraction, 0.05 being the top 5%. null with no sizes to go on
function usualSeed(byEvent) {
  const brackets = [...byEvent.values()].filter(({ entrants }) => entrants >= 2);
  if (!brackets.length) return null;
  let total = 0;
  let sum = 0;
  let squares = 0;
  for (const { seed, entrants, weight } of brackets) {
    const level = Math.log(entrants / Math.min(seed, entrants));
    total += weight;
    sum += weight * level;
    squares += weight * level * level;
  }
  const mean = sum / total;
  // a little spread even with one bracket, one bracket says little
  const spread = Math.max(0, squares / total - mean * mean) + 0.5;
  return { mean, variance: spread / total, share: Math.exp(-mean), brackets: brackets.length };
}

// how much higher a is seeded than b in ln(seed): brackets they were both in say it best, how high each is
// usually seeded fills in when there are few or none. null with nothing seeded to go on
function seedGap(shared, levelA, levelB) {
  const estimates = [];
  if (shared.length) {
    const total = shared.reduce((sum, { weight }) => sum + weight, 0);
    const mean = shared.reduce((sum, { a, b, weight }) => sum + weight * Math.log(b / a), 0) / total;
    estimates.push({ mean, variance: SEED_NOISE ** 2 / total + SEED_SHARED_NOISE ** 2 });
  }
  if (levelA && levelB) estimates.push({ mean: levelA.mean - levelB.mean, variance: FIELD_NOISE ** 2 + levelA.variance + levelB.variance });
  if (!estimates.length) return null;
  const precision = estimates.reduce((sum, { variance }) => sum + 1 / variance, 0);
  return { mean: estimates.reduce((sum, { mean, variance }) => sum + mean / variance, 0) / precision, variance: 1 / precision };
}

// the evidence about the gap: each part gives its slope and bend at a gap, in log odds of a winning.
// head-to-head sets count directly
function headToHeadPart(meetings) {
  return (gap) => {
    let slope = 0;
    let bend = 0;
    for (const { sign, weight } of meetings) {
      slope += weight * sign * sigmoid(-sign * gap);
      bend -= weight * sigmoid(gap) * sigmoid(-gap);
    }
    return [slope, bend];
  };
}

// a common opponent's own strength isn't known, so for each gap it's set to whatever fits their sets
// against the two of them best, and the gap gets judged on how well that fits. a sits at +gap/2 and b at
// -gap/2, so swapping them flips the answer exactly
function commonOpponentsPart(opponents) {
  const prior = 1 / OPPONENT_PRIOR ** 2;
  const strengths = opponents.map(() => 0);
  return (gap) => {
    let slope = 0;
    let bend = 0;
    opponents.forEach(({ a, b }, i) => {
      const around = (strength) => {
        const out = { opponent: -strength * prior, opponentBend: -prior, gap: 0, gapBend: 0, both: 0 };
        for (const [sets, side] of [[a, 1], [b, -1]]) {
          for (const { sign, weight } of sets) {
            const z = (side * gap) / 2 - strength;
            const p = sigmoid(-sign * z);
            const curve = weight * sigmoid(z) * sigmoid(-z);
            out.opponent -= weight * sign * p;
            out.opponentBend -= curve;
            out.gap += (side * weight * sign * p) / 2;
            out.gapBend -= curve / 4;
            out.both += (side * curve) / 2;
          }
        }
        return out;
      };
      strengths[i] = maximize((strength) => {
        const { opponent, opponentBend } = around(strength);
        return [opponent, opponentBend];
      }, strengths[i]);
      const at = around(strengths[i]);
      slope += at.gap;
      bend += at.gapBend - (at.both * at.both) / at.opponentBend;
    });
    return [slope, bend];
  };
}

// seeding, adjusted for how far each of them has been running ahead of or behind it lately.
// slippi ratings use the same shape, a rating gap turned into log odds with its own uncertainty
function seedingPart(mean, variance) {
  return (gap) => [-(gap - mean) / variance, -1 / variance];
}

// a ranked slippi profile, with a rating that can count. pending and unranked stay out, and so
// does anything without a rating, like a watchlist entry from a failed lookup
function rankedSlippi(profile) {
  if (!profile || profile.rating == null) return null;
  if ((profile.updates ?? 0) < SLIPPI_MIN_UPDATES) return null;
  return profile;
}

// their slippi rating gap in log odds, for melee only. null unless both are ranked
function slippiGap(game, slippiA, slippiB) {
  if (game !== 'Melee') return null;
  const rankedA = rankedSlippi(slippiA);
  const rankedB = rankedSlippi(slippiB);
  if (!rankedA || !rankedB) return null;
  const diff = rankedA.rating - rankedB.rating;
  const mean = SLIPPI_SCALE * diff;
  const variance = SLIPPI_NOISE ** 2 + SLIPPI_UPDATE_SCALE / rankedA.updates + SLIPPI_UPDATE_SCALE / rankedB.updates;
  return {
    mean, variance, diff,
    aRating: rankedA.rating, bRating: rankedB.rating,
    aRank: rankOf(rankedA).name, bRank: rankOf(rankedB).name,
  };
}

// the gap's most likely value and how sure that is, from these parts and the prior
function fit(parts) {
  const total = (gap) => parts.reduce(([slope, bend], part) => {
    const [s, b] = part(gap);
    return [slope + s, bend + b];
  }, [-gap / GAP_PRIOR ** 2, -1 / GAP_PRIOR ** 2]);
  const gap = maximize(total);
  return { gap, variance: -1 / total(gap)[1] };
}

// a's odds of beating b in their shared game, or the one picked. events are their event histories, which
// make seeding count for more. meetings is every set between them from getHeadToHead, which goes back past
// where the histories stop. now is when the odds are for, which only changes how much older sets count.
// slippiA and slippiB are their slippi profiles, which count when both are ranked and the game is melee.
// with no sets on start.gg but both ranked, the odds come from slippi alone. null if there's nothing to go on
export function predict(a, b, historyA, historyB, options = {}) {
  const { now = Date.now() / 1000, eventsA, eventsB, meetings: allMeetings = [], slippiA = null, slippiB = null } = options;
  let { game = sharedGame(a, b, historyA, historyB) } = options;
  // slippi is melee-only, so two ranked profiles are a melee matchup even with nothing on start.gg
  if (!game && slippiGap('Melee', slippiA, slippiB)) game = 'Melee';
  if (!game) return null;
  const listA = results(historyA, a, game, now);
  const listB = results(historyB, b, game, now);
  const alone = slippiGap(game, slippiA, slippiB);
  if (!listA.length || !listB.length) {
    if (listA.length || listB.length || !alone) return null;
  }

  // the histories too, in case meetings wasn't looked up. deduped by set id, from a's side
  const met = new Map();
  const meet = (list, them, sign) => {
    for (const { set, opponent, won, weight } of list) {
      if (opponent === them.playerId) met.set(set.id, { sign: won ? sign : -sign, weight });
    }
  };
  meet(results(allMeetings, a, game, now), b, 1);
  meet(listA, b, 1);
  meet(listB, a, -1);
  const meetings = [...met.values()];
  const h2h = { wins: meetings.filter(({ sign }) => sign > 0).length, total: meetings.length };

  // ties against a common opponent count as half
  const skip = [a.playerId, b.playerId];
  const vsB = recordsByOpponent(listB, skip);
  const common = { better: 0, worse: 0, total: 0, opponents: [] };
  for (const [opponent, x] of recordsByOpponent(listA, skip)) {
    const y = vsB.get(opponent);
    if (!y) continue;
    common.total++;
    const diff = x.wins / x.total - y.wins / y.total;
    if (diff > 0) common.better++;
    if (diff < 0) common.worse++;
    common.opponents.push({ name: x.name, a: x, b: y });
  }

  // every seeded set either of them played, once each, says how much a seed gap is worth in this game
  const allSeeded = [...new Map([...listA, ...listB].filter(seeded).map((result) => [result.set.id, result])).values()];
  const { k, variance: kVariance } = seedWeight(allSeeded);
  const notEachOther = (list, other) => list.filter(({ opponent }) => opponent !== other.playerId);
  const form = { a: formVsSeeding(notEachOther(listA, b), k), b: formVsSeeding(notEachOther(listB, a), k) };

  const bracketsA = bracketsOf(listA, eventsA, game, now);
  const bracketsB = bracketsOf(listB, eventsB, game, now);
  // newest first, for the list in verbose
  const shared = [...bracketsA.values()].filter(({ slug }) => bracketsB.has(slug))
    .map(({ slug, name, seed, weight }) => ({ slug, name, a: seed, b: bracketsB.get(slug).seed, weight }))
    .sort((x, y) => y.weight - x.weight);
  // how many times higher a was seeded, on average, weighting newer brackets more
  const totalWeight = shared.reduce((sum, { weight }) => sum + weight, 0);
  const logRatio = shared.reduce((sum, { a: x, b: y, weight }) => sum + weight * Math.log(y / x), 0);
  const seeding = {
    higher: shared.filter(({ a: x, b: y }) => x < y).length,
    lower: shared.filter(({ a: x, b: y }) => x > y).length,
    total: shared.length,
    ratio: shared.length ? Math.exp(logRatio / totalWeight) : 1,
    brackets: shared,
  };
  const level = { a: usualSeed(bracketsA), b: usualSeed(bracketsB) };
  const gapInSeeds = seedGap(shared, level.a, level.b);

  const parts = [
    { key: 'h2h', n: meetings.length, part: headToHeadPart(meetings) },
    { key: 'common', n: common.total, part: commonOpponentsPart(common.opponents.map(({ a: x, b: y }) => ({ a: x.sets, b: y.sets }))) },
  ];
  if (gapInSeeds) {
    const mean = k * gapInSeeds.mean + form.a.edge - form.b.edge;
    const variance = k ** 2 * gapInSeeds.variance + gapInSeeds.mean ** 2 * kVariance + form.a.variance + form.b.variance;
    parts.push({ key: 'seeding', n: shared.length || Math.min(level.a.brackets, level.b.brackets), part: seedingPart(mean, variance) });
  } else {
    parts.push({ key: 'seeding', n: 0, part: () => [0, 0] });
  }
  const slippi = slippiGap(game, slippiA, slippiB);
  if (slippi) {
    parts.push({ key: 'slippi', n: 1, part: seedingPart(slippi.mean, slippi.variance) });
  } else {
    parts.push({ key: 'slippi', n: 0, part: () => [0, 0] });
  }

  const { gap, variance } = fit(parts.map(({ part }) => part));
  // how much each part counted is its share of what's known at the answer, the prior being the rest.
  // on its own is what it says with just the prior
  const known = parts.map(({ part }) => -part(gap)[1]);
  const everything = known.reduce((sum, each) => sum + each, 1 / GAP_PRIOR ** 2);
  const factors = parts.map(({ key, n, part }, i) => {
    const alone = fit([part]);
    return { key, n, share: n ? known[i] / everything : 0, chance: chanceOf(alone.gap, alone.variance) };
  });

  return {
    game, chance: chanceOf(gap, variance), gap, variance, h2h, common, seeding, level, form, factors, slippi,
    // the starting point of even odds, for how much thin evidence keeps it near 50%
    prior: 1 / GAP_PRIOR ** 2 / everything,
    // what a seed twice as high won, by their sets in this game
    seedEdge: sigmoid(k * Math.LN2), seededSets: allSeeded.length,
  };
}
