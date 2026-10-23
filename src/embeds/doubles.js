import { escapeMarkdown } from 'discord.js';
import { singles, startggUrl } from '../startgg.js';
import {
  colors, baseEmbed, split, withLines, percent, step, count, ordinal, winLoss, recordOf, gameName, gameCount, closeLine, seedLine, sweepLine, streaks, section, bold, GAMES_SHOWN, OPPONENTS_SHOWN, t, listOf,
} from './shared.js';
import { placementLine, upsetLine, upsetSize, biggestUpsets, finish, byFinish, breakdown, breakdownLine } from './stats.js';

const RECENT_EVENTS = 4;
const RECENT_PARTNERS = 3;
const FULL_EVENTS = 5;
const UPSETS_SHOWN = 3;

const NOTE = '-# 2v2 only, DQs left out. Placements come from the events those sets were in. Seeds go by placement tier, and close sets went to the last game';

// their teammate in a set, by start.gg player id. null if start.gg only has them on the team
function partnerOf(me, playerId) {
  const i = me.playerIds.findIndex((id) => String(id) !== String(playerId));
  if (i === -1) return null;
  return { id: me.playerIds[i] ?? null, tag: me.tags?.[i] ?? null };
}

// everyone they teamed with, the most sets first, then the most events. sets give the record and events
// the finishes, and a TO-added teammate without a player only shows up by tag
function partners(player, played, entered) {
  const byKey = new Map();
  const entry = ({ id, tag }) => {
    const key = id ?? tag;
    if (key === null || key === undefined) return null;
    if (!byKey.has(key)) byKey.set(key, { tag: tag ?? t('Unknown'), wins: 0, losses: 0, events: [], last: 0 });
    const found = byKey.get(key);
    if (tag && found.tag === t('Unknown')) found.tag = tag;
    return found;
  };
  for (const { me, won, set } of played) {
    const each = partnerOf(me, player.playerId);
    const found = each && entry(each);
    if (!found) continue;
    found[won ? 'wins' : 'losses']++;
    found.last = Math.max(found.last, set.completedAt ?? 0);
  }
  for (const finished of entered) {
    for (const each of finished.partners) entry(each)?.events.push(finished);
  }
  // sort is stable and sets are newest first, so ties go to who they teamed with last
  return [...byKey.values()].sort((a, b) => b.wins + b.losses - (a.wins + a.losses) || b.events.length - a.events.length);
}

// Partner · 7-3 (70%) · 3 events. verbose adds their best finish together and when they last teamed
function partnerLine({ tag, wins, losses, events, last }, verbose = false) {
  const parts = [bold(tag)];
  if (wins + losses) parts.push(winLoss(wins, losses));
  if (events.length) parts.push(count(events.length, 'event'));
  if (verbose) {
    const best = events.filter(({ event }) => event.numEntrants).toSorted(byFinish)[0];
    if (best) parts.push(t`best ${ordinal(best.placement)} of ${best.event.numEntrants}`);
    if (last) parts.push(t`last ${`<t:${last}:d>`}`);
  }
  return parts.join(' · ');
}

const withPartners = (list) => listOf(list.map((each) => bold(each.tag ?? t('Unknown'))));

// a placement line, then who they teamed with
const finishLine = (entry) => `${placementLine(entry)}${entry.partners.length ? t` · with ${withPartners(entry.partners)}` : ''}`;

// beat Foo / Bar (seed 2) 2-1 as seed 9 at Tournament with Partner
function doublesUpsetLine(result, player) {
  const partner = partnerOf(result.me, player.playerId);
  return `${upsetLine(result)}${partner?.tag ? t` with ${withPartners([partner])}` : ''}`;
}

// the same two players are the same team under any team name. no ids, then it goes by the name
const teamKey = (side) => (side.playerIds.length && side.playerIds.every(Boolean) ? side.playerIds.map(String).sort().join('+') : side.name);

