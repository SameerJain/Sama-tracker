const API_URL = 'https://api.start.gg/gql/alpha';

export function startggUrl(slug) {
  return `https://www.start.gg/${slug}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// start.gg allows 80 requests a minute. Each request takes the next free slot, 800ms apart.
let nextSlot = 0;

async function query(text, variables) {
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
    // Without this a stuck request holds up every check behind it for minutes.
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`start.gg: ${body.message ?? `HTTP ${res.status}`}`);
  if (body.errors) throw new Error(`start.gg: ${body.errors[0].message}`);
  return body.data;
}

// Fails if STARTGG_TOKEN is wrong, so a bad .env shows up at startup.
export async function checkToken() {
  await query('{ currentUser { id } }');
}

// Takes a profile ID like f64a83c8, or a slug like user/f64a83c8.
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

// Sets for a player, optionally only ones changed after `since`. Finished ones by default.
// start.gg set states: 2 is in progress, 3 is finished, 6 is called.
export async function getSets(playerId, { since, perPage = 10, states = [3] } = {}) {
  const data = await query(`
    query ($id: ID!, $perPage: Int!, $filters: SetFilters) {
      player(id: $id) {
        sets(perPage: $perPage, page: 1, filters: $filters) {
          nodes {
            id
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
              entrant { id name participants { player { id } } }
              standing { stats { score { value } } }
            }
            games {
              selections { entrant { id } character { name } }
            }
          }
        }
      }
    }
  `, { id: playerId, perPage, filters: { state: states, updatedAfter: since } });

  const sets = [];
  for (const node of data.player?.sets?.nodes ?? []) {
    // Skip sets that don't have two players.
    if (node.slots?.length !== 2 || !node.slots[0].entrant || !node.slots[1].entrant) continue;

    const sides = node.slots.map((slot) => ({
      id: slot.entrant.id,
      name: slot.entrant.name,
      playerIds: slot.entrant.participants.map((participant) => participant.player?.id),
      score: slot.standing?.stats?.score?.value ?? null,
      characters: charactersPlayed(node.games, slot.entrant.id),
    }));

    sets.push({
      id: String(node.id),
      completedAt: node.completedAt,
      round: node.fullRoundText,
      winnerId: node.winnerId,
      stream: node.stream,
      event: node.event,
      sides,
    });
  }
  return sets;
}

// Sets a player is playing on stream right now: called or in progress, with a stream assigned.
export async function getStreamedSets(playerId) {
  // Only sets updated in the last hour, so one left in progress at some old tournament doesn't count.
  const since = Math.floor(Date.now() / 1000) - 60 * 60;
  const sets = await getSets(playerId, { since, perPage: 3, states: [2, 6] });
  // Some streams on start.gg have no name, which leaves nothing to link to.
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

// start.gg caps how much one request can return. Asking about every player in every event
// at a big major can go over, so ask about a few players per request.
const PLAYERS_PER_LOOKUP = 5;

// A tournament plus which events each user is entered in, with placements once they exist.
export async function getTournament(tournamentId, userIds) {
  const groups = [];
  for (let i = 0; i < userIds.length; i += PLAYERS_PER_LOOKUP) {
    groups.push(userIds.slice(i, i + PLAYERS_PER_LOOKUP));
  }
  // With nobody tracked, still look up the tournament itself.
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
  // One userEntrant lookup per user. The u123 aliases keep the answers apart.
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
