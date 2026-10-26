import { escapeMarkdown } from 'discord.js';
import { ULTIMATE, singles, startggUrl } from '../startgg.js';
import { characterUsageByGame, leans } from '../characters.js';
import { lifetimeStats } from './stats.js';
import { chancePercent, commonOpponentLines } from './players.js';
import {
  colors, FOOTER, baseEmbed, withLines, count, gameName, recordOf, section, bold, scoreText, setLink, vodLink, filterLine, closeLine,
  seedLine, sweepLine, GRAND_FINALS, CHARACTERS_SHOWN, GAMES_SHOWN, LEANS_SHOWN, DAY, winLoss, characterRank, meetingLine, t, listOf,
} from './shared.js';

// /scout's form line per game, and how many sets it lists
const RECENT_SETS = 20;

const LATEST_SETS = 5;

// /scout verbose
const SCOUT_LATEST_SETS = 8;

const SCOUT_CHARACTER_GAMES = 3;

const MEETINGS_SHOWN = 10;

// quick shows a few, verbose shows more of who they lose to most
const TRICKY_QUICK = 3;

const TRICKY_VERBOSE = 8;

const TRICKY_MAINS = 3;

// their record over their last 20 sets in each game, the game they played last first.
// verbose adds the last 90 days, which says more for someone who doesn't play much
function formLines(played, verbose = false) {
  const since = Math.floor(Date.now() / 1000) - 90 * DAY;
  return [...Map.groupBy(played, ({ set }) => gameName(set.event))].slice(0, GAMES_SHOWN).map(([game, list]) => {
    const recent = list.slice(0, RECENT_SETS);
    const line = t`**${escapeMarkdown(game)}:** ${recordOf(recent)} · last ${count(recent.length, 'set')}`;
    if (!verbose) return line;
    const lately = list.filter(({ set }) => set.completedAt >= since);
    return t`${line} · ${lately.length ? recordOf(lately) : t('none')} in the last 90 days`;
  });
}

// sets that came down to the last game, by final score. a best-of-3 can only end 2-1 that way and a best-of-5
// only 3-2, so a best-of-5's game 3 never counts as a game 3. whoever won the set won that game. DQs never get
// here, and a set with no score doesn't count
function deciders(played, [last, other]) {
  return played.filter(({ me, them }) => (me.score === last && them.score === other) || (me.score === other && them.score === last));
}

// how they do when it comes down to game 3 of a best-of-3 or game 5 of a best-of-5, one line per game
function decidingLines(played) {
  const rate = (list) => {
    const won = list.filter((result) => result.won).length;
    return { won, total: list.length, percent: Math.round((won / list.length) * 100) };
  };
  const lines = [...Map.groupBy(played, ({ set }) => gameName(set.event))].slice(0, GAMES_SHOWN).map(([game, list]) => {
    const parts = [];
    const threes = deciders(list, [2, 1]);
    if (threes.length) {
      const { won, total, percent } = rate(threes);
      parts.push(t`game 3s ${percent}% (${won} of ${total})`);
    }
    const fives = deciders(list, [3, 2]);
    if (fives.length) {
      const { won, total, percent } = rate(fives);
      parts.push(t`game 5s ${percent}% (${won} of ${total})`);
    }
    return parts.length ? `**${escapeMarkdown(game)}:** ${parts.join(' · ')}` : null;
  }).filter(Boolean);
  return lines.length ? [...lines, t('-# Game 3s count best-of-3 sets that went to game 3, and game 5s best-of-5 sets that went to game 5')] : [];
}

// W 2-1 vs Foo · Tournament · VOD · date, with the round for verbose and the VOD when the TO added one
function latestSetLine({ set, me, them, won }, round = false) {
  return t`**${won ? t('W') : t('L')}** ${scoreText(me, them)} vs ${bold(them.name)}${round && set.round ? ` · ${set.round}` : ''} · ${setLink(set)}${vodLink(set)} · <t:${set.completedAt}:d>`;
}

// sets between the two from player's side, newest first. both histories since either can get cut off
function meetingsOf(player, opponent, mine, theirs) {
  const sets = [...new Map([...mine, ...theirs].map((set) => [set.id, set])).values()];
  return singles(sets, player)
    .filter(({ them }) => them.playerIds.includes(opponent.playerId))
    .sort((x, y) => y.set.completedAt - x.set.completedAt);
}

