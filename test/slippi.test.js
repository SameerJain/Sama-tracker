import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-slippi-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const slippi = await import('../src/slippi.js');
slippi.setRequestGap(0);
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const { postRankChanges, findSlippiCodes, health } = await import('../src/tracker.js');
const embeds = await import('../src/embeds/index.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

// slippi accounts, which tests change between checks, and the codes people typed at start.gg registration by playerId
let users = {};
let codesOnStartgg = {};
let startggRequests = 0;

function user({ uid, code, rating, updates = 20, wins = 10, losses = 5, season = 5, regional = null, history = [] }) {
  return {
    fbUid: uid, displayName: code.split('#')[0], connectCode: { code },
    rankedNetplayProfile: {
      id: `RANKED_SINGLES-${uid}-season-${season}`, ratingOrdinal: rating, ratingUpdateCount: updates, wins, losses,
      dailyGlobalPlacement: null, dailyRegionalPlacement: regional, continent: 'EUROPE',
      characters: [{ character: 'CAPTAIN_FALCON', gameCount: 4 }, { character: 'FOX', gameCount: 9 }],
    },
    rankedNetplayProfileHistory: history,
  };
}

// a finished season the way slippi's history has it
const past = (name, rating, wins, losses, endedAt) => ({ ratingOrdinal: rating, wins, losses, season: { name, status: 'COMPLETED', endedAt } });

globalThis.fetch = async (url, options) => {
  // character art
  if (String(url).includes('images.example')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  const { query, variables } = JSON.parse(options.body);
  if (query.includes('videogame(id:')) {
    return { ok: true, json: async () => ({ data: { videogame: { characters: [{ name: 'Fox', images: [{ url: 'https://images.example/fox.png' }] }] } } }) };
  }
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
  Object.assign(state, { slippi: {}, slippiSkipped: [], slippiWrapped: [], players: {}, links: {}, messages: {} });
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
  assert.match(JSON.stringify(up.embeds), /"title":"Slippi rank change · AAA ranked up to Gold 2".*\+110\.0.*Was Gold 1.*10-5/);
  // the new rank's badge, and start.gg's icon for the character they've played most in ranked
  assert.match(JSON.stringify(up.embeds), /"thumbnail":\{"url":"attachment:\/\/rank-gold-2\.png"\}.*"author":\{"name":"Fox","icon_url":"attachment:\/\/character-1\.png"\}/);
  assert.deepEqual(up.files.map((file) => file.name), ['rank-gold-2.png', 'character-1.png']);
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
  assert.match(JSON.stringify(posts.sent[0].embeds), /"title":"Slippi rank change · Crew placed into Platinum 1"/);
  assert.doesNotMatch(JSON.stringify(posts.sent[0].embeds), /Was Pending/);
  assert.equal(state.slippi.c.rank, 'Pending');
  assert.equal(state.slippi.c.season, 'RANKED_SINGLES-c-season-5');

  users.c = user({ uid: 'c', code: 'CCC#3', rating: 2010, updates: 6 });
  await postRankChanges(posts);
  assert.match(JSON.stringify(posts.sent[1].embeds), /CCC placed into Diamond 1/);
});

test('a finished season gets one wrap-up with final ranks, climbers and what the watchlist played', async () => {
  const endedAt = new Date(Date.now() - 3600 * 1000).toISOString();
  const lastYear = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew' } };
  // already playing the new season, so its characters from before the reset are the ones that count
  watching('a', 'AAA#1', 'Diamond 1', 2040);
  Object.assign(state.slippi.a, { userId: 1, characters: [{ name: 'Marth', games: 120 }] });
  users.a = user({ uid: 'a', code: 'AAA#1', rating: 1200, updates: 2, season: 6, history: [past('Season 5', 2050, 30, 10, endedAt), past('Season 4', 1900, 20, 20, lastYear)] });
  // hasn't played since, so still on last season's profile, and dropped from the season before
  watching('b', 'BBB#2', 'Gold 2', 1600);
  users.b = user({ uid: 'b', code: 'BBB#2', rating: 1600, updates: 35, history: [past('Season 5', 1600, 20, 15, endedAt), past('Season 4', 1700, 10, 10, lastYear)] });
  // too few sets to rank, but what they played still counts
  watching('c', 'CCC#3', 'Pending', 1100);
  users.c = user({ uid: 'c', code: 'CCC#3', rating: 1100, updates: 3, history: [past('Season 5', 1100, 2, 1, endedAt)] });

  const posts = channel();
  await postRankChanges(posts);
  assert.equal(posts.sent.length, 1);
  const [wrap] = posts.sent;
  const text = JSON.stringify(wrap.embeds);
  assert.match(text, /"title":"Slippi Season 5 wrap-up"/);
  assert.match(wrap.embeds[0].data.description, /^\*\*Final ranks\*\*\n1\\\. \[Crew\]\(https:\/\/slippi\.gg\/user\/AAA-1\) · \*\*Diamond 1\*\* · 2050\.0 · 30-10 · Marth\n2\\\. \[BBB\]\(https:\/\/slippi\.gg\/user\/BBB-2\) · \*\*Gold 2\*\* · 1600\.0 · 20-15 · Fox\n\n/);
  assert.doesNotMatch(text, /CCC/);
  assert.match(wrap.embeds[0].data.description, /\*\*Biggest climbers\*\*\n\[Crew\].* · 1900\.0 to 2050\.0 \(\+150\.0\) since Season 4\n/);
  assert.doesNotMatch(wrap.embeds[0].data.description, /BBB.*since Season 4/);
  assert.match(wrap.embeds[0].data.description, /\*\*Most played:\*\* Marth 120 games · Fox 18 games · Captain Falcon 8 games/);
  assert.match(text, /"thumbnail":\{"url":"attachment:\/\/rank-diamond-1\.png"\}/);
  assert.deepEqual(wrap.files.map((file) => file.name), ['rank-diamond-1.png']);
  assert.deepEqual(wrap.allowedMentions, { parse: [] });
  assert.deepEqual(state.slippiWrapped, ['Season 5']);

  await postRankChanges(posts);
  assert.equal(posts.sent.length, 1, 'a season wraps up once');
});

test('no wrap-up for an old season, or one that ended while the slippi switch was off', async () => {
  const longAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  watching('a', 'AAA#1', 'Gold 2', 1600);
  users.a = user({ uid: 'a', code: 'AAA#1', rating: 1600, history: [past('Season 4', 1600, 20, 15, longAgo)] });
  const posts = channel();
  await postRankChanges(posts);
  assert.equal(posts.sent.length, 0);
  assert.deepEqual(state.slippiWrapped, []);

  state.messages = { slippi: false };
  users.a = user({ uid: 'a', code: 'AAA#1', rating: 1600, history: [past('Season 5', 1600, 20, 15, new Date().toISOString())] });
  await postRankChanges(posts);
  assert.equal(posts.sent.length, 0);
  // seen, so turning it back on doesn't post it late
  assert.deepEqual(state.slippiWrapped, ['Season 5']);
  state.messages = {};
  await postRankChanges(posts);
  assert.equal(posts.sent.length, 0);
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

test('the weekly search adds tracked players\' codes from start.gg, but not linked players or removed codes', async () => {
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
  assert.deepEqual(Object.keys(state.slippi), ['crew']);
  assert.equal(state.slippi.crew.userId, 1);
  assert.equal(state.slippi.crew.rank, 'Gold 1');
  assert.ok(Object.values(state.players).every((player) => player.slippiSearchedAt));
  assert.equal(state.links.someone.slippiSearchedAt, undefined);

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
  // the leader's badge
  assert.equal(card.data.thumbnail.url, 'attachment://rank-grandmaster.png');
});

test('every rank has a badge to upload', () => {
  for (const name of slippi.RANKS) assert.ok(existsSync(slippi.rankImage(name).attachment), name);
  assert.equal(slippi.rankImage('Platinum 3').name, 'rank-platinum-3.png');
});

test('slippi cards with no rank badge carry the slippi logo', () => {
  assert.ok(existsSync(slippi.LOGO.attachment));
  const logo = `attachment://${slippi.LOGO.name}`;
  assert.equal(embeds.slippiLeaderboard({}, {})[0].data.thumbnail.url, logo);
  const profile = { code: 'CREW#1', name: 'Crew', rating: 1600, updates: 20, wins: 12, losses: 8, characters: [] };
  assert.equal(embeds.slippiMatchup([{ tag: 'Crew' }], [profile])[0].data.thumbnail.url, logo);
});

test('melee reports get a Slippi ranked field for whoever has a connect code', () => {
  const profile = (code, rating) => ({
    code, name: code, rating, updates: 20, wins: 12, losses: 8, regional: null, global: null, region: 'Europe',
    characters: [{ name: 'Fox', games: 30 }, { name: 'Marth', games: 10 }], seasons: [{ name: 'Season 4', rating: 1500, wins: 30, losses: 20 }],
  });
  const card = () => embeds.slippiLeaderboard({}, {});
  const crew = { tag: 'Crew' };
  const rival = { tag: 'Rival' };

  const [pair] = embeds.withSlippi(card(), [crew, rival], [profile('CREW#1', 1600), null], { odds: true });
  const pairText = pair.data.fields[0].value;
  assert.match(pairText, /\*\*Crew\*\*: \[CREW#1\]\(https:\/\/slippi\.gg\/user\/CREW-1\) · \*\*Gold 2\*\* · 1600\.0 · 12-8/);
  // not on the watchlist, so not mentioned
  assert.doesNotMatch(pairText, /Rival/);
  assert.match(pairText, /not part of the odds/);

  const [counted] = embeds.withSlippi(card(), [crew, rival], [profile('CREW#1', 1600), profile('RIVAL#1', 1400)], { odds: true, slippi: true });
  assert.match(counted.data.fields[0].value, /part of the Melee odds/);
  assert.doesNotMatch(counted.data.fields[0].value, /not part/);

  const [one] = embeds.withSlippi(card(), [crew], [profile('CREW#1', 1600)], { seasons: true });
  assert.match(one.data.fields[0].value, /Gold 2\*\* · 1600\.0 · 12-8 this season\n\*\*Characters:\*\* Fox 30 games · Marth 10 games\n\*\*Since Season 4:\*\* 1500\.0 to 1600\.0 \(\+100\.0\)/);

  // nobody with a code leaves the report alone
  const [untouched] = embeds.withSlippi(card(), [crew, rival], [null, null]);
  assert.equal(untouched.data.fields, undefined);
  assert.deepEqual(embeds.slippiMatchup([crew], [null]), []);
  assert.equal(embeds.slippiMatchup([crew], [profile('CREW#1', 1600)]).length, 1);

  const [ranked] = card();
  embeds.withRankedCharacters(ranked, profile('CREW#1', 1600));
  assert.match(ranked.data.fields[0].value, /1\\\. \*\*Fox\*\* · 30 games · 75%\n2\\\. \*\*Marth\*\* · 10 games · 25%/);
});

test('someone not on the watchlist costs no requests, so their reports go the way they did before slippi', async () => {
  const { slippiFor, slippiLookup } = await import('../src/commands/slippi.js');
  let requests = 0;
  const fake = globalThis.fetch;
  globalThis.fetch = async (...args) => { requests++; return fake(...args); };
  try {
    const rival = { userId: 2, playerId: 20, tag: 'Rival' };
    assert.equal(await slippiFor(rival), null);
    assert.equal(await slippiLookup([rival, { userId: 3, playerId: 30, tag: 'Other' }], true)(true), null);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = fake;
  }
});

test('a slippi that hangs or fails gets the last rank check\'s numbers instead of holding up the report', async (t) => {
  const { slippiFor } = await import('../src/commands/slippi.js');
  watching('slow', 'SLOW#1', 'Gold 1', 1450);
  state.slippi.slow.userId = 5;
  t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
  const started = Date.now();
  const profile = await slippiFor({ userId: 5, playerId: 50, tag: 'Slow' });
  assert.equal(profile.rank, 'Gold 1');
  assert.ok(Date.now() - started < 4000);

  watching('down', 'DOWN#1', 'Silver 2', 1200);
  state.slippi.down.userId = 6;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('ECONNRESET'); });
  assert.equal((await slippiFor({ userId: 6, playerId: 60, tag: 'Down' })).rank, 'Silver 2');
});

test('a report card with no room left goes out without the Slippi field instead of getting rejected', () => {
  const crew = { tag: 'Crew' };
  const profile = { code: 'CREW#1', name: 'Crew', rating: 1600, updates: 20, wins: 12, losses: 8, characters: [] };
  const [full] = embeds.slippiLeaderboard({}, {});
  full.setDescription('x'.repeat(4096));
  for (let i = 0; i < 2; i++) full.addFields({ name: 'Stat', value: 'y'.repeat(900) });
  embeds.withSlippi([full], [crew], [profile]);
  assert.equal(full.data.fields.length, 2);

  const [crowded] = embeds.slippiLeaderboard({}, {});
  for (let i = 0; i < 25; i++) crowded.addFields({ name: 'Stat', value: '1', inline: true });
  embeds.withSlippi([crowded], [crew], [profile]);
  assert.equal(crowded.data.fields.length, 25);
});
