import { MessageFlags, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { isMultiGuild, postsChannelId, state, save } from '../store.js';
import { currentChannel, missingThreadPermissions, secondsNow } from '../tracker.js';
import { POSTING_PERMISSIONS } from '../tracker/shared.js';
import {
  MAX_EVENT_LENGTH_HOURS, MESSAGE_TYPES, MIN_EVENT_LENGTH_HOURS, REG_ROLE, THREAD_MODES, WEEKDAYS, messageSettings, postsOn,
} from '../message-settings.js';
import { cantMakeEvents } from '../discord-events.js';
import { switchFunLanguage } from '../fun/index.js';
import { count } from '../embeds/shared.js';
import { commandsFor, LANGUAGES, language, listOf, permissionList, t } from '../i18n.js';
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

// the recap timezone's autocomplete: zones with what's typed in them, the usual ones when nothing is
const COMMON_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'UTC'];
function timezoneChoices(focused) {
  const typed = focused.trim().toLowerCase().replaceAll(' ', '_');
  const zones = typed ? Intl.supportedValuesOf('timeZone').filter((zone) => zone.toLowerCase().includes(typed)) : COMMON_ZONES;
  return zones.slice(0, 25).map((zone) => ({ name: zone, value: zone }));
}

// the channels a TO limited the bot's commands to with commands_channel, none meaning every channel. a deleted
// one stops counting, so a server can't end up with nowhere left to use the bot
function commandChannels(guild) {
  const cache = guild?.channels?.cache;
  return (state.messages.commandChannels ?? []).filter((id) => !cache || cache.has(id));
}

// every server setting lives on /t-o settings. leaving the options blank shows them all.
async function configureSettings(interaction) {
  const fail = (content) => replyEphemeral(interaction, content);
  const previous = messageSettings();
  const changes = {};
  for (const type of Object.keys(MESSAGE_TYPES)) {
    const value = interaction.options.getBoolean(type);
    if (value !== null) changes[type] = value;
  }
  const setColors = interaction.options.getBoolean('set_colors');
  if (setColors !== null) changes.setColors = setColors;
  const day = interaction.options.getInteger('day');
  if (day !== null) changes.recapDay = day;
  const time = interaction.options.getString('time')?.trim();
  if (time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return fail(t('Use a 24-hour time in HH:MM format, like 09:00 or 21:30.'));
    changes.recapTime = time;
  }
  const timezone = interaction.options.getString('timezone')?.trim();
  if (timezone !== undefined) {
    try {
      changes.timezone = new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
    } catch {
      return fail(t('Unknown timezone. Use one like America/New_York, America/Los_Angeles, Europe/London or UTC.'));
    }
  }
  const threads = interaction.options.getString('threads');
  if (threads !== null) changes.threads = threads;
  const eventLength = interaction.options.getInteger('event_length');
  if (eventLength !== null) {
    if (!Number.isInteger(eventLength) || eventLength < MIN_EVENT_LENGTH_HOURS || eventLength > MAX_EVENT_LENGTH_HOURS) {
      return fail(t`Event length is ${MIN_EVENT_LENGTH_HOURS} to ${MAX_EVENT_LENGTH_HOURS} hours, like 5.`);
    }
    changes.eventLength = eventLength;
  }
  const pickedLanguage = interaction.options.getString('language');
  if (pickedLanguage !== null) {
    if (!Object.hasOwn(LANGUAGES, pickedLanguage)) return fail(t('Pick English or Español.'));
    changes.language = pickedLanguage;
  }
  // picking a channel adds it to the list, or takes it off if it's already there
  const commandsChannel = interaction.options.getChannel?.('commands_channel');
  const anywhere = interaction.options.getBoolean('commands_anywhere');
  if (commandsChannel && anywhere) return fail(t('Pick either `commands_channel` or `commands_anywhere:True`, not both.'));
  if (anywhere) changes.commandChannels = [];
  if (commandsChannel) {
    const saved = commandChannels(interaction.guild);
    changes.commandChannels = saved.includes(commandsChannel.id)
      ? saved.filter((id) => id !== commandsChannel.id)
      : [...saved, commandsChannel.id];
  }
  const channel = interaction.options.getChannel?.('channel');

  if (!Object.keys(changes).length && !channel) return replyEphemeral(interaction, settingsText(interaction.guild));
  if (!isTO(interaction)) return notTO(interaction, t('change server settings'));
  // checked when it's turned on, the way threads are, so a missing permission doesn't fail quietly later
  if (changes.events && !previous.events) {
    const cant = cantMakeEvents(interaction.guild);
    if (cant) return fail(cant);
  }
  if (changes.threads && changes.threads !== 'off') {
    // checked when it's turned on so it doesn't wait for the next tournament to find out. in the posts
    // channel, not wherever this ran. a multi-server build with no posts channel yet posts nothing, and
    // /t-o settings checks threads when it picks a channel
    const channelId = channel?.id ?? postsChannelId();
    const postChannel = channel ?? (channelId && (interaction.client.channels.cache.get(channelId) ?? currentChannel()));
    if (postChannel) {
      const missing = missingThreadPermissions(postChannel);
      if (!missing) return fail(t`Threads can't be started in <#${channelId}>, so posts stay in the channel.`);
      if (missing.length) return fail(t`I need ${permissionList(missing)} in <#${channelId}> to start threads. Add them to my role or the channel, then try again.`);
    }
  }
  const channelLines = channel ? channelChange(interaction, channel) : [];
  if (typeof channelLines === 'string') return fail(channelLines);

  const now = secondsNow();
  // anything that came due while one was off stays skipped once it's back on
  const reenabled = Object.keys(MESSAGE_TYPES).filter((type) => changes[type] && !previous[type]);
  if (reenabled.length) changes.enabledAt = { ...previous.enabledAt, ...Object.fromEntries(reenabled.map((type) => [type, now])) };
  // a new schedule starts with the next recap
  if (['recapDay', 'recapTime', 'timezone'].some((key) => Object.hasOwn(changes, key) && changes[key] !== previous[key])) {
    changes.recapChangedAt = now;
  }
  state.messages = { ...state.messages, ...changes };
  if (channel) state.channelId = channel.id;
  save();
  if (pickedLanguage) switchFunLanguage(pickedLanguage);
  await interaction.reply({
    content: [settingsText(interaction.guild), ...channelLines].join('\n'),
    allowedMentions: { parse: [] },
  });
  // a single-server build registers its commands in the server's language, so their descriptions switch too.
  // multi-server commands are global, so there each person's own discord language picks. the setting already
  // saved either way, so a failed registration only gets logged
  if (pickedLanguage && !isMultiGuild()) {
    const { commands } = await import('./definitions.js');
    await interaction.guild?.commands?.set(commandsFor(commands, pickedLanguage))
      .catch((err) => console.error('registering the commands in the new language failed:', err.message));
  }
}

