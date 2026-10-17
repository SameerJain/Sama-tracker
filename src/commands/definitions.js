import { ApplicationCommandOptionType as Option, PermissionFlagsBits } from 'discord.js';
import * as startgg from '../startgg.js';
import { MESSAGE_TYPES, WEEKDAYS } from '../message-settings.js';
import { funCommands } from '../fun/index.js';

// /characters game choices. left out, it goes with whichever has more reported
const PICKABLE_GAMES = [{ id: startgg.ULTIMATE, displayName: 'Ultimate' }, { id: startgg.MELEE, displayName: 'Melee' }];

// an optional one that's left out means whoever ran the command
function playerOption(description, name = 'player', required = true) {
  return { type: Option.String, name, description, required, autocomplete: true };
}

const YOU = 'Tracked or linked player, leave out for yourself';
const YOU_OR_ALL = 'Tracked or linked player, or all for everyone tracked. Leave out for yourself';
// /h2h and /predict also take a start.gg profile link or ID, so neither player has to be tracked or linked
const MATCHUP = 'Tracked or linked player to compare with, or a start.gg profile link or ID';
const MATCHUP_YOU = 'Tracked or linked player, or a start.gg profile link or ID. Leave out for yourself';

function verboseOption(description) {
  return { type: Option.Boolean, name: 'verbose', description };
}

