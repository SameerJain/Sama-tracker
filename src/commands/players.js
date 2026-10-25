import { MessageFlags, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { ROLL_CALL_MIN_PLAYERS, RUNS_LATE_HOURS, checkTournaments, crewOf, endTime, newTracked, resultsOn, secondsNow } from '../tracker.js';
import { findAccount, serverMembers } from '../accounts.js';
import { setResultColors } from '../message-settings.js';
import { count } from '../embeds/shared.js';
import {
  buttonRow, findPlayer, flag, h2hButton, isSelf, linkedPlayer, readChoice, readPlayer, readTracked, replyEphemeral, replyEphemeralAfterDefer, replyNoPlayer,
  replyNotTracked, sendEmbeds, statPlayer, t, listOf,
} from './shared.js';
import { askFirst, confirmable, undoRow } from './confirm.js';
import { isTO, notTO } from './to.js';

// /recent all only asks start.gg about whoever played most recently
const RECENT_ALL_PLAYERS = 40;

// /t-o cleanup's Are you sure names this many, then says how many more
const CLEANUP_NAMED = 10;

// anyone can track themselves: profile left out finds theirs, and a link counts when it has their discord
// connected. only TOs can track someone else, by link or by picking them in user:
async function trackAdd(interaction) {
  const input = interaction.options.getString('profile');
  const picked = interaction.options.getUser('user');
  const to = isTO(interaction);
  if (picked) {
    if (input) return replyEphemeral(interaction, t('Pick either `user` or `profile`, not both.'));
    if (picked.bot) return replyEphemeral(interaction, t('Bots don\'t have start.gg accounts.'));
    if (!interaction.options.getMember('user')) return replyEphemeral(interaction, t('Pick someone in this server.'));
    if (picked.id !== interaction.user.id && !to) return notTO(interaction, t('track someone else. Leave out `user` to track yourself'));
  }

  await interaction.deferReply();
  let player;
  if (input) player = await findPlayer(interaction, input);
  else if (picked && picked.id !== interaction.user.id) player = await memberAccount(interaction, picked);
  else player = await ownAccount(interaction, '/track add');
  if (!player) return;
  if (!to && player.discordId !== interaction.user.id) {
    const tag = escapeMarkdown(player.tag);
    const why = player.discordId ? t`${tag}'s start.gg has a different Discord connected.` : t`If ${tag} is you, connect this Discord on your start.gg first.`;
    return replyEphemeralAfterDefer(interaction, t`Only TOs can track someone else. ${why}`);
  }
  if (state.players[player.userId]) {
    return interaction.editReply({ content: t`Already tracking ${escapeMarkdown(player.tag)}.`, allowedMentions: { parse: [] } });
  }

  state.players[player.userId] = newTracked(player);
  save();
  await interaction.editReply({ content: null, embeds: embeds.withImage([embeds.added(player)]), allowedMentions: { parse: [] } });

  // don't wait 15 min for their tournaments to show up
  checkTournaments();
}

// asks first, then has an Undo button for a minute that puts them back with every setting they had.
// anyone can untrack themselves, only TOs can untrack someone else
function trackRemove(interaction) {
  const player = readTracked(interaction);
  if (!player) return replyNotTracked(interaction);
  if (!isSelf(interaction, player) && !isTO(interaction)) return notTO(interaction, t('untrack someone else. Leave out `player` to untrack yourself'));
  return askFirst(interaction, 'untrack', player.userId, t`Stop tracking ${escapeMarkdown(player.tag)}? Their set result and stream alert settings go with them.`, t('Stop tracking'));
}

confirmable('untrack', {
  command: '/track remove',
  run: (userId) => {
    const player = state.players[userId];
    if (!player) return { content: t('They aren\'t tracked anymore.') };
    delete state.players[userId];
    save();
    return { content: t`Stopped tracking ${escapeMarkdown(player.tag)}.`, undo: player };
  },
  cancel: (userId) => (state.players[userId] ? t`Still tracking ${escapeMarkdown(state.players[userId].tag)}.` : t('They aren\'t tracked anymore.')),
  undo: (player) => {
    if (state.players[player.userId]) return t`${escapeMarkdown(player.tag)} is already tracked again.`;
    state.players[player.userId] = player;
    save();
    return t`Tracking ${escapeMarkdown(player.tag)} again, with the same settings as before.`;
  },
  tooLate: () => t('Too late to undo. `/track add` them again, with set results and stream alerts starting off.'),
});

// who /t-o cleanup asked about, by the id its buttons carry, until someone presses one. a restart in between
// loses it, and the button says to run it again. a question goes stale after a while, so an old button
// can't untrack from an old list
const cleanups = new Map();
const CLEANUP_SECONDS = 15 * 60;

// tracked players whose start.gg discord isn't in this server, which is most of a track list that grew from bulk
// adds. no discord on start.gg says nothing about where someone is, so they stay unless no_discord says otherwise.
// asks first, then Undo puts everyone back for a minute. TOs only, since it untracks other people
async function trackCleanup(interaction) {
  if (!isTO(interaction)) return notTO(interaction, t('clean up the track list'));
  const noDiscord = flag(interaction, 'no_discord');

  await interaction.deferReply();
  const players = Object.values(state.players);
  const members = await serverMembers(interaction.guild, [...new Set(players.map((player) => player.discordId).filter(Boolean))]);
  const away = players.filter((player) => player.discordId && !members.has(player.discordId));
  const unknown = players.filter((player) => !player.discordId);
  const going = noDiscord ? [...away, ...unknown] : away;
  let kept = '';
  if (!noDiscord && unknown.length) {
    kept = unknown.length === 1
      ? t('\n-# 1 player has no Discord on start.gg and stays. `no_discord:True` untracks them too')
      : t`\n-# ${unknown.length} players have no Discord on start.gg and stay. \`no_discord:True\` untracks them too`;
  }
  if (!going.length) return interaction.editReply({ content: t`Everyone tracked has their start.gg Discord in this server.${kept}`, allowedMentions: { parse: [] } });

  const target = String(interaction.id ?? Date.now());
  cleanups.set(target, going.map((player) => player.userId));
  setTimeout(() => cleanups.delete(target), CLEANUP_SECONDS * 1000).unref?.();
  const names = going.slice(0, CLEANUP_NAMED).map((player) => escapeMarkdown(player.tag));
  if (going.length > CLEANUP_NAMED) names.push(t`${going.length - CLEANUP_NAMED} more`);
  const list = listOf(names);
  const question = noDiscord
    ? t`Untrack ${count(going.length, 'player')} whose start.gg Discord isn't in this server or who have none? ${list}.${kept}`
    : t`Untrack ${count(going.length, 'player')} whose start.gg Discord isn't in this server? ${list}.${kept}`;
  return askFirst(interaction, 'cleanup', target, question, t('Untrack them'));
}

confirmable('cleanup', {
  command: '/t-o cleanup',
  run: (target) => {
    const userIds = cleanups.get(target);
    cleanups.delete(target);
    if (!userIds) return { content: t('That button doesn\'t work anymore. Run `/t-o cleanup` again.') };
    const removed = userIds.map((userId) => state.players[userId]).filter(Boolean);
    for (const player of removed) delete state.players[player.userId];
    save();
    return { content: t`Untracked ${count(removed.length, 'player')}.`, undo: removed };
  },
  cancel: (target) => {
    cleanups.delete(target);
    return t('Everyone stays tracked.');
  },
  undo: (removed) => {
    const back = removed.filter((player) => !state.players[player.userId]);
    for (const player of back) state.players[player.userId] = player;
    save();
    return t`Tracking ${count(back.length, 'player')} again, with the same settings as before.`;
  },
  tooLate: () => t('Too late to undo. `/track add` anyone you want back.'),
});

// only lets commands default to them, they don't get tracked.
// their start.gg has to have this discord connected so nobody can link as someone else
async function link(interaction) {
  // commands already find them, a link would change nothing
  const tracked = Object.values(state.players).find((player) => player.discordId === interaction.user.id);
  if (tracked) return replyEphemeral(interaction, noLinkNeeded(tracked));

  const input = interaction.options.getString('profile');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const player = input ? await findPlayer(interaction, input, true) : await ownAccount(interaction, '/link');
  if (!player) return;
  if (player.discordId !== interaction.user.id) {
    return interaction.editReply(player.discordId
      ? t`${escapeMarkdown(player.tag)}'s start.gg has a different Discord account connected.`
      : t('Connect your Discord on your start.gg profile first, then try again.'));
  }
  // tracked, but connected discord after the last profile refresh. saving it finds them right away
  const trackedProfile = state.players[player.userId];
  if (trackedProfile) {
    trackedProfile.discordId = player.discordId;
    save();
    return interaction.editReply({ content: noLinkNeeded(trackedProfile), allowedMentions: { parse: [] } });
  }

  const previous = state.links[interaction.user.id];
  state.links[interaction.user.id] = player;
  save();
  if (previous?.userId === player.userId) {
    return interaction.editReply({ content: t`Already linked to ${escapeMarkdown(player.tag)}. Leave the player out of a command like \`/stats\` to look yourself up.`, allowedMentions: { parse: [] } });
  }
  return interaction.editReply({ content: null, embeds: embeds.withImage([embeds.linked(player, previous)]), allowedMentions: { parse: [] } });
}

// /link or /track add with the profile left out, so nobody has to copy a link over. start.gg can't be searched
// by discord, so it's the same search /profile does: accounts the bot has already seen. null and a reply if none
async function ownAccount(interaction, command) {
  const account = await findAccount(interaction.user.id);
  const player = account && await startgg.getPlayer(account.slug);
  if (!player) {
    await interaction.editReply(t`Couldn't find a start.gg with this Discord connected among the accounts I've seen. Connect it on your start.gg profile if you haven't, then run \`${command}\` with your profile link, like start.gg/user/f64a83c8.`);
  }
  return player;
}

// a member a TO picked in /track add user:, found the same way: by their discord among the accounts the bot has
// seen. their name, not a mention, says why there's nothing yet, so nobody gets pinged
async function memberAccount(interaction, user) {
  const account = await findAccount(user.id);
  const player = account && await startgg.getPlayer(account.slug);
  if (!player) {
    const name = escapeMarkdown(interaction.options.getMember('user')?.displayName ?? user.displayName ?? user.username);
    await interaction.editReply({
      content: t`Couldn't find a start.gg with ${name}'s Discord connected. Ask them to run \`/link\` once, or add them with \`profile:\` and their start.gg link.`,
      allowedMentions: { parse: [] },
    });
  }
  return player;
}

function noLinkNeeded(player) {
  return t`No need to link. You're tracked as ${escapeMarkdown(player.tag)} with this Discord on your start.gg, so leaving the player out of a command already looks you up.`;
}

// an Undo button puts the link back for a minute after
function unlink(interaction) {
  const linked = state.links[interaction.user.id];
  if (!linked) return replyEphemeral(interaction, t('You weren\'t linked.'));
  delete state.links[interaction.user.id];
  save();
  let content = t`Unlinked from ${escapeMarkdown(linked.tag)}.`;
  // tracked with discord connected still counts
  const still = linkedPlayer(interaction.user.id);
  if (still) content += t` Commands still find you as ${escapeMarkdown(still.tag)}, since you're tracked with this Discord on your start.gg.`;
  else content += t(' Leaving the player blank won\'t find you now, you\'re off the player list and `/scout` needs a link.');
  return interaction.reply({ content, components: undoRow(interaction, 'unlink', linked.userId, linked), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

confirmable('unlink', {
  command: '/unlink',
  undo: (linked, discordId) => {
    if (state.links[discordId]) return t`You've linked ${escapeMarkdown(state.links[discordId].tag)} since, so that stays.`;
    state.links[discordId] = linked;
    save();
    return t`Linked to ${escapeMarkdown(linked.tag)} again.`;
  },
  tooLate: () => t('Too late to undo. `/link` again with your start.gg profile link.'),
});

// goes by the discord connected on start.gg, so nobody can claim someone else's
// a tracked or linked pick beats the server member picker, and needs no start.gg lookup
async function profile(interaction) {
  if (interaction.options.getString('player')) {
    const player = readPlayer(interaction);
    if (!player) return replyNoPlayer(interaction);
    await interaction.deferReply();
    return interaction.editReply({ content: null, embeds: embeds.withImage([embeds.profile(player, { name: player.tag })]), allowedMentions: { parse: [] } });
  }
  const picked = interaction.options.getUser('user');
  const user = picked ?? interaction.user;
  const member = picked ? interaction.options.getMember('user') : interaction.member;
  if (!member) return replyEphemeral(interaction, t('Pick someone in this server.'));
  if (user.bot) return replyEphemeral(interaction, t('Bots don\'t have start.gg accounts.'));

  await interaction.deferReply();
  const account = await findAccount(user.id);
  if (account) {
    const card = embeds.profile(account, { name: member.displayName, avatar: member.displayAvatarURL() });
    return interaction.editReply({ content: null, embeds: embeds.withImage([card]), allowedMentions: { parse: [] } });
  }
  if (user.id === interaction.user.id) {
    return interaction.editReply(t('Couldn\'t find a start.gg with your Discord connected. Connect it on your start.gg profile if you haven\'t, then `/link` it.'));
  }
  // their name and not a mention, so nobody gets pinged. a name can spell out a role mention, so mentions are off too
  return interaction.editReply({
    content: t`Couldn't find a start.gg with ${escapeMarkdown(member.displayName)}'s Discord connected.\n-# Ask them to run \`/link\` with their start.gg link once, or to register for a tournament the bot checks, and then this finds them. start.gg can't be searched by Discord`,
    allowedMentions: { parse: [] },
  });
}

// tracked tournaments with whoever from the crew is going, and any other one 3 or more tracked players are in
async function upcoming(interaction) {
  // all, someone from the list, or a start.gg profile link or ID for anyone
  const choice = readChoice(interaction) ?? await statPlayer(interaction);
  if (!choice) return null;
  // only tracked players' tournaments are saved
  if (choice !== 'all' && !state.players[choice.userId]) return upcomingFor(interaction, choice);

  const now = secondsNow();
  const tournaments = [];
  const people = { ...state.players };
  for (const tournament of Object.values(state.tournaments)) {
    if (tournament.resultsPosted || !tournament.startAt || now > endTime(tournament)) continue;
    const crew = crewOf(tournament);
    // otherwise only where the crew shows up, the same 3 as a roll call
    const going = new Set(tournament.entries.map((entry) => entry.userId).filter((id) => state.players[id]));
    if (!tournament.tracked && going.size < ROLL_CALL_MIN_PLAYERS) continue;

    const entries = tournament.entries.filter((entry) => {
      if (!crew[entry.userId]) return false;
      return choice === 'all' || String(entry.userId) === String(choice.userId);
    });
    // a tracked one shows for everyone even before anyone registers
    if (entries.length || (tournament.tracked && choice === 'all')) {
      tournaments.push({ ...tournament, entries });
      Object.assign(people, tournament.crew, state.players);
    }
  }
  tournaments.sort((a, b) => a.startAt - b.startAt);

  const who = choice === 'all' ? 'everyone' : choice.tag;
  return sendEmbeds(interaction, embeds.upcoming(tournaments, people, who, { minimum: ROLL_CALL_MIN_PLAYERS }));
}

// someone from /link, straight from start.gg
async function upcomingFor(interaction, player) {
  if (!interaction.deferred) await interaction.deferReply();
  const [[, found]] = await startgg.getUpcomingTournaments([player.userId]);
  const tournaments = [];
  for (const { id } of found) {
    const tournament = await startgg.getTournament(id, [player.userId]);
    // no entries means they only admin it
    if (tournament?.entries.length && secondsNow() <= endTime(tournament)) tournaments.push(tournament);
  }
  tournaments.sort((a, b) => a.startAt - b.startAt);
  return sendEmbeds(interaction, embeds.upcoming(tournaments, { [player.userId]: player }, player.tag));
}

async function recent(interaction) {
  // all, someone from the list, or a start.gg profile link or ID for anyone
  const choice = readChoice(interaction) ?? await statPlayer(interaction);
  if (!choice) return null;

  if (!interaction.deferred) await interaction.deferReply();
  // the latest 20 sets come from whoever played last, no need to ask about everyone.
  // the set check keeps lastSetAt fresh only for players with results on, so they go first
  const asking = choice === 'all'
    ? Object.values(state.players)
      .sort((a, b) => resultsOn(b) - resultsOn(a) || (b.lastSetAt ?? 0) - (a.lastSetAt ?? 0))
      .slice(0, RECENT_ALL_PLAYERS)
    : [choice];
  const perPlayer = choice === 'all' ? 3 : 5;

  const sets = await startgg.getSets(asking.map((player) => player.playerId), { perPage: perPlayer });

  // 20 max so it's two messages at most
  const latest = sets
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, 20);
  if (!latest.length) return interaction.editReply(t('No sets found.'));

  // someone from /link isn't tracked, the cards still need to know which side is theirs
  const players = choice === 'all' ? state.players : { ...state.players, [choice.userId]: choice };
  const cards = latest.map((set) => embeds.setResult(set, players, { setColors: setResultColors() }));
  // sort is stable, so each player's sets stay newest first
  if (choice === 'all') cards.sort((a, b) => (a.data.author?.name ?? '').localeCompare(b.data.author?.name ?? ''));

  // finished sets, so no head to head buttons. /run has them for who's next
  await sendEmbeds(interaction, cards);
}

// /h2h buttons for the first few different opponents in these sets, named for who it's against. discord fits 5 in a row
function h2hButtons(player, sets) {
  const seen = new Set();
  const buttons = [];
  for (const set of sets) {
    const them = startgg.fromSide(set, player.playerId)?.them;
    const opponent = them && String(them.playerIds[0]);
    const button = opponent && !seen.has(opponent) && h2hButton(set, player);
    if (!button) continue;
    seen.add(opponent);
    buttons.push(button);
    if (buttons.length === 5) break;
  }
  return buttonRow(...buttons);
}

async function run(interaction) {
  const player = await statPlayer(interaction);
  if (!player) return null;

  if (!interaction.deferred) await interaction.deferReply();
  const now = secondsNow();
  // the saved ones too, in case start.gg's upcoming list drops one that's running late
  const [[, upcoming]] = await startgg.getUpcomingTournaments([player.userId]);
  const finished = new Set(Object.values(state.tournaments)
    .filter((tournament) => tournament.resultsPosted)
    .map((tournament) => String(tournament.id)));
  const tournaments = new Map(Object.values(state.tournaments)
    .filter((tournament) => !tournament.resultsPosted && tournament.userIds?.includes(player.userId))
    .map((tournament) => [tournament.id, tournament]));
  for (const tournament of upcoming) {
    if (!finished.has(String(tournament.id))) tournaments.set(tournament.id, tournament);
  }
  const current = [...tournaments.values()]
    .filter((tournament) => tournament.startAt <= now && now <= endTime(tournament) + RUNS_LATE_HOURS * 60 * 60)
    .sort((a, b) => b.startAt - a.startAt);

  const cards = [];
  const nextSets = [];
  for (const found of current) {
    const tournament = await startgg.getTournament(found.id, [player.userId]);
    // no entries means they only admin it
    if (!tournament?.entries.length) continue;
    // every bracket they're in, asked for at once. ones that haven't started yet still get a line
    const runs = await Promise.all(tournament.entries.map(async (entry) => ({
      entry, sets: entry.started ? await startgg.getRunSets(entry.eventId, player.playerId) : [],
    })));
    cards.push(...embeds.run(player, tournament, runs, now));
    nextSets.push(...embeds.nextOpponents(player, runs).map(({ set }) => set));
  }
  if (!cards.length) return interaction.editReply({ content: t`${escapeMarkdown(player.tag)} has no current tournament run on start.gg.`, allowedMentions: { parse: [] } });
  // the record against whoever's next is one tap away
  return sendEmbeds(interaction, cards, h2hButtons(player, nextSets));
}

export { trackAdd, trackRemove, trackCleanup, link, unlink, profile, upcoming, recent, run };
