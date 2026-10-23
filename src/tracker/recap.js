import * as startgg from '../startgg.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { periodSummary, weeklyPeriod } from '../reports.js';
import { messageEnabled, messageSettings } from '../message-settings.js';
import { currentChannel, secondsNow } from './shared.js';

export async function postWeeklyRecap(postChannel = currentChannel(), now = secondsNow()) {
  const period = weeklyPeriod(now, messageSettings());
  // turning it back on or changing the schedule waits for the next recap instead of sending an overdue one
  const canPost = () => messageEnabled('recap', period.until) && period.until > (messageSettings().recapChangedAt ?? 0);
  if (!period || !canPost() || (state.weeklyRecap?.until === period.until && state.weeklyRecap.done)) return;
  // built once and saved, so a restart partway through sends the rest instead of starting over
  if (state.weeklyRecap?.until !== period.until) {
    const crew = [];
    const players = Object.values(state.players);
    // most of a big tracked list didn't play that week, and one request rules out 50 of them
    const played = await startgg.getActivePlayers(players.map((player) => player.playerId), period.since);
    for (const player of players) {
      if (!played.has(player.playerId)) continue;
      const sets = await startgg.getPeriodHistory(player.playerId, period.since, period.until);
      const summary = periodSummary(player, sets, [], period.since, period.until);
      // only people with a set that wasn't a DQ
      if (!summary.played.length) continue;
      // placements from events they played in this week, including ones that started the week before
      const events = await startgg.getEventHistory(player.userId);
      const playedEvents = new Set(summary.played.map(({ set }) => set.event.slug));
      summary.finishes = events.filter(({ event, dq }) => !dq && playedEvents.has(event.slug));
      // removed while this was running
      if (state.players[player.userId]) crew.push({ player, summary });
    }
    crew.sort((a, b) => a.player.tag.localeCompare(b.player.tag));
    if (!canPost()) return;

    const active = new Set(crew.map(({ player }) => player.userId));
    const upcoming = [];
    for (const tournament of Object.values(state.tournaments)) {
      if (tournament.startAt < now || tournament.startAt >= period.next) continue;
      const going = [...new Set(tournament.entries.map((entry) => entry.userId))].filter((id) => active.has(id));
      if (going.length) upcoming.push({ tournament, players: going.map((id) => state.players[id]) });
    }
    upcoming.sort((a, b) => a.tournament.startAt - b.tournament.startAt);
    const batches = crew.length ? embeds.messages(embeds.weeklyRecap(crew, upcoming, period)) : [];
    state.weeklyRecap = { until: period.until, sent: 0, done: false, batches: batches.map((batch) => batch.map((embed) => embed.toJSON())) };
    save();
  }
  for (let i = state.weeklyRecap.sent; i < state.weeklyRecap.batches.length; i++) {
    if (!canPost()) return;
    await postChannel.send({ embeds: state.weeklyRecap.batches[i], allowedMentions: { parse: [] } });
    state.weeklyRecap.sent = i + 1;
    save();
  }
  state.weeklyRecap.done = true;
  delete state.weeklyRecap.batches;
  save();
}
