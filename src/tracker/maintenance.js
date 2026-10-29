import { ActivityType } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { t } from '../i18n.js';
import {
  forGuild, guildId, guildIds, guildLocal, isMultiGuild, migrateLegacyToGuild, postsChannelId, readHeartbeat, writeHeartbeat, state, save,
} from '../store.js';
import { syncDiscordEvents } from '../discord-events.js';
import { checkMatchmakingExpiry } from '../commands/matchmaking.js';
import {
  currentChannel, inChannel, setChannel, secondsNow, health, queued, OUTAGE_MINUTES, HEARTBEAT_SECONDS, SET_CHECK_MINUTES, TOURNAMENT_CHECK_MINUTES,
  PROFILE_CHECK_HOURS, SLIPPI_CHECK_MINUTES, PRUNE_CHECK_DAYS, PRUNE_AFTER_DAYS, EVENT_SYNC_MINUTES, BILLS_BASELINE_HOURS, CATCH_UP_HOURS, HOUR, DAY,
} from './shared.js';
import { updateTournaments } from './tournaments.js';
import { postNewSets, fixCorrectedResults } from './sets.js';
import { postStreamAlerts } from './streams.js';
import { postMatchCalls, followCalls } from './calls.js';
import { postNextOpponents, followNextOpponents } from './next.js';
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

// how long the bot was off before this start, by the heartbeat, when that's long enough that people noticed.
// null for a normal restart or redeploy, and on the very first start
export function lastOutage(now = secondsNow()) {
  const at = readHeartbeat();
  return at && now - at >= OUTAGE_MINUTES * 60 ? { from: at, to: now } : null;
}

// what goes out when the bot starts: the bot update for a new deployment, with the outage on the same card
// when there was one, or a back online card for an outage alone. single-server builds pass their channel,
// multi-server ones post in every server's
const noticesSending = new Set();
export async function postStartNotice({ deploy = null, outage = null }, postChannel = null) {
  if (!deploy && !outage) return;
  const send = async (target, where = '') => {
    const key = guildId() ?? 'single';
    const update = deploy && state.deployNotice?.id !== deploy.id;
    if (noticesSending.has(key) || (!update && !outage)) return;
    noticesSending.add(key);
    try {
      const card = update ? embeds.deployUpdate(deploy, outage, CATCH_UP_HOURS) : embeds.backOnline(outage, CATCH_UP_HOURS);
      await target.send({ embeds: embeds.withImage([card]), allowedMentions: { parse: [] } });
      if (update) {
        state.deployNotice = { id: deploy.id };
        save();
      }
    } catch (err) {
      console.error(`posting ${update ? 'the bot update' : 'the back online notice'} failed${where}:`, err.message);
    } finally {
      noticesSending.delete(key);
    }
  };
  if (postChannel) return send(postChannel);
  await eachGuild((id, channel) => send(channel, ` in ${id}`));
}

// the bot's discord status says when start.gg is down, so someone whose command failed can see it's not just
// them. checked every 30 seconds, and only sent to discord when it changes
const PRESENCE_SECONDS = 30;
let shownDown = false;

export function outagePresence(downSince) {
  if (!downSince) return { status: 'online', activities: [] };
  return { status: 'idle', activities: [{ type: ActivityType.Custom, name: t('start.gg is down'), state: t('start.gg is down, lookups wait until it\'s back') }] };
}

export function updatePresence(client, downSince = startgg.startggDownSince()) {
  const down = Boolean(downSince);
  if (down === shownDown || !client?.user) return;
  shownDown = down;
  try {
    client.user.setPresence(outagePresence(downSince));
  } catch (err) {
    console.error('changing the bot\'s status failed:', err.message);
  }
}

// every repeating check and the bills timer, so a shutdown stops them all instead of leaving them running
const intervals = [];
let billsTimeout = null;
let stopping = false;

// the heartbeat and the status, for both kinds of start. the outage gets read before the first heartbeat
// replaces it
function watchUptime(client) {
  const now = secondsNow();
  const outage = lastOutage(now);
  writeHeartbeat(now);
  shownDown = false;
  intervals.push(
    setInterval(() => writeHeartbeat(secondsNow()), HEARTBEAT_SECONDS * 1000),
    setInterval(() => updatePresence(client), PRESENCE_SECONDS * 1000),
  );
  return outage;
}

