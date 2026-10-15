import fs from 'node:fs';

const FILE = 'data/state.json';

const empty = { players: {}, tournaments: {}, posted: [], streamed: [], dqs: [] };

function load() {
  if (!fs.existsSync(FILE)) return empty;
  // Fill in anything added since the file was last saved.
  return { ...empty, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
}

export const state = load();

// Write to a temp file first so a crash mid-write can't wipe the saved state.
export function save() {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}
