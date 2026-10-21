// Series refresher skeleton: update + recheck each tournament series on its own schedule.
// Usage: node series/refresh.mjs [slug] [--now] [--dry-run] [--no-deploy] [--deploy-only]
//   no slug       -> every series whose schedule is due
//   --now         -> run regardless of schedule (optionally one slug)
//   --dry-run     -> print the plan, change nothing, fetch nothing
//   --no-deploy   -> refresh and rebuild, but skip the Vercel deploy
//   --deploy-only -> deploy the current build as-is (no scrape, no rebuild)
// Schedules live in series/series.json per series: { day: 0-6 Sun-Sat, hour: 0-23, tz }.
// Tuesday midnight = day 2 hour 0, Saturday midnight = day 6 hour 0 (America/New_York).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { searchTournaments, getEvents, getTop4, getEntrants, getCharGames } from './shared/scrape.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'));
const STATE_FILE = path.join(ROOT, 'series', 'refresh-state.json');
const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

function tzParts(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { dow, hour: Number(p.hour) % 24, ymd: `${p.year}-${p.month}-${p.day}` };
}
// upload the built viewer folder to its Vercel project
function deploy(slug, cfg, { dryRun = false, noDeploy = false } = {}) {
  if (dryRun) { console.log(`[${slug}] deploy: skipped (dry run) — would run npx vercel --prod in ${cfg.outDir}`); return; }
  if (noDeploy) { console.log(`[${slug}] deploy: skipped (--no-deploy)`); return; }
  console.log(`[${slug}] deploy: npx vercel --prod in ${cfg.outDir}`);
  const res = spawnSync('npx', ['-y', 'vercel', '--prod', '--yes'], { cwd: path.join(ROOT, cfg.outDir), stdio: 'inherit', shell: true });
  if (res.status !== 0) throw new Error(`deploy failed for ${slug}`);
}

function dueNow(cfg, lastRunMs, now = new Date()) {
  if (!lastRunMs) return { due: true, why: 'never ran' };
  const p = tzParts(now, cfg.schedule.tz);
  const lastYmd = tzParts(new Date(lastRunMs), cfg.schedule.tz).ymd;
  if (now.getTime() - lastRunMs >= 6.5 * 864e5) return { due: true, why: 'last run 6.5+ days ago' };
  if (p.dow === cfg.schedule.day && p.hour >= cfg.schedule.hour && lastYmd !== p.ymd) return { due: true, why: 'scheduled weekday+hour reached' };
  return { due: false, why: `last run ${lastYmd}, next ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][cfg.schedule.day]} ${cfg.schedule.hour}:00 ${cfg.schedule.tz}` };
}

