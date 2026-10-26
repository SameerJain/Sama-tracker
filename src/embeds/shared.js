import { EmbedBuilder, embedLength, escapeMarkdown } from 'discord.js';
import { startggUrl } from '../startgg.js';
import { percent, recordOf, scoreText, step } from '../format.js';
import { t } from '../i18n.js';

export {
  step, percent, topText, medal, scoreText, upsetFactor, MAJOR_UPSET, winLoss, winsOf, recordOf, shortRecord,
} from '../format.js';
// in the server's language, see i18n.js
export { count, ordinal, t, listOf } from '../i18n.js';

// each color means one thing, so pick a card's by what it is. the four outcome colors are what /t-o settings set_colors
// paints set results with, so no other tournament or reminder card uses them or anything close: a match call in red
// read as a loss. slippi and the games keep their own colors, which their cards' badges and art make plain
export const colors = {
  // outcomes: set results and the Bills final. clash is two tracked players meeting, and /h2h, /predict and
  // /scout's matchup card, which are the same two players facing off
  win: 0x22c55e,
  loss: 0xef4444,
  clash: 0xf59e0b,
  setDefault: 0x0891b2, // set results with colors off, or when nobody tracked played
  reset: 0x6b7280, // a result the TO took back
  // lookups, plus tournament info before it starts: roll calls, /registered, /upcoming
  brand: 0x5b21b6,
  // during a tournament: match calls, /run, and /bracket, /stream_link and /upcoming once it's started. stream
  // alerts keep twitch's purple next to it
  live: 0xc026d3,
  stream: 0x9146ff,
  // reminders, getting more urgent: the early reg reminders and the start DM, then the last call, its DM and /reg_warn
  regEarly: 0xf97316,
  reg: 0xc2410c,
  // how it went: placements, top 8s and the weekly recap
  results: 0xfacc15,
  thread: 0x2563eb, // the cards that head the threads from /t-o settings threads
  system: 0xec4899, // status and bot updates, never feature cards
  slippi: 0x21ba45, // slippi.gg's green, for slippi cards without a rank. rank cards take the rank's color
  // each game's own color, for its fun command and its matchmaking pings
  sm4sh: 0x00a2e8,
  melee: 0x6a5acd,
  ult: 0xe60012,
  64: 0x009e49,
  brawl: 0x92400e, // dark bronze, so it never reads as the results yellow
  pplus: 0x14b8a6,
  bills: 0x00338d,
};

// how many of each a card lists
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
  for (const line of lines.flatMap((each) => (each.length > max ? cut(each, max) : [each]))) {
    if (size + line.length + 1 > max) {
      groups.push([]);
      size = 0;
    }
    groups.at(-1).push(line);
    size += line.length + 1;
  }
  return groups;
}

// one line longer than a whole card, broken at its last space before the limit, or right at it with no space
// in reach. never inside an emoji or other character that takes two code units
function cut(line, max) {
  const pieces = [];
  let rest = line;
  while (rest.length > max) {
    const space = rest.lastIndexOf(' ', max);
    let at = space > max / 2 ? space : max;
    if (at > 1 && /[\uD800-\uDBFF]/.test(rest[at - 1])) at -= 1;
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^ /, '');
  }
  return [...pieces, rest];
}

// a list too long for one embed carries on in more of the same color
function continued(embed, [first, ...rest]) {
  return [embed.setDescription(first), ...rest.map((text) => baseEmbed(embed.data.color, embed.data.footer?.text).setDescription(text))];
}

export function withLines(embed, lines) {
  return continued(embed, split(lines).map((group) => group.join('\n')));
}

