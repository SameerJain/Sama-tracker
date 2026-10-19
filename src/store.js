import fs from 'node:fs';

// where state.json lives. STATE_DIR works anywhere; Railway sets its own when a volume is
// attached, and anything else is wiped on redeploy, so the fallback is only for local runs
export const stateDir = process.env.STATE_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data';
const FILE = `${stateDir}/state.json`;

// players and regAdmins are keyed by start.gg user id, regReminders by tournament id. posted/streamed/called/dqs are ids already announced.
// regPings and streamPings are discord ids that turned reg pings or stream alert pings on. regSkipped are tournament ids whose reminder got deleted, so admins' don't come back.
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
// callPosts are match calls still watched for the set going back to waiting or not starting: { setId, channelId, messageId, calledAt, discordIds, warned }.
// a tournament with projected: { at, checkedAt, results, top8 } had placements go out projected, each list being the { channelId, messageId } posts to edit once they're final.
// a tournament with top8Posted sent or consumed its top 8, and one with top8Failed is having it retried hourly for 3 days by the fail-safe.
// regWarned are /reg_warn pings: { tournamentId, discordId, at }, so the same person isn't warned twice for a tournament
const empty = {
  players: {}, tournaments: {}, posted: [], streamed: [], called: [], dqs: [], regReminders: {}, regPings: [], streamPings: [], regAdmins: {}, regSkipped: [],
  links: {}, socials: [], accounts: {}, messages: {}, weeklyRecap: null, deploy: null, slippi: {}, slippiSkipped: [], threads: {}, recentPicks: {}, buttons: [],
  resultPosts: [], callPosts: [], regWarned: [], billsPosted: [],
};

function load() {
  if (!fs.existsSync(FILE)) return empty;
  try {
    return { ...empty, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (err) {
    // don't start empty, the next save would wipe it
    console.error(`couldn't read ${FILE} (${err.message}), fix or delete it`);
    process.exit(1);
  }
}

export const state = load();

// write + rename so a crash can't leave it half written
export function save() {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}
