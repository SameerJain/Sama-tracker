import { MELEE, ULTIMATE, allPages, cleanId, connectionPage, fitPage, lookupMany, query } from './queue.js';

const SET_SLOTS = `
  slots {
    entrant { id name initialSeedNum participants { player { id } } }
    standing { stats { score { value } } }
  }
`;

const SET_FIELDS = `
  id
  state
  completedAt
  updatedAt
  fullRoundText
  winnerId
  vodUrl
  stream { streamName streamSource }
  station { number }
  event {
    name
    slug
    videogame { id displayName }
    tournament { name slug isOnline images(type: "profile") { url } }
  }
  ${SET_SLOTS}
  games {
    selections { entrant { id } character { name } }
  }
`;

function toSet(node) {
  // its event got deleted, which old sets far back in someone's history can have
  if (!node.event) return null;
  // still waiting on a player
  if (node.slots?.length !== 2 || !node.slots[0].entrant || !node.slots[1].entrant) return null;

  const sides = node.slots.map((slot) => ({
    id: slot.entrant.id,
    name: slot.entrant.name,
    seed: slot.entrant.initialSeedNum,
    playerIds: (slot.entrant.participants ?? []).map((participant) => participant.player?.id),
    // only the doubles history asks for tags, to name partners
    tags: (slot.entrant.participants ?? []).map((participant) => participant.player?.gamerTag ?? null),
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
    // the TO's VOD link, null when they didn't add one
    vod: typeof node.vodUrl === 'string' && /^https?:\/\//i.test(node.vodUrl.trim()) ? node.vodUrl.trim() : null,
    stream: node.stream,
    // only /run asks for these
    station: node.station?.number ?? null,
    startAt: node.startAt ?? null,
    event: namedGame(node.event),
    sides,
  };
}

// who won and the score, the part of a set a TO fixes when they reported it wrong. the same for a parsed set
// and for getSetOutcomes, so the two can be compared
export function outcomeOf(set) {
  return [set.winnerId, ...set.sides.map((side) => side.score)].join(':');
}

// TOs pick the game from a list and sometimes pick the wrong one, like a "Melee Singles" tagged as Ultimate.
// the name is typed by hand, so when it names the other one of the two, that's the game it was. other games
// are left alone, a P+ event can mention Melee
const NAMED_GAMES = [
  { id: MELEE, displayName: 'Melee', named: /\b(melee|ssbm)\b/i },
  { id: ULTIMATE, displayName: 'Ultimate', named: /\b(ultimate|ssbu)\b/i },
];

export function namedGame(event) {
  const tagged = NAMED_GAMES.find((game) => game.id === event?.videogame?.id);
  if (!tagged || !event.name) return event;
  const named = NAMED_GAMES.filter((game) => game.named.test(event.name));
  if (named.length !== 1 || named[0] === tagged) return event;
  return { ...event, videogame: { ...event.videogame, id: named[0].id, displayName: named[0].displayName } };
}

// null if they weren't in it. a score of -1 is a DQ
export function fromSide(set, playerId) {
  const me = set.sides.find((side) => side.playerIds.includes(playerId));
  if (!me) return null;
  const them = set.sides.find((side) => side !== me);
  return { set, me, them, won: me.id === set.winnerId, dq: me.score === -1 || them.score === -1 };
}

// singles results from the player's side, DQs left out
export function singles(sets, player) {
  return sets.map((set) => fromSide(set, player.playerId)).filter((result) => result && !result.dq);
}

// sets, standings and events carry their game under event, character sets at the top, and results
// wrap their set. one predicate covers every list a melee option filters
export const isMelee = (entry) => ((entry.set ?? entry).event?.videogame ?? entry.videogame)?.id === MELEE;

// set states: 1 waiting, 2 in progress, 3 done, 6 called
export async function getSets(playerIds, { since, perPage = 10, states = [3] } = {}) {
  const data = await lookupMany(playerIds, (group) => `
    query ($perPage: Int!, $filters: SetFilters) {
      ${group.map((id) => `p${cleanId(id)}: player(id: ${cleanId(id)}) { sets(perPage: $perPage, page: 1, filters: $filters) { nodes { ${SET_FIELDS} } } }`).join('\n')}
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

// the ones with a finished singles set updated since then. a set finished then was updated then too, so
// nobody who played gets missed. one id each, so 50 players fit in a request
export async function getActivePlayers(playerIds, since) {
  const data = await lookupMany(playerIds, (group) => `
    query ($filters: SetFilters) {
      ${group.map((id) => `p${cleanId(id)}: player(id: ${cleanId(id)}) { sets(perPage: 1, page: 1, filters: $filters) { nodes { id } } }`).join('\n')}
    }
  `, { filters: { state: [3], entrantSize: [1], updatedAfter: since - 1 } }, 50);
  return new Set(playerIds.filter((id) => data[`p${id}`]?.sets?.nodes?.length));
}

// for history/predict and opponent-filtered h2h. no games or characters, so 40 sets come to about 960
// objects. adding numEntrants put a page at 1003, so bracket sizes come from getEventHistory.
// opponent lookups can include teams, so 30 leaves room for their extra participants. a top player's
// page can still go over, which fitPage splits
// pages can come back short or empty in the middle, so totalPages is the only way to know it's the end
export async function getSetHistory(playerId, page, { opponentId, ...filters } = {}) {
  const { totalPages, nodes } = await fitPage(async (page, perPage) => connectionPage((await query(`
    query ($id: ID!, $page: Int!, $perPage: Int!, $opponentId: ID, $filters: SetFilters) {
      player(id: $id) {
        sets(perPage: $perPage, page: $page, opponentId: $opponentId, filters: $filters) {
          pageInfo { totalPages }
          nodes {
            id
            completedAt
            fullRoundText
            winnerId
            vodUrl
            event { name slug videogame { id displayName } tournament { name isOnline } }
            ${SET_SLOTS}
          }
        }
      }
    }
  `, { id: playerId, page, perPage, opponentId, filters: { state: [3], ...(opponentId ? {} : { entrantSize: [1] }), ...filters } })).player?.sets), page, opponentId ? 30 : 40);

  return { totalPages, sets: nodes.map(toSet).filter(Boolean) };
}

// every singles meeting, newest first, DQs left out. usually one opponent-filtered page is enough
export async function getHeadToHead(playerId, opponentId) {
  const pages = await allPages((page) => getSetHistory(playerId, page, { opponentId }));
  // start.gg rejects entrantSize with opponentId, so singles get checked here
  const sets = pages.flatMap((page) => page.sets).filter((set) => set.sides.every((side) => side.playerIds.length === 1));
  const played = singles(sets, { playerId }).filter(({ them }) => them.playerIds.includes(opponentId));
  return [...new Map(played.map(({ set }) => [set.id, set])).values()].sort((a, b) => b.completedAt - a.completedAt);
}

// for /doubles, 2v2 sets only. a team's slot has 2 more participant objects than singles, the same
// room opponent lookups leave for teams, so 30 a page. gamerTag isn't an object, so naming partners
// costs nothing. event id is for getDoublesEvents
export async function getDoublesHistory(playerId, page) {
  const { totalPages, nodes } = await fitPage(async (page, perPage) => connectionPage((await query(`
    query ($id: ID!, $page: Int!, $perPage: Int!) {
      player(id: $id) {
        sets(perPage: $perPage, page: $page, filters: { state: [3], entrantSize: [2] }) {
          pageInfo { totalPages }
          nodes {
            id
            completedAt
            fullRoundText
            winnerId
            vodUrl
            event { id name slug videogame { id displayName } tournament { name } }
            slots {
              entrant { id name initialSeedNum participants { player { id gamerTag } } }
              standing { stats { score { value } } }
            }
          }
        }
      }
    }
  `, { id: playerId, page, perPage })).player?.sets), page, 30);

  return { totalPages, sets: nodes.map(toSet).filter(Boolean) };
}

// Map of event id to { placement, seed, dq, event, partners } for the doubles events their sets came
// from. a set doesn't say where the team finished, and user.events has no documented doubles filter,
// so each event gets looked up with their entrant. ~9 objects an event, so 40 a request
export async function getDoublesEvents(player, eventIds) {
  const data = await lookupMany(eventIds, (group) => `{
    ${group.map((id) => `e${cleanId(id)}: event(id: ${cleanId(id)}) {
      id name slug startAt numEntrants state videogame { id displayName } tournament { name }
      userEntrant(userId: ${cleanId(player.userId)}) { initialSeedNum isDisqualified standing { placement } participants { player { id gamerTag } } }
    }`).join('\n')}
  }`, undefined, 40);

  const events = new Map();
  for (const id of eventIds) {
    const { userEntrant: entrant, state, ...event } = data[`e${id}`] ?? {};
    const placement = entrant?.standing?.placement;
    // placement lines link the tournament
    if (state !== 'COMPLETED' || !placement || !event.tournament) continue;
    const partners = (entrant.participants ?? []).map((participant) => participant.player)
      .filter((each) => each && String(each.id) !== String(player.playerId))
      .map((each) => ({ id: each.id, tag: each.gamerTag }));
    events.set(id, { placement, seed: entrant.initialSeedNum, dq: entrant.isDisqualified, event: namedGame(event), partners });
  }
  return events;
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

// a set is about 16 objects, 17 with its station, so 30 a page comes to about 510.
// the event's game rides along so the run's head-to-head button filters to it
export async function getRunSets(eventId, playerId) {
  const pages = await allPages((page) => fitPage(async (page, perPage) => connectionPage((await query(`
    query ($id: ID!, $player: ID!, $page: Int!, $perPage: Int!) {
      event(id: $id) {
        sets(page: $page, perPage: $perPage, sortType: STANDARD, filters: { playerIds: [$player], showByes: false }) {
          pageInfo { totalPages }
          nodes {
            id state completedAt fullRoundText winnerId startAt vodUrl
            event { name slug videogame { id displayName } }
            station { number }
            ${SET_SLOTS}
          }
        }
      }
    }
  `, { id: eventId, player: playerId, page, perPage })).event?.sets), page, 30));
  return pages.flatMap((page) => page.nodes).map(toSet).filter(Boolean);
}

// a set with its games is about 55 objects, so 10 an event a page comes to about 550
const EVENT_SETS_PER_PAGE = 10;

// every set finished in these events since then, whoever played, for a tracked tournament's set results. most
// checks find a few sets or none, so the events share a request that splits when it runs over, and an event
// with more than a page gets the rest on its own
export async function getEventSets(eventIds, since) {
  const filters = { state: [3], updatedAfter: since, showByes: false };
  const data = await lookupMany(eventIds, (group) => `
    query ($filters: SetFilters) {
      ${group.map((id) => `e${cleanId(id)}: event(id: ${cleanId(id)}) { sets(perPage: ${EVENT_SETS_PER_PAGE}, page: 1, sortType: RECENT, filters: $filters) { pageInfo { totalPages } nodes { ${SET_FIELDS} } } }`).join('\n')}
    }
  `, { filters });

  const nodes = [];
  const rest = [];
  for (const id of eventIds) {
    const sets = data[`e${id}`]?.sets;
    nodes.push(...(sets?.nodes ?? []));
    for (let page = 2; page <= (sets?.pageInfo?.totalPages ?? 0); page++) rest.push(eventSetsPage(id, page, filters));
  }
  for (const page of await Promise.all(rest)) nodes.push(...page.nodes);
  return nodes.map(toSet).filter(Boolean);
}

function eventSetsPage(eventId, page, filters) {
  return fitPage(async (page, perPage) => connectionPage((await query(`
    query ($id: ID!, $page: Int!, $perPage: Int!, $filters: SetFilters) {
      event(id: $id) {
        sets(page: $page, perPage: $perPage, sortType: RECENT, filters: $filters) {
          pageInfo { totalPages }
          nodes { ${SET_FIELDS} }
        }
      }
    }
  `, { id: cleanId(eventId), page, perPage, filters })).event?.sets), page, EVENT_SETS_PER_PAGE);
}

// every finished singles event they entered, newest first. an event is ~7 objects, so 120 a page
export async function getEventHistory(userId) {
  const pages = await allPages((page) => fitPage(async (page, perPage) => connectionPage((await query(`
    query ($id: ID!, $page: Int!, $perPage: Int!) {
      user(id: $id) {
        events(query: { page: $page, perPage: $perPage, filter: { eventType: 1 } }) {
          pageInfo { totalPages }
          nodes {
            name
            slug
            startAt
            numEntrants
            state
            videogame { id displayName }
            tournament { name isOnline }
            userEntrant(userId: $id) { initialSeedNum isDisqualified standing { placement } }
          }
        }
      }
    }
  `, { id: userId, page, perPage })).user?.events), page, 120));

  const events = [];
  for (const { userEntrant: entrant, state, ...event } of pages.flatMap((page) => page.nodes)) {
    const placement = entrant?.standing?.placement;
    // placement lines link the tournament
    if (state !== 'COMPLETED' || !placement || !event.tournament) continue;
    events.push({ placement, seed: entrant.initialSeedNum, dq: entrant.isDisqualified, event: namedGame(event) });
  }
  return events.sort((a, b) => b.event.startAt - a.event.startAt);
}

// 30 sets keeps this under the object limit. since is unix seconds, venue offline or online,
// and the window fills from further pages the way a game filter does. a page that goes over gets split
// by fitPage, and its first part still has the standings because it's still page 1
export async function getStats(playerId, { videogameId, since, venue } = {}) {
  const inScope = (set) => (!videogameId || set?.event.videogame?.id === videogameId)
    && (!since || (set?.completedAt ?? 0) >= since)
    && (!venue || (set?.event.tournament?.isOnline ?? null) === (venue === 'online'));
  const getPage = (page) => fitPage(async (page, perPage) => {
    const { player } = await query(`
    query ($id: ID!, $videogameId: ID, $page: Int!, $perPage: Int!, $standings: Boolean!) {
      player(id: $id) {
        recentStandings(limit: 15, videogameId: $videogameId) @include(if: $standings) {
          placement
          isFinal
          entrant {
            initialSeedNum
            isDisqualified
            event { name slug numEntrants startAt videogame { id } tournament { name slug isOnline } }
          }
        }
        sets(perPage: $perPage, page: $page, filters: { state: [3], entrantSize: [1] }) {
          pageInfo { totalPages }
          nodes {
            id
            completedAt
            winnerId
            vodUrl
            event { name slug videogame { id displayName } tournament { name isOnline } }
            ${SET_SLOTS}
          }
        }
      }
    }
  `, { id: playerId, videogameId, page, perPage, standings: page === 1 });
    return { ...connectionPage(player?.sets), standings: player?.recentStandings };
  }, page, 30);

  const first = await getPage(1);
  // start.gg filters standings by the game the TO tagged, so one named for the other game comes out here
  const standings = (first.standings ?? [])
    .filter((standing) => standing.isFinal && standing.placement && standing.entrant?.event)
    .map(({ placement, entrant }) => ({ placement, seed: entrant.initialSeedNum, dq: entrant.isDisqualified, event: namedGame(entrant.event) }))
    .filter(({ event }) => !videogameId || event.videogame?.id === videogameId);
  const sets = first.nodes.map(toSet).filter(Boolean);
  if (!videogameId && !since && !venue) return { standings, sets };

  // Player.sets has no filter for these, so keep reading until the recent window is full for them
  const matching = sets.filter(inScope);
  for (let page = 2; page <= first.totalPages && matching.length < 30; page++) {
    const next = await getPage(page);
    matching.push(...next.nodes.map(toSet).filter((set) => set && inScope(set)));
  }
  return { standings, sets: matching.slice(0, 30) };
}

const CHARACTER_QUERY = `
  query ($id: ID!, $page: Int!, $perPage: Int!) {
    player(id: $id) {
      sets(perPage: $perPage, page: $page, filters: { state: [3], entrantSize: [1] }) {
        pageInfo { totalPages }
        nodes {
          id
          completedAt
          event { name videogame { id displayName } }
          slots { entrant { id participants { player { id } } } }
          games { winnerId stage { name } selections { entrant { id } character { name } } }
        }
      }
    }
  }
`;

// about how many objects start.gg counts in a reply toward its limit
function objectCount(value) {
  if (Array.isArray(value)) return value.reduce((sum, each) => sum + objectCount(each), 0);
  if (!value || typeof value !== 'object') return 0;
  return 1 + Object.values(value).reduce((sum, each) => sum + objectCount(each), 0);
}

// players whose last page of characters went over the limit, so their next ones go straight to halves
// instead of trying 40 first. halves that would have fit as one let them try 40 again. pages near each
// other are alike, and a page asked for as halves costs 2 requests against 3 for one that goes over
const denseCharacters = new Map();
const OBJECT_LIMIT = 1000;

// for /characters and /scout. every game they reported a character for, newest set first, 40 sets a page.
// the limit counts what comes back, and a bo5 with characters and stages is ~51 objects. most sets have
// nothing reported so 40 usually fit. pages that go over split into 20, then 10 if needed
export async function getCharacterSets(playerId, page, perPage = 40) {
  let halved = false;
  const data = await query(CHARACTER_QUERY, () => {
    halved = perPage === 40 && Boolean(denseCharacters.get(playerId));
    return halved ? { id: playerId, page: page * 2 - 1, perPage: 20 } : { id: playerId, page, perPage };
  }).catch((err) => {
    if (perPage <= 10 || !err.message.includes('complexity')) throw err;
  });
  if (halved) {
    const first = data ? characterPage(data, playerId) : await splitCharacterPage(playerId, page * 2 - 1, 20);
    const second = await getCharacterSets(playerId, page * 2, 20);
    denseCharacters.set(playerId, first.objects + second.objects > OBJECT_LIMIT);
    return { totalPages: Math.ceil(first.totalPages / 2), sets: [...first.sets, ...second.sets] };
  }
  if (!data) {
    if (perPage === 40) denseCharacters.set(playerId, true);
    return splitCharacterPage(playerId, page, perPage);
  }
  if (perPage === 40) denseCharacters.set(playerId, false);
  return characterPage(data, playerId);
}

async function splitCharacterPage(playerId, page, perPage) {
  const halves = await Promise.all([getCharacterSets(playerId, page * 2 - 1, perPage / 2), getCharacterSets(playerId, page * 2, perPage / 2)]);
  return {
    totalPages: Math.ceil(halves[0].totalPages / 2),
    sets: halves.flatMap((half) => half.sets),
    objects: halves.reduce((sum, half) => sum + half.objects, 0),
  };
}

// { totalPages, sets, objects } out of one reply
function characterPage(data, playerId) {
  const connection = data.player?.sets;
  // no event means it got deleted, so there's no game to put it under
  const sets = (connection?.nodes ?? []).filter((node) => node.event?.videogame).map((node) => {
    const mine = node.slots?.find((slot) => slot.entrant?.participants?.some((participant) => participant.player?.id === playerId))?.entrant.id;
    const games = [];
    for (const game of node.games ?? []) {
      const picks = game.selections ?? [];
      const character = picks.find((pick) => pick.entrant?.id === mine)?.character?.name;
      const against = picks.find((pick) => pick.entrant?.id !== mine)?.character?.name;
      if (character && game.winnerId) games.push({ character, against, stage: game.stage?.name, won: game.winnerId === mine });
    }
    return { id: String(node.id), completedAt: node.completedAt, videogame: namedGame(node.event).videogame, games };
  });
  return { totalPages: connection?.pageInfo?.totalPages ?? 0, sets, objects: objectCount(data) };
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
    // the queue is what the overlay shows. a set's own stream can be missing, or left on the stream it was moved off
    const sets = (queue.sets ?? []).map(toSet).filter(Boolean).map((set) => ({ ...set, stream: queue.stream ?? set.stream }));
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

// each set's state by id, so a post's Head to head button can come off once its set is over and a match call
// can be followed up.
// a set is a couple of objects, so 50 to a request stays far under the complexity limit. a deleted set is null
export async function getSetStates(setIds) {
  const data = await lookupMany(setIds, (group) => `
    query {
      ${group.map((id) => `s${cleanId(id)}: set(id: ${cleanId(id)}) { state }`).join('\n')}
    }
  `, {}, 50);
  return new Map(setIds.map((id) => [id, data[`s${id}`]?.state ?? null]));
}

// for set results a TO might fix: each set's state and outcomeOf by id, null once it's deleted. about 9
// objects a set, so 50 to a request. the whole set only gets asked for when one changed, with getSetsById
export async function getSetOutcomes(setIds) {
  const data = await lookupMany(setIds, (group) => `
    query {
      ${group.map((id) => `s${cleanId(id)}: set(id: ${cleanId(id)}) { state winnerId slots { standing { stats { score { value } } } } }`).join('\n')}
    }
  `, {}, 50);
  return new Map(setIds.map((id) => {
    const set = data[`s${id}`];
    if (!set) return [id, null];
    const sides = (set.slots ?? []).map((slot) => ({ score: slot.standing?.stats?.score?.value ?? null }));
    return [id, { state: set.state, outcome: outcomeOf({ winnerId: set.winnerId, sides }) }];
  }));
}

// whole sets by id, to post again after a TO fixed one. a set with its games is about 55 objects, so 10 to a request
export async function getSetsById(setIds) {
  const data = await lookupMany(setIds, (group) => `
    query {
      ${group.map((id) => `s${cleanId(id)}: set(id: ${cleanId(id)}) { ${SET_FIELDS} }`).join('\n')}
    }
  `, {}, 10);
  return new Map(setIds.map((id) => [id, data[`s${id}`] ? toSet(data[`s${id}`]) : null]));
}

// called sets for match call pings. last hour only, since a set stays called until it starts
export async function getCalledSets(playerIds) {
  const since = Math.floor(Date.now() / 1000) - 60 * 60;
  return getSets(playerIds, { since, perPage: 3, states: [6] });
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