// the same for sections with a blank line between, so a card only ever starts at a section.
// a section too long for a card of its own is the one thing that gets cut. max leaves room
// for a first line the caller adds after, like a page number
export function withSections(embed, sections, max = 4096) {
  const blocks = sections.flatMap((lines) => split(lines, max - 1).map((group) => `${group.join('\n')}\n`));
  return continued(embed, split(blocks, max).map((group) => group.join('\n').trimEnd()));
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

// whether a report was run with a since date or venue filter on
export const filtersOn = ({ since, venue } = {}) => Boolean(since || venue);

// what a filtered report says about since and venue, '' when neither is on
function filterNote({ since, venue } = {}) {
  const parts = [];
  if (venue) parts.push(venue === 'online' ? t('online only') : t('offline only'));
  if (since) parts.push(t`since ${`<t:${since}:D>`}`);
  return parts.join(' · ');
}

// the note as its own small line, or nothing when neither filter is on
export function filterLine(filters) {
  const note = filterNote(filters);
  return note ? `-# ${note[0].toUpperCase()}${note.slice(1)}` : '';
}

// the TO's VOD link for a set, if they added one. missing stays unknown, so nothing when there isn't one
// a ) would end the link early, so those get encoded the way /socials does
export function vodLink(set) {
  return set?.vod ? ` · [VOD](${set.vod.replaceAll('(', '%28').replaceAll(')', '%29')})` : '';
}

// the venue's name and street address from start.gg as plain text, for cards and discord events. the name gets
// left off when the address already starts with it. null online, or when the TO filled in neither
export function venueText(tournament) {
  if (tournament.isOnline) return null;
  const name = tournament.venueName?.trim();
  const address = tournament.venueAddress?.trim();
  if (!address) return name || null;
  if (!name || address.toLowerCase().startsWith(name.toLowerCase())) return address;
  return `${name}, ${address}`;
}

// a map search for the venue's address, so tapping the location on a phone opens directions. parens get
// encoded so they can't end the markdown link early
export function mapUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`.replaceAll('(', '%28').replaceAll(')', '%29');
}

// reminder hours the way /track list shows them: 7d, 3d, 1d, 6h
export function shortSchedule(schedule) {
  return schedule.map((hours) => (hours % 24 ? `${hours}h` : `${hours / 24}d`)).join(', ');
}

export function gameName(event) {
  return event.videogame?.displayName ?? t('Other');
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
  return close.length ? t`**Close sets:** ${recordOf(close)}` : null;
}

// against people seeded a placement tier above them in that bracket, then below
export function seedLine(played) {
  const seeded = played.filter(({ me, them }) => me.seed && them.seed);
  const higher = seeded.filter(({ me, them }) => step(them.seed) < step(me.seed));
  const lower = seeded.filter(({ me, them }) => step(them.seed) > step(me.seed));
  const parts = [higher.length && t`**Vs higher seeds:** ${recordOf(higher)}`, lower.length && t`**Vs lower seeds:** ${recordOf(lower)}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// sets won without dropping a game, and lost without taking one
export function sweepLine(played) {
  const scored = played.filter(({ me, them }) => me.score !== null && them.score !== null);
  const wins = scored.filter(({ won }) => won);
  const losses = scored.filter(({ won }) => !won);
  const sweeps = [];
  if (wins.length) sweeps.push(t`won ${wins.filter(({ them }) => them.score === 0).length} of ${wins.length} without dropping a game`);
  if (losses.length) sweeps.push(t`lost ${losses.filter(({ me }) => me.score === 0).length} of ${losses.length} without taking one`);
  return sweeps.length ? t`**Sweeps:** ${sweeps.join(' · ')}` : null;
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
  // the whole list when it never broke, which is 0 for no sets
  const ended = played.findIndex((result) => result.won !== played[0].won);
  return { now: ended === -1 ? played.length : ended, nowWon: played[0]?.won ?? false, best, worst };
}

// W 2-1 · Winners Final · Tournament · VOD · date, with the VOD only when the TO added one
export function meetingLine({ set, me, them, won }) {
  return `**${won ? t('W') : t('L')}** ${scoreText(me, them)}${set.round ? ` · ${set.round}` : ''} · ${setLink(set)}${vodLink(set)} · <t:${set.completedAt}:d>`;
}

// a small heading over the list, which leaves bold for the labels and names inside it
export function section(lines, title, list) {
  if (!list.length) return;
  lines.push(`### ${title}`, ...list);
}

// win rates 0-1, oldest first, null for no sets. higher blocks mean better
export function sparkline(rates) {
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  return rates.map((rate) => (rate == null ? '·' : blocks[Math.min(7, Math.max(0, Math.round(rate * 7)))])).join('');
}

// player names stand out in a line full of numbers
export function bold(name) {
  return `**${escapeMarkdown(name)}**`;
}

// 1. Fox · 70% of games · won 40 of 60 (67%)
export function characterRank(usage, character, i) {
  const share = usage.characters.length > 1 ? t` · ${percent(character.games, usage.games)} of games` : '';
  const won = t`won ${character.wins} of ${character.games} (${percent(character.wins, character.games)})`;
  // escaped so discord shows "1." as typed instead of making it a list
  return `${i + 1}\\. ${bold(character.name)}${share} · ${won}`;
}
