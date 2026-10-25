import { escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import { postsChannelId, state, save } from '../store.js';
import { ensureDiscordEvent } from '../discord-events.js';
import { TOURNAMENT_POSTS, postsOn } from '../message-settings.js';
import {
  MAX_REMINDER_HOURS, MAX_REMINDERS, REG_REMINDER_HOURS, RUNS_LATE_HOURS, checkRegReminders, checkTournaments, endTime, missingThreadPermissions, nextRegReminder, regDeadline,
  reminderSchedule, secondsNow, trackTournament,
} from '../tracker.js';
import { count, shortSchedule } from '../embeds/shared.js';
import { lookup, replyEphemeral, t, listOf } from './shared.js';
import { permissionList } from '../i18n.js';
import { askFirst, confirmable } from './confirm.js';
import { isTO, notTO } from './to.js';
import { tournamentNotFound, tournamentSlug } from './registration.js';

const HOUR = 60 * 60;

// /t-o tournament posts kinds, named the way the replies list them
const POSTS = {
  sets: () => t('Set results'), streams: () => t('Stream alerts'), calls: () => t('Match calls'), next: () => t('Next opponents'),
  top8: () => t('Top 8s'), registration: () => t('Reg reminders'),
};

// 7 days, 3 days, 1 day and 6 hours
const inWords = (hours) => (hours % 24 ? count(hours, 'hour') : count(hours / 24, 'day'));

// custom reminder times before registration closes, like 7d,3d,1d,6h. bare numbers mean hours.
// null when left out, { error } when it doesn't parse, otherwise hours before the deadline, most first
function parseSchedule(input) {
  if (!input) return null;
  const hours = [];
  for (const part of input.split(/[\s,]+/).filter(Boolean)) {
    const match = part.match(/^(\d+(?:\.\d+)?)(h|d)?$/i);
    const at = match && Number(match[1]) * (match[2]?.toLowerCase() === 'd' ? 24 : 1);
    if (!match || !(at > 0)) return { error: t`Couldn't read \`${part}\` as a reminder time. Use hours or days, like 7d,3d,1d,6h.` };
    hours.push(at);
  }
  const schedule = [...new Set(hours)].sort((a, b) => b - a);
  if (!schedule.length || schedule.length > MAX_REMINDERS || schedule.some((at) => at < 1 || at > MAX_REMINDER_HOURS)) {
    return { error: t`Reminders run 1 hour to 30 days out, up to ${MAX_REMINDERS} of them, like 7d,3d,1d,6h.` };
  }
  return schedule;
}

// a tracked tournament picked from the list, which sends its slug, or typed by name or link
function trackedPick(interaction) {
  const value = interaction.options.getString('tournament', true).trim().toLowerCase();
  const tracked = Object.values(state.tournaments).filter((tournament) => tournament.tracked);
  return tracked.find((tournament) => tournament.slug === `tournament/${tournamentSlug(value)}`)
    ?? lookup(Object.fromEntries(tracked.map((tournament) => [String(tournament.id), tournament])), value, 'name');
}

// what a tracked tournament posts, on one line. a kind with its own setting reads on or off, one following
// /t-o settings reads on (default) or off (default). a custom reminder schedule shows with reg reminders
function postsText(tournament) {
  const { posts, schedule } = tournament.tracked;
  const lines = TOURNAMENT_POSTS.map((kind) => {
    const on = postsOn(kind, tournament);
    const own = posts?.[kind] !== undefined;
    const word = on ? (own ? t('on') : t('on (default)')) : (own ? t('off') : t('off (default)'));
    if (kind === 'registration' && on && schedule) return t`**${POSTS[kind]()}:** ${word} · reminders ${shortSchedule(schedule)}`;
    return t`**${POSTS[kind]()}:** ${word}`;
  });
  return [lines.join(t(' · ')), t('-# default follows /t-o settings, which every tournament without its own setting goes by')].join('\n');
}

// every set, stream alert, match call and next opponent goes in its thread, so say when that can't happen yet
function threadWarning(interaction) {
  // the posts channel, not wherever this ran. a multi-server build with no channel in /t-o settings yet has none
  const channelId = postsChannelId();
  const postChannel = channelId && interaction.client?.channels?.cache?.get(channelId);
  if (!postChannel) return null;
  const missing = missingThreadPermissions(postChannel);
  if (!missing) return t`Threads can't be started in <#${channelId}>, so its sets, stream alerts, match calls and next opponents post there instead.`;
  if (missing.length) return t`I need ${permissionList(missing)} in <#${channelId}> to start its thread. Until then its sets, stream alerts, match calls and next opponents post there instead.`;
  return null;
}

// tracks a tournament from getRegistration by hand for /t-o tournament add, and says what that set up. one
// already tracked keeps its switches and reminder schedule
function trackLines(interaction, found, registration, schedule, now = secondsNow()) {
  const name = escapeMarkdown(found.name);
  if (state.tournaments[found.id]?.tracked) return [t`[tournament] Already tracking ${name}.`];

  const { id, slug, startAt, endAt, city, addrState, venueName, venueAddress, isOnline } = found;
  const images = (found.images ?? []).filter((image) => image.type === 'profile').map(({ url }) => ({ url }));
  const tournament = state.tournaments[id] ??= {
    id, name: found.name, slug, startAt, endAt, city, addrState, venueName, venueAddress, isOnline, images, entries: [], userIds: [],
  };
  trackTournament(tournament, 'manual', now);
  // no onAt: reminders start from the next one still to come anyway, and a time would hold back a last call
  // that's already due
  if (registration) tournament.tracked.posts.registration = registration === 'on';
  const reminders = postsOn('registration', tournament);
  if (schedule) tournament.tracked.schedule = schedule;

  const lines = [t`Tracking ${name}.`, postsText(tournament)];
  const deadline = regDeadline(found);
  const hours = schedule ?? REG_REMINDER_HOURS;
  const next = nextRegReminder(deadline, hours);
  const firstAt = deadline - hours[next] * HOUR;
  // further out it might just not be open yet
  const open = deadline > now && (firstAt > now || found.isRegistrationOpen);
  if (open) tournament.reminder = { deadline, next };
  if (!reminders) lines.push(t('No reg reminders.'));
  else if (!open) lines.push(t('Registration is closed, so no reg reminders.'));
  else if (firstAt <= now) lines.push(t`Registration ends <t:${deadline}:R>, sending the last call now.`);
  else {
    const when = listOf(hours.slice(next).map(inWords));
    lines.push(t`Everyone with \`/notify registration\` on gets pinged ${when} before registration ends, starting <t:${firstAt}:R>.`);
  }
  const warning = threadWarning(interaction);
  if (warning) lines.push(warning);
  return lines;
}

// /t-o tournament is TOs only. discord shows it to everyone, since the TO role is the bot's to check
async function tournamentAdd(interaction) {
  if (!isTO(interaction)) return notTO(interaction, t('track tournaments'));
  const input = interaction.options.getString('tournament', true).trim();
  const registration = interaction.options.getString('registration');
  const schedule = parseSchedule(interaction.options.getString('schedule'));
  if (schedule?.error) return replyEphemeral(interaction, schedule.error);
  const addEvent = interaction.options.getString('add_event') === 'on';

  await interaction.deferReply();
  const found = await startgg.getRegistration(tournamentSlug(input));
  if (!found) return interaction.editReply(tournamentNotFound(input));
  const name = escapeMarkdown(found.name);
  const now = secondsNow();
  if (now > endTime(found) + RUNS_LATE_HOURS * HOUR) return interaction.editReply({ content: t`${name} is already over.`, allowedMentions: { parse: [] } });
  // with add_event it still makes the event
  if (state.tournaments[found.id]?.tracked && !addEvent) {
    return interaction.editReply({ content: t`${name} is already tracked. \`/t-o tournament posts\` changes what it posts.`, allowedMentions: { parse: [] } });
  }

  const lines = trackLines(interaction, found, registration, schedule, now);
  if (addEvent) lines.push(...await eventLines(interaction, found));
  save();
  await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });

  // its events and crew, and a last call that's due now
  checkTournaments();
  checkRegReminders();
}

