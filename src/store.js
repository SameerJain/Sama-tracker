import fs from 'node:fs';

const FILE = 'data/state.json';

// players are keyed by start.gg user id. posted/streamed/dqs are ids already announced
const empty = { players: {}, tournaments: {}, posted: [], streamed: [], dqs: [] };

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
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}
