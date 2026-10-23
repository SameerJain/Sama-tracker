import { fileURLToPath } from 'node:url';
import { MELEE, getCharacterArt, isBackground } from './startgg.js';
import { ApiError } from './errors.js';
import { API_URL, PROFILE_FIELDS, rankFile, rankOf, toProfile } from './slippi/shared.js';

export { RANKS, REGIONS, profileUrl, rankOf, readCode } from './slippi/shared.js';

// nobody publishes a limit. community leaderboards keep to one a second, so this does too
let requestGap = 1000;

// tests that mock slippi.gg set this to 0. the real gap is covered by keeping it 1000 everywhere else
export function setRequestGap(ms) {
  requestGap = ms;
}
// players per request, as aliases
const PER_REQUEST = 20;

// slippi.gg's rank badges are svgs, which discord won't show, so src/assets/ranks has them as 256px pngs.
// each rank gets its own name so a message can carry more than one
export function rankImage(rankName) {
  const file = rankFile(rankName);
  return { attachment: fileURLToPath(new URL(`assets/ranks/${file}`, import.meta.url)), name: `rank-${file}` };
}

// slippi.gg's frog logo, recolored from white to their green so it shows in light mode too. for slippi
// cards with no rank badge to show
export const LOGO = { attachment: fileURLToPath(new URL('assets/slippi.png', import.meta.url)), name: 'slippi.png' };

// the files a card from embeds/slippi.js goes out with: the rank badge, and start.gg's icon for their most
// played character. characterFile is that icon's name, null when there isn't one. no picture beats no post
export async function slippiArt(profile) {
  const main = profile.characters?.[0];
  const character = main ? await getCharacterArt(main.name, MELEE).catch(() => null) : null;
  return { files: [rankImage(rankOf(profile).name), character].filter(Boolean), characterFile: character?.name ?? null };
}

// commands go ahead of the background check, the same way start.gg requests do
const commandQueue = [];
const backgroundQueue = [];
let nextSlot = 0;
let timer;

function takeTurn() {
  return new Promise((resolve) => {
    (isBackground() ? backgroundQueue : commandQueue).push(resolve);
    sendNext();
  });
}

function sendNext() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const next = commandQueue.shift() ?? backgroundQueue.shift();
    if (!next) return;
    nextSlot = Date.now() + requestGap;
    next();
    sendNext();
  }, Math.max(0, nextSlot - Date.now()));
}

async function query(text, variables) {
  await takeTurn();
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text, variables }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new ApiError('Slippi', `Slippi didn't respond (${err.message})`);
  }
  // when the API moved, the old address sent back the website. anything that isn't json means it moved again
  const body = await res.json().catch(() => null);
  if (!body) throw new ApiError('Slippi', `Slippi sent back something that isn't its API (HTTP ${res.status}), it may have moved`, res.status);
  if (body.errors) throw new ApiError('Slippi', `Slippi: ${body.errors[0].message}`, res.status);
  if (!res.ok) throw new ApiError('Slippi', `Slippi: HTTP ${res.status}`, res.status);
  return body.data;
}

// key is fbUid or connectCode. Map of each value to its profile, null when slippi has nobody for it.
// values go in as variables since codes come from whatever someone typed
async function lookup(key, values) {
  const unique = [...new Set(values)];
  const groups = [];
  for (let i = 0; i < unique.length; i += PER_REQUEST) groups.push(unique.slice(i, i + PER_REQUEST));
  const found = new Map();
  await Promise.all(groups.map(async (group) => {
    const data = await query(
      `query (${group.map((_, i) => `$v${i}: String`).join(', ')}) {
        ${group.map((_, i) => `u${i}: getUser(${key}: $v${i}) { ${PROFILE_FIELDS} }`).join('\n')}
      }`,
      Object.fromEntries(group.map((value, i) => [`v${i}`, value])),
    );
    group.forEach((value, i) => found.set(value, toProfile(data[`u${i}`])));
  }));
  return found;
}

// by slippi's user id, which stays the same when someone pays to change their code
export const getProfiles = (uids) => lookup('fbUid', uids);
export const getProfilesByCode = (codes) => lookup('connectCode', codes);

export async function getProfileByCode(code) {
  return (await getProfilesByCode([code])).get(code);
}
