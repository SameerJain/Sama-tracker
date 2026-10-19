import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import { startggUrl } from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { findAccount, verifiedCaller } from '../accounts.js';
import {
  REG_REMINDER_HOURS, RUNS_LATE_HOURS, checkRegReminders, checkTournaments, endTime, missingThreadPermissions, nextRegReminder, regDeadline,
  secondsNow, trackTournament,
} from '../tracker.js';
import { findPlayer, lookup, replyEphemeral } from './shared.js';
import { askFirst, confirmable } from './confirm.js';
import { tournamentNotFound, tournamentSlug } from './registration.js';

const HOUR = 60 * 60;

// /tournament posts switches, named the way the replies list them
const POSTS = { sets: 'Every set', stream: 'Stream alerts', top8: 'Top 8s', reminders: 'Reg reminders' };

// discord hides /tournament from anyone without Manage Server unless a server hands it to a role, and this
// covers a server that changed that by mistake
const allowed = (interaction) => Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
const NOT_ALLOWED = 'You need Manage Server permission to change tracked tournaments.';

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

// a found tournament tracked by hand, the same from /tournament add and /tournament event.
// already tracked ones keep their switches
function ensureTracked(found, { reminders }, now = secondsNow()) {
  const { id, slug, startAt, endAt, city, addrState, isOnline } = found;
  const images = (found.images ?? []).filter((image) => image.type === 'profile').map(({ url }) => ({ url }));
  const tournament = state.tournaments[id] ??= { id, name: found.name, slug, startAt, endAt, city, addrState, isOnline, images, entries: [], userIds: [] };
  const isNew = !tournament.tracked;
  if (isNew) {
    trackTournament(tournament, 'manual', now);
    tournament.tracked.reminders = reminders;
    // tracking it by hand again lets a reg admin's be found again later
    state.regSkipped = state.regSkipped.filter((each) => String(each) !== String(id));
  }
  return { tournament, isNew };
}

// registry lines about reg reminders, shared by both paths that track. only newly
// tracked ones get here, so already tracked ones keep their schedule
function reminderLines(found, tournament, reminders, now = secondsNow()) {
  const deadline = regDeadline(found);
  const next = nextRegReminder(deadline);
  const firstAt = deadline - REG_REMINDER_HOURS[next] * HOUR;
  // further out it might just not be open yet
  const open = deadline > now && (firstAt > now || found.isRegistrationOpen);
  if (open) tournament.reminder = { deadline, next };
  if (!reminders) return ['No reg reminders.'];
  if (!open) return ['Registration is closed, so no reg reminders.'];
  if (firstAt <= now) return [`Registration ends <t:${deadline}:R>, sending the last call now.`];
  const when = new Intl.ListFormat('en').format(REG_REMINDER_HOURS.slice(next).map(inWords));
  return [`Everyone with \`/notify registration\` on gets pinged ${when} before registration ends, starting <t:${firstAt}:R>.`];
}

async function tournamentAdd(interaction) {
  if (!allowed(interaction)) return replyEphemeral(interaction, NOT_ALLOWED);
  const input = interaction.options.getString('tournament', true).trim();
  const reminders = interaction.options.getString('reminders') !== 'off';
  const addEvent = interaction.options.getString('add_event') === 'on';

  await interaction.deferReply();
  const found = await startgg.getRegistration(tournamentSlug(input));
  if (!found) return interaction.editReply(tournamentNotFound(input));
  const name = escapeMarkdown(found.name);
  const now = secondsNow();
  if (now > endTime(found) + RUNS_LATE_HOURS * HOUR) return interaction.editReply({ content: `${name} is already over.`, allowedMentions: { parse: [] } });

  const lines = [];
  if (state.tournaments[found.id]?.tracked) {
    if (!addEvent) {
      return interaction.editReply({ content: `${name} is already tracked. \`/tournament posts\` changes what it posts.`, allowedMentions: { parse: [] } });
    }
    lines.push(`Already tracking ${name}.`);
  } else {
    const { tournament } = ensureTracked(found, { reminders }, now);
    lines.push(`Tracking ${name}. Every set and stream alert from it posts in its own thread, and each event's top 8 once the bracket is finished.`);
    lines.push(...reminderLines(found, tournament, reminders, now));
    const warning = threadWarning(interaction);
    if (warning) lines.push(warning);
    lines.push('-# `/tournament posts` turns any of it off');
  }
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
  if (!allowed(interaction)) return replyEphemeral(interaction, NOT_ALLOWED);
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
  if (!allowed(interaction)) return replyEphemeral(interaction, NOT_ALLOWED);
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
  if (!allowed(interaction)) return replyEphemeral(interaction, NOT_ALLOWED);
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
  if (!allowed(interaction)) return replyEphemeral(interaction, NOT_ALLOWED);
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
  return interaction.reply({ embeds: embeds.withImage([embeds.regAdmins(state.regAdmins)]) });
}

// whoever ran this, as a start.gg user id in the admin list: their /link or tracked account with discord
// still connected, or any account the bot has seen for their discord. managers skip the check
async function eventCaller(interaction) {
  const caller = await verifiedCaller(interaction.user.id).catch(() => null);
  if (caller && state.regAdmins[caller.userId]) return caller;
  const found = await findAccount(interaction.user.id).catch(() => null);
  return found && state.regAdmins[found.userId] ? found : null;
}

async function allowedEvent(interaction) {
  if (allowed(interaction)) return true;
  return Boolean(await eventCaller(interaction));
}

