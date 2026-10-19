// Buffalo Bills finals from ESPN's public scoreboard API, no key needed. the team
// schedule has every game with the final score, and the summary adds quarters and
// team stats for the snapshot. not AI, just the numbers.
const SCHEDULE = (season) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/BUF/schedule?season=${season}`;
const SUMMARY = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`;

// the NFL year is the season's start: a February Super Bowl still belongs to last year
export function seasonYear(date = new Date()) {
  return date.getMonth() <= 1 ? date.getFullYear() - 1 : date.getFullYear();
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Sama-tracker' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
  return res.json();
}

// a final involving Buffalo, Bills first. winner falls back to the score since
// ESPN only sets it on completed games
export function toGame(event) {
  const comp = event.competitions?.[0] ?? {};
  const sides = comp.competitors ?? [];
  const bills = sides.find((side) => side.team?.abbreviation === 'BUF');
  const opp = sides.find((side) => side.team?.abbreviation !== 'BUF');
  if (!bills || !opp) return null;
  const billsScore = Number(bills.score?.displayValue);
  const oppScore = Number(opp.score?.displayValue);
  const record = (side) => side.record?.find((each) => each.type === 'total')?.displayValue ?? null;
  const link = event.links?.find((each) => each.rel?.includes('summary') && each.href?.startsWith('https://www.espn.com'))?.href;
  return {
    id: String(event.id),
    date: Math.floor(Date.parse(event.date) / 1000),
    week: event.week?.text ?? '',
    completed: comp.status?.type?.completed === true,
    billsScore: Number.isFinite(billsScore) ? billsScore : null,
    oppScore: Number.isFinite(oppScore) ? oppScore : null,
    won: bills.winner ?? (Number.isFinite(billsScore) && Number.isFinite(oppScore) ? billsScore > oppScore : null),
    billsRecord: record(bills),
    opponent: {
      abbreviation: opp.team.abbreviation,
      displayName: opp.team.displayName,
      logo: opp.team.logos?.[0]?.href ?? null,
      record: record(opp),
    },
    venue: comp.venue?.fullName ?? null,
    attendance: comp.attendance ?? null,
    url: link ?? null,
  };
}

export async function getFinals(season = seasonYear()) {
  const data = await getJson(SCHEDULE(season));
  return (data.events ?? []).map(toGame).filter((game) => game?.completed && game.billsScore != null);
}

// quarters and team totals for one final. null when ESPN has no summary yet,
// the schedule numbers still stand on their own
export async function getDetails(id) {
  const data = await getJson(SUMMARY(id));
  const comp = data.header?.competitions?.[0] ?? {};
  const lines = {};
  for (const side of comp.competitors ?? []) {
    lines[side.team?.abbreviation] = (side.linescores ?? []).map((quarter) => quarter.displayValue);
  }
  const stats = {};
  for (const team of data.boxscore?.teams ?? []) {
    const get = (name) => team.statistics?.find((each) => each.name === name)?.displayValue ?? null;
    stats[team.team?.abbreviation] = { yards: get('totalYards'), turnovers: get('turnovers') };
  }
  return { lines, stats };
}
