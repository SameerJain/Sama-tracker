import { ApplicationCommandOptionType as Option, ApplicationCommandType, PermissionFlagsBits } from 'discord.js';
import * as startgg from '../startgg.js';
import { MESSAGE_TYPES, THREAD_MODES, WEEKDAYS } from '../message-settings.js';
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

// picking one saves pasting a link, which is slow on a phone
const KNOWN_TOURNAMENT = 'start.gg tournament link, or pick one with a reminder or tracked players in it';
const UPCOMING_TOURNAMENT = 'start.gg tournament link, or pick an upcoming one tracked players are in';

// long-press a member, then Apps. these names are what the menu shows, so they can have capitals and spaces
const MEMBER_H2H = 'H2H with me';
const MEMBER_SCOUT = 'Scout them';

function verboseOption(description) {
  return { type: Option.Boolean, name: 'verbose', description };
}

// date and online filters for the singles reports. venue left out means both
function sinceOption() {
  return { type: Option.String, name: 'since', description: 'Only count sets since this date, like 2026-01-01' };
}

function venueOption() {
  return {
    type: Option.String, name: 'venue', description: 'Only offline or online tournaments, leave out for both',
    choices: [{ name: 'Offline only', value: 'offline' }, { name: 'Online only', value: 'online' }],
  };
}

