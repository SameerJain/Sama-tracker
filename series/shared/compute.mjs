// Shared data computations for series viewers. Pure functions, no dependencies.
export const dstr = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

// winners + podiums from standings rows, merged by start.gg player id
export function winnersFromStandings(rows) {
  const players = {};
  for (const r of rows) {
    for (const s of r.standings) {
      const pid = s.players[0]?.id != null ? String(s.players[0].id) : 'name:' + s.name;
      const tag = s.players[0]?.tag || s.name;
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
  }).filter((s) => s.pid);
  const runs = [];
  let cur = null;
  for (const s of seq) {
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
      const pid = p.id != null ? String(p.id) : 'name:' + (p.tag ?? e.name);
      if (seen.has(pid)) continue;
      seen.add(pid);
      entered[pid] ??= { names: new Set(), events: 0 };
      entered[pid].events++;
      entered[pid].names.add(p.tag ?? e.name);
    }
  }
  return Object.entries(entered)
    .map(([id, v]) => ({ id, tag: [...v.names].sort((a, b) => b.length - a.length)[0], events: v.events, wins: winsById[id] ?? 0 }))
    .sort((a, b) => b.events - a.events);
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

// players with the most podiums but no title
export function bestWithoutTitle(winners, limit = 10) {
  return winners.filter((w) => w.wins === 0).sort((a, b) => b.podiums - a.podiums || b.seconds - a.seconds).slice(0, limit);
}

// character usage from char-game rows: [{ wChar, lChar }]
export function charStats(games) {
  const chars = {};
  for (const g of games) {
    if (g.wChar) { chars[g.wChar] ??= { games: 0, wins: 0 }; chars[g.wChar].games++; chars[g.wChar].wins++; }
    if (g.lChar && g.lChar !== g.wChar) { chars[g.lChar] ??= { games: 0, wins: 0 }; chars[g.lChar].games++; }
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
