const API_URL = 'https://api.start.gg/gql/alpha';

export function startggUrl(slug) {
  return `https://www.start.gg/${slug}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chunk(list, size) {
  const groups = [];
  for (let i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size));
  return groups;
}

// start.gg allows 80 requests a minute, so space them 800ms apart
let nextSlot = 0;

async function query(text, variables, retries = 2) {
  const slot = Math.max(Date.now(), nextSlot);
  nextSlot = slot + 800;
  await sleep(slot - Date.now());

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
  // still got limited, probably another copy running on the same token
  if (res.status === 429 && retries > 0) {
    await sleep(15_000);
    return query(text, variables, retries - 1);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`start.gg: ${body.message ?? `HTTP ${res.status}`}`);
  if (body.errors) throw new Error(`start.gg: ${body.errors[0].message}`);
  return body.data;
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
  };
}

const SET_FIELDS = `
  id
  state
  completedAt
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
  // start.gg rejects queries that could return over 1000 objects,
  // roughly 3 per player + 35 per set, more for long sets
  const size = Math.max(1, Math.floor(1000 / (3 + 35 * perPage)));

  // a few players per request, aliased as p<id>
  const results = await Promise.all(chunk(playerIds, size).map((group) => query(`
    query ($perPage: Int!, $filters: SetFilters) {
      ${group.map((id) => `p${id}: player(id: ${id}) { sets(perPage: $perPage, page: 1, filters: $filters) { nodes { ${SET_FIELDS} } } }`).join('\n')}
    }
  `, { perPage, filters: { state: states, updatedAfter: since } })));

  // two tracked players can be in the same set
  const setsById = new Map();
  for (const player of results.flatMap(Object.values)) {
    for (const set of (player?.sets?.nodes ?? []).map(toSet).filter(Boolean)) {
      setsById.set(set.id, set);
    }
  }
  return [...setsById.values()];
}

// for h2h/predict. no games or characters, so a set is ~22 objects and 40 fit under the limit
export async function getSetHistory(playerId, page) {
  const data = await query(`
    query ($id: ID!, $page: Int!) {
      player(id: $id) {
        sets(perPage: 40, page: $page, filters: { state: [3], entrantSize: [1] }) {
          nodes {
            id
            completedAt
            fullRoundText
            winnerId
            event { slug videogame { displayName } tournament { name } }
            slots {
              entrant { id initialSeedNum participants { player { id } } }
              standing { stats { score { value } } }
            }
          }
        }
      }
    }
  `, { id: playerId, page });

  return (data.player?.sets?.nodes ?? []).map(toSet).filter(Boolean);
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

// also returns ones they only admin, those just end up with no entries
export async function getUpcomingTournaments(userId) {
  const data = await query(`
    query ($id: ID!) {
      user(id: $id) {
        tournaments(query: { perPage: 20, filter: { upcoming: true, past: false } }) {
          nodes { ${TOURNAMENT_FIELDS} }
        }
      }
    }
  `, { id: userId });

  return data.user?.tournaments?.nodes ?? [];
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
          placement: entrant.standing?.placement ?? null,
          dq: entrant.isDisqualified,
        });
      }
    }
  }

  return { ...info, entries };
}

async function lookupEntries(tournamentId, userIds) {
  const entrantLookups = userIds
    .map((id) => `u${id}: userEntrant(userId: ${id}) { id isDisqualified standing { placement } }`)
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
