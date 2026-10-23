import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockApi, crewPlayer, tracked, event, node } from './fixtures.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-features-tournaments-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const embeds = await import('../src/embeds/index.js');
const tracker = await import('../src/tracker.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

test('tournament roll calls and placements disable mentions', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.messages = { rollcall: true, results: true };
  state.players = Object.fromEntries([1, 2, 3].map((userId) => [userId, {
    userId, playerId: userId * 10, tag: `Player ${userId}`, slug: `user/player-${userId}`,
  }]));
  const entries = [1, 2, 3].map((userId) => ({
    userId, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: userId, final: true,
  }));
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };

  await tracker.postRollCall({ name: 'Local', slug: 'tournament/local', startAt: now + 1800, entries }, channel);
  await tracker.postResults({ name: 'Local', slug: 'tournament/local', startAt: now - 14 * 3600, endAt: now - 13 * 3600, entries }, channel);

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map(({ allowedMentions }) => allowedMentions), [{ parse: [] }, { parse: [] }]);
  assert.equal(sent[0].embeds[0].data.title, 'Tournament roll call · Local');
  assert.equal(sent[1].embeds[0].data.title, "Tracked players' results from Local");
});

test('results list notable upset wins, including tracked vs tracked, and skip losses and small ones', () => {
  const players = {
    1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival' },
  };
  const entries = [
    { userId: 1, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 5, final: true },
    { userId: 2, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 9, final: true },
  ];
  const upset = (setId, winnerUserId, loserUserId, winnerSeed, loserSeed) => ({
    setId, winnerUserId, winnerName: players[winnerUserId].tag, winnerSeed,
    loserUserId, loserName: players[loserUserId].tag, loserSeed,
    winnerScore: 3, loserScore: 1, eventSlug: event.slug, round: 'Winners round 1', factor: 7,
  });
  // tracked vs tracked still shows as the winner's upset
  const [card] = embeds.results({ name: 'Local', slug: 'tournament/local', entries, notableUpsets: [upset('s1', 1, 2, 17, 2)] }, players);
  assert.match(card.data.description, /\*\*Notable upset:\*\*.*Active.*Rival.*seed 2.*3-1.*seed 17/);
  // nothing saved means no upset line at all
  const [plain] = embeds.results({ name: 'Local', slug: 'tournament/local', entries }, players);
  assert.doesNotMatch(plain.data.description, /Notable upset/);
});

test('the set check saves notable upset wins per tournament, and skips losses, small ones, doubles and DQs', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = {
    1: { ...crewPlayer, lastCheck: now - 120 },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastCheck: now - 120 },
  };
  state.tournaments = { 5: { id: 5, name: 'Local', slug: 'tournament/local', startAt: now - 3600, endAt: now + 3600, entries: [] } };
  state.messages = {};
  state.posted = [];
  state.dqs = [];
  const major = { ...node('major-win', now - 60), state: 3 };
  major.slots[0].entrant.initialSeedNum = 17;
  major.slots[1].entrant.initialSeedNum = 2;
  // slot 0 (Active) beats slot 1, factor 7
  const small = { ...node('small-win', now - 60), state: 3 };
  // Active seeded 2 loses to seed 17: major the other way, but a loss so it stays out
  const lost = { ...node('major-loss', now - 60), state: 3, winnerId: 99 };
  lost.slots[0].entrant.initialSeedNum = 2;
  lost.slots[1].entrant.initialSeedNum = 17;
  const doubles = { ...node('doubles-win', now - 60), state: 3 };
  doubles.slots[0].entrant.initialSeedNum = 17;
  doubles.slots[0].entrant.participants.push({ player: { id: 20 } });
  doubles.slots[0].playerIds = [10, 20];
  const dq = { ...node('dq-win', now - 60), state: 3 };
  dq.slots[0].entrant.initialSeedNum = 17;
  dq.slots[0].standing.stats.score.value = -1;
  for (const set of [major, small, lost, doubles, dq]) {
    set.event = { ...event, tournament: { name: 'Local', slug: 'tournament/local' } };
  }
  mockApi(() => ({ p10: { sets: { nodes: [major, small, lost, doubles, dq] } }, p20: { sets: { nodes: [] } } }));
  await tracker.postNewSets({ send: async () => ({}) });
  const saved = state.tournaments[5].notableUpsets ?? [];
  assert.deepEqual(saved.map((upset) => upset.setId), ['major-win']);
  assert.equal(saved[0].winnerUserId, 1);
  const [card] = embeds.results(
    { name: 'Local', slug: 'tournament/local', entries: [{ userId: 1, event: 'Singles', eventSlug: event.slug, placement: 1, final: true }], notableUpsets: saved },
    state.players,
  );
  assert.match(card.data.description, /Notable upset/);
});

