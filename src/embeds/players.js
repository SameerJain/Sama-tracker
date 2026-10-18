import { escapeMarkdown } from 'discord.js';
import { fromSide, startggUrl } from '../startgg.js';
import { FORM_SETS } from '../predict.js';
import { colors, FOOTER, baseEmbed, withLines, percent, topText, count, gameName, gameCount, recordOf, winsOf, GRAND_FINALS, bold, setLink, section, OPPONENTS_SHOWN, CHARACTERS_SHOWN, characterRank, meetingLine, playerLink } from './shared.js';

// sets is newest first. verbose lists every set and adds splits, streaks and when they first played.
// melee means sets is only their melee ones, and otherGames is how many got left out. odds is a
// predict result, shown as one line in both report lengths. verbose never expands it, use /predict for why
export function headToHead(a, b, sets, { verbose = false, melee = false, otherGames = 0, odds = null } = {}) {
  const results = sets.map((set) => fromSide(set, a.playerId));
  const wins = winsOf(results);
  const losses = results.length - wins;

  const playedGames = [...new Set(sets.map(({ event }) => gameName(event)))];
  const game = melee ? 'Melee' : playedGames.length === 1 ? playedGames[0] : null;
  const embed = baseEmbed(colors.clash, game ? `${FOOTER} · ${game}` : undefined).setAuthor({ name: a.tag, iconURL: a.image, url: startggUrl(a.slug) });
  if (b.image) embed.setThumbnail(b.image);
  const leftOut = otherGames ? `${count(otherGames, 'set')} in other games left out` : null;

  const oddsLine = odds ? `**Predicted:** ${bold(a.tag)} ${chancePercent(odds)}% · ${100 - chancePercent(odds)}% ${bold(b.tag)} in ${escapeMarkdown(odds.game)}` : null;

  if (!results.length) {
    const none = [`They haven't played each other in ${melee ? 'Melee ' : ''}singles on start.gg yet.`];
    if (oddsLine) none.push(oddsLine);
    if (leftOut) none.push(`-# ${leftOut}, leave out \`melee\` to count them`);
    return [embed.setTitle(`${escapeMarkdown(a.tag)} vs ${escapeMarkdown(b.tag)}`).setDescription(none.join('\n'))];
  }

  embed.setTitle(`${escapeMarkdown(a.tag)} ${wins}-${losses} ${escapeMarkdown(b.tag)}`);

  const games = gameCount(results);
  const lines = [];
  if (games.won + games.lost) {
    lines.push(`-# Games ${games.won}-${games.lost} (${percent(games.won, games.won + games.lost)} won)`);
  }
  if (wins !== losses) {
    const leader = wins > losses ? a : b;
    lines.push(`**${escapeMarkdown(leader.tag)} leads ${Math.max(wins, losses)}-${Math.min(wins, losses)}**`);
  }
  if (oddsLine) lines.push(oddsLine);
  if (verbose) lines.push(...rivalry(a, b, results));
  if (lines.length) lines.push('');

  const shown = verbose ? results : results.slice(0, 10);
  lines.push(...shown.map(meetingLine));
  if (shown.length < results.length) lines.push(`-# ${count(results.length - shown.length, 'older set')} not shown, Full report lists them all`);
  if (leftOut) lines.push(`-# Melee only, ${leftOut}`);
  return withLines(embed, lines);
}

// /h2h verbose, from a's side like the title
function rivalry(a, b, results) {
  // b goes in bold labels, which can't hold more bold
  const tagA = bold(a.tag);
  const tagB = escapeMarkdown(b.tag);
  const lines = [];

  const byGame = Map.groupBy(results, ({ set }) => gameName(set.event));
  if (byGame.size > 1) lines.push(`**By game:** ${[...byGame].map(([game, list]) => `${escapeMarkdown(game)} ${recordOf(list)}`).join(' · ')}`);

  // who the bracket expected to win
  const seeded = results.filter(({ me, them }) => me.seed && them.seed && me.seed !== them.seed);
  const above = seeded.filter(({ me, them }) => me.seed < them.seed);
  if (above.length) lines.push(`**Seeded above ${tagB}:** ${tagA} ${recordOf(above)}`);
  const below = seeded.filter(({ me, them }) => me.seed > them.seed);
  if (below.length) lines.push(`**Seeded below ${tagB}:** ${tagA} ${recordOf(below)}`);

  const grands = results.filter(({ set }) => GRAND_FINALS.test(set.round ?? ''));
  if (grands.length) lines.push(`**Grand finals:** ${tagA} ${recordOf(grands)}`);

  const streak = results.findIndex((result) => result.won !== results[0].won);
  const run = streak === -1 ? results.length : streak;
  if (run > 1) lines.push(`**Streak:** ${bold((results[0].won ? a : b).tag)} has won the last ${run}`);

  const first = results.at(-1);
  lines.push(`**First played:** <t:${first.set.completedAt}:D> at ${setLink(first.set)}`);
  return lines;
}

