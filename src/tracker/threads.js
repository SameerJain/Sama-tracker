import { PermissionFlagsBits, RESTJSONErrorCodes, ThreadAutoArchiveDuration } from 'discord.js';
import * as embeds from '../embeds/index.js';
import { state, save } from '../store.js';
import { messageSettings } from '../message-settings.js';
import {
  currentChannel, health, secondsNow, endTime, trackedFor, THREAD_KEPT_DAYS, THREAD_PERMISSIONS, DAY, RUNS_LATE_HOURS, HOUR,
} from './shared.js';

// the thread permissions the bot is missing in the channel, or null when it can't have threads at all,
// like a voice channel's chat
export function missingThreadPermissions(postChannel = currentChannel()) {
  if (!postChannel?.threads || postChannel.isThread?.()) return null;
  const has = postChannel.permissionsFor(postChannel.client.user);
  return Object.keys(THREAD_PERMISSIONS).filter((name) => !has?.has(PermissionFlagsBits[name])).map((name) => THREAD_PERMISSIONS[name]);
}

// stands in for the channel when posting a set. with /t-o settings threads on it sends to the tournament's
// or the event's thread, and to the channel when the thread can't be used, so a permission change never loses a post.
// a tracked tournament posts every set, so it gets its own thread even with threads off
export function tournamentPosts(set, postChannel) {
  const send = async (message) => {
    // embeds never ping, but a start.gg name in content would, so default mentions off
    message.allowedMentions ??= { parse: [] };
    const setting = messageSettings().threads;
    const mode = setting === 'off' && trackedFor(set) ? 'tournament' : setting;
    if (mode === 'off') return postChannel.send(message);
    const { tournament } = set.event;
    try {
      const sent = await (await tournamentThread(set.event, mode === 'event', postChannel)).send(message);
      health.threadError = null;
      return sent;
    } catch (err) {
      console.error(`posting in the thread for ${tournament.name} failed, posting in the channel:`, err.message);
      health.threadError = err.message;
      return postChannel.send(message);
    }
  };
  return { send };
}

// pinning the starter needs manage messages, but threads work without it so a failed pin just logs
async function pinThreadCard(card, tournament) {
  try {
    await card.pin();
    return true;
  } catch (err) {
    console.error(`pinning the thread starter for ${tournament?.name ?? 'a tournament'} failed:`, err.message);
    return false;
  }
}

// the starter lives in the channel, so unpinning goes through its saved channel and message ids.
// true when there's nothing left to unpin, false to try again next check
async function unpinThreadRef(postChannel, ref) {
  try {
    const { messages } = await postChannel.client.channels.fetch(ref.channelId ?? postChannel.id);
    await messages.unpin(ref.messageId);
    return true;
  } catch (err) {
    if ([RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel].includes(err.code)) return true;
    throw err;
  }
}

