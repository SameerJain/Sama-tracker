import fs from 'node:fs';

const FILE = 'data/state.json';

export const state = fs.existsSync(FILE)
  ? JSON.parse(fs.readFileSync(FILE, 'utf8'))
  : { players: {}, tournaments: {}, posted: [] };

export function save() {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}
