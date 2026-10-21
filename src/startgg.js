// facade over src/startgg/, same exports as before. each area lives in its own
// module, all sharing the queue in queue.js, so importers keep working unchanged
export {
  ULTIMATE,
  MELEE,
  startggUrl,
  setRequestGap,
  asCommand,
  inBackground,
  isBackground,
  queueLength,
  commandProgress,
  forgetMisses,
  checkToken,
  badToken,
} from './startgg/queue.js';
export {
  outcomeOf,
  namedGame,
  fromSide,
  singles,
  isMelee,
  getSets,
  getActivePlayers,
  getSetHistory,
  getHeadToHead,
  getDoublesHistory,
  getDoublesEvents,
  getPeriodHistory,
  getRunSets,
  getEventSets,
  getEventHistory,
  getStats,
  getCharacterSets,
  getStreamQueues,
  getStreamedSets,
  getSetStates,
  getSetOutcomes,
  getSetsById,
  getCalledSets,
} from './startgg/sets.js';
export {
  getPlayerById,
  getPlayer,
  getProfiles,
  getConnectCodes,
} from './startgg/players.js';
export {
  getTournamentStreams,
  getUpcomingTournaments,
  getTournament,
  getTopEight,
  getRegistration,
  getRegistrationById,
  getParticipants,
  attendeesHidden,
} from './startgg/tournaments.js';
export {
  getCharacterArt,
  isStartggImage,
  getImage,
} from './startgg/media.js';
