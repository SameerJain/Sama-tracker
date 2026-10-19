import { PermissionFlagsBits } from 'discord.js';
import { state, save } from '../store.js';
import { missingThreadPermissions, secondsNow } from '../tracker.js';
import { MESSAGE_TYPES, THREAD_MODES, WEEKDAYS, messageSettings } from '../message-settings.js';
import { readChoice, replyEphemeral, replyNoPlayer } from './shared.js';
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
    '-# `threads` has three modes for set results and stream alerts. Off posts them here, one per tournament gives each tournament a thread, and one per event gives each event its own, like Genesis 11 · Ultimate Singles.');
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

// ephemeral so edits don't clutter the channel and a name can't ping anyone
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

// /stream, /sets and /calls: the same switch on a different field. onAt saves when it went from off to on.
// confirmAllOff asks first before turning it off for everyone
function toggles({ option, field, label, onAt, confirmAllOff }) {
  // returns what to reply
  const flip = (choice, on) => {
    const now = secondsNow();
    for (const player of choice === 'all' ? Object.values(state.players) : [choice]) {
      if (on && onAt && player[field] === false) player[onAt] = now;
      player[field] = on;
    }
    save();
    return `${label} ${on ? 'on' : 'off'} for ${choice === 'all' ? 'everyone' : choice.tag}.`;
  };

  if (confirmAllOff) {
    confirmable(confirmAllOff.kind, {
      command: `/${confirmAllOff.command}`,
      run: () => ({ content: flip('all', false) }),
      cancel: () => `${label} stay the way they were.`,
    });
  }

  return (interaction) => {
    const choice = readChoice(interaction, 'player', { trackedOnly: true });
    if (!choice) return replyNoPlayer(interaction, 'player', { trackedOnly: true });
    // someone from /link, their streams, sets and match calls never get posted
    if (choice !== 'all' && !state.players[choice.userId]) {
      return replyEphemeral(interaction, `You aren't tracked, so there are no ${label.toLowerCase()} to change.`);
    }

    const on = interaction.options.getString(option, true) === 'on';
    // nothing to lose when it's already off for everyone
    const players = Object.values(state.players);
    if (choice === 'all' && !on && confirmAllOff && players.some((player) => player[field] !== false)) {
      return askFirst(interaction, confirmAllOff.kind, 'all', confirmAllOff.question(players.length), 'Turn off');
    }
    return interaction.reply({ content: flip(choice, on), allowedMentions: { parse: [] } });
  };
}

const streamAlerts = toggles({ option: 'alerts', field: 'streamAlerts', label: 'Stream alerts' });
// the set check doesn't ask about players with results off, so this is how their older sets stay out.
// turning them back on skips everything finished while they were off, so everyone at once asks first
const setResults = toggles({
  option: 'results', field: 'setResults', label: 'Set results', onAt: 'setResultsOnAt',
  confirmAllOff: {
    kind: 'sets_off', command: 'sets player:all results:off',
    question: (count) => `Turn set results off for all ${count} tracked players? Sets they finish while it's off never get posted, even after it's back on.`,
  },
});
// match call pings go out while the set is still called, so there's no cutoff like /sets has
const matchCalls = toggles({ option: 'pings', field: 'callPings', label: 'Match call pings' });

// only ever changes the person who ran it, who doesn't have to be tracked or linked. pings go
// out with every stream alert, so /stream on each player still decides what gets posted
function streamPings(interaction) {
  const on = interaction.options.getString('ping', true) === 'on';
  const { id } = interaction.user;
  state.streamPings = state.streamPings.filter((each) => each !== id);
  if (on) state.streamPings.push(id);
  save();
  return replyEphemeral(interaction, on
    ? 'You\'ll get pinged for every stream alert posted here. Alerts go out for tracked players with `/stream` on.'
    : 'No more stream alert pings.');
}

export { configureMessages, socialsAdd, socialsRemove, streamAlerts, streamPings, setResults, matchCalls };
