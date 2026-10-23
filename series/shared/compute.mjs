// the numbers behind every series page. no files read or written here, the builder does that
export const dstr = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

// winners + podiums from standings rows, merged by start.gg player id
export function winnersFromStandings(rows) {
  const players = {};
  for (const r of rows) {
    for (const s of r.standings) {
      // credit every player on the entrant (doubles partners included)
      const entrants = s.players?.length ? s.players : [{ id: null, tag: s.name }];
      for (const pl of entrants) {
        const pid = pl?.id != null ? String(pl.id) : 'name:' + s.name;
        const tag = pl?.tag || s.name;
        players[pid] ??= { id: pid, tag, wins: 0, seconds: 0, thirds: 0, fourths: 0, names: new Set(), firstDate: null, lastDate: null };
        const p = players[pid];
        if (tag.length > p.tag.length) p.tag = tag;
        p.names.add(s.name);
        if (s.placement === 1) p.wins++;
        else if (s.placement === 2) p.seconds++;
        else if (s.placement === 3) p.thirds++;
        else if (s.placement === 4) p.fourths++;
        if (!p.firstDate || r.startAt < p.firstDate) p.firstDate = r.startAt;
        if (!p.lastDate || r.startAt > p.lastDate) p.lastDate = r.startAt;
      }
    }
  }
  return Object.values(players)
    .map((p) => ({ ...p, names: [...p.names], podiums: p.wins + p.seconds + p.thirds + p.fourths }))
    .sort((a, b) => b.wins - a.wins || b.podiums - a.podiums);
}

// longest runs of consecutive-edition wins
export function streaksFromStandings(rows) {
  const seq = [...rows].sort((a, b) => a.startAt - b.startAt).map((r) => {
    const w = r.standings.find((s) => s.placement === 1);
    const pid = w?.players[0]?.id != null ? String(w.players[0].id) : null;
    return { pid, tag: w?.players[0]?.tag ?? w?.name, startAt: r.startAt };
  });
  const runs = [];
  let cur = null;
  for (const s of seq) {
    if (!s.pid) { if (cur) runs.push(cur); cur = null; continue; } // unknown winner breaks a run
    if (cur && cur.pid === s.pid) { cur.n++; cur.to = s.startAt; }
    else { if (cur) runs.push(cur); cur = { pid: s.pid, tag: s.tag, n: 1, from: s.startAt, to: s.startAt }; }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => r.n >= 2).sort((a, b) => b.n - a.n).slice(0, 5);
}

// events entered per player from entrant lists. rows: [{ entrants: [{ name, players: [{ id, tag }] }] }]
export function attendanceRanking(rows, winsById = {}) {
  const entered = {};
  for (const r of rows) {
    const seen = new Set();
    for (const e of r.entrants) for (const p of e.players ?? []) {
      const pid = p.id != null ? String(p.id) : 'name:' + (e.name ?? p.tag);
      if (seen.has(pid)) continue;
      seen.add(pid);
      entered[pid] ??= { names: new Set(), events: 0 };
      entered[pid].events++;
      entered[pid].names.add(p.tag ?? e.name);
    }
  }
  return Object.entries(entered)
    .map(([id, v]) => { const names = [...v.names].sort((a, b) => b.length - a.length); return { id, tag: names[0], names, events: v.events, wins: winsById[id] ?? 0 }; })
    .sort((a, b) => b.events - a.events || a.tag.localeCompare(b.tag));
}

// newcomers per edition + first/last dates per player. needs startAt per row
export function newcomers(rows, startAtOf) {
  const first = {};
  for (const r of rows) {
    const seen = new Set();
    for (const e of r.entrants) for (const p of e.players ?? []) {
      const pid = p.id != null ? String(p.id) : 'name:' + (p.tag ?? e.name);
      if (seen.has(pid)) continue;
      seen.add(pid);
      const ts = startAtOf(r);
      if (first[pid] == null || ts < first[pid]) first[pid] = ts;
    }
  }
  const perEdition = {};
  for (const r of rows) {
    const ts = startAtOf(r);
    let n = 0;
    const seen = new Set();
    for (const e of r.entrants) for (const p of e.players ?? []) {
      const pid = p.id != null ? String(p.id) : 'name:' + (p.tag ?? e.name);
      if (seen.has(pid)) continue;
      seen.add(pid);
      if (first[pid] === ts) n++;
    }
    perEdition[r.eventId ?? r.tournamentId] = n;
  }
  return { first, perEdition };
}

