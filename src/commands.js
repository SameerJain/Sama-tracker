import { hostname } from 'node:os';
import { ApplicationCommandOptionType as Option, MessageFlags, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import * as startgg from './startgg.js';
import * as embeds from './embeds.js';
import { state, save } from './store.js';
import { REG_REMINDER_HOURS, RUNS_LATE_HOURS, checkRegReminders, checkTournaments, endTime, health, nextRegReminder, regDeadline, secondsNow } from './tracker.js';
import sm4sh from './sm4sh.js';
import melee from './melee.js';
import ult from './ult.js';
import smash64 from './smash64.js';
import brawl from './brawl.js';
import pplus from './pplus.js';
import { predict as predictOdds } from './predict.js';
import { characterUsage } from './characters.js';
import { periodSummary } from './reports.js';
import { MESSAGE_TYPES, WEEKDAYS, messageSettings } from './message-settings.js';
import { findAccount, rememberAccounts } from './accounts.js';

const HISTORY_PAGES = 15; // 40 sets a page
// 3000 sets, about a minute the first time for someone who's played that many
const LIFETIME_PAGES = 75;
// 1200 sets, years for most people. /scout verbose also has every event, so this keeps it near a minute
const SCOUT_PAGES = 30;
// also 40 a page, so 400 sets, 800 for /scout verbose, or 1600 for /characters verbose. the other games are usually further back
const CHARACTER_PAGES = 10;
const SCOUT_CHARACTER_PAGES = 20;
const LIFETIME_CHARACTER_PAGES = 40;
const HISTORY_CACHE_MINUTES = 10;
// after that only their newest page gets fetched, and everything again this often to pick up edits to old sets
const HISTORY_REFRESH_HOURS = 6;
// pages of each kind of history kept, whoever was looked up longest ago goes first. a lifetime one is
// ~5MB for someone with 2500 sets, so this is about 25 players' usual history and 5 lifetimes
const HISTORY_CACHE_PAGES = 25 * HISTORY_PAGES + 5 * LIFETIME_PAGES;
const CHARACTER_CACHE_PAGES = 25 * CHARACTER_PAGES + 5 * LIFETIME_CHARACTER_PAGES;
// /recent all only asks start.gg about whoever played most recently
const RECENT_ALL_PLAYERS = 40;
// /characters verbose, so the cards fit in one message
const CHARACTER_GAMES = 6;
// /characters game choices. left out, it goes with whichever has more reported
const PICKABLE_GAMES = [{ id: startgg.ULTIMATE, displayName: 'Ultimate' }, { id: startgg.MELEE, displayName: 'Melee' }];
// /progress compares the last two of these, verbose lists this many as a trend
const PROGRESS_DAYS = 30;
const TREND_PERIODS = 6;
// a slow lookup's reply says how far along start.gg is once there's at least this long left.
// the first check waits for the first pages, since those say how many more there are
const WAIT_SHOWN_SECONDS = 20;
const WAIT_FIRST_SECONDS = 5;
const WAIT_UPDATE_SECONDS = 15;
// /bracket shows a tournament this long before it starts
const BRACKET_MINUTES_BEFORE = 30;
// remove autocompletes with the link as the value, which discord caps at 100
const SOCIAL_URL_LENGTH = 100;
// discord takes this many ids a request when checking who's in the server
const MEMBERS_PER_FETCH = 100;

const jokes = Object.fromEntries([sm4sh, melee, ult, smash64, brawl, pplus].map((joke) => [joke.name, joke]));

// shows who has reg pings on
const REG_ROLE = 'Reg Reminders';

// an optional one that's left out means whoever ran the command
function playerOption(description, name = 'player', required = true) {
  return { type: Option.String, name, description, required, autocomplete: true };
}

const YOU = 'Tracked player, leave out for yourself';
const YOU_OR_ALL = 'Tracked player or all, leave out for yourself';

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
    name: 'link',
    description: 'Link your start.gg so leaving the player out of a command looks you up',
    options: [{ type: Option.String, name: 'profile', description: 'Your start.gg profile link or ID', required: true }],
  },
  { name: 'unlink', description: 'Unlink the start.gg you linked with /link' },
  {
    name: 'profile',
    description: 'Someone\'s start.gg profile, if their start.gg has their Discord connected',
    options: [{ type: Option.User, name: 'user', description: 'Server member, leave out for yourself' }],
  },
  { name: 'upcoming', description: 'Upcoming tournaments', options: [playerOption(YOU_OR_ALL, 'player', false)] },
  { name: 'recent', description: 'Latest reported sets', options: [playerOption(YOU_OR_ALL, 'player', false)] },
  { name: 'run', description: 'Current tournament run and next opponent', options: [playerOption(YOU, 'player', false)] },
  {
    name: 'progress',
    description: 'Last 30 days compared with the previous 30, by game',
    options: [playerOption(YOU, 'player', false), verboseOption('Games, close sets, seeds, upsets, rematches and characters, plus a 6 month trend. Slower')],
  },
  {
    name: 'scout', description: 'Scout any start.gg opponent, for tracked players with Discord connected on start.gg',
    options: [
      { type: Option.String, name: 'profile', description: 'Opponent start.gg profile link or ID', required: true },
      verboseOption('Their whole history, habits, matchups, stages and your odds against them. Slower'),
    ],
  },
  // discord wants required options before optional ones, so the opponent goes first
  {
    name: 'h2h',
    description: 'Head-to-head record against another player',
    options: [
      playerOption('Tracked player to compare with', 'opponent'), playerOption(YOU, 'player', false),
      verboseOption('Every set they\'ve played, plus splits and streaks. Slower'),
      { type: Option.Boolean, name: 'melee', description: 'Only count Melee sets' },
    ],
  },
  {
    name: 'stats',
    description: 'Recent placements and set record',
    options: [playerOption(YOU, 'player', false), verboseOption('Full lifetime report, slower')],
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
    options: [playerOption('Tracked player to go up against', 'opponent'), playerOption(YOU, 'player', false), verboseOption('Show how each part of the prediction counts')],
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
  { name: 'status', description: 'Uptime and the last start.gg checks' },
  {
    name: 'set_reg_reminder',
    description: 'Ping people with reg pings on as a tournament\'s registration deadline gets close',
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
  ...Object.values(jokes).map((joke) => ({ name: joke.name, description: joke.line })),
  { name: 'pfp', description: 'My profile picture, full size' },
];

// "track add", or just the command for the ones without subcommands
function commandName(interaction) {
  const subcommand = interaction.options.getSubcommand(false);
  return subcommand ? `${interaction.commandName} ${subcommand}` : interaction.commandName;
}

export async function handleCommand(interaction) {
  const name = commandName(interaction);

  switch (name) {
    case 'help':
      return interaction.reply({ embeds: [embeds.help()] });
    case 'messages':
      return configureMessages(interaction);
    case 'socials':
      return sendEmbeds(interaction, embeds.socials(state.socials));
    case 'socials_edit add':
      return socialsAdd(interaction);
    case 'socials_edit remove':
      return socialsRemove(interaction);
    case 'track add':
      return trackAdd(interaction);
    case 'track remove':
      return trackRemove(interaction);
    case 'track list':
      return sendEmbeds(interaction, embeds.trackedList(state.players));
    case 'link':
      return link(interaction);
    case 'unlink':
      return unlink(interaction);
    case 'profile':
      return profile(interaction);
    case 'upcoming':
      return upcoming(interaction);
    case 'recent':
      return recent(interaction);
    case 'run':
      return run(interaction);
    case 'progress':
      return progress(interaction);
    case 'scout':
      return scout(interaction);
    case 'h2h':
      return headToHead(interaction);
    case 'stats':
      return stats(interaction);
    case 'characters':
      return characters(interaction);
    case 'predict':
      return predict(interaction);
    case 'stream':
      return streamAlerts(interaction);
    case 'status':
      return status(interaction);
    case 'set_reg_reminder':
      return setRegReminder(interaction);
    case 'delete_reg_reminder':
      return deleteRegReminder(interaction);
    case 'reg_admin add':
      return regAdminAdd(interaction);
    case 'reg_admin remove':
      return regAdminRemove(interaction);
    case 'reg_admin list':
      return interaction.reply({ embeds: [embeds.regAdmins(state.regAdmins)] });
    case 'bracket':
      return bracket(interaction);
    case 'reg_role':
      return regRole(interaction);
    case 'registered':
      return registered(interaction);
    case 'reg_warn':
      return regWarn(interaction);
    case 'sm4sh':
    case 'melee':
    case 'ult':
    case '64':
    case 'brawl':
    case 'pplus':
      return tell(interaction, jokes[name]);
    case 'pfp':
      return pfp(interaction);
  }
}

export async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const typed = focused.toLowerCase();
  const name = commandName(interaction);
  const choices = [];

  if (name === 'delete_reg_reminder') {
    for (const reminder of Object.values(state.regReminders)) {
      if (reminder.name.toLowerCase().includes(typed)) choices.push({ name: reminder.name.slice(0, 100), value: String(reminder.id) });
    }
    return interaction.respond(choices.slice(0, 25));
  }

  if (name === 'reg_admin remove') {
    for (const admin of Object.values(state.regAdmins)) {
      if (admin.tag.toLowerCase().includes(typed)) choices.push({ name: admin.tag, value: String(admin.userId) });
    }
    return interaction.respond(choices.slice(0, 25));
  }

  if (name === 'socials_edit remove') {
    for (const social of state.socials) {
      const label = `${social.name} · ${social.url.replace(/^https?:\/\//, '')}`;
      if (label.toLowerCase().includes(typed)) choices.push({ name: label.slice(0, 100), value: social.url });
    }
    return interaction.respond(choices.slice(0, 25));
  }

  // no "all" for the ones that need a single player
  if (!['track remove', 'h2h', 'stats', 'characters', 'predict', 'run', 'progress'].includes(name) && 'all'.startsWith(typed)) {
    choices.push({ name: 'all', value: 'all' });
  }
  // only 25 fit, so tags that start with what's typed go first
  const matches = Object.values(state.players).filter((player) => player.tag.toLowerCase().includes(typed));
  const starts = (player) => player.tag.toLowerCase().startsWith(typed);
  matches.sort((a, b) => starts(b) - starts(a));
  for (const player of matches) choices.push({ name: player.tag, value: String(player.userId) });

  // an empty list looks broken, so say why. picking it gets the not tracked reply
  if (!choices.length) {
    const why = Object.keys(state.players).length ? `Nobody tracked matches "${focused}", /track add them first` : 'Nobody is tracked yet, /track add someone first';
    choices.push({ name: why.slice(0, 100), value: focused.slice(0, 100) || 'nobody' });
  }

  await interaction.respond(choices.slice(0, 25));
}

