import { hostname } from 'node:os';
import { MessageFlags } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state } from '../store.js';
import { health } from '../tracker.js';
import { jokes, tell } from '../jokes/index.js';
import { trackAdd, trackRemove, link, unlink, profile, upcoming, recent, run } from './players.js';
import { progress, scout, headToHead, stats, characters, predict } from './stats.js';
import { setRegReminder, deleteRegReminder, regAdminAdd, regAdminRemove, bracket, regRole, registered, regWarn } from './registration.js';
import { configureMessages, socialsAdd, socialsRemove, streamAlerts } from './settings.js';
import { sendEmbeds } from './shared.js';

export { commands } from './definitions.js';

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

// just the picture, as big as discord has it
async function pfp(interaction) {
  const url = interaction.client.user.displayAvatarURL({ extension: 'png', size: 4096 });
  await interaction.deferReply();
  await interaction.editReply({ files: [{ attachment: url, name: `pfp.${new URL(url).pathname.split('.').pop()}` }] });
}
