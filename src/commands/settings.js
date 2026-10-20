import { MessageFlags, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { state, save } from '../store.js';
import { missingThreadPermissions, secondsNow } from '../tracker.js';
import { MESSAGE_TYPES, REG_ROLE, THREAD_MODES, WEEKDAYS, messageEnabled, messageSettings } from '../message-settings.js';
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
  lines.push(`**Set result colors:** ${settings.setColors ? 'on' : 'off'}`);
  lines.push('', '**Weekly recap**',
    `**Posts:** ${settings.recap ? 'on' : 'off'} · **Day and time:** ${WEEKDAYS[settings.recapDay]} ${settings.recapTime} ${zoneLabel(settings.timezone)}`,
    '-# Posts missed while a message type is off won\'t be sent when you turn it back on. Recap schedule changes apply to future recaps.',
    '-# `events` makes a Discord event for each upcoming tracked tournament, once each. Needs Manage Events',
    '-# `threads` has three modes for set results and stream alerts. Off posts them here, except a tracked tournament\'s, which always get a thread. One per tournament gives each tournament a thread, and one per event gives each event its own, like Genesis 11 · Ultimate Singles. Each thread pins its channel card until the tournament or event ends.',
    '-# `set_colors` paints set result cards green for a tracked win, red for a loss, gold when two tracked players meet and purple when nobody tracked played. Off leaves every card green.');
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

// what each /notify switch keeps a list of, and what the reply says about it
const PINGS = {
  calls: { list: 'callPings', on: 'You\'ll get pinged when your match is called.', off: 'No more match call pings.' },
  streams: { list: 'streamPings', on: 'You\'ll get pinged when your set is on stream.', off: 'No more stream alert pings.' },
  registration: {
    list: 'regPings',
    on: 'You\'ll get the Reg Reminders role and its pings for tracked tournaments.',
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

// lowercase for the bulk question, which capitalizes only the first letter like /track posts
const PING_LABELS = {
  calls: 'match calls',
  streams: 'stream alerts',
  registration: 'reg reminders',
  dm_registration: 'registration DMs',
  dm_start: 'start DMs',
};

// imported from message-settings, so the tracker pings the same role /notify hands out

// where someone's pings are at, plus their posts if they're tracked. name is whose when
// it isn't whoever ran it, already escaped
function notifyText(discordId, me, name = null) {
  const has = (ping) => (state[PINGS[ping].list] ?? []).includes(discordId);
  const yours = !name;
  const linkHint = yours ? 'until you `/link`' : 'until they `/link`';
  let calls = has('calls') ? 'on' : 'off';
  if (has('calls') && !me) calls += `, but nothing to go by ${linkHint}`;
  let streams = has('streams') ? 'on' : 'off';
  if (has('streams') && !me) streams += `, but nothing to go by ${linkHint}`;
  const lines = [
    yours ? '**Your pings**' : `**${name}'s pings**`,
    `**Match calls:** ${calls}`,
    `**Stream alerts:** ${streams}`,
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

// tracked players with a discord to ping. bulk only touches these, leaving linked-only pings alone
function eligibleNotify() {
  return Object.values(state.players).filter((player) => player.discordId);
}

// "match calls on and stream alerts off", capitalized like /track posts
function notifyChangesText(changes) {
  const parts = Object.entries(changes).map(([ping, on]) => `${PING_LABELS[ping]} ${on ? 'on' : 'off'}`);
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
  if (target.length === PING_ORDER.length && /^[01-]+$/.test(target)) {
    const changes = {};
    PING_ORDER.forEach((ping, i) => {
      if (target[i] === '1') changes[ping] = true;
      else if (target[i] === '0') changes[ping] = false;
    });
    return changes;
  }
  const changes = {};
  for (const part of target.split('_')) {
    const [ping, on] = part.split('-');
    if (PINGS[ping]) changes[ping] = on === 'on';
  }
  return changes;
}

// bulk only adds or removes the tracked discord ids, so someone who only /linked keeps theirs
function applyNotifyBulk(changes) {
  const players = Object.values(state.players);
  const eligible = players.filter((player) => player.discordId);
  const ids = new Set(eligible.map((player) => player.discordId));
  for (const [ping, on] of Object.entries(changes)) {
    const list = PINGS[ping].list;
    state[list] ??= [];
    state[list] = state[list].filter((each) => !ids.has(each));
    if (on) state[list].push(...ids);
  }
  save();
  const skipped = players.length - eligible.length;
  let content = `Updated /notify for ${count(eligible.length, 'tracked player')}.`;
  if (skipped) content += ` Skipped ${skipped} without Discord on start.gg.`;
  if (changes.calls && !messageEnabled('calls')) content += '\n-# Match calls are off for the whole server, `/messages calls` turns them on.';
  return { content };
}

confirmable('notify_all', {
  command: '/notify player:all',
  run: (target) => applyNotifyBulk(decodeNotifyChanges(target)),
  cancel: () => 'Bulk ping changes stay the way they were.',
});

// /notify: your pings, or anyone's for a TO with user: or player:. user: takes a server member,
// player: a tracked player or all. only one of them, TOs only for anyone else. match calls and
// stream alerts go by start.gg, so those need whoever it's for linked or tracked with their discord
// on start.gg. registration hands out the Reg Reminders role too, which can take discord past the 3
// seconds a command gets, so that one defers first. bulk player:all asks first
async function notify(interaction) {
  const picked = interaction.options.getUser('user');
  const playerRaw = interaction.options.getString('player');
  if (picked && playerRaw !== null) return replyEphemeral(interaction, 'Pick either `user` or `player`, not both.');

  const all = interaction.options.getString('all');
  const changes = {};
  for (const ping of Object.keys(PINGS)) {
    const value = interaction.options.getString(ping) ?? all;
    if (value) changes[ping] = value === 'on';
  }
  // the same words for someone else, with their pronouns
  const say = (self, text) => (self ? text : text.replaceAll('You\'ll', 'They\'ll').replaceAll('your', 'their').replaceAll('you\'re', 'they\'re'));

  // tracked player or everyone tracked, TOs only. user: can't do all, player: can't pick by member
  if (playerRaw !== null) {
    const isAll = playerRaw.toLowerCase() === 'all';
    if (!isTO(interaction)) {
      return isAll
        ? notTO(interaction, 'see or change everyone\'s pings. Leave out `player` for yours')
        : notTO(interaction, 'see or change a tracked player\'s pings. Leave out `player` for yours');
    }
    if (isAll) {
      const players = Object.values(state.players);
      const eligible = players.filter((player) => player.discordId);
      const skipped = players.length - eligible.length;
      if (!Object.keys(changes).length) {
        if (!players.length) return replyEphemeral(interaction, 'Nobody is tracked yet, `/track add` someone first.');
        const on = (ping) => eligible.filter((player) => (state[PINGS[ping].list] ?? []).includes(player.discordId)).length;
        return replyEphemeral(interaction, `**Pings for ${count(eligible.length, 'tracked player')}**\n`
          + `**Match calls:** on for ${on('calls')} · **Stream alerts:** on for ${on('streams')} · **Reg reminders:** on for ${on('registration')}\n`
          + `**Registration DMs:** on for ${on('dm_registration')} · **Start DMs:** on for ${on('dm_start')}`
          + (skipped ? `\n-# ${count(skipped, 'tracked player has', 'tracked players have')} no Discord on start.gg and stay${skipped === 1 ? 's' : ''} out` : ''));
      }
      if (!eligible.length) return replyEphemeral(interaction, 'No tracked players have Discord connected on start.gg, so there is nobody to ping.');
      const text = notifyChangesText(changes);
      const question = `Change /notify for ${count(eligible.length, 'tracked player')}? ${text}.`
        + (skipped ? ` ${count(skipped, 'tracked player')} without Discord on start.gg will be skipped.` : '');
      return askFirst(interaction, 'notify_all', encodeNotifyChanges(changes), question, 'Change pings');
    }

    const player = readTracked(interaction);
    if (!player) return replyNotTracked(interaction);
    const tag = escapeMarkdown(player.tag);
    const id = player.discordId ?? '';
    const me = (id && linkedPlayer(id)) ?? player;
    if (!Object.keys(changes).length) return replyEphemeral(interaction, notifyText(id, me, tag));
    if (!player.discordId) return replyEphemeral(interaction, `${tag} has no Discord connected on start.gg, so there is nobody to ping.`);

    const lines = [];
    for (const [ping, on] of Object.entries(changes)) {
      if ((ping === 'calls' || ping === 'streams') && on && !linkedPlayer(id)) {
        lines.push(`${ping === 'calls' ? 'Match call' : 'Stream alert'} pings need their start.gg. Ask them to run \`/link\` with their profile link.`);
        continue;
      }
      const list = PINGS[ping].list;
      state[list] ??= [];
      state[list] = state[list].filter((each) => each !== id);
      if (on) state[list].push(id);
      lines.push(say(false, PINGS[ping][on ? 'on' : 'off']));
    }
    save();
    if (changes.calls && linkedPlayer(id) && !messageEnabled('calls')) lines.push('-# Match calls are off for the whole server, `/messages calls` turns them on.');
    if (!Object.hasOwn(changes, 'registration')) return replyEphemeral(interaction, lines.join('\n'));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const member = await interaction.guild?.members?.fetch?.(id).catch(() => null)
        ?? interaction.guild?.members?.cache?.get?.(id);
      const role = interaction.guild?.roles?.cache?.find?.((each) => each.name === REG_ROLE);
      if (member && role) {
        if (changes.registration) {
          if (!role.mentionable && role.edit) await role.edit({ mentionable: true }, 'reg reminders ping this role').catch(() => {});
          await member.roles.add(role);
        } else await member.roles.remove(role);
      } else if (member && changes.registration && interaction.guild?.roles?.create) {
        const made = await interaction.guild.roles.create({ name: REG_ROLE, permissions: [], mentionable: true, reason: 'shows who has /notify registration on' });
        await member.roles.add(made);
      }
    } catch (err) {
      if (err.code !== 50013) throw err;
      lines.push(`-# I couldn't change their ${REG_ROLE} role though, that needs Manage Roles and my role above it.`);
    }
    return interaction.editReply(lines.join('\n'));
  }

  const target = picked ?? interaction.user;
  const self = target.id === interaction.user.id;
  if (picked?.bot) return replyEphemeral(interaction, 'Bots don\'t need pings.');
  const member = picked ? interaction.options.getMember('user') : interaction.member;
  if (picked && !member) return replyEphemeral(interaction, 'Pick someone in this server.');
  const name = self ? null : escapeMarkdown(member.displayName ?? target.displayName ?? target.username);
  const id = target.id;

  const me = linkedPlayer(id);
  if (!self && !isTO(interaction)) return notTO(interaction, 'see or change someone else\'s pings. Leave out `user` for yours');
  if (!Object.keys(changes).length) return replyEphemeral(interaction, notifyText(id, me, name));

  const lines = [];
  for (const [ping, on] of Object.entries(changes)) {
    if ((ping === 'calls' || ping === 'streams') && on && !me) {
      const label = ping === 'calls' ? 'Match call' : 'Stream alert';
      lines.push(self
        ? `${label} pings need your start.gg, so \`/link\` first. Leave out the link and it finds yours.`
        : `${label} pings need their start.gg. Ask them to run \`/link\` with their profile link.`);
      continue;
    }
    const list = PINGS[ping].list;
    state[list] ??= [];
    state[list] = state[list].filter((each) => each !== id);
    if (on) state[list].push(id);
    lines.push(say(self, PINGS[ping][on ? 'on' : 'off']));
  }
  save();
  if (changes.calls && me && !messageEnabled('calls')) lines.push('-# Match calls are off for the whole server, `/messages calls` turns them on.');
  if (!Object.hasOwn(changes, 'registration')) return replyEphemeral(interaction, lines.join('\n'));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guild } = interaction;
  try {
    let role = guild.roles.cache.find((each) => each.name === REG_ROLE);
    if (changes.registration) {
      role ??= await guild.roles.create({ name: REG_ROLE, permissions: [], mentionable: true, reason: 'shows who has /notify registration on' });
      if (!role.mentionable && role.edit) await role.edit({ mentionable: true }, 'reg reminders ping this role').catch(() => {});
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