// every setting, shown when /t-o settings has no options and after a change
function settingsText(guild) {
  const settings = messageSettings();
  const commandsIn = commandChannels(guild);
  const onOff = (on) => (on ? t('on') : t('off'));
  const lines = [t('**Automatic posts**')];
  for (const [key, label] of Object.entries(MESSAGE_TYPES)) {
    if (key === 'recap') continue;
    lines.push(t`**${t(label)}:** ${onOff(settings[key])}`);
  }
  lines.push(t`**Threads:** ${t(THREAD_MODES[settings.threads])}`);
  lines.push(t`**Event length:** ${settings.eventLength} hours`);
  lines.push(t`**Set result colors:** ${onOff(settings.setColors)}`);
  lines.push(t`**Language:** ${LANGUAGES[language()]}`);
  if (isMultiGuild()) lines.push(state.channelId ? t`**Posts channel:** <#${state.channelId}>` : t('**Posts channel:** not set'));
  lines.push(commandsIn.length ? t`**Bot commands:** ${listOf(commandsIn.map((id) => `<#${id}>`))}` : t('**Bot commands:** every channel'));
  lines.push('', t('**Weekly recap**'),
    t`**Posts:** ${onOff(settings.recap)} · **Day and time:** ${t(WEEKDAYS[settings.recapDay])} ${settings.recapTime} ${zoneLabel(settings.timezone)}`,
    t('-# Set results, stream alerts, match calls, next opponents, top 8s and reg reminders here are the default for every tournament. /t-o tournament posts changes one tournament.'),
    t('-# Stream alerts, match calls and next opponents still going on post when switched back on. Anything else missed while off stays skipped. Recap schedule changes apply to future recaps.'),
    t('-# `events` makes a Discord event for each upcoming tracked tournament, once each. Needs Manage Events'),
    t('-# `threads` has three modes for set results, stream alerts, match calls and next opponents. Off posts them here, except a tracked tournament\'s, which always get a thread. One per tournament gives each tournament a thread, and one per event gives each event its own, like Genesis 11 · Ultimate Singles. Each thread pins its channel card until the tournament or event ends.'),
    t('-# `set_colors` paints set result cards green for a tracked win, red for a loss, gold when two tracked players meet and blue when nobody tracked played. Off leaves every card blue.'),
    t('-# `event_length` is how long a Discord event runs when start.gg has no end time. A major or regional with no end time still gets 12 hours.'),
    t('-# `commands_channel` limits bot commands to the channels picked, threads in them included. Picking one again takes it off, and `commands_anywhere:True` clears the list. `/t-o` works everywhere.'));
  return lines.join('\n');
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
  if (!url) return reply(t('That isn\'t a web link. Paste the profile, channel or page link.'));
  if (url.length > SOCIAL_URL_LENGTH) return reply(t`Links can be up to ${SOCIAL_URL_LENGTH} characters.`);

  const listed = state.socials.find((social) => social.url === url);
  if (listed) return reply(t`That link is already in \`/socials\` under ${escapeMarkdown(listed.name)}.`);

  // "716 esports" goes on the same line as "716 Esports", spelled like the first one
  const name = state.socials.find((social) => social.name.toLowerCase() === typed.toLowerCase())?.name ?? typed;
  state.socials.push({ name, url });
  save();
  return reply(t`Added ${url} under ${escapeMarkdown(name)}.`);
}

function socialsRemove(interaction) {
  // autocomplete sends the saved link, typing it out might leave off the https
  const url = socialUrl(interaction.options.getString('link', true));
  const social = state.socials.find((each) => each.url === url);
  if (!social) return replyEphemeral(interaction, t('That link isn\'t in `/socials`. Pick one from the list.'));

  state.socials = state.socials.filter((each) => each !== social);
  save();
  return replyEphemeral(interaction, t`Removed ${social.url} from ${escapeMarkdown(social.name)}.`);
}

// /track posts switches and the player field each one sets. onAt saves when set results went from off to on,
// since the set check never asked start.gg about sets from while they were off
const POST_SWITCHES = {
  sets: { field: 'setResults', onAt: 'setResultsOnAt' },
  stream: { field: 'streamAlerts' },
};
// players saved before set results and stream alerts started off have no field, which counts as on
const isOn = (player, field) => player[field] !== false;

// Set results on and stream alerts off, or Set results and stream alerts on when they match
function switchesText({ sets, stream }) {
  if (stream === undefined) return sets ? t('Set results on') : t('Set results off');
  if (sets === undefined) return stream ? t('Stream alerts on') : t('Stream alerts off');
  if (sets === stream) return sets ? t('Set results and stream alerts on') : t('Set results and stream alerts off');
  return sets ? t('Set results on and stream alerts off') : t('Set results off and stream alerts on');
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
  const who = choice === 'all' ? t('everyone') : escapeMarkdown(choice.tag);
  return t`${switchesText(changes)} for ${who}.`;
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
  cancel: () => t('Set results stay the way they were.'),
});