export const commands = [
  { name: 'help', description: 'Show commands' },
  {
    name: 'messages', description: 'Show or change automatic posts, threads and the weekly recap schedule',
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      ...Object.entries(MESSAGE_TYPES).map(([name, label]) => ({ type: Option.Boolean, name, description: `${label} on or off` })),
      {
        type: Option.String, name: 'threads', description: 'Where set results and stream alerts go: the channel, a thread per tournament or per event',
        choices: Object.entries(THREAD_MODES).map(([value, name]) => ({ name, value })),
      },
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
    description: 'Players whose placements get posted here, plus more with /sets, /stream and /calls on',
    options: [
      {
        type: Option.Subcommand,
        name: 'add',
        description: 'Post a start.gg player\'s placements here. /sets, /stream and /calls turn on more posts',
        options: [{ type: Option.String, name: 'profile', description: 'start.gg profile link or ID', required: true }],
      },
      {
        type: Option.Subcommand,
        name: 'remove',
        description: 'Stop tracking a player. Asks first, then Undo puts them back for a minute',
        options: [playerOption('Tracked player')],
      },
      { type: Option.Subcommand, name: 'list', description: 'List tracked players' },
    ],
  },
  {
    name: 'link',
    description: 'Link your own start.gg so commands know who you are. Unlike /track, nothing gets posted',
    options: [{ type: Option.String, name: 'profile', description: 'Your start.gg profile link or ID. Leave out to find it by the Discord connected on start.gg' }],
  },
  { name: 'unlink', description: 'Remove your /link, with an Undo button for a minute. Doesn\'t change whether you\'re tracked' },
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
      { type: Option.Boolean, name: 'melee', description: 'Only count Melee sets, placements and characters, plus Slippi rank vs last season' },
    ],
  },
  {
    name: 'scout', description: 'Scout any start.gg opponent. Needs you tracked or linked, with Discord connected on start.gg',
    options: [
      { type: Option.String, name: 'profile', description: 'Tracked or linked opponent, or a start.gg profile link or ID', required: true, autocomplete: true },
      verboseOption('More history, habits, toughest opponents and worst matchups, stages and your odds. Slower'),
      { type: Option.Boolean, name: 'melee', description: 'Only look at their Melee sets, characters and Melee odds, plus Slippi ranks toward them' },
      sinceOption(), venueOption(),
    ],
  },
  // discord wants required options before optional ones, so the opponent goes first
  {
    name: 'h2h',
    description: 'Head-to-head record with one-line predicted odds',
    options: [
      playerOption(MATCHUP, 'opponent'), playerOption(MATCHUP_YOU, 'player', false),
      verboseOption('Every set, splits and streaks. Odds stay one line. Slower'),
      { type: Option.Boolean, name: 'melee', description: 'Only count Melee sets and Melee odds, plus Slippi ranks which count toward them' },
      sinceOption(), venueOption(),
    ],
  },
  {
    name: 'stats',
    description: 'Recent placements and set record',
    options: [
      playerOption(YOU, 'player', false), verboseOption('Full lifetime report, slower'),
      { type: Option.Boolean, name: 'melee', description: 'Only count Melee sets and placements, plus their Slippi rank' },
      sinceOption(), venueOption(),
    ],
  },
  {
    name: 'doubles',
    description: 'One player\'s 2v2 doubles: record, partners and placements',
    options: [
      playerOption(YOU, 'player', false),
      verboseOption('Up to 600 doubles sets: every partner, teams played, seeds and best finishes. Slower'),
      { type: Option.Boolean, name: 'melee', description: 'Only count Melee doubles sets and placements' },
    ],
  },
  {
    name: 'characters',
    description: 'Characters a player has reported in Ultimate or Melee',
    options: [
      playerOption(YOU, 'player', false),
      {
        type: Option.Integer, name: 'game', description: 'Ultimate or Melee, leave out for whichever has more reported. Melee adds Slippi ranked picks',
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
      { type: Option.Boolean, name: 'melee', description: 'Melee odds even when they play something else more, plus Slippi ranks which count toward them' },
      sinceOption(), venueOption(),
    ],
  },
  {
    name: 'stream',
    description: 'Turn on-stream alerts on or off. Newly tracked players start with them off',
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
    name: 'stream_pings',
    description: 'Get pinged for every stream alert, whoever is on stream. On or off, for yourself',
    options: [{
      type: Option.String,
      name: 'ping',
      description: 'on or off',
      required: true,
      choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }],
    }],
  },
  {
    name: 'sets',
    description: 'Turn automatic set results on or off. Newly tracked players start off. All off asks first',
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
  {
    name: 'calls',
    description: 'Turn match call pings on or off. Newly tracked players start with them off',
    options: [
      playerOption('Tracked player, or all'),
      {
        type: Option.String,
        name: 'pings',
        description: 'on or off',
        required: true,
        choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }],
      },
    ],
  },
  {
    name: 'slippi',
    description: 'Slippi ranked: a watchlist with rank change posts, rank cards and a leaderboard',
    options: [
      {
        type: Option.Subcommand,
        name: 'add',
        description: 'Add someone to the watchlist. Their rank changes get posted here',
        options: [{ type: Option.String, name: 'code', description: 'Connect code like ABCD#123. Leave out to find yours on your start.gg', max_length: 60 }],
      },
      {
        type: Option.Subcommand,
        name: 'remove',
        description: 'Take someone off the watchlist',
        options: [{ type: Option.String, name: 'player', description: 'Player on the watchlist', required: true, autocomplete: true }],
      },
      {
        type: Option.Subcommand,
        name: 'rank',
        description: 'Rank, rating, record, characters and past seasons',
        options: [{ type: Option.String, name: 'player', description: 'Player on the watchlist or any connect code. Leave out for yourself', autocomplete: true }],
      },
      { type: Option.Subcommand, name: 'leaderboard', description: 'Everyone on the watchlist, best rank first' },
    ],
  },
  { name: 'status', description: 'Uptime, when the latest version was deployed, and the last start.gg and Slippi checks' },
  {
    name: 'set_reg_reminder',
    description: 'Set a registration reminder and track everyone registered',
    options: [{ type: Option.String, name: 'tournament', description: UPCOMING_TOURNAMENT, required: true, autocomplete: true }],
  },
  {
    name: 'delete_reg_reminder',
    description: 'Cancel a registration reminder. Asks first',
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
  { name: 'stream_link', description: 'Stream links for tracked and reminder tournaments that are live or start within 30 min' },
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
      { type: Option.String, name: 'tournament', description: KNOWN_TOURNAMENT, required: true, autocomplete: true },
      { type: Option.Boolean, name: 'by_event', description: 'Each event with who\'s in it, instead of each person with their events' },
    ],
  },
  {
    name: 'reg_warn',
    description: 'Warn someone who isn\'t registered for a tournament yet. No ping if they are, or got one in 12h',
    options: [
      { type: Option.String, name: 'tournament', description: KNOWN_TOURNAMENT, required: true, autocomplete: true },
      { type: Option.User, name: 'user', description: 'Who to check', required: true },
    ],
  },
  ...Object.values(funCommands).map((fun) => ({ name: fun.name, description: fun.description ?? fun.line })),
  { name: 'view_pfp', description: 'My profile picture, full size' },
  // these don't count toward the 100, discord allows 5 more of them
  { type: ApplicationCommandType.User, name: MEMBER_H2H },
  { type: ApplicationCommandType.User, name: MEMBER_SCOUT },
];

export { PICKABLE_GAMES, MEMBER_H2H, MEMBER_SCOUT };
