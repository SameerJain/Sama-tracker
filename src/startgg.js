import { AsyncLocalStorage } from 'node:async_hooks';

const API_URL = 'https://api.start.gg/gql/alpha';

export function startggUrl(slug) {
  return `https://www.start.gg/${slug}`;
}

function chunk(list, size) {
  const groups = [];
  for (let i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size));
  return groups;
}

// start.gg allows 80 requests a minute, so one goes out every 800ms.
// requests for a command go ahead of the background checks, and commands take turns
// so one that needs a lot of pages doesn't hold up everyone else's
const fromCommand = new AsyncLocalStorage();
// one queue per command, in here while it has requests waiting
const commandQueues = [];
const background = [];
let nextSlot = 0;
let timer;

export const asCommand = (fn) => fromCommand.run([], fn);
export const inBackground = (fn) => fromCommand.run(background, fn);
export const queueLength = () => commandQueues.reduce((sum, queue) => sum + queue.length, background.length);

function takeTurn() {
  return new Promise((resolve) => {
    const queue = fromCommand.getStore() ?? background;
    if (queue !== background && !queue.length) commandQueues.push(queue);
    queue.push(resolve);
    sendNext();
  });
}

function sendNext() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    // a 429 pushed everything back since this was scheduled
    if (Date.now() < nextSlot) return sendNext();
    const queue = commandQueues.shift() ?? background;
    const next = queue.shift();
    if (!next) return;
    // back of the line for its next one
    if (queue !== background && queue.length) commandQueues.push(queue);
    nextSlot = Date.now() + 800;
    next();
    sendNext();
  }, Math.max(0, nextSlot - Date.now()));
}

async function query(text, variables, retries = 2) {
  await takeTurn();

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.STARTGG_TOKEN}`,
    },
    body: JSON.stringify({ query: text, variables }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    throw new Error(`start.gg didn't respond (${err.message})`);
  });
  // still got limited, probably another copy running on the same token. everything waits
  if (res.status === 429 && retries > 0) {
    nextSlot = Date.now() + 15_000;
    return query(text, variables, retries - 1);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`start.gg: ${body.message ?? `HTTP ${res.status}`}`);
  if (body.errors) throw new Error(`start.gg: ${body.errors[0].message}`);
  return body.data;
}

// getPage(n) resolves to { totalPages, ... }. page 1 says how many there are, then the rest get asked
// for at once. the rate limit spaces them out, so nothing waits on the response before it
async function allPages(getPage) {
  const first = await getPage(1);
  const rest = [];
  for (let page = 2; page <= first.totalPages; page++) rest.push(getPage(page));
  return [first, ...await Promise.all(rest)];
}

// a bunch of lookups per request, aliased by id. start.gg's 1000 object limit counts what comes back
// and most checks come back empty, so groups start big and get split in half when they go over
async function lookupMany(ids, toQuery, variables) {
  const results = await Promise.all(chunk(ids, 20).map((group) => lookupGroup(group, toQuery, variables)));
  return Object.assign({}, ...results);
}

async function lookupGroup(group, toQuery, variables) {
  try {
    return await query(toQuery(group), variables);
  } catch (err) {
    if (group.length === 1 || !err.message.includes('complexity')) throw err;
    const half = Math.ceil(group.length / 2);
    const [a, b] = await Promise.all([group.slice(0, half), group.slice(half)].map((each) => lookupGroup(each, toQuery, variables)));
    return { ...a, ...b };
  }
}

export async function checkToken() {
  await query('{ currentUser { id } }');
}

// id is f64a83c8 or user/f64a83c8
export async function getPlayer(id) {
  const slug = id.startsWith('user/') ? id : `user/${id}`;
  const data = await query(`
    query ($slug: String) {
      user(slug: $slug) {
        id
        slug
        images(type: "profile") { url }
        player { id gamerTag }
        authorizations(types: [DISCORD]) { externalId }
      }
    }
  `, { slug });

  const user = data.user;
  if (!user?.player) return null;

  return {
    userId: user.id,
    slug: user.slug,
    playerId: user.player.id,
    tag: user.player.gamerTag,
    image: user.images?.[0]?.url,
    discordId: user.authorizations?.[0]?.externalId,
  };
}