// loyalty tiers by events entered. histogram buckets below never cross a tier
// boundary, so each bucket bar can take its tier's colour
export const LOYALTY_TIERS = [
  { id: 'one-timer', label: 'One-timer', min: 1, max: 1, color: '#9e9e9e' },
  { id: 'returned', label: 'Returned', min: 2, max: 2, color: '#4c78a8' },
  { id: 'recurring', label: 'Recurring', min: 3, max: 4, color: '#72b7b2' },
  { id: 'regular', label: 'Regular', min: 5, max: 9, color: '#f28e2b' },
  { id: 'core', label: 'Core', min: 10, max: 19, color: '#54a24b' },
  { id: 'loyalist', label: 'Loyalist', min: 20, max: Infinity, color: '#9467bd' },
];
// histogram sections come from the data: one per count up to 5, then wider bands that grow with the
// biggest attendance, the last ending at that max. none crosses a tier, so each bar keeps its colour
export function histogramBuckets(maxEvents = 0) {
  const buckets = [];
  const push = (min, max) => buckets.push({ label: min === max ? String(min) : `${min}–${max}`, min, max });
  for (let n = 1; n <= Math.min(5, maxEvents); n++) push(n, n);
  if (maxEvents > 5) push(6, Math.min(9, maxEvents));
  if (maxEvents > 9) push(10, Math.min(14, maxEvents));
  if (maxEvents > 14) push(15, Math.min(19, maxEvents));
  if (maxEvents > 19) {
    const width = maxEvents > 400 ? 50 : maxEvents > 200 ? 20 : 10;
    for (let start = 20; start <= maxEvents; start += width) push(start, Math.min(start + width - 1, maxEvents));
  }
  return buckets;
}
export function loyaltyTier(events) {
  return LOYALTY_TIERS.find((t) => events >= t.min && events <= t.max) ?? null;
}
// entered: attendanceRanking rows ([{ events, ... }]). entries is entrant slots
// the tier's players account for, so a small loyal core can hold a big share
export function loyaltyTiers(entered) {
  const totalPlayers = entered.length;
  const totalEntries = entered.reduce((s, p) => s + p.events, 0);
  return LOYALTY_TIERS.map((t) => {
    const inTier = entered.filter((p) => p.events >= t.min && p.events <= t.max);
    const entries = inTier.reduce((s, p) => s + p.events, 0);
    return {
      ...t, max: t.max === Infinity ? null : t.max, players: inTier.length, entries,
      pctPlayers: totalPlayers ? inTier.length / totalPlayers : 0,
      pctEntries: totalEntries ? entries / totalEntries : 0,
    };
  });
}
export function attendanceHistogram(entered) {
  const maxEvents = Math.max(0, ...entered.map((p) => p.events));
  return histogramBuckets(maxEvents).map((b) => ({
    ...b,
    tier: loyaltyTier(b.min)?.id ?? null,
    color: loyaltyTier(b.min)?.color ?? '#4c78a8',
    players: entered.filter((p) => p.events >= b.min && p.events <= b.max).length,
  })).filter((b) => b.players > 0);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// average attendance by month, pooled over every year. all 12 come back, empty ones as null, since a
// school-year series goes quiet every summer and that's worth seeing
export function seasonality(tournaments) {
  const rows = MONTHS.map((name, month) => ({ month, name, short: name.slice(0, 3), tournaments: 0, totalAttendees: 0, avgAttendees: null }));
  for (const t of tournaments) {
    const r = rows[new Date(t.startAt * 1000).getUTCMonth()];
    r.tournaments++;
    r.totalAttendees += t.numAttendees ?? 0;
  }
  for (const r of rows) if (r.tournaments) r.avgAttendees = Math.round((r.totalAttendees / r.tournaments) * 10) / 10;
  return rows;
}

// each player's events in date order, so every entry is their 1st, 2nd, 3rd...
// rows: attendance rows, startAtOf(row) -> timestamp (same shape as newcomers)
export function attendanceFlow(rows, startAtOf) {
  const ordered = [...rows].sort((a, b) => startAtOf(a) - startAtOf(b));
  const seen = {};
  const perEvent = [];
  const perYear = {};
  for (const r of ordered) {
    const startAt = startAtOf(r);
    const pids = new Set();
    for (const e of r.entrants) for (const p of e.players ?? []) {
      pids.add(p.id != null ? String(p.id) : 'name:' + (e.name ?? p.tag));
    }
    const row = { eventId: r.eventId ?? null, tournamentId: r.tournamentId ?? null, startAt, entrants: pids.size, first: 0, second: 0, returning: 0 };
    for (const pid of pids) {
      seen[pid] = (seen[pid] ?? 0) + 1;
      if (seen[pid] === 1) row.first++;
      else if (seen[pid] === 2) row.second++;
      else row.returning++;
    }
    perEvent.push(row);
    const year = new Date(startAt * 1000).getUTCFullYear();
    perYear[year] ??= { year, entrants: 0, first: 0, second: 0, returning: 0 };
    perYear[year].entrants += row.entrants;
    perYear[year].first += row.first;
    perYear[year].second += row.second;
    perYear[year].returning += row.returning;
  }
  return { counts: seen, perEvent, perYear: Object.values(perYear).sort((a, b) => a.year - b.year) };
}

// how many players came back a 2nd, 3rd, 4th time. firstTimeRate is first-time entries over all of
// them, and each later stage is a share of the one before
export function returnRates(counts) {
  const values = Object.values(counts);
  const distinct = values.length;
  const totalEntries = values.reduce((s, n) => s + n, 0);
  const stages = [1, 2, 3, 5, 10, 20].map((stage, i, all) => {
    const players = values.filter((n) => n >= stage).length;
    const prev = i === 0 ? null : values.filter((n) => n >= all[i - 1]).length;
    return {
      stage, players,
      pctOfFirst: distinct ? players / distinct : 0,
      conversion: prev ? players / prev : null,
    };
  });
  return { distinct, totalEntries, firstTimeRate: totalEntries ? distinct / totalEntries : 0, stages };
}

// running total of distinct players ever, from attendanceFlow per-event rows.
// only goes up: each edition adds its first-timers to every edition before it
export function cumulativePlayers(perEvent) {
  let total = 0;
  return perEvent.map((r) => { total += r.first; return { ...r, total, newPlayers: r.first }; });
}

// players entered in every series, combined. series: [{ slug, entered, winners }]. matched by
// start.gg player id, so a tag change doesn't split someone. name:-keyed players have no id and stay out
export function crossSeries(series) {
  const byId = {};
  for (const s of series) {
    const wins = Object.fromEntries((s.winners ?? []).map((w) => [w.id, w]));
    for (const p of s.entered ?? []) {
      if (String(p.id).startsWith('name:')) continue;
      byId[p.id] ??= { id: p.id, tag: p.tag, names: new Set(), per: {}, series: 0, totalEvents: 0, totalWins: 0, totalPodiums: 0 };
      const row = byId[p.id];
      const w = wins[p.id];
      row.per[s.slug] = { events: p.events, wins: w?.wins ?? 0, podiums: w?.podiums ?? 0 };
      row.series++;
      row.totalEvents += p.events;
      row.totalWins += w?.wins ?? 0;
      row.totalPodiums += w?.podiums ?? 0;
      for (const n of p.names ?? [p.tag]) if (n) row.names.add(n);
      if (w) for (const n of w.names ?? [w.tag]) if (n) row.names.add(n);
      const tag = [p.tag, w?.tag].filter(Boolean).sort((a, b) => b.length - a.length)[0];
      if (tag && tag.length > row.tag.length) row.tag = tag;
    }
  }
  return Object.values(byId)
    .filter((r) => r.series === series.length)
    .map((r) => ({ ...r, names: [...r.names] }))
    .sort((a, b) => b.totalEvents - a.totalEvents || b.totalWins - a.totalWins || a.tag.localeCompare(b.tag));
}

// the full Smash Ultimate roster as start.gg names them, for the matrix's
// full-roster view. 86 selections: Pokemon Trainer and Pyra & Mythra count as
// one each, the three Mii types and the echoes count as their own
export const ULTIMATE_ROSTER = [
  'Mario', 'Donkey Kong', 'Link', 'Samus', 'Dark Samus', 'Yoshi', 'Kirby', 'Fox', 'Pikachu', 'Luigi',
  'Ness', 'Captain Falcon', 'Jigglypuff', 'Peach', 'Daisy', 'Bowser', 'Ice Climbers', 'Sheik', 'Zelda', 'Dr. Mario',
  'Pichu', 'Falco', 'Marth', 'Lucina', 'Young Link', 'Ganondorf', 'Mewtwo', 'Roy', 'Chrom', 'Mr. Game & Watch',
  'Meta Knight', 'Pit', 'Dark Pit', 'Zero Suit Samus', 'Wario', 'Snake', 'Ike', 'Pokemon Trainer', 'Diddy Kong', 'Lucas',
  'Sonic', 'King Dedede', 'Olimar', 'Lucario', 'R.O.B.', 'Toon Link', 'Wolf', 'Villager', 'Mega Man', 'Wii Fit Trainer',
  'Rosalina', 'Little Mac', 'Greninja', 'Mii Brawler', 'Mii Swordfighter', 'Mii Gunner', 'Palutena', 'Pac-Man', 'Robin', 'Shulk',
  'Bowser Jr.', 'Duck Hunt', 'Ryu', 'Ken', 'Cloud', 'Corrin', 'Bayonetta', 'Inkling', 'Ridley', 'Simon Belmont',
  'Richter', 'King K. Rool', 'Isabelle', 'Incineroar', 'Piranha Plant', 'Joker', 'Hero', 'Banjo-Kazooie', 'Terry', 'Byleth',
  'Min Min', 'Steve', 'Sephiroth', 'Pyra & Mythra', 'Kazuya', 'Sora',
];
// not a character: a random pick from the roster, so its "matchups" say nothing
const NOT_CHARACTERS = new Set(['Random Character']);

// character matchups from games with both characters reported: [{ wChar, lChar }]. rows and columns
// are the most played, the top `limit` or everyone with { minGames }. a cell is the row character's
// record against the column's. a mirror counts both sides, so it's always 50% and the page shows a dash
export function matchupMatrix(games, limit = 15) {
  const counted = games.filter((g) => g.wChar && g.lChar);
  const minGames = typeof limit === 'object' ? limit.minGames ?? 0 : 0;
  const top = typeof limit === 'object' ? Infinity : limit;
  const chars = charStats(counted).filter((c) => !NOT_CHARACTERS.has(c.name) && c.games >= minGames).slice(0, top).map((c) => c.name);
  const inTop = new Set(chars);
  const cells = {};
  const add = (a, b, won) => {
    if (!inTop.has(a) || !inTop.has(b)) return;
    cells[a] ??= {};
    cells[a][b] ??= { games: 0, wins: 0 };
    cells[a][b].games++;
    if (won) cells[a][b].wins++;
  };
  for (const g of counted) {
    add(g.wChar, g.lChar, true);
    add(g.lChar, g.wChar, false);
  }
  for (const a of Object.values(cells)) for (const c of Object.values(a)) c.winrate = c.games ? c.wins / c.games : 0;
  return { chars, cells };
}

// players with the most podiums but no title
export function bestWithoutTitle(winners, limit = 10) {
  return winners.filter((w) => w.wins === 0).sort((a, b) => b.podiums - a.podiums || b.seconds - a.seconds).slice(0, limit);
}

// character usage from char-game rows: [{ wChar, lChar }]. counts appearances:
// both sides of every game, so a mirror match is 2 games with 1 win.
export function charStats(games) {
  const chars = {};
  for (const g of games) {
    if (g.wChar) { chars[g.wChar] ??= { games: 0, wins: 0 }; chars[g.wChar].games++; chars[g.wChar].wins++; }
    if (g.lChar) { chars[g.lChar] ??= { games: 0, wins: 0 }; chars[g.lChar].games++; }
  }
  return Object.entries(chars)
    .map(([name, v]) => ({ name, ...v, winrate: v.games ? v.wins / v.games : 0 }))
    .sort((a, b) => b.games - a.games);
}

// games played on each character per player id, winner or loser side.
// games: [{ wChar, lChar, wPlayers: [{ id }], lPlayers: [{ id }] }]
export function charCounts(games) {
  const use = {};
  const add = (players, char) => {
    if (!char) return;
    for (const p of players ?? []) {
      if (p.id == null) continue;
      const k = String(p.id);
      use[k] ??= {};
      use[k][char] = (use[k][char] || 0) + 1;
    }
  };
  for (const g of games) {
    add(g.wPlayers, g.wChar);
    add(g.lPlayers, g.lChar);
  }
  return use;
}

// each player id's most-used character
export function mostUsedChars(games) {
  const out = {};
  for (const [pid, m] of Object.entries(charCounts(games))) {
    const top = Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top) out[pid] = { name: top[0], games: top[1] };
  }
  return out;
}

