import { escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { RUNS_LATE_HOURS, endTime, regDeadline, secondsNow } from '../tracker.js';
import { rememberAccounts, serverMembers } from '../accounts.js';
import { replyEphemeral, replyEphemeralAfterDefer, sendEmbeds, flag } from './shared.js';

// /bracket shows a tournament this long before it starts
const BRACKET_MINUTES_BEFORE = 30;

// /reg_warn pings someone once per tournament in this long
const REG_WARN_COOLDOWN_HOURS = 12;

// start.gg/tournament/genesis-x/details, a short link like start.gg/genesis, or just the slug
function tournamentSlug(input) {
  const path = input.replace(/^(https?:\/\/)?(www\.)?(start|smash)\.gg\//, '');
  return path.match(/tournament\/([\w-]+)/)?.[1] ?? path.split(/[/?#]/)[0];
}

// mentions stay off so a typed link can't ping anyone. backticks stripped so it can't break the code span
function tournamentNotFound(input) {
  const shown = String(input).replaceAll('`', '').slice(0, 100);
  return { content: `Couldn't find a start.gg tournament for \`${shown}\`. Paste its link, like start.gg/tournament/genesis-x.`, allowedMentions: { parse: [] } };
}

// autocomplete, so nobody has to paste a link for a tournament the bot already knows: tracked ones and ones
// tracked players are in, soonest first. only says which: new is the ones /tournament add can still track, tracked
// the ones it already does. a pasted link of one of them shows its name, and anything else typed is offered back as it is
function tournamentChoices(typed, { only = 'known' } = {}) {
  const now = secondsNow();
  const search = typed.trim().toLowerCase();
  const known = Object.values(state.tournaments).filter((tournament) => {
    if (!tournament.slug || !tournament.name) return false;
    if (only === 'tracked') return Boolean(tournament.tracked);
    // a reg admin's has no dates until the next tournament check
    if (tournament.startAt && endTime(tournament) < now) return false;
    return only !== 'new' || !tournament.tracked;
  });
  const choices = known
    .filter((tournament) => tournament.name.toLowerCase().includes(search) || tournament.slug === `tournament/${tournamentSlug(search)}`)
    .sort((a, b) => (a.startAt ?? Infinity) - (b.startAt ?? Infinity))
    .map((tournament) => ({ name: tournament.name.slice(0, 100), value: tournament.slug }));
  if (choices.length) return choices.slice(0, 25);
  // picking the empty one gets the not found reply
  if (!search) {
    return [{ name: only === 'tracked' ? 'No tracked tournaments yet, /tournament add one' : 'No tournaments to pick yet, paste a start.gg link', value: 'none' }];
  }
  return [{ name: typed.trim().slice(0, 100), value: typed.trim().slice(0, 100) }];
}

// from a little before the start until well after the end, since locals run late. soonest first, each tournament once
function goingOn(tournaments) {
  const now = secondsNow();
  const seen = new Set();
  return tournaments
    .filter((tournament) => now >= tournament.startAt - BRACKET_MINUTES_BEFORE * 60 && now <= endTime(tournament) + RUNS_LATE_HOURS * 60 * 60)
    .filter((tournament) => !seen.has(String(tournament.id)) && seen.add(String(tournament.id)))
    .sort((a, b) => a.startAt - b.startAt);
}

// tracked tournaments only, they're the ones the server cares about
function bracket(interaction) {
  const live = goingOn(Object.values(state.tournaments).filter((tournament) => tournament.tracked));
  if (!live.length) {
    return interaction.reply('No tracked tournaments going on right now. Check the other channels if you\'re expecting one.');
  }
  return sendEmbeds(interaction, live.flatMap((tournament) => embeds.bracket(tournament)));
}

const ASK_A_TO = 'If you were expecting a stream, ask a TO in another channel. `/socials` has the server\'s saved streams.';

// tracked tournaments and the ones tracked players are in. start.gg only has the streams a TO added on the
// tournament page, so a tournament with none is left out and named instead
async function streamLink(interaction) {
  const live = goingOn(Object.values(state.tournaments).filter((tournament) => !tournament.resultsPosted));
  if (!live.length) return interaction.reply(`No tracked tournaments are going on right now. ${ASK_A_TO}`);

  await interaction.deferReply();
  let streams;
  try {
    streams = await startgg.getTournamentStreams(live.map((tournament) => tournament.id));
  } catch (err) {
    console.error('stream links failed:', err.message);
    return interaction.editReply(`Couldn't get stream links from start.gg right now. ${ASK_A_TO}`);
  }
  const shown = live.filter((tournament) => streams.get(String(tournament.id))?.length);
  if (!shown.length) {
    const names = live.slice(0, 5).map((tournament) => escapeMarkdown(tournament.name));
    if (live.length > 5) names.push(`${live.length - 5} more`);
    return interaction.editReply({ content: `No stream links on start.gg for ${new Intl.ListFormat('en').format(names)}. ${ASK_A_TO}`, allowedMentions: { parse: [] } });
  }
  return sendEmbeds(interaction, shown.flatMap((tournament) => embeds.streamLinks(tournament, streams.get(String(tournament.id)))));
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
    return interaction.editReply({ content: `start.gg hides who's registered for ${escapeMarkdown(found.name)}, so there's no list to show.`, allowedMentions: { parse: [] } });
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
  const name = escapeMarkdown(interaction.options.getMember('user')?.displayName ?? user.displayName);
  if (participants.some((participant) => participant.discordId === user.id)) {
    return interaction.editReply({ content: `Already registered.\n-# ${name} · ${escapeMarkdown(tournament.name)}`, allowedMentions: { parse: [] } });
  }
  const deadline = regDeadline(tournament);
  if (deadline <= secondsNow()) return interaction.editReply({ content: `Registration for ${escapeMarkdown(tournament.name)} already closed.`, allowedMentions: { parse: [] } });
  if (!tournament.isRegistrationOpen) return interaction.editReply({ content: `Registration for ${escapeMarkdown(tournament.name)} isn't open right now.`, allowedMentions: { parse: [] } });
  // not on a hidden list means nothing, so no warning
  if (startgg.attendeesHidden(tournament, participants)) {
    return interaction.editReply({ content: `start.gg hides who's registered for ${escapeMarkdown(tournament.name)}, so there's no telling if they are. No warning sent.`, allowedMentions: { parse: [] } });
  }
  // two people warning the same person about the same tournament is one too many. checked last, with nothing
  // awaited before it's saved, so two at once can't both get through
  const now = secondsNow();
  state.regWarned = state.regWarned.filter((each) => each.at > now - REG_WARN_COOLDOWN_HOURS * 60 * 60);
  const earlier = state.regWarned.find((each) => String(each.tournamentId) === String(tournament.id) && each.discordId === user.id);
  if (earlier) {
    return replyEphemeralAfterDefer(interaction, `${name} was already warned about ${escapeMarkdown(tournament.name)} <t:${earlier.at}:R>. They can be warned again <t:${earlier.at + REG_WARN_COOLDOWN_HOURS * 60 * 60}:R>.`);
  }
  state.regWarned = [...state.regWarned, { tournamentId: tournament.id, discordId: user.id, at: now }].slice(-200);
  save();

  // editing the reply wouldn't ping them, and a follow-up shows "Original message was deleted"
  // once the thinking reply is gone, so the warning goes in the channel as its own message
  const warning = {
    content: `<@${user.id}>`,
    embeds: embeds.withImage([embeds.regWarning(tournament, deadline)]),
    allowedMentions: { users: [user.id] },
  };
  const sent = await interaction.channel?.send(warning).catch(() => null);
  await interaction.deleteReply();
  // can't post in that channel, a follow-up still pings them
  if (!sent) return interaction.followUp(warning);
}

export { bracket, streamLink, registered, regWarn, tournamentChoices, tournamentSlug, tournamentNotFound };
