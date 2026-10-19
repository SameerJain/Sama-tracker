import { PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { isRegAdmin } from '../accounts.js';
import { ensureDiscordEvent } from '../discord-events.js';
import {
  REG_REMINDER_HOURS, RUNS_LATE_HOURS, checkRegReminders, checkTournaments, endTime, missingThreadPermissions, nextRegReminder, regDeadline,
  secondsNow, trackTournament,
} from '../tracker.js';
import { findPlayer, lookup, replyEphemeral, replyEphemeralAfterDefer } from './shared.js';
import { askFirst, confirmable } from './confirm.js';
import { tournamentNotFound, tournamentSlug } from './registration.js';

const HOUR = 60 * 60;

// /tournament posts switches, named the way the replies list them
const POSTS = { sets: 'Every set', stream: 'Stream alerts', top8: 'Top 8s', reminders: 'Reg reminders' };

// who can run /tournament is discord's to say: Manage Server by default, or any role a server hands it to

// 7 days, 3 days, 1 day and 12 hours
function inWords(hours) {
  return hours % 24 ? `${hours} hours` : `${hours / 24} day${hours === 24 ? '' : 's'}`;
}

// a tracked tournament picked from the list, which sends its slug, or typed by name or link
function trackedPick(interaction) {
  const value = interaction.options.getString('tournament', true).trim().toLowerCase();
  const tracked = Object.values(state.tournaments).filter((tournament) => tournament.tracked);
  return tracked.find((tournament) => tournament.slug === `tournament/${tournamentSlug(value)}`)
    ?? lookup(Object.fromEntries(tracked.map((tournament) => [String(tournament.id), tournament])), value, 'name');
}

// what a tracked tournament posts, on one line
function postsText(tournament) {
  return Object.entries(POSTS).map(([name, label]) => `**${label}:** ${tournament.tracked[name] === false ? 'off' : 'on'}`).join(' · ');
}

// every set and stream alert goes in its thread, so say when that can't happen yet
function threadWarning(interaction) {
  const channelId = process.env.CHANNEL_ID;
  const postChannel = interaction.client?.channels?.cache?.get(channelId);
  if (!postChannel) return null;
  const missing = missingThreadPermissions(postChannel);
  if (!missing) return `Threads can't be started in <#${channelId}>, so its sets and stream alerts post there instead.`;
  if (missing.length) return `I need ${missing.join(' and ')} in <#${channelId}> to start its thread. Until then its sets and stream alerts post there instead.`;
  return null;
}

// tracks a tournament from getRegistration by hand for /tournament add, and says what that set up. one
// already tracked keeps its switches and reminder schedule
function trackLines(interaction, found, reminders, now = secondsNow()) {
  const name = escapeMarkdown(found.name);
  if (state.tournaments[found.id]?.tracked) return [`Already tracking ${name}.`];

  const { id, slug, startAt, endAt, city, addrState, isOnline } = found;
  const images = (found.images ?? []).filter((image) => image.type === 'profile').map(({ url }) => ({ url }));
  const tournament = state.tournaments[id] ??= { id, name: found.name, slug, startAt, endAt, city, addrState, isOnline, images, entries: [], userIds: [] };
  trackTournament(tournament, 'manual', now);
  tournament.tracked.reminders = reminders;
  // tracking it by hand again lets a reg admin's be found again later
  state.regSkipped = state.regSkipped.filter((each) => String(each) !== String(id));

  const lines = [`Tracking ${name}. Every set and stream alert from it posts in its own thread, and each event's top 8 once the bracket is finished.`];
  const deadline = regDeadline(found);
  const next = nextRegReminder(deadline);
  const firstAt = deadline - REG_REMINDER_HOURS[next] * HOUR;
  // further out it might just not be open yet
  const open = deadline > now && (firstAt > now || found.isRegistrationOpen);
  if (open) tournament.reminder = { deadline, next };
  if (!reminders) lines.push('No reg reminders.');
  else if (!open) lines.push('Registration is closed, so no reg reminders.');
  else if (firstAt <= now) lines.push(`Registration ends <t:${deadline}:R>, sending the last call now.`);
  else {
    const when = new Intl.ListFormat('en').format(REG_REMINDER_HOURS.slice(next).map(inWords));
    lines.push(`Everyone with \`/notify registration\` on gets pinged ${when} before registration ends, starting <t:${firstAt}:R>.`);
  }
  const warning = threadWarning(interaction);
  if (warning) lines.push(warning);
  lines.push('-# `/tournament posts` turns any of it off');
  return lines;
}

async function tournamentAdd(interaction) {
  const input = interaction.options.getString('tournament', true).trim();
  const reminders = interaction.options.getString('reminders') !== 'off';
  const addEvent = interaction.options.getString('add_event') === 'on';

  await interaction.deferReply();
  const found = await startgg.getRegistration(tournamentSlug(input));
  if (!found) return interaction.editReply(tournamentNotFound(input));
  const name = escapeMarkdown(found.name);
  const now = secondsNow();
  if (now > endTime(found) + RUNS_LATE_HOURS * HOUR) return interaction.editReply({ content: `${name} is already over.`, allowedMentions: { parse: [] } });
  // with add_event it still makes the event
  if (state.tournaments[found.id]?.tracked && !addEvent) {
    return interaction.editReply({ content: `${name} is already tracked. \`/tournament posts\` changes what it posts.`, allowedMentions: { parse: [] } });
  }

  const lines = trackLines(interaction, found, reminders, now);
  if (addEvent) lines.push(...await eventLines(interaction, found));
  save();
  await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });

  // its events and crew, and a last call that's due now
  checkTournaments();
  checkRegReminders();
}

