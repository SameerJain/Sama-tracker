// Shared start.gg scrape primitives for series research + refresh.
// Rate-limited (one request ~900ms), retries 429/5xx, splits on complexity errors.
const API_URL = 'https://api.start.gg/gql/alpha';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextSlot = 0;
export async function throttle(gapMs = 900) {
  const wait = nextSlot - Date.now();
  if (wait > 0) await sleep(wait);
  nextSlot = Date.now() + gapMs;
}
export async function gql(query, variables, { retries = 2, gapMs = 900 } = {}) {
  const TOKEN = process.env.STARTGG_TOKEN;
  if (!TOKEN) throw new Error('missing STARTGG_TOKEN');
  await throttle(gapMs);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (retries > 0) { nextSlot = Date.now(); return gql(query, variables, { retries: retries - 1, gapMs }); }
    throw err;
  }
  if (res.status === 429 && retries > 0) { nextSlot = Date.now() + 15_000; return gql(query, variables, { retries: retries - 1, gapMs }); }
  if (res.status >= 500 && retries > 0) return gql(query, variables, { retries: retries - 1, gapMs });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    const msg = body.errors?.[0]?.message ?? `HTTP ${res.status}`;
    if (/complexity/i.test(msg)) { const e = new Error('complexity:' + msg); e.complexity = true; throw e; }
    throw new Error(`start.gg: ${msg}`);
  }
  return body.data;
}

const TOURN_Q = `query ($page: Int!, $perPage: Int!, $filter: TournamentPageFilter) {
  tournaments(query: { page: $page, perPage: $perPage, filter: $filter, sortBy: "startAt" }) {
    pageInfo { total totalPages }
    nodes { id name slug city addrState venueName venueAddress numAttendees startAt endAt isOnline }
  }
}`;

// all tournaments in a state within [after, before], page by page
export async function searchTournaments({ state = 'NY', after, before, perPage = 100, onPage } = {}) {
  const all = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages) {
    const data = await gql(TOURN_Q, { page, perPage, filter: { addrState: state, afterDate: after, beforeDate: before } });
    totalPages = data.tournaments.pageInfo.totalPages;
    all.push(...data.tournaments.nodes);
    if (onPage) onPage(page, totalPages, data.tournaments.pageInfo.total);
    page++;
  }
  const byId = new Map(all.map((t) => [t.id, t]));
  return [...byId.values()].sort((a, b) => a.startAt - b.startAt);
}

const EVENTS_Q = `query ($id: ID!) { tournament(id: $id) { events { id name slug numEntrants videogame { id displayName } } } }`;
export async function getEvents(tournamentId) {
  const data = await gql(EVENTS_Q, { id: tournamentId });
  return data?.tournament?.events ?? [];
}

const STANDINGS_Q = `query ($id: ID!) { event(id: $id) {
  standings(query: { perPage: 4, page: 1 }) { nodes { placement entrant { name participants { player { id gamerTag } } } } } } }`;
export async function getTop4(eventId) {
  const data = await gql(STANDINGS_Q, { id: eventId });
  return (data?.event?.standings?.nodes ?? []).map((n) => ({
    placement: n.placement,
    name: n.entrant?.name,
    players: (n.entrant?.participants ?? []).map((p) => ({ id: p?.player?.id, tag: p?.player?.gamerTag })),
  }));
}

const ENTRANTS_Q = `query ($id: ID!, $page: Int!, $perPage: Int!) { event(id: $id) {
  entrants(query: { page: $page, perPage: $perPage }) {
    pageInfo { totalPages }
    nodes { id name participants { player { id gamerTag } } } } } }`;
export async function getEntrants(eventId, perPage = 50) {
  const out = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages) {
    const data = await gql(ENTRANTS_Q, { id: eventId, page, perPage });
    totalPages = data?.event?.entrants?.pageInfo?.totalPages ?? 1;
    for (const n of data?.event?.entrants?.nodes ?? []) {
      out.push({ name: n.name, players: (n.participants ?? []).map((p) => ({ id: p?.player?.id ?? null, tag: p?.player?.gamerTag ?? null })) });
    }
    page++;
  }
  return out;
}

