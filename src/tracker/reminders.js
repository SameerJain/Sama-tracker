import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { t } from '../i18n.js';
import { state, save } from '../store.js';
import { REG_ROLE, messageEnabled } from '../message-settings.js';
import { rememberAccounts, serverMembers } from '../accounts.js';
import {
  currentChannel, secondsNow, sendPinging, posting, named, regDeadline, reminderSchedule, nextRegReminder, mentionable, HOUR, DM_HOURS_BEFORE,
  DM_LOOKAHEAD_HOURS,
} from './shared.js';

// the Reg Reminders role in this server, by name since /notify looks it up that way. null when
// the channel has no guild, like in tests
function regRole(postChannel) {
  return postChannel?.guild?.roles.cache.find((role) => role.name === REG_ROLE) ?? null;
}

// reminders for tracked tournaments with reminders on, pinging the Reg Reminders role. everyone
// with it gets pinged, even when start.gg already has them registered. reg DMs still skip them
export async function postRegReminders(postChannel = currentChannel()) {
  for (const tournament of Object.values(state.tournaments)) {
    const { reminder } = tournament;
    if (!posting(tournament, 'reminders') || !reminder) continue;
    const schedule = reminderSchedule(tournament);
    // past the last call, or started, means none are left
    if (reminder.next >= schedule.length || secondsNow() > tournament.startAt) continue;
    try {
      // TOs move the close time, so always go off the latest. a deleted one is the tournament check's to drop
      const latest = await startgg.getRegistration(tournament.slug);
      if (!latest) continue;
      const deadline = regDeadline(latest);
      reminder.deadline = deadline;
      // registration wasn't open yet when it was tracked, or reminders just turned back on
      reminder.next ??= nextRegReminder(deadline, schedule);
      // it closed, maybe while the bot was down
      if (deadline <= secondsNow()) continue;

      // only the latest one if the bot was down through a few
      const due = schedule.findLastIndex((hours, i) => i >= reminder.next && secondsNow() >= deadline - hours * HOUR);
      if (due === -1) continue;
      const lastCall = due === schedule.length - 1;

      // not open means it filled up, or for the early ones that it hasn't opened yet
      const dueAt = deadline - schedule[due] * HOUR;
      if (latest.isRegistrationOpen && messageEnabled('registration', dueAt)) {
        // still remembered for /profile, but the ping goes to the role so registered members get it too
        const participants = await startgg.getParticipants(latest.id);
        rememberAccounts(participants);
        const text = lastCall ? t('last call') : t('registration reminder');
        const card = embeds.regReminder(latest, deadline, lastCall);
        const role = regRole(postChannel);
        if (role && state.regPings.length) {
          await postChannel.send({ content: `<@&${role.id}> ${text}`, embeds: embeds.withImage([card]), allowedMentions: { roles: [role.id] } });
        } else if (!role) {
          const registered = new Set(participants.map((participant) => participant.discordId));
          const ping = state.regPings.filter((id) => !registered.has(id));
          await sendPinging(postChannel, 'registration', ping, text, card);
        } else {
          await postChannel.send({ embeds: embeds.withImage([card]), allowedMentions: { parse: [] } });
        }
      }
      reminder.next = due + 1;
      // saved per tournament so a crash can't ping it again
      save();
    } catch (err) {
      console.error(`reg reminder for ${named(tournament)} failed:`, err.message);
    }
  }
  save();
}

