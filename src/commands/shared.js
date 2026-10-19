import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { MEMBER_H2H, MEMBER_SCOUT } from './definitions.js';

// a slow lookup's reply says how far along start.gg is once there's at least this long left, or this long
// with a quick answer to show meanwhile. the first check waits for the first pages, since those say how many more there are
const WAIT_SHOWN_SECONDS = 20;
const WAIT_PREVIEW_SECONDS = 5;
const WAIT_FIRST_SECONDS = 5;
const WAIT_UPDATE_SECONDS = 15;
// a public answer later than this pings whoever asked, see sendLate
const LATE_SECONDS = 60;

// players each person picked last, so autocomplete can put them first before anything's typed
const RECENT_PICKS = 5;
const RECENT_PICKERS = 500;

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

  const picked = lookup(trackedOnly ? state.players : pickable(), value, 'tag');
  if (picked) rememberPick(interaction.user.id, picked.userId);
  return picked;
}

// newest first. leaving the player out means yourself, so you don't need to be on your own list
function rememberPick(discordId, userId) {
  const id = String(userId);
  const picks = state.recentPicks[discordId] ?? [];
  if (picks[0] === id || String(linkedPlayer(discordId)?.userId) === id) return;
  delete state.recentPicks[discordId];
  state.recentPicks[discordId] = [id, ...picks.filter((each) => each !== id)].slice(0, RECENT_PICKS);
  // key order is the order they last picked someone
  const pickers = Object.keys(state.recentPicks);
  for (const each of pickers.slice(0, Math.max(0, pickers.length - RECENT_PICKERS))) delete state.recentPicks[each];
  save();
}

// what someone picked lately, as start.gg user ids, newest first
const recentPicks = (discordId) => state.recentPicks[discordId] ?? [];

// "Tea | Leo", "tea leo" and "TeaLeo" all come out "tealeo". typing nothing but symbols matches them as typed
const squash = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function nameMatches(name, typed, { start = false } = {}) {
  const [have, want] = squash(typed) ? [squash(name), squash(typed)] : [name.toLowerCase(), typed.toLowerCase()];
  return start ? have.startsWith(want) : have.includes(want);
}

// from /link, or the tracked player whose start.gg has this discord connected
function linkedPlayer(discordId) {
  const linked = state.links[discordId];
  if (linked) return state.players[linked.userId] ?? linked;
  return Object.values(state.players).find((player) => player.discordId === discordId);
}

// autocomplete sends the id, typing it out sends the name, spelled close enough.
// hasOwn so typing "constructor" doesn't match Object.prototype
function lookup(records, value, name) {
  if (Object.hasOwn(records, value)) return records[value];
  const all = Object.values(records);
  return all.find((record) => record[name].toLowerCase() === value)
    ?? (squash(value) ? all.find((record) => squash(record[name]) === squash(value)) : undefined);
}

function readPlayer(interaction, name = 'player', options = {}) {
  const choice = readChoice(interaction, name, options);
  return choice === 'all' ? undefined : choice;
}

// discord.js only knows for replies it sent itself, so a pressed button goes by the message it's on
function isEphemeral(interaction) {
  return Boolean(interaction.ephemeral ?? interaction.message?.flags.has(MessageFlags.Ephemeral));
}

// /stats, for telling someone about their command. buttons and the Apps menu ones say the report they run
function commandLabel(interaction) {
  if (interaction.isButton?.()) return `/${readButton(interaction.customId).command}`;
  return { [MEMBER_H2H]: '/h2h', [MEMBER_SCOUT]: '/scout' }[interaction.commandName] ?? `/${interaction.commandName}`;
}

// a Full report press swaps the report it's on instead of answering with a new message
const swapsReport = (interaction) => Boolean(interaction.isButton?.()) && readButton(interaction.customId).action === 'more';

// a public answer this long after the command scrolled up the channel with nobody watching, and discord
// stops taking edits 15 minutes in. it goes out as a new message that pings whoever asked instead, and
// the old reply goes. false when it can't, so the usual reply goes out
async function sendLate(interaction, batches, components, files) {
  const waited = (Date.now() - interaction.createdTimestamp) / 1000;
  if (!interaction.deferred || !(waited >= LATE_SECONDS) || isEphemeral(interaction) || !interaction.channel?.send) return false;
  const [first, ...rest] = batches;
  const { id } = interaction.user;
  try {
    await interaction.channel.send({ content: `<@${id}> here's your ${commandLabel(interaction)}.`, embeds: first, components, files, allowedMentions: { users: [id] } });
  } catch (err) {
    console.error(`late ${commandLabel(interaction)} couldn't be posted as a new message:`, err.message);
    return false;
  }
  for (const batch of rest) await interaction.channel.send({ embeds: batch, allowedMentions: { parse: [] } });
  // the report a Full report press was swapping stays, just without its greyed out buttons
  if (swapsReport(interaction)) await interaction.editReply({ content: null, components: [] }).catch(() => {});
  else await interaction.deleteReply().catch(() => {});
  return true;
}

