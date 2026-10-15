import { fromSide } from './startgg.js';

// Odds of a beating b, worked out from their start.gg singles history. No AI, just their records.

// Form looks at this many of each player's latest sets.
export const FORM_SETS = 40;

// How much each kind of evidence counts when there's plenty of it.
const WEIGHTS = { h2h: 3, common: 2, seeding: 1.5, form: 1 };

// Pulled toward 50% so a 1-0 record reads as 67%, not 100%.
const rate = (wins, total) => (wins + 1) / (total + 2);
// Turns a rate into a lean: 0 at 50%, positive for a, negative for b. Leans can be averaged, rates can't.
const logit = (p) => Math.log(p / (1 - p));

// The game they've both played the most.
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

// A player's sets in one game from their side, newest first. DQs don't count.
function results(history, player, game) {
  return history
    .filter((set) => set.event.videogame?.displayName === game)
    .map((set) => fromSide(set, player.playerId))
    .filter((result) => result && !result.dq)
    .map((result) => ({ ...result, opponent: result.them.playerIds[0] }));
}

// Record against each opponent, leaving out the two players being compared.
function recordsByOpponent(list, skip) {
  const records = new Map();
  for (const { opponent, won } of list) {
    // An opponent with no start.gg account has no ID to match on.
    if (!opponent || skip.includes(opponent)) continue;
    const record = records.get(opponent) ?? { wins: 0, total: 0 };
    record.total++;
    if (won) record.wins++;
    records.set(opponent, record);
  }
  return records;
}

// Seed in each bracket they played in.
function seedsByEvent(list) {
  return new Map(list.filter(({ me }) => me.seed).map(({ set, me }) => [set.event.slug, me.seed]));
}

export function predict(a, b, historyA, historyB) {
  const game = sharedGame(historyA, historyB);
  if (!game) return null;
  const listA = results(historyA, a, game);
  const listB = results(historyB, b, game);

  // From both histories, since either one may stop short of their older sets. Keyed by set so none count twice.
  const met = new Map();
  for (const { set, opponent, won } of listA) if (opponent === b.playerId) met.set(set.id, won);
  for (const { set, opponent, won } of listB) if (opponent === a.playerId) met.set(set.id, !won);
  const h2h = { wins: [...met.values()].filter(Boolean).length, total: met.size };

  // Who did better against each opponent they've both played. Even records count half.
  const skip = [a.playerId, b.playerId];
  const vsB = recordsByOpponent(listB, skip);
  const common = { better: 0, worse: 0, total: 0 };
  for (const [opponent, x] of recordsByOpponent(listA, skip)) {
    const y = vsB.get(opponent);
    if (!y) continue;
    common.total++;
    const diff = x.wins / x.total - y.wins / y.total;
    if (diff > 0) common.better++;
    if (diff < 0) common.worse++;
  }

  // A lower seed in the same bracket means the TO rated them higher.
  const seedsB = seedsByEvent(listB);
  const seeding = { higher: 0, total: 0 };
  for (const [event, seed] of seedsByEvent(listA)) {
    if (!seedsB.has(event)) continue;
    seeding.total++;
    if (seed < seedsB.get(event)) seeding.higher++;
  }

  const recentA = listA.slice(0, FORM_SETS);
  const recentB = listB.slice(0, FORM_SETS);
  const form = {
    a: { wins: recentA.filter(({ won }) => won).length, total: recentA.length },
    b: { wins: recentB.filter(({ won }) => won).length, total: recentB.length },
  };

  // Each signal leans one way, and counts for more the more sets are behind it.
  const signals = [
    [WEIGHTS.h2h, h2h.total, logit(rate(h2h.wins, h2h.total))],
    [WEIGHTS.common, common.total, logit(rate(common.better + (common.total - common.better - common.worse) / 2, common.total))],
    [WEIGHTS.seeding, seeding.total, logit(rate(seeding.higher, seeding.total))],
    [WEIGHTS.form, Math.min(form.a.total, form.b.total), logit(rate(form.a.wins, form.a.total)) - logit(rate(form.b.wins, form.b.total))],
  ];
  let sum = 0;
  let totalWeight = 0;
  for (const [weight, n, lean] of signals) {
    // 3 sets behind a signal gives it half its weight, 30 gives it about 90%.
    const w = weight * (n / (n + 3));
    sum += w * lean;
    totalWeight += w;
  }
  // The weighted average lean, turned back into a chance.
  const chance = totalWeight ? 1 / (1 + Math.exp(-sum / totalWeight)) : 0.5;

  return { game, chance, h2h, common, seeding, form };
}
