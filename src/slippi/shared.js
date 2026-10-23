// what slippi.gg's profiles mean, without asking slippi.gg anything. nothing here imports anything, so the web
// hub loads this same file for its own lookups, see web/build.mjs

// slippi.gg's own API. there's no public one: no docs, introspection off, and the host is called
// internal. it already moved once, from gql-gateway-dot-slippi.uc.r.appspot.com, which now answers
// with the website and broke every community leaderboard. keep it to this one line
export const API_URL = 'https://internal.slippi.gg/graphql';

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

// the rank badge's file in src/assets/ranks, which the web hub gets a copy of. Gold 2 is gold-2.png
export const rankFile = (rankName) => `${rankName.toLowerCase().replace(' ', '-')}.png`;

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
  const match = String(input).trim().match(/(?:^|[^a-z0-9])([a-z0-9]{1,8})[#-](\d{1,7})\/?$/i);
  return match ? `${match[1].toUpperCase()}#${match[2]}` : null;
}

export function profileUrl(code) {
  return `https://slippi.gg/user/${code.replace('#', '-')}`;
}

export const PROFILE_FIELDS = `
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

// a getUser reply as a profile. season is the ranked profile's id, which ends in the season, so a new one
// shows up as a different id. null when slippi has nobody
export function toProfile(user) {
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
      .map((past) => ({
        name: past.season.name,
        rating: past.ratingOrdinal,
        wins: past.wins ?? 0,
        losses: past.losses ?? 0,
        endedAt: past.season.endedAt,
      }))
      .sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt))),
  };
}
