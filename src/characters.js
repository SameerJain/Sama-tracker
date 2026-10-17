export const MATCHUP_MIN_GAMES = 3;

// most games, then most sets, then most recent. a full tie keeps whichever came first
const byUse = (a, b) => b.games - a.games || b.sets - a.sets || b.last - a.last;
const winRate = ({ wins, games }) => wins / games;

// name to { name, games, wins }, made on first use
function tally(records, name, won) {
  if (!records.has(name)) records.set(name, { name, games: 0, wins: 0 });
  const record = records.get(name);
  record.games++;
  if (won) record.wins++;
  return record;
}

// every character they've reported, with their record on each one. against and stages are
// their game record against each opponent character and on each stage, whoever they played
export function characterUsage(sets) {
  const characters = new Map();
  const against = new Map();
  const stages = new Map();
  let reported = 0;
  let games = 0;

  for (const set of sets) {
    if (!set.games.length) continue;
    reported++;

    const seen = new Set();
    for (const { character, against: opponent, stage, won } of set.games) {
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

      if (stage) tally(stages, stage, won);
      if (!opponent) continue;
      tally(usage.matchups, opponent, won);
      tally(against, opponent, won);
    }
  }

  const list = [...characters.values()].sort(byUse);
  return {
    scanned: sets.length, reported, games, characters: list, best: list[0] && bestMatchup(list[0]),
    against: [...against.values()], stages: [...stages.values()],
  };
}

// records with enough games to mean something, split into the ones they win and lose most.
// a coin flip goes in neither
export function leans(records) {
  const enough = records.filter((record) => record.games >= MATCHUP_MIN_GAMES);
  return {
    good: enough.filter((record) => winRate(record) > 0.5).sort((a, b) => winRate(b) - winRate(a) || b.games - a.games),
    bad: enough.filter((record) => winRate(record) < 0.5).sort((a, b) => winRate(a) - winRate(b) || b.games - a.games),
  };
}

// the opponent character their main does best against, if they're winning it
function bestMatchup(character) {
  return leans([...character.matchups.values()]).good[0];
}
