import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, DiscordAPIError, HTTPError, MessageFlags, PermissionFlagsBits, RESTJSONErrorCodes,
  escapeMarkdown,
} from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { ApiError } from '../errors.js';
import { t, count, listOf, language } from '../i18n.js';
import { MEMBER_H2H, MEMBER_SCOUT } from './definitions.js';

// a slow lookup's reply says how far along start.gg is once there's at least this long left, or this long
// with a quick answer to show meanwhile. the first check waits for the first pages, since those say how many more there are
const WAIT_SHOWN_SECONDS = 20;
const WAIT_PREVIEW_SECONDS = 5;
const WAIT_FIRST_SECONDS = 5;
const WAIT_UPDATE_SECONDS = 15;
// a public answer later than this pings whoever asked, see sendLate
const LATE_SECONDS = 60;
// start.gg pictures uploaded with a reply, see withPictures. discord takes 10 files and 10MB a message
const MESSAGE_FILES = 10;
const PICTURE_BYTES = 8 * 1024 * 1024;
const PICTURE_SECONDS = 10;

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

// whether a tracked or linked player is whoever ran the command: their /link, or the discord on their start.gg.
// both were checked against start.gg, so nobody can pass as someone else
function isSelf(interaction, player) {
  if (!player || player === 'all') return false;
  if (player.discordId === interaction.user.id) return true;
  const me = linkedPlayer(interaction.user.id);
  return me ? String(me.userId) === String(player.userId) : false;
}