// the first post for a tournament, or for an event when byEvent, puts a card with its name in the channel and
// starts the thread on it. saved by slug, since sets don't come with the tournament id, so a restart keeps using
// the same one. event slugs start with their tournament's, so both kinds share state.threads without clashing.
// each thread pins its card so it stays easy to find, and unpinFinishedThreads takes it off once over
async function tournamentThread(event, byEvent, postChannel) {
  const { tournament } = event;
  const slug = byEvent ? event.slug : tournament.slug;
  const saved = state.threads[slug];
  if (saved) {
    // an archived thread opens back up when something's sent in it. a deleted one gets replaced
    const thread = await postChannel.threads.fetch(saved.id).catch((err) => {
      if (err.code === RESTJSONErrorCodes.UnknownChannel) return null;
      throw err;
    });
    if (thread) return thread;
    // its card stays in the channel, so a pinned one comes off before the replacement goes up
    if (saved.pinned && saved.messageId) {
      await unpinThreadRef(postChannel, saved).catch((err) => console.error(`unpinning the old thread starter for ${tournament.name} failed:`, err.message));
    }
  }

  // checked before the card goes out, or every set would leave another card with no thread on it
  const missing = missingThreadPermissions(postChannel);
  if (!missing) throw new Error('threads can\'t be started in this channel');
  if (missing.length) throw new Error(`missing ${missing.join(' and ')}`);

  const card = await postChannel.send({
    embeds: embeds.withImage([byEvent ? embeds.eventThread(event) : embeds.tournamentThread(tournament)]), allowedMentions: { parse: [] },
  });
  const thread = await card.startThread({ name: threadName(event, byEvent), autoArchiveDuration: ThreadAutoArchiveDuration.OneDay });
  const now = secondsNow();
  // forgetting an old thread takes its pin off too, so pins don't outlast the 14 days
  for (const [oldSlug, old] of Object.entries(state.threads)) {
    if (old.at <= now - THREAD_KEPT_DAYS * DAY && old.pinned && old.messageId) {
      await unpinThreadRef(postChannel, old).catch((err) => console.error('unpinning an old thread starter failed:', err.message));
    }
  }
  state.threads = Object.fromEntries(Object.entries(state.threads).filter(([, each]) => each.at > now - THREAD_KEPT_DAYS * DAY));
  state.threads[slug] = {
    id: thread.id,
    at: now,
    channelId: card.channelId ?? postChannel.id,
    messageId: card.id,
    pinned: await pinThreadCard(card, tournament),
  };
  save();
  return thread;
}

// pinned tournament and event starters whose tournament or event is over get unpinned. over means past the end plus time
// for locals running late, or placements already posted for a TO with a far-out end date
export async function unpinFinishedThreads(postChannel = currentChannel()) {
  if (!postChannel?.client) return;
  const now = secondsNow();
  let changed = false;
  for (const [slug, entry] of Object.entries(state.threads)) {
    if (!entry.pinned || !entry.messageId) continue;
    if (entry.at <= now - THREAD_KEPT_DAYS * DAY) {
      try {
        await unpinThreadRef(postChannel, entry);
      } catch (err) {
        console.error('unpinning an old thread starter failed:', err.message);
        continue;
      }
      delete state.threads[slug];
      changed = true;
      continue;
    }
    const tournament = Object.values(state.tournaments).find((each) => each.slug === slug || slug.startsWith(`${each.slug}/event/`));
    // not tracked yet, or already pruned. deletions unpin on the way out, so this waits
    if (!tournament) continue;
    const event = tournament.events?.find((each) => each.slug === slug);
    if (event ? event.state !== 'COMPLETED' : !tournament.resultsPosted && now <= endTime(tournament) + RUNS_LATE_HOURS * HOUR) continue;
    try {
      await unpinThreadRef(postChannel, entry);
    } catch (err) {
      console.error(`unpinning the thread starter for ${tournament.name} failed:`, err.message);
      continue;
    }
    entry.pinned = false;
    changed = true;
  }
  if (changed) save();
}

// a tournament going away takes its pins off first, so deleted and unpublished ones don't stay pinned.
// that covers its event threads too, since unpinFinishedThreads skips tournaments that are gone
export async function unpinTournamentThread(postChannel, tournament) {
  const channel = postChannel ?? currentChannel();
  if (!channel?.client) return;
  const prefix = `${tournament.slug}/event/`;
  for (const [slug, entry] of Object.entries(state.threads)) {
    if (slug !== tournament.slug && !slug.startsWith(prefix)) continue;
    if (!entry.pinned || !entry.messageId) continue;
    try {
      await unpinThreadRef(channel, entry);
    } catch (err) {
      console.error(`unpinning the thread starter for ${tournament.name} failed:`, err.message);
      continue;
    }
    entry.pinned = false;
  }
}

// discord caps thread names at 100. a long tournament name gets cut before the event's, which tells the threads apart
function threadName(event, byEvent) {
  const { name } = event.tournament;
  if (!byEvent) return name.slice(0, 100);
  const suffix = ` · ${event.name}`.slice(0, 100);
  return `${name.slice(0, 100 - suffix.length)}${suffix}`;
}
