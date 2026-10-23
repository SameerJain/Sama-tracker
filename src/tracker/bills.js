import * as bills from '../bills.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { messageEnabled } from '../message-settings.js';
import {
  currentChannel, secondsNow, health, BILLS_BASELINE_HOURS, BILLS_GAMEDAY_MINUTES, BILLS_PREGAME_HOURS, BILLS_POSTGAME_HOURS, HOUR,
} from './shared.js';

// 15 minutes from an hour before kickoff until 8 hours after, daily otherwise.
// a live game keeps its kickoff as the next date until it's final, so the tight
// polling covers the whole game plus any OT or ESPN delay
export function billsDelay(nextDate, now = secondsNow()) {
  if (nextDate != null && now >= nextDate - BILLS_PREGAME_HOURS * HOUR && now <= nextDate + BILLS_POSTGAME_HOURS * HOUR) {
    return BILLS_GAMEDAY_MINUTES * 60 * 1000;
  }
  return BILLS_BASELINE_HOURS * HOUR * 1000;
}

// Bills finals, one request for the schedule and one per new final for quarters
// and yards. off by default, and anything final while it was off stays skipped.
// returns when to check again so the loop stays daily except near kickoff
export async function postBillsResults(postChannel = currentChannel()) {
  const checkedAt = secondsNow();
  try {
    const { finals, nextDate } = await bills.getScheduleState();
    finals.sort((a, b) => a.date - b.date);
    for (const game of finals) {
      if (state.billsPosted.includes(game.id)) continue;
      if (messageEnabled('bills', game.date)) {
        let details = null;
        try {
          details = await bills.getDetails(game.id);
        } catch (err) {
          console.error(`bills details for ${game.id} failed:`, err.message);
        }
        await postChannel.send({ embeds: embeds.withImage([embeds.billsFinal(game, details)]), allowedMentions: { parse: [] } });
      }
      state.billsPosted.push(game.id);
      save();
    }
    state.billsPosted = state.billsPosted.slice(-50);
    health.billsCheck = checkedAt;
    health.billsError = null;
    save();
    return billsDelay(nextDate, checkedAt);
  } catch (err) {
    console.error('checking Bills finals failed:', err.message);
    health.billsError = err.message;
  }
  save();
  return BILLS_BASELINE_HOURS * HOUR * 1000;
}