function card(player, label, melee = false) {
  const name = melee
    ? (label.startsWith('Full') ? t('Melee full doubles stats') : t('Melee doubles stats'))
    : (label.startsWith('Full') ? t('Full doubles stats') : t('Doubles stats'));
  const embed = baseEmbed(colors.brand)
    .setAuthor({ name })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (player.image) embed.setThumbnail(player.image);
  return embed;
}

const nothing = (melee) => (melee ? t('No Melee doubles sets on start.gg yet.') : t('No doubles sets on start.gg yet.'));

// the short report: recent record, partners and placements. events are the ones those sets came from
export function doubles(player, sets, events, { melee = false } = {}) {
  const embed = card(player, 'Doubles stats', melee);
  // fromSide finds them on a team the same way, so this works for 2v2 too
  const played = singles(sets, player);
  const entered = events.filter((entry) => !entry.dq);
  if (!played.length && !entered.length) return embed.setDescription(nothing(melee));

  const lines = [];
  if (played.length) {
    const byGame = [...Map.groupBy(played, ({ set }) => gameName(set.event))].map(([game, results]) => `${game} ${recordOf(results)}`);
    lines.push(t`**Recent sets:** ${byGame.join(' · ')}`);
    const games = gameCount(played);
    if (games.won + games.lost) lines.push(t`**Games:** ${winLoss(games.won, games.lost)}`);
  }
  // relative to bracket size, so 4th of 84 beats 3rd of 20
  const best = entered.filter(({ event }) => event.numEntrants).toSorted(byFinish)[0];
  if (best) lines.push(t`**Best finish:** ${finishLine(best)}`);
  const upset = biggestUpsets(played).win;
  if (upset) lines.push(t`**Biggest upset:** ${doublesUpsetLine(upset, player)}`);

  section(lines, t('Partners'), partners(player, played, entered).slice(0, RECENT_PARTNERS).map((each) => partnerLine(each)));
  section(lines, t('Latest events'), entered.slice(0, RECENT_EVENTS).map(finishLine));

  const from = [];
  if (played.length) from.push(count(played.length, 'doubles set'));
  if (entered.length) from.push(count(entered.length, 'event'));
  lines.push(t`-# From their last ${listOf(from)} on start.gg`);
  return embed.setDescription(lines.join('\n'));
}

