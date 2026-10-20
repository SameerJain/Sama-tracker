import { MessageFlags, PermissionFlagsBits, ThreadAutoArchiveDuration } from 'discord.js';
import * as embeds from '../embeds/index.js';
import { colors, count } from '../embeds/shared.js';
import { state, save } from '../store.js';
import { serverMembers } from '../accounts.js';
import { isTO, notTO } from './to.js';
import { MATCHMAKING } from './definitions.js';
import { replyEphemeral } from './shared.js';

// discord's code for missing permissions, which includes a role sitting above the bot's
const MISSING_PERMISSIONS = 50013;

// hours a timed role can last, 30 minutes to a day. decimals work, like 0.5 for 30 minutes
export const MATCHMAKING_DURATION_MIN = 0.5;
export const MATCHMAKING_DURATION_MAX = 24;

// a timed role, so a restart doesn't cancel it
export const expiryKey = (discordId, game) => `${discordId}:${game}`;

// 30 -> 30 minutes, 60 -> 1 hour, 90 -> 1 hour 30 minutes
function formatDuration(minutes) {
  if (minutes < 60) return count(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return count(hours, 'hour');
  return `${count(hours, 'hour')} ${count(rest, 'minute')}`;
}

// the saved id first, so a role renamed in server settings still counts, then the name, for one made by
// hand or lost with the state file. whichever turns up gets saved
function findRole(guild, game) {
  const roles = guild.roles.cache;
  const role = roles.get(state.matchmaking[game]) ?? roles.find((each) => each.name === MATCHMAKING[game].role);
  if (role && state.matchmaking[game] !== role.id) {
    state.matchmaking[game] = role.id;
    save();
  }
  return role;
}

// it's only there to be pinged, so it grants nothing. mentionable so anyone can @ it without the bot,
// and no color, which would recolor the name of everyone who has it
async function makeRole(guild, game) {
  const role = await guild.roles.create({ name: MATCHMAKING[game].role, permissions: [], mentionable: true, reason: 'first /matchmaking_role' });
  state.matchmaking[game] = role.id;
  save();
  return role;
}

// /matchmaking_role: hands whoever ran it the role, or takes it back if they have it. the role gets made the
// first time. duration keeps it for that many minutes, then the background check takes it off.
// making and handing out roles can take discord past the 3 seconds a command gets, so it defers first
async function matchmakingRole(interaction) {
  const game = interaction.options.getString('game', true);
  const hours = interaction.options.getNumber?.('duration');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (hours != null && (!Number.isFinite(hours) || hours < MATCHMAKING_DURATION_MIN || hours > MATCHMAKING_DURATION_MAX)) {
    return interaction.editReply(`Duration is hours to keep the role, ${MATCHMAKING_DURATION_MIN}-${MATCHMAKING_DURATION_MAX}. Leave it out to keep it until you take it off.`);
  }
  const minutes = hours == null ? null : Math.round(hours * 60);
  const { guild, member } = interaction;
  const key = expiryKey(interaction.user.id, game);
  let role = findRole(guild, game);
  const name = role?.name ?? MATCHMAKING[game].role;
  let reply;
  try {
    if (role && member.roles.cache.has(role.id)) {
      if (minutes == null) {
        await member.roles.remove(role);
        if (state.matchmakingExpiry?.[key]) {
          delete state.matchmakingExpiry[key];
          save();
        }
        reply = `Took off your **${name}** role, so it won't ping you anymore.`;
      } else {
        state.matchmakingExpiry ??= {};
        state.matchmakingExpiry[key] = Math.floor(Date.now() / 1000) + minutes * 60;
        save();
        reply = `Keeping your **${name}** role for ${formatDuration(minutes)}, then it comes off on its own.`;
      }
    } else {
      role ??= await makeRole(guild, game);
      await member.roles.add(role);
      if (minutes == null) {
        // a stale timer from a role taken off by hand
        if (state.matchmakingExpiry?.[key]) {
          delete state.matchmakingExpiry[key];
          save();
        }
        reply = `You have the **${name}** role now, so you'll get pinged when someone wants games. \`/matchmaking_search game:${MATCHMAKING[game].label}\` pings it, and so does typing @${name}.`;
      } else {
        state.matchmakingExpiry ??= {};
        state.matchmakingExpiry[key] = Math.floor(Date.now() / 1000) + minutes * 60;
        save();
        reply = `You have the **${name}** role now for ${formatDuration(minutes)}, so you'll get pinged when someone wants games. It comes off on its own after that. \`/matchmaking_search game:${MATCHMAKING[game].label}\` pings it, and so does typing @${name}.`;
      }
    }
  } catch (err) {
    if (err.code === MISSING_PERMISSIONS) {
      reply = `I couldn't change your **${name}** role. That needs Manage Roles, with my role above ${name}.`;
    } else {
      // the generic error reply blames start.gg, which this never asks
      console.error(err);
      reply = `Discord didn't let me change your **${name}** role just now. Try again in a minute.`;
    }
  }
  return interaction.editReply(reply);
}

// timed roles whose time is up. a restart doesn't cancel them since the times are saved.
// returns who lost the role, so tests can see it
export async function checkMatchmakingExpiry(guild, now = Math.floor(Date.now() / 1000)) {
  const expiries = state.matchmakingExpiry ??= {};
  const due = Object.entries(expiries).filter(([, at]) => at <= now);
  if (!due.length || !guild) return [];
  const byGame = new Map();
  let changed = false;
  const drop = (key) => {
    if (key in expiries) {
      delete expiries[key];
      changed = true;
    }
  };
  for (const [key] of due) {
    const sep = key.lastIndexOf(':');
    const discordId = key.slice(0, sep);
    const game = key.slice(sep + 1);
    if (!discordId || !MATCHMAKING[game]) {
      drop(key);
      continue;
    }
    if (!byGame.has(game)) byGame.set(game, []);
    byGame.get(game).push({ key, discordId });
  }
  const removed = [];
  for (const [game, entries] of byGame) {
    const role = findRole(guild, game);
    if (!role) {
      for (const { key } of entries) drop(key);
      continue;
    }
    let members;
    try {
      members = await serverMembers(guild, entries.map((entry) => entry.discordId));
    } catch (err) {
      console.error('checking matchmaking expiry failed:', err.message);
      continue;
    }
    for (const { key, discordId } of entries) {
      const member = members.get(discordId);
      // left the server, or took it off by hand
      if (!member || !member.roles?.cache?.has?.(role.id)) {
        drop(key);
        continue;
      }
      try {
        await member.roles.remove(role);
        drop(key);
        removed.push({ discordId, game, roleId: role.id });
      } catch (err) {
        console.error(`taking the matchmaking role off ${discordId} failed:`, err.message);
        // kept, so the next check tries again
      }
    }
  }
  if (changed) save();
  return removed;
}

// /matchmaking_search: pings the role with a card saying who's looking. only people with the role can, so it can't
// be used to ping a group someone isn't in. thread:True starts a thread on the ping to arrange games.
// a TO can point each game's searches at their own channel with /matchmaking_channel, otherwise they
// post wherever the command ran
async function matchmakingSearch(interaction) {
  const game = interaction.options.getString('game', true);
  const { label } = MATCHMAKING[game];
  const role = findRole(interaction.guild, game);
  if (!role || !interaction.member.roles.cache.has(role.id)) {
    return replyEphemeral(interaction, `You need the **${role?.name ?? MATCHMAKING[game].role}** role to ping it. \`/matchmaking_role game:${label}\` gives it to you.`);
  }
  // discord drops a bot's ping to a role that isn't mentionable unless the bot has Mention Everyone
  if (!role.mentionable && !interaction.appPermissions?.has(PermissionFlagsBits.MentionEveryone)) {
    return replyEphemeral(interaction, `**${role.name}** can't be pinged right now. A server admin can turn on "Allow anyone to @mention this role" in its settings.`);
  }
  const card = embeds.matchmaking({
    label,
    color: colors[game],
    discordId: interaction.user.id,
    avatar: interaction.member.displayAvatarURL(),
    message: interaction.options.getString('message')?.trim(),
  });
  // the role is the only thing that pings, not a name or @everyone typed into the message
  const ping = { content: `<@&${role.id}>`, embeds: [card], allowedMentions: { roles: [role.id] } };
  const channelId = state.matchmakingChannels?.[game];
  if (channelId && channelId !== interaction.channelId) {
    const target = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!target || (typeof target.isTextBased === 'function' && !target.isTextBased())) {
      // saved channel gone: drop it, post here, say so privately
      if (state.matchmakingChannels) {
        delete state.matchmakingChannels[game];
        save();
      }
      await interaction.reply(ping);
      await interaction.followUp({ content: `The saved ${label} channel is gone, so this posted here. A TO can set a new one with \`/matchmaking_channel\`.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      if (!interaction.options.getBoolean?.('thread')) return;
      return startSearchThread(interaction, await interaction.fetchReply(), label);
    }
    try {
      const posted = await target.send(ping);
      await replyEphemeral(interaction, `Posted your ${label} search in <#${target.id}>.`);
      if (!interaction.options.getBoolean?.('thread')) return;
      return startSearchThread(interaction, posted, label);
    } catch (err) {
      console.error(`posting a ${label} search in <#${channelId}> failed:`, err.message);
      return replyEphemeral(interaction, `I couldn't post in <#${channelId}>. Give me View Channel and Send Messages there, then try again.`);
    }
  }
  await interaction.reply(ping);
  if (!interaction.options.getBoolean?.('thread')) return;
  return startSearchThread(interaction, await interaction.fetchReply(), label);
}

// thread:True starts a thread on the search to arrange games
// the ping stays even when the thread can't start, so a permission change never loses the search
async function startSearchThread(interaction, posted, label) {
  try {
    const name = interaction.member?.displayName ?? interaction.user?.username ?? 'someone';
    const thread = await posted.startThread({ name: `${label} games with ${name}`.slice(0, 100), autoArchiveDuration: ThreadAutoArchiveDuration.OneDay });
    if (thread?.id) {
      state.matchmakingThreads.push({ id: thread.id, at: Math.floor(Date.now() / 1000) });
      save();
    }
  } catch (err) {
    console.error('starting a matchmaking thread failed:', err.message);
    await interaction.followUp({ content: 'Posted your search, but I couldn\'t start a thread here. A server admin can turn on **Create Public Threads** and **Send Messages in Threads** for this channel.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

// /matchmaking_channel: where a game's searches post. anyone can look, only TOs change it.
// left out means wherever the command runs. the channel gets checked when it's set, so a missing
// permission fails there instead of on the next search
async function matchmakingChannel(interaction) {
  const game = interaction.options.getString('game', true);
  const { label } = MATCHMAKING[game];
  const channel = interaction.options.getChannel?.('channel');
  const clear = interaction.options.getBoolean?.('clear') ?? false;
  const saved = state.matchmakingChannels?.[game];
  if (!channel && !clear) {
    return replyEphemeral(interaction, saved ? `**${label}** searches post in <#${saved}>.` : `**${label}** searches post wherever the command runs.`);
  }
  if (channel && clear) {
    return replyEphemeral(interaction, 'Pick either a channel or `clear:True`, not both.');
  }
  if (!isTO(interaction)) return notTO(interaction, 'set matchmaking channels');
  if (clear) {
    if (state.matchmakingChannels?.[game]) {
      delete state.matchmakingChannels[game];
      save();
    }
    return replyEphemeral(interaction, `**${label}** searches post wherever the command runs now.`);
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const target = await interaction.guild.channels.fetch(channel.id).catch(() => null);
  if (!target) {
    return interaction.editReply({ content: `Couldn't use that channel for **${label}** searches. Pick one in this server.`, allowedMentions: { parse: [] } });
  }
  if (typeof target.isTextBased === 'function' && !target.isTextBased()) {
    return interaction.editReply({ content: `**${label}** searches need a text channel.`, allowedMentions: { parse: [] } });
  }
  const me = interaction.guild.members?.me;
  if (me) {
    const perms = target.permissionsFor?.(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.editReply({ content: `I can't post in <#${target.id}>. Give me View Channel and Send Messages there first.`, allowedMentions: { parse: [] } });
    }
  }
  state.matchmakingChannels ??= {};
  state.matchmakingChannels[game] = target.id;
  save();
  return interaction.editReply({ content: `**${label}** searches will post in <#${target.id}>.`, allowedMentions: { parse: [] } });
}

export { matchmakingRole, matchmakingSearch, matchmakingChannel };
