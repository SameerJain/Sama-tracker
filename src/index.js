import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, SlashCommandBuilder } from 'discord.js';
import * as gg from './startgg.js';
import * as ui from './embeds.js';
import { state, save } from './store.js';

const SET_POLL = 2 * 60_000;
const TOURNAMENT_POLL = 15 * 60_000;
const ROLL_CALL_BEFORE = 6 * 3600;
// If events never get marked complete, post whatever placements exist this long after the end date.
const RESULTS_TIMEOUT = 48 * 3600;

const now = () => Math.floor(Date.now() / 1000);
let channel;

const playerOption = (all) => (o) => o.setName('player')
  .setDescription(all ? 'Tracked player, or all' : 'Tracked player')
  .setRequired(true)
  .setAutocomplete(true);

const command = new SlashCommandBuilder()
  .setName('df')
  .setDescription('Dark Fundies')
  .addSubcommand((s) => s.setName('help').setDescription('Show commands'))
  .addSubcommandGroup((g) => g.setName('track').setDescription('Manage tracked players')
    .addSubcommand((s) => s.setName('add').setDescription('Track a start.gg player')
      .addStringOption((o) => o.setName('profile').setDescription('start.gg profile link or ID').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop tracking a player').addStringOption(playerOption(false)))
    .addSubcommand((s) => s.setName('list').setDescription('List tracked players')))
  .addSubcommand((s) => s.setName('upcoming').setDescription('Upcoming tournaments').addStringOption(playerOption(true)))
  .addSubcommand((s) => s.setName('recent').setDescription('Latest reported sets').addStringOption(playerOption(true)));

function pick(i) {
  const value = i.options.getString('player', true).toLowerCase();
  if (value === 'all') return 'all';
  return state.players[value] ?? Object.values(state.players).find((p) => p.tag.toLowerCase() === value);
}

const notTracked = (i) => i.reply({ content: 'That player isn\'t tracked. See `/df track list`.', flags: MessageFlags.Ephemeral });

const handlers = {
  help: (i) => i.reply({ embeds: [ui.help()] }),

  'track list': (i) => i.reply({ embeds: [ui.list(state.players)] }),

  'track add': async (i) => {
    const input = i.options.getString('profile', true).trim();
    await i.deferReply();
    const p = await gg.getPlayer(input.match(/user\/([\w-]+)/)?.[1] ?? input);
    if (!p) return i.editReply(`Couldn't find a start.gg player for \`${input}\`. Use their profile link, like start.gg/user/f64a83c8.`);
    if (state.players[p.userId]) return i.editReply(`Already tracking ${p.tag}.`);
    state.players[p.userId] = { ...p, lastCheck: now() };
    save();
    await i.editReply({ embeds: [ui.added(p)] });
    scanTournaments();
  },

  'track remove': async (i) => {
    const p = pick(i);
    if (!p || p === 'all') return notTracked(i);
    delete state.players[p.userId];
    save();
    await i.reply(`Stopped tracking ${p.tag}.`);
  },

  upcoming: (i) => {
    const p = pick(i);
    if (!p) return notTracked(i);
    const tournaments = Object.values(state.tournaments)
      .filter((t) => !t.results)
      .map((t) => ({ ...t, entries: t.entries.filter((x) => state.players[x.userId] && (p === 'all' || x.userId === p.userId)) }))
      .filter((t) => t.entries.length)
      .sort((a, b) => a.startAt - b.startAt);
    return i.reply({ embeds: [ui.upcoming(tournaments, state.players, p === 'all' ? 'everyone' : p.tag)] });
  },

  recent: async (i) => {
    const p = pick(i);
    if (!p) return notTracked(i);
    await i.deferReply();
    const players = Object.values(state.players);
    const targets = p === 'all' ? players : [p];
    const sets = (await Promise.all(targets.map((t) => gg.getSets(t.playerId, { perPage: p === 'all' ? 2 : 5 })))).flat();
    const latest = [...new Map(sets.map((s) => [s.id, s])).values()]
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, 5);
    if (!latest.length) return i.editReply('No sets found.');
    await i.editReply({ embeds: latest.map((s) => ui.set(s, players)) });
  },
};

async function autocomplete(i) {
  const q = i.options.getFocused().toLowerCase();
  const choices = Object.values(state.players)
    .filter((p) => p.tag.toLowerCase().includes(q))
    .map((p) => ({ name: p.tag, value: String(p.userId) }));
  if (i.options.getSubcommandGroup() !== 'track' && 'all'.startsWith(q)) choices.unshift({ name: 'all', value: 'all' });
  await i.respond(choices.slice(0, 25));
}

// Run a job one at a time, even if the timer and a command trigger it together.
function serial(job) {
  let last = Promise.resolve();
  return () => (last = last.then(job).catch(console.error));
}

const pollSets = serial(async () => {
  const players = Object.values(state.players);
  for (const p of players) {
    const checkedAt = now();
    try {
      const sets = await gg.getSets(p.playerId, { since: p.lastCheck - 120 });
      for (const s of sets.sort((a, b) => a.completedAt - b.completedAt)) {
        // Skip duplicates and old sets that only show up because someone edited them.
        if (state.posted.includes(s.id) || s.completedAt < p.lastCheck - 3600) continue;
        await channel.send({ embeds: [ui.set(s, players)] });
        state.posted.push(s.id);
      }
      p.lastCheck = checkedAt;
    } catch (err) {
      console.error(`sets for ${p.tag}:`, err.message);
    }
  }
  state.posted = state.posted.slice(-1000);
  save();
});

const scanTournaments = serial(async () => {
  const userIds = Object.values(state.players).map((p) => p.userId);
  for (const id of userIds) {
    try {
      for (const t of await gg.getUpcoming(id)) state.tournaments[t.id] ??= { id: t.id, entries: [] };
    } catch (err) {
      console.error(`tournaments for ${state.players[id]?.tag}:`, err.message);
    }
  }

  for (const t of Object.values(state.tournaments)) {
    if (t.results) {
      if (now() > (t.endAt ?? t.startAt) + 7 * 86400) delete state.tournaments[t.id];
      continue;
    }
    try {
      const fresh = await gg.getEntries(t.id, userIds);
      if (!fresh) {
        delete state.tournaments[t.id];
        continue;
      }
      Object.assign(t, fresh);
      await announce(t);
    } catch (err) {
      console.error(`tournament ${t.name ?? t.id}:`, err.message);
    }
  }
  save();
});

async function announce(t) {
  const n = now();
  if (!t.rollCall && n < t.startAt && t.startAt - n <= ROLL_CALL_BEFORE) {
    if (t.entries.length) await channel.send({ embeds: [ui.rollCall(t, state.players)] });
    t.rollCall = true;
  }
  const finished = t.entries.every((e) => e.done) || n > (t.endAt ?? t.startAt) + RESULTS_TIMEOUT;
  if (!t.results && n >= t.startAt && finished) {
    if (t.entries.length) await channel.send({ embeds: [ui.results(t, state.players)] });
    t.results = true;
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.commands.set([command.toJSON()]);
  channel = await client.channels.fetch(process.env.CHANNEL_ID);
  client.user.setActivity('brackets', { type: ActivityType.Watching });
  console.log(`Logged in as ${client.user.tag}, posting to #${channel.name}`);

  scanTournaments();
  pollSets();
  setInterval(scanTournaments, TOURNAMENT_POLL);
  setInterval(pollSets, SET_POLL);
});

client.on(Events.InteractionCreate, async (i) => {
  if (i.isAutocomplete()) return autocomplete(i).catch(console.error);
  if (!i.isChatInputCommand() || i.commandName !== 'df') return;
  const name = [i.options.getSubcommandGroup(), i.options.getSubcommand()].filter(Boolean).join(' ');
  try {
    await handlers[name](i);
  } catch (err) {
    console.error(err);
    const content = `Something went wrong: ${err.message}`;
    await (i.deferred ? i.editReply(content) : i.reply({ content, flags: MessageFlags.Ephemeral })).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
