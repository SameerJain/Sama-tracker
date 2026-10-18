import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-slippi-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const slippi = await import('../src/slippi.js');
const { postRankChanges, findSlippiCodes, health } = await import('../src/tracker.js');
const embeds = await import('../src/embeds/index.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

// slippi accounts, which tests change between checks, and the codes people typed at start.gg registration by playerId
let users = {};
let codesOnStartgg = {};
let startggRequests = 0;

function user({ uid, code, rating, updates = 20, wins = 10, losses = 5, season = 5, regional = null }) {
  return {
    fbUid: uid, displayName: code.split('#')[0], connectCode: { code },
    rankedNetplayProfile: {
      id: `RANKED_SINGLES-${uid}-season-${season}`, ratingOrdinal: rating, ratingUpdateCount: updates, wins, losses,
      dailyGlobalPlacement: null, dailyRegionalPlacement: regional, continent: 'EUROPE',
      characters: [{ character: 'CAPTAIN_FALCON', gameCount: 4 }, { character: 'FOX', gameCount: 9 }],
    },
    rankedNetplayProfileHistory: [],
  };
}

globalThis.fetch = async (url, options) => {
  const { query, variables } = JSON.parse(options.body);
  if (String(url).includes('internal.slippi.gg')) {
    const all = Object.values(users);
    const found = (value) => all.find((each) => each.fbUid === value || each.connectCode.code === value) ?? null;
    return { ok: true, json: async () => ({ data: Object.fromEntries(Object.entries(variables).map(([name, value]) => [name.replace('v', 'u'), found(value)])) }) };
  }
  // start.gg only gets asked for connect codes here. an opponent's code is in the same set, and has to be left alone
  startggRequests++;
  assert.match(query, /isEventOnline/);
  const data = {};
  for (const [, id] of query.matchAll(/p(\d+): /g)) {
    const code = codesOnStartgg[id];
    const slots = [
      { entrant: { participants: [{ player: { id: 999 }, connectedAccounts: { slippi: { value: 'OPP#1' } } }] } },
      { entrant: { participants: [{ player: { id: Number(id) }, connectedAccounts: code ? { slippi: { value: code } } : null }] } },
    ];
    data[`p${id}`] = { sets: { nodes: [{ slots }] } };
  }
  return { ok: true, json: async () => ({ data }) };
};

function channel() {
  const sent = [];
  return { sent, send: async (message) => { sent.push(message); } };
}

// a watchlist entry as the last check left it
function watching(uid, code, rank, rating, season = 5) {
  state.slippi[uid] = { uid, code, name: code.split('#')[0], rank, rating, updates: 20, wins: 10, losses: 5, season: `RANKED_SINGLES-${uid}-season-${season}` };
}

beforeEach(() => {
  users = {};
  codesOnStartgg = {};
  startggRequests = 0;
  Object.assign(state, { slippi: {}, slippiSkipped: [], players: {}, links: {}, messages: {} });
});

test('connect codes are read the way people type and paste them', () => {
  assert.equal(slippi.readCode('ABCD#123'), 'ABCD#123');
  assert.equal(slippi.readCode(' abcd-123 '), 'ABCD#123');
  assert.equal(slippi.readCode('https://slippi.gg/user/ibdw-0'), 'IBDW#0');
  assert.equal(slippi.readCode('slippi.gg/user/ibdw-0/'), 'IBDW#0');
  assert.equal(slippi.readCode('Duff#799'), 'DUFF#799');
  for (const junk of ['ABCD', '#123', 'ABCDEFGHIJ#1', 'hello there']) assert.equal(slippi.readCode(junk), null, junk);
  assert.equal(slippi.profileUrl('IBDW#0'), 'https://slippi.gg/user/IBDW-0');
});

test('ranks use slippi.gg\'s cutoffs, and grandmaster needs a daily placement', () => {
  const rank = (rating, extra = {}) => slippi.rankOf({ rating, updates: 20, ...extra }).name;
  assert.equal(rank(765.42), 'Bronze 1');
  assert.equal(rank(765.43), 'Bronze 2');
  assert.equal(rank(1843), 'Platinum 2');
  assert.equal(rank(2191.75), 'Master 1');
  assert.equal(rank(2400), 'Master 3');
  assert.equal(rank(2400, { regional: 40 }), 'Grandmaster');
  assert.equal(rank(2100, { global: 40 }), 'Diamond 2');
  assert.equal(rank(2400, { updates: 4 }), 'Pending');
  assert.equal(rank(1100, { updates: 0 }), 'Unranked');
});

test('a rank change posts once, up or down, with the rating change and no pings', async () => {
  watching('a', 'AAA#1', 'Gold 1', 1450);
  users.a = user({ uid: 'a', code: 'AAA#1', rating: 1560 });
  const posts = channel();
  await postRankChanges(posts);
  assert.equal(posts.sent.length, 1);
  const [up] = posts.sent;
  assert.deepEqual(up.allowedMentions, { parse: [] });
  assert.match(JSON.stringify(up.embeds), /"title":"AAA ranked up to Gold 2".*\+110\.0.*Was Gold 1.*10-5/);
  assert.equal(state.slippi.a.rank, 'Gold 2');

  await postRankChanges(posts);
  assert.equal(posts.sent.length, 1, 'nothing changed, so nothing new');

  users.a = user({ uid: 'a', code: 'AAA#1', rating: 1400 });
  await postRankChanges(posts);
  assert.match(JSON.stringify(posts.sent[1].embeds), /AAA dropped to Silver 3.*-160\.0/);
});

test('placing out of pending posts, a new season starting everyone over does not', async () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew' } };
  watching('b', 'BBB#2', 'Pending', 1100);
  state.slippi.b.userId = 1;
  watching('c', 'CCC#3', 'Diamond 1', 2010, 4);
  users.b = user({ uid: 'b', code: 'BBB#2', rating: 1800, updates: 5 });
  users.c = user({ uid: 'c', code: 'CCC#3', rating: 1100, updates: 2 });
  const posts = channel();
  await postRankChanges(posts);
  assert.equal(posts.sent.length, 1);
  // the start.gg tag, since that's who the server knows
  assert.match(JSON.stringify(posts.sent[0].embeds), /"title":"Crew placed into Platinum 1"/);
  assert.doesNotMatch(JSON.stringify(posts.sent[0].embeds), /Was Pending/);
  assert.equal(state.slippi.c.rank, 'Pending');
  assert.equal(state.slippi.c.season, 'RANKED_SINGLES-c-season-5');

  users.c = user({ uid: 'c', code: 'CCC#3', rating: 2010, updates: 6 });
  await postRankChanges(posts);
  assert.match(JSON.stringify(posts.sent[1].embeds), /CCC placed into Diamond 1/);
});

