import * as startgg from './startgg.js';
import * as slippi from './slippi.js';
import * as embeds from './embeds/index.js';
import { state, save } from './store.js';
import { clearTrackRequest, readTrackRequest } from './track-request.js';
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
// slippi ranks only change after ranked sets, and its API isn't public, so it gets asked less than start.gg
const SLIPPI_CHECK_MINUTES = 30;
// players with no connect code on start.gg get looked at again this often, in case they play a netplay tournament since
const SLIPPI_SEARCH_DAYS = 7;
const SLIPPI_SKIPPED_KEPT = 1000;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export function secondsNow() {
  return Math.floor(Date.now() / 1000);
}

// for /status
export const health = {
  startedAt: secondsNow(), downSince: null, skippedBefore: null, setCheck: null, setError: null, tournamentCheck: null, slippiCheck: null, slippiError: null,
};

let channel;

// railway gives each deploy an id but no time, so the first start under a new id is when it went live.
// railway restarting the same deploy keeps that time
export function recordDeploy(env = process.env) {
  const id = env.RAILWAY_DEPLOYMENT_ID;
  if (!id || state.deploy?.id === id) return;
  state.deploy = { id, at: secondsNow() };
  save();
}

// when the running version went live. a local run has none, so it never shows railway's
export function deployedAt(env = process.env) {
  return env.RAILWAY_DEPLOYMENT_ID && state.deploy?.id === env.RAILWAY_DEPLOYMENT_ID ? state.deploy.at : null;
}

export function startTracking(postChannel) {
  channel = postChannel;
  recordDeploy();

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
  importTrackRequest();
  checkSlippiCodes();
  checkSlippiRanks();
  setInterval(checkTournaments, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkRegReminders, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkSets, SET_CHECK_MINUTES * 60 * 1000);
  setInterval(checkProfiles, PROFILE_CHECK_HOURS * HOUR * 1000);
  setInterval(checkSlippiCodes, PROFILE_CHECK_HOURS * HOUR * 1000);
  setInterval(checkSlippiRanks, SLIPPI_CHECK_MINUTES * 60 * 1000);
  setInterval(checkWeeklyRecap, 60 * 1000);
  // the tool at the other end waits on this, so it's checked more often than the tournaments
  setInterval(importTrackRequest, 30 * 1000);
}

// /track add, /set_reg_reminder and the host tool all save this. set results, stream alerts and
// match call pings start off since everyone with them on goes in a check every 2 minutes, and bulk
// adds made that slow. /sets, /stream and /calls turn them on
export function newTracked(player) {
  return { ...player, lastCheck: secondsNow(), streamAlerts: false, setResults: false, callPings: false };
}

// players queued by tools/track-attendees.js, added the same way /track add does and saved
// before the request is cleared. the requests are only made by that tool, so keep it simple
export function importTrackRequest() {
  try {
    const request = readTrackRequest();
    if (!request) return;

    const adding = (request.players ?? []).filter((player) => player.userId && player.playerId && !state.players[player.userId]);
    for (const player of adding) state.players[player.userId] = newTracked(player);
    if (adding.length) {
      save();
      console.log(`${adding.length} player${adding.length === 1 ? '' : 's'} from ${request.source ?? 'a track request'} added to the track`);
      // don't wait 15 min for their tournaments to show up
      checkTournaments();
    }
    // saved first, so a crash here just means it gets read again. adding is skipped when they're already tracked
    clearTrackRequest();
  } catch (err) {
    console.error('adding queued players failed:', err.message);
  }
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
    // roll calls and placements name people but never ping them
    if (messageEnabled(type, dueAt)) await postChannel.send({ embeds: batch, allowedMentions: { parse: [] } });
  }
}

