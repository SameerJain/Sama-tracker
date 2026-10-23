import { MessageFlags, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { postsChannelId, state, save } from '../store.js';
import { currentChannel, missingThreadPermissions, secondsNow } from '../tracker.js';
import {
  MAX_EVENT_LENGTH_HOURS, MESSAGE_TYPES, MIN_EVENT_LENGTH_HOURS, REG_ROLE, THREAD_MODES, WEEKDAYS, messageEnabled, messageSettings,
} from '../message-settings.js';
import { cantMakeEvents } from '../discord-events.js';
import { count } from '../embeds/shared.js';
import { isSelf, linkedPlayer, readTracked, replyEphemeral, replyNotTracked } from './shared.js';
import { askFirst, confirmable } from './confirm.js';
import { isTO, notTO } from './to.js';

// remove autocompletes with the link as the value, which discord caps at 100
const SOCIAL_URL_LENGTH = 100;

// EST or EDT when the zone has a short name for it, otherwise the zone id itself
function zoneLabel(timezone) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value;
  return label && /^[A-Z]{2,4}$/.test(label) ? label : timezone;
}

function configureMessages(interaction) {
  // failures stay private, but the settings themselves post where everyone sees them
  const fail = (content) => replyEphemeral(interaction, content);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !isTO(interaction)) {
    return fail('You need to be a TO or have Manage Server permission to control automatic messages.');
  }
  const previous = messageSettings();
  const changes = {};
  for (const type of Object.keys(MESSAGE_TYPES)) {
    const value = interaction.options.getBoolean(type);
    if (value !== null) changes[type] = value;
  }
  const setColors = interaction.options.getBoolean('set_colors');
  if (setColors !== null) changes.setColors = setColors;
  const day = interaction.options.getInteger('recap_day');
  if (day !== null) changes.recapDay = day;
  const time = interaction.options.getString('recap_time')?.trim();
  if (time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return fail('Use a 24-hour time in HH:MM format, like 09:00 or 21:30.');
    changes.recapTime = time;
  }
  const timezone = interaction.options.getString('timezone')?.trim();
  if (timezone !== undefined) {
    try {
      changes.timezone = new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
    } catch {
      return fail('Unknown timezone. Use one like America/New_York, America/Los_Angeles, Europe/London or UTC.');
    }
  }
  // checked when it's turned on, the way threads are, so a missing permission doesn't fail quietly later
  if (changes.events && !previous.events) {
    const cant = cantMakeEvents(interaction.guild);
    if (cant) return fail(cant);
  }
  const threads = interaction.options.getString('threads');
  if (threads !== null) {
    // checked when it's turned on so it doesn't wait for the next tournament to find out. in the posts
    // channel, not wherever this ran. a multi-server build with no /setup yet posts nothing, and /setup
    // checks threads when it picks one
    const channelId = postsChannelId();
    const postChannel = channelId && (interaction.client.channels.cache.get(channelId) ?? currentChannel());
    if (threads !== 'off' && postChannel) {
      const missing = missingThreadPermissions(postChannel);
      if (!missing) return fail(`Threads can't be started in <#${channelId}>, so posts stay in the channel.`);
      if (missing.length) return fail(`I need ${missing.join(' and ')} in <#${channelId}> to start threads. Add them to my role or the channel, then try again.`);
    }
    changes.threads = threads;
  }
  const eventLength = interaction.options.getInteger('event_length');
  if (eventLength !== null) {
    if (!Number.isInteger(eventLength) || eventLength < MIN_EVENT_LENGTH_HOURS || eventLength > MAX_EVENT_LENGTH_HOURS) {
      return fail(`Event length is ${MIN_EVENT_LENGTH_HOURS} to ${MAX_EVENT_LENGTH_HOURS} hours, like 5.`);
    }
    changes.eventLength = eventLength;
  }

  if (Object.keys(changes).length) {
    const now = secondsNow();
    // anything that came due while one was off stays skipped once it's back on
    const reenabled = Object.keys(MESSAGE_TYPES).filter((type) => changes[type] && !previous[type]);
    if (reenabled.length) changes.enabledAt = { ...previous.enabledAt, ...Object.fromEntries(reenabled.map((type) => [type, now])) };
    // a new schedule starts with the next recap
    if (['recapDay', 'recapTime', 'timezone'].some((key) => Object.hasOwn(changes, key) && changes[key] !== previous[key])) {
      changes.recapChangedAt = now;
    }
    state.messages = { ...state.messages, ...changes };
    save();
  }
  const settings = messageSettings();
  const lines = ['**Automatic posts**'];
  for (const [key, label] of Object.entries(MESSAGE_TYPES)) {
    if (key === 'recap') continue;
    lines.push(`**${label}:** ${settings[key] ? 'on' : 'off'}`);
  }
  lines.push(`**Threads:** ${THREAD_MODES[settings.threads]}`);
  lines.push(`**Event length:** ${settings.eventLength} hours`);
  lines.push(`**Set result colors:** ${settings.setColors ? 'on' : 'off'}`);
  lines.push('', '**Weekly recap**',
    `**Posts:** ${settings.recap ? 'on' : 'off'} · **Day and time:** ${WEEKDAYS[settings.recapDay]} ${settings.recapTime} ${zoneLabel(settings.timezone)}`,
    '-# Posts missed while a message type is off won\'t be sent when you turn it back on. Recap schedule changes apply to future recaps.',
    '-# `events` makes a Discord event for each upcoming tracked tournament, once each. Needs Manage Events',
    '-# `threads` has three modes for set results and stream alerts. Off posts them here, except a tracked tournament\'s, which always get a thread. One per tournament gives each tournament a thread, and one per event gives each event its own, like Genesis 11 · Ultimate Singles. Each thread pins its channel card until the tournament or event ends.',
    '-# `set_colors` paints set result cards green for a tracked win, red for a loss, gold when two tracked players meet and blue when nobody tracked played. Off leaves every card blue.',
    '-# `event_length` is how long a Discord event runs when start.gg has no end time. A major or regional with no end time still gets 12 hours.');
  return interaction.reply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

