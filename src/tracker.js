import { setTimeout as sleep } from 'node:timers/promises';
import { PermissionFlagsBits, RESTJSONErrorCodes, ThreadAutoArchiveDuration } from 'discord.js';
import * as startgg from './startgg.js';
import * as slippi from './slippi.js';
import * as bills from './bills.js';
import * as embeds from './embeds/index.js';
import { state, save } from './store.js';
import { clearTrackRequest, readTrackRequest } from './track-request.js';
import { periodSummary, weeklyPeriod } from './reports.js';
import { messageEnabled, messageSettings } from './message-settings.js';
import { rememberAccounts } from './accounts.js';
import { buttonRow, h2hButton } from './commands/shared.js';

const SET_CHECK_MINUTES = 2;
const TOURNAMENT_CHECK_MINUTES = 15;
const PROFILE_CHECK_HOURS = 24;
const ROLL_CALL_HOURS_BEFORE = 1;
export const ROLL_CALL_MIN_PLAYERS = 3;
// results wait this long after the end since TOs often report top 4 late, then go out
// with whatever exists. unfinished placements are marked as projected
const RESULTS_WAIT_HOURS = 12;
// a top 8 start.gg keeps erroring on holds the placements back this long, then they go without it
const TOP8_RETRY_HOURS = 12;
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
// one or two games a week, so daily is plenty except near kickoff, when a
// final can land any minute over about 4 hours
export const BILLS_BASELINE_HOURS = 24;
const BILLS_GAMEDAY_MINUTES = 15;
const BILLS_PREGAME_HOURS = 1;
const BILLS_POSTGAME_HOURS = 8;
// players with no connect code on start.gg get looked at again this often, in case they play a netplay tournament since
const SLIPPI_SEARCH_DAYS = 7;
const SLIPPI_SKIPPED_KEPT = 1000;
// /messages threads needs these in the channel, named the way discord's settings show them
const THREAD_PERMISSIONS = { CreatePublicThreads: 'Create Public Threads', SendMessagesInThreads: 'Send Messages in Threads' };
// longer than any tournament runs, then the thread is forgotten
const THREAD_KEPT_DAYS = 14;
// a Head to head button comes off when its set is over, or this long after the post if start.gg never says so
const BUTTON_KEPT_HOURS = 12;
// TOs report the wrong winner or score and fix it, or reset the set, so set results get looked at again this long
const RESULT_WATCH_MINUTES = 60;
// a match call still called after this long pings again, since TOs usually DQ at 10
const CALL_WARN_MINUTES = 5;
const CALL_DQ_MINUTES = 10;
// and calls get looked at this long for going back to waiting
const CALL_WATCH_MINUTES = 15;
// a set back to waiting, ready or queued isn't called anymore
const UNCALLED_STATES = [1, 4, 7];
// placements that went out projected get edited once they're final, for this long after
const PROJECTED_KEPT_DAYS = 3;
// players with no reported set in this long get taken off the track list silently
export const PRUNE_AFTER_DAYS = 6 * 30;
// the prune only looks at dates, so every two weeks is plenty
const PRUNE_CHECK_DAYS = 14;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export function secondsNow() {
  return Math.floor(Date.now() / 1000);
}

// for /status
export const health = {
  startedAt: secondsNow(), downSince: null, skippedBefore: null, setCheck: null, setError: null, tournamentCheck: null, slippiCheck: null, slippiError: null, threadError: null,
  billsCheck: null, billsError: null,
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
  // saved from before trackedAt existed. lastSetAt means they played while tracked, so it
  // counts as the start. otherwise now, so nobody gets pruned for time before this was kept
  for (const player of Object.values(state.players)) {
    player.trackedAt ??= player.lastSetAt ?? secondsNow();
  }

  checkTournaments();
  checkSets();
  checkProfiles();
  checkRegReminders();
  checkWeeklyRecap();
  importTrackRequest();
  checkSlippiCodes();
  checkSlippiRanks();
  loopBills();
  checkPrune();
  setInterval(checkTournaments, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkRegReminders, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkSets, SET_CHECK_MINUTES * 60 * 1000);
  setInterval(checkProfiles, PROFILE_CHECK_HOURS * HOUR * 1000);
  setInterval(checkSlippiCodes, PROFILE_CHECK_HOURS * HOUR * 1000);
  setInterval(checkSlippiRanks, SLIPPI_CHECK_MINUTES * 60 * 1000);
  setInterval(checkPrune, PRUNE_CHECK_DAYS * DAY * 1000);
  setInterval(checkWeeklyRecap, 60 * 1000);
  // the tool at the other end waits on this, so it's checked more often than the tournaments
  setInterval(importTrackRequest, 30 * 1000);
}

// /track add, /set_reg_reminder and the host tool all save this. set results, stream alerts and
// match call pings start off since everyone with them on goes in a check every 2 minutes, and bulk
// adds made that slow. /sets, /stream and /calls turn them on. trackedAt is when they were added,
// so the prune knows a player with no sets yet isn't inactive
export function newTracked(player) {
  return { ...player, lastCheck: secondsNow(), trackedAt: secondsNow(), streamAlerts: false, setResults: false, callPings: false };
}

