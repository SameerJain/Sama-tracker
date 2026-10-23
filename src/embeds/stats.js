import { escapeMarkdown } from 'discord.js';
import { singles, startggUrl } from '../startgg.js';
import { characterUsage } from '../characters.js';
import {
  colors, FOOTER, baseEmbed, split, withLines, percent, topText, step, upsetFactor, MAJOR_UPSET, count, winLoss, recordOf, gameName,
  gameCount, closeLine, seedLine, sweepLine, streaks, section, bold, shortRecord, playerLink, setLink, vodLink, filterLine, filtersOn,
  scoreText, sparkline, GAMES_SHOWN, LEANS_SHOWN, OPPONENTS_SHOWN, DAY, ordinal, medal, t, listOf,
} from './shared.js';

// events on the short and lifetime cards, and upsets on each
const RECENT_EVENTS = 4;
const LIFETIME_EVENTS = 5;
const UPSETS_SHOWN = 3;

// /progress verbose, opponents played in both periods
const REMATCHES_SHOWN = 5;

// nothing to show, which a filtered report says it only looked at some of
function nothingYet(melee, filters) {
  if (filtersOn(filters)) return melee ? t('No Melee sets or events on start.gg yet matching those filters.') : t('Nothing on start.gg yet matching those filters.');
  return melee ? t('No Melee sets or events on start.gg yet.') : t('Nothing on start.gg yet.');
}

export function stats(player, standings, sets, { melee = false, filters = {} } = {}) {
  const embed = baseEmbed(colors.brand)
    .setAuthor({ name: melee ? t('Melee stats') : t('Stats') })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (player.image) embed.setThumbnail(player.image);

  const played = singles(sets, player);
  if (!played.length && !standings.length) return embed.setDescription(nothingYet(melee, filters));

  const lines = [];
  if (played.length) {
    const recordText = [...Map.groupBy(played, ({ set }) => gameName(set.event))]
      .map(([game, results]) => `${game} ${recordOf(results)}`);
    lines.push(t`**Recent sets:** ${recordText.join(' · ')}`);
  }

  // relative to bracket size, so 4th of 84 beats 3rd of 20
  const best = standings
    .filter(({ event }) => event.numEntrants)
    .sort((x, y) => x.placement / x.event.numEntrants - y.placement / y.event.numEntrants)[0];
  if (best) lines.push(t`**Best finish:** ${placementLine(best)}`);

  // sets are newest first, so ties go to the latest one
  const upset = biggestUpsets(played).win;
  if (upset) lines.push(t`**Biggest upset:** ${upsetLine(upset)}`);

  section(lines, t('Latest events'), standings.slice(0, RECENT_EVENTS).map(placementLine));

  const from = [];
  if (played.length) from.push(count(played.length, 'singles set'));
  if (standings.length) from.push(count(standings.length, 'event'));
  lines.push(t`-# From their last ${listOf(from)} on start.gg`);
  const line = filterLine(filters);
  if (line) lines.push(line);

  return embed.setDescription(lines.join('\n'));
}

