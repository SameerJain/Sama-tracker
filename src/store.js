import fs from 'node:fs';

// where state.json lives. STATE_DIR works anywhere; Railway sets its own when a volume is
// attached, and anything else is wiped on redeploy, so the fallback is only for local runs
export const stateDir = process.env.STATE_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data';
const FILE = `${stateDir}/state.json`;

// players are keyed by start.gg user id. posted/streamed/called/dqs are ids already announced.
// regPings, streamPings and callPings are discord ids that turned on /notify registration, streams or calls. regDmPings and startDmPings are the 1-hour
// DM versions for registration and the start.
// toRole is the TO role: { id, members, seeded }, id being the discord role, members the discord ids the bot has seen with it, for /t-o role list,
// and seeded whether the first TO got it.
// tournaments are keyed by id: the ones tracked players are in, and tracked ones. tracked: { by, at, sets, stream, top8, reminders } says it's tracked,
// by being 'manual', or 'admin' from before the TO role, and the rest its /t-o tournament posts switches. reminder: { deadline, next } is its reg reminder progress, next being the
// index into REG_REMINDER_HOURS. dmRegSentFor and dmStartSentFor are the close and start times its 1-hour DMs went out for. events are all its events from start.gg. crew is the registered server members who aren't tracked,
// keyed by user id as { userId, slug, tag }, so cards can name them. lastCheck is when its sets were last checked, the way it is on a player.
// links are start.gg accounts keyed by the discord id that ran /link. socials are { name, url } in the order they were added.
// accounts are start.gg user ids keyed by the discord id connected to them, from tournament participant lists.
// messages holds the /messages switches and recap schedule. weeklyRecap is the recap partway through sending, built once so a restart sends the rest.
// deploy is the railway deployment that last started: { id, at }, with at the first time it started.
// slippi is the /slippi watchlist keyed by slippi user id, which outlasts a code change, with the ranked numbers from the last check and
// userId when the code came from that start.gg player's netplay registrations. slippiSkipped are slippi user ids /slippi remove took off, so the code search doesn't add them back.
// threads are the threads from /messages threads, keyed by tournament slug, or event slug for one per event: { id, at }, with at when it was started.
// a tournament thread also saves its channel card as { channelId, messageId, pinned }, pinned saying if the pin worked, so it comes off once the tournament is over.
// recentPicks are the start.gg user ids each discord id last picked in a player option, newest first, for autocomplete
// buttons are match calls and stream alerts still showing a Head to head button: { setId, channelId, messageId, at }, with at when it was sent
// resultPosts are set results still watched for a TO's fix: { setId, channelId, messageId, at, outcome, reset }, outcome being startgg.outcomeOf when it was last shown.
// callPosts are match calls still watched for the set going back to waiting or not starting: { setId, channelId, messageId, calledAt, discordIds, warned, text }.
// text is the You're up ping as it went out, so the follow-ups match it
// a tournament with projected: { at, checkedAt, results, top8 } had placements go out projected, each list being the { channelId, messageId } posts to edit once they're final.
// an empty top8 list with top8Posted unset means nothing was reported yet, and the final goes out as a new message once every event is finished.
// a tournament with top8Posted sent or consumed its top 8, and one with top8Failed is having it retried hourly for 3 days by the fail-safe.
// regWarned are /reg_warn pings: { tournamentId, discordId, at }, so the same person isn't warned twice for a tournament
// matchmaking is the discord role id of each game's matchmaking role, keyed ult and melee, so a role renamed in server settings still counts
// discordEvents are the Discord scheduled events the bot made or found, keyed by start.gg tournament id, from /t-o tournament event, /t-o tournament add
// with add_event or /messages events, so every path lands on the same one: { eventId, slug, startAt, synced, gone }. synced is start.gg's side
// as of the last sync, null until one ran, and gone means a mod deleted it, it started or start.gg deleted the tournament, so it's left alone
// slippi watchlist entries a non-TO added by typed code have discordId, whoever claimed it as theirs
const empty = {
  players: {}, tournaments: {}, posted: [], streamed: [], called: [], dqs: [], regPings: [], streamPings: [], callPings: [], regDmPings: [], startDmPings: [],
  toRole: { id: null, members: [], seeded: false },
  links: {}, socials: [], accounts: {}, messages: {}, weeklyRecap: null, deploy: null, slippi: {}, slippiSkipped: [], threads: {}, recentPicks: {}, buttons: [],
  resultPosts: [], callPosts: [], regWarned: [], billsPosted: [], matchmaking: {}, discordEvents: {},
};

function load() {
  if (!fs.existsSync(FILE)) return { ...empty };
  try {
    return { ...empty, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (err) {
    // a half-written main file shouldn't wipe the track list: fall back to the
    // backup from the last good save, and only quit when both are unreadable
    try {
      console.error(`couldn't read ${FILE} (${err.message}), trying ${FILE}.bak`);
      return { ...empty, ...JSON.parse(fs.readFileSync(`${FILE}.bak`, 'utf8')) };
    } catch {
      console.error(`couldn't read ${FILE} (${err.message}), fix or delete it`);
      process.exit(1);
    }
  }
}

export const state = load();

// saves so far, for /status
export let saveCount = 0;
let backedUpAt = 0;
// a backup every hour at most, so a corrupt main file falls back to something recent
const BACKUP_HOURS = 1;

// write + fsync + rename so a crash can't leave it half written. 0600 so ids in it aren't world readable
export function save() {
  fs.mkdirSync(stateDir, { recursive: true });
  const text = JSON.stringify(state, null, 2);
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
