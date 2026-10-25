import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { t } from '../i18n.js';
import { state, save } from '../store.js';
import { postsOn } from '../message-settings.js';
import { linkedPlayer } from '../commands/shared.js';
import {
  currentChannel, secondsNow, sendPinging, postRefs, editPost, named, mentionable, mentions, trackedLive, trackedFor, eventsOf, endTime,
  NEXT_WATCH_MINUTES, RUNS_LATE_HOURS, HOUR,
} from './shared.js';
import { tournamentPosts } from './threads.js';
import { h2hRow, rememberButton } from './buttons.js';

// which unplayed set needs a player soonest: called, queued, ready, then waiting
const SOONEST = [6, 7, 4, 1];

// everyone with /notify next on, as the start.gg account commands know them by: their /link, or the tracked
// player with their discord on start.gg. someone with neither has nothing to look up and waits for one
function nexters() {
  const found = [];
  for (const discordId of state.nextPings) {
    const player = linkedPlayer(discordId);
    if (player?.playerId) found.push({ ...player, discordId });
  }
  return found;
}

// who is in a set, the same whichever order start.gg lists the slots or a team's players in. posting builds it
// from the set and the follow-up from getSetPairings, so the two compare
function pairKey(setId, playerIdsBySide) {
  const sides = playerIdsBySide.map((ids) => ids.map(String).sort().join('+')).sort();
  return `${setId}:${sides.join(':')}`;
}

// start.gg hands back sets left unplayed in brackets abandoned years ago, so only ones from tournaments going on count
function live(set, now) {
  const tournament = set.event?.tournament;
  return startgg.UNPLAYED_STATES.includes(set.state) && tournament?.startAt <= now && now <= endTime(tournament) + RUNS_LATE_HOURS * HOUR;
}

// each player's soonest set in each event. only players whose unplayed sets were all read count: a /notify next
// person's own sets don't show what their opponents play first, so those would all look like the opponents' soonest
function soonest(sets, complete) {
  const order = (a, b) => SOONEST.indexOf(a.state) - SOONEST.indexOf(b.state)
    || Math.abs(a.roundNumber ?? 0) - Math.abs(b.roundNumber ?? 0) || Number(a.id) - Number(b.id);
  const first = new Map();
  const sorted = sets.toSorted(order);
  for (const set of sorted) {
    for (const playerId of set.sides.flatMap((side) => side.playerIds)) {
      const key = `${set.event.slug}:${playerId}`;
      if (complete(set, playerId) && !first.has(key)) first.set(key, set);
    }
  }
  const eligible = new Set(first.values());
  return sorted.filter((set) => eligible.has(set));
}

// the unplayed sets going on now for the /notify next people, and every one at tracked tournaments with next on
async function candidates(people) {
  const found = new Map();
  const playerIds = people.map((player) => player.playerId);
  // where all of someone's unplayed sets were read: whole events by slug, and one player's sets in one event as
  // slug:playerId
  const read = new Set();
  let more = new Set();
  const now = secondsNow();
  if (playerIds.length) {
    try {
      const next = await startgg.getNextSets(playerIds);
      more = next.more;
      for (const set of next.sets) found.set(set.id, set);
      // a full page can leave sets out, like the rest of a round-robin pool, and start.gg doesn't say what order it
      // lists them in. so those players get their own sets read whole in each event going on now
      const pairs = new Map();
      for (const set of next.sets.filter((each) => live(each, now))) {
        for (const playerId of set.sides.flatMap((side) => side.playerIds).filter((id) => more.has(id))) {
          pairs.set(`${set.event.slug}:${playerId}`, { eventId: set.event.id, playerId });
        }
      }
      if (pairs.size) {
        for (const set of await startgg.getPlayerUnplayedSets([...pairs.values()])) found.set(set.id, set);
        for (const key of pairs.keys()) read.add(key);
      }
    } catch (err) {
      console.error('checking next opponents failed:', err.message);
    }
  }
  const asked = new Set(playerIds.filter((id) => !more.has(id)));
  for (const tournament of trackedLive('next')) {
    try {
      const eventIds = [...new Set(eventsOf(tournament).filter((entry) => entry.started && !entry.done).map((entry) => entry.eventId).filter(Boolean))];
      for (const set of eventIds.length ? await startgg.getUnplayedEventSets(eventIds) : []) {
        found.set(set.id, set);
        read.add(set.event.slug);
      }
    } catch (err) {
      console.error(`checking next opponents at ${named(tournament)} failed:`, err.message);
    }
  }
  const complete = (set, playerId) => read.has(set.event.slug) || read.has(`${set.event.slug}:${playerId}`) || asked.has(playerId);
  return soonest([...found.values()].filter((set) => live(set, now)), complete);
}