// twitch.tv/name works without the https. null for anything that isn't a web link
function socialUrl(input) {
  const text = input.trim();
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  // "hello" parses as https://hello/, and twitch.tv@evil.example goes to evil.example
  if (!url.hostname.includes('.') || url.username || url.password) return null;
  // a ) would end the [Twitch](link) early
  return url.href.replaceAll('(', '%28').replaceAll(')', '%29');
}

// ephemeral so edits don't clutter the channel and a name can't ping anyone. who can run it is discord's
// to say: Manage Server by default, or any role a server hands it to
function socialsAdd(interaction) {
  const reply = (content) => replyEphemeral(interaction, content);
  const typed = interaction.options.getString('name', true).trim();
  const url = socialUrl(interaction.options.getString('link', true));
  if (!url) return reply('That isn\'t a web link. Paste the profile, channel or page link.');
  if (url.length > SOCIAL_URL_LENGTH) return reply(`Links can be up to ${SOCIAL_URL_LENGTH} characters.`);

  const listed = state.socials.find((social) => social.url === url);
  if (listed) return reply(`That link is already in \`/socials\` under ${listed.name}.`);

  // "716 esports" goes on the same line as "716 Esports", spelled like the first one
  const name = state.socials.find((social) => social.name.toLowerCase() === typed.toLowerCase())?.name ?? typed;
  state.socials.push({ name, url });
  save();
  return reply(`Added ${url} under ${name}.`);
}

function socialsRemove(interaction) {
  // autocomplete sends the saved link, typing it out might leave off the https
  const url = socialUrl(interaction.options.getString('link', true));
  const social = state.socials.find((each) => each.url === url);
  if (!social) return replyEphemeral(interaction, 'That link isn\'t in `/socials`. Pick one from the list.');

  state.socials = state.socials.filter((each) => each !== social);
  save();
  return replyEphemeral(interaction, `Removed ${social.url} from ${social.name}.`);
}

// /track posts switches, the player field each one sets and how the reply names it. onAt saves when set results
// went from off to on, since the set check never asked start.gg about sets from while they were off
const POST_SWITCHES = {
  sets: { field: 'setResults', label: 'set results', onAt: 'setResultsOnAt' },
  stream: { field: 'streamAlerts', label: 'stream alerts' },
};
// players saved before set results and stream alerts started off have no field, which counts as on
const isOn = (player, field) => player[field] !== false;