// a card per game, the last 30 days over the 30 before. periods are newest first, each { since, until, summary }.
// verbose goes further into both and lists every period as a trend. characterSets is null if it couldn't be fetched.
// melee means the sets, events and characters were filtered before they got here
export function progress(player, periods, { verbose = false, characterSets = null, melee = false } = {}) {
  const [current, previous] = periods;
  const days = Math.round((current.until - current.since) / DAY);
  const title = melee ? t`${escapeMarkdown(player.tag)}'s Melee progress` : t`${escapeMarkdown(player.tag)}'s progress`;
  const inGame = (period, game) => period.summary.games.find((entry) => entry.game === game);
  const games = [...new Set(periods.flatMap((period) => period.summary.games.map(({ game }) => game)))];
  if (!games.length) {
    const empty = baseEmbed(colors.brand).setTitle(title).setDescription(melee
      ? t`No Melee singles results in the last ${days * periods.length} days.`
      : t`No singles results in the last ${days * periods.length} days.`);
    if (player.image) empty.setThumbnail(player.image);
    return [empty];
  }
  const range = ({ since, until }) => t`${`<t:${since}:d>`} to ${`<t:${until}:d>`}`;

  return games.flatMap((game) => {
    const recent = inGame(current, game);
    const before = inGame(previous, game);
    const characters = ({ since, until }) => verbose && characterSets
      && characterLine(characterSets.filter((set) => set.videogame.displayName === game && set.completedAt >= since && set.completedAt < until));
    const lines = [
      t`### Last ${days} days`, `-# ${range(current)}`, ...periodLines(recent, verbose, characters(current)),
      t`### Previous ${days} days`, `-# ${range(previous)}`, ...periodLines(before, verbose, characters(previous)),
    ];
    const winRate = pointsLine(t('Win rate'), setRate(recent), setRate(before),
      [before, recent].map((data) => count(data?.played.length ?? 0, 'set')));
    section(lines, t('What changed'), [winRate, ...changeLines(recent, before, verbose)].filter(Boolean));
    if (verbose) {
      section(lines, t`Every ${days} days, newest first`, periods.map((period) => `${range(period)} · ${trendText(inGame(period, game))}`));
      // oldest first so the graph reads left to right, · where a period had no sets
      const trend = [...periods].reverse().map((period) => setRate(inGame(period, game)));
      if (trend.some((rate) => rate != null)) lines.push(t`**Trend, oldest → newest:** ${sparkline(trend)} win rate`);
      lines.push(t`-# Singles only, DQs left out. Events count toward the ${days} days they started in. Seeds go by placement tier, close sets are ones that went to the last game, and characters only show up if the TO reported them`);
    } else {
      lines.push(t`-# Singles only, DQs left out. Events count toward the ${days} days they started in. Seeds go by placement tier, and close sets went to the last game`);
    }
    const card = baseEmbed(colors.brand, `${FOOTER} · ${game}`).setTitle(title).setURL(startggUrl(player.slug));
    if (player.image) card.setThumbnail(player.image);
    return withLines(card, lines);
  });
}

// one game in one period of /progress. verbose adds best/worst streaks, sweeps, upsets and characters
function periodLines(data, verbose = false, characters = null) {
  if (!data) return [t('No sets or finished events.')];
  const lines = [t`**Sets:** ${winLoss(data.wins, data.losses)}`];
  const games = gameCount(data.played);
  if (games.won + games.lost) lines.push(t`**Games:** ${winLoss(games.won, games.lost)}`);
  const streak = streaks(data.played);
  if (streak.now > 1 || (verbose && (streak.best > 1 || streak.worst > 1))) {
    const [win, loss] = [t('W'), t('L')];
    const ending = t`**Period-ending streak:** ${streak.nowWon ? win : loss}${streak.now}`;
    lines.push(verbose ? t`${ending} · best ${win}${streak.best} · worst ${loss}${streak.worst}` : ending);
  }
  lines.push(closeLine(data.played), verbose && sweepLine(data.played), seedLine(data.played));

  const sized = data.events.filter(({ event }) => event.numEntrants > 0);
  if (sized.length) {
    const average = t`**Placements:** ${count(data.events.length, 'event')} · average ${topText(averageFinish(sized))}`;
    lines.push(sized.length < data.events.length ? t`${average} (${sized.length} with bracket size)` : average);
    lines.push(t`**Best:** ${placementLine(sized.toSorted(byFinish)[0])}`);
  } else if (data.events.length) {
    lines.push(t`**Placements:** ${count(data.events.length, 'event')}, no bracket sizes reported`);
  } else {
    lines.push(t('**Placements:** no finished events'));
  }

  const seeded = data.events.filter(({ seed }) => seed > 0);
  if (seeded.length) {
    const better = seeded.filter(({ placement, seed }) => step(placement) < step(seed)).length;
    const worse = seeded.filter(({ placement, seed }) => step(placement) > step(seed)).length;
    lines.push(t`**Vs seed:** ${better} better · ${seeded.length - better - worse} on seed · ${worse} worse`);
  } else {
    lines.push(t('**Vs seed:** no seeded finishes reported'));
  }

  if (verbose) {
    const { win, loss } = biggestUpsets(data.played);
    if (win) lines.push(t`**Best win:** ${upsetLine(win)}`);
    if (loss) lines.push(t`**Worst loss:** ${upsetLine(loss)}`);
    lines.push(characters);
  }
  return lines.filter(Boolean);
}

