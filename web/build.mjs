// bundles the series pages' data into the one file the web hub reads. it only reads what the series
// builds wrote, so the hub needs no token and works as a plain static page
// usage: node web/build.mjs (series/build-all.mjs runs it too)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { charCounts, crossSeries, headToHeadSets } from '../series/shared/compute.mjs';

// every ultimate singles bracket is this in the builder (series/shared/site.mjs)
const MAIN_RE = /ultimate singles|^smash ultimate$/i;

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REG = JSON.parse(readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'));

const readJson = (f, fb) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fb; } };

// union of every player id across every series, with per-series events + wins.
// winners.json has aliases, attendance.json has events entered; longest tag wins
export function unifyPlayers(seriesData) {
  const byId = {};
  for (const s of seriesData) {
    const wins = Object.fromEntries((s.winners ?? []).map((w) => [w.id, w]));
    for (const p of s.entered ?? []) {
      if (String(p.id).startsWith('name:')) continue;
      byId[p.id] ??= { id: p.id, tag: p.tag, per: {}, totalEvents: 0, totalWins: 0, totalPodiums: 0 };
      const row = byId[p.id];
      const w = wins[p.id];
      const tag = [p.tag, w?.tag].filter(Boolean).sort((a, b) => b.length - a.length)[0];
      if (tag && tag.length > row.tag.length) row.tag = tag;
      row.per[s.slug] = { events: p.events, wins: w?.wins ?? 0, podiums: w?.podiums ?? 0 };
      row.totalEvents += p.events;
      row.totalWins += w?.wins ?? 0;
      row.totalPodiums += w?.podiums ?? 0;
    }
    // winners who never appear in an entrant list still join the index
    for (const w of s.winners ?? []) {
      if (String(w.id).startsWith('name:') || byId[w.id]) continue;
      byId[w.id] = {
        id: w.id, tag: w.tag, per: { [s.slug]: { events: 0, wins: w.wins, podiums: w.podiums } },
        totalEvents: 0, totalWins: w.wins, totalPodiums: w.podiums,
      };
    }
  }
  return Object.values(byId).sort((a, b) => b.totalEvents - a.totalEvents || b.totalWins - a.totalWins || a.tag.localeCompare(b.tag));
}

