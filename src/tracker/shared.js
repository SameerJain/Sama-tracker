import { RESTJSONErrorCodes } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state } from '../store.js';
import { messageEnabled } from '../message-settings.js';

export const SET_CHECK_MINUTES = 2;
export const TOURNAMENT_CHECK_MINUTES = 15;
export const PROFILE_CHECK_HOURS = 24;
export const ROLL_CALL_HOURS_BEFORE = 1;
export const ROLL_CALL_MIN_PLAYERS = 3;
// results wait this long after the end since TOs often report top 4 late, then go out
// with whatever exists. unfinished placements are marked as projected
export const RESULTS_WAIT_HOURS = 12;
// a top 8 start.gg keeps erroring on holds the placements back this long, then they go without it
export const TOP8_RETRY_HOURS = 12;
// after downtime, don't post sets older than this
export const CATCH_UP_HOURS = 3;
// some TOs set the end date years out by mistake
export const MAX_TOURNAMENT_DAYS = 7;
// tournaments over a day out barely change, so they get looked at less
export const FAR_OFF_CHECK_HOURS = 6;
// untracked tournaments a month past their end are forgotten, so the map can't grow forever
export const TOURNAMENT_FORGOTTEN_DAYS = 30;
// discord allows 100 mentions a message, and 2000 chars fits about 80
export const MENTIONS_PER_MESSAGE = 80;
// hours before registration closes. the last one is the last call
export const REG_REMINDER_HOURS = [7 * 24, 3 * 24, 24, 6];
// a custom schedule runs 1 hour to 30 days out, and at most this many reminders
export const MAX_REMINDERS = 10;
export const MAX_REMINDER_HOURS = 30 * 24;
// DMs go out this long before registration closes and before the start
export const DM_HOURS_BEFORE = 1;
// the saved times can be a little stale, so start.gg gets asked this much before a DM is due. further out costs no request
export const DM_LOOKAHEAD_HOURS = 2;
// locals run late, so a tournament still counts as live this long after its end time
export const RUNS_LATE_HOURS = 6;
// slippi ranks only change after ranked sets, and its API isn't public, so it gets asked less than start.gg
export const SLIPPI_CHECK_MINUTES = 30;
// one or two games a week, so daily is plenty except near kickoff, when a
// final can land any minute over about 4 hours
export const BILLS_BASELINE_HOURS = 24;
export const BILLS_GAMEDAY_MINUTES = 15;
export const BILLS_PREGAME_HOURS = 1;
export const BILLS_POSTGAME_HOURS = 8;
// players with no connect code on start.gg get looked at again this often, in case they play a netplay tournament since
export const SLIPPI_SEARCH_DAYS = 7;
export const SLIPPI_SKIPPED_KEPT = 1000;
// /messages threads needs these in the channel, named the way discord's settings show them
export const THREAD_PERMISSIONS = { CreatePublicThreads: 'Create Public Threads', SendMessagesInThreads: 'Send Messages in Threads' };
// longer than any tournament runs, then the thread is forgotten
export const THREAD_KEPT_DAYS = 14;
// a Head to head button comes off when its set is over, or this long after the post if start.gg never says so
export const BUTTON_KEPT_HOURS = 12;
// TOs report the wrong winner or score and fix it, or reset the set, so set results get looked at again this long
export const RESULT_WATCH_MINUTES = 60;
// calls get looked at this long for going back to waiting
export const CALL_WATCH_MINUTES = 15;
// a set back to waiting, ready or queued isn't called anymore
export const UNCALLED_STATES = [1, 4, 7];
// placements that went out projected get edited once they're final, for this long after
export const PROJECTED_KEPT_DAYS = 3;
// players with no reported set in this long get taken off the track list silently
export const PRUNE_AFTER_DAYS = 6 * 30;
// the prune only looks at dates, so every two weeks is plenty
export const PRUNE_CHECK_DAYS = 14;
// discord events get start.gg's latest time and place this often. TOs rarely move a tournament, and each
// event costs one request
export const EVENT_SYNC_MINUTES = 60;

export const HOUR = 60 * 60;
export const DAY = 24 * HOUR;

export function secondsNow() {
  return Math.floor(Date.now() / 1000);
}

// for /status
export const health = {
  startedAt: secondsNow(), downSince: null, skippedBefore: null, setCheck: null, setError: null, tournamentCheck: null, slippiCheck: null, slippiError: null, threadError: null,
  billsCheck: null, billsError: null,
};

export let channel;

export function setChannel(postChannel) {
  channel = postChannel;
}

// whether a tracked tournament has this /t-o tournament posts switch on. untracked ones have none
export function posting(tournament, kind) {
  return Boolean(tournament?.tracked) && tournament.tracked[kind] !== false;
}

// the tracked tournament a set is from. sets don't come with the tournament id, so it goes by slug
export function trackedFor(set) {
  const slug = set.event?.tournament?.slug;
  return Object.values(state.tournaments).find((tournament) => tournament.tracked && tournament.slug === slug);
}

// who the cards at a tournament can name: its crew from the server, then tracked players
export function crewOf(tournament) {
  return { ...tournament.crew, ...state.players };
}

// the user ids a tournament check asks start.gg about: tracked players who signed up, then the rest of the crew
export function crewIds(tournament) {
  const ids = new Map();
  for (const id of tournament.userIds ?? []) if (state.players[id]) ids.set(String(id), id);
  for (const member of Object.values(tournament.crew ?? {})) ids.set(String(member.userId), member.userId);
  return [...ids.values()];
}

