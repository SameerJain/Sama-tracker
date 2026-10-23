import { escapeMarkdown } from 'discord.js';
import { fromSide, startggUrl } from '../startgg.js';
import { FORM_SETS, chanceOf } from '../predict.js';
import {
  colors, FOOTER, baseEmbed, withLines, percent, topText, count, gameName, gameCount, recordOf, winsOf, GRAND_FINALS, bold, setLink, vodLink,
  filterLine, filtersOn, section, OPPONENTS_SHOWN, CHARACTERS_SHOWN, characterRank, meetingLine, playerLink, t,
} from './shared.js';

// sets is newest first. verbose lists every set and adds splits, streaks and when they first played.
// melee means sets is only their melee ones, and otherGames is how many got left out. odds is a
// predict result, shown as one line in both report lengths. verbose never expands it, use /predict for why.
// filters only narrowed the sets, so the card names them on its small line
export function headToHead(a, b, sets, { verbose = false, melee = false, otherGames = 0, odds = null, filters = {} } = {}) {
  const results = sets.map((set) => fromSide(set, a.playerId));
  const wins = winsOf(results);
  const losses = results.length - wins;

  const playedGames = [...new Set(sets.map(({ event }) => gameName(event)))];
  const game = melee ? 'Melee' : playedGames.length === 1 ? playedGames[0] : null;
  const embed = baseEmbed(colors.clash, game ? `${FOOTER} · ${game}` : undefined)
    .setAuthor({ name: melee ? `${a.tag} · Melee` : a.tag, iconURL: a.image, url: startggUrl(a.slug) });
  if (b.image) embed.setThumbnail(b.image);
  const leftOut = otherGames ? t`${count(otherGames, 'set')} in other games left out` : null;

  const chance = odds && chancePercent(odds);
  const oddsLine = odds ? t`**Predicted:** ${bold(a.tag)} ${chance}% · ${100 - chance}% ${bold(b.tag)} in ${escapeMarkdown(odds.game)}` : null;
  const filtered = filtersOn(filters);
  const line = filterLine(filters);

  if (!results.length) {
    let never = melee ? t('They haven\'t played each other in Melee singles on start.gg yet.') : t('They haven\'t played each other in singles on start.gg yet.');
    if (filtered) {
      never = melee
        ? t('They haven\'t played each other in Melee singles on start.gg yet matching those filters.')
        : t('They haven\'t played each other in singles on start.gg yet matching those filters.');
    }
    const none = [never];
    if (oddsLine) none.push(oddsLine);
    if (leftOut) none.push(t`-# ${leftOut}, leave out \`melee\` to count them`);
    if (line) none.push(line);
    return [embed.setTitle(`${escapeMarkdown(a.tag)} vs ${escapeMarkdown(b.tag)}`).setDescription(none.join('\n'))];
  }

  embed.setTitle(`${escapeMarkdown(a.tag)} ${wins}-${losses} ${escapeMarkdown(b.tag)}`);

  const games = gameCount(results);
  const lines = [];
  if (games.won + games.lost) {
    lines.push(t`-# Games ${games.won}-${games.lost} (${percent(games.won, games.won + games.lost)} won)`);
  }
  if (wins !== losses) {
    const leader = wins > losses ? a : b;
    lines.push(t`**${escapeMarkdown(leader.tag)} leads ${Math.max(wins, losses)}-${Math.min(wins, losses)}**`);
  }
  if (oddsLine) lines.push(oddsLine);
  if (verbose) lines.push(...rivalry(a, b, results));
  if (lines.length) lines.push('');

  const shown = verbose ? results : results.slice(0, 10);
  lines.push(...shown.map(meetingLine));
  if (shown.length < results.length) lines.push(t`-# ${count(results.length - shown.length, 'older set')} not shown, Full report lists them all`);
  if (leftOut) lines.push(t`-# Melee only, ${leftOut}`);
  if (line) lines.push(line);
  return withLines(embed, lines);
}

