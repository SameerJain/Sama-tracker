import { ApplicationCommandOptionType as Option, MessageFlags, embedLength } from 'discord.js';
import * as startgg from './startgg.js';
import * as embeds from './embeds.js';
import { state, save } from './store.js';
import { checkTournaments, endTime, secondsNow } from './tracker.js';
import * as smash4 from './sm4sh.js';
import { predict as predictOdds } from './predict.js';

// h2h and predict search this many pages of a player's sets, 40 per page.
const H2H_PAGES = 15;
const HISTORY_CACHE_MINUTES = 10;

function playerOption(description, name = 'player') {
  return { type: Option.String, name, description, required: true, autocomplete: true };
}

// The one /df command with all its subcommands. index.js registers it with Discord on startup.
export const command = {
  name: 'df',
  description: 'Dark Fundies',
  options: [
    { type: Option.Subcommand, name: 'help', description: 'Show commands' },
    {
      type: Option.SubcommandGroup,
      name: 'track',
      description: 'Manage tracked players',
      options: [
        {
          type: Option.Subcommand,
          name: 'add',
          description: 'Track a start.gg player',
          options: [{ type: Option.String, name: 'profile', description: 'start.gg profile link or ID', required: true }],
        },
        {
          type: Option.Subcommand,
          name: 'remove',
          description: 'Stop tracking a player',
          options: [playerOption('Tracked player')],
        },
        { type: Option.Subcommand, name: 'list', description: 'List tracked players' },
      ],
    },
    {
      type: Option.Subcommand,
      name: 'upcoming',
      description: 'Upcoming tournaments',
      options: [playerOption('Tracked player, or all')],
    },
    {
      type: Option.Subcommand,
      name: 'recent',
      description: 'Latest reported sets',
      options: [playerOption('Tracked player, or all')],
    },
    {
      type: Option.Subcommand,
      name: 'h2h',
      description: 'Head-to-head record between two tracked players',
      options: [playerOption('Tracked player'), playerOption('Tracked player', 'opponent')],
    },
    {
      type: Option.Subcommand,
      name: 'stats',
      description: 'Recent placements and set record',
      options: [playerOption('Tracked player')],
    },
    {
      type: Option.Subcommand,
      name: 'predict',
      description: 'Odds of one tracked player beating another',
      options: [playerOption('Tracked player'), playerOption('Tracked player', 'opponent')],
    },
    {
      type: Option.Subcommand,
      name: 'stream',
      description: 'Turn on-stream alerts on or off',
      options: [
        playerOption('Tracked player, or all'),
        {
          type: Option.String,
          name: 'alerts',
          description: 'on or off',
          required: true,
          choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }],
        },
      ],
    },
    { type: Option.Subcommand, name: 'sm4sh', description: smash4.LINE },
  ],
};

export async function handleCommand(interaction) {
  const group = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();
  const name = group ? `${group} ${subcommand}` : subcommand;

  switch (name) {
    case 'help':
      return interaction.reply({ embeds: [embeds.help()] });
    case 'track add':
      return trackAdd(interaction);
    case 'track remove':
      return trackRemove(interaction);
    case 'track list':
      return interaction.reply({ embeds: [embeds.trackedList(state.players)] });
    case 'upcoming':
      return upcoming(interaction);
    case 'recent':
      return recent(interaction);
    case 'h2h':
      return headToHead(interaction);
    case 'stats':
      return stats(interaction);
    case 'predict':
      return predict(interaction);
    case 'stream':
      return streamAlerts(interaction);
    case 'sm4sh':
      return sm4sh(interaction);
  }
}

export async function handleAutocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const choices = [];

  // These need a real player, so `all` isn't offered there.
  if (!['remove', 'h2h', 'stats', 'predict'].includes(interaction.options.getSubcommand()) && 'all'.startsWith(typed)) {
    choices.push({ name: 'all', value: 'all' });
  }
  for (const player of Object.values(state.players)) {
    if (player.tag.toLowerCase().includes(typed)) {
      choices.push({ name: player.tag, value: String(player.userId) });
    }
  }

  // Discord shows at most 25 choices.
  await interaction.respond(choices.slice(0, 25));
}