// asks first, then has an Undo button for a minute. it stays saved while tracked players are in it, or until its
// placements are over, so the thread card still gets unpinned
function tournamentRemove(interaction) {
  if (!isTO(interaction)) return notTO(interaction, t('stop tracking tournaments'));
  const tournament = trackedPick(interaction);
  if (!tournament) return replyEphemeral(interaction, t('That tournament isn\'t tracked. `/track list` shows the ones that are.'));
  const name = escapeMarkdown(tournament.name);
  const question = t`Stop tracking ${name}? Everything it posts stops.`;
  return askFirst(interaction, 'untrack_tournament', tournament.id, question, t('Stop tracking'));
}

confirmable('untrack_tournament', {
  command: '/t-o tournament remove',
  run: (id) => {
    const tournament = state.tournaments[id];
    if (!tournament?.tracked) return { content: t('It isn\'t tracked anymore.') };
    const kept = { id: tournament.id, tracked: tournament.tracked, reminder: tournament.reminder, crew: tournament.crew };
    delete tournament.tracked;
    delete tournament.reminder;
    delete tournament.crew;
    save();
    return { content: t`[tournament] Stopped tracking ${escapeMarkdown(tournament.name)}.`, undo: kept };
  },
  cancel: (id) => (state.tournaments[id]?.tracked ? t`[tournament] Still tracking ${escapeMarkdown(state.tournaments[id].name)}.` : t('It isn\'t tracked anymore.')),
  undo: (kept) => {
    const tournament = state.tournaments[kept.id];
    // its placements went out and it got cleared in the minute since, which the next check would redo anyway
    if (!tournament) return t('Too late to undo, it\'s over. `/t-o tournament add` it again.');
    if (tournament.tracked) return t`[tournament] ${escapeMarkdown(tournament.name)} is already tracked again.`;
    Object.assign(tournament, { tracked: kept.tracked, reminder: kept.reminder, crew: kept.crew });
    save();
    return t`[tournament] Tracking ${escapeMarkdown(tournament.name)} again, with the same settings as before.`;
  },
  tooLate: () => t('Too late to undo. `/t-o tournament add` it again.'),
});

