import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { t } from '../i18n.js';
import { state, save } from '../store.js';
import { messageEnabled, postsOn } from '../message-settings.js';
import { rememberAccounts, serverMembers } from '../accounts.js';
import { cantMakeEvents, ensureDiscordEvent } from '../discord-events.js';
import {
  currentChannel, secondsNow, health, post, postRefs, editPost, posting, named, crewOf, crewIds, endTime, overAt, eventsOf, shouldForgetTournament,
  ROLL_CALL_MIN_PLAYERS, ROLL_CALL_HOURS_BEFORE, RESULTS_WAIT_HOURS, FULLY_REPORTED_WAIT_HOURS, TOP8_RETRY_HOURS, FAR_OFF_CHECK_HOURS,
  PROJECTED_KEPT_DAYS, HOUR, DAY,
} from './shared.js';
import { unpinFinishedThreads, unpinTournamentThread } from './threads.js';

// with /t-o settings events on, each upcoming tracked tournament gets a discord event, once. state.discordEvents keeps
// it either way, so an event a mod deleted stays deleted. no due time like the posts, since turning it on is
// asking for events at the tournaments already coming up
export async function makeTournamentEvents(guild = currentChannel()?.guild) {
  if (!messageEnabled('events')) return;
  const waiting = Object.values(state.tournaments)
    .filter((tournament) => tournament.tracked && !state.discordEvents[tournament.id] && tournament.startAt > secondsNow());
  // the switch checks the permission when it's turned on, this catches it being taken away after
  if (!waiting.length || cantMakeEvents(guild)) return;
  for (const tournament of waiting) {
    try {
      // the description wants the close time and the events, which the saved tournament doesn't have
      const found = await startgg.getRegistrationById(tournament.id);
      if (!found || !(found.startAt > secondsNow())) continue;
      const { error } = await ensureDiscordEvent(found, guild);
      if (error) console.error(`discord event for ${named(tournament)}: ${error}`);
    } catch (err) {
      console.error(`discord event for ${named(tournament)} failed:`, err.message);
    }
  }
  save();
}

// a tracked tournament's crew is everyone registered who's tracked, or has the discord on their start.gg in this
// server. the ones who aren't tracked get saved with their tag so the roll call and placements can name them.
// tracked players it finds go in userIds, in case their own upcoming list missed it. a hidden list, or start.gg or
// discord failing, keeps whoever it had
export async function refreshCrew(tournament, guild = currentChannel()?.guild) {
  try {
    const participants = await startgg.getParticipants(tournament.id);
    rememberAccounts(participants);
    if (!participants.length) return;
    const members = await serverMembers(guild, [...new Set(participants.map((participant) => participant.discordId).filter(Boolean))]);
    const crew = {};
    for (const { userId, slug, tag, discordId } of participants) {
      if (!userId) continue;
      if (state.players[userId]) {
        if (!tournament.userIds.some((id) => String(id) === String(userId))) tournament.userIds.push(userId);
      } else if (slug && members.has(discordId)) {
        crew[userId] = { userId, slug, tag };
      }
    }
    tournament.crew = crew;
  } catch (err) {
    console.error(`finding the crew at ${named(tournament)} failed:`, err.message);
  }
}

// done with it: its thread card comes down and it's dropped
async function forget(tournament) {
  await unpinTournamentThread(currentChannel(), tournament);
  delete state.tournaments[tournament.id];
}

