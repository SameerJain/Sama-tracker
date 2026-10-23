import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { messageEnabled, setResultColors } from '../message-settings.js';
import { MAJOR_UPSET, scoreText, upsetFactor } from '../embeds/shared.js';
import {
  currentChannel, secondsNow, health, post, postRefs, editPost, named, trackedLive, eventsOf, resultsOn, CATCH_UP_HOURS,
  RESULT_WATCH_MINUTES, HOUR,
} from './shared.js';
import { tournamentPosts } from './threads.js';

// singles only, DQs left out, the same major upsets as set result cards. the winner has to be tracked,
// the loser can be anyone tracked or not, so tracked vs tracked still shows as the winner's upset
function recordNotableUpset(set) {
  if (set.sides.some((side) => side.playerIds.length !== 1)) return;
  const [a, b] = set.sides;
  const winner = a.id === set.winnerId ? a : b.id === set.winnerId ? b : null;
  if (!winner) return;
  const loser = winner === a ? b : a;
  if (scoreText(winner, loser) === 'DQ') return;
  const factor = upsetFactor(winner, loser);
  if (factor < MAJOR_UPSET) return;
  const winnerPlayer = Object.values(state.players).find((player) => winner.playerIds.includes(player.playerId));
  if (!winnerPlayer) return;
  const tournament = Object.values(state.tournaments).find((each) => each.slug === set.event?.tournament?.slug);
  if (!tournament) return;
  const loserPlayer = Object.values(state.players).find((player) => loser.playerIds.includes(player.playerId));
  tournament.notableUpsets ??= [];
  if (tournament.notableUpsets.some((upset) => upset.setId === set.id)) return;
  tournament.notableUpsets.push({
    setId: set.id, winnerUserId: winnerPlayer.userId, winnerName: winner.name, winnerSeed: winner.seed,
    loserUserId: loserPlayer?.userId ?? null, loserName: loser.name, loserSeed: loser.seed,
    winnerScore: winner.score, loserScore: loser.score, eventSlug: set.event.slug, round: set.round, factor,
  });
  // rare and small, so a short cap keeps old state files small
  tournament.notableUpsets = tournament.notableUpsets.sort((x, y) => y.factor - x.factor).slice(0, 10);
}

export async function postNewSets(postChannel = currentChannel()) {
  const players = Object.values(state.players);
  const playerIds = players.map((player) => player.playerId);
  // only players with results on get asked about, by playerId to when /track posts turned them on
  const showingSince = new Map(players.filter(resultsOn).map((player) => [player.playerId, player.setResultsOnAt ?? 0]));
  const checkedAt = secondsNow();
  // one request for everyone, so go from the oldest lastCheck
  const lastCheck = Math.min(checkedAt, ...players.map((player) => player.lastCheck));
  const since = Math.max(lastCheck, checkedAt - CATCH_UP_HOURS * HOUR);
  try {
    const sets = new Map();
    // when each set's check window started, so an old set an edit brought back stays out
    const windows = new Map();
    // 2 min overlap for sets reported during the last check
    for (const set of await startgg.getSets([...showingSince.keys()], { since: since - 120 })) {
      sets.set(set.id, set);
      windows.set(set.id, since);
    }
    // every set at a tracked tournament, whoever played, from that tournament's own last check
    const covered = new Set();
    const checked = [];
    for (const tournament of trackedLive('sets', checkedAt)) {
      const from = Math.max(tournament.lastCheck ?? checkedAt, checkedAt - CATCH_UP_HOURS * HOUR);
      const eventIds = [...new Set(eventsOf(tournament).map((entry) => entry.eventId).filter(Boolean))];
      try {
        for (const set of await startgg.getEventSets(eventIds, from - 120)) {
          sets.set(set.id, set);
          covered.add(set.id);
          windows.set(set.id, Math.min(windows.get(set.id) ?? Infinity, from));
        }
        checked.push(tournament);
      } catch (err) {
        console.error(`checking sets at ${named(tournament)} failed:`, err.message);
      }
    }

    for (const set of [...sets.values()].sort((a, b) => a.completedAt - b.completedAt)) {
      // for /recent all. results-off players only get it from a set against someone with them on
      for (const player of players) {
        if (!set.sides.some((side) => side.playerIds.includes(player.playerId))) continue;
        // edits bring back old sets
        player.lastSetAt = Math.max(player.lastSetAt ?? 0, set.completedAt);
      }
      recordNotableUpset(set);
      if (state.posted.includes(set.id)) continue;
      // editing an old set brings it back
      if (set.completedAt < windows.get(set.id) - HOUR) continue;
      // one DQ takes them out of the rest of the bracket, so only post the first. DQ wins never get posted,
      // and neither do no-shows at a tracked tournament unless they're tracked
      const dqed = set.sides.find((side) => side.score === -1);
      if (dqed && (!dqed.playerIds.some((id) => playerIds.includes(id)) || state.dqs.includes(dqed.id))) continue;

      // every set at a tracked tournament. otherwise one finished before /track posts turned results on for
      // everyone tracked in it stays out of the channel. it still counts as posted so the next check doesn't look at it again
      const resultsWereOn = set.sides.some((side) => side.playerIds.some((id) => set.completedAt >= (showingSince.get(id) ?? Infinity)));
      if ((covered.has(set.id) || resultsWereOn) && messageEnabled('sets', set.completedAt)) {
        // no head to head button, the set's over
        const card = embeds.setResult(set, state.players, { setColors: setResultColors() });
        watchResult(await tournamentPosts(set, postChannel).send({ embeds: embeds.withImage([card]) }), set);
      }
      state.posted.push(set.id);
      if (dqed) state.dqs.push(dqed.id);
      // saved per set so a crash after the post doesn't post it again on restart
      save();
    }
    // only on success so a failed check gets covered next time
    for (const player of players) player.lastCheck = checkedAt;
    for (const tournament of checked) tournament.lastCheck = checkedAt;
    health.setCheck = checkedAt;
    health.setError = null;
  } catch (err) {
    console.error('checking sets failed:', err.message);
    health.setError = err.message;
  }

  state.posted = state.posted.slice(-1000);
  state.dqs = state.dqs.slice(-200);
  save();
}