// a tracked player picked from the list, 'all', or whoever ran it if it's left out.
// undefined when it's none of those
function readChoice(interaction, name = 'player') {
  const value = interaction.options.getString(name)?.toLowerCase();
  if (value === undefined) return linkedPlayer(interaction.user.id);
  if (value === 'all') return 'all';

  return lookup(state.players, value, 'tag');
}

// from /link, or the tracked player whose start.gg has this discord connected
function linkedPlayer(discordId) {
  const linked = state.links[discordId];
  if (linked) return state.players[linked.userId] ?? linked;
  return Object.values(state.players).find((player) => player.discordId === discordId);
}

// autocomplete sends the id, typing it out sends the name.
// hasOwn so typing "constructor" doesn't match Object.prototype
function lookup(records, value, name) {
  if (Object.hasOwn(records, value)) return records[value];
  return Object.values(records).find((record) => record[name].toLowerCase() === value);
}

function readPlayer(interaction, name = 'player') {
  const choice = readChoice(interaction, name);
  return choice === 'all' ? undefined : choice;
}

// whatever doesn't fit in the reply goes in follow-ups, which are only ephemeral when asked
async function sendEmbeds(interaction, list) {
  for (const [i, batch] of embeds.messages(list).entries()) {
    if (i > 0) await interaction.followUp({ embeds: batch, ...(interaction.ephemeral && { flags: MessageFlags.Ephemeral }) });
    // null clears a countdown from withCountdown
    else if (interaction.deferred) await interaction.editReply({ content: null, embeds: batch });
    else await interaction.reply({ embeds: batch });
  }
}

