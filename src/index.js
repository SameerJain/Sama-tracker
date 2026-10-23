import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, RESTJSONErrorCodes } from 'discord.js';
import { buttonFailed, commands, handleAutocomplete, handleButton, handleCommand } from './commands/index.js';
import { inTurn } from './commands/turns.js';
import { failureMessage } from './commands/shared.js';
import { seedFirstTO } from './commands/to.js';
import { badToken, checkToken } from './startgg.js';
import { missingThreadPermissions, startTracking, stopTracking } from './tracker.js';
import { messageSettings } from './message-settings.js';
import { setFallbackImage } from './embeds/index.js';
import { setHealthReady, startHealth, stopHealth } from './health.js';
import { forGuild, guildLocal, isMultiGuild, migrateLegacyToGuild, postsChannelId, save } from './store.js';
import { commandsFor, language } from './i18n.js';

// answered until the bot is logged in and tracking, so railway only switches
// traffic to a new deploy once it can post. set in service settings as the healthcheck path
startHealth();

// a deploy going away saves first and stops its loops, so a restart can't leave
// half-written state or repeat a post. railway sends SIGTERM, ctrl-C sends SIGINT
let stopping = false;
async function shutdown(signal, client) {
  if (stopping) return;
  stopping = true;
  console.log(`got ${signal}, saving and signing off`);
  setHealthReady(false);
  stopTracking();
  try {
    save();
  } catch (err) {
    console.error(`couldn't save state on shutdown (${err.message})`);
  }
  await stopHealth().catch((err) => console.error(`couldn't close the health server (${err.message})`));
  await client.destroy();
  process.exit(0);
}

// commands that ask start.gg this much get a line in the logs, so a slow one shows what it spent its time on
const LOGGED_REQUESTS = 20;

function quit(message) {
  console.error(message);
  process.exit(1);
}

for (const name of ['DISCORD_TOKEN', 'STARTGG_TOKEN']) {
  if (!process.env[name]) quit(`${name} isn't set, put it in .env or the host's environment variables`);
}
// single-server builds need to know which server and channel are theirs. multi-server builds
// (MULTI_GUILD=true) leave both out and each server picks its posts channel with /settings channel
if (!isMultiGuild()) {
  for (const name of ['GUILD_ID', 'CHANNEL_ID']) {
    if (!process.env[name]) quit(`${name} isn't set, put it in .env or the host's environment variables`);
  }
}

// a token start.gg turns down never works, so that stops here. start.gg being down or slow at boot doesn't, since
// quitting over it can outlast the host's restart limit, and every check retries on its own once start.gg is back
await checkToken().catch((err) => {
  if (badToken(err)) quit(`bad STARTGG_TOKEN (${err.message}), make a new one in start.gg Settings > Developer Settings`);
  console.error(`couldn't check STARTGG_TOKEN (${err.message}), starting anyway`);
});

// discord's codes for the bot not being in a server, or not seeing a channel
const NOT_THERE = [RESTJSONErrorCodes.UnknownGuild, RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.MissingAccess];

// set here and not after login so it comes back after reconnects
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  presence: { activities: [{ name: 'playing melee', type: ActivityType.Custom }] },
});

// replaces whatever was registered before, so old commands go away
async function registerCommands(manager) {
  const registered = commandsFor(commands, isMultiGuild() ? 'en' : language());
  await manager.set(registered).catch((err) => {
    if (err.code === RESTJSONErrorCodes.MissingAccess) quit('couldn\'t register the commands, re-invite the bot with the applications.commands scope');
    // usually a command in definitions.js breaking one of discord's limits, which the message names
    quit(`couldn't register the commands (${err.message})`);
  });
}

// what the bot can't post in the channel at all without
function missingPosting(postChannel) {
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  return postChannel.permissionsFor(client.user)?.missing(needed) ?? [];
}

// not worth quitting over: cards without an uploaded picture still post, and thread posts go in the channel
// until it's fixed. threadsOn is the server's /settings posts threads
function warnPosting(postChannel, where, threadsOn) {
  if (!postChannel.permissionsFor(client.user)?.has(PermissionFlagsBits.AttachFiles)) {
    console.error(`missing Attach Files in ${where}, so messages that upload character art, rank badges or the Slippi logo will fail`);
  }
  const threads = missingThreadPermissions(postChannel);
  if (threadsOn && threads?.length !== 0) {
    console.error(`threads are on but can't be started in ${where}${threads ? `, missing ${threads.join(' and ')}` : ''}`);
  }
}

// before anything posts, so a message with no picture of its own gets the bot's. then the checks start and
// railway's health check passes
function goLive(singleChannel) {
  setFallbackImage(client.user.displayAvatarURL({ extension: 'png', size: 256 }));
  process.once('SIGTERM', () => shutdown('SIGTERM', client).catch(console.error));
  process.once('SIGINT', () => shutdown('SIGINT', client).catch(console.error));
  startTracking(client, singleChannel);
  setHealthReady(true);
}

