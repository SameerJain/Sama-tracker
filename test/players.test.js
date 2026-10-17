import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-players-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
// the jokes would call claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleAutocomplete, handleCommand } = await import('../src/commands.js');
const embeds = await import('../src/embeds.js');
const { predict } = await import('../src/predict.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ data: respond(JSON.parse(options.body)) }) });
}

// a command run by discordId, values are its options. returns the last reply or edit
async function run(commandName, discordId, values = {}) {
  let reply;
  const interaction = {
    commandName, user: { id: discordId },
    options: { getSubcommand: () => null, getString: name => values[name] ?? null, getBoolean: name => values[name] ?? null },
    reply: async result => { reply = result; },
    deferReply: async () => { interaction.deferred = true; },
    editReply: async result => { reply = result; },
  };
  await handleCommand(interaction);
  return reply;
}

const crew = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew' };
const me = { userId: 7, playerId: 70, tag: 'Me', slug: 'user/me' };
const noStats = () => ({ player: { recentStandings: [], sets: { nodes: [] } } });

test('single-player options are optional, and h2h and predict take the opponent first', () => {
  for (const name of ['upcoming', 'recent', 'run', 'progress', 'stats', 'characters']) {
    assert.equal(commands.find(c => c.name === name).options[0].required, false, name);
  }
  for (const name of ['h2h', 'predict']) {
    const [opponent, player, verbose] = commands.find(c => c.name === name).options;
    assert.deepEqual([opponent.name, opponent.required], ['opponent', true]);
    assert.deepEqual([player.name, player.required], ['player', false]);
    assert.equal(verbose.name, 'verbose');
    assert.ok(!verbose.required);
  }
  const melee = commands.find(c => c.name === 'h2h').options.at(-1);
  assert.deepEqual([melee.name, melee.type, melee.required], ['melee', 5, undefined]);
});

test('leaving the player out looks up whoever ran it, from /link or a tracked discord', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = { 'me-discord': me };
  mockApi(noStats);
  assert.equal((await run('stats', 'me-discord')).embeds[0].data.title, 'Me');
  assert.equal((await run('stats', 'crew-discord')).embeds[0].data.title, 'Crew');
});

test('nobody linked, or an untracked pick, says what to do instead', async () => {
  state.players = { 1: crew };
  state.links = {};
  const unlinked = await run('stats', 'stranger');
  assert.ok(unlinked.flags);
  assert.match(unlinked.content, /\/link/);
  assert.match((await run('stats', 'stranger', { player: 'Someone' })).content, /Only tracked players.*\/track add/);
});

