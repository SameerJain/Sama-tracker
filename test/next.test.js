import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockApi } from './fixtures.js';

// next opponent cards: a set with both players known that hasn't started, for /notify next and tracked tournaments
const directory = mkdtempSync(join(tmpdir(), 'sama-next-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const tracker = await import('../src/tracker.js');
const { colors } = await import('../src/embeds/shared.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
const DAY = 86400;
// a tracked tournament going on now, and one nobody tracks that a /notify next person is in
const weekly = { name: 'Weekly', slug: 'tournament/weekly', isOnline: false, images: [], startAt: now - 3600, endAt: now + 3600 };
const elsewhere = { name: 'Elsewhere', slug: 'tournament/elsewhere', isOnline: false, images: [], startAt: now - 3600, endAt: now + 3600 };
const trackedWeekly = (posts = {}) => ({
  7: {
    id: 7, name: 'Weekly', slug: 'tournament/weekly', startAt: weekly.startAt, endAt: weekly.endAt, entries: [],
    events: [{ id: 70, name: 'Singles', slug: 'tournament/weekly/event/singles', state: 'ACTIVE' }],
    tracked: { by: 'manual', at: now - 3600, posts },
  },
});

const NAMES = { 10: 'Active', 11: 'Partner', 20: 'Rival', 21: 'Fourth', 30: 'Third', 40: 'Last', 50: 'Fifth', 60: 'Sixth', 99: 'Opponent' };
// an unplayed set the way getNextSets and getUnplayedEventSets ask for it. sides are player ids, an array for a team
const unplayed = (id, sides, { round = 2, setState = 1, tournament = weekly, station = null, startAt = null, group = 5 } = {}) => ({
  id, state: setState, round, fullRoundText: round === 1 ? 'Winners round 1' : `Winners round ${round}`, startAt, stream: null,
  station: station ? { number: station } : null, phaseGroup: { id: group },
  event: { id: tournament === weekly ? 70 : 80, name: 'Singles', slug: `${tournament.slug}/event/singles`, videogame: { id: 1386, displayName: 'Ultimate' }, tournament },
  slots: sides.map((side, i) => {
    const ids = [side].flat();
    return { entrant: { id: Number(id) * 10 + i, name: ids.map((each) => NAMES[each]).join(' + '), initialSeedNum: i + 1, participants: ids.map((each) => ({ player: { id: each } })) } };
  }),
});

// start.gg as these tests set it: each player's next sets, cut to the page size the way start.gg does, each event's
// unplayed sets, one player's sets in an event, and each set's pairing
let api;
let asked;
const plays = (set, playerId) => set.slots.some((slot) => slot.entrant.participants.some((each) => String(each.player.id) === String(playerId)));
function serve(data = {}) {
  api = { next: {}, events: {}, pairings: {}, ...data };
  asked = [];
  mockApi(({ query }) => {
    const ids = (prefix, field) => [...query.matchAll(new RegExp(`${prefix}(\\d+): ${field}\\(`, 'g'))].map(([, id]) => id);
    if (query.includes(': player(')) {
      const perPage = Number(query.match(/perPage: (\d+)/)[1]);
      asked.push(...ids('p', 'player').map((id) => `p${id}`));
      return Object.fromEntries(ids('p', 'player').map((id) => [`p${id}`, { sets: { nodes: (api.next[id] ?? []).slice(0, perPage) } }]));
    }
    const pairs = [...query.matchAll(/e(\d+)_(\d+): event\(/g)];
    if (pairs.length) {
      asked.push(...pairs.map(([, eventId, playerId]) => `e${eventId}_${playerId}`));
      return Object.fromEntries(pairs.map(([, eventId, playerId]) => [`e${eventId}_${playerId}`, { sets: { nodes: (api.events[eventId] ?? []).filter((set) => plays(set, playerId)) } }]));
    }
    if (query.includes(': event(')) {
      asked.push(...ids('e', 'event').map((id) => `e${id}`));
      return Object.fromEntries(ids('e', 'event').map((id) => [`e${id}`, { sets: { pageInfo: { totalPages: 1 }, nodes: api.events[id] ?? [] } }]));
    }
    if (query.includes(': set(')) {
      asked.push(...ids('s', 'set').map((id) => `s${id}`));
      return Object.fromEntries(ids('s', 'set').map((id) => {
        const pairing = api.pairings[id];
        if (!pairing) return [`s${id}`, null];
        const slots = pairing.sides.map((side) => ({ entrant: side.length ? { participants: side.map((each) => ({ player: { id: each } })) } : null }));
        return [`s${id}`, { state: pairing.state ?? 1, slots }];
      }));
    }
    asked.push('unknown');
    return {};
  });
}

// a channel and a tracked tournament's thread, both keeping what was sent, and posts that can be edited by id
function fakeChannel() {
  const sent = [];
  const edits = [];
  const posted = new Set();
  const sender = (channelId) => async (payload) => {
    sent.push({ ...payload, channelId });
    const message = { id: `m${sent.length}`, channelId };
    posted.add(message.id);
    return message;
  };
  const messages = {
    fetch: async (id) => ({ id }),
    edit: async (id, payload) => {
      if (!posted.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      edits.push([id, payload]);
    },
  };
  const thread = { id: 'thread-7', send: sender('thread-7') };
  return {
    id: 'c1', sent, edits, send: sender('c1'),
    threads: { fetch: async (id) => { assert.equal(id, 'thread-7'); return thread; } },
    client: { channels: { fetch: async () => ({ messages }) } },
  };
}

const run = async (channel) => {
  await tracker.followNextOpponents(channel);
  await tracker.postNextOpponents(channel);
};
const titles = (channel) => channel.sent.map((each) => each.embeds[0]?.data.title);

beforeEach(() => {
  Object.assign(state, {
    messages: {}, players: {}, links: {}, tournaments: {}, nextPings: [], nextPosted: [], nextPosts: [], buttons: [],
    threads: { 'tournament/weekly': { id: 'thread-7', at: now, channelId: 'c1', messageId: 'starter', pinned: false } },
  });
});

test('a /notify next person gets their first opponent with a ping, at an untracked tournament', async () => {
  // linked, so known without being tracked
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  const startAt = now + 1800;
  serve({ next: { 10: [unplayed('501', [10, 99], { round: 1, tournament: elsewhere, station: 4, startAt })] } });
  const channel = fakeChannel();
  await run(channel);

  assert.deepEqual(asked, ['p10']);
  assert.equal(channel.sent.length, 1);
  const [message] = channel.sent;
  assert.equal(message.channelId, 'c1');
  assert.equal(message.content, '<@d10> Next opponent');
  assert.deepEqual(message.allowedMentions, { users: ['d10'] });
  const card = message.embeds[0].data;
  assert.equal(card.title, 'Next opponent · Active vs Opponent');
  assert.equal(card.color, colors.live);
  assert.equal(card.url, 'https://www.start.gg/tournament/elsewhere/event/singles/set/501');
  assert.equal(card.author.name, 'Active');
  // the station and the time the TO set, on the round's line
  assert.equal(card.description.split('\n')[0], `**Winners round 1** · Singles · **Station 4** · <t:${startAt}:t>`);
  // about them, against the opponent known only from the set
  assert.equal(message.components[0].toJSON().components[0].custom_id, 'private:h2h:active:#99::::');
  assert.deepEqual(state.nextPosted, ['501:10:99']);
  assert.deepEqual(state.nextPosts.map(({ setId, key, channelId, messageId, discordIds, text }) => [setId, key, channelId, messageId, discordIds, text]),
    [['501', '501:10:99', 'c1', 'm1', ['d10'], 'Next opponent']]);
  assert.deepEqual(state.buttons.map(({ setId, messageId }) => [setId, messageId]), [['501', 'm1']]);
});

test('a tracked tournament posts everyone\'s next opponent but leaves round 1 out', async () => {
  state.tournaments = trackedWeekly();
  serve({ events: { 70: [unplayed('601', [30, 40], { round: 1 }), unplayed('602', [20, 99], { round: 2 })] } });
  const channel = fakeChannel();
  await run(channel);

  // nobody has /notify next on, so only the event gets asked about
  assert.deepEqual(asked, ['e70']);
  // nobody tracked in it, so the sides keep start.gg's order
  assert.deepEqual(titles(channel), ['Next opponent · Rival vs Opponent']);
  // no ping, just the card, in the tournament's thread
  assert.equal(channel.sent[0].content, undefined);
  assert.equal(channel.sent[0].channelId, 'thread-7');
  assert.deepEqual(state.nextPosted, ['602:20:99']);
  // nobody the bot knows is in it, and singles still gets the button, about the first side
  assert.equal(channel.sent[0].components[0].toJSON().components[0].custom_id, 'private:h2h:#20:#99::::');
  assert.deepEqual(state.buttons.map(({ setId, channelId }) => [setId, channelId]), [['602', 'thread-7']]);
});

test('round 1 at a tracked tournament still posts for someone with /notify next on', async () => {
  state.tournaments = trackedWeekly();
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  const first = unplayed('611', [10, 99], { round: 1 });
  serve({ next: { 10: [first] }, events: { 70: [first, unplayed('612', [20, 40], { round: 1 })] } });
  const channel = fakeChannel();
  await run(channel);

  assert.deepEqual(asked.toSorted(), ['e70', 'p10']);
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].content, '<@d10> Next opponent');
  assert.equal(channel.sent[0].embeds[0].data.title, 'Next opponent · Active vs Opponent');
  assert.deepEqual(state.nextPosted, ['611:10:99']);
});

test('a round-robin player gets their soonest set only, and the next once they play it', async () => {
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  // one pool, every set filled from the start. only their own sets come back, so the others aren't anyone's soonest
  const pool = [unplayed('623', [10, 40], { round: 3, tournament: elsewhere }), unplayed('621', [10, 20], { round: 1, tournament: elsewhere }),
    unplayed('622', [10, 30], { round: 2, tournament: elsewhere })];
  serve({ next: { 10: pool } });
  const channel = fakeChannel();
  await run(channel);
  assert.deepEqual(titles(channel), ['Next opponent · Active vs Rival']);
  assert.equal(channel.sent[0].content, '<@d10> Next opponent');

  // round 1 played
  api.next[10] = pool.filter((set) => set.id !== '621');
  await run(channel);
  assert.deepEqual(titles(channel), ['Next opponent · Active vs Rival', 'Next opponent · Active vs Third']);
  assert.deepEqual(state.nextPosted, ['621:10:20', '622:10:30']);

  // the same pool at a tracked tournament, where the whole event gets read: one card a player until they play it
  Object.assign(state, { nextPosted: [], nextPosts: [], tournaments: trackedWeekly() });
  const rounds = [[1, [[10, 20], [30, 40]]], [2, [[10, 30], [20, 40]]], [3, [[10, 40], [20, 30]]]];
  const sets = rounds.flatMap(([round, pairs], r) => pairs.map((pair, i) => unplayed(`63${r}${i}`, pair, { round })));
  serve({ next: { 10: sets.filter((set) => set.slots.some((slot) => slot.entrant.participants[0].player.id === 10)) }, events: { 70: sets } });
  const pooled = fakeChannel();
  await run(pooled);
  // round 1 for whoever has a ping. 30 vs 40 is round 1 too, with nobody to ping
  assert.deepEqual(titles(pooled), ['Next opponent · Active vs Rival']);

  // round 1 played: round 2 is everyone's soonest
  const left = sets.filter((set) => set.round !== 1);
  api.next[10] = left.filter((set) => set.slots.some((slot) => slot.entrant.participants[0].player.id === 10));
  api.events[70] = left;
  await run(pooled);
  assert.deepEqual(titles(pooled).slice(1), ['Next opponent · Active vs Third', 'Next opponent · Rival vs Last']);
  assert.deepEqual(pooled.sent.slice(1).map((each) => each.content), ['<@d10> Next opponent', undefined]);
});

test('next off for a tournament posts nothing there, pings included', async () => {
  state.tournaments = trackedWeekly({ next: false });
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  serve({ next: { 10: [unplayed('641', [10, 99])] }, events: { 70: [unplayed('641', [10, 99]), unplayed('642', [20, 30])] } });
  const channel = fakeChannel();
  await run(channel);
  // off for the tournament, so its event isn't read either
  assert.deepEqual(asked, ['p10']);
  assert.equal(channel.sent.length, 0);
  // off isn't consumed, so a set still unplayed when it comes back on posts then
  assert.deepEqual(state.nextPosted, []);
  delete state.tournaments[7].tracked.posts.next;
  await run(channel);
  assert.deepEqual(titles(channel), ['Next opponent · Active vs Opponent', 'Next opponent · Rival vs Third']);

  // the server switch is the default, untracked tournaments included
  Object.assign(state, { nextPosted: [], nextPosts: [], tournaments: {}, messages: { next: false } });
  api.next[10] = [unplayed('643', [10, 99], { tournament: elsewhere })];
  await run(channel);
  assert.equal(channel.sent.length, 2);
  assert.deepEqual(state.nextPosted, []);
  state.messages = {};
  await run(channel);
  assert.equal(channel.sent.length, 3);
  assert.deepEqual(state.nextPosted, ['643:10:99']);
});

test('the same check twice posts once', async () => {
  state.tournaments = trackedWeekly();
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  const set = unplayed('651', [10, 99]);
  serve({
    next: { 10: [set] }, events: { 70: [set, unplayed('652', [20, 30])] }, pairings: { 651: { sides: [[10], [99]] }, 652: { sides: [[20], [30]] } },
  });
  const channel = fakeChannel();
  await run(channel);
  assert.equal(channel.sent.length, 2);
  await run(channel);
  assert.equal(channel.sent.length, 2);
  // saved, so a restart doesn't post them again either
  const saved = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'));
  assert.deepEqual(saved.nextPosted, ['651:10:99', '652:20:30']);
  assert.deepEqual(saved.nextPosts.map(({ key }) => key), ['651:10:99', '652:20:30']);
});

test('a finished set from start.gg is never a next opponent', async () => {
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  // start.gg handing back sets outside the filter: one done and one being played, both sooner than the waiting one
  serve({
    next: {
      10: [unplayed('661', [10, 20], { round: 1, setState: 3, tournament: elsewhere }), unplayed('662', [10, 30], { round: 2, setState: 2, tournament: elsewhere })],
    },
  });
  const channel = fakeChannel();
  await run(channel);
  assert.equal(channel.sent.length, 0);
  assert.deepEqual(state.nextPosted, []);

  // and they don't count toward which set is soonest
  api.next[10].push(unplayed('663', [10, 40], { round: 3, tournament: elsewhere }));
  await run(channel);
  assert.deepEqual(titles(channel), ['Next opponent · Active vs Last']);
});

test('an unplayed set from a tournament long over is left out', async () => {
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  // a bracket abandoned 791 days ago still has sets waiting on start.gg
  const abandoned = { ...elsewhere, slug: 'tournament/abandoned', startAt: now - 791 * DAY, endAt: now - 790 * DAY };
  // and one that hasn't started yet
  const later = { ...elsewhere, slug: 'tournament/later', startAt: now + DAY, endAt: now + DAY + 3600 };
  serve({ next: { 10: [unplayed('671', [10, 99], { tournament: abandoned }), unplayed('672', [10, 20], { tournament: later })] } });
  const channel = fakeChannel();
  await run(channel);
  assert.equal(channel.sent.length, 0);
  assert.deepEqual(state.nextPosted, []);
});

test('doubles pings all four with no Head to head button', async () => {
  state.players = Object.fromEntries([10, 11, 20, 21].map((playerId, i) => [i + 1, { userId: i + 1, playerId, tag: NAMES[playerId], slug: `user/p${playerId}`, discordId: `d${playerId}` }]));
  state.nextPings = ['d10', 'd11', 'd20', 'd21'];
  // start.gg lists the team members in whatever order, the key doesn't care
  const doubles = unplayed('681', [[11, 10], [20, 21]], { tournament: elsewhere });
  serve({ next: { 10: [doubles], 11: [doubles], 20: [doubles], 21: [doubles] } });
  const channel = fakeChannel();
  await run(channel);

  assert.equal(channel.sent.length, 1);
  assert.deepEqual(channel.sent[0].allowedMentions, { users: ['d10', 'd11', 'd20', 'd21'] });
  assert.equal(channel.sent[0].content, '<@d10> <@d11> <@d20> <@d21> Next opponent');
  assert.equal(channel.sent[0].embeds[0].data.title, 'Next opponent · Partner + Active vs Rival + Fourth');
  // /h2h is singles, so no button and nothing to take off later
  assert.deepEqual(channel.sent[0].components, []);
  assert.deepEqual(state.buttons, []);
  assert.deepEqual(state.nextPosted, ['681:10+11:20+21']);

  // the same teams with the slots and players listed the other way round are the same pairing
  api.pairings = { 681: { sides: [[21, 20], [10, 11]] } };
  await run(channel);
  assert.deepEqual(channel.edits, []);
  assert.equal(channel.sent.length, 1);
});

test('turning /notify next on catches a card already posted, pinging just them', async () => {
  state.tournaments = trackedWeekly();
  state.links = {
    d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' },
    d20: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'd20' },
  };
  const set = unplayed('691', [10, 20]);
  serve({ next: { 10: [set], 20: [set] }, events: { 70: [set] }, pairings: { 691: { sides: [[10], [20]] } } });
  const channel = fakeChannel();
  await run(channel);
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].content, undefined);

  state.nextPings = ['d10'];
  await run(channel);
  assert.equal(channel.sent.length, 2);
  // the card again, with just the new ping
  assert.equal(channel.sent[1].content, '<@d10> Next opponent');
  assert.deepEqual(channel.sent[1].allowedMentions, { users: ['d10'] });
  assert.equal(channel.sent[1].embeds[0].data.title, 'Next opponent · Active vs Rival');
  assert.deepEqual(state.nextPosts.map(({ discordIds }) => discordIds), [['d10']]);
  await run(channel);
  assert.equal(channel.sent.length, 2);

  // an hour on the card isn't watched anymore, so someone turning it on then gets nothing
  state.nextPosts[0].at = now - 61 * 60;
  state.nextPings = ['d10', 'd20'];
  await run(channel);
  assert.equal(channel.sent.length, 2);
  assert.deepEqual(state.nextPosts, []);
  assert.deepEqual(state.nextPosted, ['691:10:20']);
});