const FACTORS = { h2h: 'Head-to-head', common: 'Common opponents', seeding: 'Seeding and form' };

// 28-12 in seeded sets, seeding expected 24-16. just the record if none of their sets were seeded
function formText(tag, { wins, total, seededWins, seeded, expected }) {
  if (!seeded) return `${tag} ${wins}-${total - wins}`;
  const said = Math.round(expected);
  return `${tag} ${seededWins}-${seeded - seededWins} in seeded sets, seeding expected ${said}-${seeded - said}`;
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

// verbose shows how much each part counted and what it says on its own, plus what's behind them
export function prediction(a, b, odds, verbose) {
  const chanceA = chancePercent(odds);
  const embed = baseEmbed(colors.clash, `${FOOTER} · ${odds.game}`)
    .setAuthor({ name: a.tag, iconURL: a.image, url: startggUrl(a.slug) })
    .setTitle(`${escapeMarkdown(a.tag)} ${chanceA}% · ${100 - chanceA}% ${escapeMarkdown(b.tag)}`);
  if (b.image) embed.setThumbnail(b.image);

  const tagA = bold(a.tag);
  const tagB = bold(b.tag);
  const { h2h, common, seeding, level, form } = odds;
  const lines = [];

  const losses = h2h.total - h2h.wins;
  if (!h2h.total) lines.push('**Head-to-head:** never played, so it comes down to the rest');
  else if (h2h.wins === losses) lines.push(`**Head-to-head:** even at ${h2h.wins}-${losses}`);
  else lines.push(`**Head-to-head:** ${h2h.wins > losses ? `${tagA} leads ${h2h.wins}-${losses}` : `${tagB} leads ${losses}-${h2h.wins}`}`);

  if (common.total) {
    // equal records against someone count for neither, so the rest get named
    const even = common.total - common.better - common.worse;
    const rest = even ? `, even against the other ${even}` : '';
    lines.push(`**Common opponents:** ${common.total} shared. ${tagA} did better against ${common.better}, ${tagB} against ${common.worse}${rest}`);
  }
  if (seeding.total) {
    const [leader, trailing, times, higher] = seeding.ratio >= 1 ? [tagA, tagB, seeding.ratio, seeding.higher] : [tagB, tagA, 1 / seeding.ratio, seeding.lower];
    // the ratio is the trailing player's average seed number over the leader's
    const by = times < 1.15 ? 'their average seed numbers were about the same' : `${trailing}'s average seed number was ${times.toFixed(1)}x ${leader}'s`;
    lines.push(`**Seeding:** ${leader} got the better seed in ${higher} of ${seeding.total} shared brackets, ${by}`);
  } else if (level.a && level.b) {
    lines.push(`**Usual seed:** ${tagA} ${topText(level.a.share)} of their brackets · ${tagB} ${topText(level.b.share)}`);
  }
  lines.push(`**Form, last ${FORM_SETS} sets:** ${formText(tagA, form.a)} · ${formText(tagB, form.b)}`);
  if (!verbose) return [embed.setDescription(lines.join('\n'))];

  section(lines, 'How it adds up', [
    ...odds.factors.map(({ key, n, share, chance }) => {
      if (!n) return `**${FACTORS[key]}:** nothing to go on, so it doesn't count`;
      const lean = Math.round(chance * 100);
      let says = 'even';
      if (lean > 50) says = `${tagA} ${lean}%`;
      if (lean < 50) says = `${tagB} ${100 - lean}%`;
      return `**${FACTORS[key]}:** counts for ${percent(share, 1)} · on its own, ${says}`;
    }),
    `**Starting from even:** counts for ${percent(odds.prior, 1)}, so the less there is to go on, the closer it stays to 50%`,
  ]);
  section(lines, 'Common opponents', commonOpponentLines(odds, tagA, tagB));
  section(lines, 'Shared brackets', seeding.brackets.slice(0, OPPONENTS_SHOWN)
    .map(({ slug, name, a: x, b: y }) => `[${escapeMarkdown(name)}](${startggUrl(slug)}) · ${tagA} seed ${x} · ${tagB} seed ${y}`));
  // seedEdge is an estimate that starts at 67% and moves with their seeded sets, not a count of what happened
  const game = escapeMarkdown(odds.game);
  const basis = odds.seededSets ? `Going by the ${count(odds.seededSets, 'seeded set')} the two of them played in ${game}` : `With none of their ${game} sets seeded`;
  lines.push(`-# Newer sets count more, a year old counts half. ${basis}, when one seed number is double the other's, `
    + `the player with the lower one wins about ${percent(odds.seedEdge, 1)}. That's how much seeding counts`);
  return withLines(embed, lines);
}

// file is the uploaded art of their main. no game means it covers every game. note goes at the bottom.
// searched is how many sets got looked through across every game
export function characters(player, usage, { game, file, note, searched = 0 } = {}) {
  const embed = baseEmbed(colors.brand, game ? `${FOOTER} · ${game}` : undefined)
    .setAuthor({ name: 'Characters' })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (file) embed.setThumbnail(`attachment://${file}`);
  else if (player.image) embed.setThumbnail(player.image);

  const sets = game ? `${game} singles set` : 'singles set';
  const from = `their last ${count(usage.scanned, sets)}`;
  let nothing;
  // only a few hundred get looked at, so they could have older ones
  if (!usage.scanned) nothing = searched ? `No ${sets}s in their last ${count(searched, 'singles set')}.` : `No ${sets}s on start.gg yet.`;
  else if (!usage.reported) nothing = `No characters reported in ${from}. Lots of tournaments don't bother.`;
  if (nothing) return embed.setDescription(note ? `${nothing}\n-# ${note}` : nothing);

  const lines = [];
  for (const [i, character] of usage.characters.slice(0, CHARACTERS_SHOWN).entries()) {
    lines.push(characterRank(usage, character, i));
    if (i === 0 && usage.best) lines.push(`-# Best vs ${usage.best.name} ${usage.best.wins}-${usage.best.games - usage.best.wins}`);
  }
  if (usage.characters.length > CHARACTERS_SHOWN) lines.push(`-# and ${usage.characters.length - CHARACTERS_SHOWN} more`);
  lines.push('', `-# Characters were reported in ${usage.reported} of ${from}`);
  if (note) lines.push(`-# ${note}`);

  return embed.setDescription(lines.join('\n'));
}

// the commands where a blank player falls back to whoever ran it
const LOOKUP_COMMANDS = ['/stats', '/recent', '/upcoming', '/run', '/progress', '/characters', '/h2h', '/predict'];

// /link worked. says everything it opened up, and what linking doesn't do
export function linked(player, previous) {
  const lines = [
    '**Leave the player blank to look yourself up**',
    LOOKUP_COMMANDS.map((name) => `\`${name}\``).join(' '),
    '**`/scout`** any opponent, with your record and odds against them',
    '**Player list:** you\'re in it, marked linked, so anyone can pick you in those lookups',
    '**`/profile`** finds your start.gg from your Discord',
    '',
    '**Not tracked:** nothing about you gets posted and you\'re not in `/track list`. That\'s what `/track add` is for.',
  ];
  if (previous) lines.push(`-# Replaced your link to ${escapeMarkdown(previous.tag)}`);
  lines.push('-# `/unlink` to undo');
  const embed = baseEmbed(colors.brand)
    .setTitle(`Linked to ${escapeMarkdown(player.tag)}`)
    .setURL(startggUrl(player.slug))
    .setDescription(lines.join('\n'));
  if (player.image) embed.setThumbnail(player.image);
  return embed;
}

// /profile. who they are here on top, their start.gg under it. a list pick has no discord avatar
export function profile(account, member) {
  const url = startggUrl(account.slug);
  const embed = baseEmbed(colors.brand)
    .setAuthor({ name: member.name, ...(member.avatar ? { iconURL: member.avatar } : {}) })
    .setTitle(escapeMarkdown(account.tag))
    .setURL(url)
    .setDescription(`[${url.replace('https://www.', '')}](${url})\n-# Discord connected on start.gg`);
  if (account.image) embed.setThumbnail(account.image);
  return embed;
}

export function added(player) {
  const embed = baseEmbed(colors.brand)
    .setDescription(`Now tracking ${playerLink(player)}. Their placements post here.\n-# Set results, stream alerts and match call pings start off. \`/sets\`, \`/stream\` and \`/calls\` turn them on`);
  if (player.image) embed.setThumbnail(player.image);
  return embed;
}