// Set results on and stream alerts off, or Set results and stream alerts on when they match
function switchesText(changes) {
  const parts = Object.entries(changes).map(([name, on]) => ({ label: POST_SWITCHES[name].label, on }));
  const text = parts.length === 2 && parts[0].on === parts[1].on
    ? `${parts[0].label} and ${parts[1].label} ${parts[0].on ? 'on' : 'off'}`
    : parts.map(({ label, on }) => `${label} ${on ? 'on' : 'off'}`).join(' and ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// returns what to reply
function flipPosts(choice, changes) {
  const now = secondsNow();
  for (const player of choice === 'all' ? Object.values(state.players) : [choice]) {
    for (const [name, on] of Object.entries(changes)) {
      const { field, onAt } = POST_SWITCHES[name];
      if (on && onAt && player[field] === false) player[onAt] = now;
      player[field] = on;
    }
  }
  save();
  return `${switchesText(changes)} for ${choice === 'all' ? 'everyone' : choice.tag}.`;
}

// set results off for everyone asks first, since sets finished while they're off never get posted. the target
// says what the same command did to stream alerts, so pressing it changes both
confirmable('sets_off', {
  command: '/track posts player:all sets:off',
  run: (target) => {
    const changes = { sets: false };
    const stream = { 'all-stream-on': true, 'all-stream-off': false }[target];
    if (stream !== undefined) changes.stream = stream;
    return { content: flipPosts('all', changes) };
  },
  cancel: () => 'Set results stay the way they were.',
});

// where a player's or everyone's are at, for /track posts with no switches
function postsText(choice) {
  if (choice !== 'all') {
    return `${escapeMarkdown(choice.tag)}: set results ${isOn(choice, 'setResults') ? 'on' : 'off'}, stream alerts ${isOn(choice, 'streamAlerts') ? 'on' : 'off'}.`;
  }
  const players = Object.values(state.players);
  const on = (field) => players.filter((player) => isOn(player, field)).length;
  return `Set results are on for ${on('setResults')} and stream alerts for ${on('streamAlerts')} of the ${count(players.length, 'tracked player')}.`;
}

// /track posts: a tracked player's set results and stream alerts, or everyone's with all. anyone can see them and
// change their own, only TOs can change someone else's or everyone's
function trackPosts(interaction) {
  const choice = interaction.options.getString('player')?.toLowerCase() === 'all' ? 'all' : readTracked(interaction);
  if (!choice) return replyNotTracked(interaction);

  const changes = {};
  for (const name of Object.keys(POST_SWITCHES)) {
    const value = interaction.options.getString(name);
    if (value) changes[name] = value === 'on';
  }
  if (!Object.keys(changes).length) return interaction.reply({ content: postsText(choice), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (choice === 'all' && !isTO(interaction)) return notTO(interaction, 'change everyone\'s posts');
  if (choice !== 'all' && !isSelf(interaction, choice) && !isTO(interaction)) return notTO(interaction, 'change someone else\'s posts. Leave out `player` to change yours');

  // nothing to lose when it's already off for everyone
  const players = Object.values(state.players);
  if (choice === 'all' && changes.sets === false && players.some((player) => isOn(player, 'setResults'))) {
    const target = { true: 'all-stream-on', false: 'all-stream-off' }[changes.stream] ?? 'all';
    return askFirst(interaction, 'sets_off', target, `Turn set results off for all ${players.length} tracked players? Sets they finish while it's off never get posted, even after it's back on.`, 'Turn off');
  }
  return interaction.reply({ content: flipPosts(choice, changes), allowedMentions: { parse: [] } });
}

// what each /notify switch keeps a list of, what the reply says about it, and its name in the bulk question,
// lowercase since that capitalizes only the first letter like /track posts
const PINGS = {
  calls: {
    list: 'callPings',
    label: 'match calls',
    on: 'You\'ll get pinged when your match is called.',
    off: 'No more match call pings.',
  },
  streams: {
    list: 'streamPings',
    label: 'stream alerts',
    on: 'You\'ll get pinged when your set is on stream.',
    off: 'No more stream alert pings.',
  },
  registration: {
    list: 'regPings',
    label: 'reg reminders',
    on: 'You\'ll get the Reg Reminders role and its pings for tracked tournaments.',
    off: 'No more reg reminder pings.',
  },
  dm_registration: {
    list: 'regDmPings',
    label: 'registration DMs',
    on: 'You\'ll get a DM 1 hour before registration closes, with the link, location and tournament image. Skipped once you\'re registered.',
    off: 'No more registration DMs.',
  },
  dm_start: {
    list: 'startDmPings',
    label: 'start DMs',
    on: 'You\'ll get a DM 1 hour before the tournament starts, with the link, location and tournament image.',
    off: 'No more start DMs.',
  },
};

const CALLS_OFF = '-# Match calls are off for the whole server, `/messages calls` turns them on.';

// the same words about someone else
const say = (self, text) => (self ? text : text.replaceAll('You\'ll', 'They\'ll').replaceAll('your', 'their').replaceAll('you\'re', 'they\'re'));

// where someone's pings are at, plus their posts if they're tracked. name is whose when
// it isn't whoever ran it, already escaped
function notifyText(discordId, me, name = null) {
  const has = (ping) => state[PINGS[ping].list].includes(discordId);
  const yours = !name;
  // match calls and stream alerts go by start.gg, so they're on in name only until there's an account
  const byStartgg = (ping) => {
    if (!has(ping)) return 'off';
    return me ? 'on' : `on, but nothing to go by ${yours ? 'until you `/link`' : 'until they `/link`'}`;
  };
  const lines = [
    yours ? '**Your pings**' : `**${name}'s pings**`,
    `**Match calls:** ${byStartgg('calls')}`,
    `**Stream alerts:** ${byStartgg('streams')}`,
    `**Reg reminders:** ${has('registration') ? 'on' : 'off'}`,
    `**Registration DMs:** ${has('dm_registration') ? 'on' : 'off'}`,
    `**Start DMs:** ${has('dm_start') ? 'on' : 'off'}`,
  ];
  if (me && state.players[me.userId]) {
    const posts = `with set results ${isOn(me, 'setResults') ? 'on' : 'off'} and stream alerts ${isOn(me, 'streamAlerts') ? 'on' : 'off'}. \`/track posts\` changes those`;
    lines.push(yours ? `-# You're tracked as ${escapeMarkdown(me.tag)}, ${posts}` : `-# They're tracked as ${escapeMarkdown(me.tag)}, ${posts}`);
  }
  return lines.join('\n');
}

// saves one person's changes and says what changed. linked is their start.gg, which match calls and stream alerts need
function changePings(discordId, changes, linked, self) {
  const lines = [];
  for (const [ping, on] of Object.entries(changes)) {
    if ((ping === 'calls' || ping === 'streams') && on && !linked) {
      const label = ping === 'calls' ? 'Match call' : 'Stream alert';
      lines.push(self
        ? `${label} pings need your start.gg, so \`/link\` first. Leave out the link and it finds yours.`
        : `${label} pings need their start.gg. Ask them to run \`/link\` with their profile link.`);
      continue;
    }
    const list = PINGS[ping].list;
    state[list] = state[list].filter((each) => each !== discordId);
    if (on) state[list].push(discordId);
    lines.push(say(self, PINGS[ping][on ? 'on' : 'off']));
  }
  save();
  if (changes.calls && linked && !messageEnabled('calls')) lines.push(CALLS_OFF);
  return lines;
}

// the Reg Reminders role shows who has registration on. it's made the first time, and has to be mentionable
// or the reg reminder that pings it notifies nobody
async function setRegRole(guild, member, on) {
  let role = guild.roles.cache.find((each) => each.name === REG_ROLE);
  if (!on) {
    if (role) await member.roles.remove(role);
    return;
  }
  if (!role) {
    role = await guild.roles.create({ name: REG_ROLE, permissions: [], mentionable: true, reason: 'shows who has /notify registration on' });
  } else if (!role.mentionable) {
    await role.edit({ mentionable: true }, 'reg reminders ping this role').catch(() => {});
  }
  await member.roles.add(role);
}

// after the defer, since handing out a role can take discord past the 3 seconds a command gets
async function replyWithRegRole(interaction, member, on, self, lines) {
  try {
    if (member) await setRegRole(interaction.guild, member, on);
  } catch (err) {
    // missing permissions. the pings still work without the role
    if (err.code !== 50013) throw err;
    lines.push(say(self, `-# I couldn't change your ${REG_ROLE} role though, that needs Manage Roles and my role above it.`));
  }
  return interaction.editReply(lines.join('\n'));
}

// tracked players with a discord to ping. bulk only touches these, leaving linked-only pings alone
function eligibleNotify() {
  return Object.values(state.players).filter((player) => player.discordId);
}

// "Match calls on and stream alerts off", capitalized like /track posts
function notifyChangesText(changes) {
  const parts = Object.entries(changes).map(([ping, on]) => `${PINGS[ping].label} ${on ? 'on' : 'off'}`);
  const text = new Intl.ListFormat('en').format(parts);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// short so the button id stays under discord's 100 characters, even with all five and a long discord id.
// one char per ping in PINGS order: 1 on, 0 off, - left alone. the old longer form still decodes for buttons already out
const PING_ORDER = Object.keys(PINGS);
function encodeNotifyChanges(changes) {
  return PING_ORDER.map((ping) => (changes[ping] === undefined ? '-' : changes[ping] ? '1' : '0')).join('');
}

function decodeNotifyChanges(target) {
  const changes = {};
  if (target.length === PING_ORDER.length && /^[01-]+$/.test(target)) {
    PING_ORDER.forEach((ping, i) => {
      if (target[i] !== '-') changes[ping] = target[i] === '1';
    });
    return changes;
  }
  // calls-on_streams-off
  for (const part of target.split('_')) {
    const [ping, on] = part.split('-');
    if (PINGS[ping]) changes[ping] = on === 'on';
  }
  return changes;
}

// bulk only adds or removes the tracked discord ids, so someone who only /linked keeps theirs
function applyNotifyBulk(changes) {
  const eligible = eligibleNotify();
  const ids = new Set(eligible.map((player) => player.discordId));
  for (const [ping, on] of Object.entries(changes)) {
    const list = PINGS[ping].list;
    state[list] = state[list].filter((each) => !ids.has(each));
    if (on) state[list].push(...ids);
  }
  save();
  const skipped = Object.keys(state.players).length - eligible.length;
  let content = `Updated /notify for ${count(eligible.length, 'tracked player')}.`;
  if (skipped) content += ` Skipped ${skipped} without Discord on start.gg.`;
  if (changes.calls && !messageEnabled('calls')) content += `\n${CALLS_OFF}`;
  return { content };
}

confirmable('notify_all', {
  command: '/notify player:all',
  run: (target) => applyNotifyBulk(decodeNotifyChanges(target)),
  cancel: () => 'Bulk ping changes stay the way they were.',
});

// player:all, TOs only. looking counts everyone, changing asks first
function notifyEveryone(interaction, changes) {
  const players = Object.values(state.players);
  const eligible = eligibleNotify();
  const skipped = players.length - eligible.length;
  if (!Object.keys(changes).length) {
    if (!players.length) return replyEphemeral(interaction, 'Nobody is tracked yet, `/track add` someone first.');
    const on = (ping) => eligible.filter((player) => state[PINGS[ping].list].includes(player.discordId)).length;
    return replyEphemeral(interaction, `**Pings for ${count(eligible.length, 'tracked player')}**\n`
      + `**Match calls:** on for ${on('calls')} · **Stream alerts:** on for ${on('streams')}\n`
      + `**Reg reminders:** on for ${on('registration')} · **Registration DMs:** on for ${on('dm_registration')} · **Start DMs:** on for ${on('dm_start')}`
      + (skipped ? `\n-# ${count(skipped, 'tracked player has', 'tracked players have')} no Discord on start.gg and stay${skipped === 1 ? 's' : ''} out` : ''));
  }
  if (!eligible.length) return replyEphemeral(interaction, 'No tracked players have Discord connected on start.gg, so there is nobody to ping.');
  const question = `Change /notify for ${count(eligible.length, 'tracked player')}? ${notifyChangesText(changes)}.`
    + (skipped ? ` ${count(skipped, 'tracked player')} without Discord on start.gg will be skipped.` : '');
  return askFirst(interaction, 'notify_all', encodeNotifyChanges(changes), question, 'Change pings');
}

// player:, TOs only. it goes by the discord on their start.gg, since they might not be a member to pick
async function notifyPlayer(interaction, changes) {
  const player = readTracked(interaction);
  if (!player) return replyNotTracked(interaction);
  const tag = escapeMarkdown(player.tag);
  const id = player.discordId;
  if (!Object.keys(changes).length) return replyEphemeral(interaction, notifyText(id ?? '', id && (linkedPlayer(id) ?? player), tag));
  if (!id) return replyEphemeral(interaction, `${tag} has no Discord connected on start.gg, so there is nobody to ping.`);

  const lines = changePings(id, changes, linkedPlayer(id), false);
  if (!Object.hasOwn(changes, 'registration')) return replyEphemeral(interaction, lines.join('\n'));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = await interaction.guild.members.fetch(id).catch(() => null);
  return replyWithRegRole(interaction, member, changes.registration, false, lines);
}

// yours, or a member's picked with user:, which only TOs can do
async function notifyMember(interaction, picked, changes) {
  const target = picked ?? interaction.user;
  const self = target.id === interaction.user.id;
  if (picked?.bot) return replyEphemeral(interaction, 'Bots don\'t need pings.');
  const member = picked ? interaction.options.getMember('user') : interaction.member;
  if (picked && !member) return replyEphemeral(interaction, 'Pick someone in this server.');
  if (!self && !isTO(interaction)) return notTO(interaction, 'see or change someone else\'s pings. Leave out `user` for yours');

  const me = linkedPlayer(target.id);
  if (!Object.keys(changes).length) {
    const name = self ? null : escapeMarkdown(member.displayName ?? target.displayName ?? target.username);
    return replyEphemeral(interaction, notifyText(target.id, me, name));
  }
  const lines = changePings(target.id, changes, me, self);
  if (!Object.hasOwn(changes, 'registration')) return replyEphemeral(interaction, lines.join('\n'));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return replyWithRegRole(interaction, member, changes.registration, self, lines);
}

// /notify: your pings, or anyone's for a TO with user: or player:. user: takes a server member,
// player: a tracked player or all. only one of them
function notify(interaction) {
  const picked = interaction.options.getUser('user');
  const player = interaction.options.getString('player');
  if (picked && player !== null) return replyEphemeral(interaction, 'Pick either `user` or `player`, not both.');

  const all = interaction.options.getString('all');
  const changes = {};
  for (const ping of Object.keys(PINGS)) {
    const value = interaction.options.getString(ping) ?? all;
    if (value) changes[ping] = value === 'on';
  }
  if (player === null) return notifyMember(interaction, picked, changes);
  if (player.toLowerCase() === 'all') {
    if (!isTO(interaction)) return notTO(interaction, 'see or change everyone\'s pings. Leave out `player` for yours');
    return notifyEveryone(interaction, changes);
  }
  if (!isTO(interaction)) return notTO(interaction, 'see or change a tracked player\'s pings. Leave out `player` for yours');
  return notifyPlayer(interaction, changes);
}

// what the bot can't post without, named the way discord's settings show them
const POSTING = { ViewChannel: 'View Channel', SendMessages: 'Send Messages', EmbedLinks: 'Embed Links' };

// /setup: where this server's automatic posts go. one channel per server, saved as
// state.channelId, so each server's sets, roll calls and reminders stay on its own data.
// the permissions get checked here, since a channel the bot can't post in loses every post quietly
function setupPosts(interaction) {
  if (!interaction.guildId && !interaction.guild?.id) return replyEphemeral(interaction, 'Run `/setup` in a server, not in DMs.');
  // anyone can look
  const channel = interaction.options.getChannel('channel');
  if (!channel) {
    return interaction.reply({
      content: state.channelId ? `Automatic posts go in <#${state.channelId}>.` : 'No posts channel set yet. Run `/setup channel:#channel`.',
      allowedMentions: { parse: [] },
    });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !isTO(interaction)) {
    return replyEphemeral(interaction, 'You need Manage Server or the TO role to pick the posts channel.');
  }
  if (!channel.isTextBased?.()) return replyEphemeral(interaction, 'Pick a text channel.');
  // a channel discord didn't send in full has no permissionsFor, and goes unchecked
  const has = channel.permissionsFor?.(interaction.client.user);
  const missing = has ? Object.keys(POSTING).filter((name) => !has.has(PermissionFlagsBits[name])).map((name) => POSTING[name]) : [];
  if (missing.length) {
    return replyEphemeral(interaction, `I need ${new Intl.ListFormat('en').format(missing)} in <#${channel.id}> to post there. Add them to my role or the channel, then try again.`);
  }
  state.channelId = channel.id;
  save();
  const lines = [`Automatic posts go in <#${channel.id}>.`];
  if (has && !has.has(PermissionFlagsBits.AttachFiles)) lines.push('-# Without Attach Files there, posts that upload character art, rank badges or the Slippi logo fail.');
  // a tracked tournament always posts in a thread, whatever /messages threads says
  const threads = missingThreadPermissions(channel);
  if (threads?.length) lines.push(`-# Without ${threads.join(' and ')} there, set results and stream alerts post in the channel instead of threads.`);
  return interaction.reply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

export { configureMessages, setupPosts, socialsAdd, socialsRemove, trackPosts, notify };
