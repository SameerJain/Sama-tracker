import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';

// where state.json lives. STATE_DIR works anywhere, Railway sets its own when a volume is attached,
// and anything else is wiped on redeploy, so the fallback is only for local runs. one file holds every
// server: state.guilds[guildId] is that server's track list, settings and posts
export const stateDir = process.env.STATE_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data';
const FILE = `${stateDir}/state.json`;

// which guild's data the current command or background check is using. tests run outside it
export const guildLocal = new AsyncLocalStorage();
export const guildId = () => guildLocal.getStore() ?? null;

// multi-server mode is opt-in. unset means the original single-server build: GUILD_ID and
// CHANNEL_ID are required, commands register to that one server, and everything reads the
// root state. MULTI_GUILD=true serves every server it's invited to, each with its own
// guild entry picked by /t-o settings channel:
export const isMultiGuild = () => process.env.MULTI_GUILD === 'true';

// what's in state, server by server:
//
// players are tracked players keyed by start.gg user id. links are start.gg accounts keyed by the discord id that
// ran /link. accounts are start.gg user ids keyed by the discord id connected to them, from participant lists.
// posted, streamed, called and dqs are set and entrant ids already announced.
// regPings, streamPings and callPings are discord ids with /notify registration, streams or calls on. regDmPings and
// startDmPings are the same for the 1-hour DMs before registration closes and before the start.
// toRole is the TO role: { id, members, seeded }. id is the discord role, members the discord ids the bot has seen
// with it, for /t-o role list, and seeded whether the first TO got it.
//
// tournaments are keyed by id: the ones tracked players are in, and tracked ones.
//   tracked: { by, at, posts, onAt, schedule } says it's tracked. by is 'manual', or 'admin' from before the TO role.
//   posts holds only what a TO changed with /t-o tournament posts, { sets, streams, calls, next, top8, registration }
//   as booleans. a kind left out follows the server's /t-o settings, live. onAt is when each override was turned on,
//   in unix seconds, so what came due before then stays skipped. schedule is the TO's own reminder
//   times in hours before registration closes, most first, left out for the default.
//   reminder: { deadline, next } is its reg reminder progress, next being the index into that schedule.
//   dmRegSentFor and dmStartSentFor are the close and start times its 1-hour DMs went out for.
//   events are all its events from start.gg. notableUpsets are tracked players' big upset wins, saved as their sets
//   posted, for the results card. crew is the registered server members who aren't tracked, keyed by user id as
//   { userId, slug, tag }, so cards can name them. lastCheck is when its sets were last checked, like a player's.
//   projected: { at, checkedAt, results, top8 } means placements went out projected, each list being the
//   { channelId, messageId } posts to edit once they're final. an empty top8 list with top8Posted unset means nothing
//   was reported yet, and the final goes out as a new message once every event is finished.
//   top8Posted means its top 8 went out or was switched off, and top8Failed that it's being retried hourly for 3 days.
//
// socials are { name, url } in the order they were added. messages holds the /t-o settings switches, recap schedule and language,
// and weeklyRecap is the recap partway through sending, built once so a restart sends the rest.
// slippi is the /slippi watchlist keyed by slippi user id, which outlasts a code change, with the ranked numbers from
// the last check. userId is set when the code came from that start.gg player's netplay registrations, and discordId
// when someone who isn't a TO typed it in as theirs. lastSeason is { at, characters, global, regional } from the last
// check before their profile turned over to a new season, for the wrap-up.
// slippiSkipped are slippi user ids /slippi remove took off, so the code search doesn't add them back, and
// slippiWrapped the names of the seasons that got a wrap-up, so each goes out once.
// threads are the threads from /t-o settings threads, keyed by tournament slug, or event slug for one per event:
// { id, at, channelId, messageId, pinned }. the last three are its card in the channel, pinned saying if the pin
// worked, so it comes off once the tournament or event is over.
// recentPicks are the start.gg user ids each discord id last picked in a player option, newest first, for autocomplete.
// nextPings are discord ids with /notify next on. nextPosted are the pairings whose next opponent card went out, as
// `setId:side:side` with each side's player ids joined by + (1000 kept), so the same two in a set post once. nextPosts
// are the cards still watched for 60 minutes: { setId, key, channelId, messageId, at, discordIds, text } (200 kept),
// key being that pairing, discordIds who got pinged, and text the ping as it went out, so a changed pairing crosses it out.
// buttons are match calls and stream alerts still showing a Head to head button: { setId, channelId, messageId, at }.
// resultPosts are set results still watched for a TO's fix: { setId, channelId, messageId, at, outcome, reset }, with
// outcome being startgg.outcomeOf when it was last shown.
// callPosts are match calls still watched for going back to waiting: { setId, channelId, messageId, calledAt,
// discordIds, text }, text being the You're up ping as it went out, so an uncalled edit matches it.
// streamPinged is who already got pinged for a live streamed set: { setId, discordIds }.
// regWarned are /reg_warn pings: { tournamentId, discordId, at }, so nobody is warned twice for a tournament.
// billsPosted are the ESPN ids of Bills finals already posted.
// matchmaking is each game's matchmaking role id, keyed ult and melee, so a role renamed in server settings still
// counts. matchmakingChannels is the channel id each game's searches post in, left out for wherever the command ran.
// matchmakingExpiry is when timed roles from /matchmaking role duration come off, in unix seconds keyed
// `discordId:game`, so a restart doesn't cancel them. matchmakingThreads are { id, at } for threads the bot deletes
// 24 hours after /matchmaking search made them.
// discordEvents are the Discord scheduled events the bot made or found, keyed by start.gg tournament id, so
// /t-o tournament event, /t-o tournament add add_event and /t-o settings events all land on the same one:
// { eventId, slug, startAt, synced, gone }. synced is start.gg's side as of the last sync, null until one ran, and gone
// means a mod deleted it, it started or start.gg deleted the tournament, so it's left alone.
//
// and once per bot, in GLOBAL_KEYS below:
//
// deploy is the railway deployment that last started: { id, at, message }, at being the first time it started and
// message the first line of RAILWAY_GIT_COMMIT_MESSAGE when there was one, for the bot update post. no commit id.
// funQueue are the prefetched fun and bills posts still waiting, keyed by command name, so a restart serves them
// instead of throwing away paid-for Claude posts. each is saved without its image bytes, which get downloaded again.
// billsMeta is { lastImage, kinds }, so the bills no-repeat and even photo/gif rotation survive a restart too.
const emptyGuild = {
  channelId: null,
  players: {}, links: {}, accounts: {},
  posted: [], streamed: [], called: [], dqs: [],
  regPings: [], streamPings: [], callPings: [], regDmPings: [], startDmPings: [],
  toRole: { id: null, members: [], seeded: false },
  tournaments: {},
  socials: [], messages: {}, weeklyRecap: null,
  slippi: {}, slippiSkipped: [], slippiWrapped: [],
  threads: {}, recentPicks: {}, buttons: [], resultPosts: [], callPosts: [], streamPinged: [], regWarned: [], billsPosted: [],
  nextPings: [], nextPosted: [], nextPosts: [],
  matchmaking: {}, matchmakingChannels: {}, matchmakingExpiry: {}, matchmakingThreads: [], discordEvents: {},
};

