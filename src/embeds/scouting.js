import { escapeMarkdown } from 'discord.js';
import { startggUrl } from '../startgg.js';
import { characterUsage, leans } from '../characters.js';
import { lifetimeStats } from './stats.js';
import { chancePercent, commonOpponentLines } from './players.js';
import { colors, baseEmbed, withLines, count, singles, gameName, recordOf, section, bold, scoreText, setLink, closeLine, seedLine, GRAND_FINALS, CHARACTERS_SHOWN, GAMES_SHOWN, LEANS_SHOWN, DAY, winLoss, characterRank, meetingLine } from './shared.js';

// /scout's form line per game, and how many sets it lists
const RECENT_SETS = 20;

const LATEST_SETS = 5;

// /scout verbose
const SCOUT_LATEST_SETS = 8;

const SCOUT_CHARACTER_GAMES = 3;

const MEETINGS_SHOWN = 10;

// their record over their last 20 sets in each game, the game they played last first.
// verbose adds the last 90 days, which says more for someone who doesn't play much
function formLines(played, verbose = false) {
  const since = Math.floor(Date.now() / 1000) - 90 * DAY;
  return [...Map.groupBy(played, ({ set }) => gameName(set.event))].slice(0, GAMES_SHOWN).map(([game, list]) => {
    const recent = list.slice(0, RECENT_SETS);
    const line = `**${escapeMarkdown(game)}:** ${recordOf(recent)} · last ${count(recent.length, 'set')}`;
    if (!verbose) return line;
    const lately = list.filter(({ set }) => set.completedAt >= since);
    return `${line} · ${lately.length ? recordOf(lately) : 'none'} in the last 90 days`;
  });
}

// W 2-1 vs Foo · Tournament · date, with the round for verbose
function latestSetLine({ set, me, them, won }, round = false) {
  return `**${won ? 'W' : 'L'}** ${scoreText(me, them)} vs ${bold(them.name)}${round && set.round ? ` · ${set.round}` : ''} · ${setLink(set)} · <t:${set.completedAt}:d>`;
}

// sets between the two from player's side, newest first. both histories since either can get cut off
function meetingsOf(player, opponent, mine, theirs) {
  const sets = [...new Map([...mine, ...theirs].map((set) => [set.id, set])).values()];
  return singles(sets, player)
    .filter(({ them }) => them.playerIds.includes(opponent.playerId))
    .sort((x, y) => y.set.completedAt - x.set.completedAt);
}

export function scout(player, opponent, mine, theirs, characterSets) {
  const played = singles(theirs, opponent);
  const meetings = meetingsOf(player, opponent, mine, theirs);
  const lines = [];
  section(lines, 'Recent form', played.length ? formLines(played) : ['No recent singles sets.']);
  section(lines, 'Latest sets', played.slice(0, LATEST_SETS).map((result) => latestSetLine(result)));
  const characterGames = [...new Map(characterSets.map((set) => [set.videogame.id, set.videogame])).values()];
  const characterLines = [];
  for (const game of characterGames.slice(0, GAMES_SHOWN)) {
    const usage = characterUsage(characterSets.filter((set) => set.videogame.id === game.id));
    if (!usage.reported) continue;
    characterLines.push(`**${escapeMarkdown(game.displayName)}:** ${usage.characters.slice(0, 3).map((c) => `${escapeMarkdown(c.name)} (${count(c.games, 'game')})`).join(', ')}`);
  }
  section(lines, 'Reported characters', characterLines.length ? characterLines : ['No characters reported in their recent sets.']);
  const h2h = [...Map.groupBy(meetings, ({ set }) => gameName(set.event))].slice(0, GAMES_SHOWN)
    .map(([game, list]) => `**${escapeMarkdown(game)}:** ${recordOf(list)}`);
  section(lines, `You vs ${escapeMarkdown(opponent.tag)}`, h2h.length ? h2h : ['You haven\'t played each other in singles, as far back as this checks.']);
  lines.push('-# From up to 600 singles sets each, and 400 for characters. Characters only show up if the TO reported them. `verbose:True` for the full report');
  return withLines(baseEmbed(colors.brand).setTitle(`Scouting ${opponent.tag}`).setURL(startggUrl(opponent.slug)), lines);
}

// /scout verbose. their lifetime cards, then how they play, their characters and stages, and how you match up.
// odds is from predict and null when you've never played the same game. players is everyone tracked
export function scoutReport(player, opponent, { mine, theirs, characterSets, events, odds, players }) {
  const cards = lifetimeStats(opponent, events, theirs, players, 'Scouting');
  const played = singles(theirs, opponent);
  const meetings = meetingsOf(player, opponent, mine, theirs);
  if (!played.length) return [...cards, ...matchup(player, opponent, meetings, odds)];

  // the game you'd play them in, or their most played if you don't share one
  const focus = odds?.game ?? [...Map.groupBy(played, ({ set }) => gameName(set.event))].sort(([, x], [, y]) => y.length - x.length)[0][0];
  return [...cards, ...tendencies(played, focus), ...scoutCharacters(characterSets, focus), ...matchup(player, opponent, meetings, odds)];
}

