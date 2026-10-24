// builds a series page from its scrape. every series goes through here, with its folders from
// series.json and its page settings from configs.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hbars, barList, line, growthLine, academicStartYear } from './charts.mjs';
import {
  winnersFromStandings, streaksFromStandings, attendanceRanking, charStats, mostUsedChars, bestWithoutTitle, validateSeries,
  loyaltyTier, loyaltyTiers, attendanceHistogram, attendanceFlow, returnRates, matchupMatrix, cumulativePlayers, crossSeries,
  seasonality, ULTIMATE_ROSTER, wilson, charUsers, headToHead, headToHeadSets, hasTop4, podiumRates, podiumTrend,
  periodRetention, favourites, titleSpread, nightsAttended,
} from './compute.mjs';
import { count, ordinal } from '../../src/format.js';
import { CSS, CSS_EXTRA, esc, dstr, trunc, csv, pill, card, scrollTable, seriesSwitcher, filterInput, pageFooter, CLIENT_JS_SORT, CLIENT_JS_UI, MODAL_HTML, clientModal } from './page.mjs';
import { VIEWER, HUB } from '../configs.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const MAIN_RE = /ultimate singles|^smash ultimate$/i;

// windows antivirus or sync can hold a file it just saw written for a moment, which fails the whole build.
// those errors wait 200ms and try again, up to 2 seconds
const LOCKED = ['UNKNOWN', 'EPERM', 'EBUSY', 'EACCES'];
function writeRetrying(file, content) {
  for (let tries = 1; ; tries++) {
    try {
      return writeFileSync(file, content);
    } catch (err) {
      if (!LOCKED.includes(err.code) || tries >= 10) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

export function buildSite(slug, { countOffweeks = true, htmlFile = 'index.html', writeFiles = true } = {}) {
  const reg = JSON.parse(readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'))[slug];
  const cfg = VIEWER[slug];
  if (!reg || !cfg) throw new Error('unknown series ' + slug);
  const SRC = path.join(ROOT, reg.researchDir);
  const OUT = path.join(ROOT, reg.outDir);
  mkdirSync(OUT + '/data', { recursive: true });
  mkdirSync(OUT + '/images', { recursive: true });
  const readJson = (f, fb) => { try { return JSON.parse(readFileSync(path.join(SRC, f), 'utf8')); } catch { return fb; } };
  const readJsonl = (f) => { try { return readFileSync(path.join(SRC, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  // the off-week toggle's second view writes only its own page, so the data
  // and image files on disk always match the default (counted) view
  const writeOut = (file, content) => { if (writeFiles) writeRetrying(file, content); };

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
  // the bracket lists, for what people did in an ultimate bracket: podium rates, favourites and the data checks
  const bracketRows = [...readJson('attendance-ultimate.json', []), ...offweekRows];
  // who came each night, melee included, for attendance, loyalty, newcomers and retention
  const attendanceRows = nightsAttended(bracketRows, readJson('attendance-melee.json', []));
  let charRows = [];
  try {
    charRows = readFileSync(path.join(SRC, 'chars-by-event.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.game === 'Ultimate' && r.games);
  } catch {}
  const games = charRows.flatMap((r) => r.games);
  const entrantsOf = new Map();
  for (const t of tourEvents) for (const e of t.events ?? []) {
    if (MAIN_RE.test(e.name) && !entrantsOf.has(t.id)) entrantsOf.set(t.id, e.numEntrants);
  }

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
  const pct0 = (f) => Math.round((f ?? 0) * 100) + '%';
  // one tag per player id everywhere on the page: the attendance list's
  // longest alias, falling back to whatever tag the row itself carries
  const tagById = Object.fromEntries(enteredList.map((p) => [p.id, p.tag]));
  const tagOf = (id, fallback) => tagById[id] ?? fallback ?? id;
  // year-by-year tables go by calendar year, or Aug to Jun for a school series
  const periodOf = cfg.academic ? academicStartYear : (ts) => new Date(ts * 1000).getUTCFullYear();
  const periodLabel = (k) => (cfg.academic ? `${k}–${String(Number(k) + 1).slice(2)}` : String(k));
  const unit = cfg.academic ? 'academic year' : 'year';
  // head-to-heads go by every finished set's winner and score. the character
  // games make the smaller sample behind the switch. the night's date rides
  // along for first and last met
  const rivalView = (rows) => {
    const dated = (pick) => rows.flatMap((r) => (r[pick] ?? []).map((each) => ({ ...each, startAt: r.startAt })));
    const all = headToHeadSets(dated('sets'));
    const sample = headToHead(dated('games'));
    const total = (pairs, key) => pairs.reduce((sum, pair) => sum + pair[key], 0);
    return { all, sample, sets: total(all, 'sets'), scored: total(all, 'scoredSets'), sampleSets: total(sample, 'sets') };
  };
  const mainRivals = rivalView(charRows);
  const { all: rivalries, sets: rivalSets, scored: rivalScored } = mainRivals;
  // off-week nights' singles brackets, a layer the rivalries card can add on top. only on a page that counts
  // off weeks, and kept out of everything else, characters included
  const offCharRows = countOffweeks ? readJsonl('offweek-chars-by-event.jsonl').filter((r) => r.sets?.length) : [];
  const offRivals = offCharRows.length ? rivalView([...charRows, ...offCharRows]) : null;
  // top-4 rates over the main events each player entered, overall, by
  // period and over the last 10 nights
  const MIN_NIGHTS = 10;
  const rates4 = podiumRates(ultStandings, bracketRows);
  const rates4ById = Object.fromEntries(rates4.map((p) => [p.id, p]));
  const trend = podiumTrend(ultStandings, bracketRows, periodOf);
  const lastNights = ultStandings.filter(hasTop4).sort((a, b) => a.startAt - b.startAt).slice(-10);
  const form = podiumRates(lastNights, bracketRows).filter((p) => p.top4 > 0).sort((a, b) => b.top4 - a.top4 || b.wins - a.wins || a.entered - b.entered);
  const favResults = favourites(ultStandings, bracketRows);
  const spread = titleSpread(favResults, periodOf);
  const startAtOfRow = (r) => startAtByTournament.get(r.tournamentId) ?? 0;
  const retention = periodRetention(attendanceRows, startAtOfRow, periodOf);
  const users = charUsers(games);
  // characters with fewer games than this stay out of the winrate chart: a
  // 3-0 character would top it on noise
  const MIN_CHAR_GAMES = 20;

  // cross-series: the same player ids entered in every other series too.
  // reads the other series' research data straight from its folder
  const registry = JSON.parse(readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'));
  const seriesData = [{ slug, entered: enteredList, winners }];
  for (const [otherSlug, otherReg] of Object.entries(registry)) {
    if (otherSlug === slug) continue;
    const otherDir = path.join(ROOT, otherReg.researchDir);
    const otherRead = (f, fb) => { try { return JSON.parse(readFileSync(path.join(otherDir, f), 'utf8')); } catch { return fb; } };
    const otherAttendance = nightsAttended([...otherRead('attendance-ultimate.json', []), ...otherRead('attendance-offweek.json', [])], otherRead('attendance-melee.json', []));
    const otherWinners = winnersFromStandings(otherRead('standings.json', []).filter((s) => MAIN_RE.test(s.eventName)));
    seriesData.push({ slug: otherSlug, entered: attendanceRanking(otherAttendance), winners: otherWinners });
  }
  const bothSeries = seriesData.length > 1 ? crossSeries(seriesData) : [];
  const seriesLabel = (s) => VIEWER[s]?.short ?? registry[s]?.name ?? s;
  const otherSlugs = seriesData.slice(1).map((s) => s.slug);

  const has = (x) => cfg.extras.includes(x);
  const meleeStandings = allStandings.filter((s) => s.game === 'Melee' && /singles|stampede|^melee$/i.test(s.eventName));
  const meleeTop = has('melee') ? winnersFromStandings(meleeStandings) : [];
  const redStandings = allStandings.filter((s) => /redemption/i.test(s.eventName));
  const redWinners = has('redemption') ? winnersFromStandings(redStandings).map((w) => ({ ...w, ultWins: winById[w.id] ?? 0 })) : [];
  const sideGroups = has('sides') ? (cfg.sideGroups ?? []).map((g) => ({ ...g, rows: allStandings.filter((s) => new RegExp(g.re, 'i').test(s.eventName)) })).filter((g) => g.rows.length) : [];
  const sideOther = has('sides') ? allStandings.filter((s) => !MAIN_RE.test(s.eventName) && s.game !== 'Melee' && !sideGroups.some((g) => g.rows.includes(s))) : [];

  // what clicking a bar or dot lists
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
    if (links.length) winInfo['p1:' + w.id] = { title: `${w.tag} · ${count(links.length, '1st place')}`, links };
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
      if (links.length) winInfo['r:' + w.id] = { title: `${w.tag} · ${count(links.length, 'redemption win')}`, links };
    }
  }
  for (const p of enteredList) {
    const links = enteredByPid[p.id] ?? [];
    if (links.length) winInfo['e:' + p.id] = { title: `${p.tag} · entered ${count(links.length, 'event')}`, links };
  }
  // loyalty histogram bars: everyone in that events-entered bracket, most first
  histogram.forEach((b, i) => {
    const players = enteredList
      .filter((p) => p.events >= b.min && (b.max == null || p.events <= b.max))
      .sort((a, z) => z.events - a.events || a.tag.localeCompare(z.tag));
    if (players.length) winInfo['h:' + i] = {
      title: `Players with ${b.label} event${b.label === '1' ? '' : 's'} (${players.length})`,
      items: players.map((p) => `${esc(p.tag)} · ${count(p.events, 'event')}`),
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
    winInfo['s:' + i] = { title: `${r.tag} · streak of ${r.n} (${dstr(r.from)} → ${dstr(r.to)})`, links };
  });
  // year bars: every tournament in that period
  for (const r of yearRows) {
    const links = byDate.filter((t) => new Date(t.startAt * 1000).getUTCFullYear() === Number(r.key)).map((t) => tLink(t));
    if (links.length) winInfo['y:' + r.key] = { title: `${r.year} · ${count(links.length, 'tournament')}`, links };
  }
  if (acadRows) for (const r of acadRows) {
    const links = byDate.filter((t) => academicStartYear(t.startAt) === Number(r.key)).map((t) => tLink(t));
    if (links.length) winInfo['ya:' + r.key] = { title: `${r.year} academic year · ${count(links.length, 'tournament')}`, links };
  }

  // the images/ files stay svg. the page draws its bars as html rows and gives each line chart a
  // compact phone version
  const lineCharts = (wide, narrow) => `<div class="chart-wide">${wide}</div><div class="chart-narrow">${narrow}</div>`;
  const attChart = line(att);
  const attChartNarrow = line(att, { width: 380, height: 300, compact: true });
  writeOut(`${OUT}/images/attendance.svg`, attChart.svg);
  const seasonItems = season.map((r) => ({ label: r.short, value: r.avgAttendees ?? 0, color: r.tournaments ? '#4c78a8' : '#cccccc' }));
  writeOut(`${OUT}/images/seasonality.svg`, hbars(seasonItems, { labelW: 50, valueFn: (it) => it.value ? it.value.toFixed(1) : '—' }));
  const seasonChart = barList(seasonItems, { labelW: 40, valueFn: (it) => it.value ? it.value.toFixed(1) : '—' });
  const winItems = winners.filter((w) => w.wins > 0).map((w) => ({ label: w.tag, value: w.wins, color: '#54a24b', pid: w.id }));
  writeOut(`${OUT}/images/winners.svg`, hbars(winItems, { labelW: 190 }));
  const winChart = barList(winItems, { labelW: 170, keyFn: (it) => 'p1:' + it.pid });
  const streakItems = streaks.map((r, i) => ({ label: r.tag, value: r.n, color: '#54a24b', idx: i }));
  const streakChart = barList(streakItems, { labelW: 170, keyFn: (it) => 's:' + it.idx });
  const attPItems = enteredList.map((p) => ({ label: p.tag, value: p.events, color: '#e377c2', pid: p.id }));
  writeOut(`${OUT}/images/attendance-players.svg`, hbars(attPItems, { labelW: 190 }));
  const attPChart = barList(attPItems, { labelW: 170, keyFn: (it) => 'e:' + it.pid });
  const attPChartRegular = barList(attPItems.filter((it) => it.value >= 3), { labelW: 170, keyFn: (it) => 'e:' + it.pid });
  const histItems = histogram.map((b, i) => ({ label: b.label + ' events', value: b.players, color: b.color, bucket: i }));
  writeOut(`${OUT}/images/attendance-histogram.svg`, hbars(histItems, { labelW: 90 }));
  const histChart = barList(histItems, { labelW: 90, keyFn: (it) => 'h:' + it.bucket });
  const growthPoints = cumulative.map((p) => { const t = tById.get(p.tournamentId); return { ...p, date: dstr(p.startAt), name: t?.name ?? '' }; });
  const growthChart = growthLine(growthPoints);
  writeOut(`${OUT}/images/cumulative-players.svg`, growthChart);
  const growthChartNarrow = growthLine(growthPoints, { width: 380, height: 240, compact: true });
  const newcomersChart = barList(flow.perYear.map((r) => ({ label: String(r.year), value: r.first, color: '#9467bd' })), { labelW: 50 });
  writeOut(`${OUT}/images/newcomers-per-year.svg`, hbars(flow.perYear.map((r) => ({ label: String(r.year), value: r.first, color: '#9467bd' })), { labelW: 80 }));
  writeOut(`${OUT}/images/editions-per-year.svg`, hbars(yearRows.map((r) => ({ label: String(r.year), value: r.editions, color: '#72b7b2' })), { labelW: 80 }));
  const editionsChart = barList(yearRows.map((r) => ({ label: String(r.year), value: r.editions, color: '#72b7b2', key: r.key })), { labelW: 50, keyFn: (it) => 'y:' + it.key });
  let attChartAcad = null, attChartAcadNarrow = null, editionsAcadChart = '';
  if (cfg.academic) {
    attChartAcad = line(att, { period: 'academic' });
    attChartAcadNarrow = line(att, { period: 'academic', width: 380, height: 300, compact: true });
    writeOut(`${OUT}/images/attendance-academic.svg`, attChartAcad.svg);
    writeOut(`${OUT}/images/editions-academic.svg`, hbars(acadRows.map((r) => ({ label: r.year, value: r.editions, color: '#72b7b2' })), { labelW: 80 }));
    editionsAcadChart = barList(acadRows.map((r) => ({ label: r.year, value: r.editions, color: '#72b7b2', key: r.key })), { labelW: 70, keyFn: (it) => 'ya:' + it.key });
  }
  const charGamesItems = charList.map((c) => ({ label: c.name, value: c.games, color: '#4c78a8' }));
  const charWinItems = charList.filter((c) => c.games >= MIN_CHAR_GAMES).sort((a, b) => b.winrate - a.winrate || b.games - a.games).map((c) => ({ label: `${c.name} (${c.games})`, name: c.name, games: c.games, value: Math.round(c.winrate * 1000) / 10, color: '#eeca3b' }));
  writeOut(`${OUT}/images/characters-games.svg`, hbars(charGamesItems, { labelW: 150 }));
  if (charWinItems.length) writeOut(`${OUT}/images/characters-winrate.svg`, hbars(charWinItems, { labelW: 150, valueFn: (it) => it.value + '%' }));
  const charGamesChart = barList(charGamesItems, { labelW: 150 });
  // on the page the game count rides in the value, so a phone cutting a long
  // name short still shows the sample size
  const charWinChart = barList(charWinItems.map((it) => ({ ...it, label: it.name })), { labelW: 150, valueW: 6.5, valueFn: (it) => `${it.value.toFixed(1)}% (${it.games})` });
  let redChart = '';
  if (has('redemption')) {
    const redItems = redWinners.filter((w) => w.wins > 0).map((w) => ({ label: w.tag, value: w.wins, color: '#8c564b', pid: w.id }));
    writeOut(`${OUT}/images/redemption.svg`, hbars(redItems, { labelW: 190 }));
    redChart = barList(redItems, { labelW: 170, keyFn: (it) => 'r:' + it.pid });
  }

  // the downloads in data/. a .csv gets rows, anything else goes out as json
  const writeData = (name, value) => writeOut(`${OUT}/data/${name}`, name.endsWith('.csv') ? csv(value) : JSON.stringify(value, null, 2));
  // percentages to one decimal, the way every download has them
  const tenths = (x) => Math.round(x * 1000) / 10;
  writeData('tournaments.json', tournaments.map((t) => ({
    id: t.id, name: t.name, slug: t.slug, url: 'https://www.start.gg/' + t.slug, date: dstr(t.startAt), startAt: t.startAt,
    attendees: t.numAttendees, ultimateEntrants: entrantsOf.get(t.id) ?? null, winner: ultWinnerOf[t.id] ?? null,
    ultimateWinner: winnerTag(t.id, MAIN_RE), redemptionWinner: winnerTag(t.id, /redemption/i), meleeWinner: winnerTag(t.id, /melee/i),
  })));
  writeData('tournaments.csv', [
    ['id', 'date', 'name', 'attendees', 'ultimate_entrants', 'winner_tag', 'url'],
    ...tournaments.map((t) => [t.id, dstr(t.startAt), t.name, t.numAttendees, entrantsOf.get(t.id) ?? '', ultWinnerOf[t.id]?.tag ?? '', 'https://www.start.gg/' + t.slug]),
  ]);
  writeData('winners.json', winners.map((w) => ({
    id: w.id, tag: w.tag, aliases: w.names, wins: w.wins, seconds: w.seconds, thirds: w.thirds, fourths: w.fourths, podiums: w.podiums,
    mostUsedCharacter: w.sig ? { name: w.sig[0], games: w.sig[1] } : null, first: dstr(w.firstDate), last: dstr(w.lastDate),
  })));
  writeData('winners.csv', [
    ['player_id', 'tag', 'wins', '2nd', '3rd', '4th', 'podiums', 'most_used_character', 'aliases'],
    ...winners.map((w) => [w.id, w.tag, w.wins, w.seconds, w.thirds, w.fourths, w.podiums, w.sig ? `${w.sig[0]} (${w.sig[1]})` : '', w.names.join(' | ')]),
  ]);
  const matchupRows = matchupsFull.chars.flatMap((a) => matchupsFull.chars.filter((b) => b !== a && matchupsFull.cells[a]?.[b]).map((b) => {
    const cell = matchupsFull.cells[a][b];
    return { character: a, opponent: b, games: cell.games, wins: cell.wins, winrate: tenths(cell.winrate) };
  }));
  writeData('charts-data.json', {
    attendance: att, winners: winners.filter((w) => w.wins > 0), characters: charList, editionsPerYear: yearRows,
    largest: { ...top, url: 'https://www.start.gg/' + top.slug }, streaks, meleeTop, entered: enteredList, loyaltyTiers: tiers,
    attendanceHistogram: histogram, returnRates: rates, seasonality: season, newcomersByYear: flow.perYear,
    cumulativePlayers: growthPoints.map((p) => ({ date: p.date, startAt: p.startAt, newPlayers: p.newPlayers, distinctEver: p.total })),
    matchups: { characters: matchupsFull.chars, rows: matchupRows },
    crossSeries: bothSeries,
    redemption: redWinners.filter((w) => w.wins > 0).map((w) => ({ tag: w.tag, wins: w.wins, podiums: w.podiums, ultWins: w.ultWins })),
  });
  if (charList.length) {
    const range = (c) => wilson(c.wins, c.games);
    writeData('characters.json', {
      coverage: { sets: totalSets, gamesWithCharacters: totalGames },
      note: 'winrateLow95/High95: 95% wilson interval on the winrate. players: distinct player ids who played the character',
      characters: charList.map((c) => ({ ...c, players: users[c.name] ?? 0, winrateLow95: tenths(range(c).low), winrateHigh95: tenths(range(c).high) })),
    });
    writeData('characters.csv', [
      ['character', 'games', 'players', 'game_wins', 'winrate', 'winrate_low_95', 'winrate_high_95'],
      ...charList.map((c) => [c.name, c.games, users[c.name] ?? 0, c.wins, tenths(c.winrate) + '%', pct1(range(c).low), pct1(range(c).high)]),
    ]);
    writeData('matchups.json', {
      characters: matchupsFull.chars,
      note: 'row character winrate, games with both characters reported only, mirror matches excluded. every character pair with a reported game, not just the ones in the page matrix',
      matchups: matchupRows,
    });
    writeData('matchups.csv', [['character', 'opponent', 'games', 'wins', 'winrate'], ...matchupRows.map((r) => [r.character, r.opponent, r.games, r.wins, r.winrate + '%'])]);
  }
  writeData('attendance.json', enteredList.map((p) => ({ id: p.id, tag: p.tag, eventsEntered: p.events, loyaltyTier: loyaltyTier(p.events)?.label ?? '', ultimateWins: p.ultWins })));
  writeData('attendance.csv', [
    ['player_id', 'tag', 'events_entered', 'loyalty_tier', 'ultimate_wins'],
    ...enteredList.map((p) => [p.id, p.tag, p.events, loyaltyTier(p.events)?.label ?? '', p.ultWins]),
  ]);
  writeData('retention.json', {
    distinctPlayers: rates.distinct, totalEntries: rates.totalEntries, firstTimeRate: tenths(rates.firstTimeRate),
    loyaltyTiers: tiers, histogram, returnRates: rates.stages, byYear: flow.perYear,
    cumulative: growthPoints.map((p) => ({ date: p.date, newPlayers: p.newPlayers, distinctEver: p.total })),
    byPeriod: retention.map((r) => ({ ...r, period: periodLabel(r.period), retention: r.retention == null ? null : tenths(r.retention) })),
  });
  writeData('retention.csv', [
    ['tier', 'events_entered', 'players', 'pct_of_players', 'entries', 'pct_of_entries'],
    ...tiers.map((t) => [t.label, t.max == null ? t.min + '+' : t.min === t.max ? String(t.min) : t.min + '–' + t.max, t.players, pct1(t.pctPlayers), t.entries, pct1(t.pctEntries)]),
  ]);
  writeData('seasonality.json', season);
  writeData('seasonality.csv', [['month', 'tournaments', 'total_attendees', 'avg_attendees'], ...season.map((r) => [r.name, r.tournaments, r.totalAttendees, r.avgAttendees ?? ''])]);
  if (bothSeries.length) {
    writeData('cross-series.json', bothSeries.map((r) => ({
      id: r.id, tag: r.tag, aliases: r.names, combinedEvents: r.totalEvents, combinedWins: r.totalWins, combinedPodiums: r.totalPodiums, perSeries: r.per,
    })));
    const eachSeries = (column) => seriesData.map((s) => seriesLabel(s.slug) + '_' + column);
    writeData('cross-series.csv', [
      ['player_id', 'tag', 'combined_events', ...eachSeries('events'), 'combined_wins', ...eachSeries('wins'), 'aliases'],
      ...bothSeries.map((r) => [
        r.id, r.tag, r.totalEvents, ...seriesData.map((s) => r.per[s.slug]?.events ?? 0),
        r.totalWins, ...seriesData.map((s) => r.per[s.slug]?.wins ?? 0), r.names.join(' | '),
      ]),
    ]);
  }
  if (has('sides')) {
    writeData('standings-ultimate.json', ultStandings);
    writeData('side-winners.json', sideGroups.map((g) => ({
      group: g.label, events: g.rows.length,
      winners: winnersFromStandings(g.rows).map((w) => ({ tag: w.tag, aliases: w.names, wins: w.wins, podiums: w.podiums })),
    })));
  }
  if (rivalries.length) {
    const metOn = (at) => (at ? dstr(at) : null);
    writeData('head-to-head.json', {
      note: 'all completed Ultimate Singles sets, excluding DQs and doubles. games come from set scores, so only scoredSets of them add games',
      sets: rivalSets,
      scoredSets: rivalScored,
      pairs: rivalries.map((r) => ({
        a: { id: r.a.id, tag: tagOf(r.a.id, r.a.tag) }, b: { id: r.b.id, tag: tagOf(r.b.id, r.b.tag) },
        sets: r.sets, aSets: r.aSets, bSets: r.bSets, aGames: r.aGames, bGames: r.bGames, scoredSets: r.scoredSets,
        first: metOn(r.first), last: metOn(r.last),
      })),
    });
    writeData('head-to-head.csv', [
      ['player_a_id', 'player_a', 'player_b_id', 'player_b', 'sets', 'a_sets', 'b_sets', 'a_games', 'b_games', 'scored_sets', 'first_met', 'last_met'],
      ...rivalries.map((r) => [
        r.a.id, tagOf(r.a.id, r.a.tag), r.b.id, tagOf(r.b.id, r.b.tag), r.sets, r.aSets, r.bSets,
        r.aGames, r.bGames, r.scoredSets, metOn(r.first) ?? '', metOn(r.last) ?? '',
      ]),
    ]);
  }
  // each player's nights, top 4s and wins per year, for the trend
  const yearsOf = (id) => Object.fromEntries(Object.entries(trend.players.find((t) => t.id === id)?.per ?? {})
    .map(([k, v]) => [periodLabel(k), { entered: v.entered, top4: v.top4, wins: v.wins }]));
  writeData('podium-rates.json', {
    note: 'Ultimate Singles nights with an entrant list. top4Rate is top 4s over nights entered',
    players: rates4.map((p) => ({
      id: p.id, tag: tagOf(p.id, p.tag), entered: p.entered, top4: p.top4, wins: p.wins,
      top4Rate: tenths(p.top4Rate), winRate: tenths(p.winRate), byPeriod: yearsOf(p.id),
    })),
  });
  writeData('podium-rates.csv', [
    ['player_id', 'tag', 'nights_entered', 'top4s', 'wins', 'top4_rate', 'win_rate'],
    ...rates4.map((p) => [p.id, tagOf(p.id, p.tag), p.entered, p.top4, p.wins, pct1(p.top4Rate), pct1(p.winRate)]),
  ]);
  writeData('favourites.json', {
    note: 'favourite: the entrant with the most titles in the 365 days before that night, ties all count. outcome is favourite, upset, open (nobody had a recent title) or unknown (no entrant list)',
    byPeriod: spread.map((r) => ({
      period: periodLabel(r.period), nights: r.nights, champions: r.champions, firstTitles: r.firstTitles,
      mostTitles: { tag: tagOf(r.top.id, r.top.tag), wins: r.top.wins }, topShare: tenths(r.topShare), favouriteWon: r.favourite, upsets: r.upset,
    })),
    nights: favResults.map((r) => ({
      date: dstr(r.startAt), tournament: tById.get(r.tournamentId)?.name ?? null, winner: tagOf(r.winner.id, r.winner.tag),
      winnerTitlesPastYear: r.winnerTitles, favourites: r.favourites.map((f) => tagOf(f.id, f.tag)), favouriteTitlesPastYear: r.favouriteTitles,
      favouritePlace: r.favouritePlace, outcome: r.outcome, firstTitle: r.firstTitle,
    })),
  });
  if (has('redemption')) {
    writeData('standings.json', allStandings);
    writeData('redemption-winners.json', redWinners.map((w) => ({ id: w.id, tag: w.tag, aliases: w.names, redemptionWins: w.wins, podiums: w.podiums, ultimateWins: w.ultWins })));
    writeData('redemption-winners.csv', [
      ['player_id', 'tag', 'redemption_wins', 'podiums', 'ultimate_wins', 'aliases'],
      ...redWinners.map((w) => [w.id, w.tag, w.wins, w.podiums, w.ultWins, w.names.join(' | ')]),
    ]);
  }

  // the cards, in the same order on every series
  const n = tournaments.length;
  const allSeries = JSON.parse(readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'));
  const switcher = seriesSwitcher(slug, allSeries, HUB);
  const builtDay = new Date().toISOString().slice(0, 10);
  const rangeText = n ? `${n} tournaments, ${dstr(byDate[0].startAt)} → ${dstr(byDate[byDate.length - 1].startAt)}` : `${n} tournaments`;
  const cards = [];
  const add = (id, label, html) => cards.push({ id, label, html });
  const yearRow = (r) => `<tr><td>${r.year}</td><td>${r.editions}</td><td>${r.avgAtt}</td><td>${r.distinctChamps}</td><td>${esc(r.topChamp)}</td></tr>`;
  const yearsTable = (label, rows) => scrollTable(`<th>${label}</th><th>Tournaments</th><th>Avg att.</th><th>Distinct champs</th><th class="wr">Most titles</th>`, rows.map(yearRow).join('\n'));
  const toggle = (layer, label) => `<label><input type="checkbox" data-t="${layer}" checked> ${label}</label>`;
  const togglesHtml = `<div class="toggles">Show: ${[toggle('s-raw', 'attendance'), toggle('s-avg', 'average'), toggle('s-whole', 'whole trend'), toggle('s-year', 'yearly trends')].join(' ')}</div>`;
  // the calendar-year view, which is the only one unless the series runs on the school year
  const calendarYears = '<p><small>Click a dot to see its date (X) and attendees (Y). Hover right on a line and a marker snaps onto it with that point\'s X and Y beside it.</small></p>'
    + `<div class="scroll attchart" id="attchart">${lineCharts(attChart.svg, attChartNarrow.svg)}</div>`
    + '<h3>Tournaments run per year</h3><p><small>Click a bar to see its year (X) and tournaments (Y), and that year\'s tournaments.</small></p>'
    + `<div class="scroll">${editionsChart}</div>${yearsTable('Year', yearRows)}`;
  let attBody = togglesHtml + calendarYears;
  if (cfg.academic) {
    attBody = togglesHtml
      + '<p>Year view: <label><input type="radio" name="yearview" value="cal" checked> calendar</label> <label><input type="radio" name="yearview" value="acad"> academic (Aug–Jun)</label></p>'
      + `<div data-yearview="cal">${calendarYears}</div>`
      + '<div data-yearview="acad" style="display:none"><p><small>Click a dot to see its date (X) and attendees (Y).</small></p>'
      + `<div class="scroll attchart" id="attchart-acad">${lineCharts(attChartAcad.svg, attChartAcadNarrow.svg)}</div>`
      + '<h3>Tournaments run per academic year</h3><p><small>Click a bar to see its academic year (X) and tournaments (Y), and that year\'s tournaments.</small></p>'
      + `<div class="scroll">${editionsAcadChart}</div>${yearsTable('Academic year', acadRows)}</div>`;
  }
  add('att', 'Attendance', card('att', `Attendance over time (${n} tournaments, avg ${avg.toFixed(1)})`, attBody));
  const playedMonths = season.filter((r) => r.tournaments > 0);
  const bigMonth = playedMonths.reduce((a, b) => (b.avgAttendees > a.avgAttendees ? b : a));
  const quietMonth = playedMonths.reduce((a, b) => (b.avgAttendees < a.avgAttendees ? b : a));
  const darkMonths = season.filter((r) => r.tournaments === 0).map((r) => r.name);
  const seasonTbl = season.map((r) => `<tr><td>${r.name}</td><td>${r.tournaments}</td><td>${r.avgAttendees == null ? '—' : r.avgAttendees.toFixed(1)}</td><td>${r.tournaments ? r.totalAttendees : '—'}</td></tr>`).join('\n');
  add('season', 'Seasonality', card('season', 'Seasonality (average attendance by month of year)',
    `<p>Biggest month: <b>${esc(bigMonth.name)}</b>, ${bigMonth.avgAttendees.toFixed(1)} average over ${count(bigMonth.tournaments, 'tournament')}. `
    + `Quietest month with any: <b>${esc(quietMonth.name)}</b>, ${quietMonth.avgAttendees.toFixed(1)} over ${quietMonth.tournaments}.`
    + `${darkMonths.length ? ` No tournaments at all in ${esc(darkMonths.join(', '))}.` : ''}</p>`
    + '<p><small>Click a bar to see its month (X) and average attendance (Y). Grey months never ran a tournament. Pooled over all years.</small></p>'
    + `<div class="scroll">${seasonChart}</div>${scrollTable('<th>Month</th><th>Tournaments</th><th>Avg att.</th><th>Total att.</th>', seasonTbl)}`));
  const crowTop = top10.map((t, i) => `<tr><td>${i + 1}</td><td>${t.date}</td><td><a href="https://www.start.gg/${esc(t.slug)}">${esc(trunc(t.name, 55))}</a></td><td>${t.attendees}</td></tr>`).join('\n');
  add('crowds', 'Crowds', card('crowds', `Largest tournament: ${top.attendees} attendees`,
    `<p><a href="https://www.start.gg/${esc(top.slug)}">${esc(top.name)}</a> · ${top.date}</p><h3>Top 10 crowds</h3>${scrollTable('<th>#</th><th>Date</th><th class="tx">Tournament</th><th>Att.</th>', crowTop)}`));
  const latestRows = latest10.map((t) => `<tr><td>${dstr(t.startAt)}</td><td><a href="https://www.start.gg/${esc(t.slug)}">${esc(trunc(t.name, 45))}</a></td><td>${t.numAttendees}</td><td>${t.entrants}</td><td>${t.winner ? esc(t.winner.tag) : t.offweek ? '<i>off week</i>' : '<i>unknown</i>'}</td></tr>`).join('\n');
  add('recent', 'Recent', card('recent', 'Last 10 tournaments', scrollTable('<th>Date</th><th class="tx">Tournament</th><th>Att.</th><th class="lo">Ult entrants</th><th class="tx">Winner</th>', latestRows, false, 'class="wrap2"')));
  const wrows = winners.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.tag)}</td><td>${w.wins}</td><td>${w.seconds}</td><td>${w.thirds}</td><td>${w.fourths}</td><td>${w.sig ? esc(w.sig[0]) + ' (' + w.sig[1] + ')' : ''}</td><td>${esc(w.names.slice(0, 3).join(' / '))}${w.names.length > 3 ? '…' : ''}</td></tr>`).join('\n');
  // each date stays whole when the span wraps on a phone
  const streakTbl = streaks.map((r) => `<tr><td>${esc(r.tag)}</td><td>${r.n}</td><td><span class="nw">${dstr(r.from)}</span> → <span class="nw">${dstr(r.to)}</span></td></tr>`).join('\n');
  // closest without ever winning: the same data, just the winless end of it
  const chasing = bestWithoutTitle(winners, 10);
  const chaseTbl = chasing.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.tag)}</td><td>${w.seconds}</td><td>${w.thirds}</td><td>${w.fourths}</td><td>${w.podiums}</td></tr>`).join('\n');
  add('winners', 'Winners', card('winners', 'Most Ultimate wins (by start.gg player id, all aliases merged)',
    `<p><small>Click a bar to see its player (X) and wins (Y), and every tournament in that run.</small></p><div class="scroll">${winChart}</div><h3>Longest win streaks (consecutive tournaments)</h3><div class="scroll">${streakChart}</div>${scrollTable('<th class="tx">Player</th><th>Streak</th><th class="wr">Span</th>', streakTbl)}`
    + `${chaseTbl ? `<h3>Most podiums without a title</h3>${scrollTable('<th>#</th><th class="tx">Player</th><th>2nd</th><th>3rd</th><th>4th</th><th>Top 4s</th>', chaseTbl)}` : ''}`
    + `${filterInput('winners-q', 'winners-tbl', 'Search players…')}${scrollTable('<th>#</th><th class="tx">Player</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th><th class="wr">Most used character</th><th class="lo">Aliases</th>', wrows, false, 'id="winners-tbl"')}`, '#4c78a8'));

  // consistency and form: top-4 rates over nights entered
  const listedEvents = new Set(bracketRows.map((r) => r.eventId));
  const ratedNights = ultStandings.filter((s) => listedEvents.has(s.eventId) && hasTop4(s)).length;
  const rateCell = (f) => `<td data-v="${(f ?? 0).toFixed(4)}">${pct0(f)}</td>`;
  const steady = rates4.filter((p) => p.entered >= MIN_NIGHTS && p.top4 > 0);
  const steadyTbl = steady.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(tagOf(p.id, p.tag))}</td><td>${p.entered}</td><td>${p.top4}</td>`
    + `${rateCell(p.top4Rate)}<td>${p.wins}</td>${rateCell(p.winRate)}</tr>`).join('\n');
  const trendTop = [...rates4].sort((a, b) => b.top4 - a.top4 || b.wins - a.wins).slice(0, 12);
  const trendById = Object.fromEntries(trend.players.map((t) => [t.id, t]));
  const trendTbl = trendTop.map((p) => `<tr><td>${esc(tagOf(p.id, p.tag))}</td>${trend.periods.map((k) => {
    const c = trendById[p.id]?.per[k];
    return c ? `<td data-v="${c.top4Rate.toFixed(4)}">${pct0(c.top4Rate)} <small class="nw">${c.top4}/${c.entered}</small></td>` : '<td data-v="">—</td>';
  }).join('')}${rateCell(p.top4Rate)}</tr>`).join('\n');
  const formTbl = form.map((p) => `<tr><td>${esc(tagOf(p.id, p.tag))}</td><td>${p.entered}</td><td>${p.top4}</td><td>${p.wins}</td>${rateCell(rates4ById[p.id]?.top4Rate)}</tr>`).join('\n');
  if (rates4.length) {
    add('form', 'Consistency', card('form', 'Consistency and form (Ultimate Singles top 4s per night entered)',
      `<p><small>Top-4 rate is top 4s over nights entered, from the ${ratedNights} nights with both a reported top 4 and an entrant list. Standings only go to 4th, so a top 4 is the finest placement the data has.</small></p>`
      + `<h3>Most consistent (${MIN_NIGHTS}+ nights entered)</h3>${filterInput('form-q', 'form-tbl', 'Search players…')}`
      + scrollTable('<th>#</th><th class="tx">Player</th><th>Nights</th><th>Top 4s</th><th>Top-4 rate</th><th>Wins</th><th class="lo">Win rate</th>', steadyTbl, false, 'id="form-tbl"')
      + `<h3>Top-4 rate by ${unit}</h3><p><small>The ${trendTop.length} players with the most top 4s. `
      + `Each cell is that ${unit}'s top-4 rate, then top 4s over nights entered. A dash means they didn't enter that ${unit}.</small></p>`
      + scrollTable('<th class="tx">Player</th>' + trend.periods.map((k) => `<th class="wr">${periodLabel(k)}</th>`).join('') + '<th>All</th>', trendTbl)
      + `<h3>Form: the last ${lastNights.length} nights</h3><p><small>`
      + `${lastNights.length ? `${dstr(lastNights[0].startAt)} to ${dstr(lastNights.at(-1).startAt)}. ` : ''}`
      + 'Everyone with a top 4 in that run, next to their top-4 rate over every night they entered.</small></p>'
      + scrollTable('<th class="tx">Player</th><th>Nights</th><th>Top 4s</th><th>Wins</th><th>Career top-4 rate</th>', formTbl), '#54a24b'));
  }

  // favourites and upsets: who was expected to win each night
  const decided = favResults.filter((r) => r.outcome === 'favourite' || r.outcome === 'upset');
  const favWon = decided.filter((r) => r.outcome === 'favourite').length;
  const openNights = favResults.filter((r) => r.outcome === 'open').length;
  const firstTitles = favResults.filter((r) => r.firstTitle);
  const champCount = new Set(favResults.map((r) => r.winner.id)).size;
  const placeText = (p) => (p == null ? 'outside top 4' : ordinal(p));
  const favouriteCell = (r) => (r.favouriteRate == null
    ? '<td data-v="">—</td>'
    : `<td data-v="${r.favouriteRate.toFixed(4)}">${pct0(r.favouriteRate)} <small class="nw">${r.favourite}/${r.favourite + r.upset}</small></td>`);
  const spreadTbl = spread.map((r) => `<tr><td>${periodLabel(r.period)}</td><td>${r.nights}</td><td>${r.champions}</td><td>${r.firstTitles}</td>`
    + `<td>${esc(tagOf(r.top.id, r.top.tag))} (${r.top.wins})</td>${rateCell(r.topShare)}${favouriteCell(r)}</tr>`).join('\n');
  // biggest first: most titles the winner was behind the favourite, then the winner with fewer titles of their
  // own, then the favourite finishing further down, then newest. the rank and the gap show, so the order reads
  const finishedAt = (place) => place ?? 99;
  const upsets = favResults.filter((r) => r.outcome === 'upset').map((r) => ({ ...r, behind: r.favouriteTitles - r.winnerTitles }))
    .sort((a, b) => b.behind - a.behind || a.winnerTitles - b.winnerTitles || finishedAt(b.favouritePlace) - finishedAt(a.favouritePlace) || b.startAt - a.startAt)
    .slice(0, 10);
  const upsetTbl = upsets.map((r, i) => `<tr><td>${i + 1}</td><td>${dstr(r.startAt)}</td>`
    + `<td>${esc(tagOf(r.winner.id, r.winner.tag))} <small>(${r.winnerTitles})</small></td>`
    + `<td>${r.favourites.map((f) => esc(tagOf(f.id, f.tag))).join(' / ')} <small>(${r.favouriteTitles})</small></td>`
    + `<td>${r.behind}</td><td>${placeText(r.favouritePlace)}</td></tr>`).join('\n');
  const firstTbl = [...firstTitles].reverse().map((r) => `<tr><td>${dstr(r.startAt)}</td><td>${esc(tagOf(r.winner.id, r.winner.tag))}</td><td>${winById[r.winner.id] ?? 1}</td></tr>`).join('\n');
  if (favResults.length) {
    const newest = firstTitles.at(-1);
    const favouriteLine = decided.length ? `The favourite won <b>${favWon} of ${decided.length}</b> nights (${pct0(favWon / decided.length)}). ` : '';
    const newestLine = newest ? `, the newest first-time champion being <b>${esc(tagOf(newest.winner.id, newest.winner.tag))}</b> on ${dstr(newest.startAt)}` : '';
    const openLine = openNights ? `${count(openNights, 'night')} had nobody entered with a title in the past 12 months and ${openNights === 1 ? 'isn\'t' : 'aren\'t'} counted. ` : '';
    add('upsets', 'Upsets', card('upsets', 'Favourites, upsets and new champions',
      `<p class="stat">${favouriteLine}<b>${champCount}</b> different players have won${newestLine}.</p>`
      + '<p><small>The favourite is whoever entered with the most titles here in the 12 months before that night. '
      + `A tie makes each of them a favourite, so any of them winning counts. ${openLine}Numbers in brackets are titles in the 12 months before.</small></p>`
      + `<h3>Title spread by ${unit}</h3><p><small>Top share is the most titles one player took, over that ${unit}'s nights.</small></p>`
      + scrollTable('<th>Year</th><th class="lo">Nights</th><th>Champs</th><th>First-time champs</th><th class="wr">Most titles</th><th class="lo">Top share</th><th class="wr">Favourite won</th>', spreadTbl)
      + (upsetTbl ? '<h3>Biggest upsets</h3><p><small>Biggest first, by how many more titles the favourite had than the winner in the past 12 months. '
        + 'Ties go to the winner with fewer titles, then to the favourite who finished lower. On a phone the date and the favourite\'s finish drop out.</small></p>'
        + scrollTable('<th>#</th><th class="lo">Date</th><th class="tx">Winner</th><th class="tx">Favourite</th><th>Titles behind</th><th class="lo">Favourite finished</th>', upsetTbl) : '')
      + `<h3>First titles</h3><p><small>Every night that crowned a new champion, newest first, with the titles they've won here since.</small></p>${scrollTable('<th>Date</th><th class="tx">Champion</th><th>Titles</th>', firstTbl)}`, '#e45756'));
  }

  // rivalries: all sets by default, the character sample on the switch, off weeks as a layer on either
  if (rivalries.length) {
    // each view brings its own pair count, most played line, note and table, so the headline always matches
    // the table under it. the sample's games are its reported games, the all-sets games its set scores
    const pairName = (r) => `${esc(tagOf(r.a.id, r.a.tag))} vs ${esc(tagOf(r.b.id, r.b.tag))}`;
    const mostPlayedLine = (r, games) => {
      if (!r) return '';
      return `Most played: <b>${pairName(r)}</b>, ${r.sets} sets, ${r.aSets}–${r.bSets}${games ? ` in sets and ${r.aGames}–${r.bGames} in games` : ''}.`;
    };
    // the all-sets view only has games for sets the TO gave a score, so a pair with none shows a dash
    const gamesCell = (r) => (r.scoredSets === 0 ? '<td data-v="0">–</td>' : `<td data-v="${r.aGames - r.bGames}">${r.aGames}–${r.bGames}</td>`);
    const rows = (pairs) => pairs.filter((r) => r.sets >= 2).map((r, i) => `<tr><td>${i + 1}</td><td>${pairName(r)}</td><td>${r.sets}</td>`
      + `<td data-v="${r.aSets - r.bSets}">${r.aSets}–${r.bSets}${r.undecided ? ` <small>+${r.undecided} split</small>` : ''}</td>`
      + `${gamesCell(r)}<td>${r.last ? dstr(r.last) : ''}</td></tr>`).join('\n');
    const table = (pairs, id) => scrollTable('<th>#</th><th class="tx">Players</th><th>Sets</th><th>Sets won</th><th>Games won</th><th class="lo">Last met</th>', rows(pairs), false, `id="${id}"`);
    const num = (x) => x.toLocaleString('en-US');
    const allNote = (v, extra = '') => `All ${num(v.sets)} completed Ultimate Singles sets are counted${extra}. `
      + `Games won come from the ${num(v.scored)} with a score reported. DQs and doubles stay out.`;
    const sampleNote = (v, scope) => `Only the ${num(v.sampleSets)} sets where the TO reported characters, `
      + `a scattered ${(v.sampleSets / v.sets * 100).toFixed(1)}% of ${scope}, so these records are a small slice and not lifetime.`;
    const view = (pairs, id, note, games) => ({
      id, pairs, note, count: pairs.filter((r) => r.sets >= 2).length, top: mostPlayedLine(pairs[0], games ?? pairs[0]?.scoredSets > 0),
    });
    const views = {
      all: view(mainRivals.all, 'rivals-tbl', allNote(mainRivals)),
      sample: view(mainRivals.sample, 'rivals-sample-tbl', sampleNote(mainRivals, 'all sets'), true),
    };
    if (offRivals) {
      // only the off-week nights' real singles brackets, never their items, randoms, squad strike or redemption ones
      const extra = `, ${num(offRivals.sets - mainRivals.sets)} of them from ${offCharRows.length} off-week singles brackets`;
      views['all-off'] = view(offRivals.all, 'rivals-off-tbl', allNote(offRivals, extra));
      views['sample-off'] = view(offRivals.sample, 'rivals-off-sample-tbl', sampleNote(offRivals, 'all sets with off weeks'), true);
    }
    const client = Object.fromEntries(Object.entries(views).map(([key, v]) => [key, { table: v.id, count: v.count, top: v.top, note: v.note }]));
    const switches = '<div class="seg" role="group" aria-label="Which sets count" id="rivals-switch">'
      + '<button type="button" class="on" data-view="all" aria-pressed="true">All sets</button>'
      + '<button type="button" data-view="sample" aria-pressed="false">Character-reported only</button></div>'
      + (offRivals ? '<button type="button" class="seg-toggle" id="rivals-off" aria-pressed="false">Include off weeks</button>' : '');
    // the switch and the toggle pick one of the views and swap its headline, note and table in
    const script = `const V=${JSON.stringify(client).replace(/</g, '\\u003c')},w=document.getElementById('rivals-switch'),o=document.getElementById('rivals-off'),`
      + 'q=document.getElementById(\'rivals-q\'),n=document.getElementById(\'rivals-note\'),c=document.getElementById(\'rivals-count\'),t=document.getElementById(\'rivals-top\');'
      + 'let view=\'all\',off=false;'
      + 'const show=()=>{const k=view+(off?\'-off\':\'\');'
      + 'for(const key in V)document.getElementById(\'rivals-view-\'+key).style.display=key===k?\'\':\'none\';'
      + 'c.textContent=V[k].count;t.innerHTML=V[k].top;n.textContent=V[k].note;'
      + 'q.dataset.table=V[k].table;q.value=\'\';q.dispatchEvent(new Event(\'input\'));};'
      + 'w.addEventListener(\'click\',(e)=>{const b=e.target.closest(\'button\');if(!b)return;view=b.dataset.view;'
      + 'for(const x of w.querySelectorAll(\'button\')){const on=x===b;x.classList.toggle(\'on\',on);x.setAttribute(\'aria-pressed\',String(on));}show();});'
      + 'if(o)o.addEventListener(\'click\',()=>{off=!off;o.classList.toggle(\'on\',off);o.setAttribute(\'aria-pressed\',String(off));show();});';
    add('rivals', 'Rivalries', card('rivals', `Rivalries (<span id="rivals-count">${views.all.count}</span> player pairs with 2+ sets)`,
      `<p class="stat" id="rivals-top">${views.all.top}</p>`
      // all sets on by default. the character sample is a scattered slice, not a lifetime record. off weeks layer on top of either
      + `<div class="switches">${switches}</div>`
      + `<p><small><span id="rivals-note">${views.all.note}</span> Search a tag to see all of one player's rivalries. `
      + 'Pairs with a single set are in <code>data/head-to-head.json</code>.</small></p>'
      + filterInput('rivals-q', 'rivals-tbl', 'Search a player…')
      + Object.entries(views).map(([key, v]) => `<div id="rivals-view-${key}"${key === 'all' ? '' : ' style="display:none"'}>${table(v.pairs, v.id)}</div>`).join('')
      + `<script>{${script}}</script>`, '#f28e2b'));
  }
  // up to three aliases, and an ellipsis when there are more
  const aliasText = (p) => esc((p.names ?? [p.tag]).slice(0, 3).join(' / ')) + ((p.names ?? []).length > 3 ? '…' : '');
  const enteredTbl = enteredList.map((p, i) => `<tr data-events="${p.events}"><td>${i + 1}</td><td>${esc(p.tag)}</td><td>${p.events}</td>`
    + `<td>${esc(loyaltyTier(p.events)?.label ?? '')}</td><td>${p.ultWins}</td><td>${aliasText(p)}</td></tr>`).join('\n');
  const enteredFrom = offweekRows.length ? 'Ultimate and Melee events + off-week brackets' : 'Ultimate and Melee events';
  add('attended', 'Attendance', card('attended', `Most nights attended (${enteredFrom}, ${attendanceRows.length} nights with entrant lists)`,
    '<p><small>Click a bar to see its player (X) and nights attended (Y), and every tournament they came to. Playing Ultimate and Melee the same night counts once.</small></p>'
    + '<p><label><input type="checkbox" id="fewtoggle"> hide players with 1–2 nights</label></p>'
    + `<div class="scroll" id="attp-all">${attPChart}</div><div class="scroll" id="attp-regular" style="display:none">${attPChartRegular}</div>`
    + filterInput('attended-q', 'attended-tbl', 'Search players…')
    + scrollTable('<th>#</th><th class="tx">Player</th><th>Nights</th><th>Tier</th><th>Ult wins</th><th class="lo">Aliases</th>', enteredTbl, false, 'id="attended-tbl"')));
  if (enteredList.length) {
    const tierRange = (t) => t.max == null ? t.min + '+' : t.min === t.max ? String(t.min) : t.min + '–' + t.max;
    const tierTbl = tiers.map((t) => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${t.color}"></span> ${esc(t.label)}</td><td>${tierRange(t)}</td><td>${t.players}</td><td>${pct1(t.pctPlayers)}</td><td>${t.entries}</td><td>${pct1(t.pctEntries)}</td></tr>`).join('\n');
    const stageName = { 1: '1st event', 2: '2nd event', 3: '3rd event', 5: '5th event', 10: '10th event', 20: '20th event' };
    const funnelTbl = rates.stages.map((s) => `<tr><td>${stageName[s.stage] ?? s.stage + 'th event'}</td><td>${s.players}</td><td>${pct1(s.pctOfFirst)}</td><td>${s.conversion == null ? '—' : pct1(s.conversion)}</td></tr>`).join('\n');
    // each count next to its share of that year's entries
    const shareOf = (r, count) => `<td>${count}</td><td>${pct1(r.entrants ? count / r.entrants : 0)}</td>`;
    const flowYearTbl = flow.perYear.map((r) => `<tr><td>${r.year}</td><td>${r.entrants}</td>${shareOf(r, r.first)}${shareOf(r, r.second)}${shareOf(r, r.returning)}</tr>`).join('\n');
    const secondRate = rates.stages.find((s) => s.stage === 2)?.conversion ?? 0;
    const thirdRate = rates.stages.find((s) => s.stage === 3)?.conversion ?? 0;
    add('loyalty', 'Loyalty', card('loyalty', `Loyalty, growth and return rates (${rates.distinct} distinct players, ${rates.totalEntries.toLocaleString('en-US')} entries)`,
      `<p>First-time rate: <b>${pct1(rates.firstTimeRate)}</b> of all entries are a player's first event here. `
      + `Second-time rate: <b>${pct1(secondRate)}</b> of first-timers came back for a 2nd event. `
      + `Third-time rate: <b>${pct1(thirdRate)}</b> of those came back for a 3rd.</p>`
      + '<h3>Cumulative unique players</h3><p><small>Click a dot to see its date (X) and distinct players ever (Y). Only goes up: each edition adds its first-timers.</small></p>'
      + `<div class="scroll">${lineCharts(growthChart, growthChartNarrow)}</div>`
      + `<h3>Newcomers per year</h3><p><small>First-time players per year. Click a bar to see its year (X) and newcomers (Y).</small></p><div class="scroll">${newcomersChart}</div>`
      + '<h3>Attendance histogram, by loyalty tier</h3><p><small>Players by nights attended, coloured by tier. Click a bar to see everyone in that bracket.</small></p>'
      + `<div class="scroll">${histChart}</div>`
      + scrollTable('<th class="tx">Tier</th><th>Events</th><th>Players</th><th>% of players</th><th class="lo">Entries</th><th>% of entries</th>', tierTbl)
      + '<h3>Return rates</h3><p><small>Conversion is the share of the previous row that reached this one: the 2nd-event row\'s conversion is the second-time rate, '
      + 'the 3rd-event row\'s is the third-time rate, and so on.</small></p>'
      + scrollTable('<th>Reached</th><th>Players</th><th>% of first-timers</th><th>Conversion</th>', funnelTbl)
      + '<h3>First-time and second-time entries by year</h3><p><small>On a phone the counts drop out and the rates stay.</small></p>'
      + scrollTable('<th>Year</th><th>Entries</th><th class="lo">First-time</th><th>First-time rate</th><th class="lo">Second-time</th><th>Second-time rate</th><th class="lo">3rd+</th><th>3rd+ rate</th>', flowYearTbl), '#9467bd'));

    // retention and churn: who stayed from one year to the next
    const nowPeriod = periodOf(Math.floor(Date.now() / 1000));
    const retentionCell = (r) => (r.retention == null ? '<td data-v="">—</td>' : `<td data-v="${r.retention.toFixed(4)}">${pct0(r.retention)}</td>`);
    const retTbl = retention.map((r) => `<tr><td>${periodLabel(r.period)}${r.period === nowPeriod ? ' <small>so far</small>' : ''}</td>`
      + `<td>${r.active}</td><td>${r.new}</td><td>${r.retained}</td><td>${r.back}</td><td>${r.lapsed}</td>${retentionCell(r)}</tr>`).join('\n');
    // the last year that's over, unless every year with a rate is the running one
    const withRate = [...retention].reverse().filter((r) => r.retention != null);
    const lastFull = withRate.find((r) => r.period !== nowPeriod) ?? withRate[0];
    const keptLine = lastFull ? `<p class="stat">Of the ${lastFull.prevActive} players in ${periodLabel(retention[retention.indexOf(lastFull) - 1].period)}, `
      + `<b>${lastFull.retained} (${pct0(lastFull.retention)})</b> played again in ${periodLabel(lastFull.period)}.</p>` : '';
    const runningLine = retention.some((r) => r.period === nowPeriod) ? ` The ${unit} marked so far is still running, so its lapsed count will shrink.` : '';
    add('churn', 'Retention', card('churn', `Retention and churn by ${unit}`,
      keptLine
      + `<p><small>Active is everyone who entered that ${unit}. New entered for the first time ever. Kept also played the ${unit} before. `
      + `Back played in an earlier ${unit} but skipped the one before. Lapsed played the ${unit} before and not this one. `
      + `Retention is kept over the ${unit} before's active players. On a phone the Back column drops out.${runningLine}</small></p>`
      + scrollTable('<th class="wr">Year</th><th>Active</th><th>New</th><th>Kept</th><th class="lo">Back</th><th>Lapsed</th><th>Retention</th>', retTbl), '#72b7b2'));
  }
  if (bothSeries.length) {
    const crossEventHeads = seriesData.map((s) => `<th>${esc(seriesLabel(s.slug))} events</th>`).join('');
    const crossWinHeads = seriesData.map((s) => `<th class="lo">${esc(seriesLabel(s.slug))} wins</th>`).join('');
    const perSeriesCells = (r, key) => seriesData.map((s) => `<td>${r.per[s.slug]?.[key] ?? 0}</td>`).join('');
    const crossTbl = bothSeries.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.tag)}</td><td>${r.totalEvents}</td>${perSeriesCells(r, 'events')}`
      + `<td>${r.totalWins}</td>${perSeriesCells(r, 'wins')}<td>${r.totalPodiums}</td></tr>`).join('\n');
    const dualOnly = bothSeries.filter((r) => r.totalWins > 0).length;
    const seriesNames = seriesData.map((s) => esc(registry[s.slug]?.name ?? s.slug)).join(' and ');
    add('cross', 'Both series', card('cross', `Buffalo overall: plays both series (${bothSeries.length} players)`,
      `<p><small>Matched by start.gg player id across ${seriesNames}. Combined Ultimate Singles attendance and wins. All ${bothSeries.length}, by total events. `
      + `Also in <code>data/cross-series.json</code>. ${dualOnly} of them have won in either series.</small></p>`
      + filterInput('cross-q', 'cross-tbl', 'Search players…')
      + scrollTable('<th>#</th><th class="tx">Player</th><th>Total events</th>' + crossEventHeads + '<th>Total wins</th>' + crossWinHeads + '<th class="lo">Total top 4s</th>', crossTbl, false, 'id="cross-tbl"'),
      '#e45756'));
  }
  if (charList.length) {
    // the 95% range is a wilson interval: narrow on hundreds of games, wide on a handful
    const crows = charList.map((c, i) => {
      const r = wilson(c.wins, c.games);
      return `<tr${c.games < MIN_CHAR_GAMES ? ' class="few"' : ''}><td>${i + 1}</td><td>${esc(c.name)}</td><td>${c.games}</td><td>${users[c.name] ?? 0}</td><td>${c.wins}</td><td>${(Math.round(c.winrate * 1000) / 10).toFixed(1)}%</td><td data-v="${r.low.toFixed(4)}"><span class="nw">${pct0(r.low)}–${pct0(r.high)}</span></td></tr>`;
    }).join('\n');
    add('characters', 'Characters', card('characters', `Characters (Ultimate, ${totalGames.toLocaleString('en-US')} games with both characters reported)`,
      `<p><small>That's ${gamesReportedPct.toFixed(1)}% of all games played, from ${totalSets.toLocaleString('en-US')} sets checked; ${setsReportedPct.toFixed(1)}% of sets have character data reported. Click a bar to see its character (X) and value (Y).</small></p><h3>Most games played</h3><div class="scroll">${charGamesChart}</div>`
      + `${charWinItems.length ? `<h3>Winrate (${MIN_CHAR_GAMES}+ games)</h3><p><small>Games in brackets after the winrate. Characters with fewer games are in the table only, greyed out.</small></p><div class="scroll">${charWinChart}</div>` : ''}`
      + `<p><small>Players is how many different players picked the character, so a character with one or two players mostly shows how those players do. The 95% range is where the winrate would likely land with many more games: wide on a small sample, narrow on a big one.</small></p>`
      + scrollTable('<th class="lo">#</th><th class="wr">Character</th><th>Games</th><th>Players</th><th class="lo">Game wins</th><th>Winrate</th><th>95% range</th>', crows)));
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
};
// one character's matchups as a short list, the phone-sized way to read a row
const mpick = document.getElementById('mu-pick');
const mlist = document.getElementById('mu-list');
const showPick = () => {
  const row = FULLCELLS[mpick.value] || {};
  const opp = Object.keys(row).map((b) => ({ b: b, g: row[b][0], w: row[b][1] })).sort((x, y) => y.g - x.g || x.b.localeCompare(y.b));
  // data-full: a rebuilt list has no show-all button, so none of them collapse
  let h = '<table class="wr-1" data-full="1"><tr><th>Opponent</th><th>Games</th><th>Won–lost</th><th>Winrate</th></tr>';
  for (const o of opp) {
    const wr = o.w / o.g;
    const alpha = o.g < 3 ? 0.06 : Math.min(0.45, Math.abs(wr - 0.5) * 1.6 + 0.05);
    h += '<tr><td>' + mesc(o.b) + '</td><td>' + o.g + '</td><td data-v="' + (2 * o.w - o.g) + '">' + o.w + '–' + (o.g - o.w) + '</td><td style="background:rgba(' + (wr >= 0.5 ? '44,160,42' : '228,87,86') + ',' + alpha.toFixed(2) + ')">' + Math.round(wr * 100) + '%</td></tr>';
  }
  mlist.innerHTML = opp.length ? h + '</table>' : '<p><small>No reported games against another character.</small></p>';
  if (typeof makeSortable === 'function' && mlist.querySelector('table')) makeSortable(mlist.querySelector('table'));
};
mpick.onchange = showPick;
showPick();</script>`;
    const swatch = (v) => `<span style="display:inline-block;padding:0 6px;border:1px solid var(--line);${shade({ games: 99, winrate: v })}">${Math.round(v * 100)}%</span>`;
    const matrixKey = `<p><small>Shading key, row character's winrate: ${[0.1, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9].map(swatch).join(' ')}<br>`
      + 'Red favours the column character, green the row; darker is further from 50%. Almost-white cells are under 3 games, so barely shaded whatever the winrate. '
      + '<b>—</b> mirror match, <b>·</b> no reported games. The number in brackets is games played. '
      + 'Click a cell to highlight its row and column so you can follow them across; click it again to clear.</small></p>';
    const matrixNote = '<p><small>The whole dataset: every character that appears in a counted game, most played first, and every pair that met, however few games they have. '
      + `Cell is the row character's winrate against the column character, games in brackets, from ${totalGames.toLocaleString('en-US')} games with both characters reported. `
      + 'Scroll sideways; the row character stays pinned. On a phone the one-character list reads easier. Small samples read with care: a cell can rest on a single game. '
      + 'Random Character is not in here: it\'s a random pick from the roster, not a character. '
      + 'Only games with both characters reported count; a game with just one side reported, or neither, is left out entirely. '
      + 'The same pairs are in <code>data/matchups.json</code>.</small></p>';
    const picker = `<select id="mu-pick" class="picker">${matchups.chars.map((c) => `<option>${esc(c)}</option>`).join('')}</select>`;
    add('matchups', 'Matchups', card('matchups', `Matchup matrix (${matchups.chars.length} characters, every matchup in the data)`,
      matrixNote
      + `<h3>One character's matchups</h3><p><label>Character: ${picker}</label></p><div class="scroll" id="mu-list"></div>`
      + `<h3>Full matrix</h3>${matrixKey}`
      + `<p><button id="matrix-toggle" type="button">Generate the full Smash Ultimate roster matrix (${fullChars.length} characters)</button></p>`
      + `<div class="matrix" id="matrix-series">${scrollTable(matrixHeads, matrixRows, true)}</div>`
      + '<div class="matrix" id="matrix-full" style="display:none"><div class="scroll" id="matrix-full-scroll"></div></div>'
      + matrixScript
      + (lopTbl ? `<h3>Most lopsided (10+ games)</h3>${scrollTable('<th class="wr">Matchup</th><th>Games</th><th>Favoured winrate</th>', lopTbl)}` : ''), '#4c78a8'));
  }
  if (has('melee')) {
    const meleeTbl = meleeTop.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.tag)}</td><td>${w.wins}</td><td>${w.podiums}</td></tr>`).join('\n');
    const meleeEvents = [...meleeStandings].sort((a, b) => a.startAt - b.startAt).map((s) => {
      const w = s.standings.find((x) => x.placement === 1);
      return `<tr><td>${dstr(s.startAt)}</td><td><a href="https://www.start.gg/${esc(s.slug)}">${esc(trunc(s.tournamentName, 55))}</a></td><td>${s.numEntrants}</td><td>${w ? esc(w.players[0]?.tag ?? w.name) : '<i>unknown</i>'}</td></tr>`;
    }).join('\n');
    add('melee', 'Melee', card('melee', `Melee (${meleeStandings.length} events with reported top 4)`,
      `<p><small>${esc(cfg.meleeNote ?? '')}</small></p>`
      + scrollTable('<th>#</th><th class="tx">Player</th><th>1st</th><th>Top 4s</th>', meleeTbl)
      + `<h3>All ${meleeStandings.length} Melee brackets</h3>`
      + scrollTable('<th>Date</th><th class="tx">Tournament</th><th>Entrants</th><th class="tx">Winner</th>', meleeEvents, false, 'class="wrap2"'), '#2ca02a'));
  }
  if (has('redemption')) {
    const redTbl = redWinners.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.tag)}</td><td>${w.wins}</td><td>${w.podiums}</td><td>${w.ultWins}</td></tr>`).join('\n');
    add('redemption', 'Redemption', card('redemption', `Redemption brackets (${redStandings.length} events with reported top 4)`,
      `<p><small>Click a bar to see its player (X) and redemption wins (Y), and every tournament in that run.</small></p><div class="scroll">${redChart}</div>${scrollTable('<th>#</th><th class="tx">Player</th><th>Redemption wins</th><th>Top 4s</th><th>Ult wins</th>', redTbl)}`, '#8c564b'));
  }
  if (has('sides')) {
    const sideCards = sideGroups.map((g) => {
      const rows = winnersFromStandings(g.rows).map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.tag)}</td><td>${p.wins}</td><td>${p.podiums}</td></tr>`).join('\n');
      return `<h3>${pill(g.cls, g.label)} ${g.rows.length} events</h3>${scrollTable('<th>#</th><th class="tx">Player</th><th>Wins</th><th>Top 4s</th>', rows)}`;
    }).join('\n');
    const sideOtherRows = sideOther.map((s) => {
      const w = s.standings.find((x) => x.placement === 1);
      return `<tr><td>${dstr(s.startAt)}</td><td>${esc(s.eventName)}</td><td>${s.numEntrants}</td><td>${w ? esc(w.players[0]?.tag ?? w.name) : '<i>unknown</i>'}</td></tr>`;
    }).join('\n');
    add('sides', 'Sides', card('sides', 'Side brackets',
      `<p><small>${esc(cfg.sidesNote ?? '')}</small></p>${sideCards}${sideOtherRows ? `<h3>Other side events</h3>${scrollTable('<th>Date</th><th class="tx">Event</th><th>Entrants</th><th class="tx">Winner</th>', sideOtherRows, false, 'class="wrap2"')}` : ''}`));
  }
  // on a phone the all-tournaments table keeps the Ultimate winner only:
  // melee ran three nights, and redemption has its own card
  const allHeads = { ultimate: `<th class="tx"><span class="pill u">Ult</span> winner</th>`, redemption: `<th class="lo"><span class="pill r">Redemption</span> winner</th>`, melee: `<th class="lo"><span class="pill m">Melee</span> winner</th>` };
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
    `<p><small>${esc(cfg.allNote)}</small></p>${filterInput('all-q', 'all-tbl', 'Search tournaments…')}${scrollTable('<th>Date</th><th class="tx">Tournament</th><th>Att.</th><th class="lo">Ult entrants</th>' + cfg.allWinners.map((k) => allHeads[k]).join(''), trows, true, 'class="wrap2" id="all-tbl"')}`));

  const nav = cards.map((c) => `<a href="#${c.id}">${esc(c.label)}</a>`).join('\n');
  // the pasted photo as the tab icon, inlined so the one-file page keeps it anywhere
  const faviconPath = path.join(ROOT, 'series', 'shared', 'favicon.png');
  const favicon = existsSync(faviconPath) ? `<link rel="icon" type="image/png" href="data:image/png;base64,${readFileSync(faviconPath).toString('base64')}">` : '';
  // top toggle between the two views of a series with off weeks. winners and
  // matchups are numbered-only in both, so they read the same either way
  const weekLinks = countOffweeks
    ? '<span class="pill s">counted</span> <a href="on-weeks-only.html">on weeks only</a>'
    : '<a href="index.html">counted</a> <span class="pill s">on weeks only</span>';
  // the hash carries over, so switching views keeps your place on the page
  const weekToggle = allOffweekTournaments.length ? `<p class="weektoggle">Off-week club nights: ${weekLinks}<br>`
    + '<small>Updates the whole page: attendance, seasonality, crowds, loyalty, both-series and the tournament list. '
    + 'Winners and matchups are on weeks only in both views; redemption counts an off week only where it ran a bracket.</small></p>'
    + '<script>document.querySelectorAll(\'.weektoggle a\').forEach((a) => a.addEventListener(\'click\', () => { a.href += location.hash; }));</script>' : '';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.title)} · Data Analysis (${n} tournaments)</title>${favicon}
<style>${CSS}${CSS_EXTRA}</style>
</head><body>
<h1>${esc(cfg.title)} · Data Analysis</h1>
${switcher}
${weekToggle}
<div id="toolbar"><button id="navtoggle" aria-label="toggle menu">☰ menu</button> <button id="darkbtn">🌙 dark</button></div>
<nav class="side">${nav}</nav>
${cards.map((c) => c.html).join('\n')}
${pageFooter(builtDay, rangeText)}
</body>
<script>${CLIENT_JS_SORT}</script>
<script>${CLIENT_JS_UI}</script>
${MODAL_HTML}
${clientModal(winInfo)}
</html>`;
  writeRetrying(path.join(OUT, htmlFile), html);
  writeOut(`${OUT}/README.md`, cfg.readme({ n, numbered: numberedTournaments.length, offweeks: offweekTournaments.length, top: { ...top }, ultEvents: ultStandings.length, meleeEvents: meleeStandings.length, redemptionEvents: redStandings.length, totalSets, totalGames, charCount: charList.length, enteredCount: enteredList.length }));

  const checks = validateSeries({ standings: allStandings, attendanceRows: bracketRows, tournaments, entrantsOf, mainEventRe: MAIN_RE });
  if (checks.length) { console.log(`DATA CHECKS (${checks.length}):`); for (const c of checks.slice(0, 30)) console.log(' -', c); }
  else console.log('data checks clean');
  console.log('viewer built:', OUT);
  console.log('tournaments', n, '| ultimate events', ultStandings.length, '| melee events', meleeStandings.length, '| sets', totalSets, '| games w/ chars', totalGames, '| chars', charList.length);
  console.log('top winner:', winners[0].tag, winners[0].wins, '| top char:', charList[0]?.name, charList[0]?.games);
}
