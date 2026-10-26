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

// whose watchlist entry this is: the start.gg player it came from, or whoever it was added as by hand.
// a TO's typed code with nobody picked belongs to nobody
function ownedBy(discordId, entry) {
  if (entry.discordId === discordId) return true;
  const linked = linkedPlayer(discordId);
  return Boolean(linked && entry.userId) && String(entry.userId) === String(linked.userId);
}

const ownsEntry = (interaction, entry) => ownedBy(interaction.user.id, entry);

// someone's own entry in this server, or with everywhere, one from another server when this one has none.
// that's only read, for /slippi rank and /slippi add, so a code typed once finds you in every server
function ownEntry(discordId, { everywhere = false } = {}) {
  const here = Object.values(state.slippi).find((entry) => ownedBy(discordId, entry));
  if (here || !everywhere) return here ?? null;
  for (const server of Object.values(state.guilds ?? {})) {
    const found = Object.values(server.slippi ?? {}).find((entry) => ownedBy(discordId, entry));
    if (found) return found;
  }
  return null;
}

// with the code left out, it's from their start.gg, or the code they added in another server. a code found on
// start.gg is tied to that start.gg player. slippi can't tie a code to a discord, so a typed one goes on as whoever
// typed it, one each, or as the member a TO picks with user. a TO's typed code with nobody picked is nobody's,
// since TOs add people who aren't in the server too
async function slippiAdd(interaction) {
  const typed = interaction.options.getString('code');
  const code = typed && slippi.readCode(typed);
  if (typed && !code) return replyEphemeral(interaction, t(NOT_A_CODE));
  const picked = interaction.options.getUser?.('user') ?? null;
  if (picked?.bot) return replyEphemeral(interaction, t('Bots don\'t have connect codes.'));
  const self = !picked || picked.id === interaction.user.id;
  const to = isTO(interaction);
  if (!self && !to) return notTO(interaction, t('add someone else to the watchlist. Leave out `user` to add yourself'));
  const owner = picked ?? (typed && to ? null : interaction.user);
  const who = picked && escapeMarkdown(interaction.options.getMember?.('user')?.displayName ?? picked.displayName ?? picked.username);
  const player = !typed && linkedPlayer(owner.id);
  const elsewhere = !typed && !player && ownEntry(owner.id, { everywhere: true });
  if (!typed && !player && !elsewhere) {
    return replyEphemeral(interaction, self
      ? t('Add a connect code, like `/slippi add code:ABCD#123`. Left out, it looks for yours on your start.gg, so `/link` that first.')
      : t`${who} isn't tracked or linked, so there's no start.gg to find a code on. Add theirs with \`code:\`.`);
  }
  const theirs = typed && owner && ownEntry(owner.id);
  if (theirs && theirs.code !== code) {
    const [name, onList] = [escapeMarkdown(theirs.name), theirs.code];
    if (!self) return replyEphemeral(interaction, t`${who} is on the watchlist as ${name} (${onList}). \`/slippi remove\` takes them off first if their code changed.`);
    return replyEphemeral(interaction, to
      ? t`You're on the watchlist as ${name} (${onList}). \`/slippi remove\` takes you off first if your code changed.`
      : t`You're on the watchlist as ${name} (${onList}). Only TOs can add someone else. \`/slippi remove\` takes you off first if your code changed.`);
  }

  await interaction.deferReply();
  let profile;
  const found = code ?? (player && await codeOnStartgg(player));
  if (found) {
    profile = await slippi.getProfileByCode(found);
    if (!profile) return replyEphemeralAfterDefer(interaction, t`Slippi has nobody with the code ${found}.`);
  } else if (elsewhere) {
    profile = (await slippi.getProfiles([elsewhere.uid])).get(elsewhere.uid);
    if (!profile) return replyEphemeralAfterDefer(interaction, t`Slippi doesn't have ${elsewhere.name} (${elsewhere.code}) anymore.`);
  } else {
    return replyEphemeralAfterDefer(interaction, noCodeOnStartgg(player));
  }

  const existing = state.slippi[profile.uid];
  // the rank check moves an existing entry's numbers, so a rank change can't go unposted
  const entry = existing ?? slippiEntry(profile);
  if (player) entry.userId = player.userId;
  // typing someone's code doesn't make it yours. one already on the list only changes hands when a TO says whose
  // it is and nobody had it, which is how a TO's own typed code becomes theirs
  const handed = owner && !player && (!existing || (to && picked && !existing.discordId && !existing.userId));
  if (handed) entry.discordId = owner.id;
  state.slippi[profile.uid] = entry;
  state.slippiSkipped = state.slippiSkipped.filter((uid) => uid !== profile.uid);
  save();

  const name = escapeMarkdown(profile.name);
  let content = t`Added ${name} to the Slippi watchlist. Their rank changes get posted here.`;
  if (existing && handed) content = self ? t`${name} is on the Slippi watchlist as yours now.` : t`${name} is on the Slippi watchlist as ${who}'s now.`;
  else if (existing) content = t`${name} is already on the Slippi watchlist.`;
  if (to && !entry.discordId && !entry.userId) {
    content += t('\n-# Not tied to anyone, so `/slippi rank` with `player` left out won\'t find them. Add `user:` to say whose code it is.');
  }
  const { files, characterFile } = await slippi.slippiArt(profile);
  await interaction.editReply({
    content,
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

// someone on the watchlist, any connect code, or whoever ran it: the code they're on the watchlist with, here or in
// another server, then the one on their start.gg
async function slippiRank(interaction) {
  const typed = interaction.options.getString('player');
  const me = linkedPlayer(interaction.user.id);
  const entry = typed ? watched(typed) : ownEntry(interaction.user.id, { everywhere: true });
  const code = typed && !entry ? slippi.readCode(typed) : null;
  if (typed && !entry && !code) {
    const near = nearestWatched(typed) || t(' Pick someone from the list, or type a connect code like ABCD#123.');
    return replyEphemeral(interaction, t`Nobody on the watchlist goes by that.${near}`);
  }
  if (!typed && !entry && !me) {
    return replyEphemeral(interaction, t('Pick someone, or add your code with `/slippi add code:ABCD#123` so leaving it out finds you.'));
  }

  await interaction.deferReply();
  let profile;
  if (entry) {
    profile = (await slippi.getProfiles([entry.uid])).get(entry.uid);
    if (!profile) return replyEphemeralAfterDefer(interaction, t`Slippi doesn't have ${entry.name} (${entry.code}) anymore.`);
  } else {
    const found = code ?? await codeOnStartgg(me);
    if (!found) {
      return replyEphemeralAfterDefer(interaction, t`Couldn't find a connect code on ${escapeMarkdown(me.tag)}'s start.gg. Add yours with \`/slippi add code:ABCD#123\` and leaving \`player\` out finds it after that.`);
    }
    profile = await slippi.getProfileByCode(found);
    if (!profile) {
      const near = typed ? nearestWatched(found) : '';
      return replyEphemeralAfterDefer(interaction, t`Slippi has nobody with the code ${found}.${near}`);
    }
  }
  // the card says whether they're on this server's watchlist, which yours might not be, or might be under an old code
  const listed = state.slippi[profile.uid] ?? null;
  const { files, characterFile } = await slippi.slippiArt(profile);
  return sendEmbeds(interaction, embeds.slippiRank(profile, { entry: listed, players: state.players, characterFile }), [], files);
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