// /h2h verbose, from a's side like the title
function rivalry(a, b, results) {
  // b goes in bold labels, which can't hold more bold
  const tagA = bold(a.tag);
  const tagB = escapeMarkdown(b.tag);
  const lines = [];

  const byGame = Map.groupBy(results, ({ set }) => gameName(set.event));
  if (byGame.size > 1) lines.push(t`**By game:** ${[...byGame].map(([game, list]) => `${escapeMarkdown(game)} ${recordOf(list)}`).join(' · ')}`);

  // who the bracket expected to win
  const seeded = results.filter(({ me, them }) => me.seed && them.seed && me.seed !== them.seed);
  const above = seeded.filter(({ me, them }) => me.seed < them.seed);
  if (above.length) lines.push(t`**Seeded above ${tagB}:** ${tagA} ${recordOf(above)}`);
  const below = seeded.filter(({ me, them }) => me.seed > them.seed);
  if (below.length) lines.push(t`**Seeded below ${tagB}:** ${tagA} ${recordOf(below)}`);

  const grands = results.filter(({ set }) => GRAND_FINALS.test(set.round ?? ''));
  if (grands.length) lines.push(t`**Grand finals:** ${tagA} ${recordOf(grands)}`);

  const streak = results.findIndex((result) => result.won !== results[0].won);
  const run = streak === -1 ? results.length : streak;
  if (run > 1) lines.push(t`**Streak:** ${bold((results[0].won ? a : b).tag)} has won the last ${run}`);

  const first = results.at(-1);
  lines.push(t`**First played:** ${`<t:${first.set.completedAt}:D>`} at ${setLink(first.set)}${vodLink(first.set)}`);
  return lines;
}

const factorName = (key) => ({ h2h: t('Head-to-head'), common: t('Common opponents'), seeding: t('Seeding and form'), slippi: t('Slippi ranked') })[key];

// 28-12 in seeded sets, seeding expected 24-16. just the record if none of their sets were seeded
function formText(tag, { wins, total, seededWins, seeded, expected }) {
  if (!seeded) return `${tag} ${wins}-${total - wins}`;
  const said = Math.round(expected);
  return t`${tag} ${seededWins}-${seeded - seededWins} in seeded sets, seeding expected ${said}-${seeded - said}`;
}

// a's odds as a whole percent. never 0 or 100, nothing's certain
export function chancePercent(odds) {
  return Math.min(99, Math.max(1, Math.round(odds.chance * 100)));
}

// common opponents both played, the ones with the most sets between them first
export function commonOpponentLines(odds, tagA, tagB) {
  const played = ({ a: x, b: y }) => x.total + y.total;
  return odds.common.opponents.toSorted((x, y) => played(y) - played(x)).slice(0, OPPONENTS_SHOWN)
    .map(({ name, a: x, b: y }) => `${bold(name)}: ${tagA} ${x.wins}-${x.total - x.wins} · ${tagB} ${y.wins}-${y.total - y.wins}`);
}

// the short card, which the longer ones start from. slippi only shows on a melee:True report
function summaryLines(odds, tagA, tagB, withSlippi) {
  const { h2h, common, seeding, level, form, slippi } = odds;
  const lines = [];

  const losses = h2h.total - h2h.wins;
  if (!h2h.total) lines.push(t('**Head-to-head:** never played, so it comes down to the rest'));
  else if (h2h.wins === losses) lines.push(t`**Head-to-head:** even at ${h2h.wins}-${losses}`);
  else if (h2h.wins > losses) lines.push(t`**Head-to-head:** ${tagA} leads ${h2h.wins}-${losses}`);
  else lines.push(t`**Head-to-head:** ${tagB} leads ${losses}-${h2h.wins}`);

  if (common.total) {
    // equal records against someone count for neither, so the rest get named
    const even = common.total - common.better - common.worse;
    const rest = even ? t`, even against the other ${even}` : '';
    lines.push(t`**Common opponents:** ${common.total} shared. ${tagA} did better against ${common.better}, ${tagB} against ${common.worse}${rest}`);
  }
  if (seeding.total) {
    const [leader, trailing, times, higher] = seeding.ratio >= 1 ? [tagA, tagB, seeding.ratio, seeding.higher] : [tagB, tagA, 1 / seeding.ratio, seeding.lower];
    // the ratio is the trailing player's average seed number over the leader's
    const by = times < 1.15 ? t('their average seed numbers were about the same') : t`${trailing}'s average seed number was ${times.toFixed(1)}x ${leader}'s`;
    lines.push(t`**Seeding:** ${leader} got the better seed in ${higher} of ${seeding.total} shared brackets, ${by}`);
  } else if (level.a && level.b) {
    lines.push(t`**Usual seed:** ${tagA} ${topText(level.a.share)} of their brackets · ${tagB} ${topText(level.b.share)}`);
  }
  if (withSlippi && slippi) {
    const rank = (name, rating) => `${escapeMarkdown(name)} ${rating.toFixed(1)}`;
    lines.push(t`**Slippi ranked:** ${tagA} ${rank(slippi.aRank, slippi.aRating)} · ${tagB} ${rank(slippi.bRank, slippi.bRating)}`);
  }
  lines.push(t`**Form, last ${FORM_SETS} sets:** ${formText(tagA, form.a)} · ${formText(tagB, form.b)}`);
  return lines;
}