// the root also keeps a copy of every guild key so old state files and tests keep working, and live servers
// read their guild's copy through the state proxy below. deploy is one per bot. the fun queues and the bills
// rotation are one per bot too: posts get made ahead at startup, outside any server, so a per-server copy
// would save them where no command reads them
const GLOBAL_KEYS = new Set(['deploy', 'guilds', 'funQueue', 'billsMeta']);
const empty = {
  ...structuredClone(emptyGuild),
  deploy: null, guilds: {}, funQueue: {}, billsMeta: {},
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameShape(value, fallback) {
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (isPlainObject(fallback)) return isPlainObject(value);
  // null defaults like weeklyRecap and deploy are null or an object
  if (fallback === null) return value === null || isPlainObject(value);
  return true;
}

// a valid file with the wrong shape shouldn't stick: one bad key falls back to its default instead of
// crashing whoever reads it later
function withDefaults(parsed, defaults) {
  if (!isPlainObject(parsed)) return structuredClone(defaults);
  const out = { ...structuredClone(defaults), ...parsed };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (out[key] === undefined || !sameShape(out[key], fallback)) out[key] = structuredClone(fallback);
  }
  return out;
}

export function cleanState(parsed) {
  const out = withDefaults(parsed, empty);
  for (const [id, guild] of Object.entries(out.guilds)) {
    out.guilds[id] = withDefaults(guild, emptyGuild);
    // a server saved before these were one per bot had its own copy, which nothing reads now
    for (const key of GLOBAL_KEYS) delete out.guilds[id][key];
  }
  return out;
}

// the stored data for one server, made on first use. channelId is where its posts go,
// set by /t-o settings channel: (or the old CHANNEL_ID for the migrated server)
export function forGuild(id) {
  if (!id) return null;
  raw.guilds[id] ??= structuredClone(emptyGuild);
  return raw.guilds[id];
}

// what a read sees, without making an entry. writes still go through forGuild above,
// so a check that only looks never dirties the file with an empty server
function peekGuild(id) {
  if (!id) return null;
  return raw.guilds[id] ?? null;
}

export function guildIds() {
  return Object.keys(raw.guilds);
}

