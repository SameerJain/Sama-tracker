import { singles } from './startgg.js';

const DAY = 86400;
export const DEFAULT_RECAP_SCHEDULE = { recapDay: 0, recapTime: '21:00', timezone: 'America/New_York' };

// since counts and until doesn't, so a set right on the line lands in one period, not both
export function periodSummary(player, sets, events, since, until) {
  const inside = (at) => at >= since && at < until;
  const played = singles(sets.filter((set) => inside(set.completedAt)), player).filter(({ set }) => set.winnerId);
  const finishes = events.filter(({ event, dq }) => !dq && inside(event.startAt));
  const games = new Map();
  function gameFor(event) {
    const game = event.videogame?.displayName ?? 'Other';
    if (!games.has(game)) games.set(game, { game, wins: 0, losses: 0, played: [], events: [] });
    return games.get(game);
  }
  for (const result of played) {
    const game = gameFor(result.set.event);
    game[result.won ? 'wins' : 'losses']++;
    game.played.push(result);
  }
  for (const finish of finishes) gameFor(finish.event).events.push(finish);
  return { played, finishes, games: [...games.values()] };
}

// the week that ended at the latest recap time, going by the clock in the recap's timezone so
// daylight saving doesn't shift it. null if that was over a day ago, too late to send
export function weeklyPeriod(now = Date.now() / 1000, schedule = {}) {
  const { recapDay, recapTime, timezone } = { ...DEFAULT_RECAP_SCHEDULE, ...schedule };
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  });
  const parts = (at) => Object.fromEntries(formatter.formatToParts(at * 1000)
    .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, Number(value)]));
  const wallAt = (at) => {
    const p = parts(at);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  };
  const local = parts(now);
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const [hour, minute] = recapTime.split(':').map(Number);
  function boundary(weeksAgo) {
    const daysAgo = (weekday - recapDay + 7) % 7 + weeksAgo * 7;
    const wall = Date.UTC(local.year, local.month - 1, local.day - daysAgo, hour, minute) / 1000;
    const candidates = [wall - DAY, wall + DAY].map((sample) => wall - (wallAt(sample) - sample));
    const exact = candidates.filter((at) => wallAt(at) === wall);
    // a time that happens twice when the clocks go back uses the first one,
    // and one that gets skipped when they go forward moves up by the jump
    return exact.length ? Math.min(...exact) : Math.max(...candidates);
  }
  const weeksAgo = boundary(0) > now ? 1 : 0;
  const until = boundary(weeksAgo);
  if (now - until >= DAY) return null;
  return { since: boundary(weeksAgo + 1), until, next: boundary(weeksAgo - 1) };
}
