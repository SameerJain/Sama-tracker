import { hostname } from 'node:os';
import { MessageFlags } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state } from '../store.js';
import { deployedAt, health } from '../tracker.js';
import { funCommands, post } from '../fun/index.js';
import { verifiedCaller } from '../accounts.js';
import { trackAdd, trackRemove, link, unlink, profile, upcoming, recent, run } from './players.js';
import { progress, scout, headToHead, stats, doubles, characters, predict, memberHeadToHead, memberScout, reports, NOT_LINKED } from './stats.js';
import { setRegReminder, deleteRegReminder, regAdminAdd, regAdminRemove, bracket, streamLink, regRole, registered, regWarn, tournamentChoices } from './registration.js';
import { configureMessages, socialsAdd, socialsRemove, streamAlerts, streamPings, setResults, matchCalls } from './settings.js';
import { slippiAdd, slippiRemove, slippiRank, slippiLeaderboard, slippiChoices } from './slippi.js';
import { pickable, sendEmbeds, readButton, parseSince, playerBySlug, replyEphemeralAfterDefer, recentPicks, nameMatches } from './shared.js';
import { handleChoice, isChoice } from './confirm.js';

import { MEMBER_H2H, MEMBER_SCOUT } from './definitions.js';

export { commands } from './definitions.js';

// these change what gets posted, so only tracked players can be picked. the rest are lookups, where linked people can be too
const TRACKED_ONLY = ['track remove', 'stream', 'sets', 'calls'];
// all means everyone tracked
const TAKES_ALL = ['upcoming', 'recent', 'stream', 'sets', 'calls'];
// a tournament link, or one the bot already knows
const TAKES_TOURNAMENT = ['set_reg_reminder', 'registered', 'reg_warn'];

// "track add", or just the command for the ones without subcommands
function commandName(interaction) {
  const subcommand = interaction.options.getSubcommand(false);
  return subcommand ? `${interaction.commandName} ${subcommand}` : interaction.commandName;
}

const handlers = new Map([
  ['help', (interaction) => sendEmbeds(interaction, embeds.help())],
  ['messages', configureMessages],
  ['socials', (interaction) => sendEmbeds(interaction, embeds.socials(state.socials))],
  ['socials_edit add', socialsAdd],
  ['socials_edit remove', socialsRemove],
  ['track add', trackAdd],
  ['track remove', trackRemove],
  ['track list', (interaction) => sendEmbeds(interaction, embeds.trackedList(state.players, Object.keys(pickable()).length - Object.keys(state.players).length))],
  ['link', link],
  ['unlink', unlink],
  ['profile', profile],
  ['upcoming', upcoming],
  ['recent', recent],
  ['run', run],
  ['progress', progress],
  ['scout', scout],
  ['h2h', headToHead],
  ['stats', stats],
  ['doubles', doubles],
  ['characters', characters],
  ['predict', predict],
  ['stream', streamAlerts],
  ['stream_pings', streamPings],
  ['sets', setResults],
  ['calls', matchCalls],
  ['slippi add', slippiAdd],
  ['slippi remove', slippiRemove],
  ['slippi rank', slippiRank],
  ['slippi leaderboard', slippiLeaderboard],
  ['status', status],
  ['set_reg_reminder', setRegReminder],
  ['delete_reg_reminder', deleteRegReminder],
  ['reg_admin add', regAdminAdd],
  ['reg_admin remove', regAdminRemove],
  ['reg_admin list', (interaction) => interaction.reply({ embeds: embeds.withImage([embeds.regAdmins(state.regAdmins)]) })],
  ['bracket', bracket],
  ['stream_link', streamLink],
  ['reg_role', regRole],
  ['registered', registered],
  ['reg_warn', regWarn],
  ['view_pfp', viewPfp],
  [MEMBER_H2H, memberHeadToHead],
  [MEMBER_SCOUT, memberScout],
  ...Object.values(funCommands).map((fun) => [fun.name, (interaction) => post(interaction, fun)]),
]);

export async function handleCommand(interaction) {
  return handlers.get(commandName(interaction))?.(interaction);
}

// a report's button. more greys out the buttons and swaps the message for the full report, new answers with
// another report, and private does too but only for whoever pressed it, so buttons on the automatic posts
// don't fill the channel. the button only has profile slugs or player ids, so the players get looked up again
export async function handleButton(interaction) {
  // Are you sure and Undo answer by changing the message they're on, see confirm.js
  if (isChoice(interaction.customId)) return handleChoice(interaction);
  const { action, command, player, opponent, melee, game, since: sinceText, venue } = readButton(interaction.customId);
  // buttons only ever hold dates the command accepted, so a bad one just means no filter
  const { since } = parseSince(sinceText);
  if (action === 'more') {
    await interaction.deferUpdate();
    await interaction.editReply({ components: disabled(interaction.message) });
  } else {
    await interaction.deferReply(action === 'private' ? { flags: MessageFlags.Ephemeral } : {});
  }
  const report = reports[command];
  if (!report || !['more', 'new', 'private'].includes(action)) return buttonFailed(interaction, 'That button doesn\'t work anymore, run the command again.');

  // /scout compares with whoever ran it, and nobody else can see its buttons
  const who = command === 'scout' ? await verifiedCaller(interaction.user.id) : player && await playerBySlug(player);
  if (!who && command === 'scout') return buttonFailed(interaction, NOT_LINKED);
  const against = opponent ? await playerBySlug(opponent) : null;
  if (!who || (opponent && !against)) return buttonFailed(interaction, `Couldn't find a start.gg account for that player. Run \`/${command}\` again.`);
  return report(interaction, { player: who, opponent: against, verbose: action === 'more', melee, game, since, venue });
}

