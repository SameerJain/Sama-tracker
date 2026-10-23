import { escapeMarkdown, embedLength } from 'discord.js';
import { RANKS, LOGO, rankOf, rankImage, profileUrl } from '../slippi.js';
import { FOOTER, baseEmbed, colors, withLines, winLoss, ordinal, count, percent, playerLink, bold } from './shared.js';

const SLIPPI_FOOTER = `${FOOTER} · Slippi`;
// the leaderboard stops here, the rest just get counted
export const LEADERBOARD_SHOWN = 50;
const SEASONS_SHOWN = 3;
// on the melee card of /characters
const RANKED_CHARACTERS_SHOWN = 5;

// slippi.gg shows one decimal
const rating = (value) => (value == null ? '-' : value.toFixed(1));
const isRanked = (rankName) => RANKS.indexOf(rankName) > RANKS.indexOf('Pending');
const signed = (change) => `${change >= 0 ? '+' : ''}${change.toFixed(1)}`;

// the start.gg player a watchlist entry came from, if they're still tracked or linked
function startggLine(entry, players) {
  const player = entry?.userId && players[entry.userId];
  return player ? `**start.gg:** ${playerLink(player)}` : null;
}

function placementLine({ global, regional, region }) {
  const parts = [regional && `${ordinal(regional)} in ${region ?? 'their region'}`, global && `${ordinal(global)} worldwide`].filter(Boolean);
  return parts.length ? `**Daily leaderboard:** ${parts.join(' · ')}` : null;
}

function charactersLine(characters, shown = 3) {
  if (!characters?.length) return null;
  return `**Characters:** ${characters.slice(0, shown).map((character) => `${character.name} ${count(character.games, 'game')}`).join(' · ')}`;
}

// the rank badge as the thumbnail, and their most played character's icon by its name. characterFile is
// the name of start.gg's art for it, uploaded with the message, null when there's none
function withArt(embed, profile, characterFile) {
  embed.setThumbnail(`attachment://${rankImage(rankOf(profile).name).name}`);
  const main = profile.characters?.[0];
  if (main && characterFile) embed.setAuthor({ name: main.name, iconURL: `attachment://${characterFile}` });
  return embed;
}

// /slippi rank and /slippi add. entry is the watchlist entry, if they're on it
export function slippiRank(profile, { entry = null, players = {}, characterFile = null } = {}) {
  const rank = rankOf(profile);
  const embed = withArt(baseEmbed(rank.color, SLIPPI_FOOTER), profile, characterFile)
    .setTitle(`${escapeMarkdown(profile.name)} · ${profile.code}`).setURL(profileUrl(profile.code));
  const lines = [];
  if (!profile.updates) lines.push('No ranked sets this season.');
  else if (rank.name === 'Pending') lines.push(`**Pending** · ${count(profile.updates, 'ranked set')} of 5 to get a rank`);
  else lines.push(`**${rank.name}** · ${rating(profile.rating)}`);
  if (profile.wins + profile.losses) lines.push(`**This season:** ${winLoss(profile.wins, profile.losses)}`);
  lines.push(...[placementLine(profile), charactersLine(profile.characters), startggLine(entry, players)].filter(Boolean));

  const seasons = (profile.seasons ?? []).slice(0, SEASONS_SHOWN);
  if (seasons.length) {
    lines.push('', '**Past seasons**', ...seasons.map((season) => `${escapeMarkdown(season.name)} · ${rating(season.rating)} · ${season.wins}-${season.losses}`));
  }
  if (!entry) lines.push('', '-# Not on the watchlist. `/slippi add` them to see rank changes here');
  return withLines(embed, lines);
}

// best rank first, then rating. pending and unranked go last, most sets first
function byRank(a, b) {
  return RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank) || (b.rating ?? 0) - (a.rating ?? 0) || b.updates - a.updates;
}

export function leaderboardOrder(entries) {
  return Object.values(entries).sort(byRank);
}

