import { ApplicationCommandOptionType as Option, ApplicationCommandType, ChannelType, InteractionContextType, PermissionFlagsBits } from 'discord.js';
import * as startgg from '../startgg.js';
import { MESSAGE_TYPES, THREAD_MODES, WEEKDAYS } from '../message-settings.js';
import { isMultiGuild } from '../store.js';
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
const KNOWN_TOURNAMENT = 'start.gg tournament link, or pick one that\'s tracked or has tracked players in it';
const UPCOMING_TOURNAMENT = 'start.gg tournament link, or pick an upcoming one tracked players are in';
const TRACKED_TOURNAMENT = 'Tracked tournament';

const ON_OFF = [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }];

// an on or off switch. left out means leave it as it is
function switchOption(name, description) {
  return { type: Option.String, name, description, choices: ON_OFF };
}

// long-press a member, then Apps. these names are what the menu shows, so they can have capitals and spaces
const MEMBER_H2H = 'H2H with me';
const MEMBER_SCOUT = 'Scout them';

// a role per game that people give themselves and anyone can ping, keyed by the game option's value.
// role is the name it gets made with
const MATCHMAKING = {
  ult: { label: 'Ultimate', role: 'Ultimate Matchmaking' },
  melee: { label: 'Melee', role: 'Melee Matchmaking' },
};

function matchmakingGame(description) {
  return {
    type: Option.String, name: 'game', description, required: true,
    choices: Object.entries(MATCHMAKING).map(([value, { label }]) => ({ name: label, value })),
  };
}

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

