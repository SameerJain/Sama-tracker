import { fromSide } from './startgg.js';

export const FORM_SETS = 40;

const WEIGHTS = { h2h: 3, common: 2, seeding: 1.5, form: 1 };

// +1/+2 smoothing so 1-0 comes out 67%, not 100%
const rate = (wins, total) => (wins + 1) / (total + 2);
// log odds, these average properly where raw rates don't
const logit = (p) => Math.log(p / (1 - p));
const fromLogit = (x) => 1 / (1 + Math.exp(-x));

function sharedGame(historyA, historyB) {
  const count = (sets) => {
    const games = new Map();
    for (const set of sets) {
      const game = set.event.videogame?.displayName;
      if (game) games.set(game, (games.get(game) ?? 0) + 1);
    }
    return games;
  };
  const gamesB = count(historyB);

  let best;
  let bestCount = 0;
  for (const [game, n] of count(historyA)) {
    const shared = Math.min(n, gamesB.get(game) ?? 0);
    if (shared > bestCount) [best, bestCount] = [game, shared];
  }
  return best;
}

function results(history, player, game) {
  return history
    .filter((set) => set.event.videogame?.displayName === game)
    .map((set) => fromSide(set, player.playerId))
    .filter((result) => result && !result.dq)
    .map((result) => ({ ...result, opponent: result.them.playerIds[0] }));
}

function recordsByOpponent(list, skip) {
  const records = new Map();
  for (const { opponent, them, won } of list) {
    // no id when the opponent doesn't have a start.gg account
    if (!opponent || skip.includes(opponent)) continue;
    // newest first, so it's the name they entered with last
    const record = records.get(opponent) ?? { name: them.name, wins: 0, total: 0 };
    record.total++;
    if (won) record.wins++;
    records.set(opponent, record);
  }
  return records;
}

function seedsByEvent(list) {
  return new Map(list.filter(({ me }) => me.seed).map(({ set, me }) => [set.event.slug, { seed: me.seed, set }]));
}

export function predict(a, b, historyA, historyB) {
  const game = sharedGame(historyA, historyB);
  if (!game) return null;
  const listA = results(historyA, a, game);
  const listB = results(historyB, b, game);

  // check both histories in case one is cut off, dedupe by set id
  const met = new Map();
  for (const { set, opponent, won } of listA) if (opponent === b.playerId) met.set(set.id, won);
  for (const { set, opponent, won } of listB) if (opponent === a.playerId) met.set(set.id, !won);
  const h2h = { wins: [...met.values()].filter(Boolean).length, total: met.size };

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

  const seedsB = seedsByEvent(listB);
  const seeding = { higher: 0, total: 0, brackets: [] };
  for (const [event, mine] of seedsByEvent(listA)) {
    const theirs = seedsB.get(event);
    if (!theirs) continue;
    seeding.total++;
    if (mine.seed < theirs.seed) seeding.higher++;
    seeding.brackets.push({ set: mine.set, a: mine.seed, b: theirs.seed });
  }

  const recentA = listA.slice(0, FORM_SETS);
  const recentB = listB.slice(0, FORM_SETS);
  const form = {
    a: { wins: recentA.filter(({ won }) => won).length, total: recentA.length },
    b: { wins: recentB.filter(({ won }) => won).length, total: recentB.length },
  };

  // [key, sample size, lean towards a]
  const signals = [
    ['h2h', h2h.total, logit(rate(h2h.wins, h2h.total))],
    ['common', common.total, logit(rate(common.better + (common.total - common.better - common.worse) / 2, common.total))],
    ['seeding', seeding.total, logit(rate(seeding.higher, seeding.total))],
    ['form', Math.min(form.a.total, form.b.total), logit(rate(form.a.wins, form.a.total)) - logit(rate(form.b.wins, form.b.total))],
  ];
  // 3 sets gets half the weight, 30 gets ~90%
  const factors = signals.map(([key, n, lean]) => ({ key, n, lean, weight: WEIGHTS[key] * (n / (n + 3)) }));
  const totalWeight = factors.reduce((sum, { weight }) => sum + weight, 0);
  const lean = factors.reduce((sum, factor) => sum + factor.weight * factor.lean, 0);
  for (const factor of factors) {
    // for /predict verbose: how much it counted, and the odds it gives on its own
    factor.share = totalWeight ? factor.weight / totalWeight : 0;
    factor.chance = fromLogit(factor.lean);
  }
  const chance = totalWeight ? fromLogit(lean / totalWeight) : 0.5;

  return { game, chance, h2h, common, seeding, form, factors };
}