// with no switches it says what's on. a kind that goes from off to on starts from now, the way a newly tracked
// tournament does, so nothing missed goes out late. that counts a kind going back to default when the server has
// it on. a new schedule starts from its next one still to come the same way, and schedule default goes back to
// the usual four
function tournamentPosts(interaction) {
  if (!isTO(interaction)) return notTO(interaction, t('change what tournaments post'));
  const tournament = trackedPick(interaction);
  if (!tournament) return replyEphemeral(interaction, t('That tournament isn\'t tracked. `/t-o tournament add` it first.'));
  const rawSchedule = interaction.options.getString('schedule');
  const resetting = rawSchedule?.trim().toLowerCase() === 'default';
  const schedule = resetting ? null : parseSchedule(rawSchedule);
  if (schedule?.error) return replyEphemeral(interaction, schedule.error);
  const changes = {};
  for (const kind of TOURNAMENT_POSTS) {
    const value = interaction.options.getString(kind);
    if (value) changes[kind] = value;
  }
  const name = escapeMarkdown(tournament.name);
  if (!Object.keys(changes).length && !schedule && !resetting) return replyEphemeral(interaction, t`**${name}**\n${postsText(tournament)}`);

  const { tracked } = tournament;
  const before = Object.fromEntries(Object.keys(changes).map((kind) => [kind, postsOn(kind, tournament)]));
  tracked.posts ??= {};
  tracked.onAt ??= {};
  for (const [kind, value] of Object.entries(changes)) {
    if (value === 'default') delete tracked.posts[kind];
    else tracked.posts[kind] = value === 'on';
  }
  const now = secondsNow();
  for (const kind of Object.keys(changes)) {
    // reminders start again from the next one still to come below. a time would also hold back the last call,
    // which goes out right away when it's already due
    if (kind === 'registration') delete tracked.onAt.registration;
    else if (!before[kind] && postsOn(kind, tournament)) tracked.onAt[kind] = now;
    // already on keeps what it skipped before, and an override on needs a time either way
    else if (changes[kind] === 'on') tracked.onAt[kind] ??= state.messages.enabledAt?.[kind] ?? 0;
  }
  if (changes.sets && !before.sets && postsOn('sets', tournament)) tournament.lastCheck = now;
  if ((changes.registration && !before.registration && postsOn('registration', tournament)) || schedule || resetting) {
    tournament.reminder ??= {};
    delete tournament.reminder.next;
  }
  if (schedule) tracked.schedule = schedule;
  else if (resetting) delete tracked.schedule;
  save();
  const lines = [t`**${name}**`, postsText(tournament)];
  if (schedule) {
    const when = listOf(schedule.map(inWords));
    lines.push(t`-# Reg reminders go out ${when} before registration ends, starting from the next one still to come`);
  } else if (resetting) lines.push(t('-# Reg reminders are back to the usual 7 days, 3 days, 1 day and 6 hours before registration ends'));
  return interaction.reply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

// one line about the discord event, made or found. errors go in the reply the same way
async function eventLines(interaction, found) {
  const name = escapeMarkdown(found.name);
  if (!found.startAt) return [t`${name} has no start time on start.gg, so Discord can't schedule it.`];
  if (found.startAt <= secondsNow()) return [t`${name} already started <t:${found.startAt}:R>. Discord events have to start in the future.`];
  const result = await ensureDiscordEvent(found, interaction.guild);
  if (result.error) return [result.error];
  return result.isNew
    ? [t`Made a Discord event for ${name} on <t:${found.startAt}:F>: ${result.url}`]
    : [t`${name} already has a Discord event: ${result.url}`];
}

// /t-o tournament event: paste a start.gg link, get a discord event. it doesn't track the tournament, /t-o tournament add
// does that. the event follows start.gg's time, end time, cover and place from then on, see syncDiscordEvents
async function tournamentEvent(interaction) {
  if (!isTO(interaction)) return notTO(interaction, t('make Discord events'));
  const input = interaction.options.getString('tournament', true).trim();

  await interaction.deferReply();
  const found = await startgg.getRegistration(tournamentSlug(input));
  if (!found) return interaction.editReply(tournamentNotFound(input));
  const lines = await eventLines(interaction, found);
  // the event id, so the sync can find it
  save();
  await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

export { tournamentAdd, tournamentRemove, tournamentPosts, tournamentEvent, parseSchedule };
