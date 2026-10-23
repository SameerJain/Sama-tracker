// numbers and records the way the bot writes them. nothing here imports anything, so the web hub and the series
// pages load this same file, see web/build.mjs

// double elim placements: 1, 2, 3, 4, 5, 7, 9, 13, 17, 25...
const PLACEMENTS = [1, 2];
for (let n = 2; n <= 4096; n *= 2) PLACEMENTS.push(n + 1, n * 1.5 + 1);

// index into PLACEMENTS, so seed 9 and 9th place are both 6
export const step = (n) => PLACEMENTS.findLastIndex((place) => place <= n);

export function percent(part, whole) {
  return `${Math.round((part / whole) * 100)}%`;
}

// 0.05 -> top 5%. rounded up so nobody's ever the top 0%
export const topText = (share) => `top ${Math.ceil(share * 100)}%`;

export function ordinal(n) {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;

  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

export function medal(placement) {
  if (placement === 1) return '🥇 ';
  if (placement === 2) return '🥈 ';
  if (placement === 3) return '🥉 ';
  return '';
}

export function count(n, word, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`;
}

export function scoreText(me, them) {
  if (me.score === -1 || them.score === -1) return 'DQ'; // start.gg's DQ score
  if (me.score === null || them.score === null) return 'vs';
  return `${me.score}-${them.score}`;
}

export function upsetFactor(winner, loser) {
  if (!winner.seed || !loser.seed) return 0;
  return step(winner.seed) - step(loser.seed);
}

// seed 13 beating seed 1, or seed 17 beating seed 2. set results and crew cards only call this big a win notable
export const MAJOR_UPSET = 7;

export function winLoss(wins, losses) {
  return `${wins}-${losses}${wins + losses ? ` (${percent(wins, wins + losses)})` : ''}`;
}

export const winsOf = (list) => list.filter(({ won }) => won).length;

// for a list of results from fromSide
export function recordOf(list) {
  const wins = winsOf(list);
  return winLoss(wins, list.length - wins);
}

// 2-1, without the percent
export function shortRecord(list) {
  const wins = winsOf(list);
  return `${wins}-${list.length - wins}`;
}