// 95% wilson score interval for a winrate, so a 3-0 reads as the guess it is
// instead of 100%
export function wilson(wins, n, z = 1.96) {
  if (!n) return { low: 0, high: 0 };
  const p = wins / n, z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, (centre - margin) / (1 + z2 / n)), high: Math.min(1, (centre + margin) / (1 + z2 / n)) };
}

// distinct players per character from char-game rows, both sides of a game
export function charUsers(games) {
  const users = {};
  for (const g of games) {
    for (const [char, side] of [[g.wChar, g.wPlayers], [g.lChar, g.lPlayers]]) {
      if (!char) continue;
      for (const p of side ?? []) if (p.id != null) (users[char] ??= new Set()).add(String(p.id));
    }
  }
  return Object.fromEntries(Object.entries(users).map(([c, s]) => [c, s.size]));
}

// head-to-heads from the character games alone: [{ wPlayers, lPlayers, setId, startAt? }]. a set goes
// to whoever won more of its reported games, so 1-1 stays undecided. it's the small sample behind the
// rivalries switch, not anyone's full record
export function headToHead(games) {
  const sets = new Map();
  for (const g of games) {
    if (g.wPlayers?.length !== 1 || g.lPlayers?.length !== 1 || g.setId == null) continue;
    const w = g.wPlayers[0], l = g.lPlayers[0];
    if (w.id == null || l.id == null || String(w.id) === String(l.id)) continue;
    let s = sets.get(g.setId);
    if (!s) sets.set(g.setId, s = { ids: [String(w.id), String(l.id)].sort(), tags: {}, wins: {}, startAt: g.startAt ?? null });
    s.tags[w.id] = w.tag;
    s.tags[l.id] = l.tag;
    s.wins[w.id] = (s.wins[w.id] ?? 0) + 1;
  }
  const pairs = new Map();
  for (const s of sets.values()) {
    const [a, b] = s.ids;
    let p = pairs.get(a + '|' + b);
    if (!p) {
      p = { ids: [a, b], tags: { [a]: s.tags[a], [b]: s.tags[b] }, sets: 0, setWins: { [a]: 0, [b]: 0 }, gameWins: { [a]: 0, [b]: 0 }, undecided: 0, first: null, last: null };
      pairs.set(a + '|' + b, p);
    }
    const ga = s.wins[a] ?? 0, gb = s.wins[b] ?? 0;
    p.sets++;
    p.gameWins[a] += ga;
    p.gameWins[b] += gb;
    if (ga > gb) p.setWins[a]++;
    else if (gb > ga) p.setWins[b]++;
    else p.undecided++;
    if (s.startAt != null) {
      if (p.first == null || s.startAt < p.first) p.first = s.startAt;
      // the newest tag each player used against the other
      if (p.last == null || s.startAt >= p.last) { p.last = s.startAt; p.tags[a] = s.tags[a] ?? p.tags[a]; p.tags[b] = s.tags[b] ?? p.tags[b]; }
    }
  }
  // the player ahead goes first: more sets, then more games, then by tag
  return [...pairs.values()].map((p) => {
    let [a, b] = p.ids;
    const ahead = p.setWins[b] - p.setWins[a] || p.gameWins[b] - p.gameWins[a] || String(p.tags[a]).localeCompare(String(p.tags[b]));
    if (ahead > 0) [a, b] = [b, a];
    return {
      a: { id: a, tag: p.tags[a] }, b: { id: b, tag: p.tags[b] }, sets: p.sets,
      aSets: p.setWins[a], bSets: p.setWins[b], undecided: p.undecided,
      aGames: p.gameWins[a], bGames: p.gameWins[b], first: p.first, last: p.last,
    };
  }).sort((x, y) => y.sets - x.sets || (y.aGames + y.bGames) - (x.aGames + x.bGames) || (y.last ?? 0) - (x.last ?? 0));
}