// one server's posts go in its own channel, set by /t-o settings channel:. the old GUILD_ID/CHANNEL_ID
// pair migrates into that server's entry, so the first multi-server boot keeps posting there.
// a cached channel only counts while it's still the saved one, so /t-o settings channel: takes effect on the next check
let botClient = null;
const channelCache = new Map();

export async function guildChannel(guildId) {
  const channelId = postsChannelId(guildId);
  if (!channelId) return null;
  const cached = channelCache.get(guildId);
  if (cached?.id === channelId) return cached;
  try {
    const found = await botClient?.channels.fetch(channelId);
    if (!found?.isTextBased()) return null;
    channelCache.set(guildId, found);
    return found;
  } catch {
    return null;
  }
}

// drops one server's cached posts channel, so the next check fetches the new one.
// used when the bot leaves a server and when a channel send says it's gone
export function dropGuildChannel(guildId) {
  channelCache.delete(guildId);
}

// for tests, which hand it a fake client instead of a logged in one
export function setBotClient(client) {
  botClient = client;
}

// multi-server only: every server's checks run in one pass, in its own guild entry, with its
// own channel. single-server builds run the same checks once on the root, with CHANNEL_ID.
// one run at a time (see queued below) so nothing posts twice. servers the bot already left
// are skipped once the guild cache is up, so their saved entries don't cost a channel fetch
// the servers' parts share one pass of start.gg answers, so a tournament two servers track gets asked about once
export function eachGuild(fn) {
  return startgg.sharingAcrossServers(async () => {
    const saved = new Set(guildIds());
    const ids = new Set([...saved, ...(botClient?.guilds?.cache.keys() ?? [])]);
    const gone = botClient?.guilds?.cache?.size ? (id) => saved.has(id) && !botClient.guilds.cache.has(id) : () => false;
    for (const id of ids) {
      if (gone(id)) continue;
      forGuild(id);
      const postChannel = await guildChannel(id);
      if (!postChannel) continue;
      try {
        await guildLocal.run(id, () => inChannel(postChannel, () => fn(id, postChannel)));
      } catch (err) {
        console.error(`background check failed in ${id}:`, err.message);
      }
    }
  });
}

function runScoped(fn) {
  return isMultiGuild() ? eachGuild(fn) : fn();
}

// stops the loops started below, for a shutdown. in-flight checks finish on their own
export function stopTracking() {
  stopping = true;
  for (const id of intervals.splice(0)) clearInterval(id);
  if (billsTimeout) clearTimeout(billsTimeout);
  channelCache.clear();
}

// fills in what older state files were saved without. runs on the root, or inside each server
function migrateSaved() {
  // saved from before userIds existed
  for (const tournament of Object.values(state.tournaments)) {
    tournament.entries ??= [];
    tournament.userIds ??= [...new Set(tournament.entries.map((entry) => entry.userId))];
  }
  // saved from before trackedAt existed. lastSetAt means they played while tracked, so it
  // counts as the start. otherwise now, so nobody gets pruned for time before this was kept
  for (const player of Object.values(state.players)) {
    player.trackedAt ??= player.lastSetAt ?? secondsNow();
  }
  migrateTracking();
}

const lastChecks = () => Object.values(state.players).map((player) => player.lastCheck).filter(Boolean);

// lastCheck only moves while the set check runs, so the oldest one is when the bot went down. the heartbeat
// knows better when there is one
function noteDowntime(oldest, outage, now) {
  if (oldest < now - 2 * SET_CHECK_MINUTES * 60) {
    health.downSince = oldest;
    if (oldest < now - CATCH_UP_HOURS * HOUR) health.skippedBefore = now - CATCH_UP_HOURS * HOUR;
  }
  if (outage) health.downSince = outage.from;
}