// tracked tournaments going on now with this switch on. sets keep getting looked at for one check after every
// event finished, since the tournament check can notice that before the set check sees the last set
export function trackedLive(kind, now = secondsNow()) {
  return Object.values(state.tournaments).filter((tournament) => posting(tournament, kind) && !tournament.resultsPosted
    && tournament.startAt <= now && now <= endTime(tournament) + RUNS_LATE_HOURS * HOUR
    && !(tournament.doneAt && tournament.lastCheck >= tournament.doneAt));
}

// one run at a time so nothing posts twice. if a run is already waiting, extra calls
// get dropped since it'll see the latest players anyway. background even when a
// command kicks it off, so it doesn't cut in front of other commands
export function queued(check) {
  let last = Promise.resolve();
  let waiting = false;
  return () => {
    if (waiting) return;
    waiting = true;
    last = last.then(() => {
      waiting = false;
      return startgg.inBackground(check);
    }).catch(console.error);
  };
}

// fewest messages that fit discord's limits. the switch gets checked before each one in case it's turned off partway.
// returns the messages that went out
export async function post(list, type, dueAt, postChannel = channel) {
  const sent = [];
  for (const batch of embeds.messages(list)) {
    // roll calls and placements name people but never ping them
    if (messageEnabled(type, dueAt)) sent.push(await postChannel.send({ embeds: batch, allowedMentions: { parse: [] } }));
  }
  return sent;
}

// what a post gets saved as to edit later. a message object can't outlast a restart
export const postRefs = (messages) => messages.filter((message) => message?.id).map((message) => ({ channelId: message.channelId, messageId: message.id }));

// edits a saved post, payload or a function that makes it from the message as discord has it now.
// false when someone deleted the post or its thread, which is fine
export async function editPost(postChannel, { channelId, messageId }, payload) {
  try {
    const { messages } = await postChannel.client.channels.fetch(channelId);
    await messages.edit(messageId, typeof payload === 'function' ? payload(await messages.fetch(messageId)) : payload);
    return true;
  } catch (err) {
    if ([RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel].includes(err.code)) return false;
    throw err;
  }
}

// ids only ever form a mention. anything with mention syntax in it stays out instead of going in as text
export const mentionable = (id) => Boolean(id) && /^[\w-]+$/.test(String(id));
export const mentions = (discordIds) => discordIds.filter(mentionable).map((id) => `<@${id}>`).join(' ');

// the card and its buttons go with the first batch of pings, or alone if there's nobody to ping. the rest
// stop if /messages turns the type off partway through. returns the message with the card
export async function sendPinging(postChannel, type, ids, text, embed, components = []) {
  let first;
  for (let i = 0; i === 0 || i < ids.length; i += MENTIONS_PER_MESSAGE) {
    if (i > 0 && !messageEnabled(type)) break;
    // ping lists come from discord, but the filter stays here so no caller can pass mention syntax through
    const users = ids.slice(i, i + MENTIONS_PER_MESSAGE).filter(mentionable);
    const sent = await postChannel.send({
      content: users.length ? `${mentions(users)} ${text}` : undefined,
      embeds: i === 0 ? embeds.withImage([embed]) : [],
      components: i === 0 ? components : [],
      allowedMentions: { users },
    });
    first ??= sent;
  }
  return first;
}

// /track posts turns a player's automatic set results on. players saved before they started off have no field
export function resultsOn(player) {
  return Boolean(player) && player.setResults !== false;
}

// /track posts turns a player's stream alerts on. players saved before they started off have no field
export function alertsOn(player) {
  return Boolean(player) && player.streamAlerts !== false;
}

export function endTime(tournament) {
  return Math.min(tournament.endAt ?? tournament.startAt, tournament.startAt + MAX_TOURNAMENT_DAYS * DAY);
}

// a finished bracket counts as over even if the TO set the end date way out
export function overAt(tournament) {
  return Math.min(endTime(tournament), tournament.doneAt ?? Infinity);
}

// lots of weeklies leave registration open after the start, but you still have to sign up before it
export function regDeadline(tournament) {
  return Math.min(tournament.registrationClosesAt ?? tournament.startAt, tournament.startAt);
}

// hours before the deadline each reminder goes out, most first. a tournament with a custom
// schedule from /t-o tournament uses that, everything else the default above
export function reminderSchedule(tournament) {
  const custom = tournament?.tracked?.schedule;
  return Array.isArray(custom) && custom.length ? custom : REG_REMINDER_HOURS;
}

// index of the first reminder still to come. ones already past get skipped,
// except the last call, so setting it late sends that right away
export function nextRegReminder(deadline, schedule = REG_REMINDER_HOURS) {
  const next = schedule.findIndex((hours) => secondsNow() < deadline - hours * HOUR);
  return next === -1 ? schedule.length - 1 : next;
}

// the events a tournament's top 8 and finish go by, shaped like entries: every event of a tracked one once
// start.gg's list is saved, otherwise the ones the crew entered
export function eventsOf(tournament) {
  if (!tournament.tracked || !tournament.events?.length) return tournament.entries ?? [];
  return tournament.events.map((event) => ({
    eventId: event.id, event: event.name, eventSlug: event.slug, entrants: event.numEntrants,
    done: event.state === 'COMPLETED', started: event.state !== 'CREATED',
  }));
}

// untracked tournaments a month past their end are forgotten, so the map of every tournament
// tracked players were once in can't grow forever. tracked ones stay for their posts
export function shouldForgetTournament(tournament, now = secondsNow()) {
  return !tournament.tracked && !tournament.resultsPosted && now > endTime(tournament) + TOURNAMENT_FORGOTTEN_DAYS * DAY;
}
