// Shared site builder for every series viewer. One code path, per-series
// config from series/configs.mjs + dirs from series/series.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hbars, line, growthLine, academicStartYear } from './charts.mjs';
import { winnersFromStandings, streaksFromStandings, attendanceRanking, charStats, mostUsedChars, validateSeries, loyaltyTier, loyaltyTiers, attendanceHistogram, attendanceFlow, returnRates, matchupMatrix, cumulativePlayers, crossSeries, seasonality, ULTIMATE_ROSTER } from './compute.mjs';
import { CSS, esc, dstr, trunc, csv, pill, card, scrollTable, CLIENT_JS_SORT, CLIENT_JS_UI, MODAL_HTML, clientModal } from './page.mjs';
import { VIEWER } from '../configs.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const MAIN_RE = /ultimate singles|^smash ultimate$/i;

export function buildSite(slug, { countOffweeks = true, htmlFile = 'index.html', writeFiles = true } = {}) {
  const reg = JSON.parse(readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'))[slug];
  const cfg = VIEWER[slug];
  if (!reg || !cfg) throw new Error('unknown series ' + slug);
  const SRC = path.join(ROOT, reg.researchDir);
  const OUT = path.join(ROOT, reg.outDir);
  mkdirSync(OUT + '/data', { recursive: true });
  mkdirSync(OUT + '/images', { recursive: true });
  const readJson = (f, fb) => { try { return JSON.parse(readFileSync(path.join(SRC, f), 'utf8')); } catch { return fb; } };
  // the off-week toggle's second view writes only its own page, so the data
  // and image files on disk always match the default (counted) view
  const writeOut = (file, content) => { if (writeFiles) writeFileSync(file, content); };

  // ---- load ----
  const tourEvents = readJson('tournaments-events.json', []);
  const numberedTournaments = (existsSync(path.join(SRC, 'tournaments.json'))
    ? readJson('tournaments.json', [])
    : tourEvents.map(({ events, ...t }) => t)).sort((a, b) => a.startAt - b.startAt);
  // off-week club nights: counted for attendance, seasonality, crowds, loyalty
  // and this list, never for Ultimate winners or matchups, in either view of
  // the toggle. their only standings rows are redemption brackets that
  // reported one, so winners and matchups stay numbered-only either way
  const allOffweekTournaments = readJson('offweek-tournaments.json', []);
  const allOffweekIds = new Set(allOffweekTournaments.map((t) => t.id));
  const offweekTournaments = countOffweeks ? allOffweekTournaments : [];
  const offweekIds = new Set(offweekTournaments.map((t) => t.id));
  const tournaments = [...numberedTournaments, ...offweekTournaments].sort((a, b) => a.startAt - b.startAt);
  const allStandings = readJson('standings.json', []).filter((s) => countOffweeks || !allOffweekIds.has(s.tournamentId));
  const ultStandings = allStandings.filter((s) => MAIN_RE.test(s.eventName));
  const offweekRows = countOffweeks ? readJson('attendance-offweek.json', []) : [];
  const attendanceRows = [...readJson('attendance-ultimate.json', []), ...offweekRows];
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
  let totalSets = 0, totalGames = 0, gamesPlayedAll = 0, setsWithCharsAll = 0;
  for (const r of charRows) { totalSets += r.totalSets || 0; totalGames += r.gamesReported || 0; gamesPlayedAll += r.gamesPlayed || 0; setsWithCharsAll += r.setsWithChars || 0; }
  const pct = (x, tot) => tot ? Math.round((x / tot) * 1000) / 10 : 0;
  // of games actually played (set scores), not of game records: most sets have no
  // game records at all, so records as the denominator reads as near-complete
  const gamesReportedPct = pct(totalGames, gamesPlayedAll);
  const setsReportedPct = pct(setsWithCharsAll, totalSets);
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
  const latest10 = [...byDate].reverse().slice(0, 10).map((t) => ({ ...t, winner: ultWinnerOf[t.id], entrants: entrantsOf.get(t.id) ?? winnerTag(t.id, MAIN_RE).entrants, offweek: offweekIds.has(t.id) }));
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
  const startAtByTournament = new Map(tournaments.map((t) => [t.id, t.startAt]));
  const flow = attendanceFlow(attendanceRows, (r) => startAtByTournament.get(r.tournamentId) ?? 0);
  const tiers = loyaltyTiers(enteredList);
  const histogram = attendanceHistogram(enteredList);
  const rates = returnRates(flow.counts);
  const season = seasonality(tournaments);
  const cumulative = cumulativePlayers(flow.perEvent);
  // the whole dataset: every character in a both-reported game and every
  // pair that met, however few games they have
  const matchups = matchupMatrix(games, { minGames: 1 });
  const matchupsFull = matchupMatrix(games, charList.length);
  const pct1 = (f) => (Math.round((f ?? 0) * 1000) / 10).toFixed(1) + '%';

  // cross-series: the same player ids entered in every other series too.
  // reads the other series' research data straight from its folder
  const registry = JSON.parse(readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'));
  const seriesData = [{ slug, entered: enteredList, winners }];
  for (const [otherSlug, otherReg] of Object.entries(registry)) {
    if (otherSlug === slug) continue;
    const otherDir = path.join(ROOT, otherReg.researchDir);
    const otherRead = (f, fb) => { try { return JSON.parse(readFileSync(path.join(otherDir, f), 'utf8')); } catch { return fb; } };
    const otherAttendance = [...otherRead('attendance-ultimate.json', []), ...otherRead('attendance-offweek.json', [])];
    const otherWinners = winnersFromStandings(otherRead('standings.json', []).filter((s) => MAIN_RE.test(s.eventName)));
    seriesData.push({ slug: otherSlug, entered: attendanceRanking(otherAttendance), winners: otherWinners });
  }
  const bothSeries = seriesData.length > 1 ? crossSeries(seriesData) : [];
  const seriesLabel = (s) => VIEWER[s]?.short ?? registry[s]?.name ?? s;
  const otherSlugs = seriesData.slice(1).map((s) => s.slug);

  // ---- extras ----
  const has = (x) => cfg.extras.includes(x);
  const meleeStandings = allStandings.filter((s) => s.game === 'Melee' && /singles|stampede|^melee$/i.test(s.eventName));
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
  // loyalty histogram bars: everyone in that events-entered bracket, most first
  histogram.forEach((b, i) => {
    const players = enteredList
      .filter((p) => p.events >= b.min && (b.max == null || p.events <= b.max))
      .sort((a, z) => z.events - a.events || a.tag.localeCompare(z.tag));
    if (players.length) winInfo['h:' + i] = {
      title: `Players with ${b.label} event${b.label === '1' ? '' : 's'} (${players.length})`,
      items: players.map((p) => `${esc(p.tag)} — ${p.events} event${p.events === 1 ? '' : 's'}`),
    };
  });
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
  writeOut(`${OUT}/images/attendance.svg`, attChart.svg);
  const seasonItems = season.map((r) => ({ label: r.short, value: r.avgAttendees ?? 0, color: r.tournaments ? '#4c78a8' : '#cccccc' }));
  writeOut(`${OUT}/images/seasonality.svg`, hbars(seasonItems, { labelW: 50, valueFn: (it) => it.value ? it.value.toFixed(1) : '—' }));
  const seasonChart = hbars(seasonItems, { labelW: 50, valueFn: (it) => it.value ? it.value.toFixed(1) : '—' });
  const winItems = winners.filter((w) => w.wins > 0).map((w) => ({ label: w.tag, value: w.wins, color: '#54a24b', pid: w.id }));
  writeOut(`${OUT}/images/winners.svg`, hbars(winItems, { labelW: 190 }));
  const winChart = hbars(winItems, { labelW: 190, keyFn: (it) => 'p1:' + it.pid });
  const streakItems = streaks.map((r, i) => ({ label: r.tag, value: r.n, color: '#54a24b', idx: i }));
  const streakChart = hbars(streakItems, { labelW: 190, keyFn: (it) => 's:' + it.idx });
  const attPItems = enteredList.map((p) => ({ label: p.tag, value: p.events, color: '#e377c2', pid: p.id }));
  writeOut(`${OUT}/images/attendance-players.svg`, hbars(attPItems, { labelW: 190 }));
  const attPChart = hbars(attPItems, { labelW: 190, keyFn: (it) => 'e:' + it.pid });
  const attPChartRegular = hbars(attPItems.filter((it) => it.value >= 3), { labelW: 190, keyFn: (it) => 'e:' + it.pid });
  const histItems = histogram.map((b, i) => ({ label: b.label + ' events', value: b.players, color: b.color, bucket: i }));
  writeOut(`${OUT}/images/attendance-histogram.svg`, hbars(histItems, { labelW: 90 }));
  const histChart = hbars(histItems, { labelW: 90, keyFn: (it) => 'h:' + it.bucket });
  const growthPoints = cumulative.map((p) => { const t = tById.get(p.tournamentId); return { ...p, date: dstr(p.startAt), name: t?.name ?? '' }; });
  const growthChart = growthLine(growthPoints);
  writeOut(`${OUT}/images/cumulative-players.svg`, growthChart);
  const newcomersChart = hbars(flow.perYear.map((r) => ({ label: String(r.year), value: r.first, color: '#9467bd' })), { labelW: 80 });
  writeOut(`${OUT}/images/newcomers-per-year.svg`, hbars(flow.perYear.map((r) => ({ label: String(r.year), value: r.first, color: '#9467bd' })), { labelW: 80 }));
  writeOut(`${OUT}/images/editions-per-year.svg`, hbars(yearRows.map((r) => ({ label: String(r.year), value: r.editions, color: '#72b7b2' })), { labelW: 80 }));
  const editionsChart = hbars(yearRows.map((r) => ({ label: String(r.year), value: r.editions, color: '#72b7b2', key: r.key })), { labelW: 80, keyFn: (it) => 'y:' + it.key });
  let attChartAcad = null, editionsAcadChart = '';
  if (cfg.academic) {
    attChartAcad = line(att, { period: 'academic' });
    writeOut(`${OUT}/images/attendance-academic.svg`, attChartAcad.svg);
    writeOut(`${OUT}/images/editions-academic.svg`, hbars(acadRows.map((r) => ({ label: r.year, value: r.editions, color: '#72b7b2' })), { labelW: 80 }));
    editionsAcadChart = hbars(acadRows.map((r) => ({ label: r.year, value: r.editions, color: '#72b7b2', key: r.key })), { labelW: 80, keyFn: (it) => 'ya:' + it.key });
  }
  const charGamesItems = charList.map((c) => ({ label: c.name, value: c.games, color: '#4c78a8' }));
  const charWinItems = [...charList].sort((a, b) => b.winrate - a.winrate || b.games - a.games).map((c) => ({ label: `${c.name} (${c.games})`, value: Math.round(c.winrate * 1000) / 10, color: '#eeca3b' }));
  writeOut(`${OUT}/images/characters-games.svg`, hbars(charGamesItems, { labelW: 150 }));
  writeOut(`${OUT}/images/characters-winrate.svg`, hbars(charWinItems, { labelW: 150, valueFn: (it) => it.value + '%' }));
  const charGamesChart = hbars(charGamesItems, { labelW: 150 });
  const charWinChart = hbars(charWinItems, { labelW: 150, valueFn: (it) => it.value + '%' });
  let redChart = '';
  if (has('redemption')) {
    const redItems = redWinners.filter((w) => w.wins > 0).map((w) => ({ label: w.tag, value: w.wins, color: '#8c564b', pid: w.id }));
    writeOut(`${OUT}/images/redemption.svg`, hbars(redItems, { labelW: 190 }));
    redChart = hbars(redItems, { labelW: 190, keyFn: (it) => 'r:' + it.pid });
  }

  // ---- data files ----
  writeOut(`${OUT}/data/tournaments.json`, JSON.stringify(tournaments.map((t) => ({ id: t.id, name: t.name, slug: t.slug, url: 'https://www.start.gg/' + t.slug, date: dstr(t.startAt), startAt: t.startAt, attendees: t.numAttendees, ultimateEntrants: entrantsOf.get(t.id) ?? null, winner: ultWinnerOf[t.id] ?? null, ultimateWinner: winnerTag(t.id, MAIN_RE), redemptionWinner: winnerTag(t.id, /redemption/i), meleeWinner: winnerTag(t.id, /melee/i) })), null, 2));
  writeOut(`${OUT}/data/winners.json`, JSON.stringify(winners.map((w) => ({ id: w.id, tag: w.tag, aliases: w.names, wins: w.wins, seconds: w.seconds, thirds: w.thirds, fourths: w.fourths, podiums: w.podiums, mostUsedCharacter: w.sig ? { name: w.sig[0], games: w.sig[1] } : null, first: dstr(w.firstDate), last: dstr(w.lastDate) })), null, 2));
  const matchupRows = matchupsFull.chars.flatMap((a) => matchupsFull.chars.filter((b) => b !== a && matchupsFull.cells[a]?.[b]).map((b) => ({ character: a, opponent: b, games: matchupsFull.cells[a][b].games, wins: matchupsFull.cells[a][b].wins, winrate: Math.round(matchupsFull.cells[a][b].winrate * 1000) / 10 })));
  writeOut(`${OUT}/data/charts-data.json`, JSON.stringify({ attendance: att, winners: winners.filter((w) => w.wins > 0), characters: charList, editionsPerYear: yearRows, largest: { ...top, url: 'https://www.start.gg/' + top.slug }, streaks, meleeTop, entered: enteredList, loyaltyTiers: tiers, attendanceHistogram: histogram, returnRates: rates, seasonality: season, newcomersByYear: flow.perYear, cumulativePlayers: growthPoints.map((p) => ({ date: p.date, startAt: p.startAt, newPlayers: p.newPlayers, distinctEver: p.total })), matchups: { characters: matchupsFull.chars, rows: matchupRows }, crossSeries: bothSeries, redemption: redWinners.filter((w) => w.wins > 0).map((w) => ({ tag: w.tag, wins: w.wins, podiums: w.podiums, ultWins: w.ultWins })) }, null, 2));
  writeOut(`${OUT}/data/tournaments.csv`, csv([['id', 'date', 'name', 'attendees', 'ultimate_entrants', 'winner_tag', 'url'], ...tournaments.map((t) => { const w = ultWinnerOf[t.id]; return [t.id, dstr(t.startAt), t.name, t.numAttendees, entrantsOf.get(t.id) ?? '', w?.tag ?? '', 'https://www.start.gg/' + t.slug]; })]));
  writeOut(`${OUT}/data/winners.csv`, csv([['player_id', 'tag', 'wins', '2nd', '3rd', '4th', 'podiums', 'most_used_character', 'aliases'], ...winners.map((w) => [w.id, w.tag, w.wins, w.seconds, w.thirds, w.fourths, w.podiums, w.sig ? `${w.sig[0]} (${w.sig[1]})` : '', w.names.join(' | ')])]));
  if (charList.length) {
    writeOut(`${OUT}/data/characters.json`, JSON.stringify({ coverage: { sets: totalSets, gamesWithCharacters: totalGames }, characters: charList }, null, 2));
    writeOut(`${OUT}/data/characters.csv`, csv([['character', 'games', 'game_wins', 'winrate'], ...charList.map((c) => [c.name, c.games, c.wins, Math.round(c.winrate * 1000) / 10 + '%'])]));
  }
  writeOut(`${OUT}/data/attendance.json`, JSON.stringify(enteredList.map((p) => ({ id: p.id, tag: p.tag, eventsEntered: p.events, loyaltyTier: loyaltyTier(p.events)?.label ?? '', ultimateWins: p.ultWins })), null, 2));
  writeOut(`${OUT}/data/attendance.csv`, csv([['player_id', 'tag', 'events_entered', 'loyalty_tier', 'ultimate_wins'], ...enteredList.map((p) => [p.id, p.tag, p.events, loyaltyTier(p.events)?.label ?? '', p.ultWins])]));
  writeOut(`${OUT}/data/retention.json`, JSON.stringify({ distinctPlayers: rates.distinct, totalEntries: rates.totalEntries, firstTimeRate: Math.round(rates.firstTimeRate * 1000) / 10, loyaltyTiers: tiers, histogram, returnRates: rates.stages, byYear: flow.perYear, cumulative: growthPoints.map((p) => ({ date: p.date, newPlayers: p.newPlayers, distinctEver: p.total })) }, null, 2));
  writeOut(`${OUT}/data/retention.csv`, csv([['tier', 'events_entered', 'players', 'pct_of_players', 'entries', 'pct_of_entries'], ...tiers.map((t) => [t.label, t.max == null ? t.min + '+' : t.min === t.max ? String(t.min) : t.min + '–' + t.max, t.players, pct1(t.pctPlayers), t.entries, pct1(t.pctEntries)])]));
  writeOut(`${OUT}/data/seasonality.json`, JSON.stringify(season, null, 2));
  writeOut(`${OUT}/data/seasonality.csv`, csv([['month', 'tournaments', 'total_attendees', 'avg_attendees'], ...season.map((r) => [r.name, r.tournaments, r.totalAttendees, r.avgAttendees ?? ''])]));
  if (charList.length) {
    writeOut(`${OUT}/data/matchups.json`, JSON.stringify({ characters: matchupsFull.chars, note: 'row character winrate, games with both characters reported only, mirror matches excluded. every character pair with a reported game, not just the ones in the page matrix', matchups: matchupRows }, null, 2));
    writeOut(`${OUT}/data/matchups.csv`, csv([['character', 'opponent', 'games', 'wins', 'winrate'], ...matchupRows.map((r) => [r.character, r.opponent, r.games, r.wins, r.winrate + '%'])]));
  }
  if (bothSeries.length) {
    writeOut(`${OUT}/data/cross-series.json`, JSON.stringify(bothSeries.map((r) => ({ id: r.id, tag: r.tag, aliases: r.names, combinedEvents: r.totalEvents, combinedWins: r.totalWins, combinedPodiums: r.totalPodiums, perSeries: r.per })), null, 2));
    writeOut(`${OUT}/data/cross-series.csv`, csv([['player_id', 'tag', 'combined_events', ...seriesData.map((s) => seriesLabel(s.slug) + '_events'), 'combined_wins', ...seriesData.map((s) => seriesLabel(s.slug) + '_wins'), 'aliases'], ...bothSeries.map((r) => [r.id, r.tag, r.totalEvents, ...seriesData.map((s) => r.per[s.slug]?.events ?? 0), r.totalWins, ...seriesData.map((s) => r.per[s.slug]?.wins ?? 0), r.names.join(' | ')])]));
  }
  if (has('sides')) {
    writeOut(`${OUT}/data/standings-ultimate.json`, JSON.stringify(ultStandings, null, 2));
    writeOut(`${OUT}/data/side-winners.json`, JSON.stringify(sideGroups.map((g) => ({ group: g.label, events: g.rows.length, winners: winnersFromStandings(g.rows).map((w) => ({ tag: w.tag, aliases: w.names, wins: w.wins, podiums: w.podiums })) })), null, 2));
  }
  if (has('redemption')) {
    writeOut(`${OUT}/data/standings.json`, JSON.stringify(allStandings, null, 2));
    writeOut(`${OUT}/data/redemption-winners.json`, JSON.stringify(redWinners.map((w) => ({ id: w.id, tag: w.tag, aliases: w.names, redemptionWins: w.wins, podiums: w.podiums, ultimateWins: w.ultWins })), null, 2));
    writeOut(`${OUT}/data/redemption-winners.csv`, csv([['player_id', 'tag', 'redemption_wins', 'podiums', 'ultimate_wins', 'aliases'], ...redWinners.map((w) => [w.id, w.tag, w.wins, w.podiums, w.ultWins, w.names.join(' | ')])]));
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
      + `<div data-yearview="cal"><p><small>Click a dot to see its date (X) and attendees (Y). Hover right on a line and a marker snaps onto it with that point's X and Y beside it.</small></p><div class="scroll attchart" id="attchart">${attChart.svg}</div><h3>Tournaments run per year</h3><p><small>Click a bar to see its year (X) and tournaments (Y), and that year's tournaments.</small></p><div class="scroll">${editionsChart}</div>${scrollTable('<th>Year</th><th>Tournaments</th><th>Avg att.</th><th>Distinct champs</th><th>Most titles</th>', yearTbl)}</div>`
      + `<div data-yearview="acad" style="display:none"><p><small>Click a dot to see its date (X) and attendees (Y).</small></p><div class="scroll attchart" id="attchart-acad">${attChartAcad.svg}</div><h3>Tournaments run per academic year</h3><p><small>Click a bar to see its academic year (X) and tournaments (Y), and that year's tournaments.</small></p><div class="scroll">${editionsAcadChart}</div>${scrollTable('<th>Academic year</th><th>Tournaments</th><th>Avg att.</th><th>Distinct champs</th><th>Most titles</th>', acadTbl)}</div>`;
  } else {
    attBody = `${togglesHtml}<p><small>Click a dot to see its date (X) and attendees (Y). Hover right on a line and a marker snaps onto it with that point's X and Y beside it.</small></p><div class="scroll attchart" id="attchart">${attChart.svg}</div><h3>Tournaments run per year</h3><p><small>Click a bar to see its year (X) and tournaments (Y), and that year's tournaments.</small></p><div class="scroll">${editionsChart}</div>${scrollTable('<th>Year</th><th>Tournaments</th><th>Avg att.</th><th>Distinct champs</th><th>Most titles</th>', yearTbl)}`;
  }
  add('att', 'Attendance', card('att', `Attendance over time (${n} tournaments, avg ${avg.toFixed(1)})`, attBody));
  const playedMonths = season.filter((r) => r.tournaments > 0);
  const bigMonth = playedMonths.reduce((a, b) => (b.avgAttendees > a.avgAttendees ? b : a));
  const quietMonth = playedMonths.reduce((a, b) => (b.avgAttendees < a.avgAttendees ? b : a));
  const darkMonths = season.filter((r) => r.tournaments === 0).map((r) => r.name);
  const seasonTbl = season.map((r) => `<tr><td>${r.name}</td><td>${r.tournaments}</td><td>${r.avgAttendees == null ? '—' : r.avgAttendees.toFixed(1)}</td><td>${r.tournaments ? r.totalAttendees : '—'}</td></tr>`).join('\n');
  add('season', 'Seasonality', card('season', 'Seasonality (average attendance by month of year)',
    `<p>Biggest month: <b>${esc(bigMonth.name)}</b>, ${bigMonth.avgAttendees.toFixed(1)} average over ${bigMonth.tournaments} tournament${bigMonth.tournaments === 1 ? '' : 's'}. Quietest month with any: <b>${esc(quietMonth.name)}</b>, ${quietMonth.avgAttendees.toFixed(1)} over ${quietMonth.tournaments}.${darkMonths.length ? ` No tournaments at all in ${esc(darkMonths.join(', '))}.` : ''}</p><p><small>Click a bar to see its month (X) and average attendance (Y). Grey months never ran a tournament. Pooled over all years.</small></p><div class="scroll">${seasonChart}</div>${scrollTable('<th>Month</th><th>Tournaments</th><th>Avg att.</th><th>Total att.</th>', seasonTbl)}`));
  const crowTop = top10.map((t, i) => `<tr><td>${i + 1}</td><td>${t.date}</td><td><a href="https://www.start.gg/${esc(t.slug)}">${esc(trunc(t.name, 55))}</a></td><td>${t.attendees}</td></tr>`).join('\n');
  add('crowds', 'Crowds', card('crowds', `Largest tournament: ${top.attendees} attendees`,
    `<p><a href="https://www.start.gg/${esc(top.slug)}">${esc(top.name)}</a> — ${top.date}</p><h3>Top 10 crowds</h3>${scrollTable('<th>#</th><th>Date</th><th>Tournament</th><th>Att.</th>', crowTop)}`));
  const latestRows = latest10.map((t) => `<tr><td>${dstr(t.startAt)}</td><td><a href="https://www.start.gg/${esc(t.slug)}">${esc(trunc(t.name, 45))}</a></td><td>${t.numAttendees}</td><td>${t.entrants}</td><td>${t.winner ? esc(t.winner.tag) : t.offweek ? '<i>off week</i>' : '<i>unknown</i>'}</td></tr>`).join('\n');
  add('recent', 'Recent', card('recent', 'Last 10 tournaments', scrollTable('<th>Date</th><th>Tournament</th><th>Att.</th><th>Ult entrants</th><th>Winner</th>', latestRows)));
  const wrows = winners.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.tag)}</td><td>${w.wins}</td><td>${w.seconds}</td><td>${w.thirds}</td><td>${w.fourths}</td><td>${w.sig ? esc(w.sig[0]) + ' (' + w.sig[1] + ')' : ''}</td><td>${esc(w.names.slice(0, 3).join(' / '))}${w.names.length > 3 ? '…' : ''}</td></tr>`).join('\n');
  const streakTbl = streaks.map((r) => `<tr><td>${esc(r.tag)}</td><td>${r.n}</td><td>${dstr(r.from)} → ${dstr(r.to)}</td></tr>`).join('\n');
  add('winners', 'Winners', card('winners', 'Most Ultimate wins (by start.gg player id, all aliases merged)',
    `<p><small>Click a bar to see its player (X) and wins (Y), and every tournament in that run.</small></p><div class="scroll">${winChart}</div><h3>Longest win streaks (consecutive tournaments)</h3><div class="scroll">${streakChart}</div>${scrollTable('<th>Player</th><th>Streak</th><th>Span</th>', streakTbl)}${scrollTable('<th>#</th><th>Player</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th><th>Most used character</th><th>Aliases</th>', wrows)}`, '#4c78a8'));
  const enteredTbl = enteredList.map((p, i) => `<tr data-events="${p.events}"><td>${i + 1}</td><td>${esc(p.tag)}</td><td>${p.events}</td><td>${esc(loyaltyTier(p.events)?.label ?? '')}</td><td>${p.ultWins}</td><td>${esc((p.names ?? [p.tag]).slice(0, 3).join(' / '))}${(p.names ?? []).length > 3 ? '…' : ''}</td></tr>`).join('\n');
  add('attended', 'Attendance', card('attended', `Most events entered (${offweekRows.length ? 'Ultimate Singles + off-week brackets' : 'Ultimate Singles'}, ${attendanceRows.length} events with entrant lists)`,
    `<p><small>Click a bar to see its player (X) and events entered (Y), and every tournament they entered.</small></p><p><label><input type="checkbox" id="fewtoggle"> hide players with 1–2 events</label></p><div class="scroll" id="attp-all">${attPChart}</div><div class="scroll" id="attp-regular" style="display:none">${attPChartRegular}</div>${scrollTable('<th>#</th><th>Player</th><th>Events entered</th><th>Tier</th><th>Ult wins</th><th>Aliases</th>', enteredTbl)}`));
  if (enteredList.length) {
    const tierRange = (t) => t.max == null ? t.min + '+' : t.min === t.max ? String(t.min) : t.min + '–' + t.max;
    const tierTbl = tiers.map((t) => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${t.color}"></span> ${esc(t.label)}</td><td>${tierRange(t)}</td><td>${t.players}</td><td>${pct1(t.pctPlayers)}</td><td>${t.entries}</td><td>${pct1(t.pctEntries)}</td></tr>`).join('\n');
    const stageName = { 1: '1st event', 2: '2nd event', 3: '3rd event', 5: '5th event', 10: '10th event', 20: '20th event' };
    const funnelTbl = rates.stages.map((s) => `<tr><td>${stageName[s.stage] ?? s.stage + 'th event'}</td><td>${s.players}</td><td>${pct1(s.pctOfFirst)}</td><td>${s.conversion == null ? '—' : pct1(s.conversion)}</td></tr>`).join('\n');
    const flowYearTbl = flow.perYear.map((r) => `<tr><td>${r.year}</td><td>${r.entrants}</td><td>${r.first}</td><td>${pct1(r.entrants ? r.first / r.entrants : 0)}</td><td>${r.second}</td><td>${pct1(r.entrants ? r.second / r.entrants : 0)}</td><td>${r.returning}</td><td>${pct1(r.entrants ? r.returning / r.entrants : 0)}</td></tr>`).join('\n');
    const secondRate = rates.stages.find((s) => s.stage === 2)?.conversion ?? 0;
    const thirdRate = rates.stages.find((s) => s.stage === 3)?.conversion ?? 0;
    add('loyalty', 'Loyalty', card('loyalty', `Loyalty, growth and return rates (${rates.distinct} distinct players, ${rates.totalEntries.toLocaleString('en-US')} entries)`,
      `<p>First-time rate: <b>${pct1(rates.firstTimeRate)}</b> of all entries are a player's first event here. Second-time rate: <b>${pct1(secondRate)}</b> of first-timers came back for a 2nd event. Third-time rate: <b>${pct1(thirdRate)}</b> of those came back for a 3rd.</p>`
      + `<h3>Cumulative unique players</h3><p><small>Click a dot to see its date (X) and distinct players ever (Y). Only goes up: each edition adds its first-timers.</small></p><div class="scroll">${growthChart}</div>`
      + `<h3>Newcomers per year</h3><p><small>First-time players per year. Click a bar to see its year (X) and newcomers (Y).</small></p><div class="scroll">${newcomersChart}</div>`
      + `<h3>Attendance histogram, by loyalty tier</h3><p><small>Players by events entered, coloured by tier. Click a bar to see everyone in that bracket.</small></p><div class="scroll">${histChart}</div>${scrollTable('<th>Tier</th><th>Events</th><th>Players</th><th>% of players</th><th>Entries</th><th>% of entries</th>', tierTbl)}`
      + `<h3>Return rates</h3><p><small>Conversion is the share of the previous row that reached this one: the 2nd-event row's conversion is the second-time rate, the 3rd-event row's is the third-time rate, and so on.</small></p>${scrollTable('<th>Reached</th><th>Players</th><th>% of first-timers</th><th>Conversion</th>', funnelTbl)}`
      + `<h3>First-time and second-time entries by year</h3>${scrollTable('<th>Year</th><th>Entries</th><th>First-time</th><th>First-time rate</th><th>Second-time</th><th>Second-time rate</th><th>3rd+</th><th>3rd+ rate</th>', flowYearTbl)}`, '#9467bd'));
  }
  if (bothSeries.length) {
    const crossEventHeads = seriesData.map((s) => `<th>${esc(seriesLabel(s.slug))} events</th>`).join('');
    const crossWinHeads = seriesData.map((s) => `<th>${esc(seriesLabel(s.slug))} wins</th>`).join('');
    const crossTbl = bothSeries.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.tag)}</td><td>${r.totalEvents}</td>${seriesData.map((s) => `<td>${r.per[s.slug]?.events ?? 0}</td>`).join('')}<td>${r.totalWins}</td>${seriesData.map((s) => `<td>${r.per[s.slug]?.wins ?? 0}</td>`).join('')}<td>${r.totalPodiums}</td></tr>`).join('\n');
    const dualOnly = bothSeries.filter((r) => r.totalWins > 0).length;
    add('cross', 'Both series', card('cross', `Buffalo overall: plays both series (${bothSeries.length} players)`,
      `<p><small>Matched by start.gg player id across ${seriesData.map((s) => esc(registry[s.slug]?.name ?? s.slug)).join(' and ')}. Combined Ultimate Singles attendance and wins. All ${bothSeries.length}, by combined events. Also in <code>data/cross-series.json</code>. ${dualOnly} of them have won in either series.</small></p>${scrollTable('<th>#</th><th>Player</th><th>Combined events</th>' + crossEventHeads + '<th>Combined wins</th>' + crossWinHeads + '<th>Combined top 4s</th>', crossTbl)}`, '#e45756'));
  }
  if (charList.length) {
    const crows = charList.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.name)}</td><td>${c.games}</td><td>${c.wins}</td><td>${(Math.round(c.winrate * 1000) / 10).toFixed(1)}%</td></tr>`).join('\n');
    add('characters', 'Characters', card('characters', `Characters — most games played (Ultimate, ${totalGames.toLocaleString('en-US')} games with both characters reported, ${gamesReportedPct.toFixed(1)}% of all games played, from ${totalSets.toLocaleString('en-US')} sets checked, ${setsReportedPct.toFixed(1)}% of sets have character data reported)`,
      `<p><small>Click a bar to see its character (X) and value (Y).</small></p><div class="scroll">${charGamesChart}</div><h3>Winrate (all characters)</h3><div class="scroll">${charWinChart}</div>${scrollTable('<th>#</th><th>Character</th><th>Games</th><th>Game wins</th><th>Winrate</th>', crows)}`));
    const shade = (c) => {
      if (!c) return '';
      const alpha = c.games < 3 ? 0.06 : Math.min(0.45, Math.abs(c.winrate - 0.5) * 1.6 + 0.05);
      return `background:rgba(${c.winrate >= 0.5 ? '44,160,42' : '228,87,86'},${alpha.toFixed(2)})`;
    };
    const matrixHeads = '<th>vs</th>' + matchups.chars.map((c) => `<th title="${esc(c)}">${esc(trunc(c, 11))}</th>`).join('');
    const matrixRows = matchups.chars.map((a) => `<tr><th>${esc(a)}</th>${matchups.chars.map((b) => {
      if (a === b) return '<td style="text-align:center">—</td>';
      const c = matchups.cells[a]?.[b];
      if (!c) return '<td style="text-align:center">·</td>';
      return `<td style="text-align:center;${shade(c)}" title="${esc(a)} vs ${esc(b)}: ${c.wins}–${c.games - c.wins} in ${c.games} games">${(c.winrate * 100).toFixed(0)}% <small>(${c.games})</small></td>`;
    }).join('')}</tr>`).join('\n');
    const lopsided = [];
    for (let i = 0; i < matchups.chars.length; i++) for (let j = i + 1; j < matchups.chars.length; j++) {
      const a = matchups.chars[i], b = matchups.chars[j], c = matchups.cells[a]?.[b];
      if (c && c.games >= 10) lopsided.push({ a, b, games: c.games, winrate: c.winrate, lean: Math.abs(c.winrate - 0.5) });
    }
    lopsided.sort((x, y) => y.lean - x.lean || y.games - x.games);
    const lopTbl = lopsided.slice(0, 8).map((r) => {
      const fav = r.winrate >= 0.5 ? r.a : r.b;
      const dog = r.winrate >= 0.5 ? r.b : r.a;
      const favRate = r.winrate >= 0.5 ? r.winrate : 1 - r.winrate;
      return `<tr><td>${esc(fav)} over ${esc(dog)}</td><td>${r.games}</td><td>${pct1(favRate)}</td></tr>`;
    }).join('\n');
    // full-roster view: every Smash Ultimate character, generated in the
    // browser on first click so the page doesn't ship two giant tables
    const fullChars = [...new Set([...ULTIMATE_ROSTER, ...matchupsFull.chars])].sort((a, b) => a.localeCompare(b));
    const fullCells = {};
    for (const [a, bs] of Object.entries(matchupsFull.cells)) {
      fullCells[a] = {};
      for (const [b, c] of Object.entries(bs)) if (a !== b) fullCells[a][b] = [c.games, c.wins];
    }
    const matrixScript = `<script>const FULLCHARS = ${JSON.stringify(fullChars).replace(/<\//g, '<\\/')};const FULLCELLS = ${JSON.stringify(fullCells).replace(/<\//g, '<\\/')};
const mbtn = document.getElementById('matrix-toggle');let mgenerated = false, mfull = false;
const mesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const mtrunc = (s) => s.length > 11 ? s.slice(0, 10) + '…' : s;
mbtn.onclick = () => {
  if (!mgenerated) {
    let h = '<table data-full="1"><tr><th>vs</th>';
    for (const b of FULLCHARS) h += '<th title="' + mesc(b) + '">' + mesc(mtrunc(b)) + '</th>';
    h += '</tr>';
    for (const a of FULLCHARS) {
      h += '<tr><th>' + mesc(a) + '</th>';
      for (const b of FULLCHARS) {
        if (a === b) { h += '<td style="text-align:center">—</td>'; continue; }
        const c = FULLCELLS[a] && FULLCELLS[a][b];
        if (!c) { h += '<td style="text-align:center">·</td>'; continue; }
        const wr = c[1] / c[0];
        const alpha = c[0] < 3 ? 0.06 : Math.min(0.45, Math.abs(wr - 0.5) * 1.6 + 0.05);
        h += '<td style="text-align:center;background:rgba(' + (wr >= 0.5 ? '44,160,42' : '228,87,86') + ',' + alpha.toFixed(2) + ')" title="' + mesc(a) + ' vs ' + mesc(b) + ': ' + c[1] + '–' + (c[0] - c[1]) + ' in ' + c[0] + ' games">' + Math.round(wr * 100) + '% <small>(' + c[0] + ')</small></td>';
      }
      h += '</tr>';
    }
    document.getElementById('matrix-full-scroll').innerHTML = h + '</table>';
    mgenerated = true;
  }
  mfull = !mfull;
  document.getElementById('matrix-series').style.display = mfull ? 'none' : '';
  document.getElementById('matrix-full').style.display = mfull ? '' : 'none';
  mbtn.textContent = mfull ? 'Back to the ${matchups.chars.length} series characters' : 'Show the full Smash Ultimate roster matrix (${fullChars.length} characters)';
};</script>`;
    const swatch = (v) => `<span style="display:inline-block;padding:0 6px;border:1px solid var(--line);${shade({ games: 99, winrate: v })}">${Math.round(v * 100)}%</span>`;
    const matrixKey = `<p><small>Shading key, row character's winrate: ${[0.1, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9].map(swatch).join(' ')}<br>Red favours the column character, green the row; darker is further from 50%. Almost-white cells are under 3 games, so barely shaded whatever the winrate. <b>—</b> mirror match, <b>·</b> no reported games. The number in brackets is games played. Click a cell to highlight its row and column so you can follow them across; click it again to clear.</small></p>`;
    add('matchups', 'Matchups', card('matchups', `Matchup matrix (${matchups.chars.length} characters, every matchup in the data)`,
      `<p><small>The whole dataset: every character that appears in a counted game, most played first, and every pair that met, however few games they have. Cell is the row character's winrate against the column character, games in brackets, from ${totalGames.toLocaleString('en-US')} games with both characters reported. Scroll sideways; the row character stays pinned. Small samples read with care: a cell can rest on a single game. Random Character is not in here: it's a random pick from the roster, not a character. Only games with both characters reported count; a game with just one side reported, or neither, is left out entirely. The same pairs are in <code>data/matchups.json</code>.</small></p>${matrixKey}<p><button id="matrix-toggle" type="button">Generate the full Smash Ultimate roster matrix (${fullChars.length} characters)</button></p><div class="matrix" id="matrix-series">${scrollTable(matrixHeads, matrixRows, true)}</div><div class="matrix" id="matrix-full" style="display:none"><div class="scroll" id="matrix-full-scroll"></div></div>${matrixScript}${lopTbl ? `<h3>Most lopsided (10+ games)</h3>${scrollTable('<th>Matchup</th><th>Games</th><th>Favoured winrate</th>', lopTbl)}` : ''}`, '#4c78a8'));
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
      `<p><small>Click a bar to see its player (X) and redemption wins (Y), and every tournament in that run.</small></p><div class="scroll">${redChart}</div>${scrollTable('<th>#</th><th>Player</th><th>Redemption wins</th><th>Top 4s</th><th>Ult wins</th>', redTbl)}`, '#8c564b'));
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
    let row = `<tr><td>${dstr(t.startAt)}</td><td><a href="https://www.start.gg/${esc(t.slug)}">${esc(t.name)}</a>${offweekIds.has(t.id) ? ' ' + pill('s', 'off week') : ''}</td><td>${t.numAttendees}</td><td>${entrantsOf.get(t.id) ?? u.entrants}</td>`;
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
  // the pasted photo as the tab icon, inlined so the one-file page keeps it anywhere
  const faviconPath = path.join(ROOT, 'series', 'shared', 'favicon.png');
  const favicon = existsSync(faviconPath) ? `<link rel="icon" type="image/png" href="data:image/png;base64,${readFileSync(faviconPath).toString('base64')}">` : '';
  // top toggle between the two views of a series with off weeks. winners and
  // matchups are numbered-only in both, so they read the same either way
  const weekToggle = allOffweekTournaments.length ? `<p class="weektoggle">Off-week club nights: ${countOffweeks
    ? `<span class="pill s">counted</span> <a href="on-weeks-only.html">on weeks only</a>`
    : `<a href="index.html">counted</a> <span class="pill s">on weeks only</span>`}<br><small>Updates the whole page: attendance, seasonality, crowds, loyalty, both-series and the tournament list. Winners and matchups are on weeks only in both views; redemption counts an off week only where it ran a bracket.</small></p><script>document.querySelectorAll('.weektoggle a').forEach((a) => a.addEventListener('click', () => { a.href += location.hash; }));</script>` : '';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.title)} — Data Analysis (${n} tournaments)</title>${favicon}