// what's behind the odds, on both longer cards
function detailLines(lines, odds, tagA, tagB, withSlippi) {
  section(lines, t('Common opponents'), commonOpponentLines(odds, tagA, tagB));
  section(lines, t('Shared brackets'), odds.seeding.brackets.slice(0, OPPONENTS_SHOWN)
    .map(({ slug, name, a: x, b: y }) => t`[${escapeMarkdown(name)}](${startggUrl(slug)}) · ${tagA} seed ${x} · ${tagB} seed ${y}`));
  // seedEdge is an estimate that starts at 67% and moves with their seeded sets, not a count of what happened
  const game = escapeMarkdown(odds.game);
  const basis = odds.seededSets
    ? t`Going by the ${count(odds.seededSets, 'seeded set')} the two of them played in ${game}`
    : t`With none of their ${game} sets seeded`;
  lines.push(t`-# Newer sets count more, a year old counts half. ${basis}, when one seed number is double the other's, the player with the lower one wins about ${percent(odds.seedEdge, 1)}. That's how much seeding counts`);
  if (withSlippi && odds.slippi) lines.push(t('-# Slippi ratings are netplay Elo, so they count conservatively and only for Melee when both players are ranked'));
}

function predictionCard(a, b, odds) {
  const chanceA = chancePercent(odds);
  const embed = baseEmbed(colors.clash, `${FOOTER} · ${odds.game}`)
    .setAuthor({ name: odds.game === 'Melee' ? `${a.tag} · Melee` : a.tag, iconURL: a.image, url: startggUrl(a.slug) })
    .setTitle(`${escapeMarkdown(a.tag)} ${chanceA}% · ${100 - chanceA}% ${escapeMarkdown(b.tag)}`);
  if (b.image) embed.setThumbnail(b.image);
  return embed;
}

// what each part counted, by the sets, opponents, brackets or rating behind it
const units = (key, n) => ({ h2h: () => count(n, 'set'), common: () => count(n, 'opponent'), seeding: () => count(n, 'bracket'), slippi: () => count(n, 'rating') })[key]();