// complete singles head-to-heads from one winner and loser per set: [{ wPlayers,
// lPlayers, wScore?, lScore?, dq?, startAt? }]. DQs are left out because no
// match was played. games come from the set score, so a set the TO reported
// without one still counts as a set but adds no games, and scoredSets says how
// many had one
export function headToHeadSets(sets) {
  const pairs = new Map();
  for (const set of sets) {
    if (set.dq || set.wPlayers?.length !== 1 || set.lPlayers?.length !== 1) continue;
    const winner = set.wPlayers[0], loser = set.lPlayers[0];
    if (winner.id == null || loser.id == null || String(winner.id) === String(loser.id)) continue;
    const ids = [String(winner.id), String(loser.id)].sort();
    const key = ids.join('|');
    const pair = pairs.get(key) ?? { ids, tags: {}, wins: { [ids[0]]: 0, [ids[1]]: 0 }, games: { [ids[0]]: 0, [ids[1]]: 0 }, scored: 0, first: null, last: null };
    pair.wins[winner.id]++;
    if (Number.isInteger(set.wScore) && Number.isInteger(set.lScore) && set.wScore >= 0 && set.lScore >= 0) {
      pair.games[winner.id] += set.wScore;
      pair.games[loser.id] += set.lScore;
      pair.scored++;
    }
    if (set.startAt != null) {
      pair.first = pair.first == null ? set.startAt : Math.min(pair.first, set.startAt);
      // the newest tag each player used against the other
      if (pair.last == null || set.startAt >= pair.last) {
        pair.last = set.startAt;
        pair.tags[winner.id] = winner.tag;
        pair.tags[loser.id] = loser.tag;
      }
    }
    pair.tags[winner.id] ??= winner.tag;
    pair.tags[loser.id] ??= loser.tag;
    pairs.set(key, pair);
  }
  // the player ahead goes first: more sets, then more games, then by tag
  return [...pairs.values()].map((pair) => {
    let [a, b] = pair.ids;
    const ahead = pair.wins[b] - pair.wins[a] || pair.games[b] - pair.games[a] || String(pair.tags[a]).localeCompare(String(pair.tags[b]));
    if (ahead > 0) [a, b] = [b, a];
    return {
      a: { id: a, tag: pair.tags[a] }, b: { id: b, tag: pair.tags[b] },
      sets: pair.wins[a] + pair.wins[b], aSets: pair.wins[a], bSets: pair.wins[b],
      aGames: pair.games[a], bGames: pair.games[b], scoredSets: pair.scored,
      first: pair.first, last: pair.last,
    };
  }).sort((a, b) => b.sets - a.sets || (b.aGames + b.bGames) - (a.aGames + a.bGames) || (b.last ?? 0) - (a.last ?? 0));
}

