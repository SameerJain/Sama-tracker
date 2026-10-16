import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { commands, handleAutocomplete, handleCommand } from './commands.js';
import { asCommand, checkToken } from './startgg.js';
import { startTracking } from './tracker.js';

function quit(message) {
  console.error(message);
  process.exit(1);
}

for (const name of ['DISCORD_TOKEN', 'STARTGG_TOKEN', 'GUILD_ID', 'CHANNEL_ID']) {
  if (!process.env[name]) quit(`${name} isn't set, put it in .env or the Railway variables`);
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

  startTracking(channel);
});

// one command per person at a time so spamming can't pile up start.gg requests
const busy = new Set();

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction).catch(console.error);
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  if (busy.has(userId)) {
    await interaction.reply({ content: 'Still working on your last command.', flags: MessageFlags.Ephemeral }).catch(console.error);
    return;
  }
  busy.add(userId);

  try {
    await asCommand(() => handleCommand(interaction));
  } catch (err) {
    console.error(err);
    const message = `Something went wrong: ${err.message}`;
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

// log instead of crashing
client.on(Events.Error, console.error);
process.on('unhandledRejection', console.error);

client.login(process.env.DISCORD_TOKEN).catch((err) => quit(`discord login failed: ${err.message}`));