// the full report: the numbers on one card, then partners, finishes and the teams they played
export function doublesReport(player, sets, events, { melee = false } = {}) {
  const overview = card(player, 'Full doubles stats', melee);
  const played = singles(sets, player);
  const entered = events.filter((entry) => !entry.dq);
  if (!played.length && !entered.length) return [overview.setDescription(nothing(melee))];

  const from = [];
  if (played.length) from.push(t`${count(played.length, 'doubles set')} since ${`<t:${played.at(-1).set.completedAt}:D>`}`);
  if (entered.length) from.push(t`${count(entered.length, 'event')} since ${`<t:${entered.at(-1).event.startAt}:D>`}`);
  const dqs = events.length - entered.length;
  const latest = Math.max(played[0]?.set.completedAt ?? 0, entered[0]?.event.startAt ?? 0);
  const source = dqs ? t`-# From ${listOf(from)} on start.gg, ${count(dqs, 'DQ')} left out` : t`-# From ${listOf(from)} on start.gg`;
  overview.setDescription([t`Last played ${`<t:${latest}:R>`}`, source].join('\n'));

  const team = partners(player, played, entered);
  const sized = entered.filter(({ event }) => event.numEntrants);
  const seeded = entered.filter(({ seed }) => seed);
  const stat = (name, value) => overview.addFields({ name, value: String(value), inline: true });
  if (entered.length) stat(t('Events'), entered.length);
  if (played.length) stat(t('Sets'), recordOf(played));
  const games = gameCount(played);
  if (games.won + games.lost) stat(t('Games'), winLoss(games.won, games.lost));
  if (team.length) stat(t('Partners'), team.length);
  if (entered.length) {
    stat(t('1st places'), entered.filter(({ placement }) => placement === 1).length);
    stat(t('Top 3s'), entered.filter(({ placement }) => placement <= 3).length);
    // top 8 of 8 teams doesn't count
    stat(t('Top 8s'), sized.filter(({ placement, event }) => event.numEntrants > 8 && placement <= 8).length);
  }
  if (sized.length) {
    const finishes = sized.map(finish).sort((a, b) => a - b);
    stat(t('Typical finish'), `top ${Math.ceil(finishes[Math.floor(finishes.length / 2)] * 100)}%`);
  }
  if (seeded.length) {
    const better = seeded.filter(({ placement, seed }) => step(placement) < step(seed)).length;
    const worse = seeded.filter(({ placement, seed }) => step(placement) > step(seed)).length;
    stat(t('Finish vs seed'), t`better ${percent(better, seeded.length)} · worse ${percent(worse, seeded.length)}`);
  }
  if (played.length) {
    const streak = streaks(played);
    stat(t('Win streak'), t`best ${t('W')}${streak.best}, now ${streak.nowWon ? t('W') : t('L')}${streak.now}`);
  }
  const byGame = breakdown(entered, played, gameName, (set) => gameName(set.event))
    .sort((a, b) => b.events.length - a.events.length || b.wins + b.losses - (a.wins + a.losses));
  if (byGame.length > 1) overview.addFields({ name: t('By game'), value: byGame.slice(0, GAMES_SHOWN).map(breakdownLine).join('\n') });

  const lines = [closeLine(played), seedLine(played), sweepLine(played)].filter(Boolean);
  section(lines, t('Partners'), team.slice(0, OPPONENTS_SHOWN).map((each) => partnerLine(each, true)));
  section(lines, t('Best finishes'), sized.toSorted(byFinish).slice(0, FULL_EVENTS).map(finishLine));
  section(lines, t('Latest events'), entered.slice(0, FULL_EVENTS).map(finishLine));
  const upsets = played.filter((result) => upsetSize(result) > 0).sort((x, y) => upsetSize(y) - upsetSize(x));
  // one per event, a bracket reset in grands is the same upset twice
  const top = (list) => list
    .filter((result, i) => list.findIndex((other) => other.set.event.slug === result.set.event.slug) === i)
    .slice(0, UPSETS_SHOWN)
    .map((result) => `${doublesUpsetLine(result, player)} · <t:${result.set.completedAt}:d>`);
  section(lines, t('Biggest wins'), top(upsets.filter(({ won }) => won)));
  section(lines, t('Toughest losses'), top(upsets.filter(({ won }) => !won)));
  lines.push(t(NOTE));
  const results = withLines(baseEmbed(colors.brand), lines);

  // teams they played, the most sets first. sets are newest first, so ties go to who they played last
  const teams = new Map();
  for (const { them, won } of played) {
    const key = teamKey(them);
    if (!teams.has(key)) teams.set(key, { name: them.name, wins: 0, losses: 0 });
    teams.get(key)[won ? 'wins' : 'losses']++;
  }
  // a field holds 1024 characters, and custom team names can be long
  const teamLines = (list) => split(list.slice(0, OPPONENTS_SHOWN).map(({ name, wins, losses }) => `${bold(name)} ${wins}-${losses}`), 1024)[0].join('\n');
  const mostPlayed = [...teams.values()].sort((a, b) => b.wins + b.losses - (a.wins + a.losses));
  const lostTo = [...teams.values()].filter(({ losses }) => losses).sort((a, b) => b.losses - a.losses || a.wins - b.wins);
  const last = results.at(-1);
  if (mostPlayed.length) last.addFields({ name: t('Most played teams'), value: teamLines(mostPlayed), inline: true });
  if (lostTo.length) last.addFields({ name: t('Lost to most'), value: teamLines(lostTo), inline: true });
  return [overview, ...results];
}