test('a pairing the TO changes gets crossed out and the new one posts', async () => {
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  serve({ next: { 10: [unplayed('701', [10, 20], { tournament: elsewhere })] }, pairings: { 701: { sides: [[10], [20]] } } });
  const channel = fakeChannel();
  await run(channel);
  assert.deepEqual(titles(channel), ['Next opponent · Active vs Rival']);

  // still the same two, so nothing changes
  await run(channel);
  assert.deepEqual(channel.edits, []);

  // the TO fixed a result and someone else landed in it
  api.pairings[701] = { sides: [[10], [30]] };
  api.next[10] = [unplayed('701', [10, 30], { tournament: elsewhere })];
  await run(channel);
  assert.deepEqual(channel.edits, [['m1', {
    content: '<@d10> ~~Next opponent~~ Changed by the TO', components: [], allowedMentions: { parse: [] },
  }]]);
  assert.deepEqual(titles(channel), ['Next opponent · Active vs Rival', 'Next opponent · Active vs Third']);
  assert.equal(channel.sent[1].content, '<@d10> Next opponent');
  // the struck pairing is forgotten, so the same two back in it would post again
  assert.deepEqual(state.nextPosted, ['701:10:30']);
  assert.deepEqual(state.nextPosts.map(({ key, messageId }) => [key, messageId]), [['701:10:30', 'm2']]);

  // started, so there's nothing left to watch for
  api.pairings[701] = { state: 2, sides: [[10], [40]] };
  api.next[10] = [];
  await run(channel);
  assert.equal(channel.edits.length, 1);
  assert.deepEqual(state.nextPosts, []);

  // a card nobody was pinged on gets just the line
  Object.assign(state, { nextPings: [], tournaments: trackedWeekly() });
  api.events[70] = [unplayed('702', [20, 30])];
  api.pairings[702] = { sides: [[20], [40]] };
  await tracker.postNextOpponents(channel);
  await tracker.followNextOpponents(channel);
  assert.deepEqual(channel.edits[1], ['m3', { content: 'Changed by the TO', components: [], allowedMentions: { parse: [] } }]);
});

