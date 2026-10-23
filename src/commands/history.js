import * as startgg from '../startgg.js';

const HISTORY_PAGES = 15; // 40 sets a page
// 3000 sets, about a minute the first time for someone who's played that many
const LIFETIME_PAGES = 75;
// 1200 sets, years for most people. /scout verbose also has every event, so this keeps it near a minute
const SCOUT_PAGES = 30;
// also 40 a page, so 400 sets, 800 for /scout verbose, or 1600 for /characters verbose. the other games are usually further back
const CHARACTER_PAGES = 10;
const SCOUT_CHARACTER_PAGES = 20;
const LIFETIME_CHARACTER_PAGES = 40;
// /doubles, 30 sets a page. one page is the short report, melee reads back up to 10 to fill it, and
// verbose goes to 600 sets
const DOUBLES_PAGES = 1;
const MELEE_DOUBLES_PAGES = 10;
const FULL_DOUBLES_PAGES = 20;
const HISTORY_CACHE_MINUTES = 10;
// after that only their newest page gets fetched, and everything again this often to pick up edits to old sets
const HISTORY_REFRESH_HOURS = 6;
// pages of each kind of history kept, whoever was looked up longest ago goes first. a lifetime one is
// ~5MB for someone with 2500 sets, so this is about 25 players' usual history and 5 lifetimes
const HISTORY_CACHE_PAGES = 25 * HISTORY_PAGES + 5 * LIFETIME_PAGES;
const CHARACTER_CACHE_PAGES = 25 * CHARACTER_PAGES + 5 * LIFETIME_CHARACTER_PAGES;
// most people have far less doubles than singles, so this is room for about 10 full reports
const DOUBLES_CACHE_PAGES = 10 * FULL_DOUBLES_PAGES;

// a player's history of one kind, newest first, shared by every command that reads it. each asks for so many
// pages: a deeper copy already here gets cut down to that, and a shallower one gets the rest added on, so
// /scout verbose after /scout doesn't fetch the first pages twice. the promise is what's kept, so two lookups
// at once share a fetch. keep is how many pages to hold, whoever was looked up longest ago goes first
function historyCache(getPage, keep) {
  const players = new Map();

  // resolves to { sets, ends, totalPages }, ends being how many sets the first 1, 2, 3... pages came to
  function lookup(playerId, pages) {
    const now = Date.now();
    const cached = players.get(playerId);
    const fresh = !cached || now - cached.fullAt > HISTORY_REFRESH_HOURS * 60 * 60 * 1000;
    const stale = !fresh && now - cached.at > HISTORY_CACHE_MINUTES * 60 * 1000;
    let base = fresh ? fetchPages(getPage, playerId, pages) : cached.known;
    // if start.gg errors it keeps what it had
    if (stale) base = base.then((history) => topUp(getPage, playerId, history).catch(() => history));
    const known = base.then((history) => (history.ends.length < Math.min(pages, history.totalPages) ? extend(getPage, playerId, history, pages) : history));

    const entry = {
      at: fresh || stale ? now : cached.at,
      fullAt: fresh ? now : cached.fullAt,
      pages: Math.max(pages, fresh ? 0 : cached.pages),
      known,
    };
    // more pages failing keeps the copy it was adding to, as long as that one came back fine
    known.catch(() => base.then(() => !fresh, () => false).then((keepCached) => {
      if (players.get(playerId) !== entry) return;
      if (keepCached) players.set(playerId, cached);
      else players.delete(playerId);
    }));
    // map order is least recently looked up first
    players.delete(playerId);
    players.set(playerId, entry);
    let total = [...players.values()].reduce((sum, each) => sum + each.pages, 0);
    for (const [id, each] of players) {
      if (total <= keep || id === playerId) break;
      players.delete(id);
      total -= each.pages;
    }
    return known;
  }

  return (playerId, pages) => lookup(playerId, pages).then(({ sets, ends }) => sets.slice(0, ends[Math.min(pages, ends.length) - 1] ?? 0));
}

// the first page says how many there are, then the rest get asked for all at once.
// the rate limit spaces them out, so nothing sits waiting on a slow page
async function fetchPages(getPage, playerId, pages) {
  const first = await getPage(playerId, 1);
  return extend(getPage, playerId, { sets: first.sets, ends: [first.sets.length], totalPages: first.totalPages }, pages);
}

// the pages after the ones it has. sets played since push everything down a little, so the first of these
// can repeat a few it has already, which get skipped
async function extend(getPage, playerId, history, pages) {
  const next = [];
  for (let page = history.ends.length + 1; page <= Math.min(pages, history.totalPages); page++) next.push(getPage(playerId, page));
  const sets = [...history.sets];
  const ids = new Set(sets.map((set) => set.id));
  const ends = [...history.ends];
  let { totalPages } = history;
  for (const page of await Promise.all(next)) {
    for (const set of page.sets) {
      if (ids.has(set.id)) continue;
      ids.add(set.id);
      sets.push(set);
    }
    ends.push(sets.length);
    totalPages = Math.max(totalPages, page.totalPages);
  }
  return { sets, ends, totalPages };
}

// their newest page on top of what's cached. none of it being cached means more than a page is new,
// so everything it had gets fetched again
async function topUp(getPage, playerId, history) {
  const first = await getPage(playerId, 1);
  const ids = new Set(history.sets.map((set) => set.id));
  const added = first.sets.filter((set) => !ids.has(set.id));
  if (added.length && added.length === first.sets.length) return fetchPages(getPage, playerId, history.ends.length);
  return { sets: [...added, ...history.sets], ends: history.ends.map((end) => end + added.length), totalPages: first.totalPages };
}

