import { MessageFlags, escapeMarkdown } from 'discord.js';
import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state } from '../store.js';
import { secondsNow } from '../tracker.js';
import { predict as predictOdds, gameSets, sharedGame } from '../predict.js';
import { characterUsage, characterUsageByGame } from '../characters.js';
import { periodSummary } from '../reports.js';
import { PICKABLE_GAMES } from './definitions.js';
import {
  SCOUT_PAGES, SCOUT_CHARACTER_PAGES, setHistories, characterHistories, setHistory, characterHistory, lifetimeHistory, lifetimeCharacterHistory, eventHistory,
  doublesHistory, doublesEvents, h2hHistory, statsHistory,
} from './history.js';
import { findAccount, verifiedCaller } from '../accounts.js';
import { slippiFor, slippiLookup } from './slippi.js';
import { LOGO as slippiLogo } from '../slippi.js';
import {
  fetchPlayer, findPlayer, readPlayer, replyEphemeral, replyEphemeralAfterDefer, sendEmbeds, statPlayer, withCountdown, flag, fullReport, buttonRow,
  linkedPlayer, rememberPick, parseSince, looksLikeProfile, notAPlayer, t, listOf,
} from './shared.js';

// /characters verbose, so the cards fit in one message
const CHARACTER_GAMES = 6;

// the short /doubles window, the same as /stats
const DOUBLES_SETS = 30;

// /progress compares the last two of these, verbose lists this many as a trend
const PROGRESS_DAYS = 30;
const TREND_PERIODS = 6;

const NOT_LINKED = '/scout needs to know who you are on start.gg. Connect your Discord on your start.gg profile, then `/link` it.';

// the melee option's filter, the same for sets, standings, events and character sets
const onlyMelee = (melee) => (list) => (melee ? list.filter(startgg.isMelee) : list);

// melee:True, or everything the report found was melee anyway. those reports get a Slippi ranked field
const allMelee = (melee, ...lists) => melee
  || (lists.some((list) => list?.length) && lists.every((list) => !list?.length || list.every(startgg.isMelee)));

// each report runs after its command's checks and the defer, so a button can run it again with the same
// players. these are the options it takes from the command
const reportOptions = (interaction) => ({ verbose: flag(interaction, 'verbose'), melee: flag(interaction, 'melee') });

// since is unix seconds, venue offline, online or null for both, and sinceText the YYYY-MM-DD for
// buttons. error answers with what to type instead, before anything gets deferred
function filterOptions(interaction) {
  const text = interaction.options.getString('since');
  const { since, error } = parseSince(text);
  if (error) return { error };
  const venue = interaction.options.getString('venue');
  return { since, sinceText: text?.trim() || null, venue: venue === 'offline' || venue === 'online' ? venue : null };
}

// sets carry tournament.isOnline under event, and standings and events do too. anything missing it
// stays out once filtering is on. character sets have no tournament to go by, so venue leaves them alone
const onlineOf = (tournament) => tournament?.isOnline ?? null;
const venueMatch = (venue, online) => !venue || online === (venue === 'online');
// since is null from the command and missing from the Apps menu, and both mean everything
const onOrAfter = (since, at) => !since || (at ?? 0) >= since;

const scopeSets = ({ since, venue }) => (list) => (list ?? []).filter((set) =>
  onOrAfter(since, set.completedAt) && venueMatch(venue, onlineOf(set.event?.tournament)));
// null stays null, so a failed event lookup still reads seeding from the sets themselves
const scopeEntries = ({ since, venue }) => (list) => (!list ? list : list.filter((entry) =>
  onOrAfter(since, entry.event?.startAt) && venueMatch(venue, onlineOf(entry.event?.tournament))));
const scopeCharacters = ({ since }) => (list) => (!list ? list : list.filter((set) => onOrAfter(since, set.completedAt)));

// a report's melee, since and venue options, as one filter per kind of list it reads
function scoped({ melee, since, venue }) {
  const only = onlyMelee(melee);
  const filters = { since, venue };
  return {
    only,
    filters,
    sets: (list) => scopeSets(filters)(only(list)),
    events: (list) => scopeEntries(filters)(only(list)),
    characters: (list) => scopeCharacters(filters)(only(list)),
    // the odds pick their own game out of a history, so since and venue narrow it but melee doesn't
    anyGame: scopeSets(filters),
  };
}

