import { MessageFlags, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { REG_REMINDER_HOURS, RUNS_LATE_HOURS, checkRegReminders, checkTournaments, endTime, nextRegReminder, regDeadline, secondsNow } from '../tracker.js';
import { rememberAccounts } from '../accounts.js';
import { findPlayer, lookup, replyEphemeral, sendEmbeds, flag } from './shared.js';

// /bracket shows a tournament this long before it starts
const BRACKET_MINUTES_BEFORE = 30;

// discord takes this many ids a request when checking who's in the server
const MEMBERS_PER_FETCH = 100;

// shows who has reg pings on
const REG_ROLE = 'Reg Reminders';

// start.gg/tournament/genesis-x/details, a short link like start.gg/genesis, or just the slug
function tournamentSlug(input) {
  const path = input.replace(/^(https?:\/\/)?(www\.)?(start|smash)\.gg\//, '');
  return path.match(/tournament\/([\w-]+)/)?.[1] ?? path.split(/[/?#]/)[0];
}

function tournamentNotFound(input) {
  return `Couldn't find a start.gg tournament for \`${input}\`. Paste its link, like start.gg/tournament/genesis-x.`;
}

async function setRegReminder(interaction) {
  const input = interaction.options.getString('tournament', true).trim();

  await interaction.deferReply();
  const tournament = await startgg.getRegistration(tournamentSlug(input));
  if (!tournament) return interaction.editReply(tournamentNotFound(input));

  if (state.regReminders[tournament.id]) {
    return interaction.editReply(`${tournament.name} already has reminders set. \`/delete_reg_reminder\` cancels them.`);
  }

  const deadline = regDeadline(tournament);
  const next = nextRegReminder(deadline);
  const firstAt = deadline - REG_REMINDER_HOURS[next] * 60 * 60;
  // further out it might just not be open yet
  if (deadline <= secondsNow() || (firstAt <= secondsNow() && !tournament.isRegistrationOpen)) {
    return interaction.editReply(`Registration for ${tournament.name} is closed.`);
  }

  state.regReminders[tournament.id] = { id: tournament.id, slug: tournament.slug, name: tournament.name, deadline, next };
  save();
  // inside the last call window it goes out now
  checkRegReminders();

  // everyone registered gets tracked too, so their sets post like anyone else's
  let added = 0;
  try {
    const adding = (await startgg.getAttendees(tournament.id))
      .filter((attendee) => attendee.userId && attendee.playerId && !state.players[attendee.userId]);
    for (const player of adding) {
      state.players[player.userId] = { ...player, lastCheck: secondsNow(), streamAlerts: true, setResults: true };
    }
    if (adding.length) {
      save();
      // don't wait 15 min for their tournaments to show up
      checkTournaments();
    }
    added = adding.length;
  } catch (err) {
    // the reminder is already saved, tracking just missed this one
    console.error(`tracking registrants for ${tournament.name} failed:`, err.message);
  }
  const tracked = added === 1
    ? ` 1 player from ${tournament.name} is now tracked.`
    : added ? ` ${added} players from ${tournament.name} are now tracked.` : '';

  if (firstAt <= secondsNow()) {
    return interaction.editReply(`Registration for ${tournament.name} ends <t:${deadline}:R>, sending the last call now.${tracked}`);
  }
  const duration = (hours) => (hours % 24 ? `${hours} hours` : `${hours / 24} day${hours === 24 ? '' : 's'}`);
  const when = new Intl.ListFormat('en').format(REG_REMINDER_HOURS.slice(next).map(duration));
  return interaction.editReply(`Everyone with reg pings on gets pinged ${when} before registration for ${tournament.name} ends, starting <t:${firstAt}:R>. \`/reg_role\` to turn yours on.${tracked}`);
}

function deleteRegReminder(interaction) {
  const value = interaction.options.getString('tournament', true).toLowerCase();
  const reminder = lookup(state.regReminders, value, 'name');
  if (!reminder) return replyEphemeral(interaction, 'No reminder set for that.');

  delete state.regReminders[reminder.id];
  // so a reg admin's doesn't get added back
  state.regSkipped = [...state.regSkipped, reminder.id].slice(-200);
  save();
  return interaction.reply(`Deleted the reminder for ${reminder.name}.`);
}

async function regAdminAdd(interaction) {
  const input = interaction.options.getString('profile', true);

  await interaction.deferReply();
  const admin = await findPlayer(interaction, input);
  if (!admin) return;
  if (state.regAdmins[admin.userId]) {
    return interaction.editReply(`${admin.tag} is already a reg admin.`);
  }

  state.regAdmins[admin.userId] = { userId: admin.userId, slug: admin.slug, tag: admin.tag };
  save();
  await interaction.editReply(`Tournaments ${admin.tag} is an admin of on start.gg get reg reminders now. \`/delete_reg_reminder\` skips one.`);

  // don't wait 15 min for theirs to show up
  checkRegReminders();
}

function regAdminRemove(interaction) {
  const admin = lookup(state.regAdmins, interaction.options.getString('admin', true).toLowerCase(), 'tag');
  if (!admin) return replyEphemeral(interaction, 'That\'s not a reg admin. See `/reg_admin list`.');

  delete state.regAdmins[admin.userId];
  save();
  return interaction.reply(`No more automatic reminders for ${admin.tag}'s tournaments. Ones already set stay, \`/delete_reg_reminder\` cancels them.`);
}

// reg reminder tournaments only, they're the ones the server cares about
function bracket(interaction) {
  const now = secondsNow();
  const live = Object.values(state.regReminders)
    .filter((reminder) => now >= reminder.startAt - BRACKET_MINUTES_BEFORE * 60 && now <= endTime(reminder) + RUNS_LATE_HOURS * 60 * 60)
    .sort((a, b) => a.startAt - b.startAt);
  if (!live.length) {
    return interaction.reply('No tournaments set as active. Check the other channels if you\'re expecting one.');
  }
  return sendEmbeds(interaction, live.flatMap((reminder) => embeds.bracket(reminder)));
}

// only ever changes the person who ran it. pings go off this list, not the role,
// so people already registered can be left out
async function regRole(interaction) {
  const on = interaction.options.getString('ping', true) === 'on';
  const { guild, member, user } = interaction;

  state.regPings = state.regPings.filter((id) => id !== user.id);
  if (on) state.regPings.push(user.id);
  save();

  let content = on
    ? 'You\'ll get pinged for reg reminders. If your Discord is connected on start.gg, not for ones you\'re already registered for.'
    : 'No more reg reminder pings.';
  // making the role or handing it out can take discord past the 3 seconds a command gets to answer
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    let role = guild.roles.cache.find((each) => each.name === REG_ROLE);
    if (on) {
      role ??= await guild.roles.create({ name: REG_ROLE, reason: 'shows who has /reg_role on' });
      await member.roles.add(role);
    } else if (role) {
      await member.roles.remove(role);
    }
  } catch (err) {
    // missing permissions. the pings still work without the role
    if (err.code !== 50013) throw err;
    content += ` I couldn't change your ${REG_ROLE} role though, that needs Manage Roles and my role above it.`;
  }
  return interaction.editReply(content);
}

// the ones of these discord ids that are in the server, id to member. asking by id doesn't need
// the server members intent. discord can say to slow down, then it gets one more try after waiting
async function serverMembers(guild, ids) {
  const found = new Map();
  for (let i = 0; i < ids.length; i += MEMBERS_PER_FETCH) {
    const user = ids.slice(i, i + MEMBERS_PER_FETCH);
    const members = await guild.members.fetch({ user }).catch(async (err) => {
      if (!err.data?.retry_after) throw err;
      await new Promise((resolve) => setTimeout(resolve, err.data.retry_after * 1000));
      return guild.members.fetch({ user });
    });
    for (const [id, member] of members) found.set(id, member);
  }
  return found;
}

// like /upcoming for one tournament, but anyone in the server instead of the tracked list
async function registered(interaction) {
  const input = interaction.options.getString('tournament', true).trim();

  await interaction.deferReply();
  const found = await startgg.getRegistration(tournamentSlug(input));
  if (!found) return interaction.editReply(tournamentNotFound(input));

  const participants = await startgg.getParticipants(found.id);
  rememberAccounts(participants);
  if (startgg.attendeesHidden(found, participants)) {
    return interaction.editReply(`start.gg hides who's registered for ${escapeMarkdown(found.name)}, so there's no list to show.`);
  }
  const linked = participants.filter((participant) => participant.discordId);
  const members = await serverMembers(interaction.guild, [...new Set(linked.map((participant) => participant.discordId))]);
  // their name in this server goes on the card instead of a mention
  const here = linked
    .filter((participant) => members.has(participant.discordId))
    .map((participant) => ({ ...participant, name: members.get(participant.discordId).displayName }));
  // for the events each of them is in
  const tournament = await startgg.getTournament(found.id, here.map((participant) => participant.userId));
  const byEvent = flag(interaction, 'by_event');
  return sendEmbeds(interaction, embeds.registered(tournament ?? found, here, { byEvent }));
}

// goes by the discord connected on start.gg, and only pings when they're not registered
async function regWarn(interaction) {
  const input = interaction.options.getString('tournament', true).trim();
  const user = interaction.options.getUser('user', true);
  if (user.bot) return replyEphemeral(interaction, 'Bots don\'t need to register.');

  await interaction.deferReply();
  const tournament = await startgg.getRegistration(tournamentSlug(input));
  if (!tournament) return interaction.editReply(tournamentNotFound(input));

  const participants = await startgg.getParticipants(tournament.id);
  rememberAccounts(participants);
  if (participants.some((participant) => participant.discordId === user.id)) {
    const name = interaction.options.getMember('user')?.displayName ?? user.displayName;
    return interaction.editReply(`Already registered.\n-# ${escapeMarkdown(name)} · ${escapeMarkdown(tournament.name)}`);
  }
  const deadline = regDeadline(tournament);
  if (deadline <= secondsNow()) return interaction.editReply(`Registration for ${tournament.name} already closed.`);
  if (!tournament.isRegistrationOpen) return interaction.editReply(`Registration for ${tournament.name} isn't open right now.`);
  // not on a hidden list means nothing, so no warning
  if (startgg.attendeesHidden(tournament, participants)) {
    return interaction.editReply(`start.gg hides who's registered for ${escapeMarkdown(tournament.name)}, so there's no telling if they are. No warning sent.`);
  }

  // editing the reply wouldn't ping them, and a follow-up shows "Original message was deleted"
  // once the thinking reply is gone, so the warning goes in the channel as its own message
  const warning = {
    content: `<@${user.id}>`,
    embeds: [embeds.regWarning(tournament, deadline)],
    allowedMentions: { users: [user.id] },
  };
  const sent = await interaction.channel?.send(warning).catch(() => null);
  await interaction.deleteReply();
  // can't post in that channel, a follow-up still pings them
  if (!sent) return interaction.followUp(warning);
}

export { setRegReminder, deleteRegReminder, regAdminAdd, regAdminRemove, bracket, regRole, registered, regWarn };
