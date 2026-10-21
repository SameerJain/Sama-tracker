import * as startgg from '../startgg.js';
import * as slippi from '../slippi.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { messageEnabled } from '../message-settings.js';
import { channel, secondsNow, health, SLIPPI_SEARCH_DAYS, SLIPPI_SKIPPED_KEPT, DAY } from './shared.js';

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
  const records = Object.values(state.players);
  const due = new Map();
  for (const record of records) {
    if (watched.has(String(record.userId)) || now - (record.slippiSearchedAt ?? 0) < SLIPPI_SEARCH_DAYS * DAY) continue;
    // tracked comes first, and a link to the same account is the same person
    if (!due.has(String(record.userId))) due.set(String(record.userId), record);
  }
  if (!due.size) return;

  try {
    const codes = await startgg.getConnectCodes([...due.values()].map((record) => record.playerId));
    // typed by hand at registration, so some are lowercase or not codes at all
    const readable = new Map([...codes].map(([playerId, code]) => [playerId, slippi.readCode(code)]).filter(([, code]) => code));
    const profiles = readable.size ? await slippi.getProfilesByCode([...readable.values()]) : new Map();
    for (const record of due.values()) {
      const profile = profiles.get(readable.get(record.playerId));
      if (!profile || state.slippiSkipped.includes(profile.uid)) continue;
      // already on it from /slippi add. the rank check moves its numbers, or a rank change would go unposted
      if (state.slippi[profile.uid]) state.slippi[profile.uid].userId = record.userId;
      else state.slippi[profile.uid] = { ...slippiEntry(profile), userId: record.userId };
    }
    // only once it worked, so a failed search goes again tomorrow
    for (const record of records) {
      if (due.has(String(record.userId))) record.slippiSearchedAt = now;
    }
  } catch (err) {
    console.error('finding slippi codes failed:', err.message);
  }
  save();
}

// everyone on the watchlist, 20 a request. a move to another rank this season gets posted. a new season
// starts everyone over at pending, so the first rank after that is a placement and not a drop
export async function postRankChanges(postChannel = channel) {
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
      if (!before.rank || before.season !== entry.season || before.rank === entry.rank) continue;
      if (slippi.RANKS.indexOf(entry.rank) <= slippi.RANKS.indexOf('Pending')) continue;
      if (messageEnabled('slippi', checkedAt)) {
        const { files, characterFile } = await slippi.slippiArt(entry);
        await postChannel.send({ embeds: [embeds.rankChange(entry, before, state.players, { characterFile })], files, allowedMentions: { parse: [] } });
      }
    }
    health.slippiCheck = checkedAt;
    health.slippiError = null;
  } catch (err) {
    console.error('checking slippi ranks failed:', err.message);
    health.slippiError = err.message;
  }
  state.slippiSkipped = state.slippiSkipped.slice(-SLIPPI_SKIPPED_KEPT);
  save();
}