// where a player's or everyone's are at, for /track posts with no switches
function postsText(choice) {
  if (choice !== 'all') {
    const tag = escapeMarkdown(choice.tag);
    const setOn = isOn(choice, 'setResults');
    const streamOn = isOn(choice, 'streamAlerts');
    if (setOn && streamOn) return t`${tag}: set results on, stream alerts on.`;
    if (setOn && !streamOn) return t`${tag}: set results on, stream alerts off.`;
    if (!setOn && streamOn) return t`${tag}: set results off, stream alerts on.`;
    return t`${tag}: set results off, stream alerts off.`;
  }
  const players = Object.values(state.players);
  const on = (field) => players.filter((player) => isOn(player, field)).length;
  return t`Set results are on for ${on('setResults')} and stream alerts for ${on('streamAlerts')} of the ${count(players.length, 'tracked player')}.`;
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
  if (choice === 'all' && !isTO(interaction)) return notTO(interaction, t('change everyone\'s posts'));
  if (choice !== 'all' && !isSelf(interaction, choice) && !isTO(interaction)) return notTO(interaction, t('change someone else\'s posts. Leave out `player` to change yours'));

  // nothing to lose when it's already off for everyone
  const players = Object.values(state.players);
  if (choice === 'all' && changes.sets === false && players.some((player) => isOn(player, 'setResults'))) {
    const target = { true: 'all-stream-on', false: 'all-stream-off' }[changes.stream] ?? 'all';
    return askFirst(interaction, 'sets_off', target, t`Turn set results off for all ${players.length} tracked players? Sets they finish while it's off never get posted, even after it's back on.`, t('Turn off'));
  }
  return interaction.reply({ content: flipPosts(choice, changes), allowedMentions: { parse: [] } });
}