// share of sets or games won, null with nothing played
const setRate = (data) => (data?.wins + data?.losses ? data.wins / (data.wins + data.losses) : null);

function gameRate(data) {
  const { won, lost } = gameCount(data?.played ?? []);
  return won + lost ? won / (won + lost) : null;
}

// Win rate: up 4.0 points. null unless both rates exist
function pointsLine(label, now, before, samples) {
  if (now === null || before === null) return null;
  const points = 100 * (now - before);
  const size = Math.abs(points).toFixed(1);
  return points >= 0 ? t`**${label}:** up ${size} points (${samples.join(' → ')})` : t`**${label}:** down ${size} points (${samples.join(' → ')})`;
}

// /progress, the last period against the one before. verbose also compares rematches
function changeLines(recent, before, verbose) {
  const games = [before, recent].map((data) => gameCount(data?.played ?? []));
  const lines = [pointsLine(t('Games won'), gameRate(recent), gameRate(before), games.map(({ won, lost }) => count(won + lost, 'game')))];
  const events = [before, recent].map((data) => (data?.events ?? []).filter(({ event }) => event.numEntrants > 0));
  const [then, now] = events.map(averageFinish);
  if (now !== null && then !== null) lines.push(t`**Average finish:** ${topText(then)} → ${topText(now)} (${events.map((list) => count(list.length, 'event')).join(' → ')})`);
  if (verbose) lines.push(rematchLine(recent?.played ?? [], before?.played ?? []));
  return lines;
}

// opponents from both periods and how each went, the most sets first
function rematchLine(recent, before) {
  const byOpponent = (played) => Map.groupBy(played, ({ them }) => them.playerIds[0] ?? them.name);
  const now = byOpponent(recent);
  const then = byOpponent(before);
  const sets = ([id, list]) => list.length + then.get(id).length;
  const both = [...now].filter(([id]) => then.has(id))
    .sort((x, y) => sets(y) - sets(x))
    .slice(0, REMATCHES_SHOWN)
    .map(([id, list]) => `${bold(list[0].them.name)} ${shortRecord(then.get(id))} → ${shortRecord(list)}`);
  return both.length ? t`**Rematches, before → now:** ${both.join(' · ')}` : null;
}

// one period of the verbose /progress trend
function trendText(data) {
  if (!data) return t('no sets or events');
  const parts = [];
  if (data.played.length) parts.push(t`sets ${winLoss(data.wins, data.losses)}`);
  const average = averageFinish(data.events);
  if (data.events.length) parts.push(average === null ? count(data.events.length, 'event') : t`${count(data.events.length, 'event')}, average ${topText(average)}`);
  return parts.join(' · ');
}

// verbose /progress, game record on each character they reported
function characterLine(sets) {
  const usage = characterUsage(sets);
  if (!usage.reported) return null;
  const shown = usage.characters.slice(0, LEANS_SHOWN).map(({ name, wins, games }) => `${escapeMarkdown(name)} ${winLoss(wins, games - wins)}`);
  return t`**Game record by character:** ${shown.join(' · ')}`;
}

