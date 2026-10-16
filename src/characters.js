const MATCHUP_MIN_GAMES = 3;

// most games, then most sets, then most recent. a full tie keeps whichever came first
const byUse = (a, b) => b.games - a.games || b.sets - a.sets || b.last - a.last;
const winRate = ({ wins, games }) => wins / games;

// every character they've reported, with their record on each one
export function characterUsage(sets) {
  const characters = new Map();
  let reported = 0;
  let games = 0;

  for (const set of sets) {
    if (!set.games.length) continue;
    reported++;

    const seen = new Set();
    for (const { character, against, won } of set.games) {
      games++;
      if (!characters.has(character)) {
        characters.set(character, { name: character, games: 0, wins: 0, sets: 0, last: 0, matchups: new Map() });
      }
      const usage = characters.get(character);
      usage.games++;
      if (won) usage.wins++;
      usage.last = Math.max(usage.last, set.completedAt);
      if (!seen.has(character)) usage.sets++;
      seen.add(character);

      if (!against) continue;
      if (!usage.matchups.has(against)) usage.matchups.set(against, { name: against, games: 0, wins: 0 });
      const matchup = usage.matchups.get(against);
      matchup.games++;
      if (won) matchup.wins++;
    }
  }

  const list = [...characters.values()].sort(byUse);
  return { scanned: sets.length, reported, games, characters: list, best: list[0] && bestMatchup(list[0]) };
}

// the opponent character their main does best against, if they're winning it
function bestMatchup(character) {
  return [...character.matchups.values()]
    .filter((matchup) => matchup.games >= MATCHUP_MIN_GAMES && winRate(matchup) > 0.5)
    .sort((a, b) => winRate(b) - winRate(a) || b.games - a.games)[0];
}