test('a code change keeps the same watchlist entry, and the slippi switch skips changes while off', async () => {
  watching('d', 'DDD#4', 'Gold 1', 1450);
  users.d = user({ uid: 'd', code: 'NEW#9', rating: 1600 });
  state.messages = { slippi: false };
  const posts = channel();
  await postRankChanges(posts);
  assert.equal(posts.sent.length, 0);
  // seen, so turning it back on doesn't post it late
  assert.equal(state.slippi.d.rank, 'Gold 2');
  assert.equal(state.slippi.d.code, 'NEW#9');
});

test('a slippi outage keeps the watchlist as it was and shows on /status', async (t) => {
  watching('e', 'EEE#5', 'Gold 1', 1450);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
  await postRankChanges(channel());
  assert.match(health.slippiError, /isn't its API.*may have moved/);
  assert.equal(state.slippi.e.rank, 'Gold 1');
  const [card] = [embeds.status({ ...health, startedAt: 1, players: 0, tournaments: 0, slippi: 1, avatar: 'https://cdn.example/avatar.png' })];
  assert.match(card.data.description, /Slippi ranks checked:.*last try failed.*1 player on the watchlist/);
});

test('the weekly search adds tracked and linked players\' codes from start.gg, and skips removed ones', async () => {
  state.players = {
    1: { userId: 1, playerId: 10, tag: 'Crew' },
    2: { userId: 2, playerId: 20, tag: 'Ult only' },
    4: { userId: 4, playerId: 40, tag: 'Removed' },
  };
  state.links = { someone: { userId: 3, playerId: 30, tag: 'Linked' } };
  codesOnStartgg = { 10: 'crew#1', 30: 'lnk-2', 40: 'SKIP#1' };
  users = {
    crew: user({ uid: 'crew', code: 'CREW#1', rating: 1500 }),
    lnk: user({ uid: 'lnk', code: 'LNK#2', rating: 1000 }),
    skip: user({ uid: 'skip', code: 'SKIP#1', rating: 1000 }),
  };
  state.slippiSkipped = ['skip'];

  await findSlippiCodes();
  assert.deepEqual(Object.keys(state.slippi).sort(), ['crew', 'lnk']);
  assert.equal(state.slippi.crew.userId, 1);
  assert.equal(state.slippi.crew.rank, 'Gold 1');
  assert.equal(state.slippi.lnk.userId, 3);
  assert.equal(state.slippi.lnk.seasons, undefined, 'past seasons only go on the /slippi rank card');
  assert.ok(Object.values(state.players).every((player) => player.slippiSearchedAt));

  // nobody's due again for a week
  startggRequests = 0;
  await findSlippiCodes();
  assert.equal(startggRequests, 0);
});

test('a code the search finds for someone already on the watchlist only ties them to start.gg', async () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew' } };
  codesOnStartgg = { 10: 'CREW#1' };
  users.crew = user({ uid: 'crew', code: 'CREW#1', rating: 1600 });
  watching('crew', 'CREW#1', 'Gold 1', 1450);
  await findSlippiCodes();
  // the rank check gets to post Gold 1 to Gold 2
  assert.equal(state.slippi.crew.rank, 'Gold 1');
  assert.equal(state.slippi.crew.userId, 1);
});

