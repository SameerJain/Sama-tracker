import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { REG_ROLE, messageEnabled } from '../message-settings.js';
import { rememberAccounts, serverMembers } from '../accounts.js';
import { channel, secondsNow, sendPinging, posting, regDeadline, reminderSchedule, nextRegReminder, mentionable, HOUR, DM_HOURS_BEFORE, DM_LOOKAHEAD_HOURS } from './shared.js';

// the Reg Reminders role in this server, by name since /notify looks it up that way. null when
// the channel has no guild, like in tests
function regRole(postChannel) {
  try {
    const cache = postChannel?.guild?.roles?.cache;
    if (!cache) return null;
    if (typeof cache.find === 'function') return cache.find((each) => each?.name === REG_ROLE) ?? null;
    for (const each of cache.values()) if (each?.name === REG_ROLE) return each;
    return null;
  } catch {
    return null;
  }
}

// reminders for tracked tournaments with reminders on, pinging the Reg Reminders role. everyone
// with it gets pinged, even when start.gg already has them registered. reg DMs still skip them
export async function postRegReminders(postChannel = channel) {
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
        const text = lastCall ? 'last call' : 'registration reminder';
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
    } catch (err) {
      console.error(`reg reminder for ${tournament.name ?? tournament.id} failed:`, err.message);
    }
  }
  save();
}

// 1-hour DMs for tracked tournaments with reminders on, to whoever turned them on with /notify, and nothing else
// decides. reg DMs skip anyone registered. when registration closes within an hour of the start there's one DM,
// the start one, since it carries the register link too. each goes once per close time and start time, so a
// TO moving one sends it again for the new time
export async function postDmReminders(postChannel = channel) {
  const client = postChannel?.client;
  if (!client || (!state.regDmPings.length && !state.startDmPings.length)) return;

  // only current server members get DMs, so leavers get nothing until they rejoin. prefs stay saved.
  // a failed membership check sends nothing and retries next time, so nobody is marked as sent
  let inServer = null;
  const guild = postChannel?.guild;
  if (guild) {
    try {
      const ids = [...new Set([...state.regDmPings, ...state.startDmPings])].filter(mentionable);
      inServer = new Set((await serverMembers(guild, ids)).keys());
    } catch (err) {
      console.error('DM membership check failed:', err.message);
      return;
    }
  }
  const memberOnly = (id) => !inServer || inServer.has(id);

  for (const tournament of Object.values(state.tournaments)) {
    if (!posting(tournament, 'reminders') || !dmSoon(tournament)) continue;
    let latest;
    try {
      // TOs move the close time and the start, so the DM goes off the latest
      latest = await startgg.getRegistration(tournament.slug);
      if (!latest) continue;
    } catch (err) {
      console.error(`DM reminders for ${tournament.name ?? tournament.id} failed:`, err.message);
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
        tournament.dmRegSentFor = deadline;
        // not open means it filled up
        if (latest.isRegistrationOpen) {
          const participants = await startgg.getParticipants(latest.id);
          rememberAccounts(participants);
          const registered = new Set(participants.map((participant) => participant.discordId));
          const embed = embeds.regReminder(latest, deadline, true);
          for (const discordId of state.regDmPings.filter((id) => !registered.has(id) && mentionable(id) && memberOnly(id))) await dmUser(client, discordId, embed);
        }
      }
    } catch (err) {
      console.error(`registration DMs for ${tournament.name ?? tournament.id} failed:`, err.message);
    }

    try {
      if (state.startDmPings.length && tournament.dmStartSentFor !== startAt && dmDue(startAt)) {
        tournament.dmStartSentFor = startAt;
        const embed = embeds.startReminder(latest);
        for (const discordId of state.startDmPings.filter((id) => mentionable(id) && memberOnly(id))) await dmUser(client, discordId, embed);
      }
    } catch (err) {
      console.error(`start DMs for ${tournament.name ?? tournament.id} failed:`, err.message);
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

// one DM, skipped when DMs are closed or the user left. failures stay in the logs, the rest still go out
async function dmUser(client, discordId, embed) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send({ embeds: embeds.withImage([embed]) });
  } catch (err) {
    console.error(`DM to ${discordId} failed:`, err.message);
  }
}
