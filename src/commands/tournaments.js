import { escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import { postsChannelId, state, save } from '../store.js';
import { ensureDiscordEvent } from '../discord-events.js';
import {
  MAX_REMINDER_HOURS, MAX_REMINDERS, REG_REMINDER_HOURS, RUNS_LATE_HOURS, checkRegReminders, checkTournaments, endTime, missingThreadPermissions, nextRegReminder, regDeadline,
  reminderSchedule, secondsNow, trackTournament,
} from '../tracker.js';
import { shortSchedule } from '../embeds/shared.js';
import { lookup, replyEphemeral } from './shared.js';
import { askFirst, confirmable } from './confirm.js';
import { isTO, notTO } from './to.js';
import { tournamentNotFound, tournamentSlug } from './registration.js';

const HOUR = 60 * 60;

// /t-o tournament posts switches, named the way the replies list them
const POSTS = { sets: 'Every set', stream: 'Stream alerts', calls: 'Match calls', top8: 'Top 8s', reminders: 'Reg reminders' };

// 7 days, 3 days, 1 day and 6 hours
function inWords(hours) {
  return hours % 24 ? `${hours} hours` : `${hours / 24} day${hours === 24 ? '' : 's'}`;
}

// custom reminder times before registration closes, like 7d,3d,1d,6h. bare numbers mean hours.
// null when left out, { error } when it doesn't parse, otherwise hours before the deadline, most first
function parseSchedule(input) {
  if (!input) return null;
  const hours = [];
  for (const part of input.split(/[\s,]+/).filter(Boolean)) {
    const match = part.match(/^(\d+(?:\.\d+)?)(h|d)?$/i);
    const at = match && Number(match[1]) * (match[2]?.toLowerCase() === 'd' ? 24 : 1);
    if (!match || !(at > 0)) return { error: `Couldn't read \`${part}\` as a reminder time. Use hours or days, like 7d,3d,1d,6h.` };
    hours.push(at);
  }
  const schedule = [...new Set(hours)].sort((a, b) => b - a);
  if (!schedule.length || schedule.length > MAX_REMINDERS || schedule.some((at) => at < 1 || at > MAX_REMINDER_HOURS)) {
    return { error: `Reminders run 1 hour to 30 days out, up to ${MAX_REMINDERS} of them, like 7d,3d,1d,6h.` };
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

// what a tracked tournament posts, on one line. a custom reminder schedule shows with it.
// match calls start off, so a tournament tracked before they existed reads as off too
function postsText(tournament) {
  const lines = Object.entries(POSTS).map(([name, label]) => {
    if (name === 'reminders' && tournament.tracked[name] !== false && tournament.tracked.schedule) {
      return `**${label}:** on (${shortSchedule(tournament.tracked.schedule)})`;
    }
    const on = name === 'calls' ? tournament.tracked[name] === true : tournament.tracked[name] !== false;
    return `**${label}:** ${on ? 'on' : 'off'}`;
  });
  return lines.join(' · ');
}

// every set and stream alert goes in its thread, so say when that can't happen yet
function threadWarning(interaction) {
  // the posts channel, not wherever this ran. a multi-server build with no channel in /t-o settings yet has none
  const channelId = postsChannelId();
  const postChannel = channelId && interaction.client?.channels?.cache?.get(channelId);
  if (!postChannel) return null;
  const missing = missingThreadPermissions(postChannel);
  if (!missing) return `Threads can't be started in <#${channelId}>, so its sets and stream alerts post there instead.`;
  if (missing.length) return `I need ${missing.join(' and ')} in <#${channelId}> to start its thread. Until then its sets and stream alerts post there instead.`;
  return null;
}

// tracks a tournament from getRegistration by hand for /t-o tournament add, and says what that set up. one
// already tracked keeps its switches and reminder schedule
function trackLines(interaction, found, reminders, schedule, now = secondsNow()) {
  const name = escapeMarkdown(found.name);
  if (state.tournaments[found.id]?.tracked) return [`Already tracking ${name}.`];

  const { id, slug, startAt, endAt, city, addrState, venueName, venueAddress, isOnline } = found;
  const images = (found.images ?? []).filter((image) => image.type === 'profile').map(({ url }) => ({ url }));
  const tournament = state.tournaments[id] ??= {
    id, name: found.name, slug, startAt, endAt, city, addrState, venueName, venueAddress, isOnline, images, entries: [], userIds: [],
  };
  trackTournament(tournament, 'manual', now);
  tournament.tracked.reminders = reminders;
  if (schedule) tournament.tracked.schedule = schedule;

  const lines = [`Tracking ${name}. Every set and stream alert from it posts in its own thread, then results and each event's top 8 once the bracket is finished.`];
  const deadline = regDeadline(found);
  const hours = schedule ?? REG_REMINDER_HOURS;
  const next = nextRegReminder(deadline, hours);
  const firstAt = deadline - hours[next] * HOUR;
  // further out it might just not be open yet
  const open = deadline > now && (firstAt > now || found.isRegistrationOpen);
  if (open) tournament.reminder = { deadline, next };
  if (!reminders) lines.push('No reg reminders.');
  else if (!open) lines.push('Registration is closed, so no reg reminders.');
  else if (firstAt <= now) lines.push(`Registration ends <t:${deadline}:R>, sending the last call now.`);
  else {
    const when = new Intl.ListFormat('en').format(hours.slice(next).map(inWords));
    lines.push(`Everyone with \`/notify registration\` on gets pinged ${when} before registration ends, starting <t:${firstAt}:R>.`);
  }
  const warning = threadWarning(interaction);
  if (warning) lines.push(warning);
  lines.push('-# `/t-o tournament posts` turns any of it off, or posts every called set with `calls:on`');
  return lines;
}

// /t-o tournament is TOs only. discord shows it to everyone, since the TO role is the bot's to check
async function tournamentAdd(interaction) {
  if (!isTO(interaction)) return notTO(interaction, 'track tournaments');
  const input = interaction.options.getString('tournament', true).trim();
  const reminders = interaction.options.getString('reminders') !== 'off';
  const schedule = parseSchedule(interaction.options.getString('schedule'));
  if (schedule?.error) return replyEphemeral(interaction, schedule.error);
  const addEvent = interaction.options.getString('add_event') === 'on';

  await interaction.deferReply();
  const found = await startgg.getRegistration(tournamentSlug(input));
  if (!found) return interaction.editReply(tournamentNotFound(input));
  const name = escapeMarkdown(found.name);
  const now = secondsNow();
  if (now > endTime(found) + RUNS_LATE_HOURS * HOUR) return interaction.editReply({ content: `${name} is already over.`, allowedMentions: { parse: [] } });
  // with add_event it still makes the event
  if (state.tournaments[found.id]?.tracked && !addEvent) {
    return interaction.editReply({ content: `${name} is already tracked. \`/t-o tournament posts\` changes what it posts.`, allowedMentions: { parse: [] } });
  }

  const lines = trackLines(interaction, found, reminders, schedule, now);
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
  if (!isTO(interaction)) return notTO(interaction, 'stop tracking tournaments');
  const tournament = trackedPick(interaction);
  if (!tournament) return replyEphemeral(interaction, 'That tournament isn\'t tracked. `/track list` shows the ones that are.');
  const calls = tournament.tracked.calls === true ? 'match calls, ' : '';
  return askFirst(interaction, 'untrack_tournament', tournament.id, `Stop tracking ${escapeMarkdown(tournament.name)}? Its sets, stream alerts, ${calls}top 8s and reg reminders stop.`, 'Stop tracking');
}

confirmable('untrack_tournament', {
  command: '/t-o tournament remove',
  run: (id) => {
    const tournament = state.tournaments[id];
    if (!tournament?.tracked) return { content: 'It isn\'t tracked anymore.' };
    const kept = { id: tournament.id, tracked: tournament.tracked, reminder: tournament.reminder, crew: tournament.crew };
    delete tournament.tracked;
    delete tournament.reminder;
    delete tournament.crew;
    save();
    return { content: `Stopped tracking ${escapeMarkdown(tournament.name)}.`, undo: kept };
  },
  cancel: (id) => (state.tournaments[id]?.tracked ? `Still tracking ${escapeMarkdown(state.tournaments[id].name)}.` : 'It isn\'t tracked anymore.'),
  undo: (kept) => {
    const tournament = state.tournaments[kept.id];
    // its placements went out and it got cleared in the minute since, which the next check would redo anyway
    if (!tournament) return 'Too late to undo, it\'s over. `/t-o tournament add` it again.';
    if (tournament.tracked) return `${escapeMarkdown(tournament.name)} is already tracked again.`;
    Object.assign(tournament, { tracked: kept.tracked, reminder: kept.reminder, crew: kept.crew });
    save();
    return `Tracking ${escapeMarkdown(tournament.name)} again, with the same settings as before.`;
  },
  tooLate: 'Too late to undo. `/t-o tournament add` it again.',
});

// with no switches it says what's on. sets turned back on start from now, the way a newly tracked tournament does,
// and reminders turned back on start from the next one still to come, so nothing missed goes out late.
// a new schedule starts from its next one still to come the same way, and default goes back to the usual four
function tournamentPosts(interaction) {
  if (!isTO(interaction)) return notTO(interaction, 'change what tournaments post');
  const tournament = trackedPick(interaction);
  if (!tournament) return replyEphemeral(interaction, 'That tournament isn\'t tracked. `/t-o tournament add` it first.');
  const rawSchedule = interaction.options.getString('schedule');
  const resetting = rawSchedule?.trim().toLowerCase() === 'default';
  const schedule = resetting ? null : parseSchedule(rawSchedule);
  if (schedule?.error) return replyEphemeral(interaction, schedule.error);
  const changes = {};
  for (const name of Object.keys(POSTS)) {
    const value = interaction.options.getString(name);
    if (value) changes[name] = value === 'on';
  }
  const name = escapeMarkdown(tournament.name);
  if (!Object.keys(changes).length && !schedule && !resetting) return replyEphemeral(interaction, `**${name}**\n${postsText(tournament)}`);

  const { tracked } = tournament;
  if (changes.sets && tracked.sets === false) tournament.lastCheck = secondsNow();
  if ((changes.reminders && tracked.reminders === false) || schedule || resetting) {
    tournament.reminder ??= {};
    delete tournament.reminder.next;
  }
  if (schedule) tracked.schedule = schedule;
  else if (resetting) delete tracked.schedule;
  Object.assign(tracked, changes);
  save();
  const lines = [`**${name}**`, postsText(tournament)];
  if (schedule) lines.push(`-# Reg reminders go out ${new Intl.ListFormat('en').format(schedule.map(inWords))} before registration ends, starting from the next one still to come`);
  else if (resetting) lines.push('-# Reg reminders are back to the usual 7 days, 3 days, 1 day and 6 hours before registration ends');
  return interaction.reply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

// one line about the discord event, made or found. errors go in the reply the same way
async function eventLines(interaction, found) {
  const name = escapeMarkdown(found.name);
  if (!found.startAt) return [`${name} has no start time on start.gg, so Discord can't schedule it.`];
  if (found.startAt <= secondsNow()) return [`${name} already started <t:${found.startAt}:R>. Discord events have to start in the future.`];
  const result = await ensureDiscordEvent(found, interaction.guild);
  if (result.error) return [result.error];
  return result.isNew
    ? [`Made a Discord event for ${name} on <t:${found.startAt}:F>: ${result.url}`]
    : [`${name} already has a Discord event: ${result.url}`];
}

// /t-o tournament event: paste a start.gg link, get a discord event. it doesn't track the tournament, /t-o tournament add
// does that. the event follows start.gg's time, end time, cover and place from then on, see syncDiscordEvents
async function tournamentEvent(interaction) {
  if (!isTO(interaction)) return notTO(interaction, 'make Discord events');
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