const EVENT_NOT_ALLOWED = 'Only tournament admins and Manage Server can make Discord events. `/tournament admin list` shows the admins.';

// discord external events need a location and an end time. a missing end becomes a 6 hour local
function eventLocation(tournament) {
  if (tournament.isOnline) return 'Online';
  return ([tournament.city, tournament.addrState].filter(Boolean).join(', ') || 'See the start.gg link').slice(0, 100);
}

function eventDescription(tournament) {
  const lines = [`${tournament.name} on start.gg`, startggUrl(tournament.slug), eventLocation(tournament)];
  if (tournament.registrationClosesAt) lines.push(`Registration closes <t:${tournament.registrationClosesAt}:F>`);
  const names = (tournament.events ?? []).map((event) => event.name).filter(Boolean).slice(0, 10);
  if (names.length) lines.push(`Events: ${names.join(', ')}`);
  return lines.join('\n').slice(0, 1000);
}

// one line about the discord event, made or found. errors go in the reply the same way
async function eventLines(interaction, found) {
  const name = escapeMarkdown(found.name);
  if (!found.startAt) return [`${name} has no start time on start.gg, so Discord can't schedule it.`];
  if (found.startAt <= secondsNow()) {
    return [`${name} already started <t:${found.startAt}:R>. Discord events have to start in the future.`];
  }
  const result = await ensureDiscordEvent(found, interaction.guild);
  if (result.error) return [result.error];
  return result.isNew
    ? [`Made a Discord event for ${name} on <t:${found.startAt}:F>: ${result.url}`]
    : [`${name} already has a Discord event: ${result.url}`];
}

// the discord event for a tournament, made or found. the saved id goes first, then the slug in
// its description, so either path lands on the same one instead of doubling
async function ensureDiscordEvent(found, guild) {
  if (!guild?.scheduledEvents?.create) return { error: `Couldn't make a Discord event here.` };
  const me = guild.members?.me;
  if (me?.permissions?.has && !me.permissions.has(PermissionFlagsBits.ManageEvents) && !me.permissions.has(PermissionFlagsBits.CreateEvents)) {
    return { error: 'I need Manage Events permission to make Discord events.' };
  }

  const savedId = state.tournaments[found.id]?.discordEventId;
  try {
    const existing = await guild.scheduledEvents.fetch().catch(() => null);
    const all = [...(existing?.values?.() ?? [])];
    const dup = (savedId && all.find((each) => String(each.id) === String(savedId)))
      ?? all.find((each) => each.description?.includes(found.slug));
    if (dup) return { url: dup.url ?? `https://discord.com/events/${guild.id ?? ''}/${dup.id}`, isNew: false };
  } catch (err) {
    console.error(`checking discord events for ${found.name ?? found.id} failed:`, err.message);
  }

  let created;
  try {
    created = await guild.scheduledEvents.create({
      name: found.name.slice(0, 100),
      scheduledStartTime: new Date(found.startAt * 1000),
      scheduledEndTime: new Date((found.endAt > found.startAt ? found.endAt : found.startAt + 6 * HOUR) * 1000),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      description: eventDescription(found),
      entityMetadata: { location: eventLocation(found) },
    });
  } catch (err) {
    if (err.code === 50013) return { error: 'I need Manage Events permission to make Discord events.' };
    throw err;
  }
  const tournament = state.tournaments[found.id];
  if (tournament) tournament.discordEventId = created.id;
  return { url: created.url ?? `https://discord.com/events/${guild.id ?? ''}/${created.id}`, isNew: true };
}

// paste a start.gg link, get a discord scheduled event and a tracked tournament, the same
// one /tournament add tracks. one already tracked keeps its settings
async function tournamentEvent(interaction) {
  const input = interaction.options.getString('tournament', true).trim();

  await interaction.deferReply();
  if (!(await allowedEvent(interaction))) return interaction.editReply({ content: EVENT_NOT_ALLOWED, allowedMentions: { parse: [] } });
  const found = await startgg.getRegistration(tournamentSlug(input));
  if (!found) return interaction.editReply(tournamentNotFound(input));
  const name = escapeMarkdown(found.name);
  const now = secondsNow();
  // without a start nothing else can be scheduled or timed, so this stays out entirely
  if (!found.startAt) return interaction.editReply({ content: `${name} has no start time on start.gg, so Discord can't schedule it.`, allowedMentions: { parse: [] } });
  if (now > endTime(found) + RUNS_LATE_HOURS * HOUR) return interaction.editReply({ content: `${name} is already over.`, allowedMentions: { parse: [] } });

  const lines = [];
  if (state.tournaments[found.id]?.tracked) {
    lines.push(`Already tracking ${name}.`);
  } else {
    const { tournament } = ensureTracked(found, { reminders: true }, now);
    lines.push(`Tracking ${name}. Every set and stream alert from it posts in its own thread, and each event's top 8 once the bracket is finished.`);
    lines.push(...reminderLines(found, tournament, true, now));
    const warning = threadWarning(interaction);
    if (warning) lines.push(warning);
    lines.push('-# `/tournament posts` turns any of it off');
  }
  lines.push(...await eventLines(interaction, found));
  save();
  await interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });

  // its events and crew, and a last call that's due now
  checkTournaments();
  checkRegReminders();
}

export { tournamentAdd, tournamentRemove, tournamentPosts, tournamentEvent, adminAdd, adminRemove, adminList };