const checkSets = queued(async () => {
  await postNewSets();
  await postStreamAlerts();
  await postMatchCalls();
});
export const checkTournaments = queued(updateTournaments);
const checkProfiles = queued(updateProfiles);
export const checkRegReminders = queued(postRegReminders);
const checkWeeklyRecap = queued(postWeeklyRecap);
const checkSlippiCodes = queued(findSlippiCodes);
const checkSlippiRanks = queued(postRankChanges);

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
    await postChannel.send({ embeds: state.weeklyRecap.batches[i], allowedMentions: { parse: [] } });
    state.weeklyRecap.sent = i + 1;
    save();
  }
  state.weeklyRecap.done = true;
  delete state.weeklyRecap.batches;
  save();
}

// a /slippi watchlist entry from a slippi profile. rank is the one it's at as of this check. past
// seasons are only for /slippi rank, which asks slippi again anyway
export function slippiEntry(profile, entry = {}) {
  const { seasons, ...current } = profile;
  return { ...entry, ...current, rank: slippi.rankOf(profile).name, checkedAt: secondsNow() };
}

// tracked and linked players whose slippi isn't on the watchlist yet, looked for once a week in their
// start.gg netplay registrations. anyone found goes on the watchlist with their start.gg attached
export async function findSlippiCodes() {
  const now = secondsNow();
  const watched = new Set(Object.values(state.slippi).map((entry) => String(entry.userId)));
  const records = [...Object.values(state.players), ...Object.values(state.links)];
  const due = new Map();
  for (const record of records) {
    if (watched.has(String(record.userId)) || now - (record.slippiSearchedAt ?? 0) < SLIPPI_SEARCH_DAYS * DAY) continue;
    // tracked comes first, and a link to the same account is the same person
    if (!due.has(String(record.userId))) due.set(String(record.userId), record);
  }
  if (!due.size) return;

  try {
    const codes = await startgg.getConnectCodes([...due.values()].map((record) => record.playerId));
    // typed by hand at registration, so some are lowercase or not codes at all
    const readable = new Map([...codes].map(([playerId, code]) => [playerId, slippi.readCode(code)]).filter(([, code]) => code));
    const profiles = readable.size ? await slippi.getProfilesByCode([...readable.values()]) : new Map();
    for (const record of due.values()) {
      const profile = profiles.get(readable.get(record.playerId));
      if (!profile || state.slippiSkipped.includes(profile.uid)) continue;
      // already on it from /slippi add. the rank check moves its numbers, or a rank change would go unposted
      if (state.slippi[profile.uid]) state.slippi[profile.uid].userId = record.userId;
      else state.slippi[profile.uid] = { ...slippiEntry(profile), userId: record.userId };
    }
    // only once it worked, so a failed search goes again tomorrow
    for (const record of records) {
      if (due.has(String(record.userId))) record.slippiSearchedAt = now;
    }
  } catch (err) {
    console.error('finding slippi codes failed:', err.message);
  }
  save();
}