export const commands = [
  { name: 'help', description: 'Show commands' },
  {
    name: 'messages', description: 'Show or change automatic posts and the weekly recap schedule',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      ...Object.entries(MESSAGE_TYPES).map(([name, label]) => ({ type: Option.Boolean, name, description: `${label} on or off` })),
      { type: Option.Integer, name: 'recap_day', description: 'Day of the weekly recap', choices: WEEKDAYS.map((name, value) => ({ name, value })) },
      { type: Option.String, name: 'recap_time', description: 'Weekly recap time in 24-hour HH:MM, like 21:00' },
      { type: Option.String, name: 'timezone', description: 'Recap timezone, like America/New_York or Europe/London' },
    ],
  },
  // two commands since one with subcommands can't be run on its own, and permissions are per command
  { name: 'socials', description: 'Streams and social links saved for this server' },
  {
    name: 'socials_edit',
    description: 'Add or remove links shown by /socials',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        type: Option.Subcommand,
        name: 'add',
        description: 'Add a link to /socials',
        options: [
          { type: Option.String, name: 'name', description: 'Whose link it is, like 716 Esports. Links with the same name share a line', required: true, max_length: 50 },
          { type: Option.String, name: 'link', description: 'Profile, channel or page link', required: true },
        ],
      },
      {
        type: Option.Subcommand,
        name: 'remove',
        description: 'Remove a link from /socials',
        options: [{ type: Option.String, name: 'link', description: 'Link to remove', required: true, autocomplete: true }],
      },
    ],
  },
  {
    name: 'track',
    description: 'Players whose sets, streams and placements get posted here',
    options: [
      {
        type: Option.Subcommand,
        name: 'add',
        description: 'Post a start.gg player\'s sets, streams and placements here',
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
    name: 'link',
    description: 'Link your own start.gg so commands know who you are. Unlike /track, nothing gets posted',
    options: [{ type: Option.String, name: 'profile', description: 'Your start.gg profile link or ID. It needs your Discord connected', required: true }],
  },
  { name: 'unlink', description: 'Undo /link. Doesn\'t change whether you\'re tracked' },
  {
    name: 'profile',
    description: 'Someone\'s start.gg profile, once the bot has seen their account',
    options: [
      { type: Option.User, name: 'user', description: 'Server member, leave out for yourself' },
      playerOption('Tracked or linked player, instead of a server member', 'player', false),
    ],
  },
  { name: 'upcoming', description: 'Upcoming tournaments', options: [playerOption(YOU_OR_ALL, 'player', false)] },
  { name: 'recent', description: 'Latest reported sets', options: [playerOption(YOU_OR_ALL, 'player', false)] },
  { name: 'run', description: 'Current tournament run and next opponent', options: [playerOption(YOU, 'player', false)] },
  {
    name: 'progress',
    description: 'Last 30 days compared with the previous 30, by game',
    options: [
      playerOption(YOU, 'player', false),
      verboseOption('Streaks, close sets, seeds, upsets, rematches and characters, plus a 6 month trend. Slower'),
      { type: Option.Boolean, name: 'melee', description: 'Only count Melee sets, placements and characters' },
    ],
  },
  {
    name: 'scout', description: 'Scout any start.gg opponent. Needs you tracked or linked, with Discord connected on start.gg',
    options: [
      { type: Option.String, name: 'profile', description: 'Tracked or linked opponent, or a start.gg profile link or ID', required: true, autocomplete: true },
      verboseOption('More history, habits, toughest opponents and worst matchups, stages and your odds. Slower'),
      { type: Option.Boolean, name: 'melee', description: 'Only look at their Melee sets, characters and your Melee odds' },
    ],
  },
  // discord wants required options before optional ones, so the opponent goes first
  {
    name: 'h2h',
    description: 'Head-to-head record with one-line predicted odds',
    options: [
      playerOption(MATCHUP, 'opponent'), playerOption(MATCHUP_YOU, 'player', false),
      verboseOption('Every set, splits and streaks. Odds stay one line. Slower'),
      { type: Option.Boolean, name: 'melee', description: 'Only count Melee sets and Melee odds' },
    ],
  },
  {
    name: 'stats',
    description: 'Recent placements and set record',
    options: [
      playerOption(YOU, 'player', false), verboseOption('Full lifetime report, slower'),
      { type: Option.Boolean, name: 'melee', description: 'Only count Melee sets and placements' },
    ],
  },
  {
    name: 'characters',
    description: 'Characters a player has reported in Ultimate or Melee',
    options: [
      playerOption(YOU, 'player', false),
      {
        type: Option.Integer, name: 'game', description: 'Ultimate or Melee, leave out for whichever has more reported',
        choices: PICKABLE_GAMES.map((game) => ({ name: game.displayName, value: game.id })),
      },
      verboseOption('Every other game they have characters reported in too, going further back. Slower'),
    ],
  },
  {
    name: 'predict',
    description: 'Odds of beating another player',
    options: [
      playerOption(MATCHUP, 'opponent'), playerOption(MATCHUP_YOU, 'player', false),
      verboseOption('Show how each part of the prediction counts'),
      { type: Option.Boolean, name: 'melee', description: 'Melee odds even when they play something else more' },
    ],
  },
  {
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
  {
    name: 'sets',
    description: 'Turn automatic set results on or off for a player',
    options: [
      playerOption('Tracked player, or all'),
      {
        type: Option.String,
        name: 'results',
        description: 'on or off',
        required: true,
        choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }],
      },
    ],
  },
  { name: 'status', description: 'Uptime and the last start.gg checks' },
  {
    name: 'set_reg_reminder',
    description: 'Set a registration reminder and track everyone registered',
    options: [{ type: Option.String, name: 'tournament', description: 'start.gg tournament link', required: true }],
  },
  {
    name: 'delete_reg_reminder',
    description: 'Cancel a registration reminder',
    options: [{ type: Option.String, name: 'tournament', description: 'Tournament with a reminder', required: true, autocomplete: true }],
  },
  {
    name: 'reg_admin',
    description: 'TOs whose tournaments get reg reminders automatically',
    options: [
      {
        type: Option.Subcommand,
        name: 'add',
        description: 'Set reminders for every tournament a start.gg user is an admin of',
        options: [{ type: Option.String, name: 'profile', description: 'start.gg profile link or ID', required: true }],
      },
      {
        type: Option.Subcommand,
        name: 'remove',
        description: 'Stop setting reminders for their tournaments',
        options: [{ type: Option.String, name: 'admin', description: 'Reg admin', required: true, autocomplete: true }],
      },
      { type: Option.Subcommand, name: 'list', description: 'List reg admins' },
    ],
  },
  { name: 'bracket', description: 'Bracket links for reg reminder tournaments that are live or start within 30 min' },
  {
    name: 'reg_role',
    description: 'Reg reminder pings for yourself, on or off',
    options: [{
      type: Option.String,
      name: 'ping',
      description: 'on or off',
      required: true,
      choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }],
    }],
  },
  {
    name: 'registered',
    description: 'Who in this server is registered for a tournament, going by the Discord on their start.gg',
    options: [
      { type: Option.String, name: 'tournament', description: 'start.gg tournament link', required: true },
      { type: Option.Boolean, name: 'by_event', description: 'Each event with who\'s in it, instead of each person with their events' },
    ],
  },
  {
    name: 'reg_warn',
    description: 'Warn someone who isn\'t registered for a tournament yet. No ping if they are',
    options: [
      { type: Option.String, name: 'tournament', description: 'start.gg tournament link', required: true },
      { type: Option.User, name: 'user', description: 'Who to check', required: true },
    ],
  },
  ...Object.values(funCommands).map((fun) => ({ name: fun.name, description: fun.line })),
  { name: 'view_pfp', description: 'My profile picture, full size' },
];

export { PICKABLE_GAMES };
