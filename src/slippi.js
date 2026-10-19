import { fileURLToPath } from 'node:url';
import { MELEE, getCharacterArt, isBackground } from './startgg.js';
import { ApiError } from './errors.js';

// slippi.gg's own API. there's no public one: no docs, introspection off, and the host is called
// internal. it already moved once, from gql-gateway-dot-slippi.uc.r.appspot.com, which now answers
// with the website and broke every community leaderboard. keep it to this one line
const API_URL = 'https://internal.slippi.gg/graphql';

// nobody publishes a limit. community leaderboards keep to one a second, so this does too
const REQUEST_GAP_MS = 1000;
// players per request, as aliases
const PER_REQUEST = 20;

// slippi.gg's own cutoffs, from the site's code in october 2026. a placement in the daily
// leaderboards is what makes a master rating grandmaster. under 5 sets is pending
const TIERS = [
  ['Bronze 1', -Infinity, 0xe06a36], ['Bronze 2', 765.43, 0xe06a36], ['Bronze 3', 913.72, 0xe06a36],
  ['Silver 1', 1054.87, 0xb5a5b7], ['Silver 2', 1188.88, 0xb5a5b7], ['Silver 3', 1315.75, 0xb5a5b7],
  ['Gold 1', 1435.48, 0xf6a51e], ['Gold 2', 1548.07, 0xf6a51e], ['Gold 3', 1653.52, 0xf6a51e],
  ['Platinum 1', 1751.83, 0x91e8e0], ['Platinum 2', 1843, 0x91e8e0], ['Platinum 3', 1927.03, 0x91e8e0],
  ['Diamond 1', 2003.92, 0x5ddff4], ['Diamond 2', 2073.67, 0x5ddff4], ['Diamond 3', 2136.28, 0x5ddff4],
  ['Master 1', 2191.75, 0x6847ba], ['Master 2', 2275, 0x6847ba], ['Master 3', 2350, 0x6847ba],
].map(([name, min, color]) => ({ name, min, color }));
const GRANDMASTER = { name: 'Grandmaster', min: 2191.75, color: 0xe51d13 };
const PENDING = { name: 'Pending', color: 0x21ba45 };
const UNRANKED = { name: 'Unranked', color: 0x21ba45 };
const SETS_TO_RANK = 5;

// lowest first, so a higher index is a better rank
export const RANKS = [UNRANKED.name, PENDING.name, ...TIERS.map((tier) => tier.name), GRANDMASTER.name];

export function rankOf({ rating, updates, global, regional }) {
  if (!updates) return UNRANKED;
  if (updates < SETS_TO_RANK) return PENDING;
  if (rating >= GRANDMASTER.min && (global || regional)) return GRANDMASTER;
  return TIERS.findLast((tier) => rating >= tier.min);
}

// slippi.gg's rank badges are svgs, which discord won't show, so src/assets/ranks has them as 256px pngs.
// Gold 2 is gold-2.png. each rank gets its own name so a message can carry more than one
export function rankImage(rankName) {
  const file = `${rankName.toLowerCase().replace(' ', '-')}.png`;
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

const CHARACTERS = {
  CAPTAIN_FALCON: 'Captain Falcon', DONKEY_KONG: 'Donkey Kong', GAME_AND_WATCH: 'Mr. Game & Watch', ICE_CLIMBERS: 'Ice Climbers',
  YOUNG_LINK: 'Young Link', DR_MARIO: 'Dr. Mario',
};
// FOX is Fox. the ones that aren't one word are above
const characterName = (id) => CHARACTERS[id] ?? id.charAt(0) + id.slice(1).toLowerCase();

export const REGIONS = {
  NORTH_AMERICA: 'North America', SOUTH_AMERICA: 'South America', EUROPE: 'Europe', ASIA: 'Asia', OCEANIA: 'Oceania', AFRICA: 'Africa',
};

// ABCD#123, abcd-123 or a slippi.gg/user/abcd-123 link, as ABCD#123. null if it isn't a connect code
export function readCode(input) {
  const match = input.trim().match(/(?:^|[^a-z0-9])([a-z0-9]{1,8})[#-](\d{1,7})\/?$/i);
  return match ? `${match[1].toUpperCase()}#${match[2]}` : null;
}

export function profileUrl(code) {
  return `https://slippi.gg/user/${code.replace('#', '-')}`;
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
    nextSlot = Date.now() + REQUEST_GAP_MS;
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

const PROFILE_FIELDS = `
  fbUid
  displayName
  connectCode { code }
  rankedNetplayProfile {
    id ratingOrdinal ratingUpdateCount wins losses dailyGlobalPlacement dailyRegionalPlacement continent
    characters { character gameCount }
  }
  rankedNetplayProfileHistory {
    ratingOrdinal wins losses
    season { name status endedAt }
  }
`;

// season is the ranked profile's id, which ends in the season, so a new one shows up as a different id
function toProfile(user) {
  if (!user?.fbUid) return null;
  const ranked = user.rankedNetplayProfile ?? {};
  return {
    uid: user.fbUid,
    code: user.connectCode?.code ?? null,
    name: user.displayName || user.connectCode?.code || 'Unknown',
    season: ranked.id ?? null,
    rating: ranked.ratingOrdinal ?? null,
    updates: ranked.ratingUpdateCount ?? 0,
    wins: ranked.wins ?? 0,
    losses: ranked.losses ?? 0,
    global: ranked.dailyGlobalPlacement ?? null,
    regional: ranked.dailyRegionalPlacement ?? null,
    region: REGIONS[ranked.continent] ?? null,
    characters: (ranked.characters ?? [])
      .filter((character) => character.gameCount > 0)
      .map((character) => ({ name: characterName(character.character), games: character.gameCount }))
      .sort((a, b) => b.games - a.games),
    // newest first
    seasons: (user.rankedNetplayProfileHistory ?? [])
      .filter((past) => past.season?.status === 'COMPLETED')
      .map((past) => ({ name: past.season.name, rating: past.ratingOrdinal, wins: past.wins ?? 0, losses: past.losses ?? 0, endedAt: past.season.endedAt }))
      .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt))),
  };
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
