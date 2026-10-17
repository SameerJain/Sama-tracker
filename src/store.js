import fs from 'node:fs';

// where state.json lives. STATE_DIR works anywhere; Railway sets its own when a volume is
// attached, and anything else is wiped on redeploy, so the fallback is only for local runs
export const stateDir = process.env.STATE_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data';
const FILE = `${stateDir}/state.json`;

// players and regAdmins are keyed by start.gg user id, regReminders by tournament id. posted/streamed/dqs are ids already announced.
// regPings are discord ids that turned reg pings on. regSkipped are tournament ids whose reminder got deleted, so admins' don't come back.
// links are start.gg accounts keyed by the discord id that ran /link. socials are { name, url } in the order they were added.
// accounts are start.gg user ids keyed by the discord id connected to them, from tournament participant lists.
// messages holds the /messages switches and recap schedule. weeklyRecap is the recap partway through sending, built once so a restart sends the rest
const empty = {
  players: {}, tournaments: {}, posted: [], streamed: [], dqs: [], regReminders: {}, regPings: [], regAdmins: {}, regSkipped: [],
  links: {}, socials: [], accounts: {}, messages: {}, weeklyRecap: null,
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