export async function updateTournaments() {
  const tracked = Object.values(state.players).map((player) => player.userId);

  try {
    for (const [userId, tournaments] of await startgg.getUpcomingTournaments(tracked)) {
      for (const found of tournaments) {
        // bad end dates make old tournaments show up as upcoming
        if (secondsNow() > endTime(found)) continue;
        const tournament = state.tournaments[found.id] ??= { ...found, entries: [], userIds: [] };
        // someone new signed up, so it gets looked at now even if it's far off
        if (!tournament.userIds.includes(userId)) {
          tournament.userIds.push(userId);
          tournament.checkedAt = 0;
        }
      }
    }
  } catch (err) {
    console.error('finding tournaments failed:', err.message);
  }
  await makeTournamentEvents().catch((err) => console.error('making discord events failed:', err.message));

  for (const tournament of Object.values(state.tournaments)) {
    if (tournament.resultsPosted) {
      // keep it a week, otherwise it gets re-added and the results post again
      if (secondsNow() > endTime(tournament) + 7 * DAY) {
        await forget(tournament);
        continue;
      }
      if (tournament.projected) {
        await correctPlacements(tournament).catch((err) => console.error(`correcting placements for ${named(tournament)} failed:`, err.message));
      }
      if (tournament.top8Failed) {
        await verifyTopEight(tournament).catch((err) => console.error(`verifying the top 8 for ${named(tournament)} failed:`, err.message));
      }
      continue;
    }
    if (shouldForgetTournament(tournament)) {
      await forget(tournament);
      continue;
    }
    const farOff = tournament.startAt - secondsNow() > DAY;
    if (farOff && secondsNow() - (tournament.checkedAt ?? 0) < FAR_OFF_CHECK_HOURS * HOUR) continue;
    // only waiting on results now, so hourly is plenty
    if (secondsNow() > overAt(tournament) && secondsNow() - (tournament.checkedAt ?? 0) < HOUR) continue;

    try {
      // only the crew who signed up. everyone at every tournament gets slow. nobody signs up once it's over,
      // so the hourly checks for placements after that keep the crew they had
      if (tournament.tracked && secondsNow() <= endTime(tournament)) await refreshCrew(tournament);
      const latest = await startgg.getTournament(tournament.id, crewIds(tournament));
      // deleted or unpublished
      if (!latest) {
        await forget(tournament);
        continue;
      }
      Object.assign(tournament, latest, { checkedAt: secondsNow() });
      await postRollCall(tournament);
    } catch (err) {
      console.error(`updating ${named(tournament)} failed:`, err.message);
    }
    // even if the lookup failed, so a tournament start.gg keeps erroring on still gets results from the last good check
    try {
      await postResults(tournament);
    } catch (err) {
      console.error(`posting results for ${named(tournament)} failed:`, err.message);
    }
  }

  await unpinFinishedThreads().catch((err) => console.error('unpinning finished tournament threads failed:', err.message));
  health.tournamentCheck = secondsNow();
  save();
}

export async function postRollCall(tournament, postChannel = currentChannel()) {
  if (tournament.rollCallPosted) return;

  const dueAt = tournament.startAt - ROLL_CALL_HOURS_BEFORE * HOUR;
  if (secondsNow() >= tournament.startAt || secondsNow() < dueAt) return;

  // people, not entries. a late sign-up can still trigger it
  const entered = new Set(tournament.entries.map((entry) => entry.userId));
  if (entered.size < ROLL_CALL_MIN_PLAYERS) return;

  if (messageEnabled('rollcall', dueAt)) {
    // the streams on its start.gg page, since the roll call is when people start looking for them. failing leaves them out
    let streams = [];
    if (tournament.id) {
      try {
        streams = (await startgg.getTournamentStreams([tournament.id])).get(String(tournament.id)) ?? [];
      } catch (err) {
        console.error(`streams for ${named(tournament)}'s roll call failed:`, err.message);
      }
    }
    await post(embeds.rollCall(tournament, crewOf(tournament), streams), 'rollcall', dueAt, postChannel);
  }
  tournament.rollCallPosted = true;
}

// the placements, unless results are switched off. the messages that went out, to edit if they were projected
async function postPlacements(tournament, entries, dueAt, postChannel) {
  if (!messageEnabled('results', dueAt)) return [];
  return post(embeds.results({ ...tournament, entries }, crewOf(tournament)), 'results', dueAt, postChannel);
}

// a top 8 discord fails on gets marked for verifyTopEight to retry hourly. the messages that went out
async function sendTopEight(tournament, events, dueAt, postChannel, now) {
  try {
    const sent = await post(embeds.topEight(tournament, events), 'top8', dueAt, postChannel, tournament);
    tournament.top8Posted = true;
    return sent;
  } catch (err) {
    console.error(`posting the top 8 for ${named(tournament)} failed:`, err.message);
    tournament.top8Failed = true;
    tournament.top8FailedAt ??= now;
    return [];
  }
}

