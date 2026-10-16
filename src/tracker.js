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
// tournaments over a day out barely change, so they get looked at less
const FAR_OFF_CHECK_HOURS = 6;
// discord allows 100 mentions a message, and 2000 chars fits about 80
const MENTIONS_PER_MESSAGE = 80;
// hours before registration closes. the last one is the last call
export const REG_REMINDER_HOURS = [7 * 24, 3 * 24, 24, 12];

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export function secondsNow() {
  return Math.floor(Date.now() / 1000);
}

// for /df status
export const health = { startedAt: secondsNow(), downSince: null, skippedBefore: null, setCheck: null, setError: null, tournamentCheck: null };

let channel;

export function startTracking(postChannel) {
  channel = postChannel;

  // lastCheck only moves while it's running, so the oldest one is when it went down.
  // Infinity with nobody tracked
  const now = secondsNow();
  const lastCheck = Math.min(...Object.values(state.players).map((player) => player.lastCheck));
  if (lastCheck < now - 2 * SET_CHECK_MINUTES * 60) {
    health.downSince = lastCheck;
    if (lastCheck < now - CATCH_UP_HOURS * HOUR) health.skippedBefore = now - CATCH_UP_HOURS * HOUR;
  }
  // saved from before userIds existed
  for (const tournament of Object.values(state.tournaments)) {
    tournament.userIds ??= [...new Set(tournament.entries.map((entry) => entry.userId))];
  }

  checkTournaments();
  checkSets();
  checkProfiles();
  checkRegReminders();
  setInterval(checkTournaments, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkRegReminders, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkSets, SET_CHECK_MINUTES * 60 * 1000);
  setInterval(checkProfiles, PROFILE_CHECK_HOURS * HOUR * 1000);
}

// one run at a time so nothing posts twice. if a run is already waiting, extra calls
// get dropped since it'll see the latest players anyway. background even when a
// command kicks it off, so it doesn't cut in front of other commands
function queued(check) {
  let last = Promise.resolve();
  let waiting = false;
  return () => {
    if (waiting) return;
    waiting = true;
    last = last.then(() => {
      waiting = false;
      return startgg.inBackground(check);
    }).catch(console.error);
  };
}

// fewest messages that fit discord's limits
async function post(list) {
  for (const batch of embeds.messages(list)) await channel.send({ embeds: batch });
}

const checkSets = queued(async () => {
  await postNewSets();
  await postStreamAlerts();
});
export const checkTournaments = queued(updateTournaments);
const checkProfiles = queued(updateProfiles);
export const checkRegReminders = queued(postRegReminders);

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
      // for /df recent all
      for (const player of players) {
        if (!set.sides.some((side) => side.playerIds.includes(player.playerId))) continue;
        // edits bring back old sets
        player.lastSetAt = Math.max(player.lastSetAt ?? 0, set.completedAt);
      }
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
    health.setCheck = checkedAt;
    health.setError = null;
  } catch (err) {
    console.error('checking sets failed:', err.message);
    health.setError = err.message;
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
  const tracked = Object.values(state.players).map((player) => player.userId);

  try {
    for (const [userId, tournaments] of await startgg.getUpcomingTournaments(tracked)) {
      for (const found of tournaments) {
        // bad end dates make old tournaments show up as upcoming
        if (secondsNow() > endTime(found)) continue;
        const tournament = state.tournaments[found.id] ??= { ...found, entries: [], userIds: [] };
        // someone new signed up, so it gets looked at now even if it's far off
        if (!tournament.userIds.includes(userId)) {
          tournament.userIds.push(userId);
          tournament.checkedAt = 0;
        }
      }
    }
  } catch (err) {
    console.error('finding tournaments failed:', err.message);
  }

  for (const tournament of Object.values(state.tournaments)) {
    if (tournament.resultsPosted) {
      // keep it a week, otherwise it gets re-added and the results post again
      if (secondsNow() > endTime(tournament) + 7 * DAY) delete state.tournaments[tournament.id];
      continue;
    }
    const farOff = tournament.startAt - secondsNow() > DAY;
    if (farOff && secondsNow() - (tournament.checkedAt ?? 0) < FAR_OFF_CHECK_HOURS * HOUR) continue;

    try {
      // only the people who signed up. everyone at every tournament gets slow with a big crew
      const userIds = tournament.userIds.filter((id) => state.players[id]);
      const latest = await startgg.getTournament(tournament.id, userIds);
      // deleted or unpublished
      if (!latest) {
        delete state.tournaments[tournament.id];
        continue;
      }
      Object.assign(tournament, latest, { checkedAt: secondsNow() });
      await postRollCall(tournament);
      await postResults(tournament);
    } catch (err) {
      console.error(`updating ${tournament.name ?? tournament.id} failed:`, err.message);
    }
  }

  health.tournamentCheck = secondsNow();
  save();
}