export async function postNextOpponents(postChannel = currentChannel()) {
  try {
    const people = nexters();
    // nothing to look for costs no request. with next off server-wide, only tracked tournaments turned on can post
    if (!trackedLive('next').length && (!people.length || !postsOn('next'))) return;
    const now = secondsNow();
    for (const set of await candidates(people)) {
      const tournament = trackedFor(set);
      // doubles sides hold two player ids each, so all four land in the same message
      const inSet = people.filter((player) => set.sides.some((side) => side.playerIds.includes(player.playerId)));
      const ids = [...new Set(inSet.map((player) => player.discordId).filter(mentionable))];
      // off isn't consumed, so a set still unplayed when next comes back on posts then
      if (!postsOn('next', tournament)) continue;
      // untracked tournaments only post for someone pinged. a bracket or pool starting would be a wall of cards,
      // so round 1 at a tracked one does too
      if (!ids.length && (!tournament || set.roundNumber === 1)) continue;
      const key = pairKey(set.id, set.sides.map((side) => side.playerIds));
      if (state.nextPosted.includes(key)) {
        // someone who turned /notify next on since gets the card again with just their ping, while it's watched
        const watched = state.nextPosts.find((each) => each.key === key && each.at > now - NEXT_WATCH_MINUTES * 60);
        const newIds = watched ? ids.filter((id) => !watched.discordIds.includes(id)) : [];
        if (!newIds.length) continue;
        try {
          await sendNext(set, inSet, newIds, postChannel);
        } catch (err) {
          // one bad send leaves this set for the next check but still posts the rest
          console.error(`posting a next opponent for ${set.id} failed:`, err.message);
          continue;
        }
        watched.discordIds.push(...newIds);
        save();
        continue;
      }
      try {
        const { sent, text } = await sendNext(set, inSet, ids, postChannel);
        watchNext(sent, set, key, ids, text);
      } catch (err) {
        console.error(`posting a next opponent for ${set.id} failed:`, err.message);
        continue;
      }
      state.nextPosted.push(key);
      // saved per set so a crash can't post it again
      save();
    }
  } catch (err) {
    console.error('checking next opponents failed:', err.message);
  }

  state.nextPosted = state.nextPosted.slice(-1000);
  save();
}

// the card in the set's thread, pinging ids, with its head to head button saved to come off later. a singles
// card between two people the bot doesn't know still gets one, about the first side
async function sendNext(set, inSet, discordIds, postChannel) {
  const components = h2hRow(set, inSet[0] ?? { playerId: set.sides[0].playerIds[0] });
  const people = { ...Object.fromEntries(inSet.map((player) => [player.userId, player])), ...state.players };
  const text = t('Next opponent');
  const sent = await sendPinging(tournamentPosts(set, postChannel), () => postsOn('next', trackedFor(set)), discordIds, text, embeds.nextOpponent(set, people), components);
  rememberButton(sent, set, components);
  return { sent, text };
}

// saved so followNextOpponents can find the card again. text is the ping as it went out, so a changed pairing
// crosses out the same words. start.gg's preview sets have ids that can't be looked up
function watchNext(message, set, key, discordIds, text) {
  if (!message?.id || !/^\d+$/.test(set.id)) return;
  const [ref] = postRefs([message]);
  state.nextPosts.push({ setId: set.id, key, ...ref, at: secondsNow(), discordIds, text });
  state.nextPosts = state.nextPosts.slice(-200);
  save();
}

// recent next opponent cards in one request. a TO fixing or resetting the set that fed one can put someone else
// in it: that card gets crossed out, and the new pairing posts as its own card if it's someone's next. a slot gone
// empty waits to see who lands there, so the same two again post nothing. started, finished and deleted sets stop
// being watched
export async function followNextOpponents(postChannel = currentChannel()) {
  const now = secondsNow();
  const before = state.nextPosts.length;
  state.nextPosts = state.nextPosts.filter((each) => each.at > now - NEXT_WATCH_MINUTES * 60);
  const watching = state.nextPosts;
  if (!watching.length) {
    if (state.nextPosts.length !== before) save();
    return;
  }
  let pairings;
  try {
    pairings = await startgg.getSetPairings([...new Set(watching.map((each) => each.setId))]);
  } catch (err) {
    console.error('following up next opponents failed:', err.message);
    save();
    return;
  }
  for (const each of watching) {
    const pairing = pairings.get(each.setId);
    if (!pairing || !startgg.UNPLAYED_STATES.includes(pairing.state)) {
      state.nextPosts = state.nextPosts.filter((other) => other !== each);
      continue;
    }
    if (pairing.playerIds.length !== 2 || pairing.playerIds.some((ids) => !ids.length)) continue;
    if (pairKey(each.setId, pairing.playerIds) === each.key) continue;
    // edit first so a failed edit stays watched for the next check. an edit never pings, the mentions just
    // stay so they can see it was theirs
    const changed = t('Changed by the TO');
    const content = each.discordIds.length ? `${mentions(each.discordIds)} ~~${each.text}~~ ${changed}` : changed;
    try {
      await editPost(postChannel, each, { content, components: [], allowedMentions: { parse: [] } });
    } catch (err) {
      console.error(`crossing out next opponent ${each.messageId} failed:`, err.message);
      continue;
    }
    state.nextPosts = state.nextPosts.filter((other) => other !== each);
    // forgotten, so if the TO puts the same two back it posts again
    state.nextPosted = state.nextPosted.filter((key) => key !== each.key);
  }
  save();
}
