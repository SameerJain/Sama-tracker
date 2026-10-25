import { state } from './store.js';
import { DEFAULT_RECAP_SCHEDULE } from './reports.js';

export const MESSAGE_TYPES = {
  sets: 'Set results', streams: 'Stream alerts', calls: 'Match call pings', next: 'Next opponents', rollcall: 'Tournament roll calls',
  results: 'Tournament placements', top8: 'Top 8s', registration: 'Registration reminders', events: 'Discord events for tracked tournaments',
  slippi: 'Slippi rank changes and season wrap-ups', recap: 'Weekly crew recap', bills: 'Bills final results',
};
// where set results, stream alerts, match calls and next opponents go, named the way /t-o settings lists them
export const THREAD_MODES = { off: 'Off, post in the channel', tournament: 'One thread per tournament', event: 'One thread per event' };
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// only an explicit on counts for these, everything else starts on, tracked tournaments' posts included, since
// they follow these switches until /t-o tournament posts overrides one. discord events show in the server's
// event list, so a server asks for them
const OFF_BY_DEFAULT = ['bills', 'events'];

// dueAt is when it would have gone out. something that came due while it was off stays skipped
// after it's turned back on, even if no check ran in between to skip it then
export function messageEnabled(type, dueAt) {
  const { messages } = state;
  if (OFF_BY_DEFAULT.includes(type) ? messages[type] !== true : messages[type] === false) return false;
  return dueAt == null || dueAt >= (messages.enabledAt?.[type] ?? 0);
}

// the kinds a tracked tournament can override, in the order /t-o tournament posts lists them
export const TOURNAMENT_POSTS = ['sets', 'streams', 'calls', 'next', 'top8', 'registration'];

// whether a post of this kind goes out, for a tracked tournament when one is given. its own override beats the
// server switch either way, and one turned on skips what came due before then, the way the server switch does
export function postsOn(type, tournament = null, dueAt) {
  const tracked = tournament?.tracked;
  const override = tracked?.posts?.[type];
  if (override === false) return false;
  if (override === true) return dueAt == null || dueAt >= (tracked.onAt?.[type] ?? 0);
  return messageEnabled(type, dueAt);
}

// how long a discord event runs when start.gg has no end time, per server. 5 hours is the
// middle of a weekly, and each server tunes its own with /t-o settings event_length
export const DEFAULT_EVENT_LENGTH_HOURS = 5;
export const MIN_EVENT_LENGTH_HOURS = 2;
export const MAX_EVENT_LENGTH_HOURS = 12;
// a major or regional with no end time still gets a full day, however short the server tuned
// its own events. 128 entrants is ~8 rounds and 5 brackets is a multi-track schedule, both
// past what one evening can hold
export const BIG_EVENT_HOURS = 12;
export const BIG_EVENT_ATTENDEES = 128;
export const BIG_EVENT_BRACKETS = 5;

export function messageSettings() {
  const defaults = Object.fromEntries(Object.keys(MESSAGE_TYPES).map((type) => [type, !OFF_BY_DEFAULT.includes(type)]));
  const saved = state.messages.threads;
  // saved as true or false before there were three modes
  const threads = saved === true ? 'tournament' : Object.hasOwn(THREAD_MODES, saved) ? saved : 'off';
  return { ...defaults, ...DEFAULT_RECAP_SCHEDULE, eventLength: DEFAULT_EVENT_LENGTH_HOURS, ...state.messages, threads };
}

// the role /notify registration hands out and reg reminders ping, so one ping reaches everyone
// who opted in instead of naming each of them
export const REG_ROLE = 'Reg Reminders';

// green for a tracked win, red for a loss, gold when two tracked players meet and blue when
// nobody tracked played. off, every set result card stays blue. small crews turn it on to see
// each member at a glance, big servers leave it off
export const setResultColors = () => messageSettings().setColors === true;
