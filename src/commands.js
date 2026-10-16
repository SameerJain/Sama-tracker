import { hostname } from 'node:os';
import { ApplicationCommandOptionType as Option, MessageFlags } from 'discord.js';
import * as startgg from './startgg.js';
import * as embeds from './embeds.js';
import { state, save } from './store.js';
import { REG_REMINDER_HOURS, checkRegReminders, checkTournaments, endTime, health, nextRegReminder, regDeadline, secondsNow } from './tracker.js';
import sm4sh from './sm4sh.js';
import melee from './melee.js';
import ult from './ult.js';
import smash64 from './smash64.js';
import brawl from './brawl.js';
import pplus from './pplus.js';
import { predict as predictOdds } from './predict.js';
import { characterUsage } from './characters.js';

const HISTORY_PAGES = 15; // 40 sets a page
// 3000 sets, about a minute the first time for someone who's played that many
const LIFETIME_PAGES = 75;
const PAGES_AT_ONCE = 5;
const HISTORY_CACHE_MINUTES = 10;
// /recent all only asks start.gg about whoever played most recently
const RECENT_ALL_PLAYERS = 40;

const jokes = Object.fromEntries([sm4sh, melee, ult, smash64, brawl, pplus].map((joke) => [joke.name, joke]));

// shows who has reg pings on
const REG_ROLE = 'Reg Reminders';

function playerOption(description, name = 'player') {
  return { type: Option.String, name, description, required: true, autocomplete: true };
}

export const commands = [
  { name: 'help', description: 'Show commands' },
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
    name: 'upcoming',
    description: 'Upcoming tournaments',
    options: [playerOption('Tracked player, or all')],
  },
  {
    name: 'recent',
    description: 'Latest reported sets',
    options: [playerOption('Tracked player, or all')],
  },
  {
    name: 'h2h',
    description: 'Head-to-head record between two tracked players',
    options: [playerOption('Tracked player'), playerOption('Tracked player', 'opponent')],
  },
  {
    name: 'stats',
    description: 'Recent placements and set record',
    options: [
      playerOption('Tracked player'),
      { type: Option.Boolean, name: 'verbose', description: 'Full lifetime report, slower' },
    ],
  },
  {
    name: 'characters',
    description: 'Ultimate characters a tracked player has reported',
    options: [playerOption('Tracked player')],
  },
  {
    name: 'predict',
    description: 'Odds of one tracked player beating another',
    options: [playerOption('Tracked player'), playerOption('Tracked player', 'opponent')],
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
    case 'track add':
      return trackAdd(interaction);
    case 'track remove':
      return trackRemove(interaction);
    case 'track list':
      return sendEmbeds(interaction, embeds.trackedList(state.players));
    case 'upcoming':
      return upcoming(interaction);
    case 'recent':
      return recent(interaction);
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
    case 'reg_role':
      return regRole(interaction);
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
  const typed = interaction.options.getFocused().toLowerCase();
  const name = commandName(interaction);
  const choices = [];

  if (name === 'delete_reg_reminder') {
    for (const reminder of Object.values(state.regReminders)) {
      if (reminder.name.toLowerCase().includes(typed)) choices.push({ name: reminder.name.slice(0, 100), value: String(reminder.id) });
    }
    return interaction.respond(choices.slice(0, 25));
  }

  // no "all" for the ones that need a single player
  if (!['track remove', 'h2h', 'stats', 'characters', 'predict'].includes(name) && 'all'.startsWith(typed)) {
    choices.push({ name: 'all', value: 'all' });
  }
  // only 25 fit, so tags that start with what's typed go first
  const matches = Object.values(state.players).filter((player) => player.tag.toLowerCase().includes(typed));
  const starts = (player) => player.tag.toLowerCase().startsWith(typed);
  matches.sort((a, b) => starts(b) - starts(a));
  for (const player of matches) choices.push({ name: player.tag, value: String(player.userId) });

  await interaction.respond(choices.slice(0, 25));
}