// Returns 'all', a tracked player, or undefined.
function readPlayerOption(interaction, name = 'player') {
  const value = interaction.options.getString(name, true).toLowerCase();
  if (value === 'all') return 'all';

  // Picking from the autocomplete list sends the user ID. Typing a name sends the name.
  // hasOwn so a name like "constructor" doesn't match a built-in property.
  if (Object.hasOwn(state.players, value)) return state.players[value];
  return Object.values(state.players).find((player) => player.tag.toLowerCase() === value);
}

// Discord allows 10 embeds and 6000 characters per message, so long replies continue in follow-ups.
async function sendEmbeds(interaction, list) {
  const messages = [[]];
  let size = 0;
  for (const embed of list) {
    const length = embedLength(embed.data);
    const current = messages.at(-1);
    if (current.length === 10 || (current.length && size + length > 6000)) {
      messages.push([]);
      size = 0;
    }
    messages.at(-1).push(embed);
    size += length;
  }

  for (const [i, batch] of messages.entries()) {
    if (i > 0) await interaction.followUp({ embeds: batch });
    else if (interaction.deferred) await interaction.editReply({ embeds: batch });
    else await interaction.reply({ embeds: batch });
  }
}

function replyNotTracked(interaction) {
  return interaction.reply({
    content: 'That player isn\'t tracked. See `/df track list`.',
    flags: MessageFlags.Ephemeral,
  });
}

async function trackAdd(interaction) {
  const input = interaction.options.getString('profile', true).trim();
  // Accept a full profile link or just the ID at the end of it.
  const slug = input.match(/user\/([\w-]+)/)?.[1] ?? input;

  await interaction.deferReply();
  const player = await startgg.getPlayer(slug);
  if (!player) {
    return interaction.editReply(`Couldn't find a start.gg player for \`${input}\`. Use their profile link, like start.gg/user/f64a83c8.`);
  }
  if (state.players[player.userId]) {
    return interaction.editReply(`Already tracking ${player.tag}.`);
  }

  state.players[player.userId] = { ...player, lastCheck: secondsNow(), streamAlerts: true };
  save();
  await interaction.editReply({ embeds: [embeds.added(player)] });

  // Look up their tournaments now instead of waiting for the next check.
  checkTournaments();
}

async function trackRemove(interaction) {
  const player = readPlayerOption(interaction);
  if (!player || player === 'all') return replyNotTracked(interaction);

  delete state.players[player.userId];
  save();
  await interaction.reply(`Stopped tracking ${player.tag}.`);
}