const standingId = (p) => (p.players?.[0]?.id != null ? String(p.players[0].id) : 'name:' + p.name);
const standingTag = (p) => p.players?.[0]?.tag ?? p.name;
// every player id on one entrant list, with the tag they entered under
function entrantIds(row) {
  const ids = new Map();
  for (const e of row.entrants ?? []) for (const p of e.players ?? []) {
    const pid = p.id != null ? String(p.id) : 'name:' + (e.name ?? p.tag);
    if (!ids.has(pid)) ids.set(pid, p.tag ?? e.name);
  }
  return ids;
}

// top-4 and title rates over the main events each player entered. a night without an entrant list
// or a top 4 yet can't count toward anyone's nights, so it's left out. a top-4 player missing from
// the list still entered
export const hasTop4 = (s) => s.standings.some((p) => p.placement >= 1 && p.placement <= 4);
export function podiumRates(standings, rows) {
  const listOf = new Map(rows.map((r) => [r.eventId, r]));
  const players = {};
  const get = (pid, tag) => (players[pid] ??= { id: pid, tag, entered: 0, wins: 0, top4: 0 });
  for (const s of standings) {
    const r = listOf.get(s.eventId);
    if (!r || !hasTop4(s)) continue;
    const ids = entrantIds(r);
    for (const p of s.standings) if (p.placement >= 1 && p.placement <= 4 && !ids.has(standingId(p))) ids.set(standingId(p), standingTag(p));
    for (const [pid, tag] of ids) get(pid, tag).entered++;
    const placed = new Set();
    for (const p of s.standings) {
      const pid = standingId(p);
      if (p.placement < 1 || p.placement > 4 || placed.has(pid)) continue;
      placed.add(pid);
      const row = get(pid, standingTag(p));
      row.top4++;
      if (p.placement === 1) row.wins++;
    }
  }
  return Object.values(players)
    .map((p) => ({ ...p, top4Rate: p.entered ? p.top4 / p.entered : 0, winRate: p.entered ? p.wins / p.entered : 0 }))
    .sort((a, b) => b.top4Rate - a.top4Rate || b.entered - a.entered || a.tag.localeCompare(b.tag));
}

