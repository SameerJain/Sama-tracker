import { setTimeout as sleep } from 'node:timers/promises';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { messageEnabled } from '../message-settings.js';
import { linkedPlayer } from '../commands/shared.js';
import { channel, secondsNow, sendPinging, posting, alertsOn, endTime, RUNS_LATE_HOURS, HOUR } from './shared.js';
import { tournamentPosts } from './threads.js';
import { h2hRow, rememberButton } from './buttons.js';

// sets on stream with someone who has alerts on, by id. a set in a stream queue goes by the queue's
// stream, since the set's own can still name a stream it was moved off
async function streamedNow() {
  const found = new Map();
  try {
    const playerIds = Object.values(state.players).filter(alertsOn).map((player) => player.playerId);
    for (const set of await startgg.getStreamedSets(playerIds)) found.set(set.id, set);
  } catch (err) {
    console.error('checking streams failed:', err.message);
  }

  // lots of TOs never hit "call", but they still use the stream queue for their overlay. a tracked tournament
  // announces everything on its stream, the rest only sets with someone who has alerts on
  for (const tournament of liveTournaments()) {
    try {
      const everyone = posting(tournament, 'stream');
      for (const queue of await startgg.getStreamQueues(tournament.id)) {
        for (const set of setsToAnnounce(queue.sets).filter((each) => everyone || hasPlayerWithAlerts(each))) found.set(set.id, set);
      }
    } catch (err) {
      console.error(`checking stream queue at ${tournament.name} failed:`, err.message);
    }
  }
  return found;
}

// TOs misclick a set onto stream and take it back seconds later, so a new one has to still be there after this
const STREAM_CONFIRM_MS = 30_000;

export async function postStreamAlerts(postChannel = channel, confirmAfter = STREAM_CONFIRM_MS) {
  state.streamPinged ??= [];
  const current = [...(await streamedNow()).values()];
  for (const set of current.filter((each) => state.streamed.includes(each.id))) {
    const ids = streamPingIds(set);
    const pinged = state.streamPinged.find((each) => each.setId === set.id);
    // old saved alerts have no per-person history, so don't replay them on upgrade
    if (!pinged) {
      state.streamPinged.push({ setId: set.id, discordIds: ids });
      continue;
    }
    const newIds = ids.filter((id) => !pinged.discordIds.includes(id));
    if (!newIds.length) continue;
    if (messageEnabled('streams', wentLiveAt(set))) {
      const components = h2hRow(set);
      const sent = await sendPinging(tournamentPosts(set, postChannel), 'streams', newIds, 'on stream', embeds.onStream(set, state.players), components);
      rememberButton(sent, set, components);
    }
    pinged.discordIds.push(...newIds);
  }

  const seen = current.filter((set) => !state.streamed.includes(set.id));
  if (seen.length) {
    await sleep(confirmAfter);
    const still = await streamedNow();
    for (const { id, stream } of seen) {
      const set = still.get(id);
      // taken off stream or moved to another one. the next check looks again once it settles
      if (!set || set.stream.streamName !== stream.streamName || state.streamed.includes(id)) continue;
      // only whoever is playing and has /notify streams on
      if (messageEnabled('streams', wentLiveAt(set))) {
        const components = h2hRow(set);
        const ids = streamPingIds(set);
        const sent = await sendPinging(tournamentPosts(set, postChannel), 'streams', ids, 'on stream', embeds.onStream(set, state.players), components);
        rememberButton(sent, set, components);
        state.streamPinged.push({ setId: set.id, discordIds: ids });
      }
      state.streamed.push(id);
    }
  }

  state.streamed = state.streamed.slice(-200);
  state.streamPinged = (state.streamPinged ?? []).filter((each) => state.streamed.includes(each.setId)).slice(-200);
  save();
}

// everyone with /notify streams on who is in this set, by their /link or the tracked
// player with their discord on start.gg. doubles sides hold two player ids each
function streamPingIds(set) {
  const ids = [];
  for (const discordId of state.streamPings) {
    const player = linkedPlayer(discordId);
    if (player?.playerId && set.sides.some((side) => side.playerIds.includes(player.playerId))) ids.push(discordId);
  }
  return [...new Set(ids)];
}

// a called or started set was last updated around when it went live. one only waiting
// at the front of a queue was last touched when it got queued, so it has no time to go by
function wentLiveAt(set) {
  return set.state === 1 ? undefined : set.updatedAt;
}

// queueSets is in queue order, front first
function setsToAnnounce(queueSets) {
  const unfinished = queueSets.filter((set) => set.state !== 3);
  // front of the queue counts even if it was never called
  const live = unfinished.filter((set, i) => i === 0 || set.state === 2 || set.state === 6);
  return live.filter((set) => set.stream?.streamName);
}

function liveTournaments() {
  const now = secondsNow();
  return Object.values(state.tournaments).filter((tournament) => {
    // doneAt means every event they're in has finished, or every event at a tracked one
    if (tournament.resultsPosted || tournament.doneAt || !(tournament.startAt <= now)) return false;
    if (now > endTime(tournament) + RUNS_LATE_HOURS * HOUR) return false;
    return posting(tournament, 'stream') || tournament.entries.some((entry) => alertsOn(state.players[entry.userId]));
  });
}

function hasPlayerWithAlerts(set) {
  const players = Object.values(state.players).filter(alertsOn);
  return set.sides.some((side) => players.some((player) => side.playerIds.includes(player.playerId)));
}