// [userId, { tag, image, discordId }] for each of them, null if they're gone from start.gg
export async function getProfiles(userIds) {
  const data = await lookupMany(userIds, (group) => `{
    ${group.map((id) => `u${id}: user(id: ${id}) { images(type: "profile") { url } player { gamerTag } authorizations(types: [DISCORD]) { externalId } }`).join('\n')}
  }`);

  return userIds.map((userId) => {
    const user = data[`u${userId}`];
    return [userId, user?.player ? { tag: user.player.gamerTag, image: user.images?.[0]?.url, discordId: user.authorizations?.[0]?.externalId } : null];
  });
}

const SET_FIELDS = `
  id
  state
  completedAt
  updatedAt
  fullRoundText
  winnerId
  stream { streamName streamSource }
  event {
    name
    slug
    videogame { displayName }
    tournament { name slug images(type: "profile") { url } }
  }
  slots {
    entrant { id name initialSeedNum participants { player { id } } }
    standing { stats { score { value } } }
  }
  games {
    selections { entrant { id } character { name } }
  }
`;

function toSet(node) {
  // still waiting on a player
  if (node.slots?.length !== 2 || !node.slots[0].entrant || !node.slots[1].entrant) return null;

  const sides = node.slots.map((slot) => ({
    id: slot.entrant.id,
    name: slot.entrant.name,
    seed: slot.entrant.initialSeedNum,
    playerIds: slot.entrant.participants.map((participant) => participant.player?.id),
    score: slot.standing?.stats?.score?.value ?? null,
    characters: charactersPlayed(node.games, slot.entrant.id),
  }));

  return {
    id: String(node.id),
    state: node.state,
    completedAt: node.completedAt,
    updatedAt: node.updatedAt,
    round: node.fullRoundText,
    winnerId: node.winnerId,
    stream: node.stream,
    event: node.event,
    sides,
  };
}

// null if they weren't in it. a score of -1 is a DQ
export function fromSide(set, playerId) {
  const me = set.sides.find((side) => side.playerIds.includes(playerId));
  if (!me) return null;
  const them = set.sides.find((side) => side !== me);
  return { set, me, them, won: me.id === set.winnerId, dq: me.score === -1 || them.score === -1 };
}

// set states: 1 waiting, 2 in progress, 3 done, 6 called
export async function getSets(playerIds, { since, perPage = 10, states = [3] } = {}) {
  const data = await lookupMany(playerIds, (group) => `
    query ($perPage: Int!, $filters: SetFilters) {
      ${group.map((id) => `p${id}: player(id: ${id}) { sets(perPage: $perPage, page: 1, filters: $filters) { nodes { ${SET_FIELDS} } } }`).join('\n')}
    }
  `, { perPage, filters: { state: states, updatedAfter: since } });

  // two tracked players can be in the same set
  const setsById = new Map();
  for (const player of Object.values(data)) {
    for (const set of (player?.sets?.nodes ?? []).map(toSet).filter(Boolean)) {
      setsById.set(set.id, set);
    }
  }
  return [...setsById.values()];
}

// for h2h/predict. no games or characters, so a set is ~22 objects and 40 fit under the limit.
// pages can come back short or empty in the middle, so totalPages is the only way to know it's the end
export async function getSetHistory(playerId, page, filters = {}) {
  const data = await query(`
    query ($id: ID!, $page: Int!, $filters: SetFilters) {
      player(id: $id) {
        sets(perPage: 40, page: $page, filters: $filters) {
          pageInfo { totalPages }
          nodes {
            id
            completedAt
            fullRoundText
            winnerId
            event { slug videogame { displayName } tournament { name } }
            slots {
              entrant { id name initialSeedNum participants { player { id } } }
              standing { stats { score { value } } }
            }
          }
        }
      }
    }
  `, { id: playerId, page, filters: { state: [3], entrantSize: [1], ...filters } });

  const connection = data.player?.sets;
  return { totalPages: connection?.pageInfo?.totalPages ?? 0, sets: (connection?.nodes ?? []).map(toSet).filter(Boolean) };
}

