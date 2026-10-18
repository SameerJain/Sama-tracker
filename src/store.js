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
// threads are the tournament threads from /messages threads, keyed by tournament slug: { id, at }, with at when it was started.
// recentPicks are the start.gg user ids each discord id last picked in a player option, newest first, for autocomplete
const empty = {
  players: {}, tournaments: {}, posted: [], streamed: [], called: [], dqs: [], regReminders: {}, regPings: [], streamPings: [], regAdmins: {}, regSkipped: [],
  links: {}, socials: [], accounts: {}, messages: {}, weeklyRecap: null, deploy: null, slippi: {}, slippiSkipped: [], threads: {}, recentPicks: {},
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