// the same odds with slippi ratings when both are ranked and the game is melee. slippi never sinks
// the report, so anything going wrong here leaves the start.gg odds as they were
async function oddsWithSlippi(a, b, historyA, historyB, options, ranked, show) {
  const plain = predictOdds(a, b, historyA, historyB, options);
  let profiles = null;
  try {
    profiles = await ranked(show || plain?.game === 'Melee');
    if (plain?.game === 'Melee' && profiles?.[0] && profiles?.[1]) {
      const withSlippi = predictOdds(a, b, historyA, historyB, { ...options, slippiA: profiles[0], slippiB: profiles[1] });
      if (withSlippi?.slippi) return { odds: withSlippi, profiles };
    }
  } catch (err) {
    console.error('slippi odds failed:', err.message);
  }
  return { odds: plain, profiles };
}

// the two players a matchup command works on, opponent first. either option also takes a start.gg
// profile link or ID, so it doesn't matter whether either is tracked or linked. null when it answered
async function pair(interaction) {
  const b = readPlayer(interaction, 'opponent');
  const a = readPlayer(interaction);
  // left out with no start.gg linked, there's no player to look up
  if (!a && interaction.options.getString('player') === null) {
    await replyEphemeral(interaction, t('Pick a player by name, a start.gg link or ID, or `/link` your start.gg so leaving it out looks you up.'));
    return null;
  }
  // a name that isn't on either list gets the closest one straight away, before any wait
  const typo = [!a && interaction.options.getString('player'), !b && interaction.options.getString('opponent')]
    .find((typed) => typed && !looksLikeProfile(typed));
  if (typo) {
    await replyEphemeral(interaction, notAPlayer(typo));
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
    await replyEphemeralAfterDefer(interaction, t('Pick two different players.'));
    return null;
  }
  return [first, second];
}

// pair plus the since and venue filters, deferred and ready for a report. null when it answered
async function matchup(interaction) {
  const filters = filterOptions(interaction);
  if (filters.error) {
    await replyEphemeral(interaction, filters.error);
    return null;
  }
  const players = await pair(interaction);
  if (!players) return null;
  // pair only has to defer itself when it looked a link up
  if (!interaction.deferred) await interaction.deferReply();
  return { player: players[0], opponent: players[1], ...filters };
}

async function progress(interaction) {
  const player = await statPlayer(interaction);
  if (!player) return null;

  if (!interaction.deferred) await interaction.deferReply();
  return progressReport(interaction, { player, ...reportOptions(interaction) });
}

async function progressReport(interaction, { player, verbose, melee }) {
  const only = onlyMelee(melee);
  const now = secondsNow();
  const span = PROGRESS_DAYS * 24 * 60 * 60;
  const ranked = slippiLookup([player], melee);
  // newest first, the first two get compared
  const periods = Array.from({ length: verbose ? TREND_PERIODS : 2 }, (_, i) => ({ since: now - (i + 1) * span, until: now - i * span }));
  const [sets, events, characterSets] = await withCountdown(interaction, t`Going through ${escapeMarkdown(player.tag)}'s sets`, Promise.all([
    startgg.getPeriodHistory(player.playerId, periods.at(-1).since, now),
    eventHistory(player.userId),
    // the rest still says plenty without characters, so start.gg failing here doesn't sink it
    verbose ? characterHistory(player.playerId).catch(() => null) : null,
  ]));
  const played = only(sets);
  const finishes = only(events);
  for (const period of periods) period.summary = periodSummary(player, played, finishes, period.since, period.until);
  // no Full report button, verbose:True is the way to the longer one
  const cards = embeds.progress(player, periods, { verbose, characterSets: characterSets && only(characterSets), melee });
  return sendEmbeds(interaction, embeds.withSlippi(cards, [player], await ranked(allMelee(melee, sets, events)), { seasons: true }));
}

async function scout(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const player = await verifiedCaller(interaction.user.id);
  if (!player) return interaction.editReply(t(NOT_LINKED));

  const input = interaction.options.getString('opponent', true);
  // a tracked or linked pick from autocomplete, otherwise a start.gg link or ID
  const picked = readPlayer(interaction, 'opponent');
  if (!picked && !looksLikeProfile(input)) return interaction.editReply({ content: notAPlayer(input), allowedMentions: { parse: [] } });
  const opponent = picked ?? await findPlayer(interaction, input);
  if (!opponent) return;
  if (player.playerId === opponent.playerId) return interaction.editReply(t('Use an opponent\'s profile, not your own.'));
  const filters = filterOptions(interaction);
  if (filters.error) return interaction.editReply(filters.error);

  return scoutReport(interaction, { player, opponent, ...reportOptions(interaction), ...filters });
}