// everyone on the watchlist, 20 a request. a move to another rank this season gets posted. a new season
// starts everyone over at pending, so the first rank after that is a placement and not a drop
export async function postRankChanges(postChannel = channel) {
  const entries = Object.values(state.slippi);
  if (!entries.length) return;
  const checkedAt = secondsNow();
  try {
    const latest = await slippi.getProfiles(entries.map((entry) => entry.uid));
    for (const entry of entries) {
      const profile = latest.get(entry.uid);
      // removed while this was running, or gone from slippi. kept in case slippi only hiccuped
      if (!profile || state.slippi[entry.uid] !== entry) continue;
      const before = { ...entry };
      Object.assign(entry, slippiEntry(profile));
      if (!before.rank || before.season !== entry.season || before.rank === entry.rank) continue;
      if (slippi.RANKS.indexOf(entry.rank) <= slippi.RANKS.indexOf('Pending')) continue;
      if (messageEnabled('slippi', checkedAt)) {
        await postChannel.send({ embeds: [embeds.rankChange(entry, before, state.players)], allowedMentions: { parse: [] } });
      }
    }
    health.slippiCheck = checkedAt;
    health.slippiError = null;
  } catch (err) {
    console.error('checking slippi ranks failed:', err.message);
    health.slippiError = err.message;
  }
  state.slippiSkipped = state.slippiSkipped.slice(-SLIPPI_SKIPPED_KEPT);
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
  // only players with results on get asked about, by playerId to when /sets turned them on
  const showingSince = new Map(players.filter(resultsOn).map((player) => [player.playerId, player.setResultsOnAt ?? 0]));
  const checkedAt = secondsNow();
  // one request for everyone, so go from the oldest lastCheck
  const lastCheck = Math.min(checkedAt, ...players.map((player) => player.lastCheck));
  const since = Math.max(lastCheck, checkedAt - CATCH_UP_HOURS * HOUR);
  try {
    // 2 min overlap for sets reported during the last check
    const sets = await startgg.getSets([...showingSince.keys()], { since: since - 120 });
    sets.sort((a, b) => a.completedAt - b.completedAt);

    for (const set of sets) {
      // for /recent all. results-off players only get it from a set against someone with them on
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

      // finished before /sets turned results on for everyone tracked in it, so it stays out of the channel.
      // it still counts as posted so the next check doesn't look at it again
      const showing = set.sides.some((side) => side.playerIds.some((id) => set.completedAt >= (showingSince.get(id) ?? Infinity)));
      if (showing && messageEnabled('sets', set.completedAt)) await postChannel.send({ embeds: [embeds.setResult(set, state.players)] });
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
  const announce = async (sets, eligible = () => true) => {
    for (const set of sets) {
      if (state.streamed.includes(set.id) || !eligible(set)) continue;
      if (messageEnabled('streams', wentLiveAt(set))) await postChannel.send({ embeds: [embeds.onStream(set, state.players)] });
      state.streamed.push(set.id);
    }
  };
  try {
    const playerIds = Object.values(state.players).filter(alertsOn).map((player) => player.playerId);
    await announce(await startgg.getStreamedSets(playerIds));
  } catch (err) {
    console.error('checking streams failed:', err.message);
  }

  // lots of TOs never hit "call", but they still use the stream queue for their overlay
  for (const tournament of liveTournaments()) {
    try {
      for (const queue of await startgg.getStreamQueues(tournament.id)) {
        await announce(setsToAnnounce(queue.sets), hasPlayerWithAlerts);
      }
    } catch (err) {
      console.error(`checking stream queue at ${tournament.name} failed:`, err.message);
    }
  }

  state.streamed = state.streamed.slice(-200);
  save();
}

export async function postMatchCalls(postChannel = channel) {
  try {
    const players = Object.values(state.players).filter(callsOn);
    if (!players.length) return;
    const playerIds = new Set(players.map((player) => player.playerId));
    for (const set of await startgg.getCalledSets([...playerIds])) {
      if ((state.called ??= []).includes(set.id)) continue;
      // both sides can be tracked with pings on, still one message for the set.
      // doubles sides hold two player ids each, so all four land in the same message
      const inSet = players.filter((player) => set.sides.some((side) => side.playerIds.includes(player.playerId)));
      if (!inSet.length) continue;
      if (messageEnabled('calls', set.updatedAt)) {
        const discordIds = [...new Set(inSet.map((player) => player.discordId).filter(Boolean))];
        await postChannel.send({
          content: discordIds.length ? `${discordIds.map((id) => `<@${id}>`).join(' ')} your match was called` : undefined,
          embeds: [embeds.matchCall(set, state.players)],
          allowedMentions: { users: discordIds },
        });
      }
      state.called.push(set.id);
    }
  } catch (err) {
    console.error('checking match calls failed:', err.message);
  }

  state.called = (state.called ?? []).slice(-200);
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

// /stream turns a player's stream alerts on. players saved before they started off have no field
function alertsOn(player) {
  return Boolean(player) && player.streamAlerts !== false;
}

// /sets turns a player's automatic set results on. players saved before they started off have no field
export function resultsOn(player) {
  return Boolean(player) && player.setResults !== false;
}

// /calls turns a player's match call pings on. these started off for everyone, so only an explicit on counts
export function callsOn(player) {
  return Boolean(player) && player.callPings === true;
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
