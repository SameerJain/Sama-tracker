// Shared data computations for series viewers. Pure functions, no dependencies.
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

// per-period rollup. periodFn(startAt) -> label like '2024' or 'Fall 2024'
export function periodRows(tournaments, winnerOf, periodFn) {
  const years = {};
  for (const t of tournaments) {
    const label = periodFn(t.startAt);
    years[label] ??= { period: label, editions: 0, att: 0, champWins: {}, champs: new Set(), minStart: Infinity };
    years[label].editions++;
    years[label].att += t.numAttendees;
    if (t.startAt < years[label].minStart) years[label].minStart = t.startAt;
    const w = winnerOf(t.tournamentId ?? t.id);
    if (w?.tag) { years[label].champs.add(w.tag); years[label].champWins[w.tag] = (years[label].champWins[w.tag] || 0) + 1; }
  }
  return Object.values(years).sort((a, b) => a.minStart - b.minStart).map((v) => {
    const topChamp = Object.entries(v.champWins).sort((a, b) => b[1] - a[1])[0];
    return { ...v, avgAtt: Math.round((v.att / v.editions) * 10) / 10, distinctChamps: v.champs.size, topChamp: topChamp ? `${topChamp[0]} (${topChamp[1]})` : '' };
  });
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
// histogram sections are made from the data, not fixed. singles up to 5, then
// wider bands, and past 19 the band width grows with the biggest attendance
// on the page, with the last section ending at that max instead of one
// open-ended top bucket. no section crosses a tier boundary, so each bar
// still takes its tier's colour
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
// average attendance by month of year, pooled over every year. all 12 months
// come back, empty ones with avgAttendees null, since a month with no
// tournaments at all is the pattern for a school-year series. months go by
// UTC like every other date on the page
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

// return funnel over events-per-player counts. firstTimeRate is first-time
// entries as a share of all entries; every other stage's rate is the share of
// the previous stage that reached it (the 2nd-stage rate is the second-time rate)
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

// players who entered in every series, combined. series: [{ slug, entered:
// [{ id, tag, events, names? }], winners: [{ id, tag, wins, podiums, names? }] }]
// keyed by start.gg player id, so the same person merges across series even
// under different tags. name:-keyed players have no id to match on and stay out
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

// character matchup matrix from char-game rows: [{ wChar, lChar }]. the whole
// dataset goes in: every character that appears in a counted game and every
// pair that met, however few games they have. only games with both
// characters reported count at all: a game with just one side reported, or
// neither, never enters the matrix, not even toward a character's game
// total. rows and columns are the most-played characters: the top `limit`,
// or with { minGames } every character at that many counted games or more.
// a cell is the row character's record against the column character. a
// mirror game counts both sides, so its winrate is 50% by construction
// (the page shows a dash there instead)
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

// signature winning character per player id from char-game rows with wPlayers
export function signatureChars(games) {
  const winChars = {};
  for (const g of games) {
    if (!g.wChar) continue;
    for (const wp of g.wPlayers ?? []) {
      if (wp.id == null) continue;
      const k = String(wp.id);
      winChars[k] ??= {};
      winChars[k][g.wChar] = (winChars[k][g.wChar] || 0) + 1;
    }
  }
  const out = {};
  for (const [pid, m] of Object.entries(winChars)) {
    const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    if (top) out[pid] = { name: top[0], gameWins: top[1] };
  }
  return out;
}

// most-used character per player id across reported games (winner or loser side).
// games: [{ wChar, lChar, wPlayers: [{ id }], lPlayers: [{ id }] }]
export function mostUsedChars(games) {
  const use = {};
  for (const g of games) {
    for (const wp of g.wPlayers ?? []) {
      if (wp.id == null || !g.wChar) continue;
      const k = String(wp.id);
      use[k] ??= {};
      use[k][g.wChar] = (use[k][g.wChar] || 0) + 1;
    }
    for (const lp of g.lPlayers ?? []) {
      if (lp.id == null || !g.lChar) continue;
      const k = String(lp.id);
      use[k] ??= {};
      use[k][g.lChar] = (use[k][g.lChar] || 0) + 1;
    }
  }
  const out = {};
  for (const [pid, m] of Object.entries(use)) {
    const top = Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (top) out[pid] = { name: top[0], games: top[1] };
  }
  return out;
}

// winners + podiums for an arbitrary row set (side brackets, redemption, melee)
export function groupWinners(rows) {
  return winnersFromStandings(rows);
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
    if (ids.size > 1 && tag.replace(/[^a-z0-9]/g, '').length > 2) checks.push('tag "' + tag + '" on ' + ids.size + ' ids (' + [...ids].join(', ') + ') — possible duplicate accounts');
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
  const entrantsByEvent = new Map(attendanceRows.map((r) => [r.eventId, new Set(r.entrants.flatMap((e) => (e.players ?? []).map((p) => p.id != null ? String(p.id) : 'name:' + (p.tag ?? e.name))))]));
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