// what each /notify switch keeps a list of, how the bulk question names a change, lowercase since that capitalizes
// only the first letter like /track posts, and what the reply says, to whoever ran it when self or about someone else.
// the ones that go by start.gg say what's missing without a /link, and what turning them on means while the server
// switch of the same name has them off by default
const PINGS = {
  calls: {
    list: 'callPings',
    changed: (on) => (on ? t('match calls on') : t('match calls off')),
    on: (self) => (self ? t('You\'ll get pinged when your match is called.') : t('They\'ll get pinged when their match is called.')),
    off: () => t('No more match call pings.'),
    unlinked: (self) => (self
      ? t('Match call pings need your start.gg, so `/link` first. Leave out the link and it finds yours.')
      : t('Match call pings need their start.gg. Ask them to run `/link` with their profile link.')),
    serverOff: () => t('-# Match calls are off by default for tournaments, so pings only come where `/t-o tournament posts` turned them on.'),
  },
  next: {
    list: 'nextPings',
    changed: (on) => (on ? t('next opponents on') : t('next opponents off')),
    on: (self) => (self ? t('You\'ll get pinged when your next opponent is set.') : t('They\'ll get pinged when their next opponent is set.')),
    off: () => t('No more next opponent pings.'),
    unlinked: (self) => (self
      ? t('Next opponent pings need your start.gg, so `/link` first. Leave out the link and it finds yours.')
      : t('Next opponent pings need their start.gg. Ask them to run `/link` with their profile link.')),
    serverOff: () => t('-# Next opponents are off by default for tournaments, so pings only come where `/t-o tournament posts` turned them on.'),
  },
  streams: {
    list: 'streamPings',
    changed: (on) => (on ? t('stream alerts on') : t('stream alerts off')),
    on: (self) => (self ? t('You\'ll get pinged when your set is on stream.') : t('They\'ll get pinged when their set is on stream.')),
    off: () => t('No more stream alert pings.'),
    unlinked: (self) => (self
      ? t('Stream alert pings need your start.gg, so `/link` first. Leave out the link and it finds yours.')
      : t('Stream alert pings need their start.gg. Ask them to run `/link` with their profile link.')),
    serverOff: () => t('-# Stream alerts are off by default for tournaments, so pings only come where `/t-o tournament posts` turned them on.'),
  },
  registration: {
    list: 'regPings',
    changed: (on) => (on ? t('reg reminders on') : t('reg reminders off')),
    on: (self) => (self
      ? t('You\'ll get the Reg Reminders role and its pings for tracked tournaments.')
      : t('They\'ll get the Reg Reminders role and its pings for tracked tournaments.')),
    off: () => t('No more reg reminder pings.'),
  },
  dm_registration: {
    list: 'regDmPings',
    changed: (on) => (on ? t('registration DMs on') : t('registration DMs off')),
    on: (self) => (self
      ? t('You\'ll get a DM 1 hour before registration closes, with the link, location and tournament image. Skipped once you\'re registered.')
      : t('They\'ll get a DM 1 hour before registration closes, with the link, location and tournament image. Skipped once they\'re registered.')),
    off: () => t('No more registration DMs.'),
  },
  dm_start: {
    list: 'startDmPings',
    changed: (on) => (on ? t('start DMs on') : t('start DMs off')),
    on: (self) => (self
      ? t('You\'ll get a DM 1 hour before the tournament starts, with the link, location and tournament image.')
      : t('They\'ll get a DM 1 hour before the tournament starts, with the link, location and tournament image.')),
    off: () => t('No more start DMs.'),
  },
};

// footnotes for pings just turned on whose server switch is off
const pingsOff = (changes) => Object.keys(changes).filter((ping) => changes[ping] && PINGS[ping].serverOff && !postsOn(ping)).map((ping) => PINGS[ping].serverOff());

