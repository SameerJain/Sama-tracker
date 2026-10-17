import * as startgg from './startgg.js';
import * as embeds from './embeds/index.js';
import { state, save } from './store.js';
import { periodSummary, weeklyPeriod } from './reports.js';
import { messageEnabled, messageSettings } from './message-settings.js';
import { rememberAccounts } from './accounts.js';

const SET_CHECK_MINUTES = 2;
const TOURNAMENT_CHECK_MINUTES = 15;
const PROFILE_CHECK_HOURS = 24;
const ROLL_CALL_HOURS_BEFORE = 1;
const ROLL_CALL_MIN_PLAYERS = 3;
// results wait this long after the end since TOs often report top 4 late
const RESULTS_WAIT_HOURS = 12;
// then this long if something's still missing, after that they go out with projected placements
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
// locals run late, so a tournament still counts as live this long after its end time
export const RUNS_LATE_HOURS = 6;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export function secondsNow() {
  return Math.floor(Date.now() / 1000);
}

// for /status
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
  checkWeeklyRecap();
  setInterval(checkTournaments, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkRegReminders, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkSets, SET_CHECK_MINUTES * 60 * 1000);
  setInterval(checkProfiles, PROFILE_CHECK_HOURS * HOUR * 1000);
  setInterval(checkWeeklyRecap, 60 * 1000);
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

// fewest messages that fit discord's limits. the switch gets checked before each one in case it's turned off partway
async function post(list, type, dueAt, postChannel = channel) {
  for (const batch of embeds.messages(list)) {
    if (messageEnabled(type, dueAt)) await postChannel.send({ embeds: batch });
  }
}

const checkSets = queued(async () => {
  await postNewSets();
  await postStreamAlerts();
});
export const checkTournaments = queued(updateTournaments);
const checkProfiles = queued(updateProfiles);
export const checkRegReminders = queued(postRegReminders);
const checkWeeklyRecap = queued(postWeeklyRecap);

export async function postWeeklyRecap(postChannel = channel, now = secondsNow()) {
  const period = weeklyPeriod(now, messageSettings());
  // turning it back on or changing the schedule waits for the next recap instead of sending an overdue one
  const canPost = () => messageEnabled('recap', period.until) && period.until > (messageSettings().recapChangedAt ?? 0);
  if (!period || !canPost() || (state.weeklyRecap?.until === period.until && state.weeklyRecap.done)) return;
  // built once and saved, so a restart partway through sends the rest instead of starting over
  if (state.weeklyRecap?.until !== period.until) {
    const crew = [];
    for (const player of Object.values(state.players)) {
      const sets = await startgg.getPeriodHistory(player.playerId, period.since, period.until);
      const summary = periodSummary(player, sets, [], period.since, period.until);
      // only people with a set that wasn't a DQ
      if (!summary.played.length) continue;
      // placements from events they played in this week, including ones that started the week before
      const events = await startgg.getEventHistory(player.userId);
      const playedEvents = new Set(summary.played.map(({ set }) => set.event.slug));
      summary.finishes = events.filter(({ event, dq }) => !dq && playedEvents.has(event.slug));
      // removed while this was running
      if (state.players[player.userId]) crew.push({ player, summary });
    }
    crew.sort((a, b) => a.player.tag.localeCompare(b.player.tag));
    if (!canPost()) return;

    const active = new Set(crew.map(({ player }) => player.userId));
    const upcoming = [];
    for (const tournament of Object.values(state.tournaments)) {
      if (tournament.startAt < now || tournament.startAt >= period.next) continue;
      const going = [...new Set(tournament.entries.map((entry) => entry.userId))].filter((id) => active.has(id));
      if (going.length) upcoming.push({ tournament, players: going.map((id) => state.players[id]) });
    }
    upcoming.sort((a, b) => a.tournament.startAt - b.tournament.startAt);
    const batches = crew.length ? embeds.messages(embeds.weeklyRecap(crew, upcoming, period)) : [];
    state.weeklyRecap = { until: period.until, sent: 0, done: false, batches: batches.map((batch) => batch.map((embed) => embed.toJSON())) };
    save();
  }
  for (let i = state.weeklyRecap.sent; i < state.weeklyRecap.batches.length; i++) {
    if (!canPost()) return;
    await postChannel.send({ embeds: state.weeklyRecap.batches[i] });
    state.weeklyRecap.sent = i + 1;
    save();
  }
  state.weeklyRecap.done = true;
  delete state.weeklyRecap.batches;
  save();
}