// player is always whoever ran it, so its button only carries the opponent
async function scoutReport(interaction, { player, opponent, verbose, melee, since, venue, sinceText }) {
  const scope = scoped({ melee, since, venue });
  const ranked = slippiLookup([player, opponent], melee);
  const [mine, theirs, characters] = await withCountdown(interaction, t`Scouting ${escapeMarkdown(opponent.tag)}`, Promise.all([
    setHistory(player.playerId), setHistory(opponent.playerId), characterHistory(opponent.playerId),
  ]));
  const mySets = scope.sets(mine);
  const profiles = await ranked(allMelee(melee, theirs, characters));
  const card = embeds.scout(player, opponent, mySets, scope.sets(theirs), scope.characters(characters), { melee, filters: scope.filters });
  const quick = embeds.withSlippi(card, [player, opponent], profiles);
  if (!verbose) return sendEmbeds(interaction, quick, buttonRow(fullReport('scout', { opponent, melee, since: sinceText, venue })));

  // more of them on top of the same pages, so the quick one shows while it loads. yours is only for
  // meeting them and the odds, so the usual amount is plenty
  const [deeper, characterSets, events, myEvents] = await withCountdown(interaction, t('Full report on its way'), Promise.all([
    setHistories(opponent.playerId, SCOUT_PAGES), characterHistories(opponent.playerId, SCOUT_CHARACTER_PAGES), eventHistory(opponent.userId),
    eventHistory(player.userId).catch(() => null),
  ]), quick);
  const theirSets = scope.sets(deeper);
  const options = { game: melee ? 'Melee' : undefined, eventsA: myEvents && scope.events(myEvents), eventsB: scope.events(events) };
  const { odds, profiles: full } = await oddsWithSlippi(player, opponent, mySets, theirSets, options, ranked, allMelee(melee, theirs, characters));
  const report = embeds.scoutReport(player, opponent, {
    mine: mySets,
    theirs: theirSets,
    characterSets: scope.characters(characterSets),
    events: scope.events(events),
    odds,
    players: state.players,
    melee,
    filters: scope.filters,
  });
  return sendEmbeds(interaction, embeds.withSlippi(report, [player, opponent], full ?? profiles, { odds: Boolean(odds), slippi: Boolean(odds?.slippi) }));
}

async function headToHead(interaction) {
  const picked = await matchup(interaction);
  if (picked) return headToHeadReport(interaction, { ...picked, ...reportOptions(interaction) });
}

async function headToHeadReport(interaction, { player: a, opponent: b, verbose, melee, since, venue, sinceText }) {
  const scope = scoped({ melee, since, venue });
  const ranked = slippiLookup([a, b], melee);
  // meetings for the record, histories and events for one line of /predict odds
  const [sets, historyA, historyB, eventsA, eventsB] = await withCountdown(interaction, t`Finding ${escapeMarkdown(a.tag)} and ${escapeMarkdown(b.tag)}'s meetings and odds`,
    Promise.all([
      h2hHistory(a.playerId, b.playerId),
      setHistory(a.playerId), setHistory(b.playerId),
      eventHistory(a.userId).catch(() => null), eventHistory(b.userId).catch(() => null),
    ]));
  const shown = scope.sets(sets);
  // every meeting in scope, so the odds go by the same record the card shows
  const options = { game: melee ? 'Melee' : undefined, eventsA: scope.events(eventsA), eventsB: scope.events(eventsB), meetings: shown };
  const { odds, profiles } = melee
    ? await oddsWithSlippi(a, b, scope.anyGame(historyA), scope.anyGame(historyB), options, ranked, true)
    : { odds: predictOdds(a, b, scope.anyGame(historyA), scope.anyGame(historyB), options), profiles: null };
  // never having played, the full report would say the same thing. the odds stay one line in both,
  // run /predict for the reasoning behind them. a button press gets no second press
  const buttons = buttonRow(!verbose && shown.length && !interaction.isButton?.() && fullReport('h2h', { player: a, opponent: b, melee, since: sinceText, venue }));
  const cards = embeds.headToHead(a, b, shown, { verbose, melee, otherGames: sets.length - scope.only(sets).length, odds, filters: scope.filters });
  return sendEmbeds(interaction, embeds.withSlippi(cards, [a, b], profiles, { odds: Boolean(odds), slippi: Boolean(odds?.slippi) }), buttons);
}