test('roll calls link the streams on the tournament page, and post without them if that fails', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.messages = {};
  state.players = Object.fromEntries([1, 2, 3].map((userId) => [userId, {
    userId, playerId: userId * 10, tag: `Player ${userId}`, slug: `user/player-${userId}`,
  }]));
  const entries = [1, 2, 3].map((userId) => ({ userId, event: 'Singles', eventSlug: event.slug, entrants: 32 }));
  const tournament = () => ({ id: 4, name: 'Local', slug: 'tournament/local', startAt: now + 1800, entries });
  let asked = 0;
  mockApi(({ query }) => {
    asked++;
    assert.match(query, /t4: tournament\(id: 4\) \{ streams/);
    return { t4: { streams: [{ streamName: 'localstream', streamSource: 'TWITCH' }, { streamName: 'backup', streamSource: 'YOUTUBE' }] } };
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };
  await tracker.postRollCall(tournament(), channel);
  assert.equal(asked, 1);
  assert.match(sent[0].embeds[0].data.description, /\*\*Streams:\*\* \[twitch\.tv\/localstream\]\(https:\/\/twitch\.tv\/localstream\) · backup \(Youtube\)/);

  // start.gg failing leaves the streams out, not the roll call
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) });
  const logged = console.error;
  console.error = () => {};
  try {
    await tracker.postRollCall(tournament(), channel);
  } finally {
    console.error = logged;
  }
  assert.equal(sent.length, 2);
  assert.equal(sent[1].embeds[0].data.title, 'Tournament roll call · Local');
  assert.doesNotMatch(sent[1].embeds[0].data.description, /Streams/);

  // turned off, it doesn't ask
  state.messages = { rollcall: false };
  asked = 0;
  mockApi(() => { asked++; return {}; });
  await tracker.postRollCall(tournament(), channel);
  assert.equal(asked, 0);
  assert.equal(sent.length, 2);
  state.messages = {};
});

