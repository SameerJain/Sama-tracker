import { MELEE, ULTIMATE, aliases, allPages, cleanId, connectionPage, fitPage, isSharing, lookupMany, pagesOf, query } from './queue.js';

// servers sharing a check pass ask for sets updated since a time rounded down to this, so two servers whose last
// checks were seconds apart send the same request and share its answer
const SHARED_SINCE_STEP = 5 * 60;

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

// for sets that haven't been played: no games, VOD or scores, so they stay small. round is the number,
// negative in losers, and the tournament's times tell a live one from an abandoned one
const UNPLAYED_FIELDS = `
  id
  state
  round
  fullRoundText
  startAt
  stream { streamName streamSource }
  station { number }
  phaseGroup { id }
  event {
    id
    name
    slug
    videogame { id displayName }
    tournament { name slug isOnline images(type: "profile") { url } startAt endAt }
  }
  slots {
    entrant { id name initialSeedNum participants { player { id } } }
  }
`;

export const UNPLAYED_STATES = [1, 4, 6, 7];

const lastHour = () => Math.floor(Date.now() / 1000) - 60 * 60;

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
    roundNumber: node.round ?? null,
    groupId: node.phaseGroup?.id ?? null,
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

const toSets = (nodes) => nodes.map(toSet).filter(Boolean);

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
      ${aliases(group, 'p', 'player', `sets(perPage: $perPage, page: 1, filters: $filters) { nodes { ${SET_FIELDS} } }`)}
    }
  `, { perPage, filters: { state: states, updatedAfter: since } });

  // two tracked players can be in the same set
  const setsById = new Map();
  for (const player of Object.values(data)) {
    for (const set of toSets(player?.sets?.nodes ?? [])) setsById.set(set.id, set);
  }
  return [...setsById.values()];
}

// the ones with a finished singles set updated since then. a set finished then was updated then too, so
// nobody who played gets missed. one id each, so 50 players fit in a request
export async function getActivePlayers(playerIds, since) {
  const data = await lookupMany(playerIds, (group) => `
    query ($filters: SetFilters) {
      ${aliases(group, 'p', 'player', 'sets(perPage: 1, page: 1, filters: $filters) { nodes { id } }')}
    }
  `, { filters: { state: [3], entrantSize: [1], updatedAfter: since - 1 } }, 50);
  return new Set(playerIds.filter((id) => data[`p${id}`]?.sets?.nodes?.length));
}

const HISTORY_QUERY = `
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
`;

// for history/predict and opponent-filtered h2h. no games or characters, so 40 sets come to about 960
// objects. adding numEntrants put a page at 1003, so bracket sizes come from getEventHistory.
// opponent lookups can include teams, so 30 leaves room for their extra participants. a top player's
// page can still go over, which fitPage splits
// pages can come back short or empty in the middle, so totalPages is the only way to know it's the end
export async function getSetHistory(playerId, page, { opponentId, ...filters } = {}) {
  // start.gg rejects entrantSize with opponentId, so getHeadToHead checks for singles itself
  const setFilters = opponentId ? { state: [3], ...filters } : { state: [3], entrantSize: [1], ...filters };
  const getPage = pagesOf(HISTORY_QUERY, { id: playerId, opponentId, filters: setFilters }, (data) => data.player?.sets);
  const { totalPages, nodes } = await fitPage(getPage, page, opponentId ? 30 : 40);
  return { totalPages, sets: toSets(nodes) };
}

// every singles meeting, newest first, DQs left out. usually one opponent-filtered page is enough
export async function getHeadToHead(playerId, opponentId) {
  const pages = await allPages((page) => getSetHistory(playerId, page, { opponentId }));
  const sets = pages.flatMap((page) => page.sets).filter((set) => set.sides.every((side) => side.playerIds.length === 1));
  const played = singles(sets, { playerId }).filter(({ them }) => them.playerIds.includes(opponentId));
  return [...new Map(played.map(({ set }) => [set.id, set])).values()].sort((a, b) => b.completedAt - a.completedAt);
}

const DOUBLES_QUERY = `
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
`;

// for /doubles, 2v2 sets only. a team's slot has 2 more participant objects than singles, the same
// room opponent lookups leave for teams, so 30 a page. gamerTag isn't an object, so naming partners
// costs nothing. event id is for getDoublesEvents
export async function getDoublesHistory(playerId, page) {
  const { totalPages, nodes } = await fitPage(pagesOf(DOUBLES_QUERY, { id: playerId }, (data) => data.player?.sets), page, 30);
  return { totalPages, sets: toSets(nodes) };
}

// Map of event id to { placement, seed, dq, event, partners } for the doubles events their sets came
// from. a set doesn't say where the team finished, and user.events has no documented doubles filter,
// so each event gets looked up with their entrant. ~9 objects an event, so 40 a request
export async function getDoublesEvents(player, eventIds) {
  const entrant = `userEntrant(userId: ${cleanId(player.userId)}) { initialSeedNum isDisqualified standing { placement } participants { player { id gamerTag } } }`;
  const data = await lookupMany(eventIds, (group) => `{
    ${aliases(group, 'e', 'event', `id name slug startAt numEntrants state videogame { id displayName } tournament { name } ${entrant}`)}
  }`, undefined, 40);

  const events = new Map();
  for (const id of eventIds) {
    const { userEntrant, state, ...event } = data[`e${id}`] ?? {};
    const placement = userEntrant?.standing?.placement;
    // placement lines link the tournament
    if (state !== 'COMPLETED' || !placement || !event.tournament) continue;
    const partners = (userEntrant.participants ?? []).map((participant) => participant.player)
      .filter((each) => each && String(each.id) !== String(player.playerId))
      .map((each) => ({ id: each.id, tag: each.gamerTag }));
    events.set(id, { placement, seed: userEntrant.initialSeedNum, dq: userEntrant.isDisqualified, event: namedGame(event), partners });
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

const RUN_QUERY = `
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
`;

// a set is about 16 objects, 17 with its station, so 30 a page comes to about 510.
// the event's game rides along so the run's head-to-head button filters to it
export async function getRunSets(eventId, playerId) {
  const getPage = pagesOf(RUN_QUERY, { id: eventId, player: playerId }, (data) => data.event?.sets);
  const pages = await allPages((page) => fitPage(getPage, page, 30));
  return toSets(pages.flatMap((page) => page.nodes));
}

// a set with its games is about 55 objects, so 10 an event a page comes to about 550
const EVENT_SETS_PER_PAGE = 10;

const eventSetsQuery = (fields) => `
  query ($id: ID!, $page: Int!, $perPage: Int!, $filters: SetFilters) {
    event(id: $id) {
      sets(page: $page, perPage: $perPage, sortType: RECENT, filters: $filters) {
        pageInfo { totalPages }
        nodes { ${fields} }
      }
    }
  }