// about 40 seconds, about 3 minutes
function roughly(seconds) {
  return seconds < 90 ? `${Math.ceil(seconds / 10) * 10} seconds` : `${Math.round(seconds / 60)} minutes`;
}

// awaits work, which is already running. while start.gg has a lot left for this command, the reply says how
// far along it is, above preview if there's a quick answer to show in the meantime. an edit already going out
// finishes first, so it can't land after the answer and replace it
async function withCountdown(interaction, doing, work, preview) {
  const progress = startgg.commandProgress();
  let edit = Promise.resolve();
  let timer;
  let previewed = false;
  const update = () => {
    const { sent, waiting, seconds } = progress();
    // with a preview there's something to look at, so it goes up for any wait
    if (!waiting || seconds < (preview ? 0 : WAIT_SHOWN_SECONDS)) return;
    const content = `**${doing}** · ${sent} of ${sent + waiting} start.gg requests done, about ${roughly(seconds)} left\n`
      + '-# start.gg allows 80 requests a minute, so the first look takes a while. Asking again in the next few hours is quick';
    const payload = preview && !previewed ? { content, embeds: embeds.messages(preview)[0] } : content;
    previewed ||= Boolean(preview);
    edit = edit.then(() => interaction.editReply(payload)).catch(() => {});
  };
  const check = (seconds) => {
    timer = setTimeout(() => {
      update();
      check(WAIT_UPDATE_SECONDS);
    }, seconds * 1000);
  };
  // a preview goes up once the pages it waits on are queued, which is right away
  check(preview ? 0 : WAIT_FIRST_SECONDS);
  try {
    return await work;
  } finally {
    clearTimeout(timer);
    await edit;
  }
}