async function runSeries(slug, cfg, { dryRun, noDeploy, lastRunMs = null }) {
  const dir = path.join(ROOT, cfg.researchDir);
  const tourEvents = readJSON(path.join(dir, 'tournaments-events.json'), []);
  // some series have no tournaments.json; derive the list from tournaments-events
  const tournaments = readJSON(path.join(dir, 'tournaments.json'), tourEvents.map(({ events, ...t }) => t));
  const standings = readJSON(path.join(dir, 'standings.json'), []);
  const attendance = readJSON(path.join(dir, 'attendance-ultimate.json'), []);
  const offweekTournaments = readJSON(path.join(dir, 'offweek-tournaments.json'), []);
  const offweekAttendance = readJSON(path.join(dir, 'attendance-offweek.json'), []);
  const haveT = new Set(tourEvents.map((t) => t.id));
  const haveOff = new Set(offweekTournaments.map((t) => t.id));
  const haveS = new Set(standings.map((s) => s.eventId));
  const nowSec = Math.floor(Date.now() / 1000);
  const nameRe = new RegExp(cfg.discover.nameRe, 'i');
  const offWeekRe = cfg.offWeekNameRe ? new RegExp(cfg.offWeekNameRe, 'i') : null;
  const standingsRow = (t, e, top) => ({ tournamentId: t.id, tournamentName: t.name, slug: t.slug, startAt: t.startAt, numAttendees: t.numAttendees, eventId: e.id, eventName: e.name, numEntrants: e.numEntrants, game: e.videogame?.displayName ?? '', eventSlug: e.slug, standings: top.map((n) => ({ placement: n.placement, name: n.name, players: n.players })) });

  // 1. discover: recent NY tournaments at the series venues matching the name.
  // scan back to the last run (minus a day) so a long outage loses nothing.
  const after = lastRunMs ? Math.min(nowSec - 21 * 86400, Math.floor(lastRunMs / 1000) - 86400) : nowSec - 21 * 86400;
  console.log(`[${slug}] discover: NY scan since ${new Date(after * 1000).toISOString().slice(0, 10)}`);
  let found = [];
  if (!dryRun) {
    const all = await searchTournaments({ after, before: nowSec + 86400 });
    found = all.filter((t) => (cfg.discover.venues.some((v) => (t.venueAddress || '').includes(v))) && (nameRe.test(t.name) || offWeekRe?.test(t.name)) && !haveT.has(t.id) && !haveOff.has(t.id));
  }
  const mainFound = found.filter((t) => nameRe.test(t.name));
  console.log(`[${slug}] new tournaments: ${found.length}${dryRun ? ' (dry run, skipped scan)' : ''}`);
  for (const t of found) console.log('  +', new Date(t.startAt * 1000).toISOString().slice(0, 10), t.id, t.name);

  // 2. detail new tournaments
  const newTourEvents = [], newStandings = [], newAttendance = [], newChars = [], newOffweekTournaments = [], newOffweekAttendance = [];
  for (const t of found) {
    if (dryRun) continue;
    const events = await getEvents(t.id);
    if (!nameRe.test(t.name)) {
      // off-week club night: attendance only, never its brackets' standings or
      // character games. a redemption bracket that reported standings is the
      // one exception, so its winner can join the redemption ranking
      const counted = events.filter((e) => e.videogame?.id === 1386 && (e.numEntrants ?? 0) > 0);
      if (!counted.length) continue; // melee-only club nights stay out
      const entrants = [], eventIds = [], eventNames = [];
      for (const e of counted) {
        entrants.push(...await getEntrants(e.id));
        eventIds.push(e.id);
        eventNames.push(e.name);
        if (/redemption/i.test(e.name)) {
          const top = await getTop4(e.id);
          if (top.length) newStandings.push(standingsRow(t, e, top));
        }
      }
      newOffweekTournaments.push({ ...t });
      newOffweekAttendance.push({ tournamentId: t.id, eventIds, events: eventNames, entrants });
      continue;
    }
    newTourEvents.push({ ...t, events });
    for (const e of events) {
      const game = e.videogame?.displayName ?? '';
      if (cfg.skipGames.includes(game)) continue;
      if ((e.numEntrants ?? 0) >= (cfg.standingsMinEntrants ?? 0)) {
        const top = await getTop4(e.id);
        newStandings.push(standingsRow(t, e, top));
      }
    }
    for (const e of events) {
      if (!new RegExp(cfg.mainEventRe, 'i').test(e.name)) continue;
      if (cfg.entrantsEventsRes.some((re) => new RegExp(re, 'i').test(e.name))) {
        const entrants = await getEntrants(e.id);
        newAttendance.push({ eventId: e.id, tournamentId: t.id, entrants });
      }
    }
    for (const e of events) {
      if (!cfg.charEventsRes.some((re) => new RegExp(re, 'i').test(e.name))) continue;
      const { totalSets, games, gamesTotal, setsWithChars, gamesPlayed } = await getCharGames(e.id);
      newChars.push({ eventId: e.id, tournamentId: t.id, tournamentName: t.name, startAt: t.startAt, game: e.videogame?.id === 1 ? 'Melee' : 'Ultimate', eventName: e.name, numEntrants: e.numEntrants, totalSets, gamesReported: games.length, gamesTotal, setsWithChars, gamesPlayed, games });
    }
  }

  // 3. recheck: refresh standings for recent tournaments (TO corrections)
  const cutoff = nowSec - (cfg.recheckDays ?? 45) * 86400;
  const recent = tourEvents.filter((t) => t.startAt >= cutoff);
  console.log(`[${slug}] recheck: ${recent.length} tournaments in last ${cfg.recheckDays ?? 45}d`);
  let refreshed = 0;
  let offweekDirty = false;
  if (!dryRun) {
    for (const t of recent) {
      for (const e of t.events ?? []) {
        if (cfg.skipGames.includes(e.videogame?.displayName ?? '')) continue;
        if ((e.numEntrants ?? 0) < (cfg.standingsMinEntrants ?? 0)) continue;
        const top = await getTop4(e.id);
        const row = standingsRow(t, e, top);
        const ix = standings.findIndex((s) => s.eventId === e.id);
        if (ix >= 0) standings[ix] = row; else standings.push(row);
        refreshed++;
      }
    }
    // recent off weeks get the same TO-correction pass, attendance + redemption only
    for (const t of offweekTournaments.filter((x) => x.startAt >= cutoff)) {
      const counted = (await getEvents(t.id)).filter((e) => e.videogame?.id === 1386 && (e.numEntrants ?? 0) > 0);
      if (!counted.length) continue;
      const entrants = [], eventIds = [], eventNames = [];
      for (const e of counted) {
        entrants.push(...await getEntrants(e.id));
        eventIds.push(e.id);
        eventNames.push(e.name);
        if (/redemption/i.test(e.name)) {
          const top = await getTop4(e.id);
          if (top.length) {
            const row = standingsRow(t, e, top);
            const ix = standings.findIndex((s) => s.eventId === e.id);
            if (ix >= 0) standings[ix] = row; else standings.push(row);
          }
        }
      }
      const row = { tournamentId: t.id, eventIds, events: eventNames, entrants };
      const ix = offweekAttendance.findIndex((r) => r.tournamentId === t.id);
      if (ix >= 0) offweekAttendance[ix] = row; else offweekAttendance.push(row);
      offweekDirty = true;
      refreshed++;
    }
  }

  if (dryRun) { console.log(`[${slug}] dry run: no writes`); deploy(slug, cfg, { dryRun, noDeploy }); return { newTournaments: found.length, refreshed: 0 }; }

  // 4. merge + save (dedupe by id/eventId; freshly scraped rows win)
  const byId = (rows, key) => [...new Map(rows.map((r) => [r[key], r])).values()];
  const mergedT = byId([...tournaments, ...mainFound], 'id').sort((a, b) => a.startAt - b.startAt);
  const mergedTE = byId([...tourEvents, ...newTourEvents], 'id').sort((a, b) => a.startAt - b.startAt);
  const mergedS = byId([...standings, ...newStandings], 'eventId').sort((a, b) => a.startAt - b.startAt);
  writeJSON(path.join(dir, 'tournaments.json'), mergedT);
  writeJSON(path.join(dir, 'tournaments-events.json'), mergedTE);
  writeJSON(path.join(dir, 'standings.json'), mergedS);
  if (newAttendance.length) {
    const mergedA = byId([...attendance, ...newAttendance], 'eventId');
    writeJSON(path.join(dir, 'attendance-ultimate.json'), mergedA);
  }
  if (newOffweekTournaments.length || offweekDirty) {
    writeJSON(path.join(dir, 'offweek-tournaments.json'), byId([...offweekTournaments, ...newOffweekTournaments], 'id').sort((a, b) => a.startAt - b.startAt));
    writeJSON(path.join(dir, 'attendance-offweek.json'), byId([...offweekAttendance, ...newOffweekAttendance], 'tournamentId'));
  }
  if (newChars.length) {
    const jl = path.join(dir, 'chars-by-event.jsonl');
    const prev = fs.existsSync(jl) ? fs.readFileSync(jl, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    const prog = readJSON(path.join(dir, 'chars-progress.json'), {});
    for (const r of newChars) prog[String(r.eventId)] = true;
    const all = [...prev.filter((r) => !newChars.some((n) => n.eventId === r.eventId)), ...newChars].sort((a, b) => a.startAt - b.startAt || a.eventId - b.eventId);
    fs.writeFileSync(jl, all.map((o) => JSON.stringify(o)).join('\n') + '\n');
    writeJSON(path.join(dir, 'chars-progress.json'), prog);
  }

  // 5. rebuild viewer (its build runs the data checks)
  console.log(`[${slug}] rebuild: node ${cfg.build}`);
  const res = spawnSync(process.execPath, [path.join(ROOT, cfg.build)], { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`build failed for ${slug}`);
  deploy(slug, cfg, { noDeploy });
  return { newTournaments: found.length, refreshed };
}

const args = process.argv.slice(2);
const slugArg = args.find((a) => !a.startsWith('--'));
if (slugArg && !REG[slugArg]) { console.error(`unknown series "${slugArg}" (known: ${Object.keys(REG).join(', ')})`); process.exit(1); }
const only = slugArg;
const force = args.includes('--now');
const dryRun = args.includes('--dry-run');
const noDeploy = args.includes('--no-deploy');
const deployOnly = args.includes('--deploy-only');
const state = readJSON(STATE_FILE, {});
const slugs = only ? [only] : Object.keys(REG);
let ran = false;
for (const slug of slugs) {
  const cfg = REG[slug];
  if (deployOnly) { deploy(slug, cfg, { dryRun, noDeploy }); ran = true; continue; }
  const lastRun = state[slug]?.lastRun ?? null;
  const { due, why } = force ? { due: true, why: '--now' } : dueNow(cfg, lastRun);
  console.log(`[${slug}] schedule: day ${cfg.schedule.day} ${cfg.schedule.hour}:00 ${cfg.schedule.tz} — ${due ? 'DUE' : 'skip'} (${why})`);
  if (!due) continue;
  ran = true;
  const stats = await runSeries(slug, cfg, { dryRun, noDeploy, lastRunMs: lastRun });
  if (!dryRun) {
    state[slug] = { lastRun: Date.now(), ...stats };
    writeJSON(STATE_FILE, state);
  }
}
if (!ran) console.log('nothing due. use --now to force, --dry-run to preview.');
