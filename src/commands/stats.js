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
import {
  fetchPlayer, findPlayer, readPlayer, replyEphemeral, replyEphemeralAfterDefer, replyNoPlayer, sendEmbeds, withCountdown, flag, reportButton, fullReport, buttonRow,
} from './shared.js';

// /characters verbose, so the cards fit in one message
const CHARACTER_GAMES = 6;

// /progress compares the last two of these, verbose lists this many as a trend
const PROGRESS_DAYS = 30;
const TREND_PERIODS = 6;

const NOT_LINKED = '/scout needs to know who you are on start.gg. Connect your Discord on your start.gg profile, then `/link` it.';

// the melee option's filter, the same for sets, standings, events and character sets
const onlyMelee = (melee) => (list) => (melee ? list.filter(startgg.isMelee) : list);

// each report runs after its command's checks and the defer, so a button can run it again with the same
// players. these are the options it takes from the command
const reportOptions = (interaction) => ({ verbose: flag(interaction, 'verbose'), melee: flag(interaction, 'melee') });

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
  // a miss has already answered and deleted the thinking reply, so the other one doesn't get looked up
  const first = a ?? await fetchPlayer(interaction, interaction.options.getString('player'));
  if (!first) return null;
  const second = b ?? await fetchPlayer(interaction, interaction.options.getString('opponent'));
  if (!second) return null;
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
  return progressReport(interaction, { player, ...reportOptions(interaction) });
}

async function progressReport(interaction, { player, verbose, melee }) {
  const only = onlyMelee(melee);
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
  // the full report looks back 180 days, so it's worth a look even when the last 60 had nothing
  const more = verbose ? [] : buttonRow(fullReport('progress', { player, melee }));
  return sendEmbeds(interaction, embeds.progress(player, periods, { verbose, characterSets: characterSets && only(characterSets), melee }), more);
}

async function scout(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const player = await verifiedCaller(interaction.user.id);
  if (!player) return interaction.editReply(NOT_LINKED);

  const input = interaction.options.getString('profile', true);
  // a tracked or linked pick from autocomplete, otherwise a start.gg link or ID
  const opponent = readPlayer(interaction, 'profile') ?? await findPlayer(interaction, input);
  if (!opponent) return;
  if (player.playerId === opponent.playerId) return interaction.editReply('Use an opponent\'s profile, not your own.');

  return scoutReport(interaction, { player, opponent, ...reportOptions(interaction) });
}

// player is always whoever ran it, so its button only carries the opponent
async function scoutReport(interaction, { player, opponent, verbose, melee }) {
  const only = onlyMelee(melee);
  const [mine, theirs, characters] = await withCountdown(interaction, `Scouting ${escapeMarkdown(opponent.tag)}`, Promise.all([
    setHistory(player.playerId), setHistory(opponent.playerId), characterHistory(opponent.playerId),
  ]));
  const mySets = only(mine);
  const quick = embeds.scout(player, opponent, mySets, only(theirs), only(characters), { melee });
  if (!verbose) return sendEmbeds(interaction, quick, buttonRow(fullReport('scout', { opponent, melee })));

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
  const [player, opponent] = players;

  // pair only has to defer itself when it looked a link up
  if (!interaction.deferred) await interaction.deferReply();
  return headToHeadReport(interaction, { player, opponent, ...reportOptions(interaction) });
}

async function headToHeadReport(interaction, { player: a, opponent: b, verbose, melee }) {
  const only = onlyMelee(melee);
  // meetings for the record, histories and events for one line of /predict odds
  const [sets, historyA, historyB, eventsA, eventsB] = await withCountdown(interaction, `Finding ${escapeMarkdown(a.tag)} and ${escapeMarkdown(b.tag)}'s meetings and odds`,
    Promise.all([
      startgg.getHeadToHead(a.playerId, b.playerId),
      setHistory(a.playerId), setHistory(b.playerId),
      eventHistory(a.userId).catch(() => null), eventHistory(b.userId).catch(() => null),
    ]));
  const shown = only(sets);
  // every meeting, so the odds go by the same record the card shows
  const odds = predictOdds(a, b, historyA, historyB, { game: melee ? 'Melee' : undefined, eventsA, eventsB, meetings: sets });
  // never having played, the full report would say the same thing. the odds stay one line in both, so
  // the other button posts /predict for why
  const buttons = buttonRow(
    !verbose && shown.length && fullReport('h2h', { player: a, opponent: b, melee }),
    odds && reportButton('Why these odds', 'new', 'predict', { player: a, opponent: b, melee }),
  );
  return sendEmbeds(interaction, embeds.headToHead(a, b, shown, { verbose, melee, otherGames: sets.length - shown.length, odds }), buttons);
}