// picks up tag, avatar and connected discord changes for tracked and /link people, 20 a request
async function updateProfiles() {
  const records = [...Object.values(state.players), ...Object.values(state.links)];
  try {
    const latest = new Map(await startgg.getProfiles([...new Set(records.map((record) => String(record.userId)))]));
    for (const record of records) {
      const profile = latest.get(String(record.userId));
      if (!profile) continue;
      record.tag = profile.tag;
      record.image = profile.image;
      record.discordId = profile.discordId;
    }
  } catch (err) {
    console.error('refreshing profiles failed:', err.message);
  }
  save();
}

export async function postNewSets(postChannel = channel) {
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
      // for /recent all
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

      if (messageEnabled('sets', set.completedAt)) await postChannel.send({ embeds: [embeds.setResult(set, state.players)] });
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

export async function postStreamAlerts(postChannel = channel) {
  try {
    const playerIds = Object.values(state.players).filter(alertsOn).map((player) => player.playerId);
    for (const set of await startgg.getStreamedSets(playerIds)) {
      if (state.streamed.includes(set.id)) continue;
      if (messageEnabled('streams', wentLiveAt(set))) await postChannel.send({ embeds: [embeds.onStream(set, state.players)] });
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
          if (messageEnabled('streams', wentLiveAt(set))) await postChannel.send({ embeds: [embeds.onStream(set, state.players)] });
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

// a called or started set was last updated around when it went live. one only waiting
// at the front of a queue was last touched when it got queued, so it has no time to go by
function wentLiveAt(set) {
  return set.state === 1 ? undefined : set.updatedAt;
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
    // doneAt means every event they're in has finished
    if (tournament.resultsPosted || tournament.doneAt || now < tournament.startAt) return false;
    if (now > endTime(tournament) + RUNS_LATE_HOURS * HOUR) return false;
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
    // only waiting on results now, so hourly is plenty
    if (secondsNow() > overAt(tournament) && secondsNow() - (tournament.checkedAt ?? 0) < HOUR) continue;

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
    } catch (err) {
      console.error(`updating ${tournament.name ?? tournament.id} failed:`, err.message);
    }
    // even if the lookup failed, so a tournament start.gg keeps erroring on still gets results from the last good check
    try {
      await postResults(tournament);
    } catch (err) {
      console.error(`posting results for ${tournament.name ?? tournament.id} failed:`, err.message);
    }
  }

  health.tournamentCheck = secondsNow();
  save();
}

export async function postRollCall(tournament, postChannel = channel) {
  if (tournament.rollCallPosted) return;

  const dueAt = tournament.startAt - ROLL_CALL_HOURS_BEFORE * HOUR;
  if (secondsNow() >= tournament.startAt || secondsNow() < dueAt) return;

  // people, not entries. a late sign-up can still trigger it
  const entered = new Set(tournament.entries.map((entry) => entry.userId));
  if (entered.size < ROLL_CALL_MIN_PLAYERS) return;

  if (messageEnabled('rollcall', dueAt)) await post(embeds.rollCall(tournament, state.players), 'rollcall', dueAt, postChannel);
  tournament.rollCallPosted = true;
}

export async function postResults(tournament, postChannel = channel) {
  const now = secondsNow();
  if (now < tournament.startAt) return;

  if (tournament.entries.length && tournament.entries.every((entry) => entry.done)) tournament.doneAt ??= now;
  const waited = now - overAt(tournament);
  if (waited < RESULTS_WAIT_HOURS * HOUR) return;

  // events that never started have nothing to wait for or show
  const entries = tournament.entries.filter((entry) => entry.started);
  // anyone still in when the TO stopped reporting only has a projected placement
  const allIn = entries.every((entry) => entry.placement && (entry.done || entry.final));
  if (!allIn && waited < RESULTS_GIVE_UP_HOURS * HOUR) return;

  const dueAt = overAt(tournament) + (allIn ? RESULTS_WAIT_HOURS : RESULTS_GIVE_UP_HOURS) * HOUR;
  if (messageEnabled('results', dueAt)) await post(embeds.results({ ...tournament, entries }, state.players), 'results', dueAt, postChannel);
  tournament.resultsPosted = true;
}

export function endTime(tournament) {
  return Math.min(tournament.endAt ?? tournament.startAt, tournament.startAt + MAX_TOURNAMENT_DAYS * DAY);
}

// a finished bracket counts as over even if the TO set the end date way out
function overAt(tournament) {
  return Math.min(endTime(tournament), tournament.doneAt ?? Infinity);
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

// reg admins' tournaments get reminders without anyone setting them
async function addAdminTournaments() {
  try {
    for (const found of await startgg.getAdminTournaments(Object.keys(state.regAdmins))) {
      // bad end dates make old tournaments show up as upcoming
      if (state.regReminders[found.id] || state.regSkipped.includes(found.id) || secondsNow() > endTime(found)) continue;
      state.regReminders[found.id] = { id: found.id, slug: found.slug, name: found.name };
    }
  } catch (err) {
    console.error('finding reg admins\' tournaments failed:', err.message);
  }
}

export async function postRegReminders(postChannel = channel) {
  await addAdminTournaments();

  for (const reminder of Object.values(state.regReminders)) {
    try {
      // TOs move the close time, so always go off the latest
      const tournament = await startgg.getRegistration(reminder.slug);
      // kept until it's over for /bracket
      if (!tournament || secondsNow() > endTime(tournament) + RUNS_LATE_HOURS * HOUR) {
        delete state.regReminders[reminder.id];
        continue;
      }
      const deadline = regDeadline(tournament);
      Object.assign(reminder, {
        deadline,
        startAt: tournament.startAt,
        endAt: tournament.endAt,
        events: tournament.events ?? [],
        images: tournament.images?.filter((image) => image.type === 'profile'),
      });
      // set back when there was only the last call, or added for a reg admin
      reminder.next ??= nextRegReminder(deadline);
      // it closed, maybe while the bot was down
      if (deadline <= secondsNow()) continue;

      // only the latest one if the bot was down through a few
      const due = REG_REMINDER_HOURS.findLastIndex((hours, i) => i >= reminder.next && secondsNow() >= deadline - hours * HOUR);
      if (due === -1) continue;
      const lastCall = due === REG_REMINDER_HOURS.length - 1;

      // not open means it filled up, or for the early ones that it hasn't opened yet
      const dueAt = deadline - REG_REMINDER_HOURS[due] * HOUR;
      if (tournament.isRegistrationOpen && messageEnabled('registration', dueAt)) {
        // people one by one, a role ping would hit the ones already registered
        const participants = await startgg.getParticipants(tournament.id);
        rememberAccounts(participants);
        const registered = new Set(participants.map((participant) => participant.discordId));
        const ping = state.regPings.filter((id) => !registered.has(id));
        // the embed goes with the first batch of pings, or alone if there's nobody to ping
        for (let i = 0; i === 0 || i < ping.length; i += MENTIONS_PER_MESSAGE) {
          if (!messageEnabled('registration')) break;
          const users = ping.slice(i, i + MENTIONS_PER_MESSAGE);
          await postChannel.send({
            content: users.length ? `${users.map((id) => `<@${id}>`).join(' ')} ${lastCall ? 'last call' : 'registration reminder'}` : undefined,
            embeds: i === 0 ? [embeds.regReminder(tournament, deadline, lastCall)] : [],
            allowedMentions: { users },
          });
        }
      }
      // past the last call means none are left
      reminder.next = due + 1;
    } catch (err) {
      console.error(`reg reminder for ${reminder.name} failed:`, err.message);
    }
  }
  save();
}
