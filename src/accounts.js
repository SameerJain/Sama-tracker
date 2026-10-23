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

// a big tournament is 10 or more pages of participants, and someone who isn't found tends to try again
// right away, so each list is kept a little. a failed lookup isn't kept
const PARTICIPANTS_CACHE_MINUTES = 10;
const LISTS_KEPT = 200;
const participantLists = new Map();
function participantsOf(tournamentId) {
  const cached = participantLists.get(tournamentId);
  if (cached && Date.now() - cached.at < PARTICIPANTS_CACHE_MINUTES * 60 * 1000) return cached.list;
  const list = startgg.getParticipants(tournamentId);
  participantLists.delete(tournamentId);
  participantLists.set(tournamentId, { at: Date.now(), list });
  // old tournaments fall off, so a long run can't grow this forever
  for (const old of [...participantLists.keys()].slice(0, -LISTS_KEPT)) participantLists.delete(old);
  list.catch(() => participantLists.delete(tournamentId));
  return list;
}

// for tests, which change who's registered between cases
export const forgetParticipants = () => participantLists.clear();

// discord takes this many ids a request when checking who's in the server
const MEMBERS_PER_FETCH = 100;

// the ones of these discord ids that are in the server, id to member. asking by id doesn't need
// the server members intent. discord can say to slow down, then it gets one more try after waiting
// (capped, so a huge retry_after can't stall a command)
const RETRY_AFTER_MAX_SECONDS = 10;
export async function serverMembers(guild, ids) {
  const found = new Map();
  if (!guild) return found;
  for (let i = 0; i < ids.length; i += MEMBERS_PER_FETCH) {
    const user = ids.slice(i, i + MEMBERS_PER_FETCH);
    const members = await guild.members.fetch({ user }).catch(async (err) => {
      if (!err.data?.retry_after) throw err;
      const wait = Math.min(err.data.retry_after, RETRY_AFTER_MAX_SECONDS);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return guild.members.fetch({ user });
    });
    for (const [id, member] of members) found.set(id, member);
  }
  return found;
}

// start.gg can't be searched by discord, so this tries the accounts the bot already has for it, then
// everyone registered for a tracked tournament that isn't over. a match only counts if start.gg still has
// this discord connected to it. null if nothing does
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

  const tracked = Object.values(state.tournaments).filter((tournament) => tournament.tracked && !tournament.resultsPosted);
  // one failing lookup leaves the rest, so a bad tournament id can't break /scout
  const participants = (await Promise.all(tracked.map((tournament) => participantsOf(tournament.id).catch(() => [])))).flat();
  rememberAccounts(participants);
  return connected(discordId, participants.filter((participant) => participant.discordId === discordId).map((participant) => participant.userId));
}

// for /scout: the tracked or linked account of whoever ran it, as long as start.gg still has their discord
// connected to it, so disconnecting it there takes /scout away right away. one lookup at most. checking the
// whole tracked list for someone who connected it since the daily refresh cost a request per 20 players on
// every miss, and /link finds them right away instead
export async function verifiedCaller(discordId) {
  const link = state.links[discordId];
  const saved = [...Object.values(state.players).filter((player) => player.discordId === discordId).map((player) => player.userId), link?.userId];
  const found = await connected(discordId, saved);
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