// saved so fixCorrectedResults can find the card again. start.gg's preview sets have ids like preview_1_2
// that can't be looked up
function watchResult(message, set) {
  if (!message?.id || !/^\d+$/.test(set.id)) return;
  const [ref] = postRefs([message]);
  state.resultPosts.push({ setId: set.id, ...ref, at: secondsNow(), outcome: startgg.outcomeOf(set), reset: false });
  state.resultPosts = state.resultPosts.slice(-200);
}

// set results from the last hour whose winner or score the TO changed get the corrected card, and ones the TO
// reset or deleted get marked. one small request covers all of them, and only a changed set is asked for in full
export async function fixCorrectedResults(postChannel = currentChannel()) {
  const now = secondsNow();
  const before = state.resultPosts.length;
  state.resultPosts = state.resultPosts.filter((each) => each.at > now - RESULT_WATCH_MINUTES * 60);
  const watching = state.resultPosts;
  if (!watching.length) {
    // expired posts were dropped, so save so they don't come back on restart
    if (state.resultPosts.length !== before) save();
    return;
  }
  try {
    const outcomes = await startgg.getSetOutcomes([...new Set(watching.map((each) => each.setId))]);
    // a reset set reported again with the same result still needs its card put back
    const changed = watching.filter((each) => {
      const latest = outcomes.get(each.setId);
      return latest?.state === 3 && (each.reset || latest.outcome !== each.outcome);
    });
    const sets = changed.length ? await startgg.getSetsById([...new Set(changed.map((each) => each.setId))]) : new Map();
    for (const each of watching) {
      let kept = true;
      if (changed.includes(each)) {
        const set = sets.get(each.setId);
        // reset again between the two requests, the next check sorts it out
        if (set?.state !== 3) continue;
        const card = embeds.correctedResult(set, state.players, { setColors: setResultColors() });
        kept = await editPost(postChannel, each, { embeds: embeds.withImage([card]) });
        Object.assign(each, { outcome: startgg.outcomeOf(set), reset: false });
      } else if (outcomes.get(each.setId)?.state !== 3 && !each.reset) {
        // start.gg doesn't have the result anymore, so the card stays as it was with the result marked
        kept = await editPost(postChannel, each, (message) => ({ embeds: message.embeds.slice(0, 1).map(embeds.resetResult) }));
        each.reset = true;
      }
      if (!kept) state.resultPosts = state.resultPosts.filter((other) => other !== each);
    }
  } catch (err) {
    console.error('checking posted set results for fixes failed:', err.message);
  }
  save();
}