test('a pairing the TO changes back posts again', async () => {
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  const pairing = (opponent) => {
    api.pairings[721] = { sides: [[10], [opponent]] };
    api.next[10] = [unplayed('721', [10, opponent], { tournament: elsewhere })];
  };
  serve();
  const channel = fakeChannel();
  pairing(20);
  await run(channel);
  pairing(30);
  await run(channel);
  // the TO undid the fix: back to the first two
  pairing(20);
  await run(channel);
  assert.deepEqual(titles(channel), ['Next opponent · Active vs Rival', 'Next opponent · Active vs Third', 'Next opponent · Active vs Rival']);
  assert.deepEqual(channel.edits.map(([id]) => id), ['m1', 'm2']);
  assert.deepEqual(state.nextPosted, ['721:10:20']);
});

test('a round-robin pool too big for one page reads their own sets in it', async () => {
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  // a pool of 6: five sets each, and start.gg listing the highest ids first cuts round 1 off their page
  const pool = [[20, 1], [30, 2], [40, 3], [50, 4], [60, 5]].map(([opponent, round]) => unplayed(`73${round}`, [10, opponent], { round, tournament: elsewhere }));
  serve({ next: { 10: pool.toReversed() }, events: { 80: [...pool, unplayed('739', [20, 30], { round: 2, tournament: elsewhere })] } });
  const channel = fakeChannel();
  await run(channel);
  // their page came back full, so their sets in that event get read whole, and nobody else's
  assert.deepEqual(asked, ['p10', 'e80_10']);
  assert.deepEqual(titles(channel), ['Next opponent · Active vs Rival']);
  assert.deepEqual(state.nextPosted, ['731:10:20']);

  // nothing new until they play it
  await run(channel);
  assert.equal(channel.sent.length, 1);
  api.events[80] = api.events[80].filter((set) => set.id !== '731');
  api.next[10] = pool.slice(1).toReversed();
  await run(channel);
  assert.deepEqual(titles(channel).slice(1), ['Next opponent · Active vs Third']);
});