// where someone's pings are at, plus their posts if they're tracked. name is whose when
// it isn't whoever ran it, already escaped
function notifyText(discordId, me, name = null) {
  const has = (ping) => state[PINGS[ping].list].includes(discordId);
  const yours = !name;
  // match calls, next opponents and stream alerts go by start.gg, so they're on in name only until there's an account
  const byStartgg = (ping) => {
    if (!has(ping)) return t('off');
    if (me) return t('on');
    return yours ? t('on, but nothing to go by until you `/link`') : t('on, but nothing to go by until they `/link`');
  };
  const onOff = (on) => (on ? t('on') : t('off'));
  const lines = [
    yours ? t('**Your pings**') : t`**${name}'s pings**`,
    t`**Match calls:** ${byStartgg('calls')}`,
    t`**Next opponents:** ${byStartgg('next')}`,
    t`**Stream alerts:** ${byStartgg('streams')}`,
    t`**Reg reminders:** ${onOff(has('registration'))}`,
    t`**Registration DMs:** ${onOff(has('dm_registration'))}`,
    t`**Start DMs:** ${onOff(has('dm_start'))}`,
  ];
  if (me && state.players[me.userId]) {
    const setOn = onOff(isOn(me, 'setResults'));
    const streamOn = onOff(isOn(me, 'streamAlerts'));
    const posts = t`with set results ${setOn} and stream alerts ${streamOn}. \`/track posts\` changes those`;
    lines.push(yours ? t`-# You're tracked as ${escapeMarkdown(me.tag)}, ${posts}` : t`-# They're tracked as ${escapeMarkdown(me.tag)}, ${posts}`);
  }
  return lines.join('\n');
}

// saves one person's changes and says what changed. linked is their start.gg, which match calls, next opponents and
// stream alerts need
function changePings(discordId, changes, linked, self) {
  const lines = [];
  const saved = {};
  for (const [ping, on] of Object.entries(changes)) {
    if (PINGS[ping].unlinked && on && !linked) {
      lines.push(PINGS[ping].unlinked(self));
      continue;
    }
    const list = PINGS[ping].list;
    state[list] = state[list].filter((each) => each !== discordId);
    if (on) state[list].push(discordId);
    saved[ping] = on;
    lines.push(on ? PINGS[ping].on(self) : PINGS[ping].off());
  }
  save();
  return [...lines, ...pingsOff(saved)];
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
    lines.push(self
      ? t`-# I couldn't change your ${REG_ROLE} role though, that needs Manage Roles and my role above it.`
      : t`-# I couldn't change their ${REG_ROLE} role though, that needs Manage Roles and my role above it.`);
  }
  return interaction.editReply(lines.join('\n'));
}

// tracked players with a discord to ping. bulk only touches these, leaving linked-only pings alone
function eligibleNotify() {
  return Object.values(state.players).filter((player) => player.discordId);
}

