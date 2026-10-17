import { MessageFlags, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state } from '../store.js';
import { secondsNow } from '../tracker.js';
import { predict as predictOdds } from '../predict.js';
import { characterUsage, characterUsageByGame } from '../characters.js';
import { periodSummary } from '../reports.js';
import { PICKABLE_GAMES } from './definitions.js';
import { HISTORY_PAGES, LIFETIME_PAGES, SCOUT_PAGES, SCOUT_CHARACTER_PAGES, setHistories, characterHistories, setHistory, characterHistory, lifetimeHistory, lifetimeCharacterHistory, eventHistory } from './history.js';
import { verifiedCaller } from '../accounts.js';
import { profileSlug, readPlayer, replyNoPlayer, sendEmbeds, withCountdown } from './shared.js';

// /characters verbose, so the cards fit in one message
const CHARACTER_GAMES = 6;

// /progress compares the last two of these, verbose lists this many as a trend
const PROGRESS_DAYS = 30;
const TREND_PERIODS = 6;

async function progress(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const verbose = interaction.options.getBoolean('verbose') ?? false;
  const now = secondsNow();
  const span = PROGRESS_DAYS * 24 * 60 * 60;
  // newest first, the first two get compared
  const periods = Array.from({ length: verbose ? TREND_PERIODS : 2 }, (_, i) => ({ since: now - (i + 1) * span, until: now - i * span }));
  const [sets, events, characterSets] = await withCountdown(interaction, `Going through ${escapeMarkdown(player.tag)}'s sets`, Promise.all([
    startgg.getPeriodHistory(player.playerId, periods.at(-1).since, now),
    eventHistory(player.userId),
    // the rest still says plenty without characters, so start.gg failing here doesn't sink it
    verbose ? characterHistory(player.playerId).catch(() => null) : null,
  ]));
  for (const period of periods) period.summary = periodSummary(player, sets, events, period.since, period.until);
  return sendEmbeds(interaction, embeds.progress(player, periods, { verbose, characterSets }));
}

async function scout(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const player = await verifiedCaller(interaction.user.id);
  if (!player) return interaction.editReply('/scout needs to know who you are on start.gg. Connect your Discord on your start.gg profile, then `/link` it.');

  const input = interaction.options.getString('profile', true).trim();
  const opponent = await startgg.getPlayer(profileSlug(input));
  if (!opponent) return interaction.editReply('Couldn\'t find that start.gg player. Use their profile link or ID.');
  if (player.playerId === opponent.playerId) return interaction.editReply('Use an opponent\'s profile, not your own.');

  const [mine, theirs, characters] = await withCountdown(interaction, `Scouting ${escapeMarkdown(opponent.tag)}`, Promise.all([
    setHistory(player.playerId), setHistory(opponent.playerId), characterHistory(opponent.playerId),
  ]));
  const quick = embeds.scout(player, opponent, mine, theirs, characters);
  if (!interaction.options.getBoolean('verbose')) return sendEmbeds(interaction, quick);

  // more of them on top of the same pages, so the quick one shows while it loads. yours is only for
  // meeting them and the odds, so the usual amount is plenty
  const [deeper, characterSets, events, myEvents] = await withCountdown(interaction, 'Full report on its way', Promise.all([
    setHistories(opponent.playerId, SCOUT_PAGES), characterHistories(opponent.playerId, SCOUT_CHARACTER_PAGES), eventHistory(opponent.userId),
    eventHistory(player.userId).catch(() => null),
  ]), quick);
  const odds = predictOdds(player, opponent, mine, deeper, { eventsA: myEvents, eventsB: events });
  return sendEmbeds(interaction, embeds.scoutReport(player, opponent, { mine, theirs: deeper, characterSets, events, odds, players: state.players }));
}

// every set between two players is in both their histories, so one is enough when it fits in pages: the one
// with fewer sets. past that it takes both, since either can get cut off before older sets
async function meetingPlayers(a, b, pages) {
  const [pagesA, pagesB] = await Promise.all([setHistories.totalPages(a.playerId), setHistories.totalPages(b.playerId)]);
  if (Math.min(pagesA, pagesB) > pages) return [a, b];
  return [pagesA <= pagesB ? a : b];
}

const historiesOf = (players, pages) => Promise.all(players.map((player) => setHistories(player.playerId, pages)));

// their singles sets against each other, newest first, DQs left out
function meetings(a, b, histories) {
  const played = startgg.singles(histories.flat(), a).filter(({ them }) => them.playerIds.includes(b.playerId));
  return [...new Map(played.map(({ set }) => [set.id, set])).values()].sort((x, y) => y.completedAt - x.completedAt);
}

