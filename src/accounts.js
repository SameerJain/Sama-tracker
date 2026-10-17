import * as startgg from './startgg.js';
import { state, save } from './store.js';

// about two majors' worth. the locals get seen again every reminder, so they stay in
const MAX_ACCOUNTS = 5000;

// everyone in a participant list with discord connected, so /profile can find them later.
// snowflakes are too big to be array indexes, so key order is the order they were last seen
export function rememberAccounts(participants) {
  let changed = false;
  for (const { discordId, userId } of participants) {
    if (!discordId || !userId) continue;
    delete state.accounts[discordId];
    state.accounts[discordId] = userId;
    changed = true;
  }
  if (!changed) return;
  const ids = Object.keys(state.accounts);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_ACCOUNTS))) delete state.accounts[id];
  save();
}

// start.gg can't be searched by discord, so this tries the accounts the bot already has for it, then
// everyone registered for a reg reminder tournament. a match only counts if start.gg still has this
// discord connected to it. null if nothing does
export async function findAccount(discordId) {
  const saved = [
    ...Object.values(state.players).filter((player) => player.discordId === discordId).map((player) => player.userId),
    state.links[discordId]?.userId,
    state.accounts[discordId],
  ];
  const found = await connected(discordId, saved);
  if (found) return found;
  // disconnected there since it was seen
  if (state.accounts[discordId]) {
    delete state.accounts[discordId];
    save();
  }

  const participants = (await Promise.all(Object.values(state.regReminders).map((reminder) => startgg.getParticipants(reminder.id)))).flat();
  rememberAccounts(participants);
  return connected(discordId, participants.filter((participant) => participant.discordId === discordId).map((participant) => participant.userId));
}

// for /scout: the tracked or linked account of whoever ran it, as long as start.gg still has their discord
// connected to it, so disconnecting it there takes /scout away right away. the saved ones go first, so
// it's usually one lookup. the rest of the tracked list catches someone who connected it since the last refresh
export async function verifiedCaller(discordId) {
  const link = state.links[discordId];
  const tracked = Object.values(state.players);
  const saved = [...tracked.filter((player) => player.discordId === discordId).map((player) => player.userId), link?.userId];
  const found = await connected(discordId, saved) ?? await connected(discordId, tracked.map((player) => player.userId));
  if (!found) return null;
  return state.players[found.userId] ?? (String(link?.userId) === found.userId ? link : null);
}

// the first of these start.gg users with this discord connected, checked live
async function connected(discordId, userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return null;
  const match = (await startgg.getProfiles(ids)).find(([, profile]) => profile?.discordId === discordId);
  return match ? { userId: match[0], ...match[1] } : null;
}
