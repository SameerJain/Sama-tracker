import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buttonFailed, commands, handleAutocomplete, handleButton, handleCommand } from './commands/index.js';
import { asCommand, checkToken, commandProgress } from './startgg.js';
import { missingThreadPermissions, startTracking } from './tracker.js';
import { messageSettings } from './message-settings.js';
import { setFallbackImage } from './embeds/index.js';

// commands that ask start.gg this much get a line in the logs, so a slow one shows what it spent its time on
const LOGGED_REQUESTS = 20;

function quit(message) {
  console.error(message);
  process.exit(1);
}

for (const name of ['DISCORD_TOKEN', 'STARTGG_TOKEN', 'GUILD_ID', 'CHANNEL_ID']) {
  if (!process.env[name]) quit(`${name} isn't set, put it in .env or the host's environment variables`);
}

await checkToken().catch((err) => quit(`bad STARTGG_TOKEN (${err.message}), make a new one in start.gg Settings > Developer Settings`));

// set here and not after login so it comes back after reconnects
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  presence: { activities: [{ name: 'playing melee', type: ActivityType.Custom }] },
});

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) quit(`bot isn't in server ${process.env.GUILD_ID}, check GUILD_ID or invite it`);

  // replaces whatever was registered before, so old commands go away
  await guild.commands.set(commands).catch(() => quit('couldn\'t register the commands, re-invite the bot with the applications.commands scope'));

  const channel = await client.channels.fetch(process.env.CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) quit(`can't see a text channel with id ${process.env.CHANNEL_ID}, check CHANNEL_ID`);

  const missing = channel.permissionsFor(client.user).missing([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ]);
  if (missing.length) quit(`missing permissions in #${channel.name}: ${missing.join(', ')}`);

  console.log(`logged in as ${client.user.tag}, posting in #${channel.name}`);
  // not worth quitting over, those posts go in the channel until it's fixed
  const threadsMissing = missingThreadPermissions(channel);
  if (messageSettings().threads && threadsMissing?.length !== 0) {
    console.error(`tournament threads are on but can't be started in #${channel.name}${threadsMissing ? `, missing ${threadsMissing.join(' and ')}` : ''}`);
  }

  // before anything posts, so a message with no picture of its own gets this one
  setFallbackImage(client.user.displayAvatarURL({ extension: 'png', size: 256 }));
  startTracking(channel);
});

// one command per person at a time so spamming can't pile up start.gg requests
const busy = new Set();

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction).catch(console.error);
    return;
  }
  // a report's buttons run it again, so they wait their turn like commands. so do the Apps menu ones on a member
  const button = interaction.isButton();
  if (!interaction.isChatInputCommand() && !interaction.isUserContextMenuCommand() && !button) return;

  const userId = interaction.user.id;
  if (busy.has(userId)) {
    await interaction.reply({ content: 'Still working on your last command.', flags: MessageFlags.Ephemeral }).catch(console.error);
    return;
  }
  busy.add(userId);

  try {
    await asCommand(async () => {
      const progress = commandProgress();
      const started = Date.now();
      try {
        await (button ? handleButton(interaction) : handleCommand(interaction));
      } finally {
        const { sent, limited } = progress();
        if (sent >= LOGGED_REQUESTS) {
          console.log(`${described(interaction)}: ${sent} start.gg requests in ${Math.round((Date.now() - started) / 1000)}s${limited ? `, rate limited ${limited} times` : ''}`);
        }
      }
    });
  } catch (err) {
    console.error(err);
    const message = `Something went wrong: ${err.message}`;
    if (button) {
      await buttonFailed(interaction, message).catch(console.error);
    } else if (interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(console.error);
    } else if (interaction.deferred) {
      await interaction.editReply(message).catch(console.error);
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(console.error);
    }
  } finally {
    busy.delete(userId);
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
