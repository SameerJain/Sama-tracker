import { PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { serverMembers } from '../accounts.js';
import { replyEphemeral, sendEmbeds } from './shared.js';

// the role's name when the bot makes it. one made by hand with this name counts too
const TO_ROLE = 'TO';
// the first TO, given the role once so someone can hand out the rest. found by the discord on their start.gg,
// the only proof of who someone is. only once, so another TO can still take it off them
const FIRST_TO = 'user/f64a83c8';
// discord's code for missing permissions, which includes a role sitting above the bot's
const MISSING_PERMISSIONS = 50013;
// /t-o role list goes by the TOs the bot has seen, since listing everyone with a role needs a privileged intent
const KNOWN_KEPT = 100;

// what the role lets someone do, for the replies that hand it out
const TO_POWERS = 'TOs can control automatic messages, track, untrack, change posts and set pings for anyone, take anyone off the Slippi watchlist, and use `/t-o tournament` and `/t-o cleanup`.';

// the saved id first, so renaming it in server settings keeps it, then the name. whichever turns up gets saved
function findRole(guild) {
  const roles = guild?.roles?.cache;
  if (!roles) return null;
  const role = roles.get(state.toRole.id) ?? roles.find((each) => each.name === TO_ROLE);
  if (role && state.toRole.id !== role.id) {
    state.toRole.id = role.id;
    save();
  }
  return role ?? null;
}

// it grants nothing in discord, the bot checks for it. no color, which would recolor everyone who has it
async function makeRole(guild) {
  const role = await guild.roles.create({ name: TO_ROLE, permissions: [], reason: 'Sama-tracker TOs' });
  state.toRole.id = role.id;
  save();
  return role;
}

// a member from an interaction has its roles as a cache, a raw one as a list of ids
function hasRole(member, role) {
  const roles = member?.roles;
  return Boolean(roles?.cache?.has?.(role.id) ?? (Array.isArray(roles) && roles.includes(role.id)));
}

function remember(discordId) {
  if (state.toRole.members.includes(discordId)) return;
  state.toRole.members = [...state.toRole.members, discordId].slice(-KNOWN_KEPT);
  save();
}

function forget(discordId) {
  if (!state.toRole.members.includes(discordId)) return;
  state.toRole.members = state.toRole.members.filter((each) => each !== discordId);
  save();
}

// whoever ran it has the TO role. until the server has one, Manage Server counts, so a bot that can't make the
// role doesn't lock everyone out. someone handed the role in server settings gets remembered for /t-o role list
function isTO(interaction) {
  const role = findRole(interaction.guild);
  if (!role) return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
  const yes = hasRole(interaction.member, role);
  if (yes) remember(interaction.user.id);
  return yes;
}

// the private no for someone who isn't a TO. doing finishes "Only TOs can", like "untrack someone else"
function notTO(interaction, doing) {
  return replyEphemeral(interaction, `Only TOs can ${doing}. \`/t-o role list\` shows who they are.`);
}

// the member picked in user:, or a reply saying why there's nobody to change. null when it replied
async function pickedMember(interaction) {
  const user = interaction.options.getUser('user', true);
  const member = interaction.options.getMember('user');
  if (user.bot) {
    await replyEphemeral(interaction, 'Bots can\'t be TOs.');
    return null;
  }
  if (!member) {
    await replyEphemeral(interaction, 'Pick someone in this server.');
    return null;
  }
  return { user, member, name: escapeMarkdown(member.displayName ?? user.displayName) };
}

// /t-o role add: TOs hand each other the role. it gets made the first time, which can take discord past the 3 seconds
async function toAdd(interaction) {
  if (!isTO(interaction)) return notTO(interaction, 'add TOs');
  const picked = await pickedMember(interaction);
  if (!picked) return;
  const { user, member, name } = picked;
  const role = findRole(interaction.guild);
  if (role && hasRole(member, role)) {
    remember(user.id);
    return replyEphemeral(interaction, `${name} is already a TO.`);
  }

  await interaction.deferReply();
  try {
    await member.roles.add(role ?? await makeRole(interaction.guild), 'added with /t-o role add');
  } catch (err) {
    if (err.code !== MISSING_PERMISSIONS) throw err;
    return interaction.editReply({ content: `I couldn't give ${name} the TO role. That needs Manage Roles, with my role above TO.`, allowedMentions: { parse: [] } });
  }
  remember(user.id);
  return interaction.editReply({ content: `${name} is a TO now. ${TO_POWERS}`, allowedMentions: { parse: [] } });
}

// /t-o role set: a server manager can point the bot at a role that already exists
async function toSet(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return replyEphemeral(interaction, 'You need Manage Server permission to set the TO role.');
  }
  const role = interaction.options.getRole('role', true);
  state.toRole.id = role.id;
  state.toRole.members = [];
  if (hasRole(interaction.member, role)) state.toRole.members.push(interaction.user.id);
  save();
  return interaction.reply({ content: `${escapeMarkdown(role.name)} is the TO role now.`, allowedMentions: { parse: [] } });
}

