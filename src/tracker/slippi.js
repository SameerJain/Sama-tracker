import * as startgg from '../startgg.js';
import * as slippi from '../slippi.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { messageEnabled } from '../message-settings.js';
import {
  currentChannel, secondsNow, health, SLIPPI_SEARCH_DAYS, SLIPPI_SKIPPED_KEPT, SEASON_WRAP_DAYS, SEASONS_WRAPPED_KEPT, DAY,
} from './shared.js';

// a /slippi watchlist entry from a slippi profile. rank is the one it's at as of this check. past
// seasons are only for /slippi rank, which asks slippi again anyway
export function slippiEntry(profile, entry = {}) {
  const { seasons, ...current } = profile;
  return { ...entry, ...current, rank: slippi.rankOf(profile).name, checkedAt: secondsNow() };
}

// tracked players whose slippi isn't on the watchlist yet, looked for once a week in their
// start.gg netplay registrations. anyone found goes on the watchlist with their start.gg attached
export async function findSlippiCodes() {
  const now = secondsNow();
  const watched = new Set(Object.values(state.slippi).map((entry) => String(entry.userId)));
  const due = Object.values(state.players)
    .filter((player) => !watched.has(String(player.userId)) && now - (player.slippiSearchedAt ?? 0) >= SLIPPI_SEARCH_DAYS * DAY);
  if (!due.length) return;

  try {
    const codes = await startgg.getConnectCodes(due.map((player) => player.playerId));
    // typed by hand at registration, so some are lowercase or not codes at all
    const readable = new Map([...codes].map(([playerId, code]) => [playerId, slippi.readCode(code)]).filter(([, code]) => code));
    const profiles = readable.size ? await slippi.getProfilesByCode([...readable.values()]) : new Map();
    for (const player of due) {
      const profile = profiles.get(readable.get(player.playerId));
      if (!profile || state.slippiSkipped.includes(profile.uid)) continue;
      // already on it from /slippi add. the rank check moves its numbers, or a rank change would go unposted
      if (state.slippi[profile.uid]) state.slippi[profile.uid].userId = player.userId;
      else state.slippi[profile.uid] = { ...slippiEntry(profile), userId: player.userId };
    }
    // only once it worked, so a failed search goes again tomorrow
    for (const player of due) player.slippiSearchedAt = now;
  } catch (err) {
    console.error('finding slippi codes failed:', err.message);
  }
  save();
}

// everyone on the watchlist, 20 a request. a move to another rank this season gets posted. a new season
// starts everyone over at pending, so the first rank after that is a placement and not a drop. the season
// that ended gets a wrap-up instead
export async function postRankChanges(postChannel = currentChannel()) {
  const entries = Object.values(state.slippi);
  if (!entries.length) return;
  const checkedAt = secondsNow();
  try {
    const latest = await slippi.getProfiles(entries.map((entry) => entry.uid));
    for (const entry of entries) {
      const profile = latest.get(entry.uid);
      // removed while this was running, or gone from slippi. kept in case slippi only hiccuped
      if (!profile || state.slippi[entry.uid] !== entry) continue;
      const before = { ...entry };
      Object.assign(entry, slippiEntry(profile));
      // the season history has final ratings but no characters or daily placements, so the wrap-up gets
      // those from here. a profile can turn over before or after the history shows the season ended
      if (before.season && before.season !== entry.season) {
        entry.lastSeason = {
          at: checkedAt,
          characters: before.characters ?? [],
          global: before.global ?? null,
          regional: before.regional ?? null,
        };
      }
      if (!before.rank || before.season !== entry.season || before.rank === entry.rank) continue;
      if (slippi.RANKS.indexOf(entry.rank) <= slippi.RANKS.indexOf('Pending')) continue;
      if (messageEnabled('slippi', checkedAt)) {
        const { files, characterFile } = await slippi.slippiArt(entry);
        await postChannel.send({ embeds: [embeds.rankChange(entry, before, state.players, { characterFile })], files, allowedMentions: { parse: [] } });
      }
    }
    await postSeasonWrapUp(latest, postChannel, checkedAt);
    health.slippiCheck = checkedAt;
    health.slippiError = null;
  } catch (err) {
    console.error('checking slippi ranks failed:', err.message);
    health.slippiError = err.message;
  }
  state.slippiSkipped = state.slippiSkipped.slice(-SLIPPI_SKIPPED_KEPT);
  save();
}

// slippi's season end time, which comes as an ISO date. a number is taken as seconds, or milliseconds
// when it's that big. null when it can't be read, which keeps the season from getting a wrap-up
function secondsOf(value) {
  if (typeof value === 'number') return Math.floor(value > 1e12 ? value / 1000 : value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

// once slippi's history shows a season finished, a wrap-up of it for the watchlist, once: final ranks, who
// climbed most since the season before, and what they played. latest is this check's profiles by uid.
// ratings and records come from the history, so a player still on last season's profile counts the same
// as one who already played the new one
export async function postSeasonWrapUp(latest, postChannel = currentChannel(), checkedAt = secondsNow()) {
  const ended = [...latest.values()].map((profile) => profile.seasons[0])
    .filter((season) => season && checkedAt - (secondsOf(season.endedAt) ?? -Infinity) <= SEASON_WRAP_DAYS * DAY)
    .sort((a, b) => secondsOf(b.endedAt) - secondsOf(a.endedAt))[0];
  if (!ended || state.slippiWrapped.includes(ended.name)) return;
  state.slippiWrapped = [...state.slippiWrapped, ended.name].slice(-SEASONS_WRAPPED_KEPT);

  const endedAt = secondsOf(ended.endedAt);
  const finishers = [];
  for (const [uid, profile] of latest) {
    const entry = state.slippi[uid];
    const at = profile.seasons.findIndex((season) => season.name === ended.name);
    if (!entry || at === -1) continue;
    const final = profile.seasons[at];
    // turned over since the season ended, so the saved copy is that season's. otherwise the entry still is
    const last = entry.lastSeason?.at >= endedAt ? entry.lastSeason : entry;
    const updates = final.wins + final.losses;
    finishers.push({
      uid,
      code: entry.code,
      name: entry.name,
      userId: entry.userId,
      rating: final.rating,
      wins: final.wins,
      losses: final.losses,
      updates,
      rank: slippi.rankOf({ rating: final.rating, updates, global: last.global, regional: last.regional }).name,
      characters: last.characters ?? [],
      previous: profile.seasons[at + 1] ?? null,
    });
  }
  if (!messageEnabled('slippi', endedAt)) return;
  const card = embeds.seasonWrapUp(ended, finishers, state.players);
  if (!card) return;
  await postChannel.send({ embeds: [card.embed], files: card.files, allowedMentions: { parse: [] } });
}