// players they have lost to most, most losses then worst rate.
// exclude is player ids to leave out, so the caller doesn't show up next to their own head-to-head
function trickyOpponents(played, limit, exclude = []) {
  const byOpponent = new Map();
  for (const { them, won } of played) {
    const id = them.playerIds[0] ?? `name:${them.name}`;
    if (exclude.includes(them.playerIds[0])) continue;
    if (!byOpponent.has(id)) byOpponent.set(id, { name: them.name, playerIds: them.playerIds, wins: 0, losses: 0 });
    const record = byOpponent.get(id);
    if (won) record.wins++;
    else record.losses++;
  }
  const rate = ({ wins, losses }) => wins / (wins + losses);
  return [...byOpponent.values()]
    .filter((record) => record.losses > 0)
    .sort((a, b) => b.losses - a.losses || rate(a) - rate(b) || (b.wins + b.losses) - (a.wins + a.losses))
    .slice(0, limit);
}

// your record against one of their toughest opponents, for the player vs player opening
function callerRecord(mine, player, tricky) {
  const key = tricky.playerIds[0] ?? `name:${tricky.name}`;
  let wins = 0;
  let losses = 0;
  let found = false;
  for (const { them, won } of singles(mine, player)) {
    if ((them.playerIds[0] ?? `name:${them.name}`) !== key) continue;
    found = true;
    if (won) wins++;
    else losses++;
  }
  return found ? t` · you're ${wins}-${losses} vs them` : '';
}

function trickyOpponentLine(record) {
  return `${bold(record.name)} ${winLoss(record.wins, record.losses)}`;
}

// worst win rate against one character, even though TO reporting can be out of date
function trickyMatchupLines(characterSets, limit = LEANS_SHOWN) {
  const lines = [];
  for (const { game, usage } of characterUsageByGame(characterSets).slice(0, GAMES_SHOWN)) {
    if (!usage.reported) continue;
    const { bad } = leans(usage.against);
    if (!bad.length) continue;
    lines.push(t`**${escapeMarkdown(game.displayName)}:** ${bad.slice(0, limit).map(({ name, wins, games }) => `${escapeMarkdown(name)} ${winLoss(wins, games - wins)}`).join(' · ')}`);
  }
  return lines;
}

// melee means every list holds only Melee, filtered before it got here. filters only narrowed them,
// so the card names those on its small line
export function scout(player, opponent, mine, theirs, characterSets, { melee = false, filters = {} } = {}) {
  const played = singles(theirs, opponent);
  const meetings = meetingsOf(player, opponent, mine, theirs);
  const lines = [];
  section(lines, t('Recent form'), played.length ? formLines(played) : [melee ? t('No recent Melee singles sets.') : t('No recent singles sets.')]);
  // the short report keeps it to Ultimate, verbose shows every game
  section(lines, t('Deciding games'), decidingLines(played.filter(({ set }) => set.event.videogame?.id === ULTIMATE)));
  section(lines, t('Latest sets'), played.slice(0, LATEST_SETS).map((result) => latestSetLine(result)));
  const characterLines = [];
  for (const { game, usage } of characterUsageByGame(characterSets).slice(0, GAMES_SHOWN)) {
    if (!usage.reported) continue;
    characterLines.push(t`**${escapeMarkdown(game.displayName)}:** ${usage.characters.slice(0, 3).map((c) => `${escapeMarkdown(c.name)} (${count(c.games, 'game')})`).join(', ')}`);
  }
  section(lines, t('Reported characters'), characterLines.length ? characterLines : [melee ? t('No Melee characters reported in their recent sets.') : t('No characters reported in their recent sets.')]);
  const tricky = trickyOpponents(played, TRICKY_QUICK, [player.playerId]);
  section(lines, t('Toughest opponents'), tricky.length ? [tricky.map(trickyOpponentLine).join(' · ')] : []);
  section(lines, t('Worst matchups'), trickyMatchupLines(characterSets));
  const h2h = [...Map.groupBy(meetings, ({ set }) => gameName(set.event))].slice(0, GAMES_SHOWN)
    .map(([game, list]) => t`**${escapeMarkdown(game)}:** ${recordOf(list)}`);
  section(lines, t`You vs ${escapeMarkdown(opponent.tag)}`, h2h.length ? h2h
    : [melee ? t('You haven\'t played each other in Melee singles, as far back as this checks.') : t('You haven\'t played each other in singles, as far back as this checks.')]);
  lines.push(melee ? t('-# Melee only. From up to 600 singles sets each, and 400 for characters. Characters only show up if the TO reported them, and that can be out of date') : t('-# From up to 600 singles sets each, and 400 for characters. Characters only show up if the TO reported them, and that can be out of date'));
  const line = filterLine(filters);
  if (line) lines.push(line);
  const card = baseEmbed(colors.brand, melee ? `${FOOTER} · Melee` : undefined).setTitle(melee ? t`Melee scouting ${escapeMarkdown(opponent.tag)}` : t`Scouting ${escapeMarkdown(opponent.tag)}`).setURL(startggUrl(opponent.slug));
  if (opponent.image) card.setThumbnail(opponent.image);
  return withLines(card, lines);
}