function readChoice(interaction, name = 'player') {
  const value = interaction.options.getString(name, true).toLowerCase();
  if (value === 'all') return 'all';

  // autocomplete sends the user id, typing it out sends the tag
  // hasOwn so typing "constructor" doesn't match Object.prototype
  if (Object.hasOwn(state.players, value)) return state.players[value];
  return Object.values(state.players).find((player) => player.tag.toLowerCase() === value);
}

function readPlayer(interaction, name = 'player') {
  const choice = readChoice(interaction, name);
  return choice === 'all' ? undefined : choice;
}

// whatever doesn't fit in the reply goes in follow-ups
async function sendEmbeds(interaction, list) {
  for (const [i, batch] of embeds.messages(list).entries()) {
    if (i > 0) await interaction.followUp({ embeds: batch });
    else if (interaction.deferred) await interaction.editReply({ embeds: batch });
    else await interaction.reply({ embeds: batch });
  }
}

function replyNotTracked(interaction) {
  return interaction.reply({
    content: 'That player isn\'t tracked. See `/track list`.',
    flags: MessageFlags.Ephemeral,
  });
}

async function trackAdd(interaction) {
  const input = interaction.options.getString('profile', true).trim();
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

  // don't wait 15 min for their tournaments to show up
  checkTournaments();
}

async function trackRemove(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNotTracked(interaction);

  delete state.players[player.userId];
  save();
  await interaction.reply(`Stopped tracking ${player.tag}.`);
}

function upcoming(interaction) {
  const choice = readChoice(interaction);
  if (!choice) return replyNotTracked(interaction);

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

async function recent(interaction) {
  const choice = readChoice(interaction);
  if (!choice) return replyNotTracked(interaction);

  await interaction.deferReply();
  // the latest 20 sets come from whoever played last, no need to ask about everyone
  const players = choice === 'all'
    ? Object.values(state.players).sort((a, b) => (b.lastSetAt ?? 0) - (a.lastSetAt ?? 0)).slice(0, RECENT_ALL_PLAYERS)
    : [choice];
  const perPlayer = choice === 'all' ? 3 : 5;

  const sets = await startgg.getSets(players.map((player) => player.playerId), { perPage: perPlayer });

  // 20 max so it's two messages at most
  const latest = sets
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, 20);
  if (!latest.length) return interaction.editReply('No sets found.');

  const cards = latest.map((set) => embeds.setResult(set, state.players));
  // sort is stable, so each player's sets stay newest first
  if (choice === 'all') cards.sort((a, b) => (a.data.author?.name ?? '').localeCompare(b.data.author?.name ?? ''));

  await sendEmbeds(interaction, cards);
}

// caching the promise means two lookups at once share a fetch
function cachedHistory(getPage, pages = HISTORY_PAGES) {
  const histories = new Map();
  return (playerId) => {
    // otherwise it keeps every history anyone ever looked up
    for (const [id, cached] of histories) {
      if (Date.now() - cached.at > HISTORY_CACHE_MINUTES * 60 * 1000) histories.delete(id);
    }
    const cached = histories.get(playerId);
    if (cached) return cached.sets;

    const sets = fetchHistory(getPage, playerId, pages);
    histories.set(playerId, { at: Date.now(), sets });
    sets.catch(() => histories.delete(playerId));
    return sets;
  };
}

// a few pages at a time so start.gg's slow responses overlap. the rate limit still spaces them out
async function fetchHistory(getPage, playerId, pages) {
  const sets = [];
  for (let first = 1; first <= pages; first += PAGES_AT_ONCE) {
    const numbers = Array.from({ length: Math.min(PAGES_AT_ONCE, pages - first + 1) }, (_, i) => first + i);
    const batch = await Promise.all(numbers.map((page) => getPage(playerId, page)));
    sets.push(...batch.flat());
    if (batch.some((page) => !page.length)) break;
  }
  return sets;
}