async function stats(interaction) {
  // before the player, since a typed link gets looked up after the defer, and this answers privately
  const filters = filterOptions(interaction);
  if (filters.error) return replyEphemeral(interaction, filters.error);
  const player = await statPlayer(interaction);
  if (!player) return null;

  if (!interaction.deferred) await interaction.deferReply();
  return statsReport(interaction, { player, ...reportOptions(interaction), ...filters });
}

async function statsReport(interaction, { player, verbose, melee, since, venue, sinceText }) {
  const scope = scoped({ melee, since, venue });
  const ranked = slippiLookup([player], melee);
  const { standings, sets } = await statsHistory(player.playerId, { videogameId: melee ? startgg.MELEE : undefined, since, venue });
  const profiles = await ranked(allMelee(melee, standings, sets));
  const placings = scope.events(standings);
  const played = scope.sets(sets);
  const [recent] = embeds.withSlippi([embeds.stats(player, placings, played, { melee, filters: scope.filters })], [player], profiles);
  if (!verbose) {
    // nothing recent on start.gg means nothing older either
    const more = placings.length || played.length ? buttonRow(fullReport('stats', { player, melee, since: sinceText, venue })) : [];
    return sendEmbeds(interaction, [recent], more);
  }
  // show the recent card while the lifetime report loads
  const [events, history] = await withCountdown(interaction, t('Lifetime report on its way'),
    Promise.all([eventHistory(player.userId), lifetimeHistory(player.playerId)]), [recent]);
  const lifetime = embeds.lifetimeStats(player, scope.events(events), scope.sets(history), state.players, { melee, filters: scope.filters });
  return sendEmbeds(interaction, embeds.withSlippi(lifetime, [player], profiles));
}

async function doubles(interaction) {
  const player = await statPlayer(interaction);
  if (!player) return null;

  if (!interaction.deferred) await interaction.deferReply();
  return doublesReport(interaction, { player, ...reportOptions(interaction) });
}

// the short window's sets, then the events they came from, which is how doubles placements get found.
// Slippi ranked is singles, so melee only filters
async function doublesLookup(player, { verbose, melee }) {
  const only = onlyMelee(melee);
  const all = only(await doublesHistory(player.playerId, { verbose, melee }));
  const sets = verbose ? all : all.slice(0, DOUBLES_SETS);
  const events = await doublesEvents(player, [...new Set(sets.map((set) => set.event.id).filter(Boolean))]);
  return { sets, events };
}

async function doublesReport(interaction, { player, verbose, melee }) {
  const doing = t`Going through ${escapeMarkdown(player.tag)}'s doubles`;
  const recent = await withCountdown(interaction, doing, doublesLookup(player, { verbose: false, melee }));
  const quick = embeds.doubles(player, recent.sets, recent.events, { melee });
  if (!verbose) {
    // nothing recent on start.gg means nothing older either
    const more = recent.sets.length || recent.events.length ? buttonRow(fullReport('doubles', { player, melee })) : [];
    return sendEmbeds(interaction, [quick], more);
  }
  // the short card shows while the rest loads
  const full = await withCountdown(interaction, t('Full doubles report on its way'), doublesLookup(player, { verbose, melee }), [quick]);
  return sendEmbeds(interaction, embeds.doublesReport(player, full.sets, full.events, { melee }));
}

async function characters(interaction) {
  const player = await statPlayer(interaction);
  if (!player) return null;

  if (!interaction.deferred) await interaction.deferReply();
  return charactersReport(interaction, { player, verbose: flag(interaction, 'verbose'), game: interaction.options.getInteger('game') });
}