// a bar for a share 0-1, 10 blocks wide. higher means it counted more
export function shareBar(share) {
  const filled = Math.min(10, Math.max(0, Math.round(share * 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

// full is /predict verbose: how much each part counted, with bars and what each had to go on, what it says on
// its own, how sure the model is, and what's behind it all. filters only narrowed the sets behind the odds,
// so the card names them on its small line
export function prediction(a, b, odds, full, filters = {}) {
  const embed = predictionCard(a, b, odds);
  const tagA = bold(a.tag);
  const tagB = bold(b.tag);
  const withSlippi = Boolean(filters.melee);
  const lines = summaryLines(odds, tagA, tagB, withSlippi);
  const line = filterLine(filters);
  if (!full) {
    if (line) lines.push(line);
    return [embed.setDescription(lines.join('\n'))];
  }

  const counted = (share) => `${shareBar(share)} ${percent(share, 1)}`;
  section(lines, t('How it adds up'), [
    ...odds.factors.filter(({ key }) => withSlippi || key !== 'slippi').map(({ key, n, share, chance }) => {
      if (!n) return t`**${factorName(key)}:** nothing to go on, so it doesn't count`;
      const lean = Math.round(chance * 100);
      let says = t('even');
      if (lean > 50) says = `${tagA} ${lean}%`;
      if (lean < 50) says = `${tagB} ${100 - lean}%`;
      return t`**${factorName(key)}:** ${counted(share)} · on its own, ${says} (${units(key, n)})`;
    }),
    t`**Starting from even:** ${counted(odds.prior)}, so the less there is to go on, the closer it stays to 50%`,
  ]);
  section(lines, t('How sure it is'), sureLines(odds, tagA, tagB));
  detailLines(lines, odds, tagA, tagB, withSlippi);
  if (line) lines.push(line);
  return withLines(embed, lines);
}

// the odds before and after the model's doubt pulls them toward even, plus what the short lines leave out
function sureLines(odds, tagA, tagB) {
  const { gap, variance, form, level, seeding, slippi } = odds;
  const certain = chancePercent({ chance: chanceOf(gap, 0) });
  const lines = [
    t`**If the evidence were certain:** ${tagA} ${certain}%. How thin or mixed it is brings that to ${chancePercent(odds)}%`,
    t`-# The gap is ${gap.toFixed(2)} in log-odds, give or take ${Math.sqrt(variance).toFixed(2)}`,
  ];
  // the form line above already shows these when neither had a seeded set
  if (form.a.seeded || form.b.seeded) {
    const record = ({ wins, total }) => `${wins}-${total - wins}`;
    lines.push(t`**Last ${FORM_SETS} sets, seeded or not:** ${tagA} ${record(form.a)} · ${tagB} ${record(form.b)}`);
  }
  if (seeding.total && level.a && level.b) {
    const usual = ({ share, brackets }) => t`${topText(share)} over ${count(brackets, 'bracket')}`;
    lines.push(t`**Usual seed:** ${tagA} ${usual(level.a)} · ${tagB} ${usual(level.b)}`);
  }
  if (slippi) lines.push(t`**Slippi gap:** ${Math.abs(slippi.diff).toFixed(1)} rating points`);
  return lines;
}

// file is the uploaded art of their main. no game means it covers every game. note goes at the bottom.
// searched is how many sets got looked through across every game
export function characters(player, usage, { game, file, note, searched = 0 } = {}) {
  const embed = baseEmbed(colors.brand, game ? `${FOOTER} · ${game}` : undefined)
    .setAuthor({ name: game === 'Melee' ? t('Melee characters') : t('Characters') })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (file) embed.setThumbnail(`attachment://${file}`);
  else if (player.image) embed.setThumbnail(player.image);

  // their last 30 Melee singles sets, or their last 30 singles sets
  const lastSets = (n) => {
    if (!game) return t`their last ${count(n, 'singles set')}`;
    return n === 1 ? t`their last 1 ${game} singles set` : t`their last ${n} ${game} singles sets`;
  };
  const from = lastSets(usage.scanned);
  let nothing;
  // only a few hundred get looked at, so they could have older ones
  if (!usage.scanned) {
    if (searched) nothing = game ? t`No ${game} singles sets in their last ${count(searched, 'singles set')}.` : t`No singles sets in their last ${count(searched, 'singles set')}.`;
    else nothing = game ? t`No ${game} singles sets on start.gg yet.` : t('No singles sets on start.gg yet.');
  } else if (!usage.reported) {
    nothing = t`No characters reported in ${from}. Lots of tournaments don't bother.`;
  }
  if (nothing) return embed.setDescription(note ? `${nothing}\n-# ${note}` : nothing);

  const lines = [];
  for (const [i, character] of usage.characters.slice(0, CHARACTERS_SHOWN).entries()) {
    lines.push(characterRank(usage, character, i));
    if (i === 0 && usage.best) lines.push(t`-# Best vs ${usage.best.name} ${usage.best.wins}-${usage.best.games - usage.best.wins}`);
  }
  if (usage.characters.length > CHARACTERS_SHOWN) lines.push(t`-# and ${usage.characters.length - CHARACTERS_SHOWN} more`);
  lines.push('', t`-# Characters were reported in ${usage.reported} of ${from}`);
  if (note) lines.push(`-# ${note}`);

  return embed.setDescription(lines.join('\n'));
}

// the commands where a blank player falls back to whoever ran it
const LOOKUP_COMMANDS = ['/stats', '/recent', '/upcoming', '/run', '/progress', '/characters', '/h2h', '/predict'];

// /link worked. says everything it opened up, and what linking doesn't do
export function linked(player, previous) {
  const lines = [
    t('**Leave the player blank to look yourself up**'),
    LOOKUP_COMMANDS.map((name) => `\`${name}\``).join(' '),
    t('**`/scout`** any opponent, with your record and odds against them'),
    t('**Player list:** you\'re in it, marked linked, so anyone can pick you in those lookups'),
    t('**`/profile`** finds your start.gg from your Discord'),
    '',
    t('**Not tracked:** nothing about you gets posted and you\'re not in `/track list`. That\'s what `/track add` is for.'),
  ];
  if (previous) lines.push(t`-# Replaced your link to ${escapeMarkdown(previous.tag)}`);
  lines.push(t('-# `/unlink` to undo'));
  const embed = baseEmbed(colors.brand)
    .setTitle(t`Linked to ${escapeMarkdown(player.tag)}`)
    .setURL(startggUrl(player.slug))
    .setDescription(lines.join('\n'));
  if (player.image) embed.setThumbnail(player.image);
  return embed;
}

// /profile. who they are here on top, their start.gg under it. a list pick has no discord avatar
export function profile(account, member) {
  const url = startggUrl(account.slug);
  const author = { name: member.name };
  if (member.avatar) author.iconURL = member.avatar;
  const embed = baseEmbed(colors.brand)
    .setAuthor(author)
    .setTitle(escapeMarkdown(account.tag))
    .setURL(url)
    .setDescription(`[${url.replace('https://www.', '')}](${url})\n${t('-# Discord connected on start.gg')}`);
  if (account.image) embed.setThumbnail(account.image);
  return embed;
}

export function added(player) {
  const embed = baseEmbed(colors.brand)
    .setDescription(t`Now tracking ${playerLink(player)}. Their placements post here.\n-# Set results and stream alerts start off. \`/track posts\` turns them on`);
  if (player.image) embed.setThumbnail(player.image);
  return embed;
}
