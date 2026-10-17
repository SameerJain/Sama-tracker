import { MessageFlags, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state } from '../store.js';
import { secondsNow } from '../tracker.js';
import { predict as predictOdds, gameSets, sharedGame } from '../predict.js';
import { characterUsage, characterUsageByGame } from '../characters.js';
import { periodSummary } from '../reports.js';
import { PICKABLE_GAMES } from './definitions.js';
import { SCOUT_PAGES, SCOUT_CHARACTER_PAGES, setHistories, characterHistories, setHistory, characterHistory, lifetimeHistory, lifetimeCharacterHistory, eventHistory } from './history.js';
import { verifiedCaller } from '../accounts.js';
import { fetchPlayer, findPlayer, readPlayer, replyEphemeral, replyEphemeralAfterDefer, replyNoPlayer, sendEmbeds, withCountdown, flag } from './shared.js';

// /characters verbose, so the cards fit in one message
const CHARACTER_GAMES = 6;

// /progress compares the last two of these, verbose lists this many as a trend
const PROGRESS_DAYS = 30;
const TREND_PERIODS = 6;

// the melee option and its filter, the same for sets, standings, events and character sets
const onlyMelee = (list, melee) => (melee ? list.filter(startgg.isMelee) : list);
function meleeOption(interaction) {
  const melee = flag(interaction, 'melee');
  return { melee, only: (list) => onlyMelee(list, melee) };
}

// the two players a matchup command works on, opponent first. either option also takes a start.gg
// profile link or ID, so it doesn't matter whether either is tracked or linked. null when it answered
async function pair(interaction) {
  const b = readPlayer(interaction, 'opponent');
  const a = readPlayer(interaction);
  // left out with no start.gg linked, there's no player to look up
  if (!a && interaction.options.getString('player') === null) {
    await replyEphemeral(interaction, 'Pick a player by name, a start.gg link or ID, or `/link` your start.gg so leaving it out looks you up.');
    return null;
  }
  // a typed link or ID isn't on either list, so it gets looked up; that request waits for the defer
  if (!a || !b) await interaction.deferReply();
  const first = a ?? await fetchPlayer(interaction, interaction.options.getString('player'));
  const second = b ?? await fetchPlayer(interaction, interaction.options.getString('opponent'));
  if (!first || !second) return null;
  if (first.userId === second.userId) {
    await replyEphemeralAfterDefer(interaction, 'Pick two different players.');
    return null;
  }
  return [first, second];
}

async function progress(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const verbose = flag(interaction, 'verbose');
  const { melee, only } = meleeOption(interaction);
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
  const played = only(sets);
  const finishes = only(events);
  for (const period of periods) period.summary = periodSummary(player, played, finishes, period.since, period.until);
  return sendEmbeds(interaction, embeds.progress(player, periods, { verbose, characterSets: characterSets && only(characterSets), melee }));
}

async function scout(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const player = await verifiedCaller(interaction.user.id);
  if (!player) return interaction.editReply('/scout needs to know who you are on start.gg. Connect your Discord on your start.gg profile, then `/link` it.');

  const input = interaction.options.getString('profile', true);
  const opponent = await findPlayer(interaction, input);
  if (!opponent) return;
  if (player.playerId === opponent.playerId) return interaction.editReply('Use an opponent\'s profile, not your own.');

  const { melee, only } = meleeOption(interaction);
  const [mine, theirs, characters] = await withCountdown(interaction, `Scouting ${escapeMarkdown(opponent.tag)}`, Promise.all([
    setHistory(player.playerId), setHistory(opponent.playerId), characterHistory(opponent.playerId),
  ]));
  const mySets = only(mine);
  const quick = embeds.scout(player, opponent, mySets, only(theirs), only(characters), { melee });
  if (!flag(interaction, 'verbose')) return sendEmbeds(interaction, quick);

  // more of them on top of the same pages, so the quick one shows while it loads. yours is only for
  // meeting them and the odds, so the usual amount is plenty
  const [deeper, characterSets, events, myEvents] = await withCountdown(interaction, 'Full report on its way', Promise.all([
    setHistories(opponent.playerId, SCOUT_PAGES), characterHistories(opponent.playerId, SCOUT_CHARACTER_PAGES), eventHistory(opponent.userId),
    eventHistory(player.userId).catch(() => null),
  ]), quick);
  const theirSets = only(deeper);
  const odds = predictOdds(player, opponent, mySets, theirSets, { game: melee ? 'Melee' : undefined, eventsA: myEvents && only(myEvents), eventsB: only(events) });
  return sendEmbeds(interaction, embeds.scoutReport(player, opponent, {
    mine: mySets, theirs: theirSets, characterSets: only(characterSets), events: only(events), odds, players: state.players, melee,
  }));
}