test('a full page in a tracked event that gets read whole costs no second request', async () => {
  state.tournaments = trackedWeekly();
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  // a whole pool of 6, five rounds of three sets
  const rounds = [
    [[10, 20], [30, 60], [40, 50]], [[10, 30], [20, 40], [50, 60]], [[10, 40], [30, 50], [20, 60]],
    [[10, 50], [40, 60], [20, 30]], [[10, 60], [20, 50], [30, 40]],
  ];
  const pool = rounds.flatMap((pairs, r) => pairs.map((pair, i) => unplayed(`76${r}${i}`, pair, { round: r + 1 })));
  serve({ next: { 10: pool.filter((set) => plays(set, 10)).toReversed() }, events: { 70: pool } });
  const channel = fakeChannel();
  await run(channel);
  assert.deepEqual(asked, ['e70', 'p10']);
  // round 1 for the one with a ping, and nobody else's round 1
  assert.deepEqual(titles(channel), ['Next opponent · Active vs Rival']);
});

test('a full page from abandoned brackets alone costs no second request', async () => {
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  const abandoned = { ...elsewhere, slug: 'tournament/abandoned', startAt: now - 400 * DAY, endAt: now - 399 * DAY };
  serve({ next: { 10: [1, 2, 3, 4].map((round) => unplayed(`74${round}`, [10, 20 + round], { round, tournament: abandoned })) } });
  const channel = fakeChannel();
  await run(channel);
  assert.deepEqual(asked, ['p10']);
  assert.equal(channel.sent.length, 0);
});

