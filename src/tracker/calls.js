import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { messageEnabled } from '../message-settings.js';
import { linkedPlayer } from '../commands/shared.js';
import { channel, secondsNow, postRefs, editPost, mentionable, mentions, CALL_WATCH_MINUTES, UNCALLED_STATES } from './shared.js';
import { h2hRow, rememberButton } from './buttons.js';

// everyone with /notify calls on, as the start.gg account commands know them by: their /link, or the tracked
// player with their discord on start.gg. someone with neither has nothing to look up and waits for one
function callers() {
  const found = [];
  for (const discordId of state.callPings) {
    const player = linkedPlayer(discordId);
    if (player?.playerId) found.push({ ...player, discordId });
  }
  return found;
}

export async function postMatchCalls(postChannel = channel) {
  try {
    const players = callers();
    if (!players.length) return;
    const playerIds = new Set(players.map((player) => player.playerId));
    for (const set of await startgg.getCalledSets([...playerIds])) {
      // both sides can have pings on, still one message for the set.
      // doubles sides hold two player ids each, so all four land in the same message
      const inSet = players.filter((player) => set.sides.some((side) => side.playerIds.includes(player.playerId)));
      if (!inSet.length) continue;
      const discordIds = [...new Set(inSet.map((player) => player.discordId).filter(mentionable))];
      if ((state.called ??= []).includes(set.id)) {
        const watched = state.callPosts.find((each) => each.setId === set.id);
        const newIds = watched ? discordIds.filter((id) => !watched.discordIds.includes(id)) : [];
        if (newIds.length) {
          if (messageEnabled('calls', set.updatedAt)) await sendMatchCall(set, inSet, newIds, postChannel);
          watched.discordIds.push(...newIds);
          save();
        }
        continue;
      }
      if (messageEnabled('calls', set.updatedAt)) {
        const { sent, text } = await sendMatchCall(set, inSet, discordIds, postChannel);
        watchCall(sent, set, discordIds, text);
      }
      state.called.push(set.id);
      save();
    }
  } catch (err) {
    console.error('checking match calls failed:', err.message);
  }

  state.called = (state.called ?? []).slice(-200);
  save();
}

async function sendMatchCall(set, inSet, discordIds, postChannel) {
  const components = h2hRow(set, inSet[0]);
  const people = { ...Object.fromEntries(inSet.map((player) => [player.userId, player])), ...state.players };
  const text = set.station ? `You're up - Station ${set.station}` : `You're up`;
  const sent = await postChannel.send({
    content: discordIds.length ? `${mentions(discordIds)} ${text}` : undefined,
    embeds: embeds.withImage([embeds.matchCall(set, people)]),
    components,
    allowedMentions: { users: discordIds },
  });
  rememberButton(sent, set, components);
  return { sent, text };
}

// saved so followCalls can find the call again. a called set was last updated when it got called.
// text is the ping as it went out, so the uncalled edit and the still-up warning match it
function watchCall(message, set, discordIds, text) {
  if (!message?.id || !/^\d+$/.test(set.id)) return;
  const [ref] = postRefs([message]);
  state.callPosts.push({ setId: set.id, ...ref, calledAt: Math.min(set.updatedAt ?? Infinity, secondsNow()), discordIds, text });
  state.callPosts = state.callPosts.slice(-200);
  save();
}

// recent match calls in one request. a call usually means go now, so there's no wait
// before it goes out like stream alerts have. instead one whose set goes back to waiting gets edited to say
// it was uncalled, and the next call pings again. one still called when the warning comes due pings the
// it was uncalled. started, finished and deleted sets stop being watched
export async function followCalls(postChannel = channel) {
  const now = secondsNow();
  const before = state.callPosts.length;
  state.callPosts = state.callPosts.filter((each) => each.calledAt > now - CALL_WATCH_MINUTES * 60);
  const watching = state.callPosts;
  if (!watching.length) {
    if (state.callPosts.length !== before) save();
    return;
  }
  try {
    const states = await startgg.getSetStates([...new Set(watching.map((each) => each.setId))]);
    for (const each of watching) {
      const setState = states.get(each.setId);
      if (setState === 6) continue;
      // started, finished or deleted, so there's nothing more to watch for
      if (!UNCALLED_STATES.includes(setState)) {
        state.callPosts = state.callPosts.filter((other) => other !== each);
        continue;
      }
      // uncalled: edit first so a failed edit stays watched for the next check
      state.called = state.called.filter((id) => id !== each.setId);
      // an edit never pings, the mentions just stay so they can see it was theirs
      const struck = each.text ?? `You're up`;
      const content = each.discordIds.length ? `${mentions(each.discordIds)} ~~${struck}~~ Uncalled by the TO, wait for the next call` : 'Uncalled by the TO, wait for the next call';
      await editPost(postChannel, each, { content, allowedMentions: { parse: [] } });
      state.callPosts = state.callPosts.filter((other) => other !== each);
    }
  } catch (err) {
    console.error('following up match calls failed:', err.message);
  }
  save();
}