// "Match calls on and stream alerts off", capitalized like /track posts
function notifyChangesText(changes) {
  const text = listOf(Object.entries(changes).map(([ping, on]) => PINGS[ping].changed(on)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// short so the button id stays under discord's 100 characters, even with all six and a long discord id.
// one char per ping in PINGS order: 1 on, 0 off, - left alone. the old longer form still decodes for buttons already out
const PING_ORDER = Object.keys(PINGS);
function encodeNotifyChanges(changes) {
  return PING_ORDER.map((ping) => {
    if (changes[ping] === undefined) return '-';
    return changes[ping] ? '1' : '0';
  }).join('');
}

// Change pings buttons from before next opponents carry one char for each of these. the question never expires
const OLD_PING_ORDER = ['calls', 'streams', 'registration', 'dm_registration', 'dm_start'];

function decodeNotifyChanges(target) {
  const changes = {};
  const order = [PING_ORDER, OLD_PING_ORDER].find((each) => each.length === target.length);
  if (order && /^[01-]+$/.test(target)) {
    order.forEach((ping, i) => {
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
  let content = t`Updated /notify for ${count(eligible.length, 'tracked player')}.`;
  if (skipped) content += t` Skipped ${skipped} without Discord on start.gg.`;
  return { content: [content, ...pingsOff(changes)].join('\n') };
}

confirmable('notify_all', {
  command: '/notify player:all',
  run: (target) => applyNotifyBulk(decodeNotifyChanges(target)),
  cancel: () => t('Bulk ping changes stay the way they were.'),
});

// player:all, TOs only. looking counts everyone, changing asks first
function notifyEveryone(interaction, changes) {
  const players = Object.values(state.players);
  const eligible = eligibleNotify();
  const skipped = players.length - eligible.length;
  if (!Object.keys(changes).length) {
    if (!players.length) return replyEphemeral(interaction, t('Nobody is tracked yet, `/track add` someone first.'));
    const on = (ping) => eligible.filter((player) => state[PINGS[ping].list].includes(player.discordId)).length;
    const summary = `${t`**Pings for ${count(eligible.length, 'tracked player')}**`}\n`
      + `${t`**Match calls:** on for ${on('calls')} · **Next opponents:** on for ${on('next')} · **Stream alerts:** on for ${on('streams')}`}\n`
      + `${t`**Reg reminders:** on for ${on('registration')} · **Registration DMs:** on for ${on('dm_registration')} · **Start DMs:** on for ${on('dm_start')}`}`
      + (skipped ? `\n${skipped === 1 ? t('-# 1 tracked player has no Discord on start.gg and stays out') : t`-# ${skipped} tracked players have no Discord on start.gg and stay out`}` : '');
    return replyEphemeral(interaction, summary);
  }
  if (!eligible.length) return replyEphemeral(interaction, t('No tracked players have Discord connected on start.gg, so there is nobody to ping.'));
  const base = t`Change /notify for ${count(eligible.length, 'tracked player')}? ${notifyChangesText(changes)}.`;
  const question = base + (skipped ? t` ${count(skipped, 'tracked player')} without Discord on start.gg will be skipped.` : '');
  return askFirst(interaction, 'notify_all', encodeNotifyChanges(changes), question, t('Change pings'));
}

// player:, TOs only. it goes by the discord on their start.gg, since they might not be a member to pick
async function notifyPlayer(interaction, changes) {
  const player = readTracked(interaction);
  if (!player) return replyNotTracked(interaction);
  const tag = escapeMarkdown(player.tag);
  const id = player.discordId;
  if (!Object.keys(changes).length) return replyEphemeral(interaction, notifyText(id ?? '', id && (linkedPlayer(id) ?? player), tag));
  if (!id) return replyEphemeral(interaction, t`${tag} has no Discord connected on start.gg, so there is nobody to ping.`);

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
  if (picked?.bot) return replyEphemeral(interaction, t('Bots don\'t need pings.'));
  const member = picked ? interaction.options.getMember('user') : interaction.member;
  if (picked && !member) return replyEphemeral(interaction, t('Pick someone in this server.'));
  if (!self && !isTO(interaction)) return notTO(interaction, t('see or change someone else\'s pings. Leave out `user` for yours'));

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
  if (picked && player !== null) return replyEphemeral(interaction, t('Pick either `user` or `player`, not both.'));

  const all = interaction.options.getString('all');
  const changes = {};
  for (const ping of Object.keys(PINGS)) {
    const value = interaction.options.getString(ping) ?? all;
    if (value) changes[ping] = value === 'on';
  }
  if (player === null) return notifyMember(interaction, picked, changes);
  if (player.toLowerCase() === 'all') {
    if (!isTO(interaction)) return notTO(interaction, t('see or change everyone\'s pings. Leave out `player` for yours'));
    return notifyEveryone(interaction, changes);
  }
  if (!isTO(interaction)) return notTO(interaction, t('see or change a tracked player\'s pings. Leave out `player` for yours'));
  return notifyPlayer(interaction, changes);
}

// null means the channel is usable. a string is the private error, and an array is public notes.
function channelChange(interaction, channel) {
  if (!interaction.guildId && !interaction.guild?.id) return t('Run `/t-o settings` in a server, not in DMs.');
  if (!channel.isTextBased?.()) return t('Pick a text channel.');
  // a channel discord didn't send in full has no permissionsFor, and goes unchecked
  const has = channel.permissionsFor?.(interaction.client.user);
  const missing = has ? Object.keys(POSTING_PERMISSIONS).filter((name) => !has.has(PermissionFlagsBits[name])).map((name) => POSTING_PERMISSIONS[name]) : [];
  if (missing.length) return t`I need ${permissionList(missing)} in <#${channel.id}> to post there. Add them to my role or the channel, then try again.`;
  const lines = [t`Automatic posts go in <#${channel.id}>.`];
  if (has && !has.has(PermissionFlagsBits.AttachFiles)) lines.push(t('-# Without Attach Files there, posts that upload character art, rank badges or the Slippi logo fail.'));
  // a tracked tournament always posts in a thread, whatever /t-o settings threads says
  const threads = missingThreadPermissions(channel);
  if (threads?.length) lines.push(t`-# Without ${permissionList(threads)} there, set results, stream alerts, match calls and next opponents post in the channel instead of threads.`);
  return lines;
}

export { commandChannels, configureSettings, timezoneChoices, socialsAdd, socialsRemove, trackPosts, notify };
