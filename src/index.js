import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { command, handleAutocomplete, handleCommand } from './commands.js';
import { checkToken } from './startgg.js';
import { startTracking } from './tracker.js';

// Setup mistakes stop the bot with a plain message instead of a stack trace.
function quit(message) {
  console.error(message);
  process.exit(1);
}

for (const name of ['DISCORD_TOKEN', 'STARTGG_TOKEN', 'GUILD_ID', 'CHANNEL_ID']) {
  if (!process.env[name]) quit(`${name} is missing from .env.`);
}

await checkToken().catch((err) => quit(`Couldn't use STARTGG_TOKEN (${err.message}). Make a new one under start.gg Settings > Developer Settings.`));

// Set here instead of after login so Discord gets it again on every reconnect.
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  presence: { activities: [{ name: 'playing melee', type: ActivityType.Custom }] },
});

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) quit(`The bot isn't in a server with ID ${process.env.GUILD_ID}. Check GUILD_ID and that the bot was invited.`);

  await guild.commands.set([command]).catch(() => quit('Discord refused the /df command. Re-invite the bot with the applications.commands scope.'));

  const channel = await client.channels.fetch(process.env.CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) quit(`Can't find a text channel with ID ${process.env.CHANNEL_ID}, or the bot can't see it. Check CHANNEL_ID.`);

  const missing = channel.permissionsFor(client.user).missing([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ]);
  if (missing.length) quit(`The bot is missing these permissions in #${channel.name}: ${missing.join(', ')}.`);

  console.log(`Logged in as ${client.user.tag}, posting to #${channel.name}`);

  startTracking(channel);
});

// One command per person at a time, so nobody can stack up start.gg requests by spamming.
const busy = new Set();

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction).catch(console.error);
    return;
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'df') return;

  const userId = interaction.user.id;
  if (busy.has(userId)) {
    await interaction.reply({ content: 'Still working on your last command.', flags: MessageFlags.Ephemeral }).catch(console.error);
    return;
  }
  busy.add(userId);

  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error(err);
    const message = `Something went wrong: ${err.message}`;
    // If part of the answer already went out, add the error below it instead of replacing it.
    if (interaction.replied) {
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

// Without a listener, Node treats an 'error' event as a crash.
client.on(Events.Error, console.error);
// Same for a rejected promise nobody caught. Log it and keep tracking.
process.on('unhandledRejection', console.error);

client.login(process.env.DISCORD_TOKEN).catch((err) => quit(`Discord didn't accept DISCORD_TOKEN. ${err.message}`));