test('top 8s only come from tracked tournaments, every event with everyone in it', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer }, 2: { userId: 2, playerId: 20, tag: 'Second', slug: 'user/second' } };
  const doubles = { eventId: 502, event: 'Doubles', eventSlug: 'tournament/local/event/doubles', entrants: 12, started: true, placement: 4, final: true };
  const entries = [
    { userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 5, final: true },
    { userId: 2, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 9, final: true },
    { userId: 1, ...doubles },
  ];
  const finished = () => ({ name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600, entries });
  const standing = (placement, name, isFinal = true) => ({ placement, isFinal, entrant: { name } });
  const asked = [];
  mockApi(({ query }) => {
    asked.push(query);
    return {
      e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ'), standing(2, 'Runner'), standing(3, 'Third'), standing(4, 'Fourth'),
        standing(5, 'Active'), standing(5, 'Stranger'), standing(7, 'Seventh'), standing(7, 'Also_Seventh')] } },
      e502: { state: 'ACTIVE', standings: { nodes: [standing(1, 'Team A'), standing(2, 'Team B', false)] } },
    };
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };

  // the crew's tournament that nobody tracked gets placements and no top 8
  state.messages = {};
  const untracked = { ...finished(), tracked: undefined };
  await tracker.postResults(untracked, channel);
  assert.equal(asked.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(untracked.resultsPosted, true);
  assert.equal(untracked.top8Posted, true);

  // and switched off server-wide or for the tournament, neither does a tracked one
  for (const [messages, top8] of [[{ top8: false }, true], [{}, false]]) {
    state.messages = messages;
    sent.length = 0;
    const quiet = { ...finished(), tracked: { ...tracked, top8 } };
    await tracker.postResults(quiet, channel);
    assert.equal(asked.length, 0);
    assert.equal(sent.length, 1);
    assert.equal(quiet.top8Posted, true);
  }

  state.messages = {};
  sent.length = 0;
  const posted = finished();
  await tracker.postResults(posted, channel);
  // one lookup for both events, and the singles event only once even with two of the crew in it
  assert.equal(asked.length, 1);
  assert.equal(asked[0].match(/e501: event/g).length, 1);
  assert.equal(sent.length, 2);
  const cards = sent[1].embeds.map((card) => card.toJSON());
  assert.deepEqual(cards.map((card) => card.author.name), ['Top 8 · Singles · 32 entrants', 'Top 8 · Doubles · 12 entrants']);
  assert.deepEqual(cards.map((card) => card.title), ['Top 8 from Local', 'Top 8 from Local']);
  assert.equal(cards[0].url, 'https://www.start.gg/tournament/local/event/singles/standings');
  assert.equal(cards[0].description, ['🥇 1st Champ', '🥈 2nd Runner', '🥉 3rd Third', '4th Fourth', '5th Active', '5th Stranger', '7th Seventh', '7th Also\\_Seventh'].join('\n'));
  assert.match(cards[1].description, /^🥇 1st Team A\n2nd Team B \(projected\)\n-# The bracket wasn't finished/);
  assert.deepEqual(sent[1].allowedMentions, { parse: [] });
  assert.equal(posted.resultsPosted, true);

  // start.gg failing posts nothing, so the next check sends both instead of repeating the placements
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) });
  sent.length = 0;
  const failed = finished();
  await assert.rejects(tracker.postResults(failed, channel), /start\.gg: down/);
  assert.equal(sent.length, 0);
  assert.equal(failed.resultsPosted, undefined);

  // 12 hours of that and the placements stop waiting on it
  const stuck = { ...finished(), startAt: now - 27 * 3600, endAt: now - 26 * 3600 };
  await tracker.postResults(stuck, channel);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results · /);
  assert.equal(stuck.resultsPosted, true);

  // discord turning down the top 8 doesn't put the placements up a second time
  mockApi(() => ({ e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ')] } } }));
  const picky = { send: async (payload) => {
    if (payload.embeds.some((card) => card.toJSON().author.name.startsWith('Top 8'))) throw new Error('Missing Permissions');
    sent.push(payload);
  } };
  sent.length = 0;
  const rejected = finished();
  await tracker.postResults(rejected, picky);
  assert.equal(sent.length, 1);
  assert.equal(rejected.resultsPosted, true);
});

test('results and the top 8 go out together as soon as the bracket is finished', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer } };
  const entry = (done) => ({ userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32,
    started: true, done, placement: 5, final: true });
  const standing = (placement, name) => ({ placement, isFinal: true, entrant: { name } });
  const asked = [];
  mockApi(({ query }) => {
    asked.push(query);
    return { e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ'), standing(2, 'Runner')] } } };
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };

  // bracket done but the tournament hasn't ended: results and top 8 still go together
  state.messages = { top8: true };
  const live = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 2 * 3600, endAt: now + 2 * 3600, entries: [entry(true)] };
  await tracker.postResults(live, channel);
  assert.equal(sent.length, 2);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.match(sent[1].embeds[0].toJSON().author.name, /^Top 8/);
  assert.equal(live.resultsPosted, true);
  assert.equal(live.top8Posted, true);

  // the next check doesn't post it again
  await tracker.postResults(live, channel);
  assert.equal(sent.length, 2);

  // once the old placements deadline passes, neither goes out again
  sent.length = 0;
  live.startAt = now - 14 * 3600;
  live.endAt = now - 13 * 3600;
  await tracker.postResults(live, channel);
  assert.equal(sent.length, 0);
  assert.equal(live.resultsPosted, true);

  // top 8 switched off still posts results on the same bracket-finished trigger
  state.messages = { top8: false };
  asked.length = 0;
  sent.length = 0;
  const quiet = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 2 * 3600, endAt: now + 2 * 3600, entries: [entry(true)] };
  await tracker.postResults(quiet, channel);
  assert.equal(asked.length, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.equal(quiet.top8Posted, true);
  assert.equal(quiet.resultsPosted, true);

  // a bracket still running posts nothing and asks nothing
  state.messages = { top8: true };
  asked.length = 0;
  const running = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 2 * 3600, endAt: now + 2 * 3600, entries: [entry(false)] };
  await tracker.postResults(running, channel);
  assert.equal(asked.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(running.top8Posted, undefined);

  // finished entries but an unfinished event on start.gg waits too
  mockApi(() => ({ e501: { state: 'ACTIVE', standings: { nodes: [standing(1, 'Champ')] } } }));
  const undecided = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 2 * 3600, endAt: now + 2 * 3600, entries: [entry(true)] };
  await tracker.postResults(undecided, channel);
  assert.equal(sent.length, 1);
  assert.equal(undecided.top8Posted, undefined);
});