// podiumRates split by period. periodOf(startAt) -> key. players come back
// with a per-period entry wherever they entered, for a top-4 rate trend
export function podiumTrend(standings, rows, periodOf) {
  const groups = new Map();
  for (const s of standings.filter(hasTop4)) {
    const k = periodOf(s.startAt);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const periods = [...groups.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const players = {};
  for (const k of periods) {
    for (const p of podiumRates(groups.get(k), rows)) {
      players[p.id] ??= { id: p.id, tag: p.tag, per: {} };
      players[p.id].per[k] = { entered: p.entered, top4: p.top4, wins: p.wins, top4Rate: p.top4Rate };
    }
  }
  return { periods, players: Object.values(players) };
}

// retention from one period to the next. new is a first event ever, retained also played the period
// before, back played earlier but skipped the last one, and lapsed played the last one but not this
export function periodRetention(rows, startAtOf, periodOf) {
  const byPeriod = new Map();
  for (const r of rows) {
    const k = periodOf(startAtOf(r));
    if (!byPeriod.has(k)) byPeriod.set(k, new Set());
    for (const pid of entrantIds(r).keys()) byPeriod.get(k).add(pid);
  }
  const keys = [...byPeriod.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const ever = new Set();
  let prev = null;
  return keys.map((k) => {
    const cur = byPeriod.get(k);
    let fresh = 0, retained = 0, back = 0;
    for (const pid of cur) {
      if (!ever.has(pid)) fresh++;
      else if (prev?.has(pid)) retained++;
      else back++;
    }
    const lapsed = prev ? [...prev].filter((pid) => !cur.has(pid)).length : 0;
    const row = { period: k, active: cur.size, new: fresh, retained, back, lapsed, prevActive: prev?.size ?? 0, retention: prev?.size ? retained / prev.size : null };
    for (const pid of cur) ever.add(pid);
    prev = cur;
    return row;
  });
}


// the favourite each night is whoever entered with the most titles in the `window` before it, ties
// all counting. the outcome is favourite, upset, open when no recent champion entered, or unknown
// with no entrant list. firstTitle marks someone's first title here
export function favourites(standings, rows, { window = 365 * 86400 } = {}) {
  const listOf = new Map(rows.map((r) => [r.eventId, r]));
  const titles = [];
  const everWon = new Set();
  const out = [];
  for (const s of [...standings].sort((a, b) => a.startAt - b.startAt)) {
    const w = s.standings.find((x) => x.placement === 1);
    if (!w) continue;
    const wid = standingId(w);
    const r = listOf.get(s.eventId);
    const recent = {};
    for (const t of titles) if (t.startAt >= s.startAt - window && t.startAt < s.startAt) recent[t.pid] = (recent[t.pid] ?? 0) + 1;
    let favs = [], best = 0, outcome = 'unknown', favouritePlace = null;
    const tagOf = {};
    if (r) {
      const ids = entrantIds(r);
      for (const p of s.standings) if (!ids.has(standingId(p))) ids.set(standingId(p), standingTag(p));
      for (const [pid, tag] of ids) tagOf[pid] = tag;
      best = Math.max(0, ...[...ids.keys()].map((pid) => recent[pid] ?? 0));
      favs = best ? [...ids.keys()].filter((pid) => recent[pid] === best) : [];
      outcome = !favs.length ? 'open' : favs.includes(wid) ? 'favourite' : 'upset';
      const placed = s.standings.filter((p) => favs.includes(standingId(p))).map((p) => p.placement);
      favouritePlace = placed.length ? Math.min(...placed) : null;
    }
    out.push({
      eventId: s.eventId, tournamentId: s.tournamentId ?? null, startAt: s.startAt,
      winner: { id: wid, tag: standingTag(w) }, winnerTitles: recent[wid] ?? 0,
      favourites: favs.map((id) => ({ id, tag: tagOf[id] })), favouriteTitles: best,
      favouritePlace, outcome, firstTitle: !everWon.has(wid),
    });
    titles.push({ pid: wid, startAt: s.startAt });
    everWon.add(wid);
  }
  return out;
}

// how spread out the titles were per period, from favourites() rows.
// topShare is the most titles one player took over the period's nights
export function titleSpread(results, periodOf) {
  const byPeriod = new Map();
  for (const r of results) {
    const k = periodOf(r.startAt);
    if (!byPeriod.has(k)) byPeriod.set(k, []);
    byPeriod.get(k).push(r);
  }
  return [...byPeriod.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => {
    const rs = byPeriod.get(k);
    const wins = {};
    for (const r of rs) wins[r.winner.id] = (wins[r.winner.id] ?? 0) + 1;
    const [topId, topWins] = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
    const favourite = rs.filter((r) => r.outcome === 'favourite').length;
    const upset = rs.filter((r) => r.outcome === 'upset').length;
    return {
      period: k, nights: rs.length, champions: Object.keys(wins).length,
      firstTitles: rs.filter((r) => r.firstTitle).length,
      top: { id: topId, tag: rs.find((r) => r.winner.id === topId).winner.tag, wins: topWins }, topShare: topWins / rs.length,
      favourite, upset, favouriteRate: favourite + upset ? favourite / (favourite + upset) : null,
    };
  });
}

// data quality checks shared by every series
export function validateSeries({ standings, attendanceRows = [], tournaments = [], entrantsOf = new Map(), mainEventRe = /ultimate singles/i }) {
  const checks = [];
  const tagToIds = {};
  for (const s of standings) for (const p of s.standings) {
    const tag = (p.name || p.players[0]?.tag || '').toLowerCase();
    const pid = p.players[0]?.id != null ? String(p.players[0].id) : 'name:' + p.name;
    if (!tag) continue;
    (tagToIds[tag] ??= new Set()).add(pid);
  }
  for (const [tag, ids] of Object.entries(tagToIds)) {
    if (ids.size > 1 && tag.replace(/[^a-z0-9]/g, '').length > 2) checks.push('tag "' + tag + '" on ' + ids.size + ' ids (' + [...ids].join(', ') + '), maybe one person on two accounts');
  }
  const attTagToIds = {};
  for (const r of attendanceRows) for (const e of r.entrants) for (const p of e.players ?? []) {
    const tag = (p.tag ?? e.name ?? '').toLowerCase();
    const pid = p.id != null ? String(p.id) : 'name:' + (p.tag ?? e.name);
    if (tag) (attTagToIds[tag] ??= new Set()).add(pid);
  }
  for (const [tag, ids] of Object.entries(attTagToIds)) {
    if (ids.size > 1 && !tagToIds[tag] && tag.replace(/[^a-z0-9]/g, '').length > 2) checks.push('attendance tag "' + tag + '" on ' + ids.size + ' ids (' + [...ids].join(', ') + ')');
  }
  const entrantIds = (r) => r.entrants.flatMap((e) => (e.players ?? []).map((p) => (p.id != null ? String(p.id) : 'name:' + (p.tag ?? e.name))));
  const entrantsByEvent = new Map(attendanceRows.map((r) => [r.eventId, new Set(entrantIds(r))]));
  for (const s of standings) {
    if (!mainEventRe.test(s.eventName || '')) continue;
    const w = s.standings.find((x) => x.placement === 1);
    if (!w) { checks.push('event ' + s.eventId + ' ' + s.eventName + ': no winner'); continue; }
    const pid = w.players[0]?.id != null ? String(w.players[0].id) : 'name:' + (w.players[0]?.tag ?? w.name);
    const set = entrantsByEvent.get(s.eventId);
    if (set && set.size && !set.has(pid)) checks.push('winner ' + (w.players[0]?.tag ?? w.name) + ' not in entrants (event ' + s.eventId + ' ' + s.eventName + ')');
    if (s.standings.length === 0) checks.push('event ' + s.eventId + ' ' + s.eventName + ': empty standings');
    const r = attendanceRows.find((a) => a.eventId === s.eventId);
    if (r && r.entrants.length !== s.numEntrants) checks.push('event ' + s.eventId + ': entrant list ' + r.entrants.length + ' vs reported ' + s.numEntrants);
  }
  for (const t of tournaments) {
    const ue = entrantsOf.get(t.id);
    if (ue != null && ue > t.numAttendees) checks.push('tournament ' + t.id + ' ' + t.name + ': ' + ue + ' ult entrants > ' + t.numAttendees + ' attendees');
  }
  return checks;
}