test('the leaderboard goes by rank then rating, with pending last and start.gg tags', () => {
  const entries = {
    gm: { uid: 'gm', code: 'GM#1', name: 'GM', rank: 'Grandmaster', rating: 2300, updates: 50, wins: 40, losses: 10 },
    m3: { uid: 'm3', code: 'MTHREE#1', name: 'MThree', rank: 'Master 3', rating: 2400, updates: 50, wins: 40, losses: 10 },
    pend: { uid: 'pend', code: 'PEND#1', name: 'Pend', rank: 'Pending', rating: 1100, updates: 3, wins: 2, losses: 1 },
    gold: { uid: 'gold', code: 'GOLD#1', name: 'goldslippiname', rank: 'Gold 1', rating: 1450, updates: 30, wins: 20, losses: 10, userId: 1 },
  };
  const [card] = embeds.slippiLeaderboard(entries, { 1: { userId: 1, tag: 'Crew' } });
  const lines = card.data.description.split('\n');
  assert.match(card.data.title, /Slippi leaderboard · 4/);
  assert.match(lines[0], /^1\\\. \[GM\].*\*\*Grandmaster\*\* · 2300\.0 · 40-10/);
  assert.match(lines[1], /^2\\\. \[MThree\].*\*\*Master 3\*\* · 2400\.0/);
  assert.match(lines[2], /^3\\\. \[Crew\]\(https:\/\/slippi\.gg\/user\/GOLD-1\).*Gold 1/);
  assert.match(lines[3], /^4\\\. \[Pend\].*\*\*Pending\*\* · 2-1$/);
});