// every check once now, in this order, then every so many seconds. the bills have their own loop below
function startChecks() {
  const checks = [
    [checkTournaments, TOURNAMENT_CHECK_MINUTES * 60],
    [checkSets, SET_CHECK_MINUTES * 60],
    [checkProfiles, PROFILE_CHECK_HOURS * HOUR],
    [checkRegReminders, TOURNAMENT_CHECK_MINUTES * 60],
    [checkDmReminders, TOURNAMENT_CHECK_MINUTES * 60],
    [checkWeeklyRecap, 60],
    [checkSlippiCodes, PROFILE_CHECK_HOURS * HOUR],
    [checkSlippiRanks, SLIPPI_CHECK_MINUTES * 60],
    [checkPrune, PRUNE_CHECK_DAYS * DAY],
    [checkDiscordEvents, EVENT_SYNC_MINUTES * 60],
    [checkMatchmaking, 60],
  ];
  for (const [check] of checks) check();
  loopBills();
  intervals.push(...checks.map(([check, seconds]) => setInterval(check, seconds * 1000)));
}

// single-server builds post in CHANNEL_ID with everything on the root state. multi-server builds post in
// each server's channel from /t-o settings channel:
export function startTracking(client, singleChannel = null) {
  stopping = false;
  const now = secondsNow();
  const checked = [];
  if (isMultiGuild()) {
    botClient = client;
    // old single-server installs keep their track list: the root becomes that server's entry
    if (process.env.GUILD_ID) migrateLegacyToGuild(process.env.GUILD_ID, process.env.CHANNEL_ID);
    for (const guild of client?.guilds.cache.values() ?? []) forGuild(guild.id);
    for (const id of guildIds()) {
      guildLocal.run(id, () => {
        migrateSaved();
        checked.push(...lastChecks());
      });
    }
  } else {
    setChannel(singleChannel);
    migrateSaved();
  }
  // the root, for single-server builds and a multi-server one that has no servers yet
  if (!checked.length) checked.push(...lastChecks());
  const deployed = recordDeploy();
  const outage = watchUptime(client ?? singleChannel?.client);
  noteDowntime(checked.length ? Math.min(...checked) : Infinity, outage, now);
  save();
  // a new railway deployment or an outage posts once, before the checks start their own posts
  const currentDeploy = () => deployedAt() === null ? null : state.deploy;
  const noticeChannel = () => isMultiGuild() ? null : currentChannel();
  postStartNotice({ deploy: deployed ?? currentDeploy(), outage }, noticeChannel()).catch(console.error);
  intervals.push(setInterval(() => {
    postStartNotice({ deploy: currentDeploy() }, noticeChannel()).catch(console.error);
  }, 60 * 1000));
  startChecks();
}

// saved from before tournaments could be tracked. a reg reminder becomes a tracked tournament that follows the
// server's switches, and migrateTournamentPosts moves the old per-tournament ones to overrides. match call pings
// were a switch anyone could flip on a player, now they're each person's own, so a player's
// discord keeps them only if the server switch was on and they were actually getting pinged. tournament admins
// gave way to the TO role, and their tournaments stay tracked. a discord event id moves to state.discordEvents
// unsynced, so the next sync puts start.gg's latest on it, venue address included
export function migrateTracking(now = secondsNow()) {
  delete state.regAdmins;
  delete state.regSkipped;
  delete state.dqWarnPings;
  delete state.messages.callsWarn;
  delete state.messages.callsDq;
  migrateTournamentPosts();
  for (const tournament of Object.values(state.tournaments)) {
    if (!tournament.discordEventId) continue;
    state.discordEvents[tournament.id] ??= { eventId: tournament.discordEventId, slug: tournament.slug, startAt: tournament.startAt, synced: null };
    delete tournament.discordEventId;
  }

  // single-server leftovers live on the root, but tournaments live per server. only the migrated
  // server claims them, so whichever guild checks first doesn't take another server's reminders
  const legacyId = process.env.GUILD_ID;
  if (!isMultiGuild() || !legacyId || guildId() === legacyId) {
    for (const reminder of Object.values(state.regReminders ?? {})) {
      const { id, name, slug, startAt, endAt, images } = reminder;
      const tournament = state.tournaments[id] ??= { id, name, slug, startAt, endAt, images: images ?? [], entries: [], userIds: [] };
      if (!tournament.tracked) trackTournament(tournament, 'manual', now);
      tournament.reminder = { deadline: reminder.deadline, next: reminder.next };
    }
    delete state.regReminders;
  }

  const pinging = state.messages.calls === true;
  for (const player of Object.values(state.players)) {
    const keeps = player.callPings === true && pinging && player.discordId;
    if (keeps && !state.callPings.includes(player.discordId)) state.callPings.push(player.discordId);
    delete player.callPings;
  }
}