async function headToHead(interaction) {
  const players = await pair(interaction);
  if (!players) return;
  const [a, b] = players;

  // pair only has to defer itself when it looked a link up
  if (!interaction.deferred) await interaction.deferReply();
  const verbose = flag(interaction, 'verbose');
  const { melee, only } = meleeOption(interaction);
  const sets = await withCountdown(interaction, `Finding ${escapeMarkdown(a.tag)} and ${escapeMarkdown(b.tag)}'s meetings`,
    startgg.getHeadToHead(a.playerId, b.playerId));
  const shown = only(sets);
  return sendEmbeds(interaction, embeds.headToHead(a, b, shown, { verbose, melee, otherGames: sets.length - shown.length }));
}

async function stats(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const { melee, only } = meleeOption(interaction);
  const { standings, sets } = await startgg.getStats(player.playerId, { videogameId: melee ? startgg.MELEE : undefined });
  const recent = embeds.stats(player, only(standings), only(sets), { melee });
  if (!flag(interaction, 'verbose')) return interaction.editReply({ embeds: [recent] });
  // show the recent card while the lifetime report loads
  const [events, history] = await withCountdown(interaction, 'Lifetime report on its way',
    Promise.all([eventHistory(player.userId), lifetimeHistory(player.playerId)]), [recent]);
  return sendEmbeds(interaction, embeds.lifetimeStats(player, only(events), only(history), state.players, { melee }));
}

async function characters(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  const verbose = flag(interaction, 'verbose');
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

// nothing to predict with: without melee that means no game in common. with it, name whoever is missing
// Melee and point at the game the odds do work for, since the old pair wording read like both were missing it
function noOdds(a, b, historyA, historyB, melee) {
  const tags = [escapeMarkdown(a.tag), escapeMarkdown(b.tag)];
  if (!melee) return `${tags[0]} and ${tags[1]} haven't played singles in the same game on start.gg.`;

  const missing = [a, b].filter((player, i) => !gameSets(i ? historyB : historyA, player, 'Melee').length).map((player) => escapeMarkdown(player.tag));
  const who = missing.length === 2 ? `Neither ${tags[0]} nor ${tags[1]} has` : `${missing[0]} hasn't`;
  // only point at leaving melee out when that really gives odds there, not when a shared game is all DQs
  const shared = sharedGame(historyA, historyB);
  const hint = shared && gameSets(historyA, a, shared).length && gameSets(historyB, b, shared).length
    ? `\n-# Leave out \`melee\` for ${escapeMarkdown(shared)} odds` : '';
  return `${who} played Melee singles on start.gg.${hint}`;
}

// verbose explains the same odds instead of changing them
async function predict(interaction) {
  const players = await pair(interaction);
  if (!players) return;
  const [a, b] = players;

  // pair only has to defer itself when it looked a link up
  if (!interaction.deferred) await interaction.deferReply();
  const melee = flag(interaction, 'melee');
  // events say how big each bracket was, which helps seeding count. the odds still work without them
  const [historyA, historyB, eventsA, eventsB] = await withCountdown(interaction, `Going through ${escapeMarkdown(a.tag)} and ${escapeMarkdown(b.tag)}'s sets`,
    Promise.all([setHistory(a.playerId), setHistory(b.playerId), eventHistory(a.userId).catch(() => null), eventHistory(b.userId).catch(() => null)]));
  const odds = predictOdds(a, b, historyA, historyB, { game: melee ? 'Melee' : undefined, eventsA, eventsB });
  if (!odds) return interaction.editReply(noOdds(a, b, historyA, historyB, melee));

  await sendEmbeds(interaction, embeds.prediction(a, b, odds, flag(interaction, 'verbose')));
}

export { progress, scout, headToHead, stats, characters, predict };
