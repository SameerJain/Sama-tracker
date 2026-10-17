import { MessageFlags, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { RUNS_LATE_HOURS, checkTournaments, endTime, secondsNow } from '../tracker.js';
import { findAccount } from '../accounts.js';
import { findPlayer, linkedPlayer, readChoice, readPlayer, replyEphemeral, replyNoPlayer, sendEmbeds } from './shared.js';

// /recent all only asks start.gg about whoever played most recently
const RECENT_ALL_PLAYERS = 40;

async function trackAdd(interaction) {
  const input = interaction.options.getString('profile', true);

  await interaction.deferReply();
  const player = await findPlayer(interaction, input);
  if (!player) return;
  if (state.players[player.userId]) {
    return interaction.editReply(`Already tracking ${player.tag}.`);
  }

  state.players[player.userId] = { ...player, lastCheck: secondsNow(), streamAlerts: true, setResults: true };
  save();
  await interaction.editReply({ embeds: [embeds.added(player)] });

  // don't wait 15 min for their tournaments to show up
  checkTournaments();
}

async function trackRemove(interaction) {
  const player = readPlayer(interaction, 'player', { trackedOnly: true });
  if (!player) return replyNoPlayer(interaction, 'player', { trackedOnly: true });

  delete state.players[player.userId];
  save();
  await interaction.reply(`Stopped tracking ${player.tag}.`);
}

// only lets commands default to them, they don't get tracked.
// their start.gg has to have this discord connected so nobody can link as someone else
async function link(interaction) {
  // commands already find them, a link would change nothing
  const tracked = Object.values(state.players).find((player) => player.discordId === interaction.user.id);
  if (tracked) return replyEphemeral(interaction, noLinkNeeded(tracked));

  const input = interaction.options.getString('profile', true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const player = await findPlayer(interaction, input, 'your');
  if (!player) return;
  if (player.discordId !== interaction.user.id) {
    return interaction.editReply(player.discordId
      ? `${player.tag}'s start.gg has a different Discord account connected.`
      : 'Connect your Discord on your start.gg profile first, then try again.');
  }
  // tracked, but connected discord after the last profile refresh. saving it finds them right away
  const trackedProfile = state.players[player.userId];
  if (trackedProfile) {
    trackedProfile.discordId = player.discordId;
    save();
    return interaction.editReply(noLinkNeeded(trackedProfile));
  }

  const previous = state.links[interaction.user.id];
  state.links[interaction.user.id] = player;
  save();
  if (previous?.userId === player.userId) {
    return interaction.editReply(`Already linked to ${player.tag}. Leave the player out of a command like \`/stats\` to look yourself up.`);
  }
  return interaction.editReply({ embeds: [embeds.linked(player, previous)] });
}

function noLinkNeeded(player) {
  return `No need to link. You're tracked as ${player.tag} with this Discord on your start.gg, so leaving the player out of a command already looks you up.`;
}

function unlink(interaction) {
  const linked = state.links[interaction.user.id];
  delete state.links[interaction.user.id];
  if (linked) save();
  let content = linked ? `Unlinked from ${linked.tag}.` : 'You weren\'t linked.';
  // tracked with discord connected still counts
  const still = linkedPlayer(interaction.user.id);
  if (still) content += ` Commands still find you as ${still.tag}, since you're tracked with this Discord on your start.gg.`;
  else if (linked) content += ' Leaving the player blank won\'t find you now, you\'re off the player list and `/scout` needs a link.';
  return replyEphemeral(interaction, content);
}

// goes by the discord connected on start.gg, so nobody can claim someone else's
// a tracked or linked pick beats the server member picker, and needs no start.gg lookup
async function profile(interaction) {
  if (interaction.options.getString('player')) {
    const player = readPlayer(interaction);
    if (!player) return replyNoPlayer(interaction);
    await interaction.deferReply();
    return interaction.editReply({ embeds: [embeds.profile(player, { name: player.tag })] });
  }
  const picked = interaction.options.getUser('user');
  const user = picked ?? interaction.user;
  const member = picked ? interaction.options.getMember('user') : interaction.member;
  if (!member) return replyEphemeral(interaction, 'Pick someone in this server.');
  if (user.bot) return replyEphemeral(interaction, 'Bots don\'t have start.gg accounts.');

  await interaction.deferReply();
  const account = await findAccount(user.id);
  if (account) return interaction.editReply({ embeds: [embeds.profile(account, { name: member.displayName, avatar: member.displayAvatarURL() })] });
  if (user.id === interaction.user.id) {
    return interaction.editReply('Couldn\'t find a start.gg with your Discord connected. Connect it on your start.gg profile if you haven\'t, then `/link` it.');
  }
  // their name and not a mention, so nobody gets pinged. a name can spell out a role mention, so mentions are off too
  return interaction.editReply({
    content: `Couldn't find a start.gg with ${escapeMarkdown(member.displayName)}'s Discord connected.\n-# Ask them to run \`/link\` with their start.gg link once, or to register for a tournament the bot checks, and then this finds them. start.gg can't be searched by Discord`,
    allowedMentions: { parse: [] },
  });
}

async function upcoming(interaction) {
  const choice = readChoice(interaction);
  if (!choice) return replyNoPlayer(interaction);
  // only tracked players' tournaments are saved
  if (choice !== 'all' && !state.players[choice.userId]) return upcomingFor(interaction, choice);

  const now = secondsNow();
  const tournaments = [];
  for (const tournament of Object.values(state.tournaments)) {
    if (tournament.resultsPosted || now > endTime(tournament)) continue;

    const entries = tournament.entries.filter((entry) => {
      if (!state.players[entry.userId]) return false;
      return choice === 'all' || entry.userId === choice.userId;
    });
    if (entries.length) tournaments.push({ ...tournament, entries });
  }
  tournaments.sort((a, b) => a.startAt - b.startAt);

  const who = choice === 'all' ? 'everyone' : choice.tag;
  return sendEmbeds(interaction, embeds.upcoming(tournaments, state.players, who));
}

// someone from /link, straight from start.gg
async function upcomingFor(interaction, player) {
  await interaction.deferReply();
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
  const choice = readChoice(interaction);
  if (!choice) return replyNoPlayer(interaction);

  await interaction.deferReply();
  // the latest 20 sets come from whoever played last, no need to ask about everyone
  const asking = choice === 'all'
    ? Object.values(state.players).sort((a, b) => (b.lastSetAt ?? 0) - (a.lastSetAt ?? 0)).slice(0, RECENT_ALL_PLAYERS)
    : [choice];
  const perPlayer = choice === 'all' ? 3 : 5;

  const sets = await startgg.getSets(asking.map((player) => player.playerId), { perPage: perPlayer });

  // 20 max so it's two messages at most
  const latest = sets
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, 20);
  if (!latest.length) return interaction.editReply('No sets found.');

  // someone from /link isn't tracked, the cards still need to know which side is theirs
  const players = choice === 'all' ? state.players : { ...state.players, [choice.userId]: choice };
  const cards = latest.map((set) => embeds.setResult(set, players));
  // sort is stable, so each player's sets stay newest first
  if (choice === 'all') cards.sort((a, b) => (a.data.author?.name ?? '').localeCompare(b.data.author?.name ?? ''));

  await sendEmbeds(interaction, cards);
}

async function run(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const now = secondsNow();
  // the saved ones too, in case start.gg's upcoming list drops one that's running late
  const [[, upcoming]] = await startgg.getUpcomingTournaments([player.userId]);
  const tournaments = new Map(Object.values(state.tournaments)
    .filter((tournament) => tournament.userIds?.includes(player.userId))
    .map((tournament) => [tournament.id, tournament]));
  for (const tournament of upcoming) tournaments.set(tournament.id, tournament);
  const current = [...tournaments.values()]
    .filter((tournament) => tournament.startAt <= now && now <= endTime(tournament) + RUNS_LATE_HOURS * 60 * 60)
    .sort((a, b) => b.startAt - a.startAt);

  const cards = [];
  for (const found of current) {
    const tournament = await startgg.getTournament(found.id, [player.userId]);
    // no entries means they only admin it
    if (!tournament?.entries.length) continue;
    // every bracket they're in, asked for at once. ones that haven't started yet still get a line
    const runs = await Promise.all(tournament.entries.map(async (entry) => ({
      entry, sets: entry.started ? await startgg.getRunSets(entry.eventId, player.playerId) : [],
    })));
    cards.push(...embeds.run(player, tournament, runs));
  }
  if (!cards.length) return interaction.editReply(`${player.tag} has no current tournament run on start.gg.`);
  return sendEmbeds(interaction, cards);
}

export { trackAdd, trackRemove, link, unlink, profile, upcoming, recent, run };
