// everything start.gg in one import. the lookups live in src/startgg/ by area, and every request goes through
// the queue in queue.js
export {
  ULTIMATE, MELEE, startggUrl, setRequestGap, asCommand, inBackground, isBackground, queueLength, commandProgress, forgetMisses,
  checkToken, badToken, startggDownSince, resetOutage,
} from './startgg/queue.js';
export {
  outcomeOf, namedGame, fromSide, singles, isMelee,
  getSets, getActivePlayers, getSetHistory, getHeadToHead, getDoublesHistory, getDoublesEvents, getPeriodHistory, getRunSets,
  getEventSets, getEventHistory, getStats, getCharacterSets, getStreamQueues, getStreamedSets, getSetStates, getSetOutcomes,
  getSetsById, getCalledSets, getCalledEventSets,
} from './startgg/sets.js';
export { getPlayerById, getPlayer, getProfiles, getConnectCodes } from './startgg/players.js';
export {
  getTournamentStreams, getUpcomingTournaments, getTournament, getTopEight, getRegistration, getRegistrationById, getParticipants,
  attendeesHidden,
} from './startgg/tournaments.js';
export { getCharacterArt, isStartggImage, getImage } from './startgg/media.js';
