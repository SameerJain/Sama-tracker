import { state } from './store.js';
import { DEFAULT_RECAP_SCHEDULE } from './reports.js';

export const MESSAGE_TYPES = {
  sets: 'Set results', streams: 'Stream alerts', calls: 'Match call pings', rollcall: 'Tournament roll calls',
  results: 'Tournament placements', top8: 'Top 8s', registration: 'Registration reminders', slippi: 'Slippi rank changes',
  recap: 'Weekly crew recap',
};
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// only an explicit on counts for these, everything else starts on
const OFF_BY_DEFAULT = ['calls', 'top8'];

// dueAt is when it would have gone out. something that came due while it was off stays skipped
// after it's turned back on, even if no check ran in between to skip it then
export function messageEnabled(type, dueAt) {
  const messages = state.messages ?? {};
  if (OFF_BY_DEFAULT.includes(type) ? messages[type] !== true : messages[type] === false) return false;
  return dueAt == null || dueAt >= (messages.enabledAt?.[type] ?? 0);
}

export function messageSettings() {
  const defaults = Object.fromEntries(Object.keys(MESSAGE_TYPES).map((type) => [type, !OFF_BY_DEFAULT.includes(type)]));
  return { ...defaults, ...DEFAULT_RECAP_SCHEDULE, ...state.messages };
}
