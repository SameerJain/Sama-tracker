import { ApplicationCommandOptionType as Option, MessageFlags } from 'discord.js';
import * as startgg from './startgg.js';
import * as embeds from './embeds.js';
import { state, save } from './store.js';
import { checkTournaments, secondsNow } from './tracker.js';

function playerOption(description) {
  return { type: Option.String, name: 'player', description, required: true, autocomplete: true };
}

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
    case 'stream':
      return streamAlerts(interaction);
  }
}

export async function handleAutocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const choices = [];

  if (interaction.options.getSubcommand() !== 'remove' && 'all'.startsWith(typed)) {
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
function readPlayerOption(interaction) {
  const value = interaction.options.getString('player', true).toLowerCase();
  if (value === 'all') return 'all';

  // Picking from the autocomplete list sends the user ID. Typing a name sends the name.
  if (state.players[value]) return state.players[value];
  return Object.values(state.players).find((player) => player.tag.toLowerCase() === value);
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

  state.players[player.userId] = { ...player, lastCheck: secondsNow() };
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

  const tournaments = [];
  for (const tournament of Object.values(state.tournaments)) {
    if (tournament.resultsPosted) continue;

    const entries = tournament.entries.filter((entry) => {
      if (!state.players[entry.userId]) return false;
      return choice === 'all' || entry.userId === choice.userId;
    });
    if (entries.length) tournaments.push({ ...tournament, entries });
  }
  tournaments.sort((a, b) => a.startAt - b.startAt);

  const who = choice === 'all' ? 'everyone' : choice.tag;
  return interaction.reply({ embeds: embeds.upcoming(tournaments, state.players, who) });
}

async function recent(interaction) {
  const choice = readPlayerOption(interaction);
  if (!choice) return replyNotTracked(interaction);

  await interaction.deferReply();
  const players = choice === 'all' ? Object.values(state.players) : [choice];
  const perPlayer = choice === 'all' ? 2 : 5;

  // Two tracked players can share a set, so key by ID to drop duplicates.
  const setsById = new Map();
  for (const player of players) {
    for (const set of await startgg.getSets(player.playerId, { perPage: perPlayer })) {
      setsById.set(set.id, set);
    }
  }

  const latest = [...setsById.values()]
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, 5);
  if (!latest.length) return interaction.editReply('No sets found.');

  await interaction.editReply({ embeds: latest.map((set) => embeds.setResult(set, state.players)) });
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
