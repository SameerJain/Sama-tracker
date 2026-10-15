export const url = (slug) => `https://www.start.gg/${slug}`;

// start.gg allows 80 requests a minute, so send one at a time with a gap.
let queue = Promise.resolve();
function gql(query, variables) {
  const run = queue.then(() => request(query, variables));
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 800)));
  return run;
}

async function request(query, variables) {
  const res = await fetch('https://api.start.gg/gql/alpha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.STARTGG_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) throw new Error(`start.gg: ${body.errors?.[0]?.message ?? body.message ?? res.status}`);
  return body.data;
}

export async function getPlayer(slug) {
  const { user } = await gql(`query ($slug: String) {
    user(slug: $slug) { id slug images(type: "profile") { url } player { id gamerTag } }
  }`, { slug: `user/${slug}` });
  if (!user?.player) return null;
  return { userId: user.id, slug: user.slug, playerId: user.player.id, tag: user.player.gamerTag, image: user.images?.[0]?.url };
}

export async function getSets(playerId, { since, perPage = 10 } = {}) {
  const { player } = await gql(`query ($id: ID!, $perPage: Int!, $filters: SetFilters) {
    player(id: $id) {
      sets(perPage: $perPage, page: 1, filters: $filters) {
        nodes {
          id completedAt fullRoundText winnerId
          event { name slug videogame { displayName } tournament { name slug images(type: "profile") { url } } }
          slots { entrant { id name participants { player { id } } } standing { stats { score { value } } } }
          games { selections { entrant { id } character { name } } }
        }
      }
    }
  }`, { id: playerId, perPage, filters: { state: [3], updatedAfter: since } });

  return (player?.sets?.nodes ?? [])
    .filter((s) => s.slots?.length === 2 && s.slots.every((slot) => slot.entrant))
    .map((s) => ({
      id: String(s.id),
      completedAt: s.completedAt,
      round: s.fullRoundText,
      winnerId: s.winnerId,
      event: s.event,
      sides: s.slots.map(({ entrant, standing }) => ({
        id: entrant.id,
        name: entrant.name,
        playerIds: entrant.participants.map((p) => p.player?.id),
        score: standing?.stats?.score?.value ?? null,
        characters: [...new Set((s.games ?? []).flatMap((g) => (g.selections ?? [])
          .filter((sel) => sel.entrant?.id === entrant.id && sel.character)
          .map((sel) => sel.character.name)))],
      })),
    }));
}

const TOURNAMENT = 'id name slug startAt endAt city addrState isOnline images(type: "profile") { url }';

export async function getUpcoming(userId) {
  const { user } = await gql(`query ($id: ID!) {
    user(id: $id) { tournaments(query: { perPage: 20, filter: { upcoming: true, past: false } }) { nodes { ${TOURNAMENT} } } }
  }`, { id: userId });
  return user?.tournaments?.nodes ?? [];
}

// The tournament plus which events each user is entered in, with placements once they exist.
export async function getEntries(tournamentId, userIds) {
  const aliases = userIds.map((id) => `u${id}: userEntrant(userId: ${Number(id)}) { isDisqualified standing { placement } }`);
  const { tournament } = await gql(`query ($id: ID!) {
    tournament(id: $id) { ${TOURNAMENT} events { name slug state numEntrants ${aliases.join(' ')} } }
  }`, { id: tournamentId });
  if (!tournament) return null;

  const { events, ...info } = tournament;
  const entries = (events ?? []).flatMap((e) => userIds.filter((id) => e[`u${id}`]).map((userId) => ({
    userId,
    event: e.name,
    eventSlug: e.slug,
    entrants: e.numEntrants,
    done: e.state === 'COMPLETED',
    placement: e[`u${userId}`].standing?.placement ?? null,
    dq: e[`u${userId}`].isDisqualified,
  })));
  return { ...info, entries };
}