// the same buttons, greyed out
function disabled(message) {
  return message.components.map((row) => {
    const { components, ...rest } = row.toJSON();
    return { ...rest, components: components.map((button) => ({ ...button, disabled: true })) };
  });
}

// only whoever pressed it hears what went wrong. a report that was being swapped goes back the way it was
export async function buttonFailed(interaction, content) {
  if (readButton(interaction.customId).action !== 'more' || !interaction.deferred) return replyEphemeralAfterDefer(interaction, content);
  const { message } = interaction;
  await interaction.editReply({ content: message.content || null, embeds: message.embeds, components: message.components });
  return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
}

export async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const typed = focused.toLowerCase();
  const name = commandName(interaction);
  const choices = [];

  if (TAKES_TOURNAMENT.includes(name)) return interaction.respond(tournamentChoices(focused, { newReminder: name === 'set_reg_reminder' }));

  if (name === 'slippi remove' || name === 'slippi rank') return interaction.respond(slippiChoices(focused, { anyCode: name === 'slippi rank' }));

  if (name === 'delete_reg_reminder') {
    for (const reminder of Object.values(state.regReminders)) {
      if (reminder.name.toLowerCase().includes(typed)) choices.push({ name: reminder.name.slice(0, 100), value: String(reminder.id) });
    }
    return interaction.respond(choices.slice(0, 25));
  }

  if (name === 'reg_admin remove') {
    for (const admin of Object.values(state.regAdmins)) {
      if (nameMatches(admin.tag, focused)) choices.push({ name: admin.tag, value: String(admin.userId) });
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

  const trackedOnly = TRACKED_ONLY.includes(name);
  if (TAKES_ALL.includes(name) && 'all'.startsWith(typed)) choices.push({ name: 'all', value: 'all' });
  // tracked players, then people who linked themselves. only 25 fit, so tags that start with what's typed go
  // first, and among those whoever this person picked lately. with nothing typed yet that's the whole list
  const people = trackedOnly ? Object.values(state.players) : Object.values(pickable()).sort((a, b) => !state.players[a.userId] - !state.players[b.userId]);
  const recent = recentPicks(interaction.user.id);
  const recency = (player) => {
    const at = recent.indexOf(String(player.userId));
    return at === -1 ? recent.length : at;
  };
  const matches = people.filter((player) => nameMatches(player.tag, focused));
  const starts = (player) => nameMatches(player.tag, focused, { start: true });
  matches.sort((a, b) => starts(b) - starts(a) || recency(a) - recency(b));
  for (const player of matches) choices.push({ name: state.players[player.userId] ? player.tag : `${player.tag} (linked)`, value: String(player.userId) });

  // an empty list looks broken, so say why. picking it gets the not found reply
  if (!choices.length) {
    let why = trackedOnly ? `Nobody tracked matches "${focused}"` : `Nobody tracked or linked matches "${focused}", /track add them first`;
    if (!people.length) why = 'Nobody is tracked yet, /track add someone first';
    choices.push({ name: why.slice(0, 100), value: focused.slice(0, 100) || 'nobody' });
  }

  await interaction.respond(choices.slice(0, 25));
}

function status(interaction) {
  const tournaments = Object.values(state.tournaments).filter((tournament) => !tournament.resultsPosted && tournament.entries.length);
  const info = {
    ...health,
    // only off the server, to spot a copy running somewhere it shouldn't. the server's is a random container id
    host: process.env.RAILWAY_ENVIRONMENT_NAME ? null : hostname(),
    deployedAt: deployedAt(),
    avatar: interaction.client.user.displayAvatarURL(),
    players: Object.keys(state.players).length,
    slippi: Object.keys(state.slippi).length,
    tournaments: tournaments.length,
    queued: startgg.queueLength(),
  };
  return interaction.reply({ embeds: [embeds.status(info)], flags: MessageFlags.Ephemeral });
}

// just the picture, as big as discord has it
async function viewPfp(interaction) {
  const url = interaction.client.user.displayAvatarURL({ extension: 'png', size: 4096 });
  await interaction.deferReply();
  await interaction.editReply({ files: [{ attachment: url, name: `pfp.${new URL(url).pathname.split('.').pop()}` }] });
}
