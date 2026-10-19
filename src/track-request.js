import fs from 'node:fs';
import { stateDir } from './store.js';

// tools/track-attendees.js leaves one of these on the bot's host. the bot is the only writer
// of state.json, so the tool queues players here instead of editing state and getting
// overwritten by the next save
const FILE = `${stateDir}/track-request.json`;

// bulk adds stop here. a major would flood the tracked list, even one event at a time
export const BULK_TRACK_MAX = 80;

// start.gg link for a tournament, from the attendees page or anywhere else. takes the event
// filter off the URL when it has one, like ?filter={"eventIds":["1682422"]}.
// null when there's no tournament in it
export function parseTournamentLink(input) {
  const cleaned = input.trim().replace(/^(https?:\/\/)?(www\.)?(start|smash)\.gg\/?/i, '');
  const [path, query = ''] = cleaned.split('?');
  const segments = path.split(/[/#]/).filter(Boolean);
  // a short link like start.gg/genesis-x, or the name after tournament/ in a full link
  const slug = segments.length > 1 ? (segments[0] === 'tournament' ? segments[1] : null) : segments[0];
  if (!slug) return null;

  let eventIds = null;
  try {
    const filter = JSON.parse(new URLSearchParams(query).get('filter') ?? '');
    if (Array.isArray(filter.eventIds) && filter.eventIds.length) eventIds = filter.eventIds.map(String);
  } catch {
    // no filter on the link, so it means everyone at the tournament
  }
  return { slug, eventIds };
}

// the tool merges into a pending request, so runs within a check of each other don't drop each other
export function writeTrackRequest(request) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(request, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}

export function readTrackRequest() {
  if (!fs.existsSync(FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    // a broken file can never be read, so it wouldn't do anything but log every check
    console.error(`couldn't read ${FILE} (${err.message}), dropping it`);
    fs.rmSync(FILE, { force: true });
    return null;
  }
}

export function clearTrackRequest() {
  fs.rmSync(FILE, { force: true });
}