// game is the one picked, null for whichever has more reported
async function charactersReport(interaction, { player, verbose, game: picked }) {
  let sets = await withCountdown(interaction, t`Going through ${escapeMarkdown(player.tag)}'s reported characters`, characterHistory(player.playerId));
  if (verbose) {
    // every game is the same pages and more, so the usual card shows while it loads
    const usual = characterCards(sets, false, picked).cards
      .map(({ game, usage }) => embeds.characters(player, usage, { game: game?.displayName, searched: sets.length }));
    sets = await withCountdown(interaction, t('Every game on its way'), lifetimeCharacterHistory(player.playerId), usual);
  }
  const { cards, note } = characterCards(sets, verbose, picked);

  // ranked characters go on the melee card, which can have them when TOs reported nothing
  const ranked = cards.some(({ game }) => game?.id === startgg.MELEE) ? await slippiFor(player) : null;
  // no picture beats no reply
  const art = await Promise.all(cards.map(({ game, usage }) => (game && usage.characters.length
    ? startgg.getCharacterArt(usage.characters[0].name, game.id).catch(() => null)
    : null)));
  const shown = cards.map(({ game, usage }, i) => {
    const card = embeds.characters(player, usage, { game: game?.displayName, file: art[i]?.name, note: i === cards.length - 1 ? note : undefined, searched: sets.length });
    return game?.id === startgg.MELEE ? embeds.withRankedCharacters(card, ranked) : card;
  });
  // the files replace the art when a button swaps in the full report
  await sendEmbeds(interaction, shown, verbose ? [] : buttonRow(fullReport('characters', { player, game: picked })), art.filter(Boolean));
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
  const shown = unreported.length > 4 ? [...unreported.slice(0, 3), t`${unreported.length - 3} other games`] : unreported;
  const list = listOf(shown);
  return { cards, note: shown.length ? t`No characters reported for ${list}` : undefined };
}

// nothing to predict with: without melee that means no game in common. with it, name whoever is missing
// Melee and point at the game the odds do work for, since the old pair wording read like both were missing it.
// the hint goes by the filters without the melee one, since melee-only histories never share another game
function noOdds(a, b, historyA, historyB, melee, filters = {}, hintA = historyA, hintB = historyB) {
  const [tagA, tagB] = [escapeMarkdown(a.tag), escapeMarkdown(b.tag)];
  const filtered = Boolean(filters.since || filters.venue);
  if (!melee) {
    return filtered
      ? t`${tagA} and ${tagB} haven't played singles in the same game on start.gg matching those filters.`
      : t`${tagA} and ${tagB} haven't played singles in the same game on start.gg.`;
  }

  const missing = [a, b].filter((player, i) => !gameSets(i ? historyB : historyA, player, 'Melee').length).map((player) => escapeMarkdown(player.tag));
  let none;
  if (missing.length === 2) {
    none = filtered
      ? t`Neither ${tagA} nor ${tagB} has played Melee singles on start.gg matching those filters.`
      : t`Neither ${tagA} nor ${tagB} has played Melee singles on start.gg.`;
  } else {
    none = filtered ? t`${missing[0]} hasn't played Melee singles on start.gg matching those filters.` : t`${missing[0]} hasn't played Melee singles on start.gg.`;
  }
  // the game predict would pick without melee, which leaves out DQs, so leaving melee out really gives odds there
  const shared = sharedGame(a, b, hintA, hintB);
  const hint = shared ? t`\n-# Leave out \`melee\` for ${escapeMarkdown(shared)} odds` : '';
  return `${none}${hint}`;
}

// verbose explains the same odds instead of changing them
async function predict(interaction) {
  const picked = await matchup(interaction);
  if (picked) return predictReport(interaction, { ...picked, ...reportOptions(interaction) });
}

// meetings go back past the histories, usually in one request, so head-to-head matches /h2h.
// events say how big each bracket was, which helps seeding count. null when the lookup
// failed, and the odds still work without events. doing is the countdown line
async function oddsFor(interaction, a, b, { melee, since, venue, doing }) {
  const scope = scoped({ melee, since, venue });
  const ranked = slippiLookup([a, b], melee);
  const [historyA, historyB, meetings, eventsA, eventsB] = await withCountdown(interaction, doing,
    Promise.all([
      setHistory(a.playerId), setHistory(b.playerId), h2hHistory(a.playerId, b.playerId).catch(() => []),
      eventHistory(a.userId).catch(() => null), eventHistory(b.userId).catch(() => null),
    ]));
  // the no-odds wording picks its own game out of these too
  const scopedA = scope.anyGame(historyA);
  const scopedB = scope.anyGame(historyB);
  const options = { game: melee ? 'Melee' : undefined, eventsA: scope.events(eventsA), eventsB: scope.events(eventsB), meetings: scope.sets(meetings) };
  const found = melee
    ? await oddsWithSlippi(a, b, scopedA, scopedB, options, ranked, true)
    : { odds: predictOdds(a, b, scopedA, scopedB, options), profiles: null };
  return { ...found, filters: scope.filters, scopedA, scopedB, historyA, historyB };
}