async function headToHead(interaction) {
  const b = readPlayer(interaction, 'opponent');
  if (!b) return replyNoPlayer(interaction, 'opponent');
  const a = readPlayer(interaction);
  if (!a) return replyNoPlayer(interaction);
  if (a.userId === b.userId) return interaction.reply({ content: 'Pick two different players.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  const verbose = interaction.options.getBoolean('verbose') ?? false;
  // the histories have every game, so this costs no extra requests
  const melee = interaction.options.getBoolean('melee') ?? false;
  const cards = (sets, full) => {
    const shown = melee ? sets.filter((set) => set.event.videogame?.id === startgg.MELEE) : sets;
    return embeds.headToHead(a, b, shown, { verbose: full, melee, otherGames: sets.length - shown.length });
  };
  // start.gg can't search sets between two players, so it goes through their histories
  const readers = await meetingPlayers(a, b, verbose ? LIFETIME_PAGES : HISTORY_PAGES);
  const doing = `Going through ${escapeMarkdown(a.tag)} and ${escapeMarkdown(b.tag)}'s sets`;
  const recent = meetings(a, b, await withCountdown(interaction, doing, historiesOf(readers, HISTORY_PAGES)));
  if (!verbose) return sendEmbeds(interaction, cards(recent, false));
  // every set is the same pages and more, so the latest show while it loads
  const all = meetings(a, b, await withCountdown(interaction, 'Every set on its way', historiesOf(readers, LIFETIME_PAGES), cards(recent, false)));
  return sendEmbeds(interaction, cards(all, true));
}

async function stats(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const { standings, sets } = await startgg.getStats(player.playerId);
  const recent = embeds.stats(player, standings, sets);
  if (!interaction.options.getBoolean('verbose')) return interaction.editReply({ embeds: [recent] });
  // one request for the recent card means there's something to look at while the lifetime one loads
  const [events, history] = await withCountdown(interaction, 'Lifetime report on its way',
    Promise.all([eventHistory(player.userId), lifetimeHistory(player.playerId)]), [recent]);
  return sendEmbeds(interaction, embeds.lifetimeStats(player, events, history, state.players));
}

async function characters(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const verbose = interaction.options.getBoolean('verbose');
  const picked = interaction.options.getInteger('game');
  let sets = await withCountdown(interaction, `Going through ${escapeMarkdown(player.tag)}'s reported characters`, characterHistory(player.playerId));
  if (verbose) {
    // every game is the same pages and more, so the usual card shows while it loads
    const usual = characterCards(sets, false, picked).cards
      .map(({ game, usage }) => embeds.characters(player, usage, { game: game?.displayName, searched: sets.length }));
    sets = await withCountdown(interaction, 'Every game on its way', lifetimeCharacterHistory(player.playerId), usual);
  }
  const { cards, note } = characterCards(sets, verbose, picked);

  // no picture beats no reply
  const art = await Promise.all(cards.map(({ game, usage }) => (game && usage.characters.length
    ? startgg.getCharacterArt(usage.characters[0].name, game.id).catch(() => null)
    : null)));
  await interaction.editReply({
    // clears a countdown
    content: null,
    embeds: cards.map(({ game, usage }, i) => embeds.characters(player, usage, {
      game: game?.displayName, file: art[i]?.name, note: i === cards.length - 1 ? note : undefined, searched: sets.length,
    })),
    files: art.filter(Boolean),
  });
}

// a card for the picked game, or whichever has more reported. verbose adds one for each other game with
// characters reported, and a note naming the ones without
function characterCards(sets, verbose, picked) {
  const games = characterUsageByGame(sets);
  const mostGames = (a, b) => b.usage.games - a.usage.games;

  // left out, it's the one with more reported games, then more sets. a tie goes to ultimate
  const pickable = PICKABLE_GAMES.map((game) => ({ game, usage: games.find((entry) => entry.game.id === game.id)?.usage ?? characterUsage([]) }));
  const top = pickable.find(({ game }) => game.id === picked) ?? pickable.reduce((a, b) => ((mostGames(a, b) || b.usage.scanned - a.usage.scanned) > 0 ? b : a));
  if (!verbose) return { cards: [top] };

  // picked goes first even with nothing reported, since it's what they asked about
  const first = picked || top.usage.reported ? [top] : [];
  // then a card for each other game with characters reported, most games first
  const rest = games.filter(({ game, usage }) => game.id !== top.game.id && usage.reported).sort(mostGames);
  const cards = [...first, ...rest].slice(0, CHARACTER_GAMES);
  if (!cards.length) return { cards: [{ usage: characterUsage(sets) }] };
  // so it's clear the rest got looked at too
  const unreported = games.filter(({ game, usage }) => !usage.reported && !cards.some((card) => card.game.id === game.id))
    .sort((a, b) => b.usage.scanned - a.usage.scanned).map(({ game }) => game.displayName);
  const shown = unreported.length > 4 ? [...unreported.slice(0, 3), `${unreported.length - 3} other games`] : unreported;
  return { cards, note: shown.length ? `No characters reported for ${new Intl.ListFormat('en').format(shown)}` : undefined };
}

// verbose explains the same odds instead of changing them
async function predict(interaction) {
  const b = readPlayer(interaction, 'opponent');
  if (!b) return replyNoPlayer(interaction, 'opponent');
  const a = readPlayer(interaction);
  if (!a) return replyNoPlayer(interaction);
  if (a.userId === b.userId) return interaction.reply({ content: 'Pick two different players.', flags: MessageFlags.Ephemeral });

  await interaction.deferReply();
  // events say how big each bracket was, which helps seeding count. the odds still work without them
  const [historyA, historyB, eventsA, eventsB] = await withCountdown(interaction, `Going through ${escapeMarkdown(a.tag)} and ${escapeMarkdown(b.tag)}'s sets`,
    Promise.all([setHistory(a.playerId), setHistory(b.playerId), eventHistory(a.userId).catch(() => null), eventHistory(b.userId).catch(() => null)]));
  const odds = predictOdds(a, b, historyA, historyB, { eventsA, eventsB });
  if (!odds) return interaction.editReply(`${a.tag} and ${b.tag} haven't played singles in the same game on start.gg.`);

  await sendEmbeds(interaction, embeds.prediction(a, b, odds, interaction.options.getBoolean('verbose') ?? false));
}

export { progress, scout, headToHead, stats, characters, predict };