export async function postResults(tournament, postChannel = currentChannel()) {
  if (tournament.resultsPosted) return;
  const now = secondsNow();
  if (now < tournament.startAt) return;

  const scope = eventsOf(tournament);
  if (scope.length && scope.every((entry) => entry.done)) tournament.doneAt ??= now;
  // tracked tournaments post results and top 8 together as soon as every event is finished
  const topEightOn = posting(tournament, 'top8');
  if (tournament.tracked && await postFinishedResults(tournament, postChannel, now, topEightOn)) return;

  const waited = now - overAt(tournament);
  if (waited < RESULTS_WAIT_HOURS * HOUR) return;

  // events that never started have nothing to wait for or show
  const entries = tournament.entries.filter((entry) => entry.started);
  // anyone still in when the TO stopped reporting only has a projected placement
  const allIn = entries.every(placed);

  const dueAt = overAt(tournament) + RESULTS_WAIT_HOURS * HOUR;
  // fetched before anything posts, so a start.gg error retries both next hour instead of repeating placements.
  // skipped when the top 8 already went out early
  let events = [];
  if (!tournament.top8Posted && topEightOn && postsOn('top8', tournament, dueAt)) {
    try {
      events = await topEightEvents(scope.filter((entry) => entry.started));
    } catch (err) {
      if (now < dueAt + TOP8_RETRY_HOURS * HOUR) throw err;
      console.error(`top 8 for ${named(tournament)} failed, posting placements without it:`, err.message);
    }
  }
  const results = await postPlacements(tournament, entries, dueAt, postChannel);
  // marked before the top 8 goes, so discord failing on it can't post the placements again
  tournament.resultsPosted = true;
  let topEight = [];
  if (!tournament.top8Posted && events.length) {
    topEight = await sendTopEight(tournament, events, dueAt, postChannel, now);
  } else if (!tournament.top8Posted && (!topEightOn || !postsOn('top8', tournament, dueAt))) {
    // switched off, or not tracked, counts as posted, so the fail-safe doesn't replay it
    tournament.top8Posted = true;
  }
  // projected ones get edited once start.gg has them final, see correctPlacements.
  // a top 8 with nothing reported yet saves with nothing to edit, so the final still goes out
  const projected = {
    at: now,
    results: allIn ? [] : postRefs(results),
    top8: events.every((event) => event.done) ? [] : postRefs(topEight),
  };
  if (projected.results.length || projected.top8.length || !tournament.top8Posted) tournament.projected = projected;
}

// posts results and the top 8 together as soon as every event is finished.
// the results timing does not depend on whether top 8 posts are switched on
async function postFinishedResults(tournament, postChannel, now, topEightOn) {
  const scope = eventsOf(tournament);
  const started = scope.filter((entry) => entry.started);
  if (!started.length) return false;
  // one that hasn't started might still run, like doubles after singles, so it waits for those until the end time
  if (started.length < scope.length && now <= endTime(tournament)) return false;
  let events = [];
  if (!started.every((entry) => entry.done)) {
    // the existing 12-hour fallback must not depend on one more successful start.gg lookup
    if (now - overAt(tournament) >= RESULTS_WAIT_HOURS * HOUR) return false;
    events = await topEightEvents(started);
    const distinct = new Set(started.filter((entry) => entry.eventId).map((entry) => entry.eventId)).size;
    const fullyReported = events.length === distinct
      && events.every((event) => event.standings.length && event.standings.every((standing) => standing.final));
    if (!fullyReported) {
      delete tournament.fullyReportedAt;
      return false;
    }
    tournament.fullyReportedAt ??= Math.min(now, tournament.checkedAt ?? now);
    if (now < tournament.fullyReportedAt + FULLY_REPORTED_WAIT_HOURS * HOUR) return false;
    tournament.doneAt ??= tournament.fullyReportedAt;
  }
  const withTopEight = topEightOn && postsOn('top8', tournament, now);
  if (withTopEight && !events.length) {
    try {
      events = await fetchDoneTopEight(started);
    } catch (err) {
      console.error(`early top 8 for ${named(tournament)} failed:`, err.message);
      return false;
    }
    if (!events) return false;
  }

  const entries = tournament.entries.filter((entry) => entry.started);
  const results = await postPlacements(tournament, entries, now, postChannel);
  tournament.resultsPosted = true;
  // switched off counts as posted, so turning it back on doesn't replay it
  if (withTopEight) await sendTopEight(tournament, events, now, postChannel, now);
  else tournament.top8Posted = true;

  const projectedResults = entries.every(placed) ? [] : postRefs(results);
  if (projectedResults.length || !tournament.top8Posted) tournament.projected = { at: now, results: projectedResults, top8: [] };
  return true;
}

// every event that started, once all of them are finished. null while the bracket
// is still running. the entries gate the fetch, so live tournaments cost nothing extra
async function fetchDoneTopEight(entries) {
  const started = entries.filter((entry) => entry.started);
  if (!started.length) return null;
  const events = await topEightEvents(started);
  // a missing event or an unfinished one means the bracket isn't fully reported yet
  const distinct = new Set(started.filter((entry) => entry.eventId).map((entry) => entry.eventId)).size;
  if (!events.length || events.length < distinct || !events.every((event) => event.done)) return null;
  return events;
}

