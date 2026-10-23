import { MISS_CACHE_MS, aliases, allPages, chunk, cleanId, fitPage, lookupMany, miss, missedCache, pagesOf, query } from './queue.js';

// venueName and venueAddress are strings, which don't count toward the object limit
const TOURNAMENT_FIELDS = `
  id
  name
  slug
  startAt
  endAt
  city
  addrState
  venueName
  venueAddress
  isOnline
  images(type: "profile") { url }
`;

// Map of tournament id to the streams TOs added on its start.gg page, [{ name, source }]. none is an empty list
export async function getTournamentStreams(tournamentIds) {
  const data = await lookupMany(tournamentIds, (group) => `{ ${aliases(group, 't', 'tournament', 'streams { streamName streamSource }')} }`);
  return new Map(tournamentIds.map((id) => {
    const streams = (data[`t${id}`]?.streams ?? []).filter((stream) => stream?.streamName);
    return [String(id), streams.map(({ streamName, streamSource }) => ({ name: streamName, source: streamSource }))];
  }));
}

// [userId, tournaments] for each of them. also returns ones they only admin, those just end up with no entries
export async function getUpcomingTournaments(userIds) {
  const tournaments = `tournaments(query: { perPage: 20, filter: { upcoming: true, past: false } }) { nodes { ${TOURNAMENT_FIELDS} } }`;
  const data = await lookupMany(userIds, (group) => `{ ${aliases(group, 'u', 'user', tournaments)} }`);

  return userIds.map((userId) => [userId, data[`u${userId}`]?.tournaments?.nodes ?? []]);
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
    // every event, crew in it or not, for a tracked tournament's top 8 and /bracket
    const eventList = (events ?? []).map(({ id, name, slug, state, numEntrants }) => ({ id, name, slug, state, numEntrants }));
    info = { ...rest, events: eventList };
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
    .map((id) => `u${cleanId(id)}: userEntrant(userId: ${cleanId(id)}) { id isDisqualified standing { placement isFinal } }`)
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

// for the top 8 post: Map of eventId to { done, standings } with everyone, tracked or not.
// double elimination ties fill 8 exactly (5th and 7th go two each). an event is ~17 objects here
export async function getTopEight(eventIds) {
  const standings = 'state standings(query: { page: 1, perPage: 8 }) { nodes { placement isFinal entrant { name } } }';
  const data = await lookupMany(eventIds, (group) => `{ ${aliases(group, 'e', 'event', standings)} }`);
  return new Map(eventIds.filter((id) => data[`e${id}`]).map((id) => {
    const event = data[`e${id}`];
    const top = (event.standings?.nodes ?? []).map((node) => ({
      placement: node.placement,
      final: node.isFinal ?? false,
      name: node.entrant?.name ?? 'Unknown',
    }));
    return [id, { done: event.state === 'COMPLETED', standings: top }];
  }));
}

const REGISTRATION_FIELDS = `
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
  venueName
  venueAddress
  isOnline
  images { type url }
  events { name slug }
  streams { streamName streamSource }
`;

// slug is genesis-x, tournament/genesis-x or a short link name
export async function getRegistration(slug) {
  const missed = missedCache.get(`registration:${slug}`);
  if (missed && Date.now() - missed < MISS_CACHE_MS) return null;
  const data = await query(`
    query ($slug: String) {
      tournament(slug: $slug) { ${REGISTRATION_FIELDS} }
    }
  `, { slug });

  if (!data.tournament) miss(`registration:${slug}`);
  return data.tournament;
}

// the same by id, for a tournament already saved. a TO can change the link, never the id, so null here
// means it was deleted or unpublished
export async function getRegistrationById(id) {
  const data = await query(`
    query ($id: ID!) {
      tournament(id: $id) { ${REGISTRATION_FIELDS} }
    }
  `, { id });
  return data.tournament;
}

// everyone registered, with the discord they connected on start.gg if they did, and the slug a tracked
// tournament's crew card links them by. a participant is ~3 objects, so 200 a page stays under the limit
export async function getParticipants(tournamentId) {
  const getPage = pagesOf(`
    query ($id: ID!, $page: Int!, $perPage: Int!) {
      tournament(id: $id) {
        participants(query: { page: $page, perPage: $perPage }) {
          pageInfo { totalPages }
          nodes { gamerTag user { id slug authorizations(types: [DISCORD]) { externalId } } }
        }
      }
    }
  `, { id: tournamentId }, (data) => data.tournament?.participants);
  const pages = await allPages((page) => fitPage(getPage, page, 200));

  // TOs can add people who don't have an account
  return pages.flatMap((page) => page.nodes).map((node) => ({
    tag: node.gamerTag,
    userId: node.user?.id,
    slug: node.user?.slug,
    discordId: node.user?.authorizations?.[0]?.externalId,
  }));
}

// a TO can hide who's registered. start.gg then sends no participants and no count, which is only
// different from nobody being registered yet because that has a count of 0
export function attendeesHidden(tournament, participants) {
  return !participants.length && tournament.numAttendees !== 0;
}