// asks first, then has an Undo button for a minute. it stays saved while tracked players are in it, or until its
// placements are over, so the thread card still gets unpinned. a reg admin's stays untracked
function tournamentRemove(interaction) {
  const tournament = trackedPick(interaction);
  if (!tournament) return replyEphemeral(interaction, 'That tournament isn\'t tracked. `/track list` shows the ones that are.');
  const again = tournament.tracked.by === 'admin' ? ' It came from a tournament admin, so it won\'t get tracked again on its own.' : '';
  return askFirst(interaction, 'untrack_tournament', tournament.id, `Stop tracking ${escapeMarkdown(tournament.name)}? Its sets, stream alerts, top 8s and reg reminders stop.${again}`, 'Stop tracking');
}

confirmable('untrack_tournament', {
  command: '/tournament remove',
  run: (id) => {
    const tournament = state.tournaments[id];
    if (!tournament?.tracked) return { content: 'It isn\'t tracked anymore.' };
    const kept = { id: tournament.id, tracked: tournament.tracked, reminder: tournament.reminder, crew: tournament.crew };
    delete tournament.tracked;
    delete tournament.reminder;
    delete tournament.crew;
    state.regSkipped = [...state.regSkipped.filter((each) => String(each) !== String(tournament.id)), tournament.id].slice(-200);
    save();
    return { content: `Stopped tracking ${escapeMarkdown(tournament.name)}.`, undo: kept };
  },
  cancel: (id) => (state.tournaments[id]?.tracked ? `Still tracking ${escapeMarkdown(state.tournaments[id].name)}.` : 'It isn\'t tracked anymore.'),
  undo: (kept) => {
    const tournament = state.tournaments[kept.id];
    // its placements went out and it got cleared in the minute since, which the next check would redo anyway
    if (!tournament) return 'Too late to undo, it\'s over. `/tournament add` it again.';
    if (tournament.tracked) return `${escapeMarkdown(tournament.name)} is already tracked again.`;
    Object.assign(tournament, { tracked: kept.tracked, reminder: kept.reminder, crew: kept.crew });
    state.regSkipped = state.regSkipped.filter((each) => String(each) !== String(kept.id));
    save();
    return `Tracking ${escapeMarkdown(tournament.name)} again, with the same settings as before.`;
  },
  tooLate: 'Too late to undo. `/tournament add` it again.',
});

