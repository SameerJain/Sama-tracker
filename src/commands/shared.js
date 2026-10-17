import { MessageFlags } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state } from '../store.js';

// a slow lookup's reply says how far along start.gg is once there's at least this long left, or this long
// with a quick answer to show meanwhile. the first check waits for the first pages, since those say how many more there are
const WAIT_SHOWN_SECONDS = 20;
const WAIT_PREVIEW_SECONDS = 5;
const WAIT_FIRST_SECONDS = 5;
const WAIT_UPDATE_SECONDS = 15;

// everyone a lookup can be about, keyed by start.gg user id: tracked players, then whoever ran /link
// for themselves. linked people never get anything posted
function pickable() {
  const linked = Object.values(state.links).filter((link) => !state.players[link.userId]);
  return { ...Object.fromEntries(linked.map((link) => [link.userId, link])), ...state.players };
}

// someone picked from the list, 'all', or whoever ran it if it's left out. trackedOnly is for the
// commands about what gets posted. undefined when it's none of those
function readChoice(interaction, name = 'player', { trackedOnly = false } = {}) {
  const value = interaction.options.getString(name)?.toLowerCase();
  if (value === undefined) return linkedPlayer(interaction.user.id);
  if (value === 'all') return 'all';

  return lookup(trackedOnly ? state.players : pickable(), value, 'tag');
}

// from /link, or the tracked player whose start.gg has this discord connected
function linkedPlayer(discordId) {
  const linked = state.links[discordId];
  if (linked) return state.players[linked.userId] ?? linked;
  return Object.values(state.players).find((player) => player.discordId === discordId);
}

// autocomplete sends the id, typing it out sends the name.
// hasOwn so typing "constructor" doesn't match Object.prototype
function lookup(records, value, name) {
  if (Object.hasOwn(records, value)) return records[value];
  return Object.values(records).find((record) => record[name].toLowerCase() === value);
}

function readPlayer(interaction, name = 'player', options = {}) {
  const choice = readChoice(interaction, name, options);
  return choice === 'all' ? undefined : choice;
}

// whatever doesn't fit in the reply goes in follow-ups, which are only ephemeral when asked
async function sendEmbeds(interaction, list) {
  for (const [i, batch] of embeds.messages(list).entries()) {
    if (i > 0) await interaction.followUp({ embeds: batch, ...(interaction.ephemeral && { flags: MessageFlags.Ephemeral }) });
    // null clears a countdown from withCountdown
    else if (interaction.deferred) await interaction.editReply({ content: null, embeds: batch });
    else await interaction.reply({ embeds: batch });
  }
}

// about 40 seconds, about 3 minutes
function roughly(seconds) {
  return seconds < 90 ? `${Math.ceil(seconds / 10) * 10} seconds` : `${Math.round(seconds / 60)} minutes`;
}

// awaits work, which is already running. while start.gg has a lot left for this command, the reply says how
// far along it is, above preview if there's a quick answer to show in the meantime. an edit already going out
// finishes first, so it can't land after the answer and replace it
async function withCountdown(interaction, doing, work, preview) {
  const progress = startgg.commandProgress();
  let edit = Promise.resolve();
  let timer;
  let previewed = false;
  const update = () => {
    const { sent, waiting, seconds } = progress();
    // with a preview there's something to look at, so it goes up for a shorter wait
    if (!waiting || seconds < (preview ? WAIT_PREVIEW_SECONDS : WAIT_SHOWN_SECONDS)) return;
    const content = `**${doing}** · ${sent} of ${sent + waiting} start.gg requests done, about ${roughly(seconds)} left\n`
      + '-# start.gg allows 80 requests a minute, so the first look takes a while. Asking again in the next few hours is quick';
    const payload = preview && !previewed ? { content, embeds: embeds.messages(preview)[0] } : content;
    previewed ||= Boolean(preview);
    edit = edit.then(() => interaction.editReply(payload)).catch(() => {});
  };
  const check = ([seconds, ...later]) => {
    timer = setTimeout(() => {
      update();
      check(later.length ? later : [WAIT_UPDATE_SECONDS]);
    }, seconds * 1000);
  };
  // more pages on top of cached ones are all queued right away, so a preview can go up then. a fresh
  // history only queues the rest once its first page is back, so it's checked again a little later
  check(preview ? [0, WAIT_FIRST_SECONDS] : [WAIT_FIRST_SECONDS]);
  try {
    return await work;
  } finally {
    clearTimeout(timer);
    await edit;
  }
}

// left out with no start.gg linked, or someone picked who isn't on the list
function replyNoPlayer(interaction, name = 'player', { trackedOnly = false } = {}) {
  let content = 'Only tracked or linked players can be picked. `/track add` them, or they can `/link` their own start.gg.';
  if (trackedOnly) content = 'Only tracked players can be picked here. `/track list` shows who\'s tracked.';
  if (interaction.options.getString(name) === null) content = 'Pick a player, or `/link` your start.gg so leaving it out looks you up.';
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

// start.gg/user/f64a83c8 or just f64a83c8
function profileSlug(input) {
  return input.match(/user\/([\w-]+)/)?.[1] ?? input;
}

export { pickable, readChoice, linkedPlayer, lookup, readPlayer, sendEmbeds, withCountdown, replyNoPlayer, profileSlug };