// /scout verbose. their lifetime cards, then how they play, their characters and stages, and how you match up.
// odds is from predict and null when you've never played the same game, or Melee. players is everyone tracked.
// melee means every list holds only Melee, filtered before it got here, and filters only narrowed them
export function scoutReport(player, opponent, { mine, theirs, characterSets, events, odds, players, melee = false, filters = {} }) {
  const cards = lifetimeStats(opponent, events, theirs, players, { label: t('Scouting'), melee, filters });
  const played = singles(theirs, opponent);
  const meetings = meetingsOf(player, opponent, mine, theirs);
  if (!played.length) return [...cards, ...matchup(player, opponent, { meetings, odds, melee, filters })];

  // the game you'd play them in, or their most played if you don't share one
  const focus = odds?.game ?? [...Map.groupBy(played, ({ set }) => gameName(set.event))].sort(([, x], [, y]) => y.length - x.length)[0][0];
  return [...cards, ...tendencies(played, focus), ...scoutCharacters(characterSets, focus), ...matchup(player, opponent, { meetings, odds, melee, mine, played, focus, characterSets, filters })];
}

// /scout verbose, form in every game and how they play the one that matters
function tendencies(played, focus) {
  const lines = [];
  section(lines, t('Recent form'), formLines(played, true));
  section(lines, t('Deciding games'), decidingLines(played));
  section(lines, t`Habits in ${escapeMarkdown(focus)}`, habitLines(played.filter(({ set }) => gameName(set.event) === focus)));
  section(lines, t('Latest sets'), played.slice(0, SCOUT_LATEST_SETS).map((result) => latestSetLine(result, true)));
  return withLines(baseEmbed(colors.brand).setTitle(t('Form and tendencies')), lines);
}

// close sets, seeds, which side of the bracket and how often sets are one-sided
function habitLines(played) {
  const lines = [closeLine(played), seedLine(played)];
  const sides = [[t('winners side'), /winners/i], [t('losers side'), /losers/i], [t('grand finals'), GRAND_FINALS]]
    .map(([name, pattern]) => [name, played.filter(({ set }) => pattern.test(set.round ?? ''))])
    .filter(([, list]) => list.length);
  if (sides.length) lines.push(t`**Bracket:** ${sides.map(([name, list]) => `${name} ${recordOf(list)}`).join(' · ')}`);
  lines.push(sweepLine(played));
  return lines.filter(Boolean);
}

// /scout verbose, each game's characters with the matchups and stages they win and lose. focus game first
function scoutCharacters(characterSets, focus) {
  const embed = baseEmbed(colors.brand).setTitle(t('Characters and stages'));
  const games = characterUsageByGame(characterSets)
    .filter(({ usage }) => usage.reported)
    .sort((a, b) => (b.game.displayName === focus) - (a.game.displayName === focus) || b.usage.games - a.usage.games);
  if (!games.length) {
    return [embed.setDescription(t`No characters reported in their last ${count(characterSets.length, 'singles set')}. Lots of tournaments don't bother.`)];
  }

  const lines = [];
  for (const { game, usage } of games.slice(0, SCOUT_CHARACTER_GAMES)) {
    const more = usage.characters.length - CHARACTERS_SHOWN;
    section(lines, escapeMarkdown(game.displayName), [
      ...usage.characters.slice(0, CHARACTERS_SHOWN).map((character, i) => t`${characterRank(usage, character, i)} · last ${`<t:${character.last}:R>`}`),
      more > 0 && t`-# and ${more} more`,
      ...leanLines(usage.against, t('Struggles against'), t('Strong against')),
      ...mainTroubleLines(usage),
      ...leanLines(usage.stages, t('Worst stages'), t('Best stages')),
      t`-# Reported in ${usage.reported} of their last ${count(usage.scanned, `${game.displayName} set`)} · TO reporting can be out of date`,
    ].filter(Boolean));
  }
  return withLines(embed, lines);
}