const commands = [
  {
    name: 'help', description: 'Short command list, verbose:True for the full one with details',
    options: [verboseOption('Every command with the details, instead of the short list')],
  },
  {
    name: 'messages', description: 'Show or change posts, threads, event length, colors and the recap',
    options: [
      ...Object.entries(MESSAGE_TYPES).map(([name, label]) => ({ type: Option.Boolean, name, description: `${label} on or off` })),
      { type: Option.Boolean, name: 'set_colors', description: 'Color set result cards green win, red loss, gold crew vs crew, blue otherwise' },
      {
        type: Option.String, name: 'threads', description: 'Where set results and stream alerts go: the channel, a thread per tournament or per event',
        choices: Object.entries(THREAD_MODES).map(([value, name]) => ({ name, value })),
      },
      { type: Option.Integer, name: 'event_length', description: 'Discord event hours when start.gg has no end time, 2 to 12', min_value: 2, max_value: 12 },
      { type: Option.Integer, name: 'recap_day', description: 'Day of the weekly recap', choices: WEEKDAYS.map((name, value) => ({ name, value })) },
      { type: Option.String, name: 'recap_time', description: 'Weekly recap time in 24-hour HH:MM, like 21:00' },
      { type: Option.String, name: 'timezone', description: 'Recap timezone, like America/New_York or Europe/London' },
    ],
  },
  { name: 'data', description: 'Samatracker and both series data pages' },
  // multi-server only: single-server builds post in CHANNEL_ID, so there's nothing to pick. no
  // default_member_permissions, like /messages, since discord would hide it from TOs without Manage Server
  ...(isMultiGuild() ? [{
    name: 'setup', description: 'Show or set the channel automatic posts go in for this server',
    options: [
      {
        type: Option.Channel, name: 'channel', description: 'Channel for set results, roll calls, reminders and recaps',
        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      },
    ],
  }] : []),
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
    description: 'Players whose placements get posted here, plus their sets and streams with /track posts',
    options: [
      {
        type: Option.Subcommand,
        name: 'add',
        description: 'Post your start.gg placements here. TOs can add anyone. /track posts turns on sets and streams',
        options: [{ type: Option.String, name: 'profile', description: 'start.gg profile link or ID. Leave out to find yours. Someone else needs a TO' }],
      },
      {
        type: Option.Subcommand,
        name: 'remove',
        description: 'Stop tracking yourself, or anyone if you\'re a TO. Asks first, then Undo puts them back',
        options: [playerOption('Tracked player, leave out for yourself. Someone else needs a TO', 'player', false)],
      },
      { type: Option.Subcommand, name: 'list', description: 'List tracked players and tournaments' },
      {
        type: Option.Subcommand,
        name: 'posts',
        description: 'Your set results and stream alerts on or off, or anyone\'s if you\'re a TO. Leave both out to see',
        options: [
          playerOption('Tracked player or all, leave out for yourself. Changing someone else\'s needs a TO', 'player', false),
          switchOption('sets', 'Their finished sets. Asks first unless already off for everyone'),
          switchOption('stream', 'Their sets on stream or up next in the stream queue'),
        ],
      },
    ],
  },
  {
    name: 't-o',
    description: 'TO tools for roles, tournament tracking and track-list cleanup',
    options: [
      {
        type: Option.SubcommandGroup,
        name: 'role',
        description: 'TO role members',
        options: [
          {
            type: Option.Subcommand,
            name: 'add',
            description: 'Give someone the TO role. TOs only',
            options: [{ type: Option.User, name: 'user', description: 'Server member', required: true }],
          },
          {
            type: Option.Subcommand,
            name: 'set',
            description: 'Use an existing server role as the TO role. Needs Manage Server',
            options: [{ type: Option.Role, name: 'role', description: 'Existing role to use for TO privileges', required: true }],
          },
          {
            type: Option.Subcommand,
            name: 'remove',
            description: 'Take the TO role off someone, or yourself. TOs only',
            options: [{ type: Option.User, name: 'user', description: 'A TO', required: true }],
          },
          { type: Option.Subcommand, name: 'list', description: 'Who the TOs are' },
        ],
      },
      {
        type: Option.SubcommandGroup,
        name: 'tournament',
        description: 'TO tournament tools',
        options: [
          {
            type: Option.Subcommand,
            name: 'add',
            description: 'Track every set, stream alert, results and top 8, plus registration reminders',
            options: [
              { type: Option.String, name: 'tournament', description: UPCOMING_TOURNAMENT, required: true, autocomplete: true },
              switchOption('reminders', 'Reg reminders for people with /notify registration on. On unless you turn them off'),
              { type: Option.String, name: 'schedule', description: 'Custom reminder times, like 7d,3d,1d,6h. Leave out for the usual four' },
              switchOption('add_event', 'Also make a Discord event from it. Off unless you turn it on'),
            ],
          },
          {
            type: Option.Subcommand,
            name: 'remove',
            description: 'Stop tracking a tournament. Asks first, then Undo puts it back for a minute',
            options: [{ type: Option.String, name: 'tournament', description: TRACKED_TOURNAMENT, required: true, autocomplete: true }],
          },
          {
            type: Option.Subcommand,
            name: 'posts',
            description: 'What a tracked tournament posts, on or off. Leave them all out to see them',
            options: [
              { type: Option.String, name: 'tournament', description: TRACKED_TOURNAMENT, required: true, autocomplete: true },
              switchOption('sets', 'Every finished set, whoever played'),
              switchOption('stream', 'Every set on stream or up next in the stream queue'),
              switchOption('calls', 'Every called set, whoever played, even with no pings on'),
              switchOption('top8', 'Each event\'s top 8 once the bracket is finished'),
              switchOption('reminders', 'Reg reminders for people with /notify registration on'),
              { type: Option.String, name: 'schedule', description: 'Custom reminder times, like 7d,3d,1d,6h. default goes back to the usual four' },
            ],
          },
          {
            type: Option.Subcommand,
            name: 'event',
            description: 'Make a Discord event without tracking it. Time, end time, cover and streams from start.gg',
            options: [{ type: Option.String, name: 'tournament', description: KNOWN_TOURNAMENT, required: true, autocomplete: true }],
          },
        ],
      },
      {
        type: Option.Subcommand,
        name: 'cleanup',
        description: 'Untrack players whose start.gg Discord isn\'t in this server. Asks first. TOs only',
        options: [{ type: Option.Boolean, name: 'no_discord', description: 'Also untrack players with no Discord connected on start.gg' }],
      },
    ],
  },
  {
    name: 'notify',
    description: 'Your pings for match calls, streams, reg reminders and 1-hour DMs. TOs can set anyone\'s',
    options: [
      { type: Option.User, name: 'user', description: 'Server member. Leave out for yourself. Someone else needs a TO' },
      playerOption('Tracked player or all, leave out for yourself. Someone else needs a TO', 'player', false),
      switchOption('calls', 'Your match getting called. Needs you linked, or tracked with Discord on start.gg'),
      switchOption('streams', 'When your set is on stream. Needs you linked, or tracked with Discord on start.gg'),
      switchOption('registration', 'Reg Reminders role and its pings for tracked tournaments'),
      switchOption('dm_registration', 'DM 1 hour before registration closes, with link, location and image'),
      switchOption('dm_start', 'DM 1 hour before the tournament starts, with link, location and image'),
      switchOption('all', 'All five at once'),
    ],
  },
  // not under /notify: these are roles people ping each other with, not posts the bot sends
  {
    name: 'matchmaking_role',
    description: 'Get the Ultimate or Melee role for a while, or take it off if you have it',
    options: [
      matchmakingGame('Which role'),
      { type: Option.Number, name: 'duration', description: 'Hours to keep it, like 2 or 0.5 for 30 minutes. Leave out to keep it until you take it off', min_value: 0.5, max_value: 24 },
    ],
  },
  {
    name: 'matchmaking_search',
    description: 'Ping Ultimate or Melee Matchmaking to find games. Only people with that role can',
    options: [
      matchmakingGame('Which role to ping'),
      { type: Option.String, name: 'message', description: 'What you want, like netplay with your connect code or where you\'re playing', max_length: 300 },
      { type: Option.Boolean, name: 'thread', description: 'Start a thread on your search to arrange games' },
    ],
  },
  {
    name: 'matchmaking_channel',
    description: 'Where Ultimate or Melee searches post. Anyone can look, TOs only to change',
    options: [
      matchmakingGame('Which searches'),
      {
        type: Option.Channel, name: 'channel', description: 'Channel for these searches. Leave out to see where they go',
        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      },
      { type: Option.Boolean, name: 'clear', description: 'Back to posting where the command runs' },
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
    name: 'predict_explained',
    description: 'Full breakdown of the odds, with shares, model numbers and bars',
    options: [
      playerOption(MATCHUP, 'opponent'), playerOption(MATCHUP_YOU, 'player', false),
      { type: Option.Boolean, name: 'melee', description: 'Melee odds even when they play something else more, plus Slippi ranks which count toward them' },
      sinceOption(), venueOption(),
    ],
  },
  {
    name: 'slippi',
    description: 'Slippi ranked: a watchlist with rank change and season wrap-up posts, rank cards and a leaderboard',
    options: [
      {
        type: Option.Subcommand,
        name: 'add',
        description: 'Add yourself to the watchlist, or anyone if you\'re a TO. Rank changes get posted here',
        options: [{ type: Option.String, name: 'code', description: 'Your connect code like ABCD#123, or leave out to find it on your start.gg', max_length: 60 }],
      },
      {
        type: Option.Subcommand,
        name: 'remove',
        description: 'Take yourself off the watchlist, or anyone if you\'re a TO',
        options: [{ type: Option.String, name: 'player', description: 'Player on the watchlist, leave out for yourself', autocomplete: true }],
      },
      {
        type: Option.Subcommand,
        name: 'rank',
        description: 'Rank, rating, record, characters and past seasons',
        options: [{ type: Option.String, name: 'player', description: 'Player on the watchlist or any connect code. Leave out for yourself if tracked or linked', autocomplete: true }],
      },
      { type: Option.Subcommand, name: 'leaderboard', description: 'Everyone on the watchlist, best rank first' },
    ],
  },
  { name: 'status', description: 'Uptime, when the latest version was deployed, and the last start.gg and Slippi checks' },
  { name: 'bracket', description: 'Bracket links for tracked tournaments, 30 min before start to 6 hours after the end' },
  { name: 'stream_link', description: 'Stream links for tournaments that are tracked or have tracked players, live or starting soon' },
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

// global commands also show in DMs with the bot, where the answer would be a DM to someone who might not be in
// any of its servers. single-server builds register to the one server, so theirs only ever show there
if (isMultiGuild()) {
  for (const command of commands) command.contexts = [InteractionContextType.Guild];
}

export { commands, PICKABLE_GAMES, MEMBER_H2H, MEMBER_SCOUT, MATCHMAKING };
