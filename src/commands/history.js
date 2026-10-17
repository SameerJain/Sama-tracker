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
const HISTORY_CACHE_MINUTES = 10;
// after that only their newest page gets fetched, and everything again this often to pick up edits to old sets
const HISTORY_REFRESH_HOURS = 6;
// pages of each kind of history kept, whoever was looked up longest ago goes first. a lifetime one is
// ~5MB for someone with 2500 sets, so this is about 25 players' usual history and 5 lifetimes
const HISTORY_CACHE_PAGES = 25 * HISTORY_PAGES + 5 * LIFETIME_PAGES;
const CHARACTER_CACHE_PAGES = 25 * CHARACTER_PAGES + 5 * LIFETIME_CHARACTER_PAGES;

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

    const entry = { at: fresh || stale ? now : cached.at, fullAt: fresh ? now : cached.fullAt, pages: Math.max(pages, fresh ? 0 : cached.pages), known };
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

  const history = (playerId, pages) => lookup(playerId, pages).then(({ sets, ends }) => sets.slice(0, ends[Math.min(pages, ends.length) - 1] ?? 0));
  // from their first page, which every lookup starts with anyway
  history.totalPages = (playerId) => lookup(playerId, 1).then(({ totalPages }) => totalPages);
  return history;
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

// event histories are a few pages at most, so they're kept whole for as long as set histories go
// without a refresh. a failed lookup isn't kept
const EVENT_CACHE_PLAYERS = 50;
const eventHistories = new Map();
function eventHistory(userId) {
  const cached = eventHistories.get(userId);
  if (cached && Date.now() - cached.at < HISTORY_CACHE_MINUTES * 60 * 1000) return cached.events;
  const events = startgg.getEventHistory(userId);
  eventHistories.delete(userId);
  eventHistories.set(userId, { at: Date.now(), events });
  events.catch(() => eventHistories.delete(userId));
  // map order is oldest first
  for (const id of [...eventHistories.keys()].slice(0, -EVENT_CACHE_PLAYERS)) eventHistories.delete(id);
  return events;
}

export { HISTORY_PAGES, LIFETIME_PAGES, SCOUT_PAGES, SCOUT_CHARACTER_PAGES, setHistories, characterHistories, setHistory, characterHistory, lifetimeHistory, lifetimeCharacterHistory, eventHistory };
