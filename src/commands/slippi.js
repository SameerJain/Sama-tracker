import { escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as slippi from '../slippi.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { slippiEntry } from '../tracker.js';
import { didYouMean, linkedPlayer, replyEphemeral, replyEphemeralAfterDefer, sendEmbeds, t } from './shared.js';
import { isTO, notTO } from './to.js';

const NOT_A_CODE = 'That isn\'t a connect code. Use the one Slippi Launcher shows, like ABCD#123.';

// a pick from the list sends the slippi id, typing sends a code or display name. undefined if nobody on the watchlist matches
function watched(value) {
  if (Object.hasOwn(state.slippi, value)) return state.slippi[value];
  const code = slippi.readCode(value);
  const typed = value.trim().toLowerCase();
  return Object.values(state.slippi).find((entry) => (code && entry.code === code) || entry.name.toLowerCase() === typed);
}

// the watchlist entry tied to this start.gg user, if there is one
function entryFor(userId) {
  return Object.values(state.slippi).find((entry) => String(entry.userId) === String(userId));
}

// the connect code on a tracked or linked player's start.gg netplay registrations. called after deferring
async function codeOnStartgg(player) {
  const code = (await startgg.getConnectCodes([player.playerId])).get(player.playerId);
  return code ? slippi.readCode(code) : null;
}

// " Did you mean Name (CODE)?" for a name or code that's on nobody, closest by name, then by code
function nearestWatched(typed) {
  const entries = Object.values(state.slippi);
  const describe = (entry) => `${entry.name} (${entry.code})`;
  return didYouMean(entries, typed, 'name', describe) || didYouMean(entries, typed, 'code', describe);
}

function noCodeOnStartgg(player) {
  return t`Couldn't find a connect code on ${escapeMarkdown(player.tag)}'s start.gg. It's saved when you register for a netplay tournament that asks for one. Use \`code:\` instead, like \`/slippi add code:ABCD#123\`.`;
}

// whose watchlist entry this is: the start.gg player it came from, or whoever added their own code by hand.
// a TO's typed code belongs to nobody
function ownsEntry(interaction, entry) {
  if (entry.discordId === interaction.user.id) return true;
  const me = linkedPlayer(interaction.user.id);
  return Boolean(me && entry.userId) && String(entry.userId) === String(me.userId);
}

// with the code left out, it's yours from start.gg. a code found there is tied to that start.gg player.
// slippi can't tie a code to a discord, so a typed one goes on as whoever typed it, one each. TOs can add anyone
async function slippiAdd(interaction) {
  const typed = interaction.options.getString('code');
  const code = typed && slippi.readCode(typed);
  if (typed && !code) return replyEphemeral(interaction, t(NOT_A_CODE));
  const me = typed ? null : linkedPlayer(interaction.user.id);
  if (!typed && !me) {
    return replyEphemeral(interaction, t('Add a connect code, like `/slippi add code:ABCD#123`. Left out, it looks for yours on your start.gg, so `/link` that first.'));
  }
  const claim = Boolean(typed) && !isTO(interaction);
  const mine = claim && Object.values(state.slippi).find((each) => ownsEntry(interaction, each));
  if (mine && mine.code !== code) {
    return replyEphemeral(interaction, t`You're on the watchlist as ${escapeMarkdown(mine.name)} (${mine.code}). Only TOs can add someone else. \`/slippi remove\` takes you off first if your code changed.`);
  }

  await interaction.deferReply();
  const found = code ?? await codeOnStartgg(me);
  if (!found) return replyEphemeralAfterDefer(interaction, noCodeOnStartgg(me));
  const profile = await slippi.getProfileByCode(found);
  if (!profile) return replyEphemeralAfterDefer(interaction, t`Slippi has nobody with the code ${found}.`);

  const existing = state.slippi[profile.uid];
  // the rank check moves an existing entry's numbers, so a rank change can't go unposted
  const entry = existing ?? slippiEntry(profile);
  if (me) entry.userId = me.userId;
  if (claim && !existing) entry.discordId = interaction.user.id;
  state.slippi[profile.uid] = entry;
  state.slippiSkipped = state.slippiSkipped.filter((uid) => uid !== profile.uid);
  save();

  const name = escapeMarkdown(profile.name);
  const { files, characterFile } = await slippi.slippiArt(profile);
  await interaction.editReply({
    content: existing ? t`${name} is already on the Slippi watchlist.` : t`Added ${name} to the Slippi watchlist. Their rank changes get posted here.`,
    embeds: embeds.slippiRank(profile, { entry, players: state.players, characterFile }),
    files,
    allowedMentions: { parse: [] },
  });
}

// the daily search skips them after this, /slippi add brings them back. left out, it's your own entry.
// only TOs can take someone else off
function slippiRemove(interaction) {
  const typed = interaction.options.getString('player');
  if (typed === null) {
    const own = Object.values(state.slippi).find((each) => ownsEntry(interaction, each));
    if (!own) return replyEphemeral(interaction, t('You aren\'t on the Slippi watchlist. Pick someone to take off, if you\'re a TO.'));
    return takeOff(interaction, own);
  }
  const entry = watched(typed);
  if (!entry) {
    const near = nearestWatched(typed) || t(' `/slippi leaderboard` shows who is.');
    return replyEphemeral(interaction, t`They aren't on the Slippi watchlist.${near}`);
  }
  if (!ownsEntry(interaction, entry) && !isTO(interaction)) return notTO(interaction, t('take someone else off the watchlist. Leave out `player` to take yourself off'));
  return takeOff(interaction, entry);
}

function takeOff(interaction, entry) {
  delete state.slippi[entry.uid];
  state.slippiSkipped.push(entry.uid);
  save();
  return interaction.reply({ content: t`Took ${escapeMarkdown(entry.name)} (${entry.code}) off the Slippi watchlist.`, allowedMentions: { parse: [] } });
}

// someone on the watchlist, any connect code, or whoever ran it: their watchlist entry, or the code on their start.gg
async function slippiRank(interaction) {
  const typed = interaction.options.getString('player');
  const me = linkedPlayer(interaction.user.id);
  let entry = typed ? watched(typed) : me && entryFor(me.userId);
  const code = typed && !entry ? slippi.readCode(typed) : null;
  if (typed && !entry && !code) {
    const near = nearestWatched(typed) || t(' Pick someone from the list, or type a connect code like ABCD#123.');
    return replyEphemeral(interaction, t`Nobody on the watchlist goes by that.${near}`);
  }
  if (!typed && !entry && !me) return replyEphemeral(interaction, t('Pick someone, or `/link` your start.gg so leaving it out finds your connect code.'));

  await interaction.deferReply();
  let profile;
  if (entry) {
    profile = (await slippi.getProfiles([entry.uid])).get(entry.uid);
    if (!profile) return replyEphemeralAfterDefer(interaction, t`Slippi doesn't have ${entry.name} (${entry.code}) anymore.`);
  } else {
    const found = code ?? await codeOnStartgg(me);
    if (!found) return replyEphemeralAfterDefer(interaction, noCodeOnStartgg(me));
    profile = await slippi.getProfileByCode(found);
    if (!profile) {
      const near = typed ? nearestWatched(found) : '';
      return replyEphemeralAfterDefer(interaction, t`Slippi has nobody with the code ${found}.${near}`);
    }
    // on the watchlist under a code they've since changed
    entry = state.slippi[profile.uid] ?? null;
  }
  const { files, characterFile } = await slippi.slippiArt(profile);
  return sendEmbeds(interaction, embeds.slippiRank(profile, { entry, players: state.players, characterFile }), [], files);
}

// the leader's rank badge goes with it, or the slippi logo when the watchlist is empty
function slippiLeaderboard(interaction) {
  const [leader] = embeds.leaderboardOrder(state.slippi);
  return sendEmbeds(interaction, embeds.slippiLeaderboard(state.slippi, state.players), [], [leader ? slippi.rankImage(leader.rank) : slippi.LOGO]);
}

// for the melee reports: the slippi profile of someone on the watchlist, tied to their start.gg. anyone else
// gets null without a single request, so their reports go exactly the way they did before slippi. the live
// profile has past seasons, and slippi gets a few seconds before the last rank check's numbers stand in.
// kept a while so a report and its Full report button ask once. nothing here throws
const SLIPPI_KEPT_MINUTES = 30;
const SLIPPI_WAIT_MS = 3000;
const looked = new Map();

async function slippiFor(player) {
  const entry = entryFor(player.userId);
  if (!entry) return null;
  const kept = looked.get(entry.uid);
  if (kept && Date.now() - kept.at < SLIPPI_KEPT_MINUTES * 60 * 1000) return kept.profile;

  const live = slippi.getProfiles([entry.uid]).then((found) => {
    const profile = found.get(entry.uid);
    if (profile) looked.set(entry.uid, { at: Date.now(), profile });
    return profile ?? entry;
  }, (err) => {
    console.error(`slippi lookup for ${player.tag} failed:`, err.message);
    return entry;
  });
  return Promise.race([live, new Promise((resolve) => setTimeout(resolve, SLIPPI_WAIT_MS, entry))]);
}

// a report's slippi profiles, one per player. melee:True starts asking right away, next to the start.gg requests.
// otherwise it waits to see whether everything the report found was melee anyway. null when nobody's on the watchlist
function slippiLookup(players, melee) {
  const any = () => players.some((player) => entryFor(player.userId));
  let started = melee && any() ? Promise.all(players.map(slippiFor)) : null;
  return async (show) => (show && any() ? (started ??= Promise.all(players.map(slippiFor))) : null);
}

// watchlist picks for remove and rank, matching names, codes and start.gg tags. rank also takes a typed code
function slippiChoices(focused, { anyCode = false } = {}) {
  const typed = focused.trim().toLowerCase();
  const label = (entry) => {
    const tag = entry.userId && state.players[entry.userId]?.tag;
    return `${tag && tag !== entry.name ? `${tag} · ${entry.name}` : entry.name} · ${entry.code}`;
  };
  const matches = Object.values(state.slippi).filter((entry) => label(entry).toLowerCase().includes(typed));
  const starts = (entry) => label(entry).toLowerCase().startsWith(typed);
  matches.sort((a, b) => starts(b) - starts(a));
  const choices = matches.map((entry) => ({ name: label(entry).slice(0, 100), value: entry.uid }));

  const code = anyCode && slippi.readCode(focused);
  if (code && !choices.some((choice) => state.slippi[choice.value].code === code)) choices.unshift({ name: t`Look up ${code}`, value: code });
  // an empty list looks broken, so say why. picking it gets the not found reply
  if (!choices.length) {
    const why = Object.keys(state.slippi).length ? t`Nobody on the watchlist matches "${focused}"` : t('Nobody on the Slippi watchlist yet, /slippi add someone first');
    choices.push({ name: why.slice(0, 100), value: focused.slice(0, 100) || 'nobody' });
  }
  return choices.slice(0, 25);
}

export { slippiAdd, slippiRemove, slippiRank, slippiLeaderboard, slippiChoices, slippiFor, slippiLookup };
