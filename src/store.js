import fs from 'node:fs';

const FILE = 'data/state.json';

// players: tracked players by start.gg user ID. tournaments: ones they're entered in.
// posted, streamed and dqs remember what's already been announced, so a restart doesn't repeat it.
const empty = { players: {}, tournaments: {}, posted: [], streamed: [], dqs: [] };

function load() {
  if (!fs.existsSync(FILE)) return empty;
  try {
    // Fill in anything added since the file was last saved.
    return { ...empty, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (err) {
    // Starting empty would overwrite it on the next save, so stop and let someone look at it.
    console.error(`${FILE} couldn't be read (${err.message}). Fix it, or delete it to start over.`);
    process.exit(1);
  }
}

export const state = load();

// Write to a temp file first so a crash mid-write can't wipe the saved state.
export function save() {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}