test('a top 8 that fails to send is retried by the fail-safe instead of being lost', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer } };
  const entries = [{ userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32,
    started: true, done: true, placement: 5, final: true }];
  const standing = (placement, name) => ({ placement, isFinal: true, entrant: { name } });
  mockApi(() => ({ e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ'), standing(2, 'Runner')] } } }));
  state.messages = { top8: true };
  const sent = [];
  let rejectTopEight = true;
  const channel = { send: async (payload) => {
    if (rejectTopEight && payload.embeds.some((card) => card.toJSON().author.name.startsWith('Top 8'))) throw new Error('Missing Permissions');
    sent.push(payload);
    return { id: `m${sent.length}`, channelId: 'c1' };
  } };

  // placements due but the top 8 fails on discord: placements still go out, marked for retry
  const tournament = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600, entries };
  await tracker.postResults(tournament, channel);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.equal(tournament.resultsPosted, true);
  assert.equal(tournament.top8Posted, undefined);
  assert.equal(tournament.top8Failed, true);

  // the fail-safe sends the missing top 8 once discord accepts it, without reposting placements
  rejectTopEight = false;
  sent.length = 0;
  assert.equal(await tracker.verifyTopEight(tournament, channel), true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Top 8/);
  assert.equal(tournament.top8Posted, true);
  assert.equal(tournament.top8Failed, undefined);

  // and stays quiet afterwards
  mockApi(() => { throw new Error('already verified'); });
  sent.length = 0;
  assert.equal(await tracker.verifyTopEight(tournament, channel), true);
  assert.equal(sent.length, 0);

  // switched off it waits instead of sending, keeping the marker
  const muted = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries, resultsPosted: true, top8Failed: true, top8FailedAt: now };
  state.messages = { top8: false };
  sent.length = 0;
  assert.equal(await tracker.verifyTopEight(muted, channel), false);
  assert.equal(sent.length, 0);
  assert.equal(muted.top8Failed, true);

  // a start.gg failure waits an hour before trying again. the one lookup is 3 requests, since a 5xx gets 2 retries
  state.messages = { top8: true };
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return { ok: false, status: 500, json: async () => ({ message: 'down' }) };
  };
  const flaky = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries, resultsPosted: true, top8Failed: true, top8FailedAt: now };
  assert.equal(await tracker.verifyTopEight(flaky, channel), false);
  assert.equal(flaky.top8Failed, true);
  assert.equal(await tracker.verifyTopEight(flaky, channel), false);
  assert.equal(fetches, 3);

  // after 3 days it gives up without sending
  const stale = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries, resultsPosted: true, top8Failed: true, top8FailedAt: now - 4 * 86400 };
  mockApi(() => { throw new Error('should have given up'); });
  sent.length = 0;
  assert.equal(await tracker.verifyTopEight(stale, channel), false);
  assert.equal(sent.length, 0);
  assert.equal(stale.top8Failed, undefined);

  // tournaments from before the marker existed never get a second top 8
  const legacy = { name: 'Local', slug: 'tournament/local', startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries, resultsPosted: true };
  mockApi(() => { throw new Error('legacy must not be fetched'); });
  assert.equal(await tracker.verifyTopEight(legacy, channel), true);
  assert.equal(sent.length, 0);
  assert.equal(legacy.top8Posted, undefined);
});

