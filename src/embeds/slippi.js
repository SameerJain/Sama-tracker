import { escapeMarkdown } from 'discord.js';
import { RANKS, rankOf, profileUrl } from '../slippi.js';
import { FOOTER, baseEmbed, withLines, winLoss, ordinal, count, playerLink } from './shared.js';

const SLIPPI_FOOTER = `${FOOTER} · Slippi`;
// the leaderboard stops here, the rest just get counted
export const LEADERBOARD_SHOWN = 50;
const SEASONS_SHOWN = 3;

// slippi.gg shows one decimal
const rating = (value) => (value == null ? '-' : value.toFixed(1));

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

// /slippi rank and /slippi add. entry is the watchlist entry, if they're on it
export function slippiRank(profile, { entry = null, players = {} } = {}) {
  const rank = rankOf(profile);
  const embed = baseEmbed(rank.color, SLIPPI_FOOTER).setTitle(`${escapeMarkdown(profile.name)} · ${profile.code}`).setURL(profileUrl(profile.code));
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

export function slippiLeaderboard(entries, players) {
  const all = Object.values(entries).sort(byRank);
  const embed = baseEmbed(0x21ba45, SLIPPI_FOOTER).setTitle(`Slippi leaderboard · ${all.length}`);
  if (!all.length) {
    return [embed.setDescription('Nobody on the watchlist yet. `/slippi add` a connect code, or wait for the daily search to find tracked players\' codes on start.gg.')];
  }
  const lines = all.slice(0, LEADERBOARD_SHOWN).map((entry, i) => {
    const ranked = RANKS.indexOf(entry.rank) > RANKS.indexOf('Pending');
    const player = entry.userId && players[entry.userId];
    // the start.gg tag when there is one, since that's who people know
    const who = player ? `${escapeMarkdown(player.tag)}` : escapeMarkdown(entry.name);
    return `${i + 1}\\. [${who}](${profileUrl(entry.code)}) · **${entry.rank}**${ranked ? ` · ${rating(entry.rating)}` : ''} · ${entry.wins}-${entry.losses}`;
  });
  if (all.length > LEADERBOARD_SHOWN) lines.push(`-# ${count(all.length - LEADERBOARD_SHOWN, 'more player')} not shown`);
  const checked = Math.min(...all.map((entry) => entry.checkedAt ?? 0));
  lines.push(`-# This season's ranked ratings and records${checked ? `, as of <t:${checked}:R>` : ''}. Rank changes get posted here`);
  return withLines(embed, lines);
}

// the automatic post. before is the entry as it was at the last check
export function rankChange(entry, before, players) {
  const rank = rankOf(entry);
  const placed = before.rank === 'Pending';
  const up = RANKS.indexOf(entry.rank) > RANKS.indexOf(before.rank);
  const verb = placed ? 'placed into' : up ? 'ranked up to' : 'dropped to';
  const player = entry.userId && players[entry.userId];
  const name = player?.tag ?? entry.name;
  const lines = [`**${rank.name}** · ${rating(entry.rating)}${!placed && before.rating != null ? ` (${entry.rating >= before.rating ? '+' : ''}${(entry.rating - before.rating).toFixed(1)})` : ''}`];
  if (!placed) lines.push(`-# Was ${before.rank}`);
  lines.push(`**This season:** ${winLoss(entry.wins, entry.losses)}`);
  const placement = placementLine(entry);
  if (placement) lines.push(placement);
  return baseEmbed(rank.color, SLIPPI_FOOTER)
    .setTitle(`${escapeMarkdown(name)} ${verb} ${rank.name}`)
    .setURL(profileUrl(entry.code))
    .setDescription(lines.join('\n'));
}