// upcoming is [{ tournament, players }] for the active players' entries before the next recap.
// only notable wins show, the same major upsets as set result cards, tracked vs tracked included
export function weeklyRecap(crew, upcoming, { since, until }) {
  const lines = [t`${`<t:${since}:d>`} to ${`<t:${until}:d>`} · ${count(crew.length, 'active player')}`];
  const wins = crew.flatMap(({ player, summary }) => summary.played.filter((result) => result.won).map((result) => ({ ...result, player })));
  const upset = wins.filter(({ me, them }) => upsetFactor(me, them) >= MAJOR_UPSET)
    .sort((a, b) => upsetFactor(b.me, b.them) - upsetFactor(a.me, a.them))[0];
  if (upset) lines.push('', t`**Notable upset:** ${playerLink(upset.player)} ${upsetLine(upset)}`);
  const finishes = crew.flatMap(({ player, summary }) => summary.finishes.map((entry) => ({ ...entry, player })))
    .filter(({ event }) => event.numEntrants).sort(byFinish);
  if (finishes.length) lines.push(t`**Best finish:** ${playerLink(finishes[0].player)} · ${placementLine(finishes[0])}`);
  for (const { player, summary } of crew) {
    lines.push('', `**${escapeMarkdown(player.tag)}**`);
    for (const game of summary.games) lines.push(`${escapeMarkdown(game.game)}: ${winLoss(game.wins, game.losses)}`);
    lines.push(...summary.finishes.map(placementLine));
    if (!summary.finishes.length) lines.push(t('No final placements reported for this week\'s events yet.'));
  }
  const next = upcoming.map(({ tournament, players }) => `[${escapeMarkdown(tournament.name)}](${startggUrl(tournament.slug)}) · `
    + `<t:${tournament.startAt}:f> · ${players.map((player) => escapeMarkdown(player.tag)).join(', ')}`);
  section(lines, t('Upcoming this week'), next.length ? next : [t('Nobody who played this week is signed up for anything yet.')]);
  lines.push(t('-# Singles only, and only people who played a set that wasn\'t a DQ'));
  return withLines(baseEmbed(colors.results).setTitle(t('Weekly crew recap')), lines);
}

// beat Foo (seed 2) 3-1 as seed 9 at Tournament, with the VOD when the TO added one
function upsetLine({ set, me, them, won }) {
  const score = scoreText(me, them) === 'vs' ? '' : ` ${scoreText(me, them)}`;
  const where = `${setLink(set)}${vodLink(set)}`;
  return won
    ? t`beat ${bold(them.name)} (seed ${them.seed})${score} as seed ${me.seed} at ${where}`
    : t`lost to ${bold(them.name)} (seed ${them.seed})${score} as seed ${me.seed} at ${where}`;
}

// how big an upset the set was, whichever way it went
function upsetSize(result) {
  return result.won ? upsetFactor(result.me, result.them) : upsetFactor(result.them, result.me);
}

// their biggest upset win and the biggest upset they lost to. ties go to the newest
function biggestUpsets(played) {
  const upsets = played.filter((result) => upsetSize(result) > 0).sort((x, y) => upsetSize(y) - upsetSize(x));
  return { win: upsets.find(({ won }) => won), loss: upsets.find(({ won }) => !won) };
}

// relative to bracket size, so 4th of 84 beats 3rd of 20
const finish = (entry) => entry.placement / entry.event.numEntrants;

const byFinish = (x, y) => finish(x) - finish(y) || y.event.numEntrants - x.event.numEntrants;

// mean of finish, null with no bracket sizes to go on
function averageFinish(events) {
  const sized = events.filter(({ event }) => event.numEntrants > 0);
  return sized.length ? sized.reduce((total, entry) => total + finish(entry), 0) / sized.length : null;
}


// events entered and set record, grouped by game or year
function breakdown(entered, played, eventKey, setKey) {
  const groups = new Map();
  const group = (key) => {
    if (!groups.has(key)) groups.set(key, { key, events: [], wins: 0, losses: 0 });
    return groups.get(key);
  };
  for (const entry of entered) group(eventKey(entry.event)).events.push(entry);
  for (const { set, won } of played) group(setKey(set))[won ? 'wins' : 'losses']++;
  return [...groups.values()];
}