// sets completed in [since, until), newest first. updatedAfter also brings back old sets that got
// edited, so every page gets read before going by completion time
export async function getPeriodHistory(playerId, since, until) {
  const pages = await allPages((page) => getSetHistory(playerId, page, { updatedAfter: since - 1 }));
  const sets = new Map();
  for (const set of pages.flatMap((page) => page.sets)) {
    if (set.completedAt >= since && set.completedAt < until) sets.set(set.id, set);
  }
  return [...sets.values()].sort((a, b) => b.completedAt - a.completedAt);
}

// { totalPages, nodes } out of a paginated start.gg connection, which is null if what it's on is gone
function connectionPage(connection) {
  return { totalPages: connection?.pageInfo?.totalPages ?? 0, nodes: connection?.nodes ?? [] };
}

export async function getRunSets(eventId, playerId) {
  const pages = await allPages(async (page) => connectionPage((await query(`
    query ($id: ID!, $player: ID!, $page: Int!) {
      event(id: $id) {
        sets(page: $page, perPage: 30, sortType: STANDARD, filters: { playerIds: [$player], showByes: false }) {
          pageInfo { totalPages }
          nodes {
            id state completedAt fullRoundText winnerId
            event { slug }
            slots {
              entrant { id name initialSeedNum participants { player { id } } }
              standing { stats { score { value } } }
            }
          }
        }
      }
    }
  `, { id: eventId, player: playerId, page })).event?.sets));
  return pages.flatMap((page) => page.nodes).map(toSet).filter(Boolean);
}

// every finished singles event they entered, newest first. an event is ~7 objects, so 120 a page
export async function getEventHistory(userId) {
  const pages = await allPages(async (page) => connectionPage((await query(`
    query ($id: ID!, $page: Int!) {
      user(id: $id) {
        events(query: { page: $page, perPage: 120, filter: { eventType: 1 } }) {
          pageInfo { totalPages }
          nodes {
            name
            slug
            startAt
            numEntrants
            state
            videogame { displayName }
            tournament { name }
            userEntrant(userId: $id) { initialSeedNum isDisqualified standing { placement } }
          }
        }
      }
    }
  `, { id: userId, page })).user?.events));

  const events = [];
  for (const { userEntrant: entrant, state, ...event } of pages.flatMap((page) => page.nodes)) {
    const placement = entrant?.standing?.placement;
    if (state !== 'COMPLETED' || !placement) continue;
    events.push({ placement, seed: entrant.initialSeedNum, dq: entrant.isDisqualified, event });
  }
  return events.sort((a, b) => b.event.startAt - a.event.startAt);
}

// 30 sets keeps this under the object limit
export async function getStats(playerId) {
  const data = await query(`
    query ($id: ID!) {
      player(id: $id) {
        recentStandings(limit: 15) {
          placement
          isFinal
          entrant {
            initialSeedNum
            isDisqualified
            event { name slug numEntrants startAt tournament { name slug } }
          }
        }
        sets(perPage: 30, page: 1, filters: { state: [3], entrantSize: [1] }) {
          nodes {
            id
            completedAt
            winnerId
            event { slug videogame { displayName } tournament { name } }
            slots {
              entrant { id name initialSeedNum participants { player { id } } }
              standing { stats { score { value } } }
            }
          }
        }
      }
    }
  `, { id: playerId });

  const standings = (data.player?.recentStandings ?? [])
    .filter((standing) => standing.isFinal && standing.placement && standing.entrant?.event)
    .map(({ placement, entrant }) => ({ placement, seed: entrant.initialSeedNum, dq: entrant.isDisqualified, event: entrant.event }));
  const sets = (data.player?.sets?.nodes ?? []).map(toSet).filter(Boolean);
  return { standings, sets };
}

