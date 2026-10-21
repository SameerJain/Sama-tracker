// Shared site builder for every series viewer. One code path, per-series
// config from series/configs.mjs + dirs from series/series.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hbars, line, academicStartYear } from './charts.mjs';
import { winnersFromStandings, streaksFromStandings, attendanceRanking, charStats, mostUsedChars, validateSeries } from './compute.mjs';
import { CSS, esc, dstr, trunc, csv, pill, card, scrollTable, CLIENT_JS_SORT, CLIENT_JS_UI, MODAL_HTML, clientModal } from './page.mjs';
import { VIEWER } from '../configs.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const MAIN_RE = /ultimate singles/i;

export function buildSite(slug) {
  const reg = JSON.parse(readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'))[slug];
  const cfg = VIEWER[slug];
  if (!reg || !cfg) throw new Error('unknown series ' + slug);
  const SRC = path.join(ROOT, reg.researchDir);
  const OUT = path.join(ROOT, reg.outDir);
  mkdirSync(OUT + '/data', { recursive: true });
  mkdirSync(OUT + '/images', { recursive: true });
  const readJson = (f, fb) => { try { return JSON.parse(readFileSync(path.join(SRC, f), 'utf8')); } catch { return fb; } };

  // ---- load ----
  const tourEvents = readJson('tournaments-events.json', []);
  const tournaments = existsSync(path.join(SRC, 'tournaments.json'))
    ? readJson('tournaments.json', [])
    : tourEvents.map(({ events, ...t }) => t);
  const allStandings = readJson('standings.json', []);
  const ultStandings = allStandings.filter((s) => MAIN_RE.test(s.eventName));
  const attendanceRows = readJson('attendance-ultimate.json', []);
  let charRows = [];
  try {
    charRows = readFileSync(path.join(SRC, 'chars-by-event.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.game === 'Ultimate' && r.games);
  } catch {}
  const games = charRows.flatMap((r) => r.games);
  const entrantsOf = new Map();
  for (const t of tourEvents) for (const e of t.events ?? []) {
    if (MAIN_RE.test(e.name) && !entrantsOf.has(t.id)) entrantsOf.set(t.id, e.numEntrants);
  }

  // ---- compute ----
  const usedChars = mostUsedChars(games);
  const winners = winnersFromStandings(ultStandings).map((w) => {
    const sig = usedChars[w.id];
    return { ...w, sig: sig ? [sig.name, sig.games] : null };
  });
  const winById = Object.fromEntries(winners.map((w) => [w.id, w.wins]));
  const charList = charStats(games);
  let totalSets = 0, totalGames = 0;
  for (const r of charRows) { totalSets += r.totalSets || 0; totalGames += r.gamesReported || 0; }
  const att = tournaments.map((t) => ({ date: dstr(t.startAt), startAt: t.startAt, name: t.name, slug: t.slug, id: t.id, attendees: t.numAttendees }));
  const top = [...att].sort((a, b) => b.attendees - a.attendees)[0];
  const avg = att.reduce((s, t) => s + t.attendees, 0) / att.length;
  const top10 = [...att].sort((a, b) => b.attendees - a.attendees).slice(0, 10);
  const ultWinnerOf = {};
  for (const r of ultStandings) {
    const w = r.standings.find((s) => s.placement === 1);
    ultWinnerOf[r.tournamentId] = w ? { name: w.name, id: w.players[0]?.id ?? null, tag: w.players[0]?.tag ?? w.name, startAt: r.startAt } : null;
  }
  const winnerTag = (tid, re) => {
    const r = allStandings.find((s) => s.tournamentId === tid && re.test(s.eventName));
    const w = r?.standings.find((s) => s.placement === 1);
    return { tag: w ? (w.players[0]?.tag ?? w.name) : '', entrants: r?.numEntrants ?? '' };
  };
  const byDate = [...tournaments].sort((a, b) => a.startAt - b.startAt);
  const latest10 = [...byDate].reverse().slice(0, 10).map((t) => ({ ...t, winner: ultWinnerOf[t.id], entrants: entrantsOf.get(t.id) ?? winnerTag(t.id, MAIN_RE).entrants }));
  // per-period rollup; keyOf(startAt) -> period key, labelOf(key) -> display label
  const rowsForPeriod = (keyOf, labelOf) => {
    const years = {};
    for (const t of tournaments) {
      const y = keyOf(t.startAt);
      years[y] ??= { editions: 0, att: 0, champWins: {}, champTags: {}, champs: new Set() };
      years[y].editions++;
      years[y].att += t.numAttendees;
      const w = ultWinnerOf[t.id];
      if (w) { const k = w.id != null ? String(w.id) : w.tag; years[y].champs.add(k); years[y].champWins[k] = (years[y].champWins[k] || 0) + 1; years[y].champTags[k] = w.tag; }
    }
    return Object.entries(years).sort((a, b) => Number(a[0]) - Number(b[0])).map(([y, v]) => {
      const topChamp = Object.entries(v.champWins).sort((a, b) => b[1] - a[1])[0];
      return { key: y, year: labelOf(y), editions: v.editions, avgAtt: Math.round((v.att / v.editions) * 10) / 10, distinctChamps: v.champs.size, topChamp: topChamp ? `${v.champTags[topChamp[0]]} (${topChamp[1]})` : '' };
    });
  };
  const yearRows = rowsForPeriod((ts) => new Date(ts * 1000).getUTCFullYear(), (y) => String(y));
  const acadRows = cfg.academic ? rowsForPeriod((ts) => academicStartYear(ts), (y) => `${y}–${String(Number(y) + 1).slice(2)}`) : null;
  const streaks = streaksFromStandings(ultStandings);
  const enteredList = attendanceRanking(attendanceRows, winById).map((p) => ({ ...p, ultWins: p.wins }));

  // ---- extras ----
  const has = (x) => cfg.extras.includes(x);
  const meleeStandings = allStandings.filter((s) => s.game === 'Melee' && /singles|^melee$/i.test(s.eventName));
  const meleeTop = has('melee') ? winnersFromStandings(meleeStandings) : [];
  const redStandings = allStandings.filter((s) => /redemption/i.test(s.eventName));
  const redWinners = has('redemption') ? winnersFromStandings(redStandings).map((w) => ({ ...w, ultWins: winById[w.id] ?? 0 })) : [];
  const sideGroups = has('sides') ? (cfg.sideGroups ?? []).map((g) => ({ ...g, rows: allStandings.filter((s) => new RegExp(g.re, 'i').test(s.eventName)) })).filter((g) => g.rows.length) : [];
  const sideOther = has('sides') ? allStandings.filter((s) => !MAIN_RE.test(s.eventName) && s.game !== 'Melee' && !sideGroups.some((g) => g.rows.includes(s))) : [];

  // ---- click popups ----
  const tById = new Map(tournaments.map((t) => [t.id, t]));
  const tLink = (t) => ({ n: esc(t.name), d: dstr(t.startAt), u: 'https://www.start.gg/' + t.slug });
  const placeByPid = {};
  for (const s of ultStandings) {
    const t = tById.get(s.tournamentId);
    if (!t) continue;
    for (const p of s.standings) {
      const pid = p.players[0]?.id != null ? String(p.players[0].id) : 'name:' + p.name;
      placeByPid[pid] ??= { 1: [], 2: [], 3: [], 4: [] };
      if (p.placement >= 1 && p.placement <= 4) placeByPid[pid][p.placement].push(tLink(t));
    }
  }
  const enteredByPid = {};
  for (const r of attendanceRows) {
    const t = tById.get(r.tournamentId);
    if (!t) continue;
    const seen = new Set();
    for (const e of r.entrants) for (const p of e.players ?? []) {
      const pid = p.id != null ? String(p.id) : 'name:' + (p.tag ?? e.name);
      if (seen.has(pid)) continue;
      seen.add(pid);
      (enteredByPid[pid] ??= []).push(tLink(t));
    }
  }
  const winInfo = {};
  for (const w of winners) {
    const links = placeByPid[w.id]?.[1] ?? [];
    if (links.length) winInfo['p1:' + w.id] = { title: `${w.tag} — ${links.length} 1st place${links.length === 1 ? '' : 's'}`, links };
  }
  if (has('redemption')) {
    const redWinByPid = {};
    for (const s of redStandings) {
      const t = tById.get(s.tournamentId);
      if (!t) continue;
      const w = s.standings.find((x) => x.placement === 1);
      if (w) {
        const pid = w.players[0]?.id != null ? String(w.players[0].id) : 'name:' + w.name;
        (redWinByPid[pid] ??= []).push(tLink(t));
      }
    }
    for (const w of redWinners) {
      const links = redWinByPid[w.id] ?? [];
      if (links.length) winInfo['r:' + w.id] = { title: `${w.tag} — ${links.length} redemption win${links.length === 1 ? '' : 's'}`, links };
    }
  }
  for (const p of enteredList) {
    const links = enteredByPid[p.id] ?? [];
    if (links.length) winInfo['e:' + p.id] = { title: `${p.tag} — entered ${links.length} event${links.length === 1 ? '' : 's'}`, links };
  }
  streaks.forEach((r, i) => {
    const links = [];
    for (const s of ultStandings) {
      const x = s.standings.find((p) => p.placement === 1);
      if (x?.players[0]?.id != null && String(x.players[0].id) === String(r.pid) && s.startAt >= r.from && s.startAt <= r.to) {
        const t = tById.get(s.tournamentId);
        if (t) links.push(tLink(t));
      }
    }
    winInfo['s:' + i] = { title: `${r.tag} — streak of ${r.n} (${dstr(r.from)} → ${dstr(r.to)})`, links };
  });
  // year bars: every tournament in that period
  for (const r of yearRows) {
    const links = byDate.filter((t) => new Date(t.startAt * 1000).getUTCFullYear() === Number(r.key)).map((t) => tLink(t));
    if (links.length) winInfo['y:' + r.key] = { title: `${r.year} — ${links.length} tournament${links.length === 1 ? '' : 's'}`, links };
  }
  if (acadRows) for (const r of acadRows) {
    const links = byDate.filter((t) => academicStartYear(t.startAt) === Number(r.key)).map((t) => tLink(t));
    if (links.length) winInfo['ya:' + r.key] = { title: `${r.year} academic year — ${links.length} tournament${links.length === 1 ? '' : 's'}`, links };
  }

  // ---- charts + image files ----
  const attChart = line(att);
  writeFileSync(`${OUT}/images/attendance.svg`, attChart.svg);
  const winItems = winners.filter((w) => w.wins > 0).map((w) => ({ label: w.tag, value: w.wins, color: '#54a24b', pid: w.id }));
  writeFileSync(`${OUT}/images/winners.svg`, hbars(winItems, { labelW: 190 }));
  const winChart = hbars(winItems, { labelW: 190, keyFn: (it) => 'p1:' + it.pid });
  const streakItems = streaks.map((r, i) => ({ label: r.tag, value: r.n, color: '#54a24b', idx: i }));
  const streakChart = hbars(streakItems, { labelW: 190, keyFn: (it) => 's:' + it.idx });
  const attPItems = enteredList.map((p) => ({ label: p.tag, value: p.events, color: '#e377c2', pid: p.id }));
  writeFileSync(`${OUT}/images/attendance-players.svg`, hbars(attPItems, { labelW: 190 }));
  const attPChart = hbars(attPItems, { labelW: 190, keyFn: (it) => 'e:' + it.pid });
  const attPChartRegular = hbars(attPItems.filter((it) => it.value >= 3), { labelW: 190, keyFn: (it) => 'e:' + it.pid });
  writeFileSync(`${OUT}/images/editions-per-year.svg`, hbars(yearRows.map((r) => ({ label: String(r.year), value: r.editions, color: '#72b7b2' })), { labelW: 80 }));
  const editionsChart = hbars(yearRows.map((r) => ({ label: String(r.year), value: r.editions, color: '#72b7b2', key: r.key })), { labelW: 80, keyFn: (it) => 'y:' + it.key });
  let attChartAcad = null, editionsAcadChart = '';
  if (cfg.academic) {
    attChartAcad = line(att, { period: 'academic' });
    writeFileSync(`${OUT}/images/attendance-academic.svg`, attChartAcad.svg);
    writeFileSync(`${OUT}/images/editions-academic.svg`, hbars(acadRows.map((r) => ({ label: r.year, value: r.editions, color: '#72b7b2' })), { labelW: 80 }));
    editionsAcadChart = hbars(acadRows.map((r) => ({ label: r.year, value: r.editions, color: '#72b7b2', key: r.key })), { labelW: 80, keyFn: (it) => 'ya:' + it.key });
  }
  const charGamesItems = charList.map((c) => ({ label: c.name, value: c.games, color: '#4c78a8' }));
  const charWinItems = [...charList].sort((a, b) => b.winrate - a.winrate || b.games - a.games).map((c) => ({ label: `${c.name} (${c.games})`, value: Math.round(c.winrate * 1000) / 10, color: '#eeca3b' }));
  writeFileSync(`${OUT}/images/characters-games.svg`, hbars(charGamesItems, { labelW: 150 }));
  writeFileSync(`${OUT}/images/characters-winrate.svg`, hbars(charWinItems, { labelW: 150, valueFn: (it) => it.value + '%' }));
  const charGamesChart = hbars(charGamesItems, { labelW: 150 });
  const charWinChart = hbars(charWinItems, { labelW: 150, valueFn: (it) => it.value + '%' });
  let redChart = '';
  if (has('redemption')) {
    const redItems = redWinners.filter((w) => w.wins > 0).map((w) => ({ label: w.tag, value: w.wins, color: '#8c564b', pid: w.id }));
    writeFileSync(`${OUT}/images/redemption.svg`, hbars(redItems, { labelW: 190 }));
    redChart = hbars(redItems, { labelW: 190, keyFn: (it) => 'r:' + it.pid });
  }

  // ---- data files ----
  writeFileSync(`${OUT}/data/tournaments.json`, JSON.stringify(tournaments.map((t) => ({ id: t.id, name: t.name, slug: t.slug, url: 'https://www.start.gg/' + t.slug, date: dstr(t.startAt), startAt: t.startAt, attendees: t.numAttendees, ultimateEntrants: entrantsOf.get(t.id) ?? null, winner: ultWinnerOf[t.id] ?? null, ultimateWinner: winnerTag(t.id, MAIN_RE), redemptionWinner: winnerTag(t.id, /redemption/i), meleeWinner: winnerTag(t.id, /melee/i) })), null, 2));
  writeFileSync(`${OUT}/data/winners.json`, JSON.stringify(winners.map((w) => ({ id: w.id, tag: w.tag, aliases: w.names, wins: w.wins, seconds: w.seconds, thirds: w.thirds, fourths: w.fourths, podiums: w.podiums, mostUsedCharacter: w.sig ? { name: w.sig[0], games: w.sig[1] } : null, first: dstr(w.firstDate), last: dstr(w.lastDate) })), null, 2));
  writeFileSync(`${OUT}/data/charts-data.json`, JSON.stringify({ attendance: att, winners: winners.filter((w) => w.wins > 0), characters: charList, editionsPerYear: yearRows, largest: { ...top, url: 'https://www.start.gg/' + top.slug }, streaks, meleeTop, entered: enteredList, redemption: redWinners.filter((w) => w.wins > 0).map((w) => ({ tag: w.tag, wins: w.wins, podiums: w.podiums, ultWins: w.ultWins })) }, null, 2));
  writeFileSync(`${OUT}/data/tournaments.csv`, csv([['id', 'date', 'name', 'attendees', 'ultimate_entrants', 'winner_tag', 'url'], ...tournaments.map((t) => { const w = ultWinnerOf[t.id]; return [t.id, dstr(t.startAt), t.name, t.numAttendees, entrantsOf.get(t.id) ?? '', w?.tag ?? '', 'https://www.start.gg/' + t.slug]; })]));
  writeFileSync(`${OUT}/data/winners.csv`, csv([['player_id', 'tag', 'wins', '2nd', '3rd', '4th', 'podiums', 'most_used_character', 'aliases'], ...winners.map((w) => [w.id, w.tag, w.wins, w.seconds, w.thirds, w.fourths, w.podiums, w.sig ? `${w.sig[0]} (${w.sig[1]})` : '', w.names.join(' | ')])]));
  if (charList.length) {
    writeFileSync(`${OUT}/data/characters.json`, JSON.stringify({ coverage: { sets: totalSets, gamesWithCharacters: totalGames }, characters: charList }, null, 2));
    writeFileSync(`${OUT}/data/characters.csv`, csv([['character', 'games', 'game_wins', 'winrate'], ...charList.map((c) => [c.name, c.games, c.wins, Math.round(c.winrate * 1000) / 10 + '%'])]));
  }
  writeFileSync(`${OUT}/data/attendance.json`, JSON.stringify(enteredList.map((p) => ({ id: p.id, tag: p.tag, eventsEntered: p.events, ultimateWins: p.ultWins })), null, 2));
  writeFileSync(`${OUT}/data/attendance.csv`, csv([['player_id', 'tag', 'events_entered', 'ultimate_wins'], ...enteredList.map((p) => [p.id, p.tag, p.events, p.ultWins])]));
  if (has('sides')) {
    writeFileSync(`${OUT}/data/standings-ultimate.json`, JSON.stringify(ultStandings, null, 2));
    writeFileSync(`${OUT}/data/side-winners.json`, JSON.stringify(sideGroups.map((g) => ({ group: g.label, events: g.rows.length, winners: winnersFromStandings(g.rows).map((w) => ({ tag: w.tag, aliases: w.names, wins: w.wins, podiums: w.podiums })) })), null, 2));
  }
  if (has('redemption')) {
    writeFileSync(`${OUT}/data/standings.json`, JSON.stringify(allStandings, null, 2));
    writeFileSync(`${OUT}/data/redemption-winners.json`, JSON.stringify(redWinners.map((w) => ({ id: w.id, tag: w.tag, aliases: w.names, redemptionWins: w.wins, podiums: w.podiums, ultimateWins: w.ultWins })), null, 2));
    writeFileSync(`${OUT}/data/redemption-winners.csv`, csv([['player_id', 'tag', 'redemption_wins', 'podiums', 'ultimate_wins', 'aliases'], ...redWinners.map((w) => [w.id, w.tag, w.wins, w.podiums, w.ultWins, w.names.join(' | ')])]));
  }

  // ---- tables + cards (fixed order for every series) ----
  const n = tournaments.length;
  const cards = [];
  const add = (id, label, html) => cards.push({ id, label, html });
  const yearTbl = yearRows.map((r) => `<tr><td>${r.year}</td><td>${r.editions}</td><td>${r.avgAtt}</td><td>${r.distinctChamps}</td><td>${esc(r.topChamp)}</td></tr>`).join('\n');
  const togglesHtml = `<div class="toggles">Show: <label><input type="checkbox" data-t="s-raw" checked> attendance</label> <label><input type="checkbox" data-t="s-avg" checked> average</label> <label><input type="checkbox" data-t="s-whole" checked> whole trend</label> <label><input type="checkbox" data-t="s-year" checked> yearly trends</label></div>`;
  let attBody;
  if (cfg.academic) {
    const acadTbl = acadRows.map((r) => `<tr><td>${r.year}</td><td>${r.editions}</td><td>${r.avgAtt}</td><td>${r.distinctChamps}</td><td>${esc(r.topChamp)}</td></tr>`).join('\n');
    attBody = `${togglesHtml}<p>Year view: <label><input type="radio" name="yearview" value="cal" checked> calendar</label> <label><input type="radio" name="yearview" value="acad"> academic (Aug–Jun)</label></p>`
      + `<div data-yearview="cal"><div class="scroll attchart" id="attchart">${attChart.svg}</div><h3>Tournaments run per year</h3><p><small>Click a bar to see that year's tournaments.</small></p><div class="scroll">${editionsChart}</div>${scrollTable('<th>Year</th><th>Tournaments</th><th>Avg att.</th><th>Distinct champs</th><th>Most titles</th>', yearTbl)}</div>`
      + `<div data-yearview="acad" style="display:none"><div class="scroll attchart" id="attchart-acad">${attChartAcad.svg}</div><h3>Tournaments run per academic year</h3><p><small>Click a bar to see that academic year's tournaments.</small></p><div class="scroll">${editionsAcadChart}</div>${scrollTable('<th>Academic year</th><th>Tournaments</th><th>Avg att.</th><th>Distinct champs</th><th>Most titles</th>', acadTbl)}</div>`;
  } else {
    attBody = `${togglesHtml}<div class="scroll attchart" id="attchart">${attChart.svg}</div><h3>Tournaments run per year</h3><p><small>Click a bar to see that year's tournaments.</small></p><div class="scroll">${editionsChart}</div>${scrollTable('<th>Year</th><th>Tournaments</th><th>Avg att.</th><th>Distinct champs</th><th>Most titles</th>', yearTbl)}`;
  }
  add('att', 'Attendance', card('att', `Attendance over time (${n} tournaments, avg ${avg.toFixed(1)})`, attBody));
  const crowTop = top10.map((t, i) => `<tr><td>${i + 1}</td><td>${t.date}</td><td><a href="https://www.start.gg/${esc(t.slug)}">${esc(trunc(t.name, 55))}</a></td><td>${t.attendees}</td></tr>`).join('\n');
  add('crowds', 'Crowds', card('crowds', `Largest tournament: ${top.attendees} attendees`,
    `<p><a href="https://www.start.gg/${esc(top.slug)}">${esc(top.name)}</a> — ${top.date}</p><h3>Top 10 crowds</h3>${scrollTable('<th>#</th><th>Date</th><th>Tournament</th><th>Att.</th>', crowTop)}`));
  const latestRows = latest10.map((t) => `<tr><td>${dstr(t.startAt)}</td><td><a href="https://www.start.gg/${esc(t.slug)}">${esc(trunc(t.name, 45))}</a></td><td>${t.numAttendees}</td><td>${t.entrants}</td><td>${t.winner ? esc(t.winner.tag) : '<i>unknown</i>'}</td></tr>`).join('\n');
  add('recent', 'Recent', card('recent', 'Last 10 tournaments', scrollTable('<th>Date</th><th>Tournament</th><th>Att.</th><th>Ult entrants</th><th>Winner</th>', latestRows)));
  const wrows = winners.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.tag)}</td><td>${w.wins}</td><td>${w.seconds}</td><td>${w.thirds}</td><td>${w.fourths}</td><td>${w.sig ? esc(w.sig[0]) + ' (' + w.sig[1] + ')' : ''}</td><td>${esc(w.names.slice(0, 3).join(' / '))}${w.names.length > 3 ? '…' : ''}</td></tr>`).join('\n');
  const streakTbl = streaks.map((r) => `<tr><td>${esc(r.tag)}</td><td>${r.n}</td><td>${dstr(r.from)} → ${dstr(r.to)}</td></tr>`).join('\n');
  add('winners', 'Winners', card('winners', 'Most Ultimate wins (by start.gg player id, all aliases merged)',
    `<p><small>Click a bar to see every tournament in that run.</small></p><div class="scroll">${winChart}</div><h3>Longest win streaks (consecutive tournaments)</h3><div class="scroll">${streakChart}</div>${scrollTable('<th>Player</th><th>Streak</th><th>Span</th>', streakTbl)}${scrollTable('<th>#</th><th>Player</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th><th>Most used character</th><th>Aliases</th>', wrows)}`, '#4c78a8'));
  const enteredTbl = enteredList.map((p, i) => `<tr data-events="${p.events}"><td>${i + 1}</td><td>${esc(p.tag)}</td><td>${p.events}</td><td>${p.ultWins}</td><td>${esc((p.names ?? [p.tag]).slice(0, 3).join(' / '))}${(p.names ?? []).length > 3 ? '…' : ''}</td></tr>`).join('\n');
  add('attended', 'Attendance', card('attended', `Most events entered (Ultimate Singles, ${attendanceRows.length} events with entrant lists)`,
    `<p><small>Click a bar to see every tournament they entered.</small></p><p><label><input type="checkbox" id="fewtoggle"> hide players with 1–2 events</label></p><div class="scroll" id="attp-all">${attPChart}</div><div class="scroll" id="attp-regular" style="display:none">${attPChartRegular}</div>${scrollTable('<th>#</th><th>Player</th><th>Events entered</th><th>Ult wins</th><th>Aliases</th>', enteredTbl)}`));
  if (charList.length) {
    const crows = charList.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.name)}</td><td>${c.games}</td><td>${c.wins}</td><td>${(Math.round(c.winrate * 1000) / 10).toFixed(1)}%</td></tr>`).join('\n');
    add('characters', 'Characters', card('characters', `Characters — most games played (Ultimate, ${totalGames.toLocaleString('en-US')} games with both characters reported, from ${totalSets.toLocaleString('en-US')} sets checked)`,
      `<div class="scroll">${charGamesChart}</div><h3>Winrate (all characters)</h3><div class="scroll">${charWinChart}</div>${scrollTable('<th>#</th><th>Character</th><th>Games</th><th>Game wins</th><th>Winrate</th>', crows)}`));
  }
  if (has('melee')) {
    const meleeTbl = meleeTop.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.tag)}</td><td>${w.wins}</td><td>${w.podiums}</td></tr>`).join('\n');
    const meleeEvents = [...meleeStandings].sort((a, b) => a.startAt - b.startAt).map((s) => {
      const w = s.standings.find((x) => x.placement === 1);
      return `<tr><td>${dstr(s.startAt)}</td><td><a href="https://www.start.gg/${esc(s.slug)}">${esc(trunc(s.tournamentName, 55))}</a></td><td>${s.numEntrants}</td><td>${w ? esc(w.players[0]?.tag ?? w.name) : '<i>unknown</i>'}</td></tr>`;
    }).join('\n');
    add('melee', 'Melee', card('melee', `Melee (${meleeStandings.length} events with reported top 4)`,
      `<p><small>${esc(cfg.meleeNote ?? '')}</small></p>${scrollTable('<th>#</th><th>Player</th><th>1st</th><th>Top 4s</th>', meleeTbl)}<h3>All ${meleeStandings.length} Melee brackets</h3>${scrollTable('<th>Date</th><th>Tournament</th><th>Entrants</th><th>Winner</th>', meleeEvents)}`, '#2ca02a'));
  }
  if (has('redemption')) {
    const redTbl = redWinners.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.tag)}</td><td>${w.wins}</td><td>${w.podiums}</td><td>${w.ultWins}</td></tr>`).join('\n');
    add('redemption', 'Redemption', card('redemption', `Redemption brackets (${redStandings.length} events with reported top 4)`,
      `<p><small>Click a bar to see every tournament in that run.</small></p><div class="scroll">${redChart}</div>${scrollTable('<th>#</th><th>Player</th><th>Redemption wins</th><th>Top 4s</th><th>Ult wins</th>', redTbl)}`, '#8c564b'));
  }
  if (has('sides')) {
    const sideCards = sideGroups.map((g) => {
      const rows = winnersFromStandings(g.rows).map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.tag)}</td><td>${p.wins}</td><td>${p.podiums}</td></tr>`).join('\n');
      return `<h3>${pill(g.cls, g.label)} ${g.rows.length} events</h3>${scrollTable('<th>#</th><th>Player</th><th>Wins</th><th>Top 4s</th>', rows)}`;
    }).join('\n');
    const sideOtherRows = sideOther.map((s) => {
      const w = s.standings.find((x) => x.placement === 1);
      return `<tr><td>${dstr(s.startAt)}</td><td>${esc(s.eventName)}</td><td>${s.numEntrants}</td><td>${w ? esc(w.players[0]?.tag ?? w.name) : '<i>unknown</i>'}</td></tr>`;
    }).join('\n');
    add('sides', 'Sides', card('sides', 'Side brackets',
      `<p><small>${esc(cfg.sidesNote ?? '')}</small></p>${sideCards}${sideOtherRows ? `<h3>Other side events</h3>${scrollTable('<th>Date</th><th>Event</th><th>Entrants</th><th>Winner</th>', sideOtherRows)}` : ''}`));
  }
  const allHeads = { ultimate: `<th><span class="pill u">Ult</span> winner</th>`, redemption: `<th><span class="pill r">Redemption</span> winner</th>`, melee: `<th><span class="pill m">Melee</span> winner</th>` };
  const trows = tournaments.map((t) => {
    const u = winnerTag(t.id, MAIN_RE);
    let row = `<tr><td>${dstr(t.startAt)}</td><td><a href="https://www.start.gg/${esc(t.slug)}">${esc(t.name)}</a></td><td>${t.numAttendees}</td><td>${u.entrants}</td>`;
    for (const k of cfg.allWinners) {
      if (k === 'ultimate') row += `<td>${esc(u.tag)}</td>`;
      else if (k === 'redemption') row += `<td>${esc(winnerTag(t.id, /redemption/i).tag)}</td>`;
      else if (k === 'melee') row += `<td>${esc(winnerTag(t.id, /melee/i).tag)}</td>`;
    }
    return row + '</tr>';
  }).join('\n');
  add('all', `All ${n}`, card('all', `All ${n} tournaments`,
    `<p><small>${esc(cfg.allNote)}</small></p>${scrollTable('<th>Date</th><th>Tournament</th><th>Att.</th><th>Ult entrants</th>' + cfg.allWinners.map((k) => allHeads[k]).join(''), trows, true)}`));

  const nav = cards.map((c) => `<a href="#${c.id}">${esc(c.label)}</a>`).join('\n');
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.title)} — Data Analysis (${n} tournaments)</title>
<style>${CSS}</style>
</head><body>
<h1>${esc(cfg.title)} — Data Analysis</h1>
<div id="toolbar"><button id="navtoggle" aria-label="toggle menu">☰ menu</button> <button id="darkbtn">🌙 dark</button></div>
<nav class="side">${nav}</nav>
${cards.map((c) => c.html).join('\n')}
</body>
<script>${CLIENT_JS_SORT}</script>
<script>${CLIENT_JS_UI}</script>
${MODAL_HTML}
${clientModal(winInfo)}
</html>`;
  writeFileSync(`${OUT}/index.html`, html);
  writeFileSync(`${OUT}/README.md`, cfg.readme({ top: { ...top }, ultEvents: ultStandings.length, meleeEvents: meleeStandings.length, redemptionEvents: redStandings.length, totalSets, totalGames, charCount: charList.length, enteredCount: enteredList.length }));

  const checks = validateSeries({ standings: allStandings, attendanceRows, tournaments, entrantsOf, mainEventRe: MAIN_RE });
  if (checks.length) { console.log(`DATA CHECKS (${checks.length}):`); for (const c of checks.slice(0, 30)) console.log(' -', c); }
  else console.log('data checks clean');
  console.log('viewer built:', OUT);
  console.log('tournaments', n, '| ultimate events', ultStandings.length, '| melee events', meleeStandings.length, '| sets', totalSets, '| games w/ chars', totalGames, '| chars', charList.length);
  console.log('top winner:', winners[0].tag, winners[0].wins, '| top char:', charList[0]?.name, charList[0]?.games);
}