// Ultimate · 180 events · won 3 · sets 420-300 (58%)
function breakdownLine({ key, events, wins, losses }) {
  const parts = [`**${escapeMarkdown(String(key))}**`];
  if (events.length) parts.push(count(events.length, 'event'));
  const firsts = events.filter((entry) => entry.placement === 1).length;
  const best = events.filter((entry) => entry.event.numEntrants).sort(byFinish)[0];
  if (firsts) parts.push(t`won ${firsts}`);
  else if (best) parts.push(t`best ${ordinal(best.placement)} of ${best.event.numEntrants}`);
  if (wins + losses) parts.push(t`sets ${winLoss(wins, losses)}`);
  return parts.join(' · ');
}

// Melee lifetime stats, or in spanish whatever order the label goes in, capitalized
const upperFirst = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

// two cards: the lifetime numbers, then the results behind them. /scout verbose labels them its own way.
// filters only narrow what got counted, so the lifetime wording stays
export function lifetimeStats(player, events, sets, players, { label = t('Lifetime stats'), melee = false, filters = {} } = {}) {
  const overview = baseEmbed(colors.brand)
    .setAuthor({ name: melee ? upperFirst(t`Melee ${`${label[0].toLowerCase()}${label.slice(1)}`}`) : label })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (player.image) overview.setThumbnail(player.image);

  const entered = events.filter((entry) => !entry.dq);
  const played = singles(sets, player);
  if (!entered.length && !played.length) return [overview.setDescription(nothingYet(melee, filters))];

  const from = [];
  if (played.length) from.push(t`${count(played.length, 'singles set')} since ${`<t:${played.at(-1).set.completedAt}:D>`}`);
  if (entered.length) from.push(t`${count(entered.length, 'event')} since ${`<t:${entered.at(-1).event.startAt}:D>`}`);
  const dqs = events.length - entered.length;
  const latest = Math.max(played[0]?.set.completedAt ?? 0, entered[0]?.event.startAt ?? 0);
  const line = filterLine(filters);
  const source = dqs ? t`-# From ${listOf(from)} on start.gg, ${count(dqs, 'DQ')} left out` : t`-# From ${listOf(from)} on start.gg`;
  overview.setDescription([t`Last played ${`<t:${latest}:R>`}`, source, line].filter(Boolean).join('\n'));

  const sized = entered.filter((entry) => entry.event.numEntrants);
  const seeded = entered.filter((entry) => entry.seed);
  const stat = (name, value) => overview.addFields({ name, value: String(value), inline: true });

  if (entered.length) stat(t('Events'), entered.length);
  if (played.length) stat(t('Sets'), recordOf(played));
  const games = gameCount(played);
  if (games.won + games.lost) stat(t('Games'), winLoss(games.won, games.lost));

  if (entered.length) {
    stat(t('1st places'), entered.filter((entry) => entry.placement === 1).length);
    stat(t('Top 3s'), entered.filter((entry) => entry.placement <= 3).length);
    // top 8 of an 8 person bracket doesn't count
    stat(t('Top 8s'), sized.filter((entry) => entry.event.numEntrants > 8 && entry.placement <= 8).length);
  }
  if (sized.length) {
    const finishes = sized.map(finish).sort((a, b) => a - b);
    stat(t('Typical finish'), topText(finishes[Math.floor(finishes.length / 2)]));
  }
  if (seeded.length) {
    const better = seeded.filter((entry) => step(entry.placement) < step(entry.seed)).length;
    const worse = seeded.filter((entry) => step(entry.placement) > step(entry.seed)).length;
    stat(t('Finish vs seed'), t`better ${percent(better, seeded.length)} · worse ${percent(worse, seeded.length)}`);
  }
  if (played.length) {
    const streak = streaks(played);
    stat(t('Win streak'), t`best ${t('W')}${streak.best}, now ${streak.nowWon ? t('W') : t('L')}${streak.now}`);
  }

  const byGame = breakdown(entered, played, gameName, (set) => gameName(set.event))
    .sort((a, b) => b.events.length - a.events.length || b.wins + b.losses - (a.wins + a.losses));
  if (byGame.length > 1) overview.addFields({ name: t('By game'), value: byGame.slice(0, GAMES_SHOWN).map(breakdownLine).join('\n') });

  const yearOf = (seconds) => new Date(seconds * 1000).getUTCFullYear();
  const byYear = breakdown(entered, played, (event) => yearOf(event.startAt), (set) => yearOf(set.completedAt))
    .sort((a, b) => b.key - a.key);
  if (byYear.length > 1) overview.addFields({ name: t('By year'), value: byYear.map(breakdownLine).join('\n') });

  const lines = [];
  const upsets = played.filter((result) => upsetSize(result) > 0).sort((x, y) => upsetSize(y) - upsetSize(x));
  // one per event, a bracket reset in grands is the same upset twice
  const top = (list) => list
    .filter((result, i) => list.findIndex((other) => other.set.event.slug === result.set.event.slug) === i)
    .slice(0, UPSETS_SHOWN)
    .map((result) => `${upsetLine(result)} · <t:${result.set.completedAt}:d>`);
  section(lines, t('Best finishes'), sized.toSorted(byFinish).slice(0, LIFETIME_EVENTS).map(placementLine));
  section(lines, t('Latest events'), entered.slice(0, LIFETIME_EVENTS).map(placementLine));
  section(lines, t('Biggest wins'), top(upsets.filter((result) => result.won)));
  section(lines, t('Toughest losses'), top(upsets.filter((result) => !result.won)));

  const results = baseEmbed(colors.brand);
  // way past what fits only with a lot of long tournament names
  if (lines.length) results.setDescription(split(lines)[0].join('\n'));

  const tracked = new Map(Object.values(players).map((each) => [each.playerId, each]));
  const opponents = new Map();
  for (const { them, won } of played) {
    // no start.gg account means no id, so those go by name
    const id = them.playerIds[0] ?? them.name;
    if (!opponents.has(id)) opponents.set(id, { name: tracked.get(id)?.tag ?? them.name, crew: tracked.has(id), wins: 0, losses: 0 });
    opponents.get(id)[won ? 'wins' : 'losses']++;
  }
  // sort is stable and sets are newest first, so ties go to who they played last
  const mostPlayed = [...opponents.values()].sort((a, b) => b.wins + b.losses - (a.wins + a.losses));
  const crew = mostPlayed.filter((each) => each.crew);
  const opponentLines = (list) => list.slice(0, OPPONENTS_SHOWN).map(({ name, wins, losses }) => `${bold(name)} ${wins}-${losses}`).join('\n');
  if (mostPlayed.length) results.addFields({ name: t('Most played'), value: opponentLines(mostPlayed), inline: true });
  if (crew.length) results.addFields({ name: t('Vs the crew'), value: opponentLines(crew), inline: true });

  return [overview, results];
}

// 3rd of 20 (seed 2) · Ultimate Singles · Tournament · date
function placementLine({ placement, seed, dq, event }) {
  let text = `${medal(placement)}**${ordinal(placement)}**`;
  if (event.numEntrants) text += t` of ${event.numEntrants}`;
  const notes = [seed && t`seed ${seed}`, dq && 'DQ'].filter(Boolean);
  if (notes.length) text += ` (${notes.join(', ')})`;
  const link = `[${escapeMarkdown(event.tournament.name)}](${startggUrl(event.slug)})`;
  return `${text} · ${escapeMarkdown(event.name)} · ${link} · <t:${event.startAt}:d>`;
}

// the doubles cards build on these
export { placementLine, upsetLine, upsetSize, biggestUpsets, finish, byFinish, breakdown, breakdownLine };