// for /characters. every game they reported a character for, newest set first.
// the limit counts what comes back, and a bo5 with characters is ~46 objects. most sets have
// nothing reported so 40 usually fit, and a page that goes over gets asked for again as two of 20
export async function getCharacterSets(playerId, page, perPage = 40) {
  const data = await query(`
    query ($id: ID!, $page: Int!, $perPage: Int!) {
      player(id: $id) {
        sets(perPage: $perPage, page: $page, filters: { state: [3], entrantSize: [1] }) {
          pageInfo { totalPages }
          nodes {
            id
            completedAt
            event { videogame { id displayName } }
            slots { entrant { id participants { player { id } } } }
            games { winnerId selections { entrant { id } character { name } } }
          }
        }
      }
    }
  `, { id: playerId, page, perPage }).catch((err) => {
    if (perPage === 20 || !err.message.includes('complexity')) throw err;
  });
  if (!data) {
    const halves = await Promise.all([getCharacterSets(playerId, page * 2 - 1, 20), getCharacterSets(playerId, page * 2, 20)]);
    return { totalPages: Math.ceil(halves[0].totalPages / 2), sets: halves.flatMap((half) => half.sets) };
  }

  const connection = data.player?.sets;
  const sets = (connection?.nodes ?? []).map((node) => {
    const mine = node.slots.find((slot) => slot.entrant?.participants.some((participant) => participant.player?.id === playerId))?.entrant.id;
    const games = [];
    for (const game of node.games ?? []) {
      const picks = game.selections ?? [];
      const character = picks.find((pick) => pick.entrant?.id === mine)?.character?.name;
      const against = picks.find((pick) => pick.entrant?.id !== mine)?.character?.name;
      if (character && game.winnerId) games.push({ character, against, won: game.winnerId === mine });
    }
    return { id: String(node.id), completedAt: node.completedAt, videogame: node.event.videogame, games };
  });
  return { totalPages: connection?.pageInfo?.totalPages ?? 0, sets };
}

export const ULTIMATE = 1386;

// rosters don't change, so each game's only gets fetched once
const rosters = new Map();

function roster(videogameId) {
  if (!rosters.has(videogameId)) {
    const characters = query('query ($id: ID!) { videogame(id: $id) { characters { name images(type: "icon") { url } } } }', { id: videogameId })
      .then((data) => data.videogame?.characters ?? []);
    characters.catch(() => rosters.delete(videogameId));
    rosters.set(videogameId, characters);
  }
  return rosters.get(videogameId);
}

// start.gg's icon for an ultimate character is its render, older games get a smaller portrait.
// discord can't always load images.start.gg, so this downloads it to upload with the message
export async function getCharacterArt(name, videogameId) {
  const url = (await roster(videogameId)).find((character) => character.name === name)?.images?.[0]?.url;
  if (!url) return null;

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`start.gg image returned ${res.status}`);
  const extension = new URL(url).pathname.split('.').pop();
  // one per game, a verbose reply has several
  return { attachment: Buffer.from(await res.arrayBuffer()), name: `character-${videogameId}.${extension}` };
}

export async function getStreamQueues(tournamentId) {
  const data = await query(`
    query ($id: ID!) {
      tournament(id: $id) {
        streamQueue {
          stream { streamName streamSource }
          sets { ${SET_FIELDS} }
        }
      }
    }
  `, { id: tournamentId });

  const queues = [];
  for (const queue of data.tournament?.streamQueue ?? []) {
    // queued sets don't always have the stream on them
    const sets = (queue.sets ?? []).map(toSet).filter(Boolean).map((set) => ({ ...set, stream: set.stream ?? queue.stream }));
    queues.push({ stream: queue.stream, sets });
  }
  return queues;
}

export async function getStreamedSets(playerIds) {
  // last hour only, old sets get left in progress forever
  const since = Math.floor(Date.now() / 1000) - 60 * 60;
  const sets = await getSets(playerIds, { since, perPage: 3, states: [2, 6] });
  // some streams have no name to link to
  return sets.filter((set) => set.stream?.streamName);
}

function charactersPlayed(games, entrantId) {
  const names = new Set();
  for (const game of games ?? []) {
    for (const pick of game.selections ?? []) {
      if (pick.entrant?.id === entrantId && pick.character) names.add(pick.character.name);
    }
  }
  return [...names];
}