// where a server's automatic posts go. single-server builds always use CHANNEL_ID. multi-server builds use
// the channel picked with /t-o settings channel:, and the server migrated from GUILD_ID falls back to CHANNEL_ID until it picks one.
// looking it up never makes the entry, so a stray id can't fill the file with empty servers
export function postsChannelId(id = guildId()) {
  if (!isMultiGuild()) return process.env.CHANNEL_ID ?? null;
  if (!id) return null;
  return peekGuild(id)?.channelId ?? (id === process.env.GUILD_ID ? process.env.CHANNEL_ID ?? null : null);
}

// copy the old single-server root into that server's entry once, so nobody loses their
// track list. runs at startup for GUILD_ID/CHANNEL_ID, then those env vars are just fallback
export function migrateLegacyToGuild(id, channelId = null) {
  if (!id) return null;
  const guild = forGuild(id);
  const hasData = Object.keys(guild.players).length || Object.keys(guild.tournaments).length;
  if (!hasData) {
    for (const key of Object.keys(emptyGuild)) {
      if (key === 'channelId') continue;
      guild[key] = structuredClone(raw[key] ?? emptyGuild[key]);
    }
  }
  if (!guild.channelId && channelId) guild.channelId = channelId;
  return guild;
}

function load() {
  if (!fs.existsSync(FILE)) return structuredClone(empty);
  try {
    return cleanState(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch (err) {
    // a half-written main file shouldn't wipe the track list: fall back to the
    // backup from the last good save, and only quit when both are unreadable
    try {
      console.error(`couldn't read ${FILE} (${err.message}), trying ${FILE}.bak`);
      return cleanState(JSON.parse(fs.readFileSync(`${FILE}.bak`, 'utf8')));
    } catch {
      console.error(`couldn't read ${FILE} (${err.message}), fix or delete it`);
      process.exit(1);
    }
  }
}

const raw = load();

// the server's own copy when a per-server key gets used inside guildLocal.run(), otherwise null.
// reads peek so they never make an entry, writes go through forGuild so there's somewhere to put them
function guildFor(key, ensure) {
  const id = guildLocal.getStore();
  if (!id || typeof key !== 'string' || GLOBAL_KEYS.has(key) || !Object.hasOwn(emptyGuild, key)) return null;
  return ensure ? forGuild(id) : peekGuild(id);
}

// live code reads state.players etc, which routes to the current guild's copy inside
// guildLocal.run(), and to the root otherwise, which single-server builds, tests and DMs use
export const state = new Proxy(raw, {
  get(target, key, receiver) {
    const guild = guildFor(key, false);
    return guild ? guild[key] : Reflect.get(target, key, receiver);
  },
  set(target, key, value) {
    (guildFor(key, true) ?? target)[key] = value;
    return true;
  },
  deleteProperty(target, key) {
    delete (guildFor(key, true) ?? target)[key];
    return true;
  },
  has(target, key) {
    return key in (guildFor(key, false) ?? target);
  },
  getOwnPropertyDescriptor(target, key) {
    const guild = guildFor(key, false);
    if (!guild) return Object.getOwnPropertyDescriptor(target, key);
    return Object.getOwnPropertyDescriptor(guild, key) ?? { configurable: true, enumerable: true, value: undefined, writable: true };
  },
  ownKeys(target) {
    return Reflect.ownKeys(target);
  },
});

// saves so far, for /status
export let saveCount = 0;
let backedUpAt = 0;
// a backup every hour at most, so a corrupt main file falls back to something recent
const BACKUP_HOURS = 1;

// write + fsync + rename so a crash can't leave it half written. 0600 so ids in it aren't world readable.
// stringifies the raw file, not the guild-scoped proxy, so saving inside one server keeps the others
export function save() {
  fs.mkdirSync(stateDir, { recursive: true });
  const text = JSON.stringify(raw, null, 2);
  fs.writeFileSync(`${FILE}.tmp`, text, { mode: 0o600 });
  // best effort: windows temp files refuse this, the rename below is the real safety
  try {
    const fd = fs.openSync(`${FILE}.tmp`, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // keep going, the tmp file is fully written either way
  }
  fs.renameSync(`${FILE}.tmp`, FILE);
  saveCount++;
  if (Date.now() - backedUpAt > BACKUP_HOURS * 60 * 60 * 1000) {
    backedUpAt = Date.now();
    fs.writeFileSync(`${FILE}.bak`, text, { mode: 0o600 });
  }
}

// a tiny file rewritten every minute while the bot is up, so the next start knows how long it was off.
// state.json only saves when something changed, so it can't say that
const HEARTBEAT = `${stateDir}/heartbeat`;

export function readHeartbeat() {
  try {
    const at = Number(fs.readFileSync(HEARTBEAT, 'utf8'));
    return Number.isInteger(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export function writeHeartbeat(at) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(HEARTBEAT, String(at));
  } catch (err) {
    console.error(`couldn't write the heartbeat (${err.message})`);
  }
}
