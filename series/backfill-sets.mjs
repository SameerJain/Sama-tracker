// fills in what the series scrapes are missing: set results for events scraped before those were saved,
// nights saved empty because the scan found them early, each off-week night's singles bracket, and every
// night's melee entrants, since melee players count toward attendance.
// usage: node --env-file=.env series/backfill-sets.mjs [slug]
// it skips what's done, so it's fine to rerun. requests go 1.5s apart, slower than the refresh, since
// the deployed bot shares the token's 80 a minute
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCharGames, getEntrants, getEvents, getSetResults, OFFWEEK_SINGLES_RE } from './shared/scrape.mjs';
import { setRequestGap } from '../src/startgg/queue.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'));
const SAVE_EVERY = 5;
const DAY = 86400;
setRequestGap(1500);

// scored means a set list saved since scores were, so an event from the first pass without them goes again.
// one with no sets goes again until it's been looked at after the night, since the refresh can find a
// tournament the day before it runs
const done = (row) => Array.isArray(row.sets) && row.sets.every((set) => 'wScore' in set)
  && (row.sets.length > 0 || (row.setsCheckedAt ?? 0) > row.startAt + DAY);

const readJsonl = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const day = (row) => new Date(row.startAt * 1000).toISOString().slice(0, 10);

// windows refuses to rename over a file another process has open, like a build reading it, so that waits a bit
async function writeFile(file, text) {
  fs.writeFileSync(`${file}.tmp`, text);
  for (let tries = 1; ; tries++) {
    try {
      fs.renameSync(`${file}.tmp`, file);
      return;
    } catch (err) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code) || tries >= 20) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const save = (file, rows) => writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
// the same layout the refresh writes its json in
const saveJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2));

async function backfill(slug) {
  const file = path.join(ROOT, REG[slug].researchDir, 'chars-by-event.jsonl');
  const rows = readJsonl(file);
  const todo = rows.filter((row) => !done(row));
  console.log(`[${slug}] ${todo.length} of ${rows.length} events need set results`);
  let fetched = 0;
  for (const row of todo) {
    row.sets = await getSetResults(row.eventId);
    row.setsCheckedAt = Math.floor(Date.now() / 1000);
    fetched++;
    // the set count from the first scrape should match, short of sets reset since
    const gap = row.totalSets != null && row.sets.length !== row.totalSets ? ` (first scrape had ${row.totalSets})` : '';
    console.log(`[${slug}] ${fetched}/${todo.length} ${day(row)} ${row.eventName}: ${row.sets.length} sets${gap}`);
    if (fetched % SAVE_EVERY === 0) await save(file, rows);
  }
  await save(file, rows);
}

// each off-week night's singles bracket, the same row shape as chars-by-event.jsonl, in a file of its own
async function backfillOffweeks(slug) {
  const dir = path.join(ROOT, REG[slug].researchDir);
  const nights = readJson(path.join(dir, 'offweek-tournaments.json'), []);
  if (!nights.length) return;
  const file = path.join(dir, 'offweek-chars-by-event.jsonl');
  const rows = readJsonl(file);
  const have = new Map(rows.map((row) => [row.eventId, row]));
  const byId = new Map(nights.map((t) => [t.id, t]));
  const todo = [];
  for (const night of readJson(path.join(dir, 'attendance-offweek.json'), [])) {
    const t = byId.get(night.tournamentId);
    if (!t) continue;
    night.eventIds.forEach((eventId, i) => {
      const eventName = night.events[i];
      if (!OFFWEEK_SINGLES_RE.test(eventName ?? '')) return;
      const row = have.get(eventId);
      if (!row || !done(row)) todo.push({ t, eventId, eventName });
    });
  }
  console.log(`[${slug}] ${todo.length} off-week singles brackets need sets`);
  let fetched = 0;
  for (const { t, eventId, eventName } of todo) {
    const { totalSets, sets, games, gamesTotal, setsWithChars, gamesPlayed } = await getCharGames(eventId, 10);
    const row = {
      eventId, tournamentId: t.id, tournamentName: t.name, startAt: t.startAt, game: 'Ultimate', eventName, totalSets,
      gamesReported: games.length, gamesTotal, setsWithChars, gamesPlayed, sets, games, setsCheckedAt: Math.floor(Date.now() / 1000),
    };
    const at = rows.findIndex((each) => each.eventId === eventId);
    if (at >= 0) rows[at] = row; else rows.push(row);
    fetched++;
    console.log(`[${slug}] off week ${fetched}/${todo.length} ${day(row)} ${t.name} · ${eventName}: ${sets.length} sets, ${games.length} games with characters`);
    if (fetched % SAVE_EVERY === 0) await save(file, rows.sort((a, b) => a.startAt - b.startAt || a.eventId - b.eventId));
  }
  if (fetched) await save(file, rows.sort((a, b) => a.startAt - b.startAt || a.eventId - b.eventId));
}

// melee entrants for attendance. main nights have their events saved, so it's every melee event without a list
// yet. off weeks don't, so each gets asked about once, then marked with meleeCheckedAt. both skip what's done
async function backfillMelee(slug) {
  const dir = path.join(ROOT, REG[slug].researchDir);
  const file = path.join(dir, 'attendance-melee.json');
  const rows = readJson(file, []);
  const have = new Set(rows.map((row) => row.eventId));
  const isMelee = (e) => e.videogame?.id === 1 && (e.numEntrants ?? 0) > 0 && !have.has(e.id);
  const add = async (t, e) => {
    rows.push({ eventId: e.id, tournamentId: t.id, entrants: await getEntrants(e.id) });
    have.add(e.id);
    console.log(`[${slug}] melee ${day(t)} ${t.name} · ${e.name}: ${rows.at(-1).entrants.length} entrants`);
  };

  const mains = readJson(path.join(dir, 'tournaments-events.json'), []).flatMap((t) => (t.events ?? []).filter(isMelee).map((e) => ({ t, e })));
  const offFile = path.join(dir, 'attendance-offweek.json');
  const offRows = readJson(offFile, []);
  const offNights = new Map(readJson(path.join(dir, 'offweek-tournaments.json'), []).map((t) => [t.id, t]));
  const unchecked = offRows.filter((row) => !row.meleeCheckedAt && offNights.has(row.tournamentId));
  console.log(`[${slug}] ${mains.length} melee events on main nights need entrants, ${unchecked.length} off weeks to check for melee`);

  for (const [i, { t, e }] of mains.entries()) {
    await add(t, e);
    if ((i + 1) % SAVE_EVERY === 0) await saveJson(file, rows);
  }
  for (const [i, row] of unchecked.entries()) {
    const t = offNights.get(row.tournamentId);
    for (const e of (await getEvents(t.id)).filter(isMelee)) await add(t, e);
    row.meleeCheckedAt = Math.floor(Date.now() / 1000);
    if ((i + 1) % SAVE_EVERY === 0) {
      await saveJson(file, rows);
      await saveJson(offFile, offRows);
    }
  }
  if (mains.length || unchecked.length) {
    await saveJson(file, rows);
    await saveJson(offFile, offRows);
  }
}

const only = process.argv[2];
for (const slug of Object.keys(REG)) {
  if (only && slug !== only) continue;
  await backfill(slug);
  await backfillOffweeks(slug);
  await backfillMelee(slug);
}
console.log('backfill done');