// every server the bot is in, each posting in the channel /settings channel picked there
async function bootMulti() {
  // one registration for every server. global commands can take up to an hour to show up
  // on a server that just invited the bot, which is why /settings channel says to wait a little
  await client.application.fetch().catch(() => null);
  await registerCommands(client.application.commands);

  if (process.env.GUILD_ID) migrateLegacyToGuild(process.env.GUILD_ID, process.env.CHANNEL_ID);
  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) forGuild(guild.id);
  if (!guilds.length) console.error('bot isn\'t in any server yet, invite it with the invite link in the README, then run /settings channel there');

  for (const guild of guilds) {
    const channelId = postsChannelId(guild.id);
    const postChannel = channelId && await client.channels.fetch(channelId).catch((err) => {
      if (!NOT_THERE.includes(err.code)) console.error(`couldn't load posts channel for ${guild.name} (${err.message})`);
      return null;
    });
    if (!postChannel) {
      console.error(`no posts channel set in ${guild.name}, run /settings channel channel:#channel there`);
      continue;
    }
    if (!postChannel.isTextBased()) {
      console.error(`can't see a text channel for ${guild.name}, run /settings channel channel:#channel there`);
      continue;
    }
    const where = `#${postChannel.name} (${guild.name})`;
    const missing = missingPosting(postChannel);
    if (missing.length) {
      console.error(`missing permissions in ${where}: ${missing.join(', ')}`);
      continue;
    }
    console.log(`posting in ${where}`);
    warnPosting(postChannel, where, guildLocal.run(guild.id, () => messageSettings().threads !== 'off'));
  }

  goLive();
  // in the background, it asks start.gg who the first TO is, per server
  for (const guild of guilds) {
    guildLocal.run(guild.id, () => seedFirstTO(guild)).catch(console.error);
  }
}

// one server and one channel, both from the env
async function bootSingle() {
  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch((err) => {
    if (NOT_THERE.includes(err.code)) quit(`bot isn't in server ${process.env.GUILD_ID}, check GUILD_ID or invite it`);
    quit(`couldn't load server ${process.env.GUILD_ID} from Discord (${err.message})`);
  });
  await registerCommands(guild.commands);

  const channel = await client.channels.fetch(process.env.CHANNEL_ID).catch((err) => {
    if (NOT_THERE.includes(err.code)) return null;
    quit(`couldn't load channel ${process.env.CHANNEL_ID} from Discord (${err.message})`);
  });
  if (!channel?.isTextBased()) quit(`can't see a text channel with id ${process.env.CHANNEL_ID}, check CHANNEL_ID`);
  const missing = missingPosting(channel);
  if (missing.length) quit(`missing permissions in #${channel.name}: ${missing.join(', ')}`);

  console.log(`logged in as ${client.user.tag}, posting in #${channel.name}`);
  warnPosting(channel, `#${channel.name}`, messageSettings().threads !== 'off');
  goLive(channel);
  // in the background, it asks start.gg who the first TO is
  seedFirstTO(guild);
}

client.once(Events.ClientReady, () => (isMultiGuild() ? bootMulti() : bootSingle()));

// multi-server only: a server that invites the bot later gets its own empty entry. global
// commands can take up to an hour to appear there, and /settings channel picks its posts channel
if (isMultiGuild()) {
  client.on(Events.GuildCreate, async (guild) => {
    forGuild(guild.id);
    save();
    console.log(`joined ${guild.name}, run /settings channel channel:#channel there`);
    guildLocal.run(guild.id, () => seedFirstTO(guild)).catch(console.error);
  });
}

client.on(Events.InteractionCreate, async (interaction) => {
  // everything the bot does is about a server, and an answer outside one would be a DM to someone who may not
  // be in it. the commands only show in servers, but a button on an old DM could still be pressed
  if (!interaction.inGuild()) return;
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction).catch(console.error);
    return;
  }
  // a report's buttons run it again like commands. so do the Apps menu ones on a member
  const button = interaction.isButton();
  if (!interaction.isChatInputCommand() && !interaction.isUserContextMenuCommand() && !button) return;

  // someone's second command starts right away but its start.gg requests wait for their first, see turns.js
  try {
    await inTurn(interaction, async (progress) => {
      const started = Date.now();
      try {
        await (button ? handleButton(interaction) : handleCommand(interaction));
      } finally {
        const { sent, limited } = progress();
        if (sent >= LOGGED_REQUESTS) {
          const seconds = Math.round((Date.now() - started) / 1000);
          console.log(`${described(interaction)}: ${sent} start.gg requests in ${seconds}s${limited ? `, rate limited ${limited} times` : ''}`);
        }
      }
    });
  } catch (err) {
    console.error(`${described(interaction)} failed:`, err);
    // detail stays in the logs. users get a plain line saying whether start.gg, slippi, discord or the bot
    // itself went wrong, since the raw text would otherwise land in the channel on a public deferred reply
    const message = failureMessage(err);
    const quiet = { content: message, allowedMentions: { parse: [] } };
    if (button) {
      await buttonFailed(interaction, message).catch(console.error);
    } else if (interaction.replied) {
      await interaction.followUp({ ...quiet, flags: MessageFlags.Ephemeral }).catch(console.error);
    } else if (interaction.deferred) {
      await interaction.editReply(quiet).catch(console.error);
    } else {
      await interaction.reply({ ...quiet, flags: MessageFlags.Ephemeral }).catch(console.error);
    }
  }
});

// /stats verbose, or /stats button for its Full report
function described(interaction) {
  if (interaction.isButton()) return `/${interaction.customId.split(':')[1]} button`;
  return `/${interaction.commandName}${interaction.options.getBoolean('verbose') ? ' verbose' : ''}`;
}

// log instead of crashing
client.on(Events.Error, console.error);
process.on('unhandledRejection', console.error);

client.login(process.env.DISCORD_TOKEN).catch((err) => quit(`discord login failed: ${err.message}`));