async function stats(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  return statsReport(interaction, { player, ...reportOptions(interaction) });
}

async function statsReport(interaction, { player, verbose, melee }) {
  const only = onlyMelee(melee);
  const { standings, sets } = await startgg.getStats(player.playerId, { videogameId: melee ? startgg.MELEE : undefined });
  const recent = embeds.stats(player, only(standings), only(sets), { melee });
  if (!verbose) {
    // nothing recent on start.gg means nothing older either
    const more = only(standings).length || only(sets).length ? buttonRow(fullReport('stats', { player, melee })) : [];
    return interaction.editReply({ embeds: [recent], components: more });
  }
  // show the recent card while the lifetime report loads
  const [events, history] = await withCountdown(interaction, 'Lifetime report on its way',
    Promise.all([eventHistory(player.userId), lifetimeHistory(player.playerId)]), [recent]);
  return sendEmbeds(interaction, embeds.lifetimeStats(player, only(events), only(history), state.players, { melee }));
}

async function characters(interaction) {
  const player = readPlayer(interaction);
  if (!player) return replyNoPlayer(interaction);

  await interaction.deferReply();
  return charactersReport(interaction, { player, verbose: flag(interaction, 'verbose'), game: interaction.options.getInteger('game') });
}

// game is the one picked, null for whichever has more reported
async function charactersReport(interaction, { player, verbose, game: picked }) {
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
    // replaces the art when a button swaps in the full report
    files: art.filter(Boolean),
    components: verbose ? [] : buttonRow(fullReport('characters', { player, game: picked })),
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
  // the game predict would pick without melee, which leaves out DQs, so leaving melee out really gives odds there
  const shared = sharedGame(a, b, historyA, historyB);
  const hint = shared ? `\n-# Leave out \`melee\` for ${escapeMarkdown(shared)} odds` : '';
  return `${who} played Melee singles on start.gg.${hint}`;
}

// verbose explains the same odds instead of changing them
async function predict(interaction) {
  const players = await pair(interaction);
  if (!players) return;
  const [player, opponent] = players;

  // pair only has to defer itself when it looked a link up
  if (!interaction.deferred) await interaction.deferReply();
  return predictReport(interaction, { player, opponent, ...reportOptions(interaction) });
}

async function predictReport(interaction, { player: a, opponent: b, verbose, melee }) {
  // meetings go back past the histories, usually in one request, so head-to-head matches /h2h. events say how
  // big each bracket was, which helps seeding count. the histories have the recent meetings and the odds still
  // work without events, so either failing doesn't sink it
  const [historyA, historyB, meetings, eventsA, eventsB] = await withCountdown(interaction, `Going through ${escapeMarkdown(a.tag)} and ${escapeMarkdown(b.tag)}'s sets`,
    Promise.all([
      setHistory(a.playerId), setHistory(b.playerId), startgg.getHeadToHead(a.playerId, b.playerId).catch(() => []),
      eventHistory(a.userId).catch(() => null), eventHistory(b.userId).catch(() => null),
    ]));
  const odds = predictOdds(a, b, historyA, historyB, { game: melee ? 'Melee' : undefined, eventsA, eventsB, meetings });
  if (!odds) return interaction.editReply(noOdds(a, b, historyA, historyB, melee));

  const more = verbose ? [] : buttonRow(fullReport('predict', { player: a, opponent: b, melee }));
  await sendEmbeds(interaction, embeds.prediction(a, b, odds, verbose), more);
}

// what each report button runs
const reports = {
  progress: progressReport, scout: scoutReport, h2h: headToHeadReport, stats: statsReport, characters: charactersReport, predict: predictReport,
};

export { progress, scout, headToHead, stats, characters, predict, reports, NOT_LINKED };
