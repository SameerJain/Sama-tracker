// fills in what the series scrapes are missing: set results for events scraped before those were saved,
// nights saved empty because the scan found them early, and each off-week night's singles bracket.
// usage: node --env-file=.env series/backfill-sets.mjs [slug]
// it skips what's done, so it's fine to rerun. requests go 1.5s apart, slower than the refresh, since
// the deployed bot shares the token's 80 a minute
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCharGames, getSetResults, OFFWEEK_SINGLES_RE } from './shared/scrape.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'series', 'series.json'), 'utf8'));
const SAVE_EVERY = 5;
const DAY = 86400;
const GAP_MS = 1500;

// scored means a set list saved since scores were, so an event from the first pass without them goes again.
// one with no sets goes again until it's been looked at after the night, since the refresh can find a
// tournament the day before it runs
const done = (row) => Array.isArray(row.sets) && row.sets.every((set) => 'wScore' in set)
  && (row.sets.length > 0 || (row.setsCheckedAt ?? 0) > row.startAt + DAY);

const readJsonl = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const day = (row) => new Date(row.startAt * 1000).toISOString().slice(0, 10);

// windows refuses to rename over a file another process has open, like a build reading it, so that waits a bit
async function save(file, rows) {
  fs.writeFileSync(`${file}.tmp`, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
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

async function backfill(slug) {
  const file = path.join(ROOT, REG[slug].researchDir, 'chars-by-event.jsonl');
  const rows = readJsonl(file);
  const todo = rows.filter((row) => !done(row));
  console.log(`[${slug}] ${todo.length} of ${rows.length} events need set results`);
  let fetched = 0;
  for (const row of todo) {
    row.sets = await getSetResults(row.eventId, { gapMs: GAP_MS });
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
    const { totalSets, sets, games, gamesTotal, setsWithChars, gamesPlayed } = await getCharGames(eventId, 10, { gapMs: GAP_MS });
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

const only = process.argv[2];
for (const slug of Object.keys(REG)) {
  if (only && slug !== only) continue;
  await backfill(slug);
  await backfillOffweeks(slug);
}
console.log('backfill done');