test('placements and the top 8 go out at 12 hours even when the TO is still reporting', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer } };
  state.messages = { top8: true };
  const entries = [{ userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32,
    started: true, done: false, placement: 5, final: false }];
  const standing = (placement, name, isFinal) => ({ placement, isFinal, entrant: { name } });
  mockApi(() => ({ e501: { state: 'ACTIVE', standings: { nodes: [standing(1, 'Champ', true), standing(5, 'Active', false)] } } }));
  const sent = [];
  const channel = { send: async (payload) => { sent.push(payload); return { id: `m${sent.length}`, channelId: 'c1' }; } };

  // 13 hours after the end with the bracket unfinished: no waiting for 24 hours
  const tournament = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600, entries };
  await tracker.postResults(tournament, channel);
  assert.equal(sent.length, 2);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.match(sent[0].embeds[0].toJSON().description, /\(projected\)/);
  assert.match(sent[1].embeds[0].toJSON().author.name, /^Top 8/);
  assert.match(sent[1].embeds[0].toJSON().description, /\(projected\)/);
  assert.equal(tournament.resultsPosted, true);
  assert.equal(tournament.top8Posted, true);
  assert.ok(tournament.projected);
});

test('a top 8 with nothing reported at 12 hours goes out as a new message once the event completes', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer } };
  state.messages = { top8: true };
  const entries = [{ userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32,
    started: true, done: false, placement: 5, final: true }];
  // start.gg keeps erroring on the top 8, so placements go out without it
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) });
  const sent = [];
  const channel = { send: async (payload) => { sent.push(payload); return { id: `m${sent.length}`, channelId: 'c1' }; } };
  const tournament = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 27 * 3600, endAt: now - 26 * 3600, entries };
  await tracker.postResults(tournament, channel);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.equal(tournament.resultsPosted, true);
  assert.equal(tournament.top8Posted, undefined);
  assert.ok(tournament.projected);

  // the TO completes the event later: the final top 8 goes out on its own
  const standing = (placement, name) => ({ placement, isFinal: true, entrant: { name } });
  mockApi(() => ({ e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ'), standing(5, 'Active')] } } }));
  tournament.projected.checkedAt = now - 3601;
  sent.length = 0;
  await tracker.correctPlacements(tournament, channel);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Top 8/);
  assert.doesNotMatch(sent[0].embeds[0].toJSON().description, /projected/);
  assert.equal(tournament.top8Posted, true);
  assert.equal(tournament.projected, undefined);
});

