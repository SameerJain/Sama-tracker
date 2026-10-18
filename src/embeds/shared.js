import { EmbedBuilder, embedLength, escapeMarkdown } from 'discord.js';
import { startggUrl } from '../startgg.js';

export const colors = {
  brand: 0x5b21b6,
  win: 0x22c55e,
  loss: 0xef4444,
  clash: 0xf59e0b, // tracked vs tracked
  results: 0xfacc15,
  stream: 0x9146ff,
  live: 0xe11d48,
  sm4sh: 0x00a2e8,
  melee: 0x6a5acd,
  ult: 0xe60012,
  64: 0x009e49,
  brawl: 0xc9a227,
  pplus: 0x14b8a6,
  bills: 0x00338d,
  reg: 0xdc2626,
  regEarly: 0xf59e0b,
};

// double elim placements: 1, 2, 3, 4, 5, 7, 9, 13, 17, 25...
const PLACEMENTS = [1, 2];
for (let n = 2; n <= 4096; n *= 2) PLACEMENTS.push(n + 1, n * 1.5 + 1);

// index into PLACEMENTS, so seed 9 and 9th place are both 6
export const step = (n) => PLACEMENTS.findLastIndex((place) => place <= n);

export const CHARACTERS_SHOWN = 5;

export const OPPONENTS_SHOWN = 8;

export const GAMES_SHOWN = 6;

export const LEANS_SHOWN = 3;

export const DAY = 24 * 60 * 60;

// on the bottom of every card. a game or source goes after it
export const FOOTER = 'Sama-tracker by Samatron';

export function baseEmbed(color, footer = FOOTER) {
  return new EmbedBuilder().setColor(color).setFooter({ text: footer });
}

// lines grouped so each group fits in one description
export function split(lines, max = 4096) {
  const groups = [];
  let size = Infinity;
  for (const line of lines) {
    if (size + line.length + 1 > max) {
      groups.push([]);
      size = 0;
    }
    groups.at(-1).push(line);
    size += line.length + 1;
  }
  return groups;
}

// a list too long for one embed carries on in more of the same color
function continued(embed, [first, ...rest]) {
  return [embed.setDescription(first), ...rest.map((text) => baseEmbed(embed.data.color, embed.data.footer?.text).setDescription(text))];
}

export function withLines(embed, lines) {
  return continued(embed, split(lines).map((group) => group.join('\n')));
}

// the same for sections with a blank line between, so a card only ever starts at a section.
// a section too long for a card of its own is the one thing that gets cut
export function withSections(embed, sections) {
  const blocks = sections.flatMap((lines) => split(lines, 4095).map((group) => `${group.join('\n')}\n`));
  return continued(embed, split(blocks).map((group) => group.join('\n').trimEnd()));
}

// the bot's own avatar, set once discord says who it is. every message gets some picture, so one with
// none of its own wears this on its first card. a picture per message, not per card, so a long report
// doesn't repeat it down the side
let fallbackImage = null;
export function setFallbackImage(url) {
  fallbackImage = url;
}

const hasImage = (embed) => Boolean(embed.data.thumbnail?.url || embed.data.image?.url);

export function withImage(batch) {
  if (fallbackImage && batch.length && !batch.some(hasImage)) batch[0].setThumbnail(fallbackImage);
  return batch;
}

// a message fits 10 embeds and 6000 chars between them, the rest go in more messages
export function messages(list) {
  const batches = [];
  let size = Infinity;
  for (const embed of list) {
    const length = embedLength(embed.data);
    if (batches.at(-1)?.length === 10 || size + length > 6000) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1).push(embed);
    size += length;
  }
  // a picture's url doesn't count toward the 6000, so this can't push a message over
  return batches.map(withImage);
}

export function playerLink(player) {
  return `[${escapeMarkdown(player.tag)}](${startggUrl(player.slug)})`;
}

export function setUrl(set) {
  return startggUrl(`${set.event.slug}/set/${set.id}`);
}

export function setLink(set) {
  return `[${escapeMarkdown(set.event.tournament.name)}](${setUrl(set)})`;
}

export function percent(part, whole) {
  return `${Math.round((part / whole) * 100)}%`;
}

// 0.05 -> top 5%. rounded up so nobody's ever the top 0%
export const topText = (share) => `top ${Math.ceil(share * 100)}%`;