// /t-o role remove: any TO can take it off another, or off themselves
async function toRemove(interaction) {
  if (!isTO(interaction)) return notTO(interaction, 'remove TOs');
  const picked = await pickedMember(interaction);
  if (!picked) return;
  const { user, member, name } = picked;
  const role = findRole(interaction.guild);
  if (!role || !hasRole(member, role)) {
    forget(user.id);
    return replyEphemeral(interaction, `${name} isn't a TO.`);
  }

  await interaction.deferReply();
  const known = await serverMembers(interaction.guild, state.toRole.members);
  const others = [...known].some(([id, knownMember]) => id !== user.id && hasRole(knownMember, role));
  if (!others) {
    return interaction.editReply({ content: `${name} is the last known TO. Add another TO first, or have someone with Manage Server set the TO role.`, allowedMentions: { parse: [] } });
  }
  try {
    await member.roles.remove(role, 'removed with /t-o role remove');
  } catch (err) {
    if (err.code !== MISSING_PERMISSIONS) throw err;
    return interaction.editReply({ content: `I couldn't take the TO role off ${name}. That needs Manage Roles, with my role above TO.`, allowedMentions: { parse: [] } });
  }
  forget(user.id);
  return interaction.editReply({ content: `${name} isn't a TO anymore.`, allowedMentions: { parse: [] } });
}

// /t-o role list: anyone can see who the TOs are. each one the bot has seen gets checked against the server, so
// someone who left or lost the role drops off
async function toList(interaction) {
  isTO(interaction);
  const role = findRole(interaction.guild);
  if (!role) return sendEmbeds(interaction, [embeds.toList([], null)]);
  await interaction.deferReply();
  const members = await serverMembers(interaction.guild, state.toRole.members);
  const tos = [...members].filter(([, member]) => hasRole(member, role)).map(([id]) => id);
  const kept = state.toRole.members.filter((id) => tos.includes(id));
  if (kept.length !== state.toRole.members.length) {
    state.toRole.members = kept;
    save();
  }
  return sendEmbeds(interaction, [embeds.toList(tos, role.name)]);
}

// gives the first TO the role, once, so there's someone to hand out the rest. runs in the background at
// startup and tries again on the next one until it works
async function seedFirstTO(guild) {
  if (state.toRole.seeded || !guild) return;
  try {
    const player = await startgg.getPlayer(FIRST_TO);
    const member = player?.discordId && await guild.members.fetch(player.discordId).catch(() => null);
    if (!member) {
      console.error(`couldn't give the first TO the role: ${FIRST_TO} needs this server's Discord connected on start.gg`);
      return;
    }
    const role = findRole(guild) ?? await makeRole(guild);
    if (!hasRole(member, role)) await member.roles.add(role, 'first TO');
    remember(member.id);
    state.toRole.seeded = true;
    save();
  } catch (err) {
    console.error('giving the first TO the role failed:', err.message);
  }
}

export { isTO, notTO, toAdd, toSet, toRemove, toList, seedFirstTO, TO_ROLE, FIRST_TO, TO_POWERS };