// a tracked tournament used to save every switch as its own field, all on but match calls. now the server's
// /t-o settings is the default and only what a TO changed is saved, so the old fields become overrides where they
// differ from what they started as, once, for tournaments with no posts yet
const OLD_SWITCHES = { sets: ['sets', true], stream: ['streams', true], calls: ['calls', false], top8: ['top8', true], reminders: ['registration', true] };

export function migrateTournamentPosts() {
  for (const { tracked } of Object.values(state.tournaments)) {
    if (!tracked || tracked.posts) continue;
    tracked.posts = {};
    for (const [old, [kind, fixed]] of Object.entries(OLD_SWITCHES)) {
      if (typeof tracked[old] === 'boolean' && tracked[old] !== fixed) tracked.posts[kind] = tracked[old];
      delete tracked[old];
    }
  }
}

// /track add saves this. set results and stream alerts start off since everyone with them on goes in a
// check every 2 minutes. /track posts turns them on. trackedAt is when they were added, so the prune knows
// a player with no sets yet isn't inactive
export function newTracked(player) {
  return { ...player, lastCheck: secondsNow(), trackedAt: secondsNow(), streamAlerts: false, setResults: false };
}

// /t-o tournament add, or a reminder from before tournaments were tracked. it saves no switches, so every kind
// follows the server's setting until /t-o tournament posts overrides one for this tournament. its sets are looked
// at from now on, so tracking one partway through doesn't flood its thread with what already happened. reminder
// fills in at the next reminder check
export function trackTournament(tournament, by, now = secondsNow()) {
  tournament.tracked = { by, at: now, posts: {} };
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

// each runs on the root, or once per server in multi-server builds. the arrow functions keep eachGuild's
// arguments away from the ones that take a time
const checkSets = queued(() => runScoped(async () => {
  await postNewSets();
  await fixCorrectedResults();
  await postStreamAlerts();
  await postMatchCalls();
  await followCalls();
  // crossed out before the check, so a changed pairing's new card posts in the same run
  await followNextOpponents();
  await postNextOpponents();
  await clearFinishedButtons();
}));
export const checkTournaments = queued(() => runScoped(() => updateTournaments()));
const checkProfiles = queued(() => runScoped(() => updateProfiles()));
export const checkRegReminders = queued(() => runScoped(() => postRegReminders()));
export const checkDmReminders = queued(() => runScoped(() => postDmReminders()));
const checkWeeklyRecap = queued(() => runScoped(() => postWeeklyRecap()));
const checkSlippiCodes = queued(() => runScoped(() => findSlippiCodes()));
const checkSlippiRanks = queued(() => runScoped(() => postRankChanges()));
const checkPrune = queued(() => runScoped(() => pruneInactive()));
const checkDiscordEvents = queued(() => runScoped(() => syncDiscordEvents(currentChannel()?.guild)));
// discord only, no start.gg, but queued keeps one run at a time like the rest
const checkMatchmaking = queued(() => runScoped(() => checkMatchmakingExpiry(currentChannel()?.guild)));

// Bills runs on its own loop since game day polls tighter than the baseline. each server's results say when
// to look next, and the soonest wins. stopping skips the next round, so a shutdown doesn't leave a timer running
let billsRunning = false;
async function loopBills() {
  let delay = BILLS_BASELINE_HOURS * HOUR * 1000;
  if (!billsRunning) {
    billsRunning = true;
    try {
      const delays = [];
      await runScoped(async () => delays.push(await postBillsResults()));
      if (delays.length) delay = Math.min(...delays);
    } finally {
      billsRunning = false;
    }
  }
  if (stopping) return;
  if (billsTimeout) clearTimeout(billsTimeout);
  billsTimeout = setTimeout(loopBills, delay);
}