const setHistories = historyCache(startgg.getSetHistory, HISTORY_CACHE_PAGES);
const characterHistories = historyCache(startgg.getCharacterSets, CHARACTER_CACHE_PAGES);
const setHistory = (playerId) => setHistories(playerId, HISTORY_PAGES);
const characterHistory = (playerId) => characterHistories(playerId, CHARACTER_PAGES);
const lifetimeHistory = (playerId) => setHistories(playerId, LIFETIME_PAGES);
const lifetimeCharacterHistory = (playerId) => characterHistories(playerId, LIFETIME_CHARACTER_PAGES);

// a lookup's promise kept under its key for a while, so repeat and concurrent lookups share one fetch.
// a failed one isn't kept, and past size whoever was looked up longest ago goes first
function keptPromises(minutes, size) {
  const kept = new Map();
  return (key, fetch) => {
    const hit = kept.get(key);
    // map order is least recently looked up first
    kept.delete(key);
    if (hit && Date.now() - hit.at < minutes * 60 * 1000) {
      kept.set(key, hit);
      return hit.promise;
    }
    const entry = { at: Date.now(), promise: fetch() };
    kept.set(key, entry);
    entry.promise.catch(() => {
      if (kept.get(key) === entry) kept.delete(key);
    });
    for (const old of [...kept.keys()].slice(0, -size)) kept.delete(old);
    return entry.promise;
  };
}

// event histories are a few pages at most, so they're kept whole for as long as set histories go without a refresh
const EVENT_CACHE_PLAYERS = 50;
const eventLookups = keptPromises(HISTORY_CACHE_MINUTES, EVENT_CACHE_PLAYERS);
const eventHistory = (userId) => eventLookups(userId, () => startgg.getEventHistory(userId));

// every meeting between two players, newest first. the short and full /h2h and /predict reports
// all read the same meetings, so one lookup covers the command and its Full report button
const H2H_CACHE_MINUTES = 10;
const H2H_CACHE_PAIRS = 200;
const meetingLookups = keptPromises(H2H_CACHE_MINUTES, H2H_CACHE_PAIRS);
function h2hHistory(playerId, opponentId) {
  // numbers in, so the strict id checks in getHeadToHead can't miss on a string. NaN fails fast at start.gg
  const [a, b] = [Number(playerId), Number(opponentId)];
  // either order is the same meetings
  const key = [a, b].sort((x, y) => x - y).join(':');
  return meetingLookups(key, () => startgg.getHeadToHead(a, b));
}

// the short /stats window. it moves when they play, so it's kept for less time than the meetings,
// and a different since or venue is a different lookup
const STATS_CACHE_MINUTES = 3;
const STATS_CACHE_ENTRIES = 200;
const statsLookups = keptPromises(STATS_CACHE_MINUTES, STATS_CACHE_ENTRIES);
function statsHistory(playerId, { videogameId, since, venue } = {}) {
  const key = [String(playerId), videogameId ?? '', since ?? '', venue ?? ''].join(':');
  return statsLookups(key, () => startgg.getStats(playerId, { videogameId, since, venue }));
}

const doublesHistories = historyCache(startgg.getDoublesHistory, DOUBLES_CACHE_PAGES);
const doublesHistory = (playerId, { verbose = false, melee = false } = {}) => {
  if (verbose) return doublesHistories(playerId, FULL_DOUBLES_PAGES);
  return doublesHistories(playerId, melee ? MELEE_DOUBLES_PAGES : DOUBLES_PAGES);
};

// doubles placements by event, kept per player as long as event histories. each event is looked up once,
// as a promise so two reports at once share it, and the full report only asks about events the short one didn't
const doublesEventHistories = new Map();
async function doublesEvents(player, eventIds) {
  let cached = doublesEventHistories.get(player.userId);
  if (!cached || Date.now() - cached.at > HISTORY_CACHE_MINUTES * 60 * 1000) cached = { at: Date.now(), events: new Map() };
  doublesEventHistories.delete(player.userId);
  doublesEventHistories.set(player.userId, cached);
  for (const id of [...doublesEventHistories.keys()].slice(0, -EVENT_CACHE_PLAYERS)) doublesEventHistories.delete(id);

  const missing = eventIds.filter((id) => !cached.events.has(id));
  if (missing.length) {
    const lookup = startgg.getDoublesEvents(player, missing);
    const each = new Map(missing.map((id) => [id, lookup.then((found) => found.get(id) ?? null)]));
    for (const [id, event] of each) cached.events.set(id, event);
    // a failed lookup isn't kept
    lookup.catch(() => {
      for (const [id, event] of each) {
        if (cached.events.get(id) === event) cached.events.delete(id);
      }
    });
  }
  const events = (await Promise.all(eventIds.map((id) => cached.events.get(id)))).filter(Boolean);
  return events.sort((a, b) => b.event.startAt - a.event.startAt);
}

export {
  SCOUT_PAGES, SCOUT_CHARACTER_PAGES, setHistories, characterHistories, setHistory, characterHistory, lifetimeHistory, lifetimeCharacterHistory, eventHistory,
  doublesHistory, doublesEvents, h2hHistory, statsHistory,
};