// left out with no start.gg linked, or someone picked who isn't tracked
function replyNoPlayer(interaction, name = 'player') {
  const content = interaction.options.getString(name) === null
    ? 'Pick a player, or `/link` your start.gg so leaving it out looks you up.'
    : 'Only tracked players can be picked. `/track add` them first, `/track list` shows who\'s tracked.';
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function configureMessages(interaction) {
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return reply('You need Manage Server permission to control automatic messages.');
  const previous = messageSettings();
  const changes = {};
  for (const type of Object.keys(MESSAGE_TYPES)) {
    const value = interaction.options.getBoolean(type);
    if (value !== null) changes[type] = value;
  }
  const day = interaction.options.getInteger('recap_day');
  if (day !== null) changes.recapDay = day;
  const time = interaction.options.getString('recap_time')?.trim();
  if (time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return reply('Use a 24-hour time in HH:MM format, like 09:00 or 21:30.');
    changes.recapTime = time;
  }
  const timezone = interaction.options.getString('timezone')?.trim();
  if (timezone !== undefined) {
    try {
      changes.timezone = new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
    } catch {
      return reply('Unknown timezone. Use one like America/New_York, America/Los_Angeles, Europe/London or UTC.');
    }
  }

  if (Object.keys(changes).length) {
    const now = secondsNow();
    // anything that came due while one was off stays skipped once it's back on
    const reenabled = Object.keys(MESSAGE_TYPES).filter((type) => changes[type] && !previous[type]);
    if (reenabled.length) changes.enabledAt = { ...previous.enabledAt, ...Object.fromEntries(reenabled.map((type) => [type, now])) };
    // a new schedule starts with the next recap
    if (['recapDay', 'recapTime', 'timezone'].some((key) => Object.hasOwn(changes, key) && changes[key] !== previous[key])) {
      changes.recapChangedAt = now;
    }
    state.messages = { ...state.messages, ...changes };
    save();
  }
  const settings = messageSettings();
  const lines = Object.entries(MESSAGE_TYPES).map(([key, label]) => `${label}: ${settings[key] ? 'on' : 'off'}`);
  lines.push('', `Recap schedule: ${WEEKDAYS[settings.recapDay]} ${settings.recapTime} (${settings.timezone})`,
    'Whatever comes due while something is off gets skipped, not sent later. Schedule changes start with the next recap.');
  return reply(lines.join('\n'));
}

// twitch.tv/name works without the https. null for anything that isn't a web link
function socialUrl(input) {
  const text = input.trim();
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  // "hello" parses as https://hello/, and twitch.tv@evil.example goes to evil.example
  if (!url.hostname.includes('.') || url.username || url.password) return null;
  // a ) would end the [Twitch](link) early
  return url.href.replaceAll('(', '%28').replaceAll(')', '%29');
}

// ephemeral so edits don't clutter the channel and a name can't ping anyone
function socialsAdd(interaction) {
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  const typed = interaction.options.getString('name', true).trim();
  const url = socialUrl(interaction.options.getString('link', true));
  if (!url) return reply('That isn\'t a web link. Paste the profile, channel or page link.');
  if (url.length > SOCIAL_URL_LENGTH) return reply(`Links can be up to ${SOCIAL_URL_LENGTH} characters.`);

  const listed = state.socials.find((social) => social.url === url);
  if (listed) return reply(`That link is already in \`/socials\` under ${listed.name}.`);

  // "716 esports" goes on the same line as "716 Esports", spelled like the first one
  const name = state.socials.find((social) => social.name.toLowerCase() === typed.toLowerCase())?.name ?? typed;
  state.socials.push({ name, url });
  save();
  return reply(`Added ${url} under ${name}.`);
}

function socialsRemove(interaction) {
  // autocomplete sends the saved link, typing it out might leave off the https
  const url = socialUrl(interaction.options.getString('link', true));
  const social = state.socials.find((each) => each.url === url);
  if (!social) return interaction.reply({ content: 'That link isn\'t in `/socials`. Pick one from the list.', flags: MessageFlags.Ephemeral });

  state.socials = state.socials.filter((each) => each !== social);
  save();
  return interaction.reply({ content: `Removed ${social.url} from ${social.name}.`, flags: MessageFlags.Ephemeral });
}

// start.gg/user/f64a83c8 or just f64a83c8
function profileSlug(input) {
  return input.match(/user\/([\w-]+)/)?.[1] ?? input;
}

async function trackAdd(interaction) {
  const input = interaction.options.getString('profile', true).trim();

  await interaction.deferReply();
  const player = await startgg.getPlayer(profileSlug(input));
  if (!player) {
    return interaction.editReply(`Couldn't find a start.gg player for \`${input}\`. Use their profile link, like start.gg/user/f64a83c8.`);
  }
  if (state.players[player.userId]) {
    return interaction.editReply(`Already tracking ${player.tag}.`);
  }

  state.players[player.userId] = { ...player, lastCheck: secondsNow(), streamAlerts: true };
  save();
  await interaction.editReply({ embeds: [embeds.added(player)] });

  // don't wait 15 min for their tournaments to show up
  checkTournaments();
}

async function trackRemove(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  delete state.players[player.userId];
  save();
  await interaction.reply(`Stopped tracking ${player.tag}.`);
}

// only lets commands default to them, they don't get tracked.
// their start.gg has to have this discord connected so nobody can link as someone else
async function link(interaction) {
  // commands already find them, a link would change nothing
  const tracked = Object.values(state.players).find((player) => player.discordId === interaction.user.id);
  if (tracked) return interaction.reply({ content: noLinkNeeded(tracked), flags: MessageFlags.Ephemeral });

  const input = interaction.options.getString('profile', true).trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const player = await startgg.getPlayer(profileSlug(input));
  if (!player) {
    return interaction.editReply(`Couldn't find a start.gg player for \`${input}\`. Use your profile link, like start.gg/user/f64a83c8.`);
  }
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
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

// goes by the discord connected on start.gg, so nobody can claim someone else's
async function profile(interaction) {
  const picked = interaction.options.getUser('user');
  const user = picked ?? interaction.user;
  const member = picked ? interaction.options.getMember('user') : interaction.member;
  if (!member) return interaction.reply({ content: 'Pick someone in this server.', flags: MessageFlags.Ephemeral });
  if (user.bot) return interaction.reply({ content: 'Bots don\'t have start.gg accounts.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  const account = await findAccount(user.id);
  if (account) return interaction.editReply({ embeds: [embeds.profile(account, { name: member.displayName, avatar: member.displayAvatarURL() })] });
  if (user.id === interaction.user.id) {
    return interaction.editReply('Couldn\'t find a start.gg with your Discord connected. Connect it on your start.gg profile if you haven\'t, then `/link` it.');
  }
  // their name and not a mention, so nobody gets pinged. a name can spell out a role mention, so mentions are off too
  return interaction.editReply({
    content: `Couldn't find a start.gg with ${escapeMarkdown(member.displayName)}'s Discord connected.\n-# start.gg can't be searched by Discord, so this only finds tracked players, people who used \`/link\` and people registered for tournaments the bot has checked`,
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

async function progress(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const verbose = interaction.options.getBoolean('verbose') ?? false;
  const now = secondsNow();
  const span = PROGRESS_DAYS * 24 * 60 * 60;
  // newest first, the first two get compared
  const periods = Array.from({ length: verbose ? TREND_PERIODS : 2 }, (_, i) => ({ since: now - (i + 1) * span, until: now - i * span }));
  const [sets, events, characterSets] = await withCountdown(interaction, `Going through ${escapeMarkdown(player.tag)}'s sets`, Promise.all([
    startgg.getPeriodHistory(player.playerId, periods.at(-1).since, now),
    startgg.getEventHistory(player.userId),
    // the rest still says plenty without characters, so start.gg failing here doesn't sink it
    verbose ? characterHistory(player.playerId).catch(() => null) : null,
  ]));
  for (const period of periods) period.summary = periodSummary(player, sets, events, period.since, period.until);
  return sendEmbeds(interaction, embeds.progress(player, periods, { verbose, characterSets }));
}

async function scout(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const player = await trackedCaller(interaction.user.id);
  if (!player) return interaction.editReply('Only tracked players can use /scout. Connect your Discord on your tracked start.gg profile first.');

  const input = interaction.options.getString('profile', true).trim();
  const opponent = await startgg.getPlayer(profileSlug(input));
  if (!opponent) return interaction.editReply('Couldn\'t find that start.gg player. Use their profile link or ID.');
  if (player.playerId === opponent.playerId) return interaction.editReply('Use an opponent\'s profile, not your own.');

  const [mine, theirs, characters] = await withCountdown(interaction, `Scouting ${escapeMarkdown(opponent.tag)}`, Promise.all([
    setHistory(player.playerId), setHistory(opponent.playerId), characterHistory(opponent.playerId),
  ]));
  const quick = embeds.scout(player, opponent, mine, theirs, characters);
  if (!interaction.options.getBoolean('verbose')) return sendEmbeds(interaction, quick);

  // more of them on top of the same pages, so the quick one shows while it loads. yours is only for
  // meeting them and the odds, so the usual amount is plenty
  const [deeper, characterSets, events] = await withCountdown(interaction, 'Full report on its way', Promise.all([
    setHistories(opponent.playerId, SCOUT_PAGES), characterHistories(opponent.playerId, SCOUT_CHARACTER_PAGES), startgg.getEventHistory(opponent.userId),
  ]), quick);
  const odds = predictOdds(player, opponent, mine, deeper);
  return sendEmbeds(interaction, embeds.scoutReport(player, opponent, { mine, theirs: deeper, characterSets, events, odds, players: state.players }));
}

// the tracked player with this discord connected on start.gg. checked live, so disconnecting it there
// takes /scout away right away. whoever it was last time goes first, so it's usually one lookup
async function trackedCaller(discordId) {
  const saved = Object.values(state.players).filter((player) => player.discordId === discordId).map((player) => String(player.userId));
  for (const userIds of [saved, Object.keys(state.players)]) {
    if (!userIds.length) continue;
    const match = (await startgg.getProfiles(userIds)).find(([, profile]) => profile?.discordId === discordId);
    if (match) return state.players[match[0]];
  }
}

// a player's history of one kind, newest first, shared by every command that reads it. each asks for so many
// pages: a deeper copy already here gets cut down to that, and a shallower one gets the rest added on, so
// /scout verbose after /scout doesn't fetch the first pages twice. the promise is what's kept, so two lookups
// at once share a fetch. keep is how many pages to hold, whoever was looked up longest ago goes first
function historyCache(getPage, keep) {
  const players = new Map();

  // resolves to { sets, ends, totalPages }, ends being how many sets the first 1, 2, 3... pages came to
  function lookup(playerId, pages) {
    const now = Date.now();
    const cached = players.get(playerId);
    const fresh = !cached || now - cached.fullAt > HISTORY_REFRESH_HOURS * 60 * 60 * 1000;
    const stale = !fresh && now - cached.at > HISTORY_CACHE_MINUTES * 60 * 1000;
    let base = fresh ? fetchPages(getPage, playerId, pages) : cached.known;
    // if start.gg errors it keeps what it had
    if (stale) base = base.then((history) => topUp(getPage, playerId, history).catch(() => history));
    const known = base.then((history) => (history.ends.length < Math.min(pages, history.totalPages) ? extend(getPage, playerId, history, pages) : history));

    const entry = { at: fresh || stale ? now : cached.at, fullAt: fresh ? now : cached.fullAt, pages: Math.max(pages, fresh ? 0 : cached.pages), known };
    // more pages failing keeps the copy it was adding to, as long as that one came back fine
    known.catch(() => base.then(() => !fresh, () => false).then((keepCached) => {
      if (players.get(playerId) !== entry) return;
      if (keepCached) players.set(playerId, cached);
      else players.delete(playerId);
    }));
    // map order is least recently looked up first
    players.delete(playerId);
    players.set(playerId, entry);
    let total = [...players.values()].reduce((sum, each) => sum + each.pages, 0);
    for (const [id, each] of players) {
      if (total <= keep || id === playerId) break;
      players.delete(id);
      total -= each.pages;
    }
    return known;
  }

  const history = (playerId, pages) => lookup(playerId, pages).then(({ sets, ends }) => sets.slice(0, ends[Math.min(pages, ends.length) - 1] ?? 0));
  // from their first page, which every lookup starts with anyway
  history.totalPages = (playerId) => lookup(playerId, 1).then(({ totalPages }) => totalPages);
  return history;
}

// the first page says how many there are, then the rest get asked for all at once.
// the rate limit spaces them out, so nothing sits waiting on a slow page
async function fetchPages(getPage, playerId, pages) {
  const first = await getPage(playerId, 1);
  return extend(getPage, playerId, { sets: first.sets, ends: [first.sets.length], totalPages: first.totalPages }, pages);
}

// the pages after the ones it has. sets played since push everything down a little, so the first of these
// can repeat a few it has already, which get skipped
async function extend(getPage, playerId, history, pages) {
  const next = [];
  for (let page = history.ends.length + 1; page <= Math.min(pages, history.totalPages); page++) next.push(getPage(playerId, page));
  const sets = [...history.sets];
  const ids = new Set(sets.map((set) => set.id));
  const ends = [...history.ends];
  let { totalPages } = history;
  for (const page of await Promise.all(next)) {
    for (const set of page.sets) {
      if (ids.has(set.id)) continue;
      ids.add(set.id);
      sets.push(set);
    }
    ends.push(sets.length);
    totalPages = Math.max(totalPages, page.totalPages);
  }
  return { sets, ends, totalPages };
}

// their newest page on top of what's cached. none of it being cached means more than a page is new,
// so everything it had gets fetched again
async function topUp(getPage, playerId, history) {
  const first = await getPage(playerId, 1);
  const ids = new Set(history.sets.map((set) => set.id));
  const added = first.sets.filter((set) => !ids.has(set.id));
  if (added.length && added.length === first.sets.length) return fetchPages(getPage, playerId, history.ends.length);
  return { sets: [...added, ...history.sets], ends: history.ends.map((end) => end + added.length), totalPages: first.totalPages };
}

const setHistories = historyCache(startgg.getSetHistory, HISTORY_CACHE_PAGES);
const characterHistories = historyCache(startgg.getCharacterSets, CHARACTER_CACHE_PAGES);
const setHistory = (playerId) => setHistories(playerId, HISTORY_PAGES);
const characterHistory = (playerId) => characterHistories(playerId, CHARACTER_PAGES);
const lifetimeHistory = (playerId) => setHistories(playerId, LIFETIME_PAGES);
const lifetimeCharacterHistory = (playerId) => characterHistories(playerId, LIFETIME_CHARACTER_PAGES);

// every set between two players is in both their histories, so one is enough when it fits in pages: the one
// with fewer sets. past that it takes both, since either can get cut off before older sets
async function meetingPlayers(a, b, pages) {
  const [pagesA, pagesB] = await Promise.all([setHistories.totalPages(a.playerId), setHistories.totalPages(b.playerId)]);
  if (Math.min(pagesA, pagesB) > pages) return [a, b];
  return [pagesA <= pagesB ? a : b];
}

const historiesOf = (players, pages) => Promise.all(players.map((player) => setHistories(player.playerId, pages)));

// their singles sets against each other, newest first, DQs left out
function meetings(a, b, histories) {
  const played = new Map();
  for (const set of histories.flat()) {
    const result = startgg.fromSide(set, a.playerId);
    if (result?.them.playerIds.includes(b.playerId) && !result.dq) played.set(set.id, set);
  }
  return [...played.values()].sort((x, y) => y.completedAt - x.completedAt);
}

async function headToHead(interaction) {
  const b = readPlayer(interaction, 'opponent');
  if (!b) return replyNoPlayer(interaction, 'opponent');
  const a = readPlayer(interaction);
  if (!a) return replyNoPlayer(interaction);
  if (a.userId === b.userId) return interaction.reply({ content: 'Pick two different players.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  const verbose = interaction.options.getBoolean('verbose') ?? false;
  // the histories have every game, so this costs no extra requests
  const melee = interaction.options.getBoolean('melee') ?? false;
  const cards = (sets, full) => {
    const shown = melee ? sets.filter((set) => set.event.videogame?.id === startgg.MELEE) : sets;
    return embeds.headToHead(a, b, shown, { verbose: full, melee, otherGames: sets.length - shown.length });
  };
  // start.gg can't search sets between two players, so it goes through their histories
  const readers = await meetingPlayers(a, b, verbose ? LIFETIME_PAGES : HISTORY_PAGES);
  const doing = `Going through ${escapeMarkdown(a.tag)} and ${escapeMarkdown(b.tag)}'s sets`;
  const recent = meetings(a, b, await withCountdown(interaction, doing, historiesOf(readers, HISTORY_PAGES)));
  if (!verbose) return sendEmbeds(interaction, cards(recent, false));
  // every set is the same pages and more, so the latest show while it loads
  const all = meetings(a, b, await withCountdown(interaction, 'Every set on its way', historiesOf(readers, LIFETIME_PAGES), cards(recent, false)));
  return sendEmbeds(interaction, cards(all, true));
}

async function stats(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const { standings, sets } = await startgg.getStats(player.playerId);
  const recent = embeds.stats(player, standings, sets);
  if (!interaction.options.getBoolean('verbose')) return interaction.editReply({ embeds: [recent] });
  // one request for the recent card means there's something to look at while the lifetime one loads
  const [events, history] = await withCountdown(interaction, 'Lifetime report on its way',
    Promise.all([startgg.getEventHistory(player.userId), lifetimeHistory(player.playerId)]), [recent]);
  return sendEmbeds(interaction, embeds.lifetimeStats(player, events, history, state.players));
}

async function characters(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const verbose = interaction.options.getBoolean('verbose');
  const picked = interaction.options.getInteger('game');
  let sets = await withCountdown(interaction, `Going through ${escapeMarkdown(player.tag)}'s reported characters`, characterHistory(player.playerId));
  if (verbose) {
    // every game is the same pages and more, so the usual card shows while it loads
    const usual = characterCards(sets, false, picked).cards
      .map(({ game, usage }) => embeds.characters(player, usage, { game: game?.displayName, searched: sets.length }));
    sets = await withCountdown(interaction, 'Every game on its way', lifetimeCharacterHistory(player.playerId), usual);
  }
  const { cards, note } = characterCards(sets, verbose, picked);

  // no picture beats no reply
  const art = await Promise.all(cards.map(({ game, usage }) => (game && usage.characters.length
    ? startgg.getCharacterArt(usage.characters[0].name, game.id).catch(() => null)
    : null)));
  await interaction.editReply({
    // clears a countdown
    content: null,
    embeds: cards.map(({ game, usage }, i) => embeds.characters(player, usage, {
      game: game?.displayName, file: art[i]?.name, note: i === cards.length - 1 ? note : undefined, searched: sets.length,
    })),
    files: art.filter(Boolean),
  });
}

// a card for the picked game, or whichever has more reported. verbose adds one for each other game with
// characters reported, and a note naming the ones without
function characterCards(sets, verbose, picked) {
  const usageIn = (game) => ({ game, usage: characterUsage(sets.filter((set) => set.videogame.id === game.id)) });
  const mostGames = (a, b) => b.usage.games - a.usage.games;

  // left out, it's the one with more reported games, then more sets. a tie goes to ultimate
  const pickable = PICKABLE_GAMES.map(usageIn);
  const top = pickable.find(({ game }) => game.id === picked) ?? pickable.reduce((a, b) => ((mostGames(a, b) || b.usage.scanned - a.usage.scanned) > 0 ? b : a));
  if (!verbose) return { cards: [top] };

  const games = [...new Map(sets.map((set) => [set.videogame.id, set.videogame])).values()].map(usageIn);
  // picked goes first even with nothing reported, since it's what they asked about
  const first = picked || top.usage.reported ? [top] : [];
  // then a card for each other game with characters reported, most games first
  const rest = games.filter(({ game, usage }) => game.id !== top.game.id && usage.reported).sort(mostGames);
  const cards = [...first, ...rest].slice(0, CHARACTER_GAMES);
  if (!cards.length) return { cards: [{ usage: characterUsage(sets) }] };
  // so it's clear the rest got looked at too
  const unreported = games.filter(({ game, usage }) => !usage.reported && !cards.some((card) => card.game.id === game.id))
    .sort((a, b) => b.usage.scanned - a.usage.scanned).map(({ game }) => game.displayName);
  const shown = unreported.length > 4 ? [...unreported.slice(0, 3), `${unreported.length - 3} other games`] : unreported;
  return { cards, note: shown.length ? `No characters reported for ${new Intl.ListFormat('en').format(shown)}` : undefined };
}

// verbose explains the same odds instead of changing them
async function predict(interaction) {
  const b = readPlayer(interaction, 'opponent');
  if (!b) return replyNoPlayer(interaction, 'opponent');
  const a = readPlayer(interaction);
  if (!a) return replyNoPlayer(interaction);
  if (a.userId === b.userId) return interaction.reply({ content: 'Pick two different players.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  const [historyA, historyB] = await withCountdown(interaction, `Going through ${escapeMarkdown(a.tag)} and ${escapeMarkdown(b.tag)}'s sets`,
    Promise.all([setHistory(a.playerId), setHistory(b.playerId)]));
  const odds = predictOdds(a, b, historyA, historyB);
  if (!odds) return interaction.editReply(`${a.tag} and ${b.tag} haven't played singles in the same game on start.gg.`);

  await sendEmbeds(interaction, embeds.prediction(a, b, odds, interaction.options.getBoolean('verbose') ?? false));
}

function streamAlerts(interaction) {
  const choice = readChoice(interaction);
  if (!choice) return replyNoPlayer(interaction);
  // someone from /link, their streams never get posted
  if (choice !== 'all' && !state.players[choice.userId]) {
    return interaction.reply({ content: 'You aren\'t tracked, so there are no stream alerts to change.', flags: MessageFlags.Ephemeral });
  }

  const on = interaction.options.getString('alerts', true) === 'on';
  const players = choice === 'all' ? Object.values(state.players) : [choice];
  for (const player of players) player.streamAlerts = on;
  save();

  const who = choice === 'all' ? 'everyone' : choice.tag;
  return interaction.reply(`Stream alerts ${on ? 'on' : 'off'} for ${who}.`);
}

function status(interaction) {
  const tournaments = Object.values(state.tournaments).filter((tournament) => !tournament.resultsPosted && tournament.entries.length);
  const info = {
    ...health,
    // the hostname there is a random container id
    host: process.env.RAILWAY_ENVIRONMENT_NAME ? 'Railway' : hostname(),
    avatar: interaction.client.user.displayAvatarURL(),
    players: Object.keys(state.players).length,
    tournaments: tournaments.length,
    queued: startgg.queueLength(),
  };
  return interaction.reply({ embeds: [embeds.status(info)], flags: MessageFlags.Ephemeral });
}

// start.gg/tournament/genesis-x/details, a short link like start.gg/genesis, or just the slug
function tournamentSlug(input) {
  const path = input.replace(/^(https?:\/\/)?(www\.)?(start|smash)\.gg\//, '');
  return path.match(/tournament\/([\w-]+)/)?.[1] ?? path.split(/[/?#]/)[0];
}

function tournamentNotFound(input) {
  return `Couldn't find a start.gg tournament for \`${input}\`. Paste its link, like start.gg/tournament/genesis-x.`;
}

async function setRegReminder(interaction) {
  const input = interaction.options.getString('tournament', true).trim();

  await interaction.deferReply();
  const tournament = await startgg.getRegistration(tournamentSlug(input));
  if (!tournament) return interaction.editReply(tournamentNotFound(input));

  if (state.regReminders[tournament.id]) {
    return interaction.editReply(`${tournament.name} already has reminders set. \`/delete_reg_reminder\` cancels them.`);
  }

  const deadline = regDeadline(tournament);
  const next = nextRegReminder(deadline);
  const firstAt = deadline - REG_REMINDER_HOURS[next] * 60 * 60;
  // further out it might just not be open yet
  if (deadline <= secondsNow() || (firstAt <= secondsNow() && !tournament.isRegistrationOpen)) {
    return interaction.editReply(`Registration for ${tournament.name} is closed.`);
  }

  state.regReminders[tournament.id] = { id: tournament.id, slug: tournament.slug, name: tournament.name, deadline, next };
  save();
  // inside the last call window it goes out now
  checkRegReminders();

  if (firstAt <= secondsNow()) {
    return interaction.editReply(`Registration for ${tournament.name} ends <t:${deadline}:R>, sending the last call now.`);
  }
  const duration = (hours) => (hours % 24 ? `${hours} hours` : `${hours / 24} day${hours === 24 ? '' : 's'}`);
  const when = new Intl.ListFormat('en').format(REG_REMINDER_HOURS.slice(next).map(duration));
  return interaction.editReply(`Everyone with reg pings on gets pinged ${when} before registration for ${tournament.name} ends, starting <t:${firstAt}:R>. \`/reg_role\` to turn yours on.`);
}

function deleteRegReminder(interaction) {
  const value = interaction.options.getString('tournament', true).toLowerCase();
  const reminder = lookup(state.regReminders, value, 'name');
  if (!reminder) return interaction.reply({ content: 'No reminder set for that.', flags: MessageFlags.Ephemeral });

  delete state.regReminders[reminder.id];
  // so a reg admin's doesn't get added back
  state.regSkipped = [...state.regSkipped, reminder.id].slice(-200);
  save();
  return interaction.reply(`Deleted the reminder for ${reminder.name}.`);
}

async function regAdminAdd(interaction) {
  const input = interaction.options.getString('profile', true).trim();

  await interaction.deferReply();
  const admin = await startgg.getPlayer(profileSlug(input));
  if (!admin) {
    return interaction.editReply(`Couldn't find a start.gg user for \`${input}\`. Use their profile link, like start.gg/user/f64a83c8.`);
  }
  if (state.regAdmins[admin.userId]) {
    return interaction.editReply(`${admin.tag} is already a reg admin.`);
  }

  state.regAdmins[admin.userId] = { userId: admin.userId, slug: admin.slug, tag: admin.tag };
  save();
  await interaction.editReply(`Tournaments ${admin.tag} is an admin of on start.gg get reg reminders now. \`/delete_reg_reminder\` skips one.`);

  // don't wait 15 min for theirs to show up
  checkRegReminders();
}

function regAdminRemove(interaction) {
  const admin = lookup(state.regAdmins, interaction.options.getString('admin', true).toLowerCase(), 'tag');
  if (!admin) return interaction.reply({ content: 'That\'s not a reg admin. See `/reg_admin list`.', flags: MessageFlags.Ephemeral });

  delete state.regAdmins[admin.userId];
  save();
  return interaction.reply(`No more automatic reminders for ${admin.tag}'s tournaments. Ones already set stay, \`/delete_reg_reminder\` cancels them.`);
}

// reg reminder tournaments only, they're the ones the server cares about
function bracket(interaction) {
  const now = secondsNow();
  const live = Object.values(state.regReminders)
    .filter((reminder) => now >= reminder.startAt - BRACKET_MINUTES_BEFORE * 60 && now <= endTime(reminder) + RUNS_LATE_HOURS * 60 * 60)
    .sort((a, b) => a.startAt - b.startAt);
  if (!live.length) {
    return interaction.reply('No tournaments set as active. Check the other channels if you\'re expecting one.');
  }
  return sendEmbeds(interaction, live.flatMap((reminder) => embeds.bracket(reminder)));
}

// only ever changes the person who ran it. pings go off this list, not the role,
// so people already registered can be left out
async function regRole(interaction) {
  const on = interaction.options.getString('ping', true) === 'on';
  const { guild, member, user } = interaction;

  state.regPings = state.regPings.filter((id) => id !== user.id);
  if (on) state.regPings.push(user.id);
  save();

  let content = on
    ? 'You\'ll get pinged for reg reminders. If your Discord is connected on start.gg, not for ones you\'re already registered for.'
    : 'No more reg reminder pings.';
  // making the role or handing it out can take discord past the 3 seconds a command gets to answer
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    let role = guild.roles.cache.find((each) => each.name === REG_ROLE);
    if (on) {
      role ??= await guild.roles.create({ name: REG_ROLE, reason: 'shows who has /reg_role on' });
      await member.roles.add(role);
    } else if (role) {
      await member.roles.remove(role);
    }
  } catch (err) {
    // missing permissions. the pings still work without the role
    if (err.code !== 50013) throw err;
    content += ` I couldn't change your ${REG_ROLE} role though, that needs Manage Roles and my role above it.`;
  }
  return interaction.editReply(content);
}

// the ones of these discord ids that are in the server, id to member. asking by id doesn't need
// the server members intent. discord can say to slow down, then it gets one more try after waiting
async function serverMembers(guild, ids) {
  const found = new Map();
  for (let i = 0; i < ids.length; i += MEMBERS_PER_FETCH) {
    const user = ids.slice(i, i + MEMBERS_PER_FETCH);
    const members = await guild.members.fetch({ user }).catch(async (err) => {
      if (!err.data?.retry_after) throw err;
      await new Promise((resolve) => setTimeout(resolve, err.data.retry_after * 1000));
      return guild.members.fetch({ user });
    });
    for (const [id, member] of members) found.set(id, member);
  }
  return found;
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
    return interaction.editReply(`start.gg hides who's registered for ${escapeMarkdown(found.name)}, so there's no list to show.`);
  }
  const linked = participants.filter((participant) => participant.discordId);
  const members = await serverMembers(interaction.guild, [...new Set(linked.map((participant) => participant.discordId))]);
  // their name in this server goes on the card instead of a mention
  const here = linked
    .filter((participant) => members.has(participant.discordId))
    .map((participant) => ({ ...participant, name: members.get(participant.discordId).displayName }));
  // for the events each of them is in
  const tournament = await startgg.getTournament(found.id, here.map((participant) => participant.userId));
  const byEvent = interaction.options.getBoolean('by_event') ?? false;
  return sendEmbeds(interaction, embeds.registered(tournament ?? found, here, { byEvent }));
}

// goes by the discord connected on start.gg, and only pings when they're not registered
async function regWarn(interaction) {
  const input = interaction.options.getString('tournament', true).trim();
  const user = interaction.options.getUser('user', true);
  if (user.bot) return interaction.reply({ content: 'Bots don\'t need to register.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  const tournament = await startgg.getRegistration(tournamentSlug(input));
  if (!tournament) return interaction.editReply(tournamentNotFound(input));

  const participants = await startgg.getParticipants(tournament.id);
  rememberAccounts(participants);
  if (participants.some((participant) => participant.discordId === user.id)) {
    const name = interaction.options.getMember('user')?.displayName ?? user.displayName;
    return interaction.editReply(`Already registered.\n-# ${escapeMarkdown(name)} · ${escapeMarkdown(tournament.name)}`);
  }
  const deadline = regDeadline(tournament);
  if (deadline <= secondsNow()) return interaction.editReply(`Registration for ${tournament.name} already closed.`);
  if (!tournament.isRegistrationOpen) return interaction.editReply(`Registration for ${tournament.name} isn't open right now.`);
  // not on a hidden list means nothing, so no warning
  if (startgg.attendeesHidden(tournament, participants)) {
    return interaction.editReply(`start.gg hides who's registered for ${escapeMarkdown(tournament.name)}, so there's no telling if they are. No warning sent.`);
  }

  // editing the reply wouldn't ping them, and a follow-up shows "Original message was deleted"
  // once the thinking reply is gone, so the warning goes in the channel as its own message
  const warning = {
    content: `<@${user.id}>`,
    embeds: [embeds.regWarning(tournament, deadline)],
    allowedMentions: { users: [user.id] },
  };
  const sent = await interaction.channel?.send(warning).catch(() => null);
  await interaction.deleteReply();
  // can't post in that channel, a follow-up still pings them
  if (!sent) return interaction.followUp(warning);
}

// just the picture, as big as discord has it
async function pfp(interaction) {
  const url = interaction.client.user.displayAvatarURL({ extension: 'png', size: 4096 });
  await interaction.deferReply();
  await interaction.editReply({ files: [{ attachment: url, name: `pfp.${new URL(url).pathname.split('.').pop()}` }] });
}

async function tell(interaction, joke) {
  if (!joke.enabled) return interaction.reply(joke.line);

  await interaction.deferReply();
  try {
    const post = await joke.takePost();
    await interaction.editReply({ embeds: [embeds.joke(joke.name, joke.line, post)], files: [post.image] });
  } catch (err) {
    // claude or smashwiki is down, just say it
    console.error(`${joke.name} failed:`, err.message);
    await interaction.editReply(joke.line);
  }
}