// /scout verbose, form in every game and how they play the one that matters
function tendencies(played, focus) {
  const lines = [];
  section(lines, 'Recent form', formLines(played, true));
  section(lines, `Habits in ${escapeMarkdown(focus)}`, habitLines(played.filter(({ set }) => gameName(set.event) === focus)));
  section(lines, 'Latest sets', played.slice(0, SCOUT_LATEST_SETS).map((result) => latestSetLine(result, true)));
  return withLines(baseEmbed(colors.brand).setTitle('Form and tendencies'), lines);
}

// close sets, seeds, which side of the bracket and how often sets are one-sided
function habitLines(played) {
  const lines = [closeLine(played), seedLine(played)];
  const sides = [['winners side', /winners/i], ['losers side', /losers/i], ['grand finals', GRAND_FINALS]]
    .map(([name, pattern]) => [name, played.filter(({ set }) => pattern.test(set.round ?? ''))])
    .filter(([, list]) => list.length);
  if (sides.length) lines.push(`**Bracket:** ${sides.map(([name, list]) => `${name} ${recordOf(list)}`).join(' · ')}`);

  const scored = played.filter(({ me, them }) => me.score !== null && them.score !== null);
  const wins = scored.filter(({ won }) => won);
  const losses = scored.filter(({ won }) => !won);
  const sweeps = [];
  if (wins.length) sweeps.push(`won ${wins.filter(({ them }) => them.score === 0).length} of ${wins.length} without dropping a game`);
  if (losses.length) sweeps.push(`lost ${losses.filter(({ me }) => me.score === 0).length} of ${losses.length} without taking one`);
  if (sweeps.length) lines.push(`**Sweeps:** ${sweeps.join(' · ')}`);
  return lines.filter(Boolean);
}

// /scout verbose, each game's characters with the matchups and stages they win and lose. focus game first
function scoutCharacters(characterSets, focus) {
  const embed = baseEmbed(colors.brand).setTitle('Characters and stages');
  const games = [...new Map(characterSets.map((set) => [set.videogame.id, set.videogame])).values()]
    .map((game) => ({ game, usage: characterUsage(characterSets.filter((set) => set.videogame.id === game.id)) }))
    .filter(({ usage }) => usage.reported)
    .sort((a, b) => (b.game.displayName === focus) - (a.game.displayName === focus) || b.usage.games - a.usage.games);
  if (!games.length) {
    return [embed.setDescription(`No characters reported in their last ${count(characterSets.length, 'singles set')}. Lots of tournaments don't bother.`)];
  }

  const lines = [];
  for (const { game, usage } of games.slice(0, SCOUT_CHARACTER_GAMES)) {
    const more = usage.characters.length - CHARACTERS_SHOWN;
    section(lines, escapeMarkdown(game.displayName), [
      ...usage.characters.slice(0, CHARACTERS_SHOWN).map((character, i) => `${characterRank(usage, character, i)} · last <t:${character.last}:R>`),
      more > 0 && `-# and ${more} more`,
      ...leanLines(usage.against, 'Struggles against', 'Strong against'),
      ...leanLines(usage.stages, 'Worst stages', 'Best stages'),
      `-# Reported in ${usage.reported} of their last ${count(usage.scanned, `${game.displayName} set`)}`,
    ].filter(Boolean));
  }
  return withLines(embed, lines);
}

// the ones they lose most then win most, with enough games to go on. losing first since that's what to pick
function leanLines(records, badLabel, goodLabel) {
  const { good, bad } = leans(records);
  const list = (each) => each.slice(0, LEANS_SHOWN).map(({ name, wins, games }) => `${escapeMarkdown(name)} ${winLoss(wins, games - wins)}`).join(' · ');
  return [bad.length && `**${badLabel}:** ${list(bad)}`, good.length && `**${goodLabel}:** ${list(good)}`].filter(Boolean);
}

// /scout verbose, the caller against them
function matchup(player, opponent, meetings, odds) {
  const tagA = bold(player.tag);
  const tagB = bold(opponent.tag);
  const lines = [];
  if (odds) {
    const chance = chancePercent(odds);
    lines.push(`**Odds:** ${tagA} ${chance}% · ${100 - chance}% ${tagB} in ${escapeMarkdown(odds.game)}`);
  }
  if (meetings.length) {
    const byGame = [...Map.groupBy(meetings, ({ set }) => gameName(set.event))];
    lines.push(`**Head-to-head:** ${byGame.map(([game, list]) => `${escapeMarkdown(game)} ${recordOf(list)}`).join(' · ')}`);
    lines.push(...meetings.slice(0, MEETINGS_SHOWN).map(meetingLine));
    if (meetings.length > MEETINGS_SHOWN) lines.push(`-# and ${count(meetings.length - MEETINGS_SHOWN, 'older set')}`);
  } else {
    lines.push('**Head-to-head:** you haven\'t played each other in singles, as far back as this checks');
  }
  if (odds?.common.total) section(lines, `Common opponents · ${odds.common.total} in ${escapeMarkdown(odds.game)}`, commonOpponentLines(odds, tagA, tagB));
  lines.push('-# From up to 1200 of their singles sets, 800 for characters and stages, every event they placed in and up to 600 of yours. '
    + `${odds ? 'Odds work like /predict, and characters' : 'Characters'} and stages only show up if the TO reported them`);
  return withLines(baseEmbed(colors.clash).setTitle(`${escapeMarkdown(player.tag)} vs ${escapeMarkdown(opponent.tag)}`), lines);
}