// nothing to predict with: says why, with their slippi ranks when they have them
async function noPredictions(interaction, a, b, { melee, filters, profiles, scopedA, scopedB, historyA, historyB }) {
  const ranks = embeds.slippiMatchup([a, b], profiles);
  const hinted = noOdds(a, b, scopedA, scopedB, melee, filters, scopeSets(filters)(historyA), scopeSets(filters)(historyB));
  await interaction.editReply(ranks.length ? { content: hinted, embeds: ranks, files: [slippiLogo], allowedMentions: { parse: [] } } : { content: hinted, allowedMentions: { parse: [] } });
  return null;
}

// verbose is the full breakdown: how much each part counts, with bars, and how sure the odds are
async function predictReport(interaction, { player: a, opponent: b, verbose, melee, since, venue, sinceText }) {
  const tags = [escapeMarkdown(a.tag), escapeMarkdown(b.tag)];
  const doing = verbose ? t`Going through ${tags[0]} and ${tags[1]}'s sets for the full breakdown` : t`Going through ${tags[0]} and ${tags[1]}'s sets`;
  const { odds, profiles, filters, ...rest } = await oddsFor(interaction, a, b, { melee, since, venue, doing });
  // netplay players can have a rank without a melee set on start.gg, which is when it says the most
  if (!odds) return noPredictions(interaction, a, b, { melee, filters, profiles, ...rest });

  const more = verbose ? [] : buttonRow(fullReport('predict', { player: a, opponent: b, melee, since: sinceText, venue }));
  await sendEmbeds(interaction, embeds.withSlippi(embeds.prediction(a, b, odds, verbose, { ...filters, melee }), [a, b], profiles, { odds: true, slippi: Boolean(odds.slippi) }), more);
}


// long-press someone in the server, then Apps. nothing to type, which is the point on a phone. checks the
// member before deferring, and goes by the start.gg with their discord connected. null when it answered
async function memberPlayer(interaction, { defer }) {
  const target = interaction.targetUser;
  if (target.bot) {
    await replyEphemeral(interaction, t('Bots don\'t have start.gg accounts.'));
    return null;
  }
  if (target.id === interaction.user.id) {
    await replyEphemeral(interaction, t('Pick someone else. `/stats` is the one about you.'));
    return null;
  }
  await defer();
  const known = linkedPlayer(target.id);
  // findAccount checks start.gg still has their discord connected, but has no player id
  const account = known ? null : await findAccount(target.id);
  const player = known ?? (account && await startgg.getPlayer(account.slug));
  if (player) {
    rememberPick(interaction.user.id, player.userId);
    return player;
  }
  const name = escapeMarkdown(interaction.targetMember?.displayName ?? target.displayName);
  // a name can spell out a role mention, so mentions are off
  await interaction.editReply({
    content: t`Couldn't find a start.gg with ${name}'s Discord connected.\n-# Ask them to run \`/link\` with their start.gg link once, or to register for a tournament the bot checks. start.gg can't be searched by Discord`,
    allowedMentions: { parse: [] },
  });
  return null;
}

// Apps > H2H with me, the same as /h2h with them as the opponent
async function memberHeadToHead(interaction) {
  const player = linkedPlayer(interaction.user.id);
  if (!player) return replyEphemeral(interaction, t('Run `/link` with your start.gg first, so the bot knows which one is yours.'));
  const opponent = await memberPlayer(interaction, { defer: () => interaction.deferReply() });
  if (!opponent) return;
  if (opponent.userId === player.userId) return interaction.editReply(t('That\'s your own start.gg.'));
  return headToHeadReport(interaction, { player, opponent, verbose: false, melee: false });
}

// Apps > Scout them, the same as /scout on them. just for whoever asked, like /scout
async function memberScout(interaction) {
  const opponent = await memberPlayer(interaction, { defer: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }) });
  if (!opponent) return;
  const player = await verifiedCaller(interaction.user.id);
  if (!player) return interaction.editReply(t(NOT_LINKED));
  if (player.playerId === opponent.playerId) return interaction.editReply(t('That\'s your own start.gg.'));
  return scoutReport(interaction, { player, opponent, verbose: false, melee: false });
}

// what each report button runs. /progress has no button anymore, but older messages in the channel still do
const reports = {
  progress: progressReport, scout: scoutReport, h2h: headToHeadReport, stats: statsReport, doubles: doublesReport, characters: charactersReport, predict: predictReport,
};

export { progress, scout, headToHead, stats, doubles, characters, predict, memberHeadToHead, memberScout, reports, NOT_LINKED };