export function ordinal(n) {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;

  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

export function medal(placement) {
  if (placement === 1) return '🥇 ';
  if (placement === 2) return '🥈 ';
  if (placement === 3) return '🥉 ';
  return '';
}

export function scoreText(me, them) {
  if (me.score === -1 || them.score === -1) return 'DQ'; // start.gg's DQ score
  if (me.score === null || them.score === null) return 'vs';
  return `${me.score}-${them.score}`;
}

export function upsetFactor(winner, loser) {
  if (!winner.seed || !loser.seed) return 0;
  return step(winner.seed) - step(loser.seed);
}

export function winLoss(wins, losses) {
  return `${wins}-${losses}${wins + losses ? ` (${percent(wins, wins + losses)})` : ''}`;
}

export const winsOf = (list) => list.filter(({ won }) => won).length;

// for a list of results from fromSide
export function recordOf(list) {
  const wins = winsOf(list);
  return winLoss(wins, list.length - wins);
}

// 2-1, without the percent
export function shortRecord(list) {
  const wins = winsOf(list);
  return `${wins}-${list.length - wins}`;
}

export function gameName(event) {
  return event.videogame?.displayName ?? 'Other';
}

export const GRAND_FINALS = /grand final/i;

// some sets only have a winner reported, no score
export function gameCount(played) {
  const scored = played.filter(({ me, them }) => me.score !== null && them.score !== null);
  return { won: scored.reduce((sum, { me }) => sum + me.score, 0), lost: scored.reduce((sum, { them }) => sum + them.score, 0) };
}

// went to the last game, like 2-1 or 3-2
const isClose = ({ me, them }) => me.score > 0 && them.score > 0 && Math.abs(me.score - them.score) === 1;

export function closeLine(played) {
  const close = played.filter(isClose);
  return close.length ? `**Close sets:** ${recordOf(close)}` : null;
}

// against people seeded a placement tier above them in that bracket, then below
export function seedLine(played) {
  const seeded = played.filter(({ me, them }) => me.seed && them.seed);
  const higher = seeded.filter(({ me, them }) => step(them.seed) < step(me.seed));
  const lower = seeded.filter(({ me, them }) => step(them.seed) > step(me.seed));
  const parts = [higher.length && `**Vs higher seeds:** ${recordOf(higher)}`, lower.length && `**Vs lower seeds:** ${recordOf(lower)}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// sets won without dropping a game, and lost without taking one
export function sweepLine(played) {
  const scored = played.filter(({ me, them }) => me.score !== null && them.score !== null);
  const wins = scored.filter(({ won }) => won);
  const losses = scored.filter(({ won }) => !won);
  const sweeps = [];
  if (wins.length) sweeps.push(`won ${wins.filter(({ them }) => them.score === 0).length} of ${wins.length} without dropping a game`);
  if (losses.length) sweeps.push(`lost ${losses.filter(({ me }) => me.score === 0).length} of ${losses.length} without taking one`);
  return sweeps.length ? `**Sweeps:** ${sweeps.join(' · ')}` : null;
}

// played is newest first. the run at the newest end, then the longest each way
export function streaks(played) {
  let best = 0;
  let worst = 0;
  let win = 0;
  let loss = 0;
  for (const { won } of played) {
    win = won ? win + 1 : 0;
    loss = won ? 0 : loss + 1;
    best = Math.max(best, win);
    worst = Math.max(worst, loss);
  }
  const ended = played.findIndex((result) => result.won !== played[0]?.won);
  return { now: played.length ? (ended === -1 ? played.length : ended) : 0, nowWon: played[0]?.won ?? false, best, worst };
}

// W 2-1 · Winners Final · Tournament · date
export function meetingLine({ set, me, them, won }) {
  return `**${won ? 'W' : 'L'}** ${scoreText(me, them)}${set.round ? ` · ${set.round}` : ''} · ${setLink(set)} · <t:${set.completedAt}:d>`;
}

// a small heading over the list, which leaves bold for the labels and names inside it
export function section(lines, title, list) {
  if (!list.length) return;
  lines.push(`### ${title}`, ...list);
}

// player names stand out in a line full of numbers
export function bold(name) {
  return `**${escapeMarkdown(name)}**`;
}

// 1. Fox · 70% of games · won 40 of 60 (67%)
export function characterRank(usage, character, i) {
  const share = usage.characters.length > 1 ? ` · ${percent(character.games, usage.games)} of games` : '';
  const won = `won ${character.wins} of ${character.games} (${percent(character.wins, character.games)})`;
  // escaped so discord shows "1." as typed instead of making it a list
  return `${i + 1}\\. ${bold(character.name)}${share} · ${won}`;
}

export function count(n, word, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`;
}