<style>${CSS}</style>
</head><body>
<h1>${esc(cfg.title)} — Data Analysis</h1>
${weekToggle}
<div id="toolbar"><button id="navtoggle" aria-label="toggle menu">☰ menu</button> <button id="darkbtn">🌙 dark</button></div>
<nav class="side">${nav}</nav>
${cards.map((c) => c.html).join('\n')}
</body>
<script>${CLIENT_JS_SORT}</script>
<script>${CLIENT_JS_UI}</script>
${MODAL_HTML}
${clientModal(winInfo)}
</html>`;
  writeFileSync(path.join(OUT, htmlFile), html);
  writeOut(`${OUT}/README.md`, cfg.readme({ n, numbered: numberedTournaments.length, offweeks: offweekTournaments.length, top: { ...top }, ultEvents: ultStandings.length, meleeEvents: meleeStandings.length, redemptionEvents: redStandings.length, totalSets, totalGames, charCount: charList.length, enteredCount: enteredList.length }));

  const checks = validateSeries({ standings: allStandings, attendanceRows, tournaments, entrantsOf, mainEventRe: MAIN_RE });
  if (checks.length) { console.log(`DATA CHECKS (${checks.length}):`); for (const c of checks.slice(0, 30)) console.log(' -', c); }
  else console.log('data checks clean');
  console.log('viewer built:', OUT);
  console.log('tournaments', n, '| ultimate events', ultStandings.length, '| melee events', meleeStandings.length, '| sets', totalSets, '| games w/ chars', totalGames, '| chars', charList.length);
  console.log('top winner:', winners[0].tag, winners[0].wins, '| top char:', charList[0]?.name, charList[0]?.games);
}