// each of their most played characters against the one it loses to most, the character vs character to pick
function mainTroubleLines(usage, limit = TRICKY_MAINS) {
  const lines = [];
  for (const character of usage.characters.slice(0, limit)) {
    const { bad } = leans([...character.matchups.values()]);
    if (!bad.length) continue;
    const worst = bad[0];
    lines.push(t`**${escapeMarkdown(character.name)} struggles most vs:** ${escapeMarkdown(worst.name)} ${winLoss(worst.wins, worst.games - worst.wins)}`);
  }
  return lines;
}

// the ones they lose most then win most, with enough games to go on. losing first since that's what to pick
function leanLines(records, badLabel, goodLabel) {
  const { good, bad } = leans(records);
  const list = (each) => each.slice(0, LEANS_SHOWN).map(({ name, wins, games }) => `${escapeMarkdown(name)} ${winLoss(wins, games - wins)}`).join(' · ');
  return [bad.length && t`**${badLabel}:** ${list(bad)}`, good.length && t`**${goodLabel}:** ${list(good)}`].filter(Boolean);
}

// /scout verbose, the caller against them. mine and played show your record against their toughest
// opponents, and characterSets shows the characters they struggle with in the game that matters
function matchup(player, opponent, { meetings, odds, melee = false, mine = [], played = [], focus = null, characterSets = [], filters = {} }) {
  const tagA = bold(player.tag);
  const tagB = bold(opponent.tag);
  const lines = [];
  if (odds) {
    const chance = chancePercent(odds);
    lines.push(t`**Odds:** ${tagA} ${chance}% · ${100 - chance}% ${tagB} in ${escapeMarkdown(odds.game)}`);
  }
  if (meetings.length) {
    const byGame = [...Map.groupBy(meetings, ({ set }) => gameName(set.event))];
    lines.push(t`**Head-to-head:** ${byGame.map(([game, list]) => `${escapeMarkdown(game)} ${recordOf(list)}`).join(' · ')}`);
    lines.push(...meetings.slice(0, MEETINGS_SHOWN).map(meetingLine));
    if (meetings.length > MEETINGS_SHOWN) lines.push(t`-# and ${count(meetings.length - MEETINGS_SHOWN, 'older set')}`);
  } else {
    lines.push(melee ? t('**Head-to-head:** you haven\'t played each other in Melee singles, as far back as this checks') : t('**Head-to-head:** you haven\'t played each other in singles, as far back as this checks'));
  }
  if (played.length) {
    const inFocus = focus ? played.filter(({ set }) => gameName(set.event) === focus) : [];
    const tricky = trickyOpponents(inFocus.length ? inFocus : played, TRICKY_VERBOSE, [player.playerId]);
    section(lines, focus ? t`Toughest opponents in ${escapeMarkdown(focus)}` : t('Toughest opponents'),
      tricky.map((record) => `${trickyOpponentLine(record)}${mine.length ? callerRecord(mine, player, record) : ''}`));
    if (focus && characterSets.length) {
      const bad = trickyMatchupLines(characterSets.filter((set) => set.videogame?.displayName === focus), LEANS_SHOWN)
        .map((line) => line.replace(/^\*\*.+?:\*\* /, ''));
      if (bad.length) section(lines, t`Worst matchups in ${escapeMarkdown(focus)}`, bad);
    }
  }
  if (odds?.common.total) section(lines, t`Common opponents · ${odds.common.total} in ${escapeMarkdown(odds.game)}`, commonOpponentLines(odds, tagA, tagB));
  lines.push(melee
    ? t('-# Melee only. From up to 1200 of their singles sets, 800 for characters and stages, every event they placed in and up to 600 of yours. Odds work like /predict, and characters and stages only show up if the TO reported them, and that can be out of date')
    : odds
      ? t('-# From up to 1200 of their singles sets, 800 for characters and stages, every event they placed in and up to 600 of yours. Odds work like /predict, and characters and stages only show up if the TO reported them, and that can be out of date')
      : t('-# From up to 1200 of their singles sets, 800 for characters and stages, every event they placed in and up to 600 of yours. Characters and stages only show up if the TO reported them, and that can be out of date'));
  const line = filterLine(filters);
  if (line) lines.push(line);
  const card = baseEmbed(colors.clash)
    .setAuthor({ name: melee ? t`${player.tag} · Melee` : player.tag, iconURL: player.image, url: startggUrl(player.slug) })
    .setTitle(t`${escapeMarkdown(player.tag)} vs ${escapeMarkdown(opponent.tag)}`);
  if (opponent.image) card.setThumbnail(opponent.image);
  return withLines(card, lines);
}
