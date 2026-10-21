import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { syncDiscordEvents } from '../discord-events.js';
import { checkMatchmakingExpiry } from '../commands/matchmaking.js';
import { channel, setChannel, secondsNow, health, queued, SET_CHECK_MINUTES, TOURNAMENT_CHECK_MINUTES, PROFILE_CHECK_HOURS, SLIPPI_CHECK_MINUTES, PRUNE_CHECK_DAYS, PRUNE_AFTER_DAYS, EVENT_SYNC_MINUTES, BILLS_BASELINE_HOURS, CATCH_UP_HOURS, HOUR, DAY } from './shared.js';
import { updateTournaments } from './tournaments.js';
import { postNewSets, fixCorrectedResults } from './sets.js';
import { postStreamAlerts } from './streams.js';
import { postMatchCalls, followCalls } from './calls.js';
import { clearFinishedButtons } from './buttons.js';
import { postRegReminders, postDmReminders } from './reminders.js';
import { postWeeklyRecap } from './recap.js';
import { findSlippiCodes, postRankChanges } from './slippi.js';
import { postBillsResults } from './bills.js';

// railway gives each deploy an id but no time, so the first start under a new id is when it went live.
// railway restarting the same deploy keeps that time. the commit message goes with it for the bot
// update post. no commit id anywhere, the date and message are enough
export function recordDeploy(env = process.env) {
  const id = env.RAILWAY_DEPLOYMENT_ID;
  if (!id || state.deploy?.id === id) return null;
  const message = String(env.RAILWAY_GIT_COMMIT_MESSAGE ?? '').split('\n')[0].trim().slice(0, 200);
  state.deploy = message ? { id, at: secondsNow(), message } : { id, at: secondsNow() };
  save();
  return state.deploy;
}

// when the running version went live. a local run has none, so it never shows railway's
export function deployedAt(env = process.env) {
  return env.RAILWAY_DEPLOYMENT_ID && state.deploy?.id === env.RAILWAY_DEPLOYMENT_ID ? state.deploy.at : null;
}

// a new railway deployment going live, once. the id is already saved, so a restart won't repeat it
export async function postDeployUpdate(postChannel = channel, deploy = state.deploy) {
  if (!deploy) return;
  try {
    await postChannel.send({ embeds: embeds.withImage([embeds.deployUpdate(deploy)]), allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('posting the bot update failed:', err.message);
  }
}

export function startTracking(postChannel) {
  setChannel(postChannel);
  const deployed = recordDeploy();

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
  migrateTracking();
  save();
  // a new railway deployment posts once, before the checks start their own posts
  if (deployed) postDeployUpdate(postChannel, deployed).catch(console.error);

  checkTournaments();
  checkSets();
  checkProfiles();
  checkRegReminders();
  checkDmReminders();
  checkWeeklyRecap();
  checkSlippiCodes();
  checkSlippiRanks();
  loopBills();
  checkPrune();
  checkDiscordEvents();
  checkMatchmaking();
  setInterval(checkDiscordEvents, EVENT_SYNC_MINUTES * 60 * 1000);
  setInterval(checkTournaments, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkRegReminders, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkDmReminders, TOURNAMENT_CHECK_MINUTES * 60 * 1000);
  setInterval(checkSets, SET_CHECK_MINUTES * 60 * 1000);
  setInterval(checkProfiles, PROFILE_CHECK_HOURS * HOUR * 1000);
  setInterval(checkSlippiCodes, PROFILE_CHECK_HOURS * HOUR * 1000);
  setInterval(checkSlippiRanks, SLIPPI_CHECK_MINUTES * 60 * 1000);
  setInterval(checkPrune, PRUNE_CHECK_DAYS * DAY * 1000);
  setInterval(checkWeeklyRecap, 60 * 1000);
  setInterval(checkMatchmaking, 60 * 1000);
}

// saved from before tournaments could be tracked. a reg reminder becomes a tracked tournament with reminders
// on. match call pings were a switch anyone could flip on a player, now they're each person's own, so a player's
// discord keeps them only if the server switch was on and they were actually getting pinged. tournament admins
// gave way to the TO role, and their tournaments stay tracked. a discord event id moves to state.discordEvents
// unsynced, so the next sync puts start.gg's latest on it, venue address included
export function migrateTracking(now = secondsNow()) {
  delete state.regAdmins;
  delete state.regSkipped;
  delete state.dqWarnPings;
  delete state.messages.callsWarn;
  delete state.messages.callsDq;
  for (const tournament of Object.values(state.tournaments)) {
    if (!tournament.discordEventId) continue;
    state.discordEvents[tournament.id] ??= { eventId: tournament.discordEventId, slug: tournament.slug, startAt: tournament.startAt, synced: null };
    delete tournament.discordEventId;
  }

  for (const reminder of Object.values(state.regReminders ?? {})) {
    const { id, name, slug, startAt, endAt, images } = reminder;
    const tournament = state.tournaments[id] ??= { id, name, slug, startAt, endAt, images: images ?? [], entries: [], userIds: [] };
    if (!tournament.tracked) trackTournament(tournament, 'manual', now);
    tournament.reminder = { deadline: reminder.deadline, next: reminder.next };
  }
  delete state.regReminders;

  const pinging = state.messages?.calls === true;
  for (const player of Object.values(state.players)) {
    if (player.callPings === true && pinging && player.discordId && !state.callPings.includes(player.discordId)) state.callPings.push(player.discordId);
    delete player.callPings;
  }
}

// /track add saves this. set results and stream alerts start off since everyone with them on goes in a
// check every 2 minutes. /track posts turns them on. trackedAt is when they were added, so the prune knows
// a player with no sets yet isn't inactive
export function newTracked(player) {
  return { ...player, lastCheck: secondsNow(), trackedAt: secondsNow(), streamAlerts: false, setResults: false };
}

// /t-o tournament add, or a reminder from before tournaments were tracked. everything it posts starts on and
// /t-o tournament posts turns parts off. its sets are looked at from now on, so tracking one partway through
// doesn't flood its thread with what already happened. reminder fills in at the next reminder check
export function trackTournament(tournament, by, now = secondsNow()) {
  tournament.tracked = { by, at: now, sets: true, stream: true, top8: true, reminders: true };
  tournament.reminder ??= {};
  tournament.lastCheck = now;
  // looked at on the next check even when it's far off, for its events and crew
  tournament.checkedAt = 0;
  return tournament;
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
export const checkDmReminders = queued(postDmReminders);
const checkWeeklyRecap = queued(postWeeklyRecap);
const checkSlippiCodes = queued(findSlippiCodes);
const checkSlippiRanks = queued(postRankChanges);
const checkPrune = queued(pruneInactive);
const checkDiscordEvents = queued(() => syncDiscordEvents(channel?.guild));
// discord only, no start.gg, but queued keeps one run at a time like the rest
const checkMatchmaking = queued(() => checkMatchmakingExpiry(channel?.guild));

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
