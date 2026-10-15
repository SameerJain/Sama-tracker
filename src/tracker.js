import * as startgg from './startgg.js';
import * as embeds from './embeds.js';
import { state, save } from './store.js';

const SET_CHECK_MINUTES = 2;
const TOURNAMENT_CHECK_MINUTES = 15;
const PROFILE_CHECK_HOURS = 24;
const ROLL_CALL_HOURS_BEFORE = 1;
const ROLL_CALL_MIN_PLAYERS = 3;
// post results anyway this long after the end if start.gg never marks events done
const RESULTS_GIVE_UP_HOURS = 24;
// after downtime, don't post sets older than this
const CATCH_UP_HOURS = 3;
// some TOs set the end date years out by mistake
const MAX_TOURNAMENT_DAYS = 7;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export function secondsNow() {
  return Math.floor(Date.now() / 1000);
}

let channel;

export function startTracking(postChannel) {
  channel = postChannel;
  checkTournaments();
  checkSets();
  checkProfiles();
  setInterval(checkTournaments, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkSets, SET_CHECK_MINUTES * 60 * 1000);
  setInterval(checkProfiles, PROFILE_CHECK_HOURS * HOUR * 1000);
}

// one run at a time so nothing posts twice. if a run is already waiting, extra calls
// get dropped since it'll see the latest players anyway
function queued(check) {
  let last = Promise.resolve();
  let waiting = false;
  return () => {
    if (waiting) return;
    waiting = true;
    last = last.then(() => {
      waiting = false;
      return check();
    }).catch(console.error);
  };
}

const checkSets = queued(async () => {
  await postNewSets();
  await postStreamAlerts();
});
export const checkTournaments = queued(updateTournaments);
const checkProfiles = queued(updateProfiles);

// picks up tag and avatar changes
async function updateProfiles() {
  for (const player of Object.values(state.players)) {
    try {
      const latest = await startgg.getPlayer(player.slug);
      if (!latest) continue;
      player.tag = latest.tag;
      player.image = latest.image;
    } catch (err) {
      console.error(`refreshing ${player.tag} failed:`, err.message);
    }
  }
  save();
}

async function postNewSets() {
  const players = Object.values(state.players);
  const playerIds = players.map((player) => player.playerId);
  const checkedAt = secondsNow();
  // one request for everyone, so go from the oldest lastCheck
  const lastCheck = Math.min(checkedAt, ...players.map((player) => player.lastCheck));
  const since = Math.max(lastCheck, checkedAt - CATCH_UP_HOURS * HOUR);
  try {
    // 2 min overlap for sets reported during the last check
    const sets = await startgg.getSets(playerIds, { since: since - 120 });
    sets.sort((a, b) => a.completedAt - b.completedAt);

    for (const set of sets) {
      if (state.posted.includes(set.id)) continue;
      // editing an old set brings it back
      if (set.completedAt < since - HOUR) continue;
      // one DQ takes them out of the rest of the bracket, so only post the first.
      // DQ wins never get posted
      const dqed = set.sides.find((side) => side.score === -1);
      if (dqed && (!dqed.playerIds.some((id) => playerIds.includes(id)) || state.dqs.includes(dqed.id))) continue;

      await channel.send({ embeds: [embeds.setResult(set, state.players)] });
      state.posted.push(set.id);
      if (dqed) state.dqs.push(dqed.id);
    }
    // only on success so a failed check gets covered next time
    for (const player of players) player.lastCheck = checkedAt;
  } catch (err) {
    console.error('checking sets failed:', err.message);
  }

  state.posted = state.posted.slice(-1000);
  state.dqs = state.dqs.slice(-200);
  save();
}

