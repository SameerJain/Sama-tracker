import { MessageFlags, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { state, save } from '../store.js';
import { missingThreadPermissions, secondsNow } from '../tracker.js';
import { MESSAGE_TYPES, THREAD_MODES, WEEKDAYS, messageEnabled, messageSettings } from '../message-settings.js';
import { cantMakeEvents } from '../discord-events.js';
import { count } from '../embeds/shared.js';
import { linkedPlayer, readChoice, replyEphemeral, replyNoPlayer } from './shared.js';
import { askFirst, confirmable } from './confirm.js';

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
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return fail('You need Manage Server permission to control automatic messages.');
  const previous = messageSettings();
  const changes = {};
  for (const type of Object.keys(MESSAGE_TYPES)) {
    const value = interaction.options.getBoolean(type);
    if (value !== null) changes[type] = value;
  }
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
    // checked when it's turned on so it doesn't wait for the next tournament to find out
    if (threads !== 'off') {
      const channelId = process.env.CHANNEL_ID;
      const missing = missingThreadPermissions(interaction.client.channels.cache.get(channelId));
      if (!missing) return fail(`Threads can't be started in <#${channelId}>, so posts stay in the channel.`);
      if (missing.length) return fail(`I need ${missing.join(' and ')} in <#${channelId}> to start threads. Add them to my role or the channel, then try again.`);
    }
    changes.threads = threads;
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
  lines.push('', '**Weekly recap**',
    `**Posts:** ${settings.recap ? 'on' : 'off'} · **Day and time:** ${WEEKDAYS[settings.recapDay]} ${settings.recapTime} ${zoneLabel(settings.timezone)}`,
    '-# Posts missed while a message type is off won\'t be sent when you turn it back on. Recap schedule changes apply to future recaps.',
    '-# `events` makes a Discord event for each upcoming tournament tracked from `/tournament admin`, once each. Needs Manage Events',
    '-# `threads` has three modes for set results and stream alerts. Off posts them here, except a tracked tournament\'s, which always get a thread. One per tournament gives each tournament a thread, and one per event gives each event its own, like Genesis 11 · Ultimate Singles. One per tournament pins its channel card until the tournament ends.');
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
    const stream = { 'all-stream-on': true, 'all-stream-off': false }[target];
    return { content: flipPosts('all', { sets: false, ...(stream !== undefined && { stream }) }) };
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

// /track posts: a tracked player's set results and stream alerts, or everyone's with all. anyone can change them
function trackPosts(interaction) {
  const choice = readChoice(interaction, 'player', { trackedOnly: true });
  if (!choice) return replyNoPlayer(interaction, 'player', { trackedOnly: true });
  // someone from /link, their sets and streams never get posted
  if (choice !== 'all' && !state.players[choice.userId]) {
    return replyEphemeral(interaction, `${escapeMarkdown(choice.tag)} isn't tracked, so nothing about them gets posted. \`/track add\` them first.`);
  }

  const changes = {};
  for (const name of Object.keys(POST_SWITCHES)) {
    const value = interaction.options.getString(name);
    if (value) changes[name] = value === 'on';
  }
  if (!Object.keys(changes).length) return interaction.reply({ content: postsText(choice), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

  // nothing to lose when it's already off for everyone
  const players = Object.values(state.players);
  if (choice === 'all' && changes.sets === false && players.some((player) => isOn(player, 'setResults'))) {
    const target = { true: 'all-stream-on', false: 'all-stream-off' }[changes.stream] ?? 'all';
    return askFirst(interaction, 'sets_off', target, `Turn set results off for all ${players.length} tracked players? Sets they finish while it's off never get posted, even after it's back on.`, 'Turn off');
  }
  return interaction.reply({ content: flipPosts(choice, changes), allowedMentions: { parse: [] } });
}

// what each /notify switch keeps a list of, and what the reply says about it
const PINGS = {
  calls: { list: 'callPings', on: 'You\'ll get pinged when your match is called.', off: 'No more match call pings.' },
  streams: { list: 'streamPings', on: 'You\'ll get pinged for every stream alert posted here.', off: 'No more stream alert pings.' },
  registration: {
    list: 'regPings',
    on: 'You\'ll get pinged for reg reminders. If your Discord is connected on start.gg, not for ones you\'re already registered for.',
    off: 'No more reg reminder pings.',
  },
  dm_registration: {
    list: 'regDmPings',
    on: 'You\'ll get a DM 1 hour before registration closes, with the link, location and tournament image. Skipped once you\'re registered.',
    off: 'No more registration DMs.',
  },
  dm_start: {
    list: 'startDmPings',
    on: 'You\'ll get a DM 1 hour before the tournament starts, with the link, location and tournament image.',
    off: 'No more start DMs.',
  },
};

// the role that shows who has reg pings on. pings go off the list, not the role, so people already
// registered can be left out
const REG_ROLE = 'Reg Reminders';

// where someone's pings are at, plus their own posts if they're tracked
function notifyText(discordId, me) {
  const has = (name) => (state[PINGS[name].list] ?? []).includes(discordId);
  let calls = has('calls') ? 'on' : 'off';
  if (has('calls') && !me) calls += ', but nothing to go by until you `/link`';
  const lines = [
    '**Your pings**',
    `**Match calls:** ${calls}`,
    `**Stream alerts:** ${has('streams') ? 'on' : 'off'}`,
    `**Reg reminders:** ${has('registration') ? 'on' : 'off'}`,
    `**Registration DMs:** ${has('dm_registration') ? 'on' : 'off'}`,
    `**Start DMs:** ${has('dm_start') ? 'on' : 'off'}`,
  ];
  if (me && state.players[me.userId]) {
    lines.push(`-# You're tracked as ${escapeMarkdown(me.tag)}, with set results ${isOn(me, 'setResults') ? 'on' : 'off'} and stream alerts ${isOn(me, 'streamAlerts') ? 'on' : 'off'}. \`/track posts\` changes those`);
  }
  return lines.join('\n');
}

// /notify: only ever changes whoever ran it. match calls go by their start.gg, so those need them linked or
// tracked with their discord on start.gg. registration hands out the Reg Reminders role too, which can take
// discord past the 3 seconds a command gets, so that one defers first
async function notify(interaction) {
  const { id } = interaction.user;
  const all = interaction.options.getString('all');
  const changes = {};
  for (const name of Object.keys(PINGS)) {
    const value = interaction.options.getString(name) ?? all;
    if (value) changes[name] = value === 'on';
  }
  const me = linkedPlayer(id);
  if (!Object.keys(changes).length) return replyEphemeral(interaction, notifyText(id, me));

  const lines = [];
  for (const [name, on] of Object.entries(changes)) {
    if (name === 'calls' && on && !me) {
      lines.push('Match call pings need your start.gg, so `/link` first. Leave out the link and it finds yours.');
      continue;
    }
    const list = PINGS[name].list;
    state[list] ??= [];
    state[list] = state[list].filter((each) => each !== id);
    if (on) state[list].push(id);
    lines.push(PINGS[name][on ? 'on' : 'off']);
  }
  save();
  if (changes.calls && me && !messageEnabled('calls')) lines.push('-# Match calls are off for the whole server, `/messages calls` turns them on.');
  if (!Object.hasOwn(changes, 'registration')) return replyEphemeral(interaction, lines.join('\n'));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guild, member } = interaction;
  try {
    let role = guild.roles.cache.find((each) => each.name === REG_ROLE);
    if (changes.registration) {
      role ??= await guild.roles.create({ name: REG_ROLE, reason: 'shows who has /notify registration on' });
      await member.roles.add(role);
    } else if (role) {
      await member.roles.remove(role);
    }
  } catch (err) {
    // missing permissions. the pings still work without the role
    if (err.code !== 50013) throw err;
    lines.push(`-# I couldn't change your ${REG_ROLE} role though, that needs Manage Roles and my role above it.`);
  }
  return interaction.editReply(lines.join('\n'));
}

export { configureMessages, socialsAdd, socialsRemove, trackPosts, notify };