// players queued by tools/track-attendees.js, added the same way /track add does and saved
// before the request is cleared. ids are numeric from start.gg, so anything else is a bad file and stays out
const numericId = (id) => /^\d+$/.test(String(id));
export function importTrackRequest() {
  try {
    const request = readTrackRequest();
    if (!request) return;

    const adding = (request.players ?? []).filter((player) => numericId(player.userId) && numericId(player.playerId) && !state.players[player.userId] && !Object.hasOwn(Object.prototype, player.userId));
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

// fewest messages that fit discord's limits. the switch gets checked before each one in case it's turned off partway.
// returns the messages that went out
async function post(list, type, dueAt, postChannel = channel) {
  const sent = [];
  for (const batch of embeds.messages(list)) {
    // roll calls and placements name people but never ping them
    if (messageEnabled(type, dueAt)) sent.push(await postChannel.send({ embeds: batch, allowedMentions: { parse: [] } }));
  }
  return sent;
}

// what a post gets saved as to edit later. a message object can't outlast a restart
const postRefs = (messages) => messages.filter((message) => message?.id).map((message) => ({ channelId: message.channelId, messageId: message.id }));

// edits a saved post, payload or a function that makes it from the message as discord has it now.
// false when someone deleted the post or its thread, which is fine
async function editPost(postChannel, { channelId, messageId }, payload) {
  try {
    const { messages } = await postChannel.client.channels.fetch(channelId);
    await messages.edit(messageId, typeof payload === 'function' ? payload(await messages.fetch(messageId)) : payload);
    return true;
  } catch (err) {
    if ([RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel].includes(err.code)) return false;
    throw err;
  }
}

// ids only ever form a mention. anything with mention syntax in it stays out instead of going in as text
const mentionable = (id) => Boolean(id) && /^[\w-]+$/.test(String(id));
const mentions = (discordIds) => discordIds.filter(mentionable).map((id) => `<@${id}>`).join(' ');

const checkSets = queued(async () => {
  await postNewSets();
  await fixCorrectedResults();
  await postStreamAlerts();
  await postMatchCalls();
  await followCalls();
  await clearFinishedButtons();
});
export const checkTournaments = queued(updateTournaments);
const checkProfiles = queued(updateProfiles);
export const checkRegReminders = queued(postRegReminders);
const checkWeeklyRecap = queued(postWeeklyRecap);
const checkSlippiCodes = queued(findSlippiCodes);
const checkSlippiRanks = queued(postRankChanges);
const checkPrune = queued(pruneInactive);

// Bills runs on its own loop below since game day polls tighter than the baseline
let billsRunning = false;
async function loopBills() {
  let delay = BILLS_BASELINE_HOURS * HOUR * 1000;
  if (!billsRunning) {
    billsRunning = true;
    try {
      delay = await postBillsResults();
    } finally {
      billsRunning = false;
    }
  }
  setTimeout(loopBills, delay);
}

export async function postWeeklyRecap(postChannel = channel, now = secondsNow()) {
  const period = weeklyPeriod(now, messageSettings());
  // turning it back on or changing the schedule waits for the next recap instead of sending an overdue one
  const canPost = () => messageEnabled('recap', period.until) && period.until > (messageSettings().recapChangedAt ?? 0);
  if (!period || !canPost() || (state.weeklyRecap?.until === period.until && state.weeklyRecap.done)) return;
  // built once and saved, so a restart partway through sends the rest instead of starting over
  if (state.weeklyRecap?.until !== period.until) {
    const crew = [];
    const players = Object.values(state.players);
    // most of a big tracked list didn't play that week, and one request rules out 50 of them
    const played = await startgg.getActivePlayers(players.map((player) => player.playerId), period.since);
    for (const player of players) {
      if (!played.has(player.playerId)) continue;
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
        const { files, characterFile } = await slippi.slippiArt(entry);
        await postChannel.send({ embeds: [embeds.rankChange(entry, before, state.players, { characterFile })], files, allowedMentions: { parse: [] } });
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

// 15 minutes from an hour before kickoff until 8 hours after, daily otherwise.
// a live game keeps its kickoff as the next date until it's final, so the tight
// polling covers the whole game plus any OT or ESPN delay
export function billsDelay(nextDate, now = secondsNow()) {
  if (nextDate != null && now >= nextDate - BILLS_PREGAME_HOURS * HOUR && now <= nextDate + BILLS_POSTGAME_HOURS * HOUR) {
    return BILLS_GAMEDAY_MINUTES * 60 * 1000;
  }
  return BILLS_BASELINE_HOURS * HOUR * 1000;
}

// Bills finals, one request for the schedule and one per new final for quarters
// and yards. off by default, and anything final while it was off stays skipped.
// returns when to check again so the loop stays daily except near kickoff
export async function postBillsResults(postChannel = channel) {
  const checkedAt = secondsNow();
  try {
    const { finals, nextDate } = await bills.getScheduleState();
    finals.sort((a, b) => a.date - b.date);
    state.billsPosted ??= [];
    for (const game of finals) {
      if (state.billsPosted.includes(game.id)) continue;
      if (messageEnabled('bills', game.date)) {
        let details = null;
        try {
          details = await bills.getDetails(game.id);
        } catch (err) {
          console.error(`bills details for ${game.id} failed:`, err.message);
        }
        await postChannel.send({ embeds: embeds.withImage([embeds.billsFinal(game, details)]), allowedMentions: { parse: [] } });
      }
      state.billsPosted.push(game.id);
      save();
    }
    state.billsPosted = (state.billsPosted ?? []).slice(-50);
    health.billsCheck = checkedAt;
    health.billsError = null;
    save();
    return billsDelay(nextDate, checkedAt);
  } catch (err) {
    console.error('checking Bills finals failed:', err.message);
    health.billsError = err.message;
  }
  save();
  return BILLS_BASELINE_HOURS * HOUR * 1000;
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

// players with no reported set in PRUNE_AFTER_DAYS come off the track list, silently. lastSetAt
// only moves for sets the 2-minute check asked about, so anyone stale gets one fresh lookup first:
// someone with results off who only plays untracked people looks stale but isn't
export async function pruneInactive(now = secondsNow()) {
  const cutoff = now - PRUNE_AFTER_DAYS * DAY;
  const candidates = Object.values(state.players).filter((player) => (player.lastSetAt ?? player.trackedAt ?? now) < cutoff);
  if (!candidates.length) return [];
  try {
    const sets = await startgg.getSets(candidates.map((player) => player.playerId), { perPage: 1 });
    for (const set of sets) {
      for (const player of candidates) {
        if (set.sides.some((side) => side.playerIds.includes(player.playerId))) {
          player.lastSetAt = Math.max(player.lastSetAt ?? 0, set.completedAt);
        }
      }
    }
  } catch (err) {
    console.error('checking inactive players failed:', err.message);
    return [];
  }
  const pruned = candidates.filter((player) => (player.lastSetAt ?? player.trackedAt ?? now) < cutoff);
  for (const player of pruned) delete state.players[player.userId];
  save();
  if (pruned.length) console.log(`pruned ${pruned.length} inactive player${pruned.length === 1 ? '' : 's'} from the track`);
  return pruned;
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
      if (showing && messageEnabled('sets', set.completedAt)) {
        // no head to head button, the set's over
        const sent = await tournamentPosts(set, postChannel).send({ embeds: embeds.withImage([embeds.setResult(set, state.players)]) });
        watchResult(sent, set);
      }
      state.posted.push(set.id);
      if (dqed) state.dqs.push(dqed.id);
      // saved per set so a crash after the post doesn't post it again on restart
      save();
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

// saved so fixCorrectedResults can find the card again. start.gg's preview sets have ids like preview_1_2
// that can't be looked up
function watchResult(message, set) {
  if (!message?.id || !/^\d+$/.test(set.id)) return;
  const [ref] = postRefs([message]);
  state.resultPosts.push({ setId: set.id, ...ref, at: secondsNow(), outcome: startgg.outcomeOf(set), reset: false });
  state.resultPosts = state.resultPosts.slice(-200);
}

// set results from the last hour whose winner or score the TO changed get the corrected card, and ones the TO
// reset or deleted get marked. one small request covers all of them, and only a changed set is asked for in full
export async function fixCorrectedResults(postChannel = channel) {
  const now = secondsNow();
  const before = state.resultPosts.length;
  state.resultPosts = state.resultPosts.filter((each) => each.at > now - RESULT_WATCH_MINUTES * 60);
  const watching = state.resultPosts;
  if (!watching.length) {
    // expired posts were dropped, so save so they don't come back on restart
    if (state.resultPosts.length !== before) save();
    return;
  }
  try {
    const outcomes = await startgg.getSetOutcomes([...new Set(watching.map((each) => each.setId))]);
    // a reset set reported again with the same result still needs its card put back
    const changed = watching.filter((each) => {
      const latest = outcomes.get(each.setId);
      return latest?.state === 3 && (each.reset || latest.outcome !== each.outcome);
    });
    const sets = changed.length ? await startgg.getSetsById([...new Set(changed.map((each) => each.setId))]) : new Map();
    for (const each of watching) {
      let kept = true;
      if (changed.includes(each)) {
        const set = sets.get(each.setId);
        // reset again between the two requests, the next check sorts it out
        if (set?.state !== 3) continue;
        kept = await editPost(postChannel, each, { embeds: embeds.withImage([embeds.correctedResult(set, state.players)]) });
        Object.assign(each, { outcome: startgg.outcomeOf(set), reset: false });
      } else if (outcomes.get(each.setId)?.state !== 3 && !each.reset) {
        // start.gg doesn't have the result anymore, so the card stays as it was with the result marked
        kept = await editPost(postChannel, each, (message) => ({ embeds: message.embeds.slice(0, 1).map(embeds.resetResult) }));
        each.reset = true;
      }
      if (!kept) state.resultPosts = state.resultPosts.filter((other) => other !== each);
    }
  } catch (err) {
    console.error('checking posted set results for fixes failed:', err.message);
  }
  save();
}

// sets on stream with someone who has alerts on, by id. a set in a stream queue goes by the queue's
// stream, since the set's own can still name a stream it was moved off
async function streamedNow() {
  const found = new Map();
  try {
    const playerIds = Object.values(state.players).filter(alertsOn).map((player) => player.playerId);
    for (const set of await startgg.getStreamedSets(playerIds)) found.set(set.id, set);
  } catch (err) {
    console.error('checking streams failed:', err.message);
  }

  // lots of TOs never hit "call", but they still use the stream queue for their overlay
  for (const tournament of liveTournaments()) {
    try {
      for (const queue of await startgg.getStreamQueues(tournament.id)) {
        for (const set of setsToAnnounce(queue.sets).filter(hasPlayerWithAlerts)) found.set(set.id, set);
      }
    } catch (err) {
      console.error(`checking stream queue at ${tournament.name} failed:`, err.message);
    }
  }
  return found;
}

// TOs misclick a set onto stream and take it back seconds later, so a new one has to still be there after this
const STREAM_CONFIRM_MS = 30_000;

export async function postStreamAlerts(postChannel = channel, confirmAfter = STREAM_CONFIRM_MS) {
  const seen = [...(await streamedNow()).values()].filter((set) => !state.streamed.includes(set.id));
  if (seen.length) {
    await sleep(confirmAfter);
    const still = await streamedNow();
    for (const { id, stream } of seen) {
      const set = still.get(id);
      // taken off stream or moved to another one. the next check looks again once it settles
      if (!set || set.stream.streamName !== stream.streamName || state.streamed.includes(id)) continue;
      // everyone with /stream_pings on, for every alert whoever is on stream
      if (messageEnabled('streams', wentLiveAt(set))) {
        const components = h2hRow(set);
        const sent = await sendPinging(tournamentPosts(set, postChannel), 'streams', state.streamPings, 'on stream', embeds.onStream(set, state.players), components);
        rememberButton(sent, set, components);
      }
      state.streamed.push(id);
    }
  }

  state.streamed = state.streamed.slice(-200);
  save();
}

// the card and its buttons go with the first batch of pings, or alone if there's nobody to ping. the rest
// stop if /messages turns the type off partway through. returns the message with the card
async function sendPinging(postChannel, type, ids, text, embed, components = []) {
  let first;
  for (let i = 0; i === 0 || i < ids.length; i += MENTIONS_PER_MESSAGE) {
    if (i > 0 && !messageEnabled(type)) break;
    // ping lists come from discord, but the filter stays here so no caller can pass mention syntax through
    const users = ids.slice(i, i + MENTIONS_PER_MESSAGE).filter(mentionable);
    const sent = await postChannel.send({
      content: users.length ? `${mentions(users)} ${text}` : undefined,
      embeds: i === 0 ? embeds.withImage([embed]) : [],
      components: i === 0 ? components : [],
      allowedMentions: { users },
    });
    first ??= sent;
  }
  return first;
}

// the thread permissions the bot is missing in the channel, or null when it can't have threads at all,
// like a voice channel's chat
export function missingThreadPermissions(postChannel = channel) {
  if (!postChannel?.threads || postChannel.isThread?.()) return null;
  const has = postChannel.permissionsFor(postChannel.client.user);
  return Object.keys(THREAD_PERMISSIONS).filter((name) => !has?.has(PermissionFlagsBits[name])).map((name) => THREAD_PERMISSIONS[name]);
}

// stands in for the channel when posting a set. with /messages threads on it sends to the tournament's
// or the event's thread, and to the channel when the thread can't be used, so a permission change never loses a post
function tournamentPosts(set, postChannel) {
  const send = async (message) => {
    const mode = messageSettings().threads;
    if (mode === 'off') return postChannel.send(message);
    const { tournament } = set.event;
    try {
      const sent = await (await tournamentThread(set.event, mode === 'event', postChannel)).send(message);
      health.threadError = null;
      return sent;
    } catch (err) {
      console.error(`posting in the thread for ${tournament.name} failed, posting in the channel:`, err.message);
      health.threadError = err.message;
      return postChannel.send(message);
    }
  };
  return { send };
}

// pinning the starter needs manage messages, but threads work without it so a failed pin just logs
async function pinThreadCard(card, tournament) {
  try {
    await card.pin();
    return true;
  } catch (err) {
    console.error(`pinning the thread starter for ${tournament?.name ?? 'a tournament'} failed:`, err.message);
    return false;
  }
}

// the starter lives in the channel, so unpinning goes through its saved channel and message ids.
// true when there's nothing left to unpin, false to try again next check
async function unpinThreadRef(postChannel, ref) {
  try {
    const { messages } = await postChannel.client.channels.fetch(ref.channelId ?? postChannel.id);
    if (messages.unpin) await messages.unpin(ref.messageId);
    else (await messages.fetch(ref.messageId)).unpin();
    return true;
  } catch (err) {
    if ([RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel].includes(err.code)) return true;
    throw err;
  }
}

// the first post for a tournament, or for an event when byEvent, puts a card with its name in the channel and
// starts the thread on it. saved by slug, since sets don't come with the tournament id, so a restart keeps using
// the same one. event slugs start with their tournament's, so both kinds share state.threads without clashing.
// a tournament thread pins its card so the thread stays easy to find, and unpinFinishedThreads takes it off once over
async function tournamentThread(event, byEvent, postChannel) {
  const { tournament } = event;
  const slug = byEvent ? event.slug : tournament.slug;
  const saved = state.threads[slug];
  if (saved) {
    // an archived thread opens back up when something's sent in it. a deleted one gets replaced
    const thread = await postChannel.threads.fetch(saved.id).catch((err) => {
      if (err.code === RESTJSONErrorCodes.UnknownChannel) return null;
      throw err;
    });
    if (thread) return thread;
    // its card stays in the channel, so a pinned one comes off before the replacement goes up
    if (saved.pinned && saved.messageId) {
      await unpinThreadRef(postChannel, saved).catch((err) => console.error(`unpinning the old thread starter for ${tournament.name} failed:`, err.message));
    }
  }

  // checked before the card goes out, or every set would leave another card with no thread on it
  const missing = missingThreadPermissions(postChannel);
  if (!missing) throw new Error('threads can\'t be started in this channel');
  if (missing.length) throw new Error(`missing ${missing.join(' and ')}`);

  const card = await postChannel.send({
    embeds: embeds.withImage([byEvent ? embeds.eventThread(event) : embeds.tournamentThread(tournament)]), allowedMentions: { parse: [] },
  });
  const thread = await card.startThread({ name: threadName(event, byEvent), autoArchiveDuration: ThreadAutoArchiveDuration.OneDay });
  const now = secondsNow();
  // forgetting an old thread takes its pin off too, so pins don't outlast the 14 days
  for (const [oldSlug, old] of Object.entries(state.threads)) {
    if (old.at <= now - THREAD_KEPT_DAYS * DAY && old.pinned && old.messageId) {
      await unpinThreadRef(postChannel, old).catch((err) => console.error('unpinning an old thread starter failed:', err.message));
    }
  }
  state.threads = Object.fromEntries(Object.entries(state.threads).filter(([, each]) => each.at > now - THREAD_KEPT_DAYS * DAY));
  const entry = { id: thread.id, at: now };
  if (!byEvent && card?.id) {
    entry.channelId = card.channelId ?? postChannel.id;
    entry.messageId = card.id;
    entry.pinned = await pinThreadCard(card, tournament);
  }
  state.threads[slug] = entry;
  save();
  return thread;
}

// pinned tournament starters whose tournament is over get unpinned. over means past the end plus time
// for locals running late, or placements already posted for a TO with a far-out end date
export async function unpinFinishedThreads(postChannel = channel) {
  if (!postChannel?.client) return;
  const now = secondsNow();
  let changed = false;
  for (const [slug, entry] of Object.entries(state.threads)) {
    if (!entry?.pinned || !entry.messageId) continue;
    if (entry.at <= now - THREAD_KEPT_DAYS * DAY) {
      try {
        await unpinThreadRef(postChannel, entry);
      } catch (err) {
        console.error('unpinning an old thread starter failed:', err.message);
        continue;
      }
      delete state.threads[slug];
      changed = true;
      continue;
    }
    const tournament = Object.values(state.tournaments).find((each) => each.slug === slug);
    // not tracked yet, or already pruned. deletions unpin on the way out, so this waits
    if (!tournament) continue;
    if (!tournament.resultsPosted && now <= endTime(tournament) + RUNS_LATE_HOURS * HOUR) continue;
    try {
      await unpinThreadRef(postChannel, entry);
    } catch (err) {
      console.error(`unpinning the thread starter for ${tournament.name} failed:`, err.message);
      continue;
    }
    entry.pinned = false;
    changed = true;
  }
  if (changed) save();
}

// a tournament going away takes its pin off first, so deleted and unpublished ones don't stay pinned
async function unpinTournamentThread(postChannel, tournament) {
  const entry = state.threads[tournament.slug];
  if (!entry?.pinned || !entry.messageId || !(postChannel ?? channel)?.client) return;
  try {
    await unpinThreadRef(postChannel ?? channel, entry);
  } catch (err) {
    console.error(`unpinning the thread starter for ${tournament.name} failed:`, err.message);
    return;
  }
  entry.pinned = false;
}

// discord caps thread names at 100. a long tournament name gets cut before the event's, which tells the threads apart
function threadName(event, byEvent) {
  const { name } = event.tournament;
  if (!byEvent) return name.slice(0, 100);
  const suffix = ` · ${event.name}`.slice(0, 100);
  return `${name.slice(0, 100 - suffix.length)}${suffix}`;
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
        // discord ids come from start.gg, so anything with mention syntax stays out
        const discordIds = [...new Set(inSet.map((player) => player.discordId).filter(mentionable))];
        const components = h2hRow(set);
        const sent = await postChannel.send({
          content: discordIds.length ? `${mentions(discordIds)} your match was called` : undefined,
          embeds: embeds.withImage([embeds.matchCall(set, state.players)]),
          components,
          allowedMentions: { users: discordIds },
        });
        rememberButton(sent, set, components);
        watchCall(sent, set, discordIds);
      }
      state.called.push(set.id);
      save();
    }
  } catch (err) {
    console.error('checking match calls failed:', err.message);
  }

  state.called = (state.called ?? []).slice(-200);
  save();
}

// saved so followCalls can find the call again. a called set was last updated when it got called
function watchCall(message, set, discordIds) {
  if (!message?.id || !/^\d+$/.test(set.id)) return;
  const [ref] = postRefs([message]);
  state.callPosts.push({ setId: set.id, ...ref, calledAt: Math.min(set.updatedAt ?? Infinity, secondsNow()), discordIds, warned: false });
  state.callPosts = state.callPosts.slice(-200);
  save();
}

// match calls from the last 15 minutes, in one request. a call usually means go now, so there's no wait
// before it goes out like stream alerts have. instead one whose set goes back to waiting gets edited to say
// it was uncalled, and the next call pings again. one still called 5 minutes in pings its players once more
export async function followCalls(postChannel = channel) {
  const now = secondsNow();
  const before = state.callPosts.length;
  state.callPosts = state.callPosts.filter((each) => each.calledAt > now - CALL_WATCH_MINUTES * 60);
  const watching = state.callPosts;
  if (!watching.length) {
    if (state.callPosts.length !== before) save();
    return;
  }
  try {
    const states = await startgg.getSetStates([...new Set(watching.map((each) => each.setId))]);
    for (const each of watching) {
      const setState = states.get(each.setId);
      if (setState === 6) {
        const minutes = Math.floor((now - each.calledAt) / 60);
        if (each.warned || !each.discordIds.length || minutes < CALL_WARN_MINUTES) continue;
        // marked first, two of these would be worse than none
        each.warned = true;
        save();
        if (messageEnabled('calls', each.calledAt + CALL_WARN_MINUTES * 60)) {
          const users = each.discordIds.filter(mentionable);
          await postChannel.send({
            content: `${mentions(each.discordIds)} called ${minutes} min ago, TOs usually DQ at ${CALL_DQ_MINUTES}`,
            reply: { messageReference: each.messageId, failIfNotExists: false },
            allowedMentions: { users },
          });
        }
        continue;
      }
      // started, finished or deleted, so there's nothing more to watch for
      if (!UNCALLED_STATES.includes(setState)) {
        state.callPosts = state.callPosts.filter((other) => other !== each);
        continue;
      }
      // uncalled: edit first so a failed edit stays watched for the next check
      state.called = state.called.filter((id) => id !== each.setId);
      // an edit never pings, the mentions just stay so they can see it was theirs
      const content = each.discordIds.length ? `${mentions(each.discordIds)} ~~your match was called~~ Uncalled by the TO, wait for the next call` : 'Uncalled by the TO, wait for the next call';
      await editPost(postChannel, each, { content, allowedMentions: { parse: [] } });
      state.callPosts = state.callPosts.filter((other) => other !== each);
    }
  } catch (err) {
    console.error('following up match calls failed:', err.message);
  }
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

// a Head to head button under a match call or stream alert, about the first tracked player in it. finished sets
// don't get one. it answers only whoever pressed it, so the channel doesn't fill up with reports
function h2hRow(set) {
  const player = Object.values(state.players).find((each) => set.sides.some((side) => side.playerIds.includes(each.playerId)));
  return player ? buttonRow(h2hButton(set, player, { label: 'Head to head', action: 'private' })) : [];
}

// saved so clearFinishedButtons can find the post again after a restart. start.gg's preview sets
// have ids like preview_1_2 that can't be looked up, and those never get called anyway
function rememberButton(message, set, components) {
  if (!components.length || !message?.id || !/^\d+$/.test(set.id)) return;
  (state.buttons ??= []).push({ setId: set.id, channelId: message.channelId, messageId: message.id, at: secondsNow() });
  state.buttons = state.buttons.slice(-200);
  save();
}

// takes the Head to head button off match calls and stream alerts whose set is over, or got deleted,
// in one request for all of them. a post that's 12 hours old loses it without asking
export async function clearFinishedButtons(postChannel = channel) {
  const saved = state.buttons ?? [];
  if (!saved.length) return;
  const now = secondsNow();
  const recent = saved.filter((each) => each.at > now - BUTTON_KEPT_HOURS * HOUR);
  let states;
  try {
    states = recent.length ? await startgg.getSetStates([...new Set(recent.map((each) => each.setId))]) : new Map();
  } catch (err) {
    console.error('checking sets with buttons failed:', err.message);
    return;
  }
  const over = (each) => !recent.includes(each) || [3, null].includes(states.get(each.setId));

  for (const each of saved.filter(over)) {
    await editPost(postChannel, each, { components: [] })
      .catch((err) => console.error(`taking the button off message ${each.messageId} failed:`, err.message));
  }
  state.buttons = saved.filter((each) => !over(each));
  save();
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
      if (secondsNow() > endTime(tournament) + 7 * DAY) {
        await unpinTournamentThread(channel, tournament);
        delete state.tournaments[tournament.id];
      } else {
        if (tournament.projected) {
          await correctPlacements(tournament)
            .catch((err) => console.error(`correcting placements for ${tournament.name ?? tournament.id} failed:`, err.message));
        }
        if (tournament.top8Failed) {
          await verifyTopEight(tournament)
            .catch((err) => console.error(`verifying the top 8 for ${tournament.name ?? tournament.id} failed:`, err.message));
        }
      }
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
        await unpinTournamentThread(channel, tournament);
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

  await unpinFinishedThreads().catch((err) => console.error('unpinning finished tournament threads failed:', err.message));
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
  // the top 8 goes out as soon as every event is finished, without waiting 12 hours for placements
  if (!tournament.top8Posted) await postEarlyTopEight(tournament, postChannel, now);

  const waited = now - overAt(tournament);
  if (waited < RESULTS_WAIT_HOURS * HOUR) return;

  // events that never started have nothing to wait for or show
  const entries = tournament.entries.filter((entry) => entry.started);
  // anyone still in when the TO stopped reporting only has a projected placement
  const allIn = entries.every(placed);

  const dueAt = overAt(tournament) + RESULTS_WAIT_HOURS * HOUR;
  // fetched before anything posts, so a start.gg error retries both next hour instead of repeating placements.
  // skipped when the top 8 already went out early
  let events = [];
  if (!tournament.top8Posted && messageEnabled('top8', dueAt)) {
    try {
      events = await topEightEvents(entries);
    } catch (err) {
      if (now < dueAt + TOP8_RETRY_HOURS * HOUR) throw err;
      console.error(`top 8 for ${tournament.name ?? tournament.id} failed, posting placements without it:`, err.message);
    }
  }
  const results = messageEnabled('results', dueAt) ? await post(embeds.results({ ...tournament, entries }, state.players), 'results', dueAt, postChannel) : [];
  // marked before the top 8 goes, so discord failing on it can't post the placements again
  tournament.resultsPosted = true;
  let topEight = [];
  if (!tournament.top8Posted && events.length) {
    const sentTopEight = await post(embeds.topEight(tournament, events), 'top8', dueAt, postChannel).catch((err) => {
      console.error(`posting the top 8 for ${tournament.name ?? tournament.id} failed:`, err.message);
      return null;
    });
    if (sentTopEight) {
      topEight = sentTopEight;
      tournament.top8Posted = true;
    } else {
      // the fail-safe retries this hourly, see verifyTopEight
      tournament.top8Failed = true;
      tournament.top8FailedAt ??= now;
    }
  } else if (!tournament.top8Posted && !messageEnabled('top8', dueAt)) {
    // switched off counts as posted, so the fail-safe doesn't replay it
    tournament.top8Posted = true;
  }
  // projected ones get edited once start.gg has them final, see correctPlacements.
  // a top 8 with nothing reported yet saves with nothing to edit, so the final still goes out
  const projected = { at: now, results: allIn ? [] : postRefs(results), top8: events.every((event) => event.done) ? [] : postRefs(topEight) };
  if (projected.results.length || projected.top8.length || !tournament.top8Posted) tournament.projected = projected;
}

// posts the top 8 as soon as every event the crew played in is finished, before placements are due.
// true once it went out or was consumed while switched off, so later placements skip it
async function postEarlyTopEight(tournament, postChannel, now) {
  const entries = tournament.entries.filter((entry) => entry.started);
  if (!entries.length || !entries.every((entry) => entry.done)) return false;
  // switched off counts as posted, so turning it back on doesn't replay it
  if (!messageEnabled('top8', now)) {
    tournament.top8Posted = true;
    return true;
  }
  let events;
  try {
    events = await fetchDoneTopEight(entries);
  } catch (err) {
    console.error(`early top 8 for ${tournament.name ?? tournament.id} failed:`, err.message);
    return false;
  }
  if (!events) return false;
  try {
    await post(embeds.topEight(tournament, events), 'top8', now, postChannel);
  } catch (err) {
    console.error(`posting the early top 8 for ${tournament.name ?? tournament.id} failed:`, err.message);
    return false;
  }
  tournament.top8Posted = true;
  return true;
}

// every event the crew played in, once all of them are finished. null while the bracket
// is still running. the entries gate the fetch, so live tournaments cost nothing extra
async function fetchDoneTopEight(entries) {
  const started = entries.filter((entry) => entry.started);
  if (!started.length) return null;
  const events = await topEightEvents(started);
  // a missing event or an unfinished one means the bracket isn't fully reported yet
  const distinct = new Set(started.filter((entry) => entry.eventId).map((entry) => entry.eventId)).size;
  if (!events.length || events.length < distinct || !events.every((event) => event.done)) return null;
  return events;
}

// fail-safe: a top 8 that failed to send gets retried hourly for 3 days, then gives up.
// only tournaments the new code marked with top8Failed come here, so ones from before the
// flag existed never get a second top 8. true once it went out or there's nothing to retry
export async function verifyTopEight(tournament, postChannel = channel, now = secondsNow()) {
  if (tournament.top8Posted || !tournament.top8Failed) return true;
  if (now - (tournament.top8CheckedAt ?? 0) < HOUR) return false;
  tournament.top8CheckedAt = now;
  if (now > (tournament.top8FailedAt ?? now) + PROJECTED_KEPT_DAYS * DAY) {
    delete tournament.top8Failed;
    delete tournament.top8FailedAt;
    delete tournament.top8CheckedAt;
    return false;
  }
  // switched off since it failed: keep the marker so it retries if switched back on
  if (!messageEnabled('top8')) return false;
  let events;
  try {
    events = await fetchDoneTopEight(tournament.entries);
  } catch (err) {
    console.error(`retrying the top 8 for ${tournament.name ?? tournament.id} failed:`, err.message);
    return false;
  }
  if (!events) return false;
  try {
    await post(embeds.topEight(tournament, events), 'top8', now, postChannel);
  } catch (err) {
    console.error(`retrying the top 8 for ${tournament.name ?? tournament.id} failed:`, err.message);
    return false;
  }
  tournament.top8Posted = true;
  delete tournament.top8Failed;
  delete tournament.top8FailedAt;
  delete tournament.top8CheckedAt;
  return true;
}

// a placement that won't change: the event's over, or they're out of it
const placed = (entry) => Boolean(entry.placement && (entry.done || entry.final));

// placements that went out projected because the TO stopped reporting get edited once start.gg has every
// one final, looked at hourly for 3 days. the top 8 the same, once its events are finished. a top 8
// with nothing reported at 12 hours goes out as a new message instead, since there's nothing to edit
export async function correctPlacements(tournament, postChannel = channel) {
  const { projected } = tournament;
  const now = secondsNow();
  if (now > projected.at + PROJECTED_KEPT_DAYS * DAY) {
    delete tournament.projected;
    return;
  }
  if (now - (projected.checkedAt ?? projected.at) < HOUR) return;
  projected.checkedAt = now;

  if (projected.results.length) {
    const latest = await startgg.getTournament(tournament.id, tournament.userIds.filter((id) => state.players[id]));
    const entries = latest?.entries.filter((entry) => entry.started) ?? [];
    if (entries.length && entries.every(placed)) {
      tournament.entries = latest.entries;
      await editPosts(postChannel, projected.results, embeds.results({ ...tournament, entries }, state.players), 'results', 'Final placements, the ones above were projected');
      projected.results = [];
    }
  }
  if (projected.top8.length) {
    const events = await topEightEvents(tournament.entries.filter((entry) => entry.started));
    if (events.length && events.every((event) => event.done)) {
      await editPosts(postChannel, projected.top8, embeds.topEight(tournament, events), 'top8', 'Final top 8, the one above was projected');
      projected.top8 = [];
    }
  } else if (!tournament.top8Posted && messageEnabled('top8')) {
    // nothing went out at 12 hours, so the final goes out as a new message once it's reported.
    // switched off waits for it to come back on instead of replaying later
    const events = await fetchDoneTopEight(tournament.entries);
    if (events) {
      await post(embeds.topEight(tournament, events), 'top8', now, postChannel);
      tournament.top8Posted = true;
    }
  }
  if (!projected.results.length && !projected.top8.length && tournament.top8Posted) delete tournament.projected;
}

// the final version goes over the projected one. one that no longer splits into the same number of
// messages can't, so it goes out on its own under a line saying what it is
async function editPosts(postChannel, refs, list, type, label) {
  const batches = embeds.messages(list);
  if (batches.length === refs.length) {
    for (const [i, ref] of refs.entries()) await editPost(postChannel, ref, { embeds: batches[i] });
    return;
  }
  for (const [i, batch] of batches.entries()) {
    if (messageEnabled(type)) await postChannel.send({ content: i ? undefined : label, embeds: batch, allowedMentions: { parse: [] } });
  }
}

// every event the crew played in, with the whole top 8 and not just them
async function topEightEvents(entries) {
  const events = [...new Map(entries.filter((entry) => entry.eventId).map((entry) => [entry.eventId, entry])).values()];
  if (!events.length) return [];
  const standings = await startgg.getTopEight(events.map((entry) => entry.eventId));
  return events.filter((entry) => standings.has(entry.eventId)).map((entry) => ({ ...entry, ...standings.get(entry.eventId) }));
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
        await sendPinging(postChannel, 'registration', ping, lastCall ? 'last call' : 'registration reminder', embeds.regReminder(tournament, deadline, lastCall));
      }
      // past the last call means none are left
      reminder.next = due + 1;
    } catch (err) {
      console.error(`reg reminder for ${reminder.name} failed:`, err.message);
    }
  }
  save();
}
