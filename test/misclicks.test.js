import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

// posts that turn out wrong get fixed, and commands that are a pain to undo ask first
const directory = mkdtempSync(join(tmpdir(), 'sama-misclicks-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleButton, handleCommand } = await import('../src/commands/index.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const tracker = await import('../src/tracker.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
const crew = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', discordId: 'crew-discord', lastCheck: now };
const event = {
  name: 'Ultimate Singles', slug: 'tournament/local/event/singles', videogame: { id: 1386, displayName: 'Ultimate' },
  tournament: { name: 'Local', slug: 'tournament/local', isOnline: false, images: [] },
};
// crew (player 10, entrant 1) against rival (player 20, entrant 2). scores are crew's then rival's
const setNode = (id, { setState = 3, winner = 1, scores = [2, 1], updatedAt = now - 60 } = {}) => ({
  id, state: setState, completedAt: setState === 3 ? now - 60 : null, updatedAt, fullRoundText: 'Winners Final',
  winnerId: setState === 3 ? winner : null, stream: null, event,
  slots: [[1, 10, 'Crew'], [2, 20, 'Rival']].map(([entrantId, playerId, name], i) => ({
    entrant: { id: entrantId, name, initialSeedNum: i + 1, participants: [{ player: { id: playerId } }] },
    standing: setState === 3 ? { stats: { score: { value: scores[i] } } } : null,
  })),
  games: [],
});

// answers by matching the query, and remembers what was asked
let asked = [];
function mockStartgg(respond) {
  asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    asked.push(query);
    return { ok: true, json: async () => ({ data: respond(query) }) };
  };
}
const setIds = (query) => [...query.matchAll(/s(\d+): set\(id/g)].map(([, id]) => id);

// a channel whose posts come back with ids, and whose messages can be fetched and edited by id
function fakeChannel() {
  const sent = [];
  const edits = [];
  const posted = new Map();
  const known = (id) => {
    if (!posted.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
    return posted.get(id);
  };
  const messages = {
    fetch: async (id) => known(id),
    edit: async (id, payload) => {
      known(id);
      edits.push([id, payload]);
    },
  };
  return {
    sent, edits,
    send: async (payload) => {
      sent.push(payload);
      const message = { id: `m${sent.length}`, channelId: 'c1', embeds: (payload.embeds ?? []).map((embed) => embed.toJSON?.() ?? embed) };
      posted.set(message.id, message);
      return message;
    },
    client: { channels: { fetch: async (id) => { assert.equal(id, 'c1'); return { messages }; } } },
  };
}

test('a set result the TO corrects gets edited, a reset one gets marked, and an hour on it\'s left alone', async () => {
  state.players = { 1: { ...crew, setResults: true } };
  state.messages = {};
  state.posted = [];
  state.dqs = [];
  state.resultPosts = [];
  const channel = fakeChannel();
  mockStartgg((query) => ({ p10: { sets: { nodes: [setNode('701')] } } }));
  await tracker.postNewSets(channel);
  assert.equal(channel.sent.length, 1);
  assert.deepEqual(state.resultPosts.map(({ setId, messageId, outcome, reset }) => [setId, messageId, outcome, reset]), [['701', 'm1', '1:2:1', false]]);

  // the TO had the winner backwards
  let latest = { state: 3, winner: 2, scores: [1, 2] };
  mockStartgg((query) => Object.fromEntries(setIds(query).map((id) => [`s${id}`, query.includes('fullRoundText')
    ? setNode(id, { setState: latest.state, winner: latest.winner, scores: latest.scores })
    : { state: latest.state, winnerId: latest.state === 3 ? latest.winner : null, slots: latest.scores.map((value) => ({ standing: latest.state === 3 ? { stats: { score: { value } } } : null })) }])));
  await tracker.fixCorrectedResults(channel);
  assert.equal(channel.edits.length, 1);
  const [[id, { embeds: [card] }]] = channel.edits;
  assert.equal(id, 'm1');
  assert.equal(card.data.title, 'Set result · W · Rival 2-1 Crew · L');
  assert.match(card.data.description, /^\*\*Corrected by TO\*\*\n/);
  assert.equal(state.resultPosts[0].outcome, '2:1:2');

  // nothing changed since, so only the small request goes out and nothing's edited
  asked = [];
  await tracker.fixCorrectedResults(channel);
  assert.equal(asked.length, 1);
  assert.equal(channel.edits.length, 1);
  assert.equal(asked.filter((query) => query.includes('fullRoundText')).length, 0);

  // reset on start.gg: the card it had stays, marked
  latest = { state: 1, scores: [null, null] };
  await tracker.fixCorrectedResults(channel);
  assert.equal(channel.edits.length, 2);
  const marked = channel.edits[1][1].embeds[0].data;
  assert.match(marked.title, /^Reset by TO · Set result · W · Crew 2-1 Rival · L$/);
  assert.match(marked.description, /The TO reset this set on start\.gg/);
  assert.equal(state.resultPosts[0].reset, true);
  await tracker.fixCorrectedResults(channel);
  assert.equal(channel.edits.length, 2, 'marked twice');

  // reported again, even with the result it first had, and the card comes back
  latest = { state: 3, winner: 1, scores: [2, 1] };
  await tracker.fixCorrectedResults(channel);
  assert.equal(channel.edits.length, 3);
  assert.equal(channel.edits[2][1].embeds[0].data.title, 'Set result · W · Crew 2-1 Rival · L');
  assert.equal(state.resultPosts[0].reset, false);

  // a deleted set counts as reset, and a deleted post stops being watched
  latest = { state: 3, winner: 1, scores: [2, 1] };
  mockStartgg(() => ({ s701: null }));
  state.resultPosts[0].messageId = 'gone';
  await tracker.fixCorrectedResults(channel);
  assert.deepEqual(state.resultPosts, []);

  // an hour after it went out, start.gg isn't asked anymore
  state.resultPosts = [{ setId: '701', channelId: 'c1', messageId: 'm1', at: now - 61 * 60, outcome: '1:2:1', reset: false }];
  mockStartgg(() => assert.fail('nothing to check'));
  await tracker.fixCorrectedResults(channel);
  assert.deepEqual(state.resultPosts, []);
});

test('a match call that stays called does not ping again, and one that goes back to waiting is taken back', async () => {
  state.players = { 1: crew };
  state.callPings = ['crew-discord'];
  state.dqWarnPings = ['crew-discord']; // old saved opt-ins must not cause a second ping
  state.messages = { calls: true };
  state.called = [];
  state.callPosts = [];
  state.buttons = [];
  const channel = fakeChannel();
  let setState = 6;
  mockStartgg((query) => (query.includes('set(id:')
    ? Object.fromEntries(setIds(query).map((id) => [`s${id}`, { state: setState }]))
    : { p10: { sets: { nodes: setState === 6 ? [setNode('801', { setState: 6 })] : [] } } }));
  await tracker.postMatchCalls(channel);
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].content, `<@crew-discord> You're up`);
  assert.deepEqual(state.callPosts.map(({ setId, messageId, discordIds, text }) => [setId, messageId, discordIds, text]), [['801', 'm1', ['crew-discord'], `You're up`]]);

  // start.gg can leave a set called after play starts, so a called set never gets another ping
  await tracker.followCalls(channel);
  assert.equal(channel.sent.length, 1);

  state.callPosts[0].calledAt = now - 6 * 60;
  await tracker.followCalls(channel);
  assert.equal(channel.sent.length, 1);

  // uncalled: the ping gets crossed out, and calling it again pings again
  setState = 1;
  await tracker.followCalls(channel);
  assert.deepEqual(channel.edits, [['m1', { content: `<@crew-discord> ~~You're up~~ Uncalled by the TO, wait for the next call`, allowedMentions: { parse: [] } }]]);
  assert.deepEqual(state.callPosts, []);
  assert.ok(!state.called.includes('801'));
  setState = 6;
  await tracker.postMatchCalls(channel);
  assert.equal(channel.sent.length, 2);
  assert.match(channel.sent[1].content, /You're up/);

  // started, so there's nothing left to say
  setState = 2;
  await tracker.followCalls(channel);
  assert.equal(channel.edits.length, 1);
  assert.equal(channel.sent.length, 2);
  assert.deepEqual(state.callPosts, []);

  // a 15 minute old call isn't asked about
  state.callPosts = [{ setId: '801', channelId: 'c1', messageId: 'm3', calledAt: now - 16 * 60, discordIds: [] }];
  mockStartgg(() => assert.fail('nothing to check'));
  await tracker.followCalls(channel);
  assert.deepEqual(state.callPosts, []);
});

test('placements that went out projected get edited once start.gg has them final', async () => {
  state.players = { 1: crew };
  state.messages = {};
  const channel = fakeChannel();
  const entry = { userId: 1, eventId: 50, event: 'Ultimate Singles', eventSlug: event.slug, entrants: 32, started: true, done: false, final: false, placement: 5 };
  const tournament = { id: 5, name: 'Local', slug: 'tournament/local', startAt: now - 30 * 3600, endAt: now - 26 * 3600, entries: [entry], userIds: [1] };
  await tracker.postResults(tournament, channel);
  assert.equal(channel.sent.length, 1);
  assert.match(channel.sent[0].embeds[0].data.description, /5th .*\(projected\)/);
  assert.deepEqual(tournament.projected.results, [{ channelId: 'c1', messageId: 'm1' }]);
  assert.deepEqual(tournament.projected.top8, []);

  // looked at hourly
  mockStartgg(() => assert.fail('too soon'));
  await tracker.correctPlacements(tournament, channel);

  // still not final, so it waits
  let standing = { placement: 5, isFinal: false };
  let eventState = 'ACTIVE';
  mockStartgg(() => ({ tournament: { ...tournament, entries: undefined, events: [{ id: 50, name: 'Ultimate Singles', slug: event.slug, state: eventState, numEntrants: 32, u1: { id: 9, isDisqualified: false, standing } }] } }));
  tournament.projected.checkedAt = now - 3601;
  await tracker.correctPlacements(tournament, channel);
  assert.equal(channel.edits.length, 0);
  assert.ok(tournament.projected);

  standing = { placement: 4, isFinal: true };
  eventState = 'COMPLETED';
  tournament.projected.checkedAt = now - 3601;
  await tracker.correctPlacements(tournament, channel);
  assert.equal(channel.edits.length, 1);
  const [[id, { embeds: [card] }]] = channel.edits;
  assert.equal(id, 'm1');
  assert.match(card.data.description, /4th/);
  assert.doesNotMatch(card.data.description, /projected/);
  assert.equal(tournament.projected, undefined);

  // after 3 days it stops looking
  tournament.projected = { at: now - 4 * 86400, results: [{ channelId: 'c1', messageId: 'm1' }], top8: [] };
  mockStartgg(() => assert.fail('given up'));
  await tracker.correctPlacements(tournament, channel);
  assert.equal(tournament.projected, undefined);
});

test('an event named for Melee but tagged as Ultimate counts as Melee, and the other way around', async () => {
  const tagged = (name, id, displayName) => ({ name, videogame: { id, displayName } });
  assert.deepEqual(startgg.namedGame(tagged('Melee Singles', 1386, 'Ultimate')).videogame, { id: 1, displayName: 'Melee' });
  assert.deepEqual(startgg.namedGame(tagged('SSBU Singles', 1, 'Melee')).videogame, { id: 1386, displayName: 'Ultimate' });
  // naming both, naming neither, or another game's event is left the way the TO tagged it
  for (const event of [tagged('Melee + Ultimate Doubles', 1386, 'Ultimate'), tagged('Singles', 1386, 'Ultimate'), tagged('Project+ (Melee rules)', 33602, 'Project+')]) {
    assert.deepEqual(startgg.namedGame(event), event);
  }

  mockStartgg(() => ({ player: { sets: { pageInfo: { totalPages: 1 }, nodes: [{ ...setNode('901'), event: { ...event, name: 'Melee Singles' } }] } } }));
  const { sets } = await startgg.getSetHistory(10, 1);
  assert.ok(startgg.isMelee(sets[0]));
  assert.equal(sets[0].event.videogame.displayName, 'Melee');
  assert.match(asked[0], /event \{ name slug videogame/);
});

// a slash command run by someone with Manage Server, recording what it answers
function command(commandName, { group = null, subcommand = null, values = {}, user = 'runner' } = {}) {
  const calls = [];
  const run = {
    calls, commandName, user: { id: user }, memberPermissions: { has: () => true },
    options: { getSubcommandGroup: () => group, getSubcommand: () => subcommand, getString: (name) => values[name] ?? null, getBoolean: (name) => values[name] ?? null, getInteger: (name) => values[name] ?? null, getUser: () => null, getMember: () => null },
    reply: async (result) => calls.push(['reply', result]),
    deferReply: async () => { run.deferred = true; },
    editReply: async (result) => calls.push(['edit', result]),
  };
  return run;
}

// pressing a button on the message something answered with
async function press(message, label, user = 'runner') {
  const button = message.components.flatMap((row) => row.toJSON().components).find((each) => each.label === label);
  assert.ok(button, `no ${label} button`);
  const calls = [];
  const click = {
    calls, customId: button.custom_id, user: { id: user }, isButton: () => true,
    reply: async (result) => calls.push(['reply', result]),
    update: async (result) => calls.push(['update', result]),
    editReply: async (result) => calls.push(['edit', result]),
    followUp: async (result) => calls.push(['followUp', result]),
  };
  await handleButton(click);
  return click;
}

const labels = (message) => message.components.flatMap((row) => row.toJSON().components).map((button) => button.label);

test('/track remove asks first, only whoever ran it can answer, and Undo puts them back with their settings', async () => {
  const rival = { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', setResults: true, streamAlerts: false, callPings: true, lastCheck: now };
  state.players = { 2: rival };
  const ask = () => {
    const run = command('track', { subcommand: 'remove', values: { player: '2' } });
    return handleCommand(run).then(() => run.calls[0][1]);
  };

  let asked = await ask();
  assert.equal(asked.content, 'Stop tracking Rival? Their set result and stream alert settings go with them.');
  assert.deepEqual(labels(asked), ['Stop tracking', 'Cancel']);
  assert.deepEqual(asked.allowedMentions, { parse: [] });
  assert.ok(state.players[2], 'removed before anyone answered');

  const stranger = await press(asked, 'Stop tracking', 'someone-else');
  assert.deepEqual(stranger.calls.map(([kind]) => kind), ['reply']);
  assert.equal(stranger.calls[0][1].content, 'Only whoever ran `/track remove` can press this.');
  assert.equal(stranger.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.ok(state.players[2]);

  const cancelled = await press(asked, 'Cancel');
  assert.deepEqual(cancelled.calls, [['update', { content: 'Still tracking Rival.', components: [], allowedMentions: { parse: [] } }]]);
  assert.ok(state.players[2]);

  asked = await ask();
  const removed = (await press(asked, 'Stop tracking')).calls[0][1];
  assert.equal(removed.content, 'Stopped tracking Rival.');
  assert.deepEqual(labels(removed), ['Undo']);
  assert.equal(state.players[2], undefined);

  const undone = (await press(removed, 'Undo')).calls[0][1];
  assert.equal(undone.content, 'Tracking Rival again, with the same settings as before.');
  assert.deepEqual(state.players[2], rival);

  // a second press of the same Undo has nothing to put back
  const again = await press(removed, 'Undo');
  assert.deepEqual(again.calls.map(([kind]) => kind), ['update', 'followUp']);
  assert.deepEqual(again.calls[0][1], { components: [] });
  assert.match(again.calls[1][1].content, /^Too late to undo\./);
  assert.equal(again.calls[1][1].flags, MessageFlags.Ephemeral);
});

test('Undo comes off after a minute, and pressing it then puts nothing back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  state.players = { 2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastCheck: now } };
  const run = command('track', { subcommand: 'remove', values: { player: '2' } });
  await handleCommand(run);
  const confirmed = await press(run.calls[0][1], 'Stop tracking');
  const removed = confirmed.calls[0][1];

  t.mock.timers.tick(60_001);
  await new Promise(setImmediate);
  assert.deepEqual(confirmed.calls.at(-1), ['edit', { components: [] }]);
  const late = await press(removed, 'Undo');
  assert.match(late.calls[1][1].content, /Too late to undo/);
  assert.equal(state.players[2], undefined);
});

test('/unlink has an Undo that brings the link back, unless they linked someone else since', async () => {
  const linked = { userId: 3, playerId: 30, tag: 'Opponent', slug: 'user/opponent', discordId: 'runner' };
  state.players = {};
  state.links = { runner: linked };
  const unlink = async () => {
    const run = command('unlink');
    await handleCommand(run);
    return run.calls[0][1];
  };

  let reply = await unlink();
  assert.match(reply.content, /^Unlinked from Opponent\./);
  assert.equal(reply.flags, MessageFlags.Ephemeral);
  assert.deepEqual(labels(reply), ['Undo']);
  assert.equal(state.links.runner, undefined);
  assert.equal((await press(reply, 'Undo')).calls[0][1].content, 'Linked to Opponent again.');
  assert.deepEqual(state.links.runner, linked);

  reply = await unlink();
  state.links.runner = { ...linked, userId: 4, tag: 'Newer' };
  assert.equal((await press(reply, 'Undo')).calls[0][1].content, 'You\'ve linked Newer since, so that stays.');
  assert.equal(state.links.runner.tag, 'Newer');

  // nothing to undo
  delete state.links.runner;
  const nobody = command('unlink');
  await handleCommand(nobody);
  assert.equal(nobody.calls[0][1].content, 'You weren\'t linked.');
  assert.equal(nobody.calls[0][1].components, undefined);
});

test('/track posts for everyone off and /tournament remove ask first, and /track posts goes straight through when nothing would change', async () => {
  state.players = {
    1: { ...crew, setResults: true },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', setResults: false },
  };
  const sets = command('track', { subcommand: 'posts', values: { player: 'all', sets: 'off', stream: 'on' } });
  await handleCommand(sets);
  const asked = sets.calls[0][1];
  assert.match(asked.content, /^Turn set results off for all 2 tracked players\?/);
  assert.deepEqual(labels(asked), ['Turn off', 'Cancel']);
  assert.equal(state.players[1].setResults, true);
  // the stream alerts asked for along with it go through on the same press
  assert.equal((await press(asked, 'Turn off')).calls[0][1].content, 'Set results off and stream alerts on for everyone.');
  assert.ok(Object.values(state.players).every((player) => player.setResults === false && player.streamAlerts === true));

  const already = command('track', { subcommand: 'posts', values: { player: 'all', sets: 'off' } });
  await handleCommand(already);
  assert.equal(already.calls[0][1].content, 'Set results off for everyone.');
  assert.equal(already.calls[0][1].components, undefined);

  // Undo puts back its switches and reminder progress
  const switches = { by: 'manual', at: now, sets: true, stream: true, top8: true, reminders: true };
  state.tournaments = { 6: { id: 6, slug: 'tournament/soon', name: 'Soon', entries: [], userIds: [], tracked: switches, reminder: { next: 1 } } };
  const remove = command('t-o', { group: 'tournament', subcommand: 'remove', values: { tournament: 'soon' } });
  await handleCommand(remove);
  const question = remove.calls[0][1];
  assert.equal(question.content, 'Stop tracking Soon? Its sets, stream alerts, top 8s and reg reminders stop.');
  assert.equal((await press(question, 'Cancel')).calls[0][1].content, 'Still tracking Soon.');
  assert.ok(state.tournaments[6].tracked);
  const stopped = (await press(question, 'Stop tracking')).calls[0][1];
  assert.equal(stopped.content, 'Stopped tracking Soon.');
  assert.deepEqual(labels(stopped), ['Undo']);
  assert.equal(state.tournaments[6].tracked, undefined);
  // the prompt's still there, so a late press finds it gone
  assert.equal((await press(question, 'Stop tracking')).calls[0][1].content, 'It isn\'t tracked anymore.');
  assert.equal((await press(stopped, 'Undo')).calls[0][1].content, 'Tracking Soon again, with the same settings as before.');
  assert.deepEqual(state.tournaments[6].tracked, switches);
  assert.deepEqual(state.tournaments[6].reminder, { next: 1 });
});

test('/notify player:all asks first and changes every tracked player with Discord', async () => {
  state.players = {
    1: crew,
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
    3: { userId: 3, playerId: 30, tag: 'No Discord', slug: 'user/no-discord' },
  };
  state.callPings = [];
  state.streamPings = ['old-discord'];
  state.regPings = [];
  state.regDmPings = [];
  state.startDmPings = [];

  const run = command('notify', { values: { player: 'all', calls: 'on', streams: 'off' } });
  await handleCommand(run);
  const asked = run.calls[0][1];
  assert.equal(asked.content, 'Change /notify for 2 tracked players? Match calls on and stream alerts off. 1 tracked player without Discord on start.gg will be skipped.');
  assert.deepEqual(labels(asked), ['Change pings', 'Cancel']);
  assert.deepEqual(state.callPings, []);

  const changed = (await press(asked, 'Change pings')).calls[0][1];
  assert.equal(changed.content, 'Updated /notify for 2 tracked players. Skipped 1 without Discord on start.gg.');
  assert.deepEqual(state.callPings.toSorted(), ['crew-discord', 'rival-discord']);
  assert.deepEqual(state.streamPings, ['old-discord']);
});

test('/notify player:all all:on fits discord\'s button limit and changes all five', async () => {
  state.players = {
    1: crew,
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
    3: { userId: 3, playerId: 30, tag: 'No Discord', slug: 'user/no-discord' },
  };
  state.callPings = [];
  state.streamPings = [];
  state.regPings = [];
  state.regDmPings = [];
  state.startDmPings = [];

  const run = command('notify', { values: { player: 'all', all: 'on' }, user: 'runner-with-a-long-discord-id-1234567890' });
  await handleCommand(run);
  const asked = run.calls[0][1];
  assert.match(asked.content, /Change \/notify for 2 tracked players\?.*Match calls on.*stream alerts on.*reg reminders on.*registration DMs on.*start DMs on/);
  for (const row of asked.components) {
    for (const button of row.toJSON().components) assert.ok(button.custom_id.length <= 100, `button id too long: ${button.custom_id.length}`);
  }
  const changed = (await press(asked, 'Change pings', 'runner-with-a-long-discord-id-1234567890')).calls[0][1];
  assert.equal(changed.content, 'Updated /notify for 2 tracked players. Skipped 1 without Discord on start.gg.');
  assert.deepEqual(state.callPings.toSorted(), ['crew-discord', 'rival-discord']);
  assert.deepEqual(state.streamPings.toSorted(), ['crew-discord', 'rival-discord']);
  assert.deepEqual(state.regPings.toSorted(), ['crew-discord', 'rival-discord']);
  assert.deepEqual(state.regDmPings.toSorted(), ['crew-discord', 'rival-discord']);
  assert.deepEqual(state.startDmPings.toSorted(), ['crew-discord', 'rival-discord']);
});

test('/t-o cleanup untracks players whose start.gg discord is not in the server, keeps ones with none unless asked, and Undo puts them back', async () => {
  state.players = {
    1: { ...crew },
    2: { userId: 2, playerId: 20, tag: 'Away', slug: 'user/away', discordId: 'away-discord' },
    3: { userId: 3, playerId: 30, tag: 'Unknown', slug: 'user/unknown' },
  };
  const cleanup = async (values = {}) => {
    const run = command('t-o', { subcommand: 'cleanup', values });
    run.guild = { members: { fetch: async ({ user: ids }) => new Map(ids.filter((id) => id === 'crew-discord').map((id) => [id, {}])) } };
    await handleCommand(run);
    return run.calls.find(([kind]) => kind === 'edit')[1];
  };

  const asked = await cleanup();
  assert.equal(asked.content, 'Untrack 1 player whose start.gg Discord isn\'t in this server? Away.\n-# 1 player has no Discord on start.gg and stays. `no_discord:True` untracks them too');
  assert.deepEqual(asked.allowedMentions, { parse: [] });
  assert.ok(state.players[2], 'removed before anyone answered');
  const removed = (await press(asked, 'Untrack them')).calls[0][1];
  assert.equal(removed.content, 'Untracked 1 player.');
  assert.deepEqual(Object.keys(state.players).sort(), ['1', '3']);
  assert.equal((await press(removed, 'Undo')).calls[0][1].content, 'Tracking 1 player again, with the same settings as before.');
  assert.equal(state.players[2].discordId, 'away-discord');

  const both = await cleanup({ no_discord: true });
  assert.equal(both.content, 'Untrack 2 players whose start.gg Discord isn\'t in this server or who have none? Away and Unknown.');
  assert.equal((await press(both, 'Cancel')).calls[0][1].content, 'Everyone stays tracked.');
  assert.equal(Object.keys(state.players).length, 3);
  // cancelled, so a press after has nothing to go on
  assert.match((await press(both, 'Untrack them')).calls[0][1].content, /doesn't work anymore/);

  state.players = { 1: { ...crew } };
  assert.equal((await cleanup()).content, 'Everyone tracked has their start.gg Discord in this server.');

  // it untracks other people, so someone who isn't a TO is turned away before it looks
  const refused = command('t-o', { subcommand: 'cleanup' });
  refused.memberPermissions = { has: () => false };
  await handleCommand(refused);
  assert.equal(refused.calls[0][1].content, 'Only TOs can clean up the track list. `/t-o role list` shows who they are.');
});

test('a name that matches nobody suggests the closest tracked, linked or watchlisted one', async () => {
  state.players = { 1: { ...crew, tag: 'Tea | Leo' }, 2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival' } };
  state.links = {};
  state.slippi = { 'crew-uid': { uid: 'crew-uid', code: 'CREW#1', name: 'Crew', userId: 1, rank: 'Gold 2' } };
  const answer = async (name, options) => {
    const run = command(name, options);
    await handleCommand(run);
    return run.calls[0][1].content;
  };

  // part of the name, or a typo or two away
  assert.equal(await answer('stats', { values: { player: 'leo' } }), 'Nobody tracked or linked goes by `leo`. Did you mean **Tea | Leo**?');
  assert.equal(await answer('stats', { values: { player: 'Tea Loe' } }), 'Nobody tracked or linked goes by `Tea Loe`. Did you mean **Tea | Leo**?');
  assert.equal(await answer('track', { subcommand: 'remove', values: { player: 'Rivl' } }), 'Nobody tracked goes by `Rivl`. Did you mean **Rival**?');
  // nothing close, or an id from a list that's changed since
  assert.match(await answer('stats', { values: { player: 'zzzz' } }), /^Only tracked or linked players can be picked/);
  assert.match(await answer('stats', { values: { player: '12345' } }), /^Only tracked or linked players can be picked/);

  assert.equal(await answer('slippi', { subcommand: 'remove', values: { player: 'Crw' } }), 'They aren\'t on the Slippi watchlist. Did you mean **Crew (CREW#1)**?');
  assert.equal(await answer('slippi', { subcommand: 'remove', values: { player: 'CREW#2' } }), 'They aren\'t on the Slippi watchlist. Did you mean **Crew (CREW#1)**?');
  assert.match(await answer('slippi', { subcommand: 'remove', values: { player: 'Falco' } }), /`\/slippi leaderboard` shows who is/);
  assert.equal(await answer('slippi', { subcommand: 'rank', values: { player: 'Crewe' } }), 'Nobody on the watchlist goes by that. Did you mean **Crew (CREW#1)**?');
});
