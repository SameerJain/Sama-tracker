import { state } from './store.js';
import { DEFAULT_RECAP_SCHEDULE } from './reports.js';

export const MESSAGE_TYPES = {
  sets: 'Set results', streams: 'Stream alerts', calls: 'Match call pings', rollcall: 'Tournament roll calls',
  results: 'Tournament placements', registration: 'Registration reminders', slippi: 'Slippi rank changes', recap: 'Weekly crew recap',
};
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// dueAt is when it would have gone out. something that came due while it was off stays skipped
// after it's turned back on, even if no check ran in between to skip it then.
// match call pings start off, everything else starts on
export function messageEnabled(type, dueAt) {
  const messages = state.messages ?? {};
  if (type === 'calls') {
    if (messages.calls !== true) return false;
  } else if (messages[type] === false) return false;
  return dueAt == null || dueAt >= (messages.enabledAt?.[type] ?? 0);
}

export function messageSettings() {
  return { ...Object.fromEntries(Object.keys(MESSAGE_TYPES).map((type) => [type, true])), calls: false, ...DEFAULT_RECAP_SCHEDULE, ...state.messages };
}