async function postStreamAlerts() {
  try {
    const playerIds = Object.values(state.players).filter(alertsOn).map((player) => player.playerId);
    for (const set of await startgg.getStreamedSets(playerIds)) {
      if (state.streamed.includes(set.id)) continue;
      await channel.send({ embeds: [embeds.onStream(set, state.players)] });
      state.streamed.push(set.id);
    }
  } catch (err) {
    console.error('checking streams failed:', err.message);
  }

  // lots of TOs never hit "call", but they still use the stream queue for their overlay
  for (const tournament of liveTournaments()) {
    try {
      for (const queue of await startgg.getStreamQueues(tournament.id)) {
        for (const set of setsToAnnounce(queue.sets)) {
          if (state.streamed.includes(set.id) || !hasPlayerWithAlerts(set)) continue;
          await channel.send({ embeds: [embeds.onStream(set, state.players)] });
          state.streamed.push(set.id);
        }
      }
    } catch (err) {
      console.error(`checking stream queue at ${tournament.name} failed:`, err.message);
    }
  }

  state.streamed = state.streamed.slice(-200);
  save();
}

// queueSets is in queue order, front first
function setsToAnnounce(queueSets) {
  const unfinished = queueSets.filter((set) => set.state !== 3);
  // front of the queue counts even if it was never called
  const live = unfinished.filter((set, i) => i === 0 || set.state === 2 || set.state === 6);
  return live.filter((set) => set.stream?.streamName);
}

function liveTournaments() {
  const now = secondsNow();
  return Object.values(state.tournaments).filter((tournament) => {
    if (tournament.resultsPosted || now < tournament.startAt) return false;
    // locals run late
    if (now > endTime(tournament) + 6 * HOUR) return false;
    return tournament.entries.some((entry) => alertsOn(state.players[entry.userId]));
  });
}

function hasPlayerWithAlerts(set) {
  const players = Object.values(state.players).filter(alertsOn);
  return set.sides.some((side) => players.some((player) => side.playerIds.includes(player.playerId)));
}

function alertsOn(player) {
  return Boolean(player) && player.streamAlerts !== false;
}

async function updateTournaments() {
  const userIds = Object.values(state.players).map((player) => player.userId);

  for (const userId of userIds) {
    try {
      for (const tournament of await startgg.getUpcomingTournaments(userId)) {
        // bad end dates make old tournaments show up as upcoming
        if (secondsNow() > endTime(tournament)) continue;
        if (!state.tournaments[tournament.id]) {
          state.tournaments[tournament.id] = { id: tournament.id, entries: [] };
        }
      }
    } catch (err) {
      console.error(`finding tournaments for ${state.players[userId]?.tag} failed:`, err.message);
    }
  }

  for (const tournament of Object.values(state.tournaments)) {
    if (tournament.resultsPosted) {
      // keep it a week, otherwise it gets re-added and the results post again
      if (secondsNow() > endTime(tournament) + 7 * DAY) delete state.tournaments[tournament.id];
      continue;
    }

    try {
      const latest = await startgg.getTournament(tournament.id, userIds);
      // deleted or unpublished
      if (!latest) {
        delete state.tournaments[tournament.id];
        continue;
      }
      Object.assign(tournament, latest);
      await postRollCall(tournament);
      await postResults(tournament);
    } catch (err) {
      console.error(`updating ${tournament.name ?? tournament.id} failed:`, err.message);
    }
  }

  save();
}

async function postRollCall(tournament) {
  if (tournament.rollCallPosted) return;

  const secondsUntilStart = tournament.startAt - secondsNow();
  if (secondsUntilStart <= 0 || secondsUntilStart > ROLL_CALL_HOURS_BEFORE * HOUR) return;

  // people, not entries. a late sign-up can still trigger it
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

  // separate messages, discord's 6000 char limit is per message
  for (const embed of embeds.results(tournament, state.players)) {
    await channel.send({ embeds: [embed] });
  }
  tournament.resultsPosted = true;
}

export function endTime(tournament) {
  return Math.min(tournament.endAt ?? tournament.startAt, tournament.startAt + MAX_TOURNAMENT_DAYS * DAY);
}
