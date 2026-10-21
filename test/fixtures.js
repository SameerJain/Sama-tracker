// shared pure-data fixtures for the features-*.test.js split.
// no src imports here: data and pure functions only.
const crewPlayer = { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' };
// a tournament tracked by hand with everything on, the way /t-o tournament add leaves it
const tracked = { by: 'manual', at: 0, sets: true, stream: true, top8: true, reminders: true };
const event = { name: 'Singles', slug: 'tournament/local/event/singles', startAt: 150, numEntrants: 32,
  videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'Local' } };
const node = (id, completedAt, playerId = 10, dq = false) => ({
  id, completedAt, winnerId: playerId, fullRoundText: 'Winners round 1', event,
  slots: [playerId, 99].map((id, i) => ({
    entrant: { id, name: i ? 'Opponent' : 'Active', initialSeedNum: i ? 2 : 9, participants: [{ player: { id } }] },
    standing: { stats: { score: { value: dq && !i ? -1 : i ? 1 : 2 } } },
  })),
});
// a set already parsed, from the first player's side. sides use player ids as entrant ids
const result = (id, at, [meId, meName, mySeed], [themId, themName, theirSeed], won, [mine, theirs], round = 'Winners round 1') => ({
  id, completedAt: at, winnerId: won ? meId : themId, round,
  event: { slug: `tournament/t-${id}/event/singles`, videogame: { displayName: 'Ultimate' }, tournament: { name: `T-${id}` } },
  sides: [{ id: meId, name: meName, playerIds: [meId], score: mine, seed: mySeed }, { id: themId, name: themName, playerIds: [themId], score: theirs, seed: theirSeed }],
});

// newest first, 30 days each like /progress
const DAY = 86400;
// periodSummary comes from src/reports.js, so callers pass it in to keep this file import-free
const periodsFor = (periodSummary, player, sets, events, until, length = 2) => Array.from({ length }, (_, i) => {
  const period = { since: until - (i + 1) * 30 * DAY, until: until - i * 30 * DAY };
  return { ...period, summary: periodSummary(player, sets, events, period.since, period.until) };
});

const runPlayer = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew' };
const runTournament = { name: 'Local', slug: 'tournament/local' };
// a run in one event: entry like getTournament's, sets like getRunSets'. Crew is entrant 1
const runIn = (event, { started = true, sets = [], ...entry } = {}) => {
  const eventSlug = `tournament/local/event/${event.toLowerCase().replaceAll(' ', '-')}`;
  return {
    entry: { event, eventSlug, entrants: 32, started, final: false, done: false, ...entry },
    sets: sets.map(([id, setState, opponent, round, won]) => ({
      id, state: setState, round, completedAt: setState === 3 ? Number(id) : null, winnerId: setState === 3 ? (won ? 1 : 2) : null,
      event: { slug: eventSlug },
      sides: [{ id: 1, name: 'Crew', playerIds: [10], score: setState === 3 ? (won ? 2 : 0) : null }, { id: 2, name: opponent, playerIds: [20], score: setState === 3 ? (won ? 1 : 2) : null }],
    })),
  };
};
const descriptions = cards => cards.map(e => e.data.description).join('\n');

// the recap's first look: which of the players asked about finished a set that week
const playedThisWeek = (query, playerIds) => Object.fromEntries([...query.matchAll(/p(\d+): player/g)]
  .map(([, id]) => [`p${id}`, { sets: { nodes: playerIds.includes(Number(id)) ? [{ id: 1 }] : [] } }]));

export { crewPlayer, tracked, event, node, result, DAY, periodsFor, runPlayer, runTournament, runIn, descriptions, playedThisWeek };
