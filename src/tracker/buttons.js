import * as startgg from '../startgg.js';
import { state, save } from '../store.js';
import { buttonRow, h2hButton } from '../commands/shared.js';
import { currentChannel, secondsNow, editPost, BUTTON_KEPT_HOURS, HOUR } from './shared.js';

// a Head to head button under a match call or stream alert, about the first tracked player in it, or fallback, the
// linked player a match call is for. finished sets don't get one. it answers only whoever pressed it, so the
// channel doesn't fill up with reports
export function h2hRow(set, fallback) {
  const player = Object.values(state.players).find((each) => set.sides.some((side) => side.playerIds.includes(each.playerId))) ?? fallback;
  return player ? buttonRow(h2hButton(set, player, { label: 'Head to head', action: 'private' })) : [];
}

// saved so clearFinishedButtons can find the post again after a restart. start.gg's preview sets
// have ids like preview_1_2 that can't be looked up, and those never get called anyway
export function rememberButton(message, set, components) {
  if (!components.length || !message?.id || !/^\d+$/.test(set.id)) return;
  state.buttons.push({ setId: set.id, channelId: message.channelId, messageId: message.id, at: secondsNow() });
  state.buttons = state.buttons.slice(-200);
  save();
}

// takes the Head to head button off match calls and stream alerts whose set is over, or got deleted,
// in one request for all of them. a post that's 12 hours old loses it without asking
export async function clearFinishedButtons(postChannel = currentChannel()) {
  const saved = state.buttons;
  if (!saved.length) return;
  const now = secondsNow();
  const recent = saved.filter((each) => each.at > now - BUTTON_KEPT_HOURS * HOUR);
  let states;
  try {
    states = recent.length ? await startgg.getSetStates([...new Set(recent.map((each) => each.setId))]) : new Map();
  } catch (err) {
    console.error('checking sets with buttons failed:', err.message);
    return;
  }
  const over = (each) => !recent.includes(each) || [3, null].includes(states.get(each.setId));

  for (const each of saved.filter(over)) {
    await editPost(postChannel, each, { components: [] })
      .catch((err) => console.error(`taking the button off message ${each.messageId} failed:`, err.message));
  }
  state.buttons = saved.filter((each) => !over(each));
  save();
}
