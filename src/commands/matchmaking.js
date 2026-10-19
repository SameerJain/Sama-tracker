import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import * as embeds from '../embeds/index.js';
import { colors } from '../embeds/shared.js';
import { state, save } from '../store.js';
import { MATCHMAKING } from './definitions.js';
import { replyEphemeral } from './shared.js';

// discord's code for missing permissions, which includes a role sitting above the bot's
const MISSING_PERMISSIONS = 50013;

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
// first time. making and handing out roles can take discord past the 3 seconds a command gets, so it defers first
async function matchmakingRole(interaction) {
  const game = interaction.options.getString('game', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guild, member } = interaction;
  let role = findRole(guild, game);
  const name = role?.name ?? MATCHMAKING[game].role;
  let reply;
  try {
    if (role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      reply = `Took off your **${name}** role, so it won't ping you anymore.`;
    } else {
      role ??= await makeRole(guild, game);
      await member.roles.add(role);
      reply = `You have the **${name}** role now, so you'll get pinged when someone wants games. \`/matchmaking_search game:${MATCHMAKING[game].label}\` pings it, and so does typing @${name}.`;
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

// /matchmaking_search: pings the role with a card saying who's looking. only people with the role can, so it can't
// be used to ping a group someone isn't in
function matchmakingSearch(interaction) {
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
  return interaction.reply({ content: `<@&${role.id}>`, embeds: [card], allowedMentions: { roles: [role.id] } });
}

export { matchmakingRole, matchmakingSearch };