// the leader's rank badge goes on top, the slippi logo when there's nobody. each line has their most played
// character, since there's one picture a card
export function slippiLeaderboard(entries, players) {
  const all = leaderboardOrder(entries);
  const embed = baseEmbed(colors.slippi, SLIPPI_FOOTER).setTitle(`Slippi leaderboard · ${all.length}`);
  if (!all.length) {
    return [embed.setThumbnail(`attachment://${LOGO.name}`).setDescription('Nobody on the watchlist yet. `/slippi add` a connect code, or wait for the daily search to find tracked players\' codes on start.gg.')];
  }
  embed.setThumbnail(`attachment://${rankImage(all[0].rank).name}`);
  const lines = all.slice(0, LEADERBOARD_SHOWN).map((entry, i) => {
    const player = entry.userId && players[entry.userId];
    // the start.gg tag when there is one, since that's who people know
    const who = escapeMarkdown(player ? player.tag : entry.name);
    const main = entry.characters?.[0]?.name;
    return `${i + 1}\\. [${who}](${profileUrl(entry.code)}) · **${entry.rank}**${isRanked(entry.rank) ? ` · ${rating(entry.rating)}` : ''} · ${entry.wins}-${entry.losses}${main ? ` · ${main}` : ''}`;
  });
  if (all.length > LEADERBOARD_SHOWN) lines.push(`-# ${count(all.length - LEADERBOARD_SHOWN, 'more player')} not shown`);
  const checked = Math.min(...all.map((entry) => entry.checkedAt ?? 0));
  lines.push(`-# This season's ranked ratings and records${checked ? `, as of <t:${checked}:R>` : ''}. Rank changes get posted here`);
  return withLines(embed, lines);
}

// the automatic post. before is the entry as it was at the last check
export function rankChange(entry, before, players, { characterFile = null } = {}) {
  const rank = rankOf(entry);
  const placed = before.rank === 'Pending';
  const up = RANKS.indexOf(entry.rank) > RANKS.indexOf(before.rank);
  const verb = placed ? 'placed into' : up ? 'ranked up to' : 'dropped to';
  const player = entry.userId && players[entry.userId];
  const name = player?.tag ?? entry.name;
  const lines = [`**${rank.name}** · ${rating(entry.rating)}${!placed && before.rating != null ? ` (${signed(entry.rating - before.rating)})` : ''}`];
  if (!placed) lines.push(`-# Was ${before.rank}`);
  lines.push(`**This season:** ${winLoss(entry.wins, entry.losses)}`);
  const placement = placementLine(entry);
  if (placement) lines.push(placement);
  return withArt(baseEmbed(rank.color, SLIPPI_FOOTER), entry, characterFile)
    .setTitle(`Slippi rank change · ${escapeMarkdown(name)} ${verb} ${rank.name}`)
    .setURL(profileUrl(entry.code))
    .setDescription(lines.join('\n'));
}

// a season's wrap-up shows this many finishers, climbers and characters
const WRAP_FINISHERS_SHOWN = 10;
const WRAP_CLIMBERS_SHOWN = 3;
const WRAP_CHARACTERS_SHOWN = 3;

// the automatic post when slippi's history shows a season ended: final ranks, the biggest rating gains on the
// season before, and the characters the watchlist played most. finishers are the watchlist players with that
// season in their history, each with its final numbers, previous being the season before it. null when nobody
// got a rank. the leader's rank badge goes on top, as { embed, files }
export function seasonWrapUp(season, finishers, players) {
  const ranked = leaderboardOrder(finishers.filter((each) => isRanked(each.rank)));
  if (!ranked.length) return null;
  const who = (each) => {
    const player = each.userId && players[each.userId];
    return `[${escapeMarkdown(player ? player.tag : each.name)}](${profileUrl(each.code)})`;
  };
  const lines = ['**Final ranks**', ...ranked.slice(0, WRAP_FINISHERS_SHOWN).map((each, i) => {
    const main = each.characters[0]?.name;
    return `${i + 1}\\. ${who(each)} · **${each.rank}** · ${rating(each.rating)} · ${each.wins}-${each.losses}${main ? ` · ${main}` : ''}`;
  })];
  if (ranked.length > WRAP_FINISHERS_SHOWN) lines.push(`-# ${count(ranked.length - WRAP_FINISHERS_SHOWN, 'more ranked player')}`);

  const climbers = ranked.filter((each) => each.previous?.rating != null && each.rating > each.previous.rating)
    .sort((a, b) => (b.rating - b.previous.rating) - (a.rating - a.previous.rating)).slice(0, WRAP_CLIMBERS_SHOWN);
  if (climbers.length) {
    lines.push('', '**Biggest climbers**', ...climbers.map((each) => `${who(each)} · ${rating(each.previous.rating)} to ${rating(each.rating)} (${signed(each.rating - each.previous.rating)}) since ${escapeMarkdown(each.previous.name)}`));
  }

  const games = new Map();
  for (const each of finishers) for (const character of each.characters) games.set(character.name, (games.get(character.name) ?? 0) + character.games);
  const most = [...games].sort((a, b) => b[1] - a[1]).slice(0, WRAP_CHARACTERS_SHOWN);
  if (most.length) lines.push('', `**Most played:** ${most.map(([name, total]) => `${name} ${count(total, 'game')}`).join(' · ')}`);
  lines.push(`-# ${count(ranked.length, 'ranked player')} on the watchlist. Ratings from slippi.gg's season history, characters from the last check before each reset`);

  const badge = rankImage(ranked[0].rank);
  const embed = baseEmbed(colors.slippi, SLIPPI_FOOTER).setTitle(`Slippi ${escapeMarkdown(season.name)} wrap-up`)
    .setThumbnail(`attachment://${badge.name}`).setDescription(lines.join('\n'));
  return { embed, files: [badge] };
}