function upcoming(interaction) {
  const choice = readPlayerOption(interaction);
  if (!choice) return replyNotTracked(interaction);

  const now = secondsNow();
  const tournaments = [];
  for (const tournament of Object.values(state.tournaments)) {
    // Skip ones that are over, even if their results haven't posted yet.
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

async function recent(interaction) {
  const choice = readPlayerOption(interaction);
  if (!choice) return replyNotTracked(interaction);

  await interaction.deferReply();
  const players = choice === 'all' ? Object.values(state.players) : [choice];
  // For everyone, a few each so one busy player doesn't crowd out the rest.
  const perPlayer = choice === 'all' ? 3 : 5;

  const sets = await startgg.getSets(players.map((player) => player.playerId), { perPage: perPlayer });

  // Capped at two messages so a long tracked list doesn't flood the channel.
  const latest = sets
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, 20);
  if (!latest.length) return interaction.editReply('No sets found.');

  const cards = latest.map((set) => embeds.setResult(set, state.players));
  // Grouped by player, newest first within each. A set between two tracked players goes under its winner, like the card.
  if (choice === 'all') cards.sort((a, b) => (a.data.author?.name ?? '').localeCompare(b.data.author?.name ?? ''));

  await sendEmbeds(interaction, cards);
}

// Histories are kept a few minutes, so a burst of h2h or predict lookups for the same player only fetches once.
// The promise is stored, not the sets, so two lookups at the same moment share one fetch too.
const histories = new Map();

function setHistory(playerId) {
  const cached = histories.get(playerId);
  if (cached && Date.now() - cached.at < HISTORY_CACHE_MINUTES * 60 * 1000) return cached.sets;

  const sets = fetchHistory(playerId);
  histories.set(playerId, { at: Date.now(), sets });
  // A failed fetch shouldn't stick around for the next person.
  sets.catch(() => histories.delete(playerId));
  return sets;
}

async function fetchHistory(playerId) {
  const sets = [];
  for (let page = 1; page <= H2H_PAGES; page++) {
    const batch = await startgg.getSetHistory(playerId, page);
    if (!batch.length) break;
    sets.push(...batch);
  }
  return sets;
}

async function headToHead(interaction) {
  const a = readPlayerOption(interaction);
  const b = readPlayerOption(interaction, 'opponent');
  if (!a || !b || a === 'all' || b === 'all') return replyNotTracked(interaction);
  if (a === b) return interaction.reply({ content: 'Pick two different players.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  // start.gg can't search for sets between two players, so go through one player's history.
  const sets = await setHistory(a.playerId);

  // Singles only, and DQs don't count.
  const solo = (side, player) => side.playerIds.length === 1 && side.playerIds[0] === player.playerId;
  const played = sets.filter(({ sides: [x, y] }) => {
    const meetUp = (solo(x, a) && solo(y, b)) || (solo(x, b) && solo(y, a));
    return meetUp && x.score !== -1 && y.score !== -1;
  });
  played.sort((x, y) => y.completedAt - x.completedAt);

  await interaction.editReply({ embeds: [embeds.headToHead(a, b, played)] });
}

async function stats(interaction) {
  const player = readPlayerOption(interaction);
  if (!player || player === 'all') return replyNotTracked(interaction);

  await interaction.deferReply();
  const { standings, sets } = await startgg.getStats(player.playerId);
  await interaction.editReply({ embeds: [embeds.stats(player, standings, sets)] });
}

async function predict(interaction) {
  const a = readPlayerOption(interaction);
  const b = readPlayerOption(interaction, 'opponent');
  if (!a || !b || a === 'all' || b === 'all') return replyNotTracked(interaction);
  if (a === b) return interaction.reply({ content: 'Pick two different players.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  const [historyA, historyB] = await Promise.all([setHistory(a.playerId), setHistory(b.playerId)]);
  const odds = predictOdds(a, b, historyA, historyB);
  if (!odds) return interaction.editReply(`${a.tag} and ${b.tag} haven't played singles in the same game on start.gg.`);

  await interaction.editReply({ embeds: [embeds.prediction(a, b, odds)] });
}

function streamAlerts(interaction) {
  const choice = readPlayerOption(interaction);
  if (!choice) return replyNotTracked(interaction);

  const on = interaction.options.getString('alerts', true) === 'on';
  const players = choice === 'all' ? Object.values(state.players) : [choice];
  for (const player of players) player.streamAlerts = on;
  save();

  const who = choice === 'all' ? 'everyone' : choice.tag;
  return interaction.reply(`Stream alerts ${on ? 'on' : 'off'} for ${who}.`);
}

async function sm4sh(interaction) {
  if (!smash4.enabled) return interaction.reply(smash4.LINE);

  await interaction.deferReply();
  try {
    const { text, screenshot, image } = await smash4.takePost();
    await interaction.editReply({ embeds: [embeds.sm4sh(smash4.LINE, text, screenshot, image.name)], files: [image] });
  } catch (err) {
    // Claude is down or out of credits, or SmashWiki is down. Say it anyway.
    console.error('sm4sh failed:', err.message);
    await interaction.editReply(smash4.LINE);
  }
}