function stopRetrying(tournament) {
  delete tournament.top8Failed;
  delete tournament.top8FailedAt;
  delete tournament.top8CheckedAt;
}

// fail-safe: a top 8 that failed to send gets retried hourly for 3 days, then gives up.
// only tournaments the new code marked with top8Failed come here, so ones from before the
// flag existed never get a second top 8. true once it went out or there's nothing to retry
export async function verifyTopEight(tournament, postChannel = currentChannel(), now = secondsNow()) {
  if (tournament.top8Posted || !tournament.top8Failed) return true;
  if (now - (tournament.top8CheckedAt ?? 0) < HOUR) return false;
  tournament.top8CheckedAt = now;
  if (now > (tournament.top8FailedAt ?? now) + PROJECTED_KEPT_DAYS * DAY) {
    stopRetrying(tournament);
    return false;
  }
  // switched off since it failed: keep the marker so it retries if switched back on
  if (!posting(tournament, 'top8')) return false;
  try {
    const events = await fetchDoneTopEight(eventsOf(tournament));
    if (!events) return false;
    await post(embeds.topEight(tournament, events), 'top8', now, postChannel, tournament);
  } catch (err) {
    console.error(`retrying the top 8 for ${named(tournament)} failed:`, err.message);
    return false;
  }
  tournament.top8Posted = true;
  stopRetrying(tournament);
  return true;
}

// a placement that won't change: the event's over, or they're out of it
const placed = (entry) => Boolean(entry.placement && (entry.done || entry.final));

// placements that went out projected because the TO stopped reporting get edited once start.gg has every
// one final, looked at hourly for 3 days. the top 8 the same, once its events are finished. a top 8
// with nothing reported at 12 hours goes out as a new message instead, since there's nothing to edit
export async function correctPlacements(tournament, postChannel = currentChannel()) {
  const { projected } = tournament;
  const now = secondsNow();
  if (now > projected.at + PROJECTED_KEPT_DAYS * DAY) {
    delete tournament.projected;
    return;
  }
  if (now - (projected.checkedAt ?? projected.at) < HOUR) return;
  projected.checkedAt = now;

  if (projected.results.length) {
    const latest = await startgg.getTournament(tournament.id, crewIds(tournament));
    const entries = latest?.entries.filter((entry) => entry.started) ?? [];
    if (entries.length && entries.every(placed)) {
      tournament.entries = latest.entries;
      const final = embeds.results({ ...tournament, entries }, crewOf(tournament));
      await editPosts(postChannel, projected.results, final, 'results', t('Final placements, the ones above were projected'), tournament);
      projected.results = [];
    }
  }
  if (projected.top8.length) {
    const events = await topEightEvents(eventsOf(tournament).filter((entry) => entry.started));
    if (events.length && events.every((event) => event.done)) {
      await editPosts(postChannel, projected.top8, embeds.topEight(tournament, events), 'top8', t('Final top 8, the one above was projected'), tournament);
      projected.top8 = [];
    }
  } else if (!tournament.top8Posted && posting(tournament, 'top8')) {
    // nothing went out at 12 hours, so the final goes out as a new message once it's reported.
    // switched off waits for it to come back on instead of replaying later
    const events = await fetchDoneTopEight(eventsOf(tournament));
    if (events) {
      await post(embeds.topEight(tournament, events), 'top8', now, postChannel, tournament);
      tournament.top8Posted = true;
    }
  }
  if (!projected.results.length && !projected.top8.length && tournament.top8Posted) delete tournament.projected;
}

// the final version goes over the projected one. one that no longer splits into the same number of
// messages can't, so it goes out on its own under a line saying what it is
async function editPosts(postChannel, refs, list, type, label, tournament) {
  const batches = embeds.messages(list);
  if (batches.length === refs.length) {
    for (const [i, ref] of refs.entries()) await editPost(postChannel, ref, { embeds: batches[i] });
    return;
  }
  for (const [i, batch] of batches.entries()) {
    if (postsOn(type, tournament)) await postChannel.send({ content: i ? undefined : label, embeds: batch, allowedMentions: { parse: [] } });
  }
}

// every one of these events, with the whole top 8 and not just the crew
async function topEightEvents(entries) {
  const events = [...new Map(entries.filter((entry) => entry.eventId).map((entry) => [entry.eventId, entry])).values()];
  if (!events.length) return [];
  const standings = await startgg.getTopEight(events.map((entry) => entry.eventId));
  return events.filter((entry) => standings.has(entry.eventId)).map((entry) => ({ ...entry, ...standings.get(entry.eventId) }));
}