// whatever doesn't fit in the reply goes in follow-ups, which are only ephemeral when the reply is.
// buttons and files go with the reply, and leaving buttons out clears the ones a pressed button's message had.
// mentions stay off on every branch, so a start.gg tag can't ping: only sendLate pings on purpose
async function sendEmbeds(interaction, list, components = [], files = []) {
  const batches = embeds.messages(list);
  if (await sendLate(interaction, batches, components, files)) return;
  for (const [i, batch] of batches.entries()) {
    if (i > 0) await interaction.followUp({ embeds: batch, allowedMentions: { parse: [] }, ...(isEphemeral(interaction) && { flags: MessageFlags.Ephemeral }) });
    // null clears a countdown from withCountdown
    else if (interaction.deferred) await interaction.editReply({ content: null, embeds: batch, components, files, allowedMentions: { parse: [] } });
    else await interaction.reply({ embeds: batch, components, files, allowedMentions: { parse: [] } });
  }
}

// a button that runs a report again. discord keeps nothing but its id, so that holds everything:
// action:command:player:opponent:melee:game:since:venue, with players as profile slugs so anyone
// start.gg has still works after a restart, or #playerId for someone only known from a set. since is the
// YYYY-MM-DD it was run with, venue offline or online. more swaps the message for the full report, new
// answers with another report, and private answers just whoever pressed it.
// null when it won't fit in discord's 100 characters
function reportButton(label, action, command, { player = null, opponent = null, melee = false, game = null, since = null, venue = null } = {}) {
  const slug = (who) => who?.slug?.replace(/^user\//, '') ?? (who?.playerId ? `#${who.playerId}` : '');
  if ((player && !slug(player)) || (opponent && !slug(opponent))) return null;
  const id = [action, command, slug(player), slug(opponent), melee ? 'melee' : '', game ?? '', since ?? '', venue ?? ''].join(':');
  if (id.length > 100) return null;
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
}

// 'YYYY-MM-DD' to unix seconds at the UTC midnight it starts. null when left out, and an error to answer
// with when it isn't a date. the error names what to type instead
function parseSince(input) {
  if (!input) return { since: null };
  const text = input.trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parts = match?.slice(1).map(Number);
  const at = parts ? Date.UTC(parts[0], parts[1] - 1, parts[2]) / 1000 : NaN;
  const real = Number.isFinite(at) && new Date(at * 1000).toISOString().slice(0, 10) === text;
  if (!real) return { error: `Couldn't read \`${text}\` as a date. Use YYYY-MM-DD, like 2026-01-01.` };
  return { since: at };
}

// under a short report, the same as running it with verbose:True
const fullReport = (command, options) => reportButton('Full report', 'more', command, options);

// /h2h between a player and whoever they played or play next in a set. singles only, like /h2h.
// discord caps labels at 80
function h2hButton(set, player, { label, action = 'new' } = {}) {
  const them = startgg.fromSide(set, player.playerId)?.them;
  if (!them || set.sides.some((side) => side.playerIds.length !== 1)) return null;
  return reportButton((label ?? `H2H vs ${them.name}`).slice(0, 80), action, 'h2h', { player, opponent: { playerId: them.playerIds[0] } });
}

// the row the buttons go in, or none when there aren't any
function buttonRow(...buttons) {
  const shown = buttons.filter(Boolean);
  return shown.length ? [new ActionRowBuilder().addComponents(shown)] : [];
}

function readButton(customId) {
  // buttons from before since and venue still split short, so those come back null
  const [action, command, player, opponent, melee, game, since, venue] = customId.split(':');
  return { action, command, player, opponent, melee: melee === 'melee', game: Number(game) || null, since: since || null, venue: venue || null };
}

// a player from a button: someone tracked or linked, or anyone start.gg still has
async function playerBySlug(slug) {
  const known = Object.values(pickable());
  if (slug.startsWith('#')) {
    const playerId = slug.slice(1);
    return known.find((player) => String(player.playerId) === playerId) ?? startgg.getPlayerById(playerId);
  }
  return known.find((player) => player.slug === `user/${slug}`) ?? startgg.getPlayer(slug);
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
    // mentions off so a gamertag in the preview can't ping while it loads
    const payload = preview && !previewed
      ? { content, embeds: embeds.messages(preview)[0], allowedMentions: { parse: [] } }
      : { content, allowedMentions: { parse: [] } };
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

// failures and switches don't need the channel to see them. mentions stay off so a
// start.gg tag or typed link can't ping anyone
const replyEphemeral = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

// letters to add, drop or change to get from one to the other
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}

// for a name typed that matched nobody: the record with it somewhere in its name, or else the one a typo or
// two away, a letter for every three typed. null when nothing's that close. ids from a list that's changed
// since aren't names
function closest(records, typed, name) {
  const want = squash(typed ?? '');
  if (want.length < 2 || /^\d+$/.test(want)) return null;
  const containing = records.find((record) => squash(record[name]).includes(want));
  if (containing) return containing;
  let best = null;
  for (const record of records) {
    const apart = distance(squash(record[name]), want);
    if (apart <= Math.max(1, Math.floor(want.length / 3)) && (!best || apart < best.apart)) best = { record, apart };
  }
  return best?.record ?? null;
}

// " Did you mean Leo?" for a typed name, or nothing. escaped and in bold, mentions are off where it goes
function didYouMean(records, typed, name = 'tag', describe = (record) => record[name]) {
  const near = closest(records, typed, name);
  return near ? ` Did you mean **${escapeMarkdown(describe(near))}**?` : '';
}

// left out with no start.gg linked, or someone picked who isn't on the list
function replyNoPlayer(interaction, name = 'player', { trackedOnly = false } = {}) {
  const typed = interaction.options.getString(name);
  let content = 'Only tracked or linked players can be picked. `/track add` them, or they can `/link` their own start.gg.';
  if (trackedOnly) content = 'Only tracked players can be picked here. `/track list` shows who\'s tracked.';
  if (typed === null) content = 'Pick a player, or `/link` your start.gg so leaving it out looks you up.';
  const near = didYouMean(Object.values(trackedOnly ? state.players : pickable()), typed);
  if (near) content = `Nobody ${trackedOnly ? 'tracked' : 'tracked or linked'} goes by \`${typed.replaceAll('`', '')}\`.${near}`;
  return replyEphemeral(interaction, content);
}

// start.gg/user/f64a83c8 or just f64a83c8
function profileSlug(input) {
  return input.match(/user\/([\w-]+)/)?.[1] ?? input;
}

// the player behind a typed link or ID, for handlers that deferred first. null and a reply when
// start.gg has nobody for it. whose is just for the wording, "use their/your profile link"
async function findPlayer(interaction, input, whose = 'their') {
  const text = input.trim();
  const shown = text.replaceAll('`', '');
  const player = await startgg.getPlayer(profileSlug(text));
  if (!player) await interaction.editReply({ content: `Couldn't find a start.gg player for \`${shown}\`. Use ${whose} profile link, like start.gg/user/f64a83c8.`, allowedMentions: { parse: [] } });
  return player;
}

// whoever a matchup option got that isn't tracked or linked: a start.gg profile link or ID. called
// after deferReply, so a miss drops the thinking reply and answers ephemeral instead. null when nobody
async function fetchPlayer(interaction, input) {
  const text = input.trim();
  const shown = text.replaceAll('`', '');
  const player = await startgg.getPlayer(profileSlug(text));
  if (!player) {
    const near = didYouMean(Object.values(pickable()), text);
    await replyEphemeralAfterDefer(interaction, `Couldn't find a start.gg player for \`${shown}\`.${near || ' Pick a tracked or linked player, or use a profile link or ID like start.gg/user/f64a83c8.'}`);
  }
  return player;
}

// an ephemeral reply that works after deferring too: the thinking reply gets dropped and the answer
// goes out as its own ephemeral follow-up, since editing would put it in the channel for everyone
async function replyEphemeralAfterDefer(interaction, content) {
  if (!interaction.deferred) return replyEphemeral(interaction, content);
  await interaction.deleteReply();
  return interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

// a boolean option, false when left out
const flag = (interaction, name) => interaction.options.getBoolean(name) ?? false;

export {
  pickable, readChoice, linkedPlayer, lookup, readPlayer, sendEmbeds, withCountdown, replyNoPlayer, replyEphemeral, replyEphemeralAfterDefer, findPlayer, fetchPlayer, flag,
  reportButton, fullReport, h2hButton, buttonRow, readButton, parseSince, playerBySlug, recentPicks, rememberPick, nameMatches, didYouMean,
  commandLabel, roughly, LATE_SECONDS,
};