// what to tell someone whose command threw, naming whose fault it was. the details stay in the logs, since
// start.gg's and discord's own wording can carry ids and reads badly in the channel
function failureMessage(err) {
  if (err instanceof ApiError) {
    const { source, status } = err;
    if (source === 'start.gg' && startgg.badToken(err)) return t('start.gg turned down the bot\'s API token, so nothing from start.gg works until whoever runs the bot makes a new one.');
    // the whole site, not one slow request. says so plainly, so nobody keeps retrying or blames the bot
    const down = source === 'start.gg' && (status === null || status >= 500) && startgg.startggDownSince();
    if (down) return t`start.gg has been down since <t:${down}:R>, so anything that needs it can't run right now. The bot is fine and picks back up on its own once start.gg answers. \`/status\` shows if it's still down.`;
    if (status === 429) return t`${source} is limiting how fast the bot can ask right now. Try again in a minute.`;
    if (status === null) return t`${source} didn't answer in time. Try again in a minute.`;
    if (status >= 500) return t`${source} is having trouble right now. Try again in a few minutes.`;
    return t`Couldn't get that from ${source} right now. Try again in a minute.`;
  }
  if (err instanceof DiscordAPIError) {
    if (err.code === RESTJSONErrorCodes.MissingPermissions) return t('Discord says I\'m missing a permission for that. A server admin can check my role, in server settings and on this channel.');
    if (err.code === RESTJSONErrorCodes.MissingAccess) return t('Discord says I can\'t see what that needs. A server admin can check that my role can view this channel.');
    if (err.code === RESTJSONErrorCodes.UnknownMember) return t('That person isn\'t in this server anymore.');
    return t('Discord didn\'t let me do that just now. Try again in a minute.');
  }
  if (err instanceof HTTPError) return t('Discord is having trouble right now. Try again in a few minutes.');
  return t('Something went wrong in the bot itself, not start.gg or Discord. It\'s in the bot\'s logs.');
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
async function sendLate(interaction, messages, components) {
  const waited = (Date.now() - interaction.createdTimestamp) / 1000;
  if (!interaction.deferred || !(waited >= LATE_SECONDS) || isEphemeral(interaction) || !interaction.channel?.send) return false;
  const [first, ...rest] = messages;
  const { id } = interaction.user;
  try {
    await interaction.channel.send({
      content: t`<@${id}> here's your ${commandLabel(interaction)}.`,
      embeds: first.batch,
      components,
      files: first.files,
      allowedMentions: { users: [id] },
    });
  } catch (err) {
    console.error(`late ${commandLabel(interaction)} couldn't be posted as a new message:`, err.message);
    return false;
  }
  for (const { batch, files } of rest) await interaction.channel.send({ embeds: batch, files, allowedMentions: { parse: [] } });
  // the report a Full report press was swapping stays, just without its greyed out buttons
  if (swapsReport(interaction)) await interaction.editReply({ content: null, components: [] }).catch(() => {});
  else await interaction.deleteReply().catch(() => {});
  return true;
}

// where a card can have a picture, and how to change it. null takes it off, and the author keeps its name
const PICTURE_SPOTS = [
  [(card) => card.data.thumbnail?.url, (card, url) => card.setThumbnail(url)],
  [(card) => card.data.image?.url, (card, url) => card.setImage(url)],
  [(card) => card.data.author?.icon_url, (card, url) => card.setAuthor({ name: card.data.author.name, url: card.data.author.url, iconURL: url ?? undefined })],
];

const startggPictures = (card) => PICTURE_SPOTS.map(([get]) => get(card)).filter(startgg.isStartggImage);

// discord can't always load images.start.gg from a link, and a card whose picture doesn't load shows nothing
// there, not even the avatar. so a message's start.gg pictures go up with it as files, like character art. one
// that won't download comes off its card so the avatar can stand in, and one past discord's file limits stays
// a link. [{ batch, files }] for each message, the caller's files going with the first
async function withPictures(interaction, batches, files) {
  // without Attach Files a message with files fails, so the links are the best there is
  const canUpload = interaction.appPermissions?.has(PermissionFlagsBits.AttachFiles) !== false;
  const urls = canUpload ? [...new Set(batches.flat().flatMap(startggPictures))] : [];
  // one download each, since the same player's picture can be on every card
  const downloads = new Map(urls.map((url, i) => [url, startgg.getImage(url, `picture-${i}`, PICTURE_SECONDS * 1000).catch(() => null)]));
  return Promise.all(batches.map(async (batch, i) => {
    const uploads = i ? [] : [...files];
    let bytes = 0;
    for (const card of batch) {
      for (const [get, set] of PICTURE_SPOTS) {
        const download = downloads.get(get(card));
        if (!download) continue;
        const file = await download;
        if (!file) {
          set(card, null);
          continue;
        }
        if (!uploads.includes(file)) {
          if (uploads.length >= MESSAGE_FILES || bytes + file.attachment.length > PICTURE_BYTES) continue;
          uploads.push(file);
          bytes += file.attachment.length;
        }
        set(card, `attachment://${file.name}`);
      }
    }
    return { batch: embeds.withImage(batch), files: uploads };
  }));
}

// whatever doesn't fit in the reply goes in follow-ups, which are only ephemeral when the reply is.
// buttons and files go with the reply, and leaving buttons out clears the ones a pressed button's message had.
// start.gg pictures go with whichever message has them, see withPictures.
// mentions stay off on every branch, so a start.gg tag can't ping: only sendLate pings on purpose
async function sendEmbeds(interaction, list, components = [], files = []) {
  const batches = embeds.messages(list);
  // the downloads can take longer than the 3 seconds discord gives a reply
  if (!interaction.deferred && !interaction.replied && batches.flat().some((card) => startggPictures(card).length)) await interaction.deferReply();
  const outgoing = await withPictures(interaction, batches, files);
  if (!outgoing.length || await sendLate(interaction, outgoing, components)) return;
  const [first, ...rest] = outgoing;
  const answer = { embeds: first.batch, components, files: first.files, allowedMentions: { parse: [] } };
  // null clears a countdown from withCountdown
  if (interaction.deferred) await interaction.editReply({ content: null, ...answer });
  else await interaction.reply(answer);
  const followUp = { allowedMentions: { parse: [] } };
  if (isEphemeral(interaction)) followUp.flags = MessageFlags.Ephemeral;
  for (const { batch, files: uploads } of rest) await interaction.followUp({ embeds: batch, files: uploads, ...followUp });
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
  if (!real) return { error: t`Couldn't read \`${text}\` as a date. Use YYYY-MM-DD, like 2026-01-01.` };
  return { since: at };
}

// under a short report, the same as running it with verbose:True
const fullReport = (command, options) => reportButton(t('Full report'), 'more', command, options);

// /h2h between a player and whoever they played or play next in a set. singles only, like /h2h.
// a shortcut for /h2h in the game the set is in: melee sets filter to melee, the rest
// leave the game out so the odds pick their shared one. pressing it runs the short report, no
// second Full report press. discord caps labels at 80
function h2hButton(set, player, { label, action = 'new' } = {}) {
  const them = startgg.fromSide(set, player.playerId)?.them;
  if (!them || set.sides.some((side) => side.playerIds.length !== 1)) return null;
  return reportButton((label ?? t`H2H vs ${them.name}`).slice(0, 80), action, 'h2h', { player, opponent: { playerId: them.playerIds[0] }, melee: isMeleeSet(set) });
}

// the id is the game when start.gg has one, else the display name or event name says melee
function isMeleeSet(set) {
  if (startgg.isMelee(set)) return true;
  if (set.event?.videogame?.displayName === 'Melee') return true;
  return /\b(melee|ssbm)\b/i.test(set.event?.name ?? '');
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
  return seconds < 90 ? count(Math.ceil(seconds / 10) * 10, 'second') : count(Math.round(seconds / 60), 'minute');
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
    const content = t`**${doing}** · ${sent} of ${sent + waiting} start.gg requests done, about ${roughly(seconds)} left\n-# start.gg allows 80 requests a minute, so the first look takes a while. Asking again in the next few hours is quick`;
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
  return near ? t` Did you mean **${escapeMarkdown(describe(near))}**?` : '';
}

// a tracked player picked in player:, or whoever ran it when it's left out. undefined when it's nobody tracked,
// like someone who only used /link, and replyNotTracked says why
function readTracked(interaction) {
  const player = readPlayer(interaction, 'player', { trackedOnly: true });
  return player && state.players[player.userId] ? player : undefined;
}

function replyNotTracked(interaction) {
  if (interaction.options.getString('player') === null) return replyEphemeral(interaction, t('You aren\'t tracked. `/track add` tracks you.'));
  return replyNoPlayer(interaction, 'player', { trackedOnly: true });
}

// left out with no start.gg linked, or someone picked who isn't on the list
function replyNoPlayer(interaction, name = 'player', { trackedOnly = false } = {}) {
  const typed = interaction.options.getString(name);
  let content = t('Only tracked or linked players can be picked. `/track add` them, or they can `/link` their own start.gg.');
  if (trackedOnly) content = t('Only tracked players can be picked here. `/track list` shows who\'s tracked.');
  if (typed === null) content = t('Pick a player, or `/link` your start.gg so leaving it out looks you up.');
  const near = didYouMean(Object.values(trackedOnly ? state.players : pickable()), typed);
  if (near) {
    const code = typed.replaceAll('`', '');
    content = trackedOnly ? t`Nobody tracked goes by \`${code}\`.${near}` : t`Nobody tracked or linked goes by \`${code}\`.${near}`;
  }
  return replyEphemeral(interaction, content);
}

// start.gg/user/f64a83c8 or just f64a83c8
function profileSlug(input) {
  return input.match(/user\/([\w-]+)/)?.[1] ?? input;
}

// the player behind a typed profile link or ID, with the text as typed, backticks out so it can go in a code span
async function typedPlayer(input) {
  const text = input.trim();
  return { text, shown: text.replaceAll('`', ''), player: await startgg.getPlayer(profileSlug(text)) };
}

// the player behind a typed link or ID, for handlers that deferred first. null and a reply when
// start.gg has nobody for it. own is just for the wording, "use your profile link" instead of their
async function findPlayer(interaction, input, own = false) {
  const { shown, player } = await typedPlayer(input);
  if (!player) {
    const content = own
      ? t`Couldn't find a start.gg player for \`${shown}\`. Use your profile link, like start.gg/user/f64a83c8.`
      : t`Couldn't find a start.gg player for \`${shown}\`. Use their profile link, like start.gg/user/f64a83c8.`;
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  }
  return player;
}

// whoever a matchup option got that isn't tracked or linked: a start.gg profile link or ID. called
// after deferReply, so a miss drops the thinking reply and answers ephemeral instead. null when nobody
async function fetchPlayer(interaction, input) {
  const { text, shown, player } = await typedPlayer(input);
  if (!player) {
    const near = didYouMean(Object.values(pickable()), text) || t(' Pick a tracked or linked player, or use a profile link or ID like start.gg/user/f64a83c8.');
    await replyEphemeralAfterDefer(interaction, t`Couldn't find a start.gg player for \`${shown}\`.${near}`);
  }
  return player;
}

// a stat command's player box: someone picked from the list, whoever ran it when it's left out, or a start.gg profile
// link or ID for anyone at all, tracked or not. a typed one gets looked up, which waits for the defer, so this defers
// when it has to. a name that isn't anyone's gets the closest one suggested. null once it answered
async function statPlayer(interaction, name = 'player') {
  const picked = readPlayer(interaction, name);
  if (picked) return picked;
  const typed = interaction.options.getString(name);
  if (typed === null) {
    await replyNoPlayer(interaction, name);
    return null;
  }
  if (!interaction.deferred) await interaction.deferReply();
  return fetchPlayer(interaction, typed);
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
  pickable, readChoice, readPlayer, readTracked, linkedPlayer, isSelf, lookup, nameMatches, didYouMean, recentPicks, rememberPick,
  findPlayer, fetchPlayer, statPlayer, playerBySlug, flag, parseSince,
  sendEmbeds, withCountdown, replyEphemeral, replyEphemeralAfterDefer, replyNoPlayer, replyNotTracked, failureMessage,
  reportButton, fullReport, h2hButton, buttonRow, readButton, commandLabel, roughly, LATE_SECONDS, t, count, listOf, language,
};