test('/link checks the discord on start.gg and does not track them', async () => {
  state.players = { 1: crew };
  state.links = {};
  const profile = authorizations => ({ user: { id: 7, slug: 'user/me', player: { id: 70, gamerTag: 'Me' }, authorizations } });

  mockApi(() => profile([{ externalId: 'me-discord' }]));
  const [linked] = (await run('link', 'me-discord', { profile: 'start.gg/user/me' })).embeds;
  assert.equal(linked.data.title, 'Linked to Me');
  // says which commands work now, that typing your name won't, and that you aren't tracked
  assert.match(linked.data.description, /`\/stats` `\/recent`.*`\/predict`/);
  assert.match(linked.data.description, /Typing your name won't find you/);
  assert.match(linked.data.description, /Not tracked/);
  assert.equal(state.links['me-discord'].playerId, 70);
  assert.deepEqual(Object.keys(state.players), ['1']);
  assert.match(await run('link', 'me-discord', { profile: 'start.gg/user/me' }), /^Already linked to Me/);

  mockApi(() => profile([{ externalId: 'someone-else' }]));
  assert.match(await run('link', 'imposter', { profile: 'start.gg/user/me' }), /different Discord/);
  mockApi(() => profile([]));
  assert.match(await run('link', 'imposter', { profile: 'start.gg/user/me' }), /Connect your Discord/);
  assert.equal(state.links.imposter, undefined);

  assert.match((await run('unlink', 'me-discord')).content, /Unlinked from Me/);
  assert.equal(state.links['me-discord'], undefined);
});

test('/link refuses when commands already find you, and fixes a tracked discord that was out of date', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = {};
  globalThis.fetch = async () => assert.fail('no start.gg lookup when the tracked discord already matches');
  const tracked = await run('link', 'crew-discord', { profile: 'start.gg/user/crew' });
  assert.ok(tracked.flags);
  assert.match(tracked.content, /^No need to link\. You're tracked as Crew/);
  assert.equal(state.links['crew-discord'], undefined);

  // connected discord on start.gg after the last refresh
  state.players = { 1: { ...crew } };
  mockApi(() => ({ user: { id: 1, slug: 'user/crew', player: { id: 10, gamerTag: 'Crew' }, authorizations: [{ externalId: 'crew-discord' }] } }));
  assert.match(await run('link', 'crew-discord', { profile: 'start.gg/user/crew' }), /^No need to link/);
  assert.equal(state.links['crew-discord'], undefined);
  assert.equal(state.players[1].discordId, 'crew-discord');
  mockApi(noStats);
  assert.equal((await run('stats', 'crew-discord')).embeds[0].data.title, 'Crew');
});

test('/link to a different profile says what it replaced', async () => {
  state.players = {};
  state.links = { 'me-discord': { ...me, userId: 8, tag: 'Old Me' } };
  mockApi(() => ({ user: { id: 7, slug: 'user/me', player: { id: 70, gamerTag: 'Me' }, authorizations: [{ externalId: 'me-discord' }] } }));
  const [linked] = (await run('link', 'me-discord', { profile: 'start.gg/user/me' })).embeds;
  assert.match(linked.data.description, /Replaced your link to Old Me/);
  assert.equal(state.links['me-discord'].userId, 7);
});

test('/stream for someone from /link says there are no alerts instead of pretending', async () => {
  state.players = { 1: crew };
  state.links = { 'me-discord': me };
  const reply = await run('stream', 'me-discord', { alerts: 'off' });
  assert.ok(reply.flags);
  assert.match(reply.content, /aren't tracked/);
  assert.equal(state.links['me-discord'].streamAlerts, undefined);
});

test('autocomplete explains an empty list instead of showing nothing', async () => {
  const choicesFor = async typed => {
    let choices;
    await handleAutocomplete({ commandName: 'stats', options: { getSubcommand: () => null, getFocused: () => typed }, respond: async c => { choices = c; } });
    return choices;
  };
  state.players = {};
  assert.deepEqual(await choicesFor('Leo'), [{ name: 'Nobody is tracked yet, /track add someone first', value: 'Leo' }]);
  state.players = { 1: crew };
  assert.deepEqual(await choicesFor('Leo'), [{ name: 'Nobody tracked matches "Leo", /track add them first', value: 'Leo' }]);
  assert.deepEqual(await choicesFor('cr'), [{ name: 'Crew', value: '1' }]);
});

// a won, b lost. seeds and rounds vary so every verbose line has something to show
const a = { ...crew, tag: 'A', playerId: 10 };
const b = { userId: 2, playerId: 20, tag: 'B', slug: 'user/b' };
const meeting = (i, won, { seedA = 3, seedB = 5, round = 'Winners round 1', game = 'Ultimate' } = {}) => ({
  id: String(i), completedAt: 1000 - i, winnerId: won ? 1 : 2, round,
  event: { slug: `tournament/t${i}/event/singles`, videogame: { displayName: game }, tournament: { name: `T${i}` } },
  sides: [{ id: 1, name: 'A', playerIds: [10], score: won ? 2 : 0, seed: seedA }, { id: 2, name: 'B', playerIds: [20], score: won ? 0 : 2, seed: seedB }],
});

test('h2h shows 10 sets by default and everything with splits and streaks when verbose', () => {
  const sets = [
    meeting(0, true), meeting(1, true), meeting(2, false, { seedA: 9, seedB: 2, round: 'Grand Final' }),
    ...Array.from({ length: 9 }, (_, i) => meeting(i + 3, i % 2 === 0, { game: i < 2 ? 'Melee' : 'Ultimate' })),
  ];
  const text = list => list.map(e => e.data.description).join('\n');

  const short = text(embeds.headToHead(a, b, sets));
  assert.equal(short.match(/^[WL] /gm).length, 10);
  assert.match(short, /2 older sets not shown/);

  const full = text(embeds.headToHead(a, b, sets, { verbose: true }));
  assert.equal(full.match(/^[WL] /gm).length, 12);
  assert.match(full, /By game:.*Ultimate.*Melee/);
  assert.match(full, /Seeded above B:\*\* A 7-4/);
  assert.match(full, /Seeded below B:\*\* A 0-1/);
  assert.match(full, /Grand finals:\*\* A 0-1/);
  assert.match(full, /Streak:\*\* A has won the last 2/);
  assert.match(full, /First played:.*T11/);
  assert.equal(embeds.headToHead(a, b, sets)[0].data.footer.text, 'Sama-tracker');
});

test('h2h melee says so in the footer and how many sets in other games it left out', () => {
  const [card] = embeds.headToHead(a, b, [meeting(0, true, { game: 'Melee' })], { melee: true, otherGames: 3 });
  assert.equal(card.data.title, 'A 1-0 B');
  assert.equal(card.data.footer.text, 'Sama-tracker · Melee');
  assert.match(card.data.description, /\n-# Melee only, 3 sets in other games left out$/);

  const [none] = embeds.headToHead(a, b, [], { melee: true, otherGames: 1 });
  assert.equal(none.data.title, 'A vs B');
  assert.equal(none.data.description, 'They haven\'t played each other in Melee singles on start.gg yet.\n-# 1 set in other games left out, leave out `melee` to count them');
  assert.equal(embeds.headToHead(a, b, [], { melee: true })[0].data.description, 'They haven\'t played each other in Melee singles on start.gg yet.');
});

test('h2h melee:True filters the cached histories by game instead of asking start.gg again', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' }, 2: b };
  state.links = {};
  const MELEE = { id: 1, displayName: 'Melee' };
  const ULTIMATE = { id: 1386, displayName: 'Ultimate' };
  const node = (id, videogame, won) => ({
    id, completedAt: 1000 - id, fullRoundText: 'Winners Final', winnerId: won ? 1 : 2,
    event: { slug: `tournament/t${id}/event/singles`, videogame, tournament: { name: `T${id}` } },
    slots: [[1, 10, 'Crew'], [2, 20, 'B']].map(([entrant, player, name]) => ({ entrant: { id: entrant, name, initialSeedNum: entrant, participants: [{ player: { id: player } }] }, standing: null })),
  });
  // both histories get the same page, the set ids dedupe it
  mockApi(() => ({ player: { sets: { pageInfo: { totalPages: 1 }, nodes: [node(1, MELEE, true), node(2, ULTIMATE, false), node(3, MELEE, true)] } } }));
  const all = (await run('h2h', 'crew-discord', { opponent: '2' })).embeds[0].data;
  assert.equal(all.title, 'Crew 2-1 B');
  assert.doesNotMatch(all.description, /other games/);

  globalThis.fetch = async () => assert.fail('melee:True should reuse the histories it already has');
  const melee = (await run('h2h', 'crew-discord', { opponent: '2', melee: true })).embeds[0].data;
  assert.equal(melee.title, 'Crew 2-0 B');
  assert.equal(melee.footer.text, 'Sama-tracker · Melee');
  assert.equal(melee.description.match(/^[WL] /gm).length, 2);
  assert.match(melee.description, /Melee only, 1 set in other games left out/);
  assert.equal((await run('h2h', 'crew-discord', { opponent: '2', melee: false })).embeds[0].data.title, 'Crew 2-1 B');
});

test('predict verbose explains the same odds the short version shows', () => {
  const vs = (i, me, opponent, won) => ({
    id: `${me}-${i}`, completedAt: 1000 - i, winnerId: won ? me : opponent,
    event: { slug: `tournament/t${i % 3}/event/singles`, videogame: { displayName: 'Ultimate' }, tournament: { name: `T${i % 3}` } },
    sides: [{ id: me, name: `P${me}`, playerIds: [me], score: 2, seed: me === 10 ? 2 : 4 }, { id: opponent, name: `P${opponent}`, playerIds: [opponent], score: 1, seed: 8 }],
  });
  const historyA = [vs(0, 10, 20, true), vs(1, 10, 30, true), vs(2, 10, 30, false)];
  const historyB = [vs(0, 20, 30, false), vs(1, 20, 30, false), vs(2, 20, 40, true)];
  const odds = predict(a, b, historyA, historyB);
  const short = embeds.prediction(a, b, odds);
  const full = embeds.prediction(a, b, odds, true);
  assert.equal(full[0].data.title, short[0].data.title);
  const text = full.map(e => e.data.description).join('\n');
  assert.match(text, /How it adds up/);
  assert.match(text, /Head-to-head: counts for \d+%/);
  assert.match(text, /Common opponents\*\*\nP30: A 1-1 · B 0-2/);
  assert.match(text, /Shared brackets/);
});