export function buildHub() {
  const out = path.join(ROOT, 'web', 'data');
  mkdirSync(out, { recursive: true });
  const series = [];
  const seriesData = [];
  const tids = {}; // player id -> set of tournament ids they entered
  const meta = {}; // player id -> podiums, dates, aliases, signature character
  const charGames = []; // every reported game with player ids, for top characters
  const setRows = []; // every finished ultimate singles set, all series, for head-to-head records
  const finals = []; // ultimate finals { t, w, r }, all series, oldest first
  const tmap = {}; // tournament id -> compact { d, n, u }
  const dateOf = {};
  const track = (pid, tid) => {
    if (String(pid).startsWith('name:')) return;
    (tids[pid] ??= new Set()).add(tid);
  };
  for (const [slug, reg] of Object.entries(REG)) {
    const dir = path.join(ROOT, reg.outDir, 'data');
    const tournaments = readJson(path.join(dir, 'tournaments.json'), []);
    const winners = readJson(path.join(dir, 'winners.json'), []);
    const attendance = readJson(path.join(dir, 'attendance.json'), []);
    const retention = readJson(path.join(dir, 'retention.json'), {});
    for (const t of tournaments) {
      tmap[t.id] = { d: t.date, n: t.name, u: t.url };
      dateOf[t.id] = t.startAt ?? 0;
    }
    // per-tournament entrant lists live in the research scrape, not the viewer
    // data. one entry per player per night, the same way the viewer counts it
    const rdir = path.join(ROOT, reg.researchDir);
    const entrantRows = [...readJson(path.join(rdir, 'attendance-ultimate.json'), []), ...readJson(path.join(rdir, 'attendance-offweek.json'), [])];
    for (const row of entrantRows) {
      const seen = new Set();
      for (const e of row.entrants) for (const p of e.players ?? []) {
        const pid = p.id != null ? String(p.id) : 'name:' + (e.name ?? p.tag);
        if (seen.has(pid)) continue;
        seen.add(pid);
        track(pid, row.tournamentId);
      }
    }
    // ultimate finals: winner and runner-up ids for the H2H card. series with
    // side brackets ship a winners-only file, so fall back to the full one
    const standingsFile = existsSync(path.join(dir, 'standings-ultimate.json')) ? 'standings-ultimate.json' : 'standings.json';
    for (const s of readJson(path.join(dir, standingsFile), [])) {
      if (!MAIN_RE.test(s.eventName ?? '')) continue;
      const at = (place) => {
        const row = s.standings.find((x) => x.placement === place);
        const id = row?.players[0]?.id;
        return id != null ? String(id) : null;
      };
      finals.push({ t: s.tournamentId, w: at(1), r: at(2) });
    }
    // character games carry both sides' player ids, so top characters are free
    try {
      const jl = readFileSync(path.join(rdir, 'chars-by-event.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      for (const r of jl) for (const g of r.games ?? []) charGames.push(g);
      // the same scrape has every set's winner and score, character reported or not
      for (const r of jl) if (r.game === 'Ultimate') for (const s of r.sets ?? []) setRows.push({ ...s, startAt: r.startAt });
    } catch {}
    for (const w of winners) {
      meta[String(w.id)] = {
        seconds: w.seconds ?? 0, thirds: w.thirds ?? 0, fourths: w.fourths ?? 0,
        first: w.first ?? null, last: w.last ?? null, aliases: (w.aliases ?? [w.tag]).slice(0, 5),
        sig: w.mostUsedCharacter?.name ?? null,
      };
    }
    seriesData.push({
      slug,
      entered: attendance.map((p) => ({ id: String(p.id), tag: p.tag, events: p.eventsEntered, names: [p.tag] })),
      winners: winners.map((w) => ({ id: String(w.id), tag: w.tag, wins: w.wins, podiums: w.podiums, names: w.aliases ?? [w.tag] })),
    });
    series.push({
      slug, name: reg.name, short: reg.short ?? reg.name, url: reg.url ?? null,
      tournaments: tournaments.length,
      distinctPlayers: retention.distinctPlayers ?? null,
      topWinners: winners.slice(0, 10).map((w) => ({ tag: w.tag, wins: w.wins, podiums: w.podiums })),
      recent: [...tournaments].slice(-8).reverse().map((t) => ({
        date: t.date, name: t.name, url: t.url, attendees: t.attendees,
        winner: t.winner?.tag ?? t.ultimateWinner?.tag ?? null,
      })),
    });
  }
  // each player's top three, where the series pages only show one
  const charUse = charCounts(charGames);
  const topCharsOf = (pid) => Object.entries(charUse[pid] ?? {})
    .map(([name, games]) => ({ n: name, g: games }))
    .sort((a, b) => b.g - a.g || a.n.localeCompare(b.n)).slice(0, 3);
  const players = unifyPlayers(seriesData).map((p) => {
    const m = meta[p.id] ?? {};
    const myTids = [...(tids[p.id] ?? [])].sort((a, b) => (dateOf[a] ?? 0) - (dateOf[b] ?? 0));
    return {
      id: p.id, tag: p.tag, aliases: m.aliases ?? [p.tag], per: p.per,
      totalEvents: p.totalEvents, totalWins: p.totalWins, totalPodiums: p.totalPodiums,
      seconds: m.seconds ?? 0, thirds: m.thirds ?? 0, fourths: m.fourths ?? 0,
      first: m.first ?? null, last: m.last ?? null, sig: m.sig ?? null,
      topChars: topCharsOf(p.id), tids: myTids,
    };
  });
  finals.sort((a, b) => (dateOf[a.t] ?? 0) - (dateOf[b.t] ?? 0));
  const both = seriesData.length > 1 ? crossSeries(seriesData) : [];
  // keyed by both ids, lower first, as [lower's sets, higher's sets, lower's games, higher's games,
  // sets with a score, last met]. compact, since every pair that ever played is in it
  const h2h = {};
  for (const r of headToHeadSets(setRows)) {
    const flip = r.b.id < r.a.id;
    const [lo, hi] = flip ? [r.b, r.a] : [r.a, r.b];
    const [loSets, hiSets, loGames, hiGames] = flip ? [r.bSets, r.aSets, r.bGames, r.aGames] : [r.aSets, r.bSets, r.aGames, r.bGames];
    h2h[`${lo.id}|${hi.id}`] = [loSets, hiSets, loGames, hiGames, r.scoredSets, r.last ? new Date(r.last * 1000).toISOString().slice(0, 10) : null];
  }
  const bundle = {
    built: new Date().toISOString().slice(0, 10),
    series,
    players,
    bothSeries: both.slice(0, 50).map((r) => ({ tag: r.tag, totalEvents: r.totalEvents, totalWins: r.totalWins })),
    events: finals,
    tmap,
    h2h,
  };
  writeFileSync(path.join(out, 'buffalo.json'), JSON.stringify(bundle));
  console.log('hub bundle built:', path.join('web', 'data', 'buffalo.json'));
  console.log('series', series.map((s) => `${s.slug}:${s.tournaments}`).join(' '), '| players', players.length, '| finals', finals.length, '| games', charGames.length);
  return bundle;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildHub();