// 1-hour DMs for tracked tournaments with reminders on, to whoever turned them on with /notify, and nothing else
// decides. reg DMs skip anyone registered. when registration closes within an hour of the start there's one DM,
// the start one, since it carries the register link too. each goes once per close time and start time, so a
// TO moving one sends it again for the new time
export async function postDmReminders(postChannel = currentChannel()) {
  const client = postChannel?.client;
  // DMs only go to members of the posts channel's server, so with no server to check against nobody gets one
  const guild = postChannel?.guild;
  if (!client || !guild || (!state.regDmPings.length && !state.startDmPings.length)) return;

  for (const tournament of Object.values(state.tournaments)) {
    if (!posting(tournament, 'reminders') || !dmSoon(tournament)) continue;
    let latest;
    try {
      // TOs move the close time and the start, so the DM goes off the latest
      latest = await startgg.getRegistration(tournament.slug);
      if (!latest) continue;
    } catch (err) {
      console.error(`DM reminders for ${named(tournament)} failed:`, err.message);
      continue;
    }
    const deadline = regDeadline(latest);
    const { startAt } = latest;
    // saved for dmSoon, since the reg reminders stop saving it after their last call
    if (tournament.reminder) tournament.reminder.deadline = deadline;

    try {
      // registration closes more than an hour before the start, so the start DM can't cover it
      const separate = deadline < startAt - DM_HOURS_BEFORE * HOUR;
      if (state.regDmPings.length && separate && tournament.dmRegSentFor !== deadline && dmDue(deadline)) {
        let to = [];
        // not open means it filled up
        if (latest.isRegistrationOpen) {
          const participants = await startgg.getParticipants(latest.id);
          rememberAccounts(participants);
          const registered = new Set(participants.map((participant) => participant.discordId));
          to = await stillInServer(guild, state.regDmPings.filter((id) => !registered.has(id)));
        }
        // marked once the lookups worked and before anything goes out, so a failure tries again next check
        // and nobody gets it twice
        tournament.dmRegSentFor = deadline;
        const embed = embeds.regReminder(latest, deadline, true);
        for (const discordId of to) await dmUser(client, discordId, embed);
      }
    } catch (err) {
      console.error(`registration DMs for ${named(tournament)} failed:`, err.message);
    }

    try {
      if (state.startDmPings.length && tournament.dmStartSentFor !== startAt && dmDue(startAt)) {
        const to = await stillInServer(guild, state.startDmPings);
        tournament.dmStartSentFor = startAt;
        const embed = embeds.startReminder(latest);
        for (const discordId of to) await dmUser(client, discordId, embed);
      }
    } catch (err) {
      console.error(`start DMs for ${named(tournament)} failed:`, err.message);
    }
  }
  save();
}

// within the hour before this time
function dmDue(at, now = secondsNow()) {
  return now >= at - DM_HOURS_BEFORE * HOUR && now < at;
}

// whether a DM not sent yet comes due soon, by the saved start and the close time the reg reminders saved.
// the tournament check refreshes the start every 15 minutes in its last day
function dmSoon(tournament, now = secondsNow()) {
  const { startAt } = tournament;
  const deadline = Math.min(tournament.reminder?.deadline ?? startAt, startAt);
  const pending = [];
  if (state.regDmPings.length && tournament.dmRegSentFor !== deadline) pending.push(deadline);
  if (state.startDmPings.length && tournament.dmStartSentFor !== startAt) pending.push(startAt);
  return pending.some((at) => at > now && at - now <= (DM_HOURS_BEFORE + DM_LOOKAHEAD_HOURS) * HOUR);
}

// the ones of these discord ids in the server right now. it's asked right before the DMs go out, since a start.gg
// lookup can take long enough for someone to leave. leavers keep their /notify switches for if they rejoin.
// throws when discord can't say, so the caller sends nothing
async function stillInServer(guild, ids) {
  const wanted = ids.filter(mentionable);
  if (!wanted.length) return [];
  const members = await serverMembers(guild, [...new Set(wanted)]);
  return wanted.filter((id) => members.has(id));
}

// one DM, skipped when DMs are closed or the user left. failures stay in the logs, the rest still go out
async function dmUser(client, discordId, embed) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send({ embeds: embeds.withImage([embed]) });
  } catch (err) {
    console.error(`DM to ${discordId} failed:`, err.message);
  }
}