const setHistory = cachedHistory(startgg.getSetHistory);
const characterHistory = cachedHistory(startgg.getCharacterSets);
const lifetimeHistory = cachedHistory(startgg.getSetHistory, LIFETIME_PAGES);

async function headToHead(interaction) {
  const a = readPlayer(interaction);
  const b = readPlayer(interaction, 'opponent');
  if (!a || !b) return replyNotTracked(interaction);
  if (a === b) return interaction.reply({ content: 'Pick two different players.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  // start.gg can't search sets between two players, so go through both histories
  // (either one can get cut off before older sets) and dedupe by set id
  const [historyA, historyB] = await Promise.all([setHistory(a.playerId), setHistory(b.playerId)]);
  const played = new Map();
  for (const set of [...historyA, ...historyB]) {
    const result = startgg.fromSide(set, a.playerId);
    if (result?.them.playerIds.includes(b.playerId) && !result.dq) played.set(set.id, set);
  }
  const sets = [...played.values()].sort((x, y) => y.completedAt - x.completedAt);

  await interaction.editReply({ embeds: [embeds.headToHead(a, b, sets)] });
}

async function stats(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNotTracked(interaction);

  await interaction.deferReply();
  if (interaction.options.getBoolean('verbose')) {
    const [events, sets] = await Promise.all([startgg.getEventHistory(player.userId), lifetimeHistory(player.playerId)]);
    return sendEmbeds(interaction, embeds.lifetimeStats(player, events, sets, state.players));
  }
  const { standings, sets } = await startgg.getStats(player.playerId);
  await interaction.editReply({ embeds: [embeds.stats(player, standings, sets)] });
}

async function characters(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNotTracked(interaction);

  await interaction.deferReply();
  // ultimate only for now
  const sets = (await characterHistory(player.playerId)).filter((set) => set.videogame.id === startgg.ULTIMATE);
  const usage = characterUsage(sets);
  // no picture beats no reply
  const art = usage.characters.length ? await startgg.getCharacterArt(usage.characters[0].name).catch(() => null) : null;
  await interaction.editReply({ embeds: [embeds.characters(player, usage, art?.name)], files: art ? [art] : [] });
}

async function predict(interaction) {
  const a = readPlayer(interaction);
  const b = readPlayer(interaction, 'opponent');
  if (!a || !b) return replyNotTracked(interaction);
  if (a === b) return interaction.reply({ content: 'Pick two different players.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  const [historyA, historyB] = await Promise.all([setHistory(a.playerId), setHistory(b.playerId)]);
  const odds = predictOdds(a, b, historyA, historyB);
  if (!odds) return interaction.editReply(`${a.tag} and ${b.tag} haven't played singles in the same game on start.gg.`);

  await interaction.editReply({ embeds: [embeds.prediction(a, b, odds)] });
}

function streamAlerts(interaction) {
  const choice = readChoice(interaction);
  if (!choice) return replyNotTracked(interaction);

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

async function setRegReminder(interaction) {
  const input = interaction.options.getString('tournament', true).trim();

  await interaction.deferReply();
  const tournament = await startgg.getRegistration(tournamentSlug(input));
  if (!tournament) {
    return interaction.editReply(`Couldn't find a start.gg tournament for \`${input}\`. Paste its link, like start.gg/tournament/genesis-x.`);
  }

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
  // autocomplete sends the id, typing it out sends the name
  const value = interaction.options.getString('tournament', true).toLowerCase();
  const reminder = Object.hasOwn(state.regReminders, value)
    ? state.regReminders[value]
    : Object.values(state.regReminders).find((each) => each.name.toLowerCase() === value);
  if (!reminder) return interaction.reply({ content: 'No reminder set for that.', flags: MessageFlags.Ephemeral });

  delete state.regReminders[reminder.id];
  save();
  return interaction.reply(`Deleted the reminder for ${reminder.name}.`);
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
    ? 'You\'ll get pinged for reg reminders. If your Discord is linked on start.gg, not for ones you\'re already registered for.'
    : 'No more reg reminder pings.';
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
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
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