const TOURNAMENT_FIELDS = `
  id
  name
  slug
  startAt
  endAt
  city
  addrState
  isOnline
  images(type: "profile") { url }
`;

// [userId, tournaments] for each of them. also returns ones they only admin, those just end up with no entries
export async function getUpcomingTournaments(userIds) {
  const data = await lookupMany(userIds, (group) => `{
    ${group.map((id) => `u${id}: user(id: ${id}) { tournaments(query: { perPage: 20, filter: { upcoming: true, past: false } }) { nodes { ${TOURNAMENT_FIELDS} } } }`).join('\n')}
  }`);

  return userIds.map((userId) => [userId, data[`u${userId}`]?.tournaments?.nodes ?? []]);
}

// only ones they're an admin of, not ones they entered
export async function getAdminTournaments(userIds) {
  const data = await lookupMany(userIds, (group) => `{
    ${group.map((id) => `u${id}: user(id: ${id}) { tournaments(query: { perPage: 20, filter: { tournamentView: "admin", upcoming: true, past: false } }) { nodes { id name slug startAt endAt } } }`).join('\n')}
  }`);

  return Object.values(data).flatMap((user) => user?.tournaments?.nodes ?? []);
}

// every player in every event at a major goes over the object limit
const PLAYERS_PER_LOOKUP = 5;

export async function getTournament(tournamentId, userIds) {
  const groups = chunk(userIds, PLAYERS_PER_LOOKUP);
  // still need the tournament itself with nobody tracked
  if (!groups.length) groups.push([]);

  let info;
  const entries = [];
  for (const group of groups) {
    const tournament = await lookupEntries(tournamentId, group);
    if (!tournament) return null;

    const { events, ...rest } = tournament;
    info = rest;
    for (const event of events ?? []) {
      for (const userId of group) {
        const entrant = event[`u${userId}`];
        if (!entrant) continue;

        entries.push({
          userId,
          eventId: event.id,
          event: event.name,
          eventSlug: event.slug,
          entrants: event.numEntrants,
          done: event.state === 'COMPLETED',
          // raffles and registration-only events never start
          started: event.state !== 'CREATED',
          placement: entrant.standing?.placement ?? null,
          // false while they're still in, then it's where they'd finish losing their next set
          final: entrant.standing?.isFinal ?? false,
          dq: entrant.isDisqualified,
        });
      }
    }
  }

  return { ...info, entries };
}

async function lookupEntries(tournamentId, userIds) {
  const entrantLookups = userIds
    .map((id) => `u${id}: userEntrant(userId: ${id}) { id isDisqualified standing { placement isFinal } }`)
    .join('\n');

  const data = await query(`
    query ($id: ID!) {
      tournament(id: $id) {
        ${TOURNAMENT_FIELDS}
        events {
          id
          name
          slug
          state
          numEntrants
          ${entrantLookups}
        }
      }
    }
  `, { id: tournamentId });

  return data.tournament;
}

// slug is genesis-x, tournament/genesis-x or a short link name
export async function getRegistration(slug) {
  const data = await query(`
    query ($slug: String) {
      tournament(slug: $slug) {
        id
        name
        slug
        startAt
        endAt
        registrationClosesAt
        isRegistrationOpen
        numAttendees
        city
        addrState
        isOnline
        images { type url }
        events { name slug }
      }
    }
  `, { slug });

  return data.tournament;
}

// everyone registered, with the discord they connected on start.gg if they did.
// a participant is ~3 objects, so 200 a page stays under the limit
export async function getParticipants(tournamentId) {
  const pages = await allPages(async (page) => connectionPage((await query(`
    query ($id: ID!, $page: Int!) {
      tournament(id: $id) {
        participants(query: { page: $page, perPage: 200 }) {
          pageInfo { totalPages }
          nodes { gamerTag user { id authorizations(types: [DISCORD]) { externalId } } }
        }
      }
    }
  `, { id: tournamentId, page })).tournament?.participants));

  // TOs can add people who don't have an account
  return pages.flatMap((page) => page.nodes)
    .map((node) => ({ tag: node.gamerTag, userId: node.user?.id, discordId: node.user?.authorizations?.[0]?.externalId }));
}
