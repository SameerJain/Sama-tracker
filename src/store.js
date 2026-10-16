import fs from 'node:fs';

// railway sets this when a volume is attached, anything else is wiped on redeploy
const DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data';
const FILE = `${DIR}/state.json`;

// players and regAdmins are keyed by start.gg user id, regReminders by tournament id. posted/streamed/dqs are ids already announced.
// regPings are discord ids that turned reg pings on. regSkipped are tournament ids whose reminder got deleted, so admins' don't come back
const empty = { players: {}, tournaments: {}, posted: [], streamed: [], dqs: [], regReminders: {}, regPings: [], regAdmins: {}, regSkipped: [] };

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
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}