test('a tracked tournament\'s top 8 covers every event, and waits for one that hasn\'t started until the end time', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = {};
  state.messages = {};
  const standing = (placement, name) => ({ placement, isFinal: true, entrant: { name } });
  const asked = [];
  mockApi(({ query }) => {
    asked.push(query);
    return Object.fromEntries([...query.matchAll(/\be(\d+): event/g)].map(([, id]) => [`e${id}`, { state: 'COMPLETED', standings: { nodes: [standing(1, `Champ ${id}`)] } }]));
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };
  // nobody from the crew entered, and doubles runs after singles
  const events = (doubles) => [
    { id: 601, name: 'Singles', slug: 'tournament/local/event/singles', state: 'COMPLETED', numEntrants: 40 },
    { id: 602, name: 'Doubles', slug: 'tournament/local/event/doubles', state: doubles, numEntrants: 12 },
  ];
  const tournament = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 4 * 3600, endAt: now + 3600, entries: [], events: events('CREATED') };
  await tracker.postResults(tournament, channel);
  assert.equal(asked.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(tournament.doneAt, undefined);

  tournament.events = events('COMPLETED');
  await tracker.postResults(tournament, channel);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].embeds.map((card) => card.toJSON().author.name), ['Top 8 · Singles · 40 entrants', 'Top 8 · Doubles · 12 entrants']);
  assert.ok(tournament.doneAt);
  assert.equal(tournament.top8Posted, true);

  // one that never started, like a raffle, stops holding it back once the end time passes
  sent.length = 0;
  const raffle = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 4 * 3600, endAt: now - 60, entries: [], events: events('CREATED') };
  await tracker.postResults(raffle, channel);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].embeds.map((card) => card.toJSON().author.name), ['Top 8 · Singles · 40 entrants']);
});

test('a tracked tournament\'s crew counts registered server members but not linked-only players', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer, discordId: 'active-discord' } };
  state.links = { 'linked-discord': { userId: 7, playerId: 70, tag: 'Linked', slug: 'user/linked' } };
  state.accounts = {};
  const local = { id: 5, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 7200, entries: [], userIds: [], tracked };
  const participant = (tag, id, discordId) => ({ gamerTag: tag, user: { id, slug: `user/${tag.toLowerCase()}`, authorizations: discordId ? [{ externalId: discordId }] : [] } });
  mockApi(() => ({ tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [
    participant('Active', 1, 'active-discord'), participant('Linked', 7), participant('Member', 8, 'member-discord'), participant('Other', 10, 'other-discord'),
    participant('Visitor', 9, 'visitor-discord'), { gamerTag: 'Added by the TO', user: null },
  ] } } }));
  const guild = { members: { fetch: async ({ user: ids }) => new Map(ids.filter((id) => ['member-discord', 'other-discord'].includes(id)).map((id) => [id, {}])) } };
  await tracker.refreshCrew(local, guild);
  // tracked players go by userIds, the rest are saved to be named
  assert.deepEqual(local.userIds, [1]);
  assert.deepEqual(local.crew, { 8: { userId: 8, slug: 'user/member', tag: 'Member' }, 10: { userId: 10, slug: 'user/other', tag: 'Other' } });

  // one tracked player, but three of the crew, so the roll call goes out and names them all
  local.entries = [1, 8, 10].map((userId) => ({ userId, event: 'Singles', eventSlug: 'tournament/local/event/singles', entrants: 32 }));
  state.messages = {};
  const sent = [];
  await tracker.postRollCall(local, { send: async (payload) => sent.push(payload) });
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].data.description, /\[Active\]\(https:\/\/www\.start\.gg\/user\/active\)\n\[Member\].*\n\[Other\]/s);
  assert.doesNotMatch(sent[0].embeds[0].data.description, /Linked/);

  // start.gg failing keeps the crew it had
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) });
  const logged = console.error;
  console.error = () => {};
  try {
    await tracker.refreshCrew(local, guild);
  } finally {
    console.error = logged;
  }
  assert.deepEqual(Object.keys(local.crew), ['8', '10']);
  state.links = {};
});