// with no switches it says what's on. sets turned back on start from now, the way a newly tracked tournament does,
// and reminders turned back on start from the next one still to come, so nothing missed goes out late
function tournamentPosts(interaction) {
  const tournament = trackedPick(interaction);
  if (!tournament) return replyEphemeral(interaction, 'That tournament isn\'t tracked. `/tournament add` it first.');
  const changes = {};
  for (const name of Object.keys(POSTS)) {
    const value = interaction.options.getString(name);
    if (value) changes[name] = value === 'on';
  }
  const name = escapeMarkdown(tournament.name);
  const by = tournament.tracked.by === 'admin' ? 'Tracked for a tournament admin' : 'Tracked by hand';
  if (!Object.keys(changes).length) return replyEphemeral(interaction, `**${name}**\n${postsText(tournament)}\n-# ${by}`);

  const { tracked } = tournament;
  if (changes.sets && tracked.sets === false) tournament.lastCheck = secondsNow();
  if (changes.reminders && tracked.reminders === false) {
    tournament.reminder ??= {};
    delete tournament.reminder.next;
  }
  Object.assign(tracked, changes);
  save();
  return interaction.reply({ content: `**${name}**\n${postsText(tournament)}`, allowedMentions: { parse: [] } });
}

async function adminAdd(interaction) {
  const input = interaction.options.getString('profile', true);

  await interaction.deferReply();
  const admin = await findPlayer(interaction, input);
  if (!admin) return;
  if (state.regAdmins[admin.userId]) {
    return interaction.editReply({ content: `${escapeMarkdown(admin.tag)} is already a tournament admin.`, allowedMentions: { parse: [] } });
  }

  state.regAdmins[admin.userId] = { userId: admin.userId, slug: admin.slug, tag: admin.tag };
  save();
  await interaction.editReply({
    content: `Upcoming tournaments ${escapeMarkdown(admin.tag)} is an admin of on start.gg get tracked now, with every set, stream alerts, top 8s and reg reminders. \`/tournament posts\` turns parts off for one, \`/tournament remove\` stops one.`,
    allowedMentions: { parse: [] },
  });
  // don't wait 15 min for theirs to show up
  checkTournaments();
}

function adminRemove(interaction) {
  const admin = lookup(state.regAdmins, interaction.options.getString('admin', true).toLowerCase(), 'tag');
  if (!admin) return replyEphemeral(interaction, 'That\'s not a tournament admin. See `/tournament admin list`.');

  delete state.regAdmins[admin.userId];
  save();
  return interaction.reply({
    content: `${escapeMarkdown(admin.tag)}'s new tournaments won't get tracked on their own. Ones already tracked stay, \`/tournament remove\` stops them.`,
    allowedMentions: { parse: [] },
  });
}

function adminList(interaction) {
  return interaction.reply({ embeds: embeds.withImage([embeds.regAdmins(state.regAdmins)]), allowedMentions: { parse: [] } });
}

const EVENT_NOT_ALLOWED = 'Only tournament admins and people with Manage Server can make Discord events. `/tournament admin list` shows the admins.';

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

// paste a start.gg link, get a discord event. it doesn't track the tournament, /tournament add does that.
// its own command because discord hides /tournament from anyone without Manage Server, and tournament
// admins are start.gg accounts, not a discord role
async function discordEvent(interaction) {
  const input = interaction.options.getString('tournament', true).trim();
  const manager = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
  // with no admins there's nobody to check for, so no start.gg request
  if (!manager && !Object.keys(state.regAdmins).length) return replyEphemeral(interaction, EVENT_NOT_ALLOWED);

  await interaction.deferReply();
  if (!manager && !(await isRegAdmin(interaction.user.id))) return replyEphemeralAfterDefer(interaction, EVENT_NOT_ALLOWED);
  const found = await startgg.getRegistration(tournamentSlug(input));
  if (!found) return interaction.editReply(tournamentNotFound(input));
  const lines = await eventLines(interaction, found);
  // the event id, when the tournament is one the bot already has
  save();
  await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

export { tournamentAdd, tournamentRemove, tournamentPosts, discordEvent, adminAdd, adminRemove, adminList };