`;

// every set in these events matching filters, whoever played. most checks find a few sets or none, so the
// events share a request that splits when it runs over, and an event with more than a page gets the rest on its own
async function setsInEvents(eventIds, filters, { fields = SET_FIELDS, perPage = EVENT_SETS_PER_PAGE } = {}) {
  // the sets between the rounded time and the real one come back off below, so nobody gets more than they asked for
  const { updatedAfter } = filters;
  const rounded = updatedAfter && isSharing();
  const asked = rounded ? { ...filters, updatedAfter: updatedAfter - (updatedAfter % SHARED_SINCE_STEP) } : filters;
  const data = await lookupMany(eventIds, (group) => `
    query ($filters: SetFilters) {
      ${aliases(group, 'e', 'event', `sets(perPage: ${perPage}, page: 1, sortType: RECENT, filters: $filters) { pageInfo { totalPages } nodes { ${fields} } }`)}
    }
  `, { filters: asked });

  const nodes = [];
  const rest = [];
  for (const id of eventIds) {
    const sets = data[`e${id}`]?.sets;
    nodes.push(...(sets?.nodes ?? []));
    const getPage = pagesOf(eventSetsQuery(fields), { id: cleanId(id), filters: asked }, (reply) => reply.event?.sets);
    for (let page = 2; page <= (sets?.pageInfo?.totalPages ?? 0); page++) rest.push(fitPage(getPage, page, perPage));
  }
  for (const page of await Promise.all(rest)) nodes.push(...page.nodes);
  const found = toSets(nodes);
  return rounded ? found.filter((set) => set.updatedAt == null || set.updatedAt >= updatedAfter) : found;
}

// every set finished in these events since then, for a tracked tournament's set results
export function getEventSets(eventIds, since) {
  return setsInEvents(eventIds, { state: [3], updatedAfter: since, showByes: false });
}

// every called set in these events, for a tracked tournament with match calls on. last hour only, like getCalledSets
export function getCalledEventSets(eventIds) {
  return setsInEvents(eventIds, { state: [6], updatedAfter: lastHour(), showByes: false });
}

// every unplayed set in these events, to find who is waiting on whom. an unplayed set is about 15 objects,
// so 40 a page comes to about 600
export function getUnplayedEventSets(eventIds) {
  return setsInEvents(eventIds, { state: UNPLAYED_STATES, showByes: false }, { fields: UNPLAYED_FIELDS, perPage: 40 });
}

const NEXT_SETS_PER_PLAYER = 4;

// each player's next sets, for next opponent cards, and more: the players whose page came back full, who can have
// sets it left out. 4 a player at about 16 objects is 65 with the page, so 15 players to a request stays under 1000
// even when every page is full, which abandoned brackets can do for good. no time filter: old abandoned sets come
// back too, and the caller drops those by their tournament's dates
export async function getNextSets(playerIds) {
  const data = await lookupMany(playerIds, (group) => `
    query ($filters: SetFilters) {
      ${aliases(group, 'p', 'player', `sets(perPage: ${NEXT_SETS_PER_PLAYER}, page: 1, filters: $filters) { nodes { ${UNPLAYED_FIELDS} } }`)}
    }
  `, { filters: { state: UNPLAYED_STATES } }, 15);

  // two players can be in the same set
  const setsById = new Map();
  const more = new Set();
  for (const id of playerIds) {
    const nodes = data[`p${cleanId(id)}`]?.sets?.nodes ?? [];
    if (nodes.length >= NEXT_SETS_PER_PLAYER) more.add(id);
    for (const set of toSets(nodes)) setsById.set(set.id, set);
  }
  return { sets: [...setsById.values()], more };
}

// every unplayed set each player has in one event, as [{ eventId, playerId }], for a player whose getNextSets page
// came back full. a pool is far under 40 sets, so one page each. a pool of 8 leaves 7 sets each, about 115 objects,
// so 8 to a request stays under the limit, and a bigger pool splits
export async function getPlayerUnplayedSets(pairs) {
  const keys = pairs.map(({ eventId, playerId }) => `${cleanId(eventId)}_${cleanId(playerId)}`);
  const data = await lookupMany(keys, (group) => `
    query ($state: [Int]) {
      ${group.map((key) => {
        const [eventId, playerId] = key.split('_');
        return `e${key}: event(id: ${eventId}) { sets(perPage: 40, page: 1, filters: { state: $state, showByes: false, playerIds: [${playerId}] }) { nodes { ${UNPLAYED_FIELDS} } } }`;
      }).join('\n')}
    }
  `, { state: UNPLAYED_STATES }, 8);
  return toSets(Object.values(data).flatMap((event) => event?.sets?.nodes ?? []));
}

const EVENT_HISTORY_QUERY = `
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
`;

// every finished singles event they entered, newest first. an event is ~7 objects, so 120 a page
export async function getEventHistory(userId) {
  const getPage = pagesOf(EVENT_HISTORY_QUERY, { id: userId }, (data) => data.user?.events);
  const pages = await allPages((page) => fitPage(getPage, page, 120));

  const events = [];
  for (const { userEntrant: entrant, state, ...event } of pages.flatMap((page) => page.nodes)) {
    const placement = entrant?.standing?.placement;
    // placement lines link the tournament
    if (state !== 'COMPLETED' || !placement || !event.tournament) continue;
    events.push({ placement, seed: entrant.initialSeedNum, dq: entrant.isDisqualified, event: namedGame(event) });
  }
  return events.sort((a, b) => b.event.startAt - a.event.startAt);
}

const STATS_QUERY = `
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
`;

// 30 sets keeps this under the object limit. since is unix seconds, venue offline or online,
// and the window fills from further pages the way a game filter does. a page that goes over gets split
// by fitPage, and its first part still has the standings because it's still page 1
export async function getStats(playerId, { videogameId, since, venue } = {}) {
  const inScope = (set) => (!videogameId || set.event.videogame?.id === videogameId)
    && (!since || (set.completedAt ?? 0) >= since)
    && (!venue || (set.event.tournament?.isOnline ?? null) === (venue === 'online'));
  const getPage = (page) => fitPage(async (page, perPage) => {
    const { player } = await query(STATS_QUERY, { id: playerId, videogameId, page, perPage, standings: page === 1 });
    return { ...connectionPage(player?.sets), standings: player?.recentStandings };
  }, page, 30);

  const first = await getPage(1);
  // start.gg filters standings by the game the TO tagged, so one named for the other game comes out here
  const standings = (first.standings ?? [])
    .filter((standing) => standing.isFinal && standing.placement && standing.entrant?.event)
    .map(({ placement, entrant }) => ({ placement, seed: entrant.initialSeedNum, dq: entrant.isDisqualified, event: namedGame(entrant.event) }))
    .filter(({ event }) => !videogameId || event.videogame?.id === videogameId);
  const sets = toSets(first.nodes);
  if (!videogameId && !since && !venue) return { standings, sets };

  // Player.sets has no filter for these, so keep reading until the recent window is full for them
  const matching = sets.filter(inScope);
  for (let page = 2; page <= first.totalPages && matching.length < 30; page++) {
    const next = await getPage(page);
    matching.push(...toSets(next.nodes).filter(inScope));
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
// in-memory only, so just keep the recent ones
const DENSE_KEPT = 500;
function noteDense(playerId, dense) {
  denseCharacters.delete(playerId);
  denseCharacters.set(playerId, dense);
  for (const old of [...denseCharacters.keys()].slice(0, -DENSE_KEPT)) denseCharacters.delete(old);
}

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
    noteDense(playerId, first.objects + second.objects > OBJECT_LIMIT);
    return { totalPages: Math.ceil(first.totalPages / 2), sets: [...first.sets, ...second.sets] };
  }
  if (!data) {
    if (perPage === 40) noteDense(playerId, true);
    return splitCharacterPage(playerId, page, perPage);
  }
  if (perPage === 40) noteDense(playerId, false);
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

  // the queue is what the overlay shows. a set's own stream can be missing, or left on the stream it was moved off
  return (data.tournament?.streamQueue ?? []).map((queue) => ({
    stream: queue.stream,
    sets: toSets(queue.sets ?? []).map((set) => ({ ...set, stream: queue.stream ?? set.stream })),
  }));
}

export async function getStreamedSets(playerIds) {
  // last hour only, old sets get left in progress forever
  const sets = await getSets(playerIds, { since: lastHour(), perPage: 3, states: [2, 6] });
  // some streams have no name to link to
  return sets.filter((set) => set.stream?.streamName);
}

// each set's state by id, so a post's Head to head button can come off once its set is over and a match call
// can be followed up. a set is a couple of objects, so 50 to a request stays far under the complexity limit.
// a deleted set is null
export async function getSetStates(setIds) {
  const data = await lookupMany(setIds, (group) => `query { ${aliases(group, 's', 'set', 'state')} }`, {}, 50);
  return new Map(setIds.map((id) => [id, data[`s${id}`]?.state ?? null]));
}

// for set results a TO might fix: each set's state and outcomeOf by id, null once it's deleted. about 9
// objects a set, so 50 to a request. the whole set only gets asked for when one changed, with getSetsById
export async function getSetOutcomes(setIds) {
  const data = await lookupMany(setIds, (group) => `
    query { ${aliases(group, 's', 'set', 'state winnerId slots { standing { stats { score { value } } } }')} }
  `, {}, 50);
  return new Map(setIds.map((id) => {
    const set = data[`s${id}`];
    if (!set) return [id, null];
    const sides = (set.slots ?? []).map((slot) => ({ score: slot.standing?.stats?.score?.value ?? null }));
    return [id, { state: set.state, outcome: outcomeOf({ winnerId: set.winnerId, sides }) }];
  }));
}

// who is in each set, as player ids by side in slot order, and its state. null once it's deleted. a set is
// about 8 objects, so 50 to a request
export async function getSetPairings(setIds) {
  const data = await lookupMany(setIds, (group) => `
    query { ${aliases(group, 's', 'set', 'state slots { entrant { participants { player { id } } } }')} }
  `, {}, 50);
  return new Map(setIds.map((id) => {
    const set = data[`s${id}`];
    if (!set) return [id, null];
    const playerIds = (set.slots ?? []).map((slot) => (slot.entrant?.participants ?? []).map((participant) => participant.player?.id));
    return [id, { state: set.state, playerIds }];
  }));
}

// whole sets by id, to post again after a TO fixed one. a set with its games is about 55 objects, so 10 to a request
export async function getSetsById(setIds) {
  const data = await lookupMany(setIds, (group) => `query { ${aliases(group, 's', 'set', SET_FIELDS)} }`, {}, 10);
  return new Map(setIds.map((id) => [id, data[`s${id}`] ? toSet(data[`s${id}`]) : null]));
}

// called sets for match call pings. last hour only, since a set stays called until it starts
export function getCalledSets(playerIds) {
  return getSets(playerIds, { since: lastHour(), perPage: 3, states: [6] });
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
