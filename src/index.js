import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { command, handleAutocomplete, handleCommand } from './commands.js';
import { startTracking } from './tracker.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.commands.set([command]);

  const channel = await client.channels.fetch(process.env.CHANNEL_ID);
  client.user.setActivity('brackets', { type: ActivityType.Watching });
  console.log(`Logged in as ${client.user.tag}, posting to #${channel.name}`);

  startTracking(channel);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction).catch(console.error);
    return;
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'df') return;

  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error(err);
    const message = `Something went wrong: ${err.message}`;
    if (interaction.deferred) {
      await interaction.editReply(message).catch(console.error);
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(console.error);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