test('a set that empties and fills again with the same players posts once', async () => {
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  state.nextPings = ['d10'];
  const set = unplayed('711', [10, 20], { tournament: elsewhere });
  serve({ next: { 10: [set] }, pairings: { 711: { sides: [[10], [20]] } } });
  const channel = fakeChannel();
  await run(channel);
  assert.equal(channel.sent.length, 1);

  // the TO reset the set feeding it, so a slot is empty and start.gg leaves it out of the next sets
  api.pairings[711] = { sides: [[10], []] };
  api.next[10] = [];
  await run(channel);
  assert.deepEqual(channel.edits, []);
  assert.equal(state.nextPosts.length, 1);

  // the same player won it again
  api.pairings[711] = { sides: [[10], [20]] };
  api.next[10] = [set];
  await run(channel);
  assert.deepEqual(channel.edits, []);
  assert.equal(channel.sent.length, 1);
});

test('no request goes out when nobody has /notify next on and no tracked tournament is live with next on', async () => {
  // off for the one tracked tournament going on, another already over, and a ping with no start.gg to go by
  state.tournaments = {
    ...trackedWeekly({ next: false }),
    8: { id: 8, name: 'Old', slug: 'tournament/old', startAt: now - 3 * DAY, endAt: now - 3 * DAY + 3600, tracked: { by: 'manual', at: 0, posts: {} } },
  };
  state.nextPings = ['nobody'];
  serve();
  const channel = fakeChannel();
  await run(channel);
  assert.deepEqual(asked, []);
  assert.equal(channel.sent.length, 0);

  // next off server-wide, so a /notify next person's sets could only post where a live tracked tournament turned it on
  state.links = { d10: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', discordId: 'd10' } };
  Object.assign(state, { nextPings: ['d10'], messages: { next: false } });
  await run(channel);
  assert.deepEqual(asked, []);
});