// CREW#1 · Gold 2 · 1600.0 · 12-8
function rankLine(profile) {
  const rank = rankOf(profile).name;
  const record = profile.wins + profile.losses ? ` · ${profile.wins}-${profile.losses}` : '';
  return `[${profile.code}](${profileUrl(profile.code)}) · **${rank}**${isRanked(rank) ? ` · ${rating(profile.rating)}` : ''}${record}`;
}

// the Slippi ranked field goes on a report card only when it fits, so it can never be what gets a report
// rejected. a lifetime /stats card already has a lot of fields
function addSlippiField(card, lines) {
  const field = { name: 'Slippi ranked', value: lines.join('\n').slice(0, 1024) };
  if ((card.data.fields?.length ?? 0) >= 25 || embedLength(card.data) + field.name.length + field.value.length > 6000) return card;
  return card.addFields(field);
}

// a Slippi ranked field on the first card of a melee report, one line each for a matchup and more for one
// player. profiles lines up with players, null for anyone not on the watchlist, who isn't mentioned. odds says
// whether the card has prediction odds, and slippi whether their ratings counted toward those melee odds.
// seasons adds how far their rating moved since last season for /progress. anything going wrong here
// leaves the report as it was
export function withSlippi(cards, players, profiles, { odds = false, slippi = false, seasons = false } = {}) {
  if (!cards.length || !profiles?.some(Boolean)) return cards;
  try {
    const lines = [];
    if (players.length > 1) {
      players.forEach((player, i) => profiles[i] && lines.push(`${bold(player.tag)}: ${rankLine(profiles[i])}`));
    } else {
      const [profile] = profiles;
      lines.push(`${rankLine(profile)}${profile.wins + profile.losses ? ' this season' : ''}`);
      lines.push(...[placementLine(profile), charactersLine(profile.characters)].filter(Boolean));
      const last = seasons && profile.seasons?.[0];
      if (last && isRanked(rankOf(profile).name)) lines.push(`**Since ${escapeMarkdown(last.name)}:** ${rating(last.rating)} to ${rating(profile.rating)} (${signed(profile.rating - last.rating)})`);
      else if (last) lines.push(`**${escapeMarkdown(last.name)}:** ${rating(last.rating)} · ${last.wins}-${last.losses}`);
    }
    lines.push(`-# Netplay ranked from slippi.gg${odds ? (slippi ? ', part of the Melee odds' : ', not part of the odds') : ''}`);
    addSlippiField(cards[0], lines);
  } catch (err) {
    console.error('adding slippi to a report failed:', err.message);
  }
  return cards;
}

// the melee card of /characters: what they've played in ranked this season, next to what TOs reported
export function withRankedCharacters(card, profile) {
  const characters = profile?.characters ?? [];
  if (!characters.length) return card;
  try {
    const games = characters.reduce((sum, character) => sum + character.games, 0);
    const lines = characters.slice(0, RANKED_CHARACTERS_SHOWN)
      .map((character, i) => `${i + 1}\\. ${bold(character.name)} · ${count(character.games, 'game')}${characters.length > 1 ? ` · ${percent(character.games, games)}` : ''}`);
    if (characters.length > RANKED_CHARACTERS_SHOWN) lines.push(`-# ${count(characters.length - RANKED_CHARACTERS_SHOWN, 'more character')}`);
    lines.push(`-# [${profile.code}](${profileUrl(profile.code)}) on slippi.gg, this season`);
    addSlippiField(card, lines);
  } catch (err) {
    console.error('adding slippi characters failed:', err.message);
  }
  return card;
}

// /predict with no odds to put the field under, which netplay players with no melee sets on start.gg get.
// it goes out with the slippi logo
export function slippiMatchup(players, profiles) {
  const card = baseEmbed(colors.slippi, SLIPPI_FOOTER).setThumbnail(`attachment://${LOGO.name}`);
  return withSlippi([card], players, profiles).filter((each) => each.data.fields?.length);
}