async function postRollCall(tournament) {
  if (tournament.rollCallPosted) return;

  const secondsUntilStart = tournament.startAt - secondsNow();
  if (secondsUntilStart <= 0 || secondsUntilStart > ROLL_CALL_HOURS_BEFORE * HOUR) return;

  // people, not entries. a late sign-up can still trigger it
  const entered = new Set(tournament.entries.map((entry) => entry.userId));
  if (entered.size < ROLL_CALL_MIN_PLAYERS) return;

  await post(embeds.rollCall(tournament, state.players));
  tournament.rollCallPosted = true;
}

async function postResults(tournament) {
  if (secondsNow() < tournament.startAt) return;

  const allDone = tournament.entries.every((entry) => entry.done);
  const gaveUp = secondsNow() > endTime(tournament) + RESULTS_GIVE_UP_HOURS * HOUR;
  if (!allDone && !gaveUp) return;

  await post(embeds.results(tournament, state.players));
  tournament.resultsPosted = true;
}

export function endTime(tournament) {
  return Math.min(tournament.endAt ?? tournament.startAt, tournament.startAt + MAX_TOURNAMENT_DAYS * DAY);
}

// lots of weeklies leave registration open after the start, but you still have to sign up before it
export function regDeadline(tournament) {
  return Math.min(tournament.registrationClosesAt ?? tournament.startAt, tournament.startAt);
}

// index of the first reminder still to come. ones already past get skipped,
// except the last call, so setting it late sends that right away
export function nextRegReminder(deadline) {
  const next = REG_REMINDER_HOURS.findIndex((hours) => secondsNow() < deadline - hours * HOUR);
  return next === -1 ? REG_REMINDER_HOURS.length - 1 : next;
}

async function postRegReminders() {
  for (const reminder of Object.values(state.regReminders)) {
    try {
      // TOs move the close time, so always go off the latest
      const tournament = await startgg.getRegistration(reminder.slug);
      const deadline = tournament && regDeadline(tournament);
      // deleted, or it closed while the bot was down
      if (!tournament || deadline <= secondsNow()) {
        delete state.regReminders[reminder.id];
        continue;
      }
      reminder.deadline = deadline;
      // set back when there was only the last call
      reminder.next ??= nextRegReminder(deadline);

      // only the latest one if the bot was down through a few
      const due = REG_REMINDER_HOURS.findLastIndex((hours, i) => i >= reminder.next && secondsNow() >= deadline - hours * HOUR);
      if (due === -1) continue;
      const lastCall = due === REG_REMINDER_HOURS.length - 1;

      // not open means it filled up, or for the early ones that it hasn't opened yet
      if (tournament.isRegistrationOpen) {
        // people one by one, a role ping would hit the ones already registered
        const registered = await startgg.getRegisteredDiscordIds(tournament.id);
        const ping = state.regPings.filter((id) => !registered.has(id));
        // the embed goes with the first batch of pings, or alone if there's nobody to ping
        for (let i = 0; i === 0 || i < ping.length; i += MENTIONS_PER_MESSAGE) {
          const users = ping.slice(i, i + MENTIONS_PER_MESSAGE);
          await channel.send({
            content: users.length ? `${users.map((id) => `<@${id}>`).join(' ')} ${lastCall ? 'last call' : 'registration reminder'}` : undefined,
            embeds: i === 0 ? [embeds.regReminder(tournament, deadline, lastCall)] : [],
            allowedMentions: { users },
          });
        }
      }
      if (lastCall) delete state.regReminders[reminder.id];
      else reminder.next = due + 1;
    } catch (err) {
      console.error(`reg reminder for ${reminder.name} failed:`, err.message);
    }
  }
  save();
}
