import * as startgg from './startgg.js';
import * as embeds from './embeds.js';
import { state, save } from './store.js';

const SET_CHECK_MINUTES = 2;
const TOURNAMENT_CHECK_MINUTES = 15;
const ROLL_CALL_HOURS_BEFORE = 1;
const ROLL_CALL_MIN_PLAYERS = 3;
// If start.gg never marks the events finished, post whatever placements exist this long after the end date.
const RESULTS_GIVE_UP_HOURS = 24;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export function secondsNow() {
  return Math.floor(Date.now() / 1000);
}

let channel;

// Each check waits for the previous one to finish, so nothing gets posted twice.
let setCheck = Promise.resolve();
let tournamentCheck = Promise.resolve();

export function startTracking(postChannel) {
  channel = postChannel;
  checkTournaments();
  checkSets();
  setInterval(checkTournaments, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkSets, SET_CHECK_MINUTES * 60 * 1000);
}

export function checkSets() {
  setCheck = setCheck.then(postNewSets).then(postStreamAlerts).catch(console.error);
}

export function checkTournaments() {
  tournamentCheck = tournamentCheck.then(updateTournaments).catch(console.error);
}

async function postNewSets() {
  for (const player of Object.values(state.players)) {
    const checkedAt = secondsNow();
    try {
      // Look back 2 extra minutes so a set reported during the last check isn't missed.
      const sets = await startgg.getSets(player.playerId, { since: player.lastCheck - 120 });
      sets.sort((a, b) => a.completedAt - b.completedAt);

      for (const set of sets) {
        if (state.posted.includes(set.id)) continue;
        // Old sets come back when someone edits them. Don't post those.
        if (set.completedAt < player.lastCheck - HOUR) continue;

        await channel.send({ embeds: [embeds.setResult(set, state.players)] });
        state.posted.push(set.id);
      }
      player.lastCheck = checkedAt;
    } catch (err) {
      console.error(`Checking sets for ${player.tag} failed:`, err.message);
    }
  }

  state.posted = state.posted.slice(-1000);
  save();
}

async function postStreamAlerts() {
  for (const player of Object.values(state.players)) {
    if (player.streamAlerts === false) continue;
    try {
      for (const set of await startgg.getStreamedSets(player.playerId)) {
        // Two tracked players can share a set. Post it once.
        if (state.streamed.includes(set.id)) continue;
        await channel.send({ embeds: [embeds.onStream(set, state.players)] });
        state.streamed.push(set.id);
      }
    } catch (err) {
      console.error(`Checking streams for ${player.tag} failed:`, err.message);
    }
  }

  state.streamed = state.streamed.slice(-200);
  save();
}

async function updateTournaments() {
  const userIds = Object.values(state.players).map((player) => player.userId);

  for (const userId of userIds) {
    try {
      for (const tournament of await startgg.getUpcomingTournaments(userId)) {
        if (!state.tournaments[tournament.id]) {
          state.tournaments[tournament.id] = { id: tournament.id, entries: [] };
        }
      }
    } catch (err) {
      console.error(`Finding tournaments for ${state.players[userId]?.tag} failed:`, err.message);
    }
  }

  for (const tournament of Object.values(state.tournaments)) {
    if (tournament.resultsPosted) {
      if (secondsNow() > endTime(tournament) + 7 * DAY) delete state.tournaments[tournament.id];
      continue;
    }

    try {
      const latest = await startgg.getTournament(tournament.id, userIds);
      if (!latest) {
        delete state.tournaments[tournament.id];
        continue;
      }
      Object.assign(tournament, latest);
      await postRollCall(tournament);
      await postResults(tournament);
    } catch (err) {
      console.error(`Updating tournament ${tournament.name ?? tournament.id} failed:`, err.message);
    }
  }

  save();
}

async function postRollCall(tournament) {
  if (tournament.rollCallPosted) return;

  const secondsUntilStart = tournament.startAt - secondsNow();
  if (secondsUntilStart <= 0 || secondsUntilStart > ROLL_CALL_HOURS_BEFORE * HOUR) return;

  // Someone in two events still counts once. Not marked as posted, so a late sign-up can still trigger it.
  const entered = new Set(tournament.entries.map((entry) => entry.userId));
  if (entered.size < ROLL_CALL_MIN_PLAYERS) return;

  await channel.send({ embeds: [embeds.rollCall(tournament, state.players)] });
  tournament.rollCallPosted = true;
}

async function postResults(tournament) {
  if (secondsNow() < tournament.startAt) return;

  const allDone = tournament.entries.every((entry) => entry.done);
  const gaveUp = secondsNow() > endTime(tournament) + RESULTS_GIVE_UP_HOURS * HOUR;
  if (!allDone && !gaveUp) return;

  // One message per event. Discord's 6000-character limit covers every embed in a message.
  for (const embed of embeds.results(tournament, state.players)) {
    await channel.send({ embeds: [embed] });
  }
  tournament.resultsPosted = true;
}

function endTime(tournament) {
  return tournament.endAt ?? tournament.startAt;
}