const SETS_Q = `query ($id: ID!, $page: Int!, $perPage: Int!) { event(id: $id) {
  sets(page: $page, perPage: $perPage, sortType: RECENT, filters: { state: [3], showByes: false }) {
    pageInfo { totalPages }
    nodes {
      id
      slots { entrant { id participants { player { id gamerTag } } } standing { stats { score { value } } } }
      games { winnerId selections { entrant { id } character { name } } } } } } }`;
async function getSetsPage(eventId, page, perPage) {
  try {
    return await gql(SETS_Q, { id: eventId, page, perPage });
  } catch (err) {
    if (err.complexity && perPage > 1) {
      // split the failed page into smaller pages covering the same sets
      const half = Math.max(1, Math.floor(perPage / 2));
      const count = Math.ceil(perPage / half);
      const firstSub = Math.floor(((page - 1) * perPage) / half) + 1;
      const nodes = [];
      let subTotalPages = 0;
      for (let k = 0; k < count; k++) {
        const sub = await getSetsPage(eventId, firstSub + k, half);
        nodes.push(...(sub?.event?.sets?.nodes ?? []));
        subTotalPages = sub?.event?.sets?.pageInfo?.totalPages ?? subTotalPages;
      }
      return { event: { sets: { nodes, pageInfo: { totalPages: Math.ceil((subTotalPages * half) / perPage) } } } };
    }
    throw err;
  }
}
// every finished set in an event with per-game characters + both sides' players
export async function getCharGames(eventId, perPage = 10) {
  const first = await getSetsPage(eventId, 1, perPage).catch((err) => {
    if (err.complexity) return getSetsPage(eventId, 1, 2);
    throw err;
  });
  const nodes = [...(first?.event?.sets?.nodes ?? [])];
  const totalPages = first?.event?.sets?.pageInfo?.totalPages ?? 1;
  for (let page = 2; page <= totalPages; page++) nodes.push(...((await getSetsPage(eventId, page, perPage))?.event?.sets?.nodes ?? []));
  const emap = new Map();
  for (const n of nodes) for (const s of n.slots ?? []) {
    const id = s?.entrant?.id;
    if (id && !emap.has(String(id))) emap.set(String(id), (s.entrant.participants ?? []).map((p) => ({ id: p?.player?.id, tag: p?.player?.gamerTag })));
  }
  const games = [];
  let gamesTotal = 0;
  for (const n of nodes) for (const g of n.games ?? []) {
    gamesTotal++;
    const sel = g?.selections ?? [];
    const w = sel.find((s) => String(s?.entrant?.id) === String(g?.winnerId));
    const l = sel.find((s) => String(s?.entrant?.id) !== String(g?.winnerId));
    if (!w?.character?.name || !l?.character?.name) continue;
    games.push({ wChar: w.character.name, lChar: l.character.name, wEntrant: String(g.winnerId), lEntrant: String(l.entrant.id), wPlayers: emap.get(String(g.winnerId)) ?? [], lPlayers: emap.get(String(l.entrant.id)) ?? [], setId: String(n.id) });
  }
  const setsWithChars = new Set(games.map((g) => g.setId)).size;
  // games actually played, from set scores. a DQ (-1) or a missing score played none that count
  let gamesPlayed = 0;
  for (const n of nodes) {
    const scores = (n.slots ?? []).map((s) => s?.standing?.stats?.score?.value);
    if (scores.length >= 2 && scores.every((v) => typeof v === 'number' && v >= 0)) gamesPlayed += scores.reduce((a, b) => a + b, 0);
  }
  return { totalSets: nodes.length, games, gamesTotal, setsWithChars, gamesPlayed };
}
