import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbedBuilder, MessageFlags } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-buttons-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { handleButton, buttonFailed } = await import('../src/commands/index.js');
const { reportButton, readButton, parseSince, buttonRow, sendEmbeds, h2hButton } = await import('../src/commands/shared.js');
const { setFallbackImage } = await import('../src/embeds/index.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ data: respond(JSON.parse(options.body)) }) });
}

const crew = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', discordId: 'crew-discord' };
const rival = { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival' };

// a press of this button on a short report that has it. records every call in order.
// messageId is which message it's on: same button, same message shares a Full report swap
function press(button, { ephemeral = false, user = 'crew-discord', messageId = 'm1' } = {}) {
  const calls = [];
  const run = {
    customId: button.toJSON().custom_id, calls, user: { id: user },
    message: { id: messageId, content: '', embeds: [new EmbedBuilder().setTitle('Short report')], components: buttonRow(button), flags: { has: () => ephemeral } },
    isButton: () => true,
    deferUpdate: async () => { calls.push(['update']); run.deferred = true; },
    deferReply: async () => { calls.push(['defer']); run.deferred = true; },
    editReply: async (result) => calls.push(['edit', result]),
    deleteReply: async () => calls.push(['delete']),
    followUp: async (result) => calls.push(['followUp', result]),
  };
  return run;
}

test('a button carries the report, profile slugs and options in its id, within discord\'s 100 characters', () => {
  const button = reportButton('Full report', 'more', 'h2h', { player: crew, opponent: rival, melee: true }).toJSON();
  assert.equal(button.custom_id, 'more:h2h:crew:rival:melee:::');
  assert.equal(button.label, 'Full report');
  assert.deepEqual(readButton(button.custom_id), { action: 'more', command: 'h2h', player: 'crew', opponent: 'rival', melee: true, game: null, since: null, venue: null });
  assert.equal(readButton(reportButton('Full report', 'more', 'characters', { player: crew, game: 1 }).toJSON().custom_id).game, 1);
  // too long for discord, or nobody to look up again, means no button instead of a broken one
  assert.equal(reportButton('Full report', 'more', 'stats', { player: { slug: `user/${'x'.repeat(100)}` } }), null);
  assert.equal(reportButton('Full report', 'more', 'stats', { player: { tag: 'No Slug' } }), null);
  assert.deepEqual(buttonRow(null, false, 0), []);
});

test('a button id at exactly 100 characters fits, and 101 breaks it on purpose', () => {
  const slug = (n) => `user/${'x'.repeat(n)}`;
  const options = (n) => ({ player: { slug: slug(n) }, opponent: { slug: slug(32) }, melee: true, since: '2026-01-01', venue: 'offline' });
  const fit = reportButton('Full report', 'more', 'h2h', options(32));
  assert.ok(fit, 'exactly 100 should fit');
  assert.equal(fit.toJSON().custom_id.length, 100);
  // one character more is no button instead of a broken one
  assert.equal(reportButton('Full report', 'more', 'h2h', options(33)), null);
});

test('since and venue ride along in the button id, and old buttons still read without them', () => {
  const button = reportButton('Full report', 'more', 'stats', { player: crew, since: '2026-01-01', venue: 'offline' }).toJSON();
  assert.equal(button.custom_id, 'more:stats:crew::::2026-01-01:offline');
  assert.deepEqual(readButton(button.custom_id), { action: 'more', command: 'stats', player: 'crew', opponent: '', melee: false, game: null, since: '2026-01-01', venue: 'offline' });
  // buttons posted before the filters split short
  assert.deepEqual(readButton('more:h2h:crew:rival:melee:'), { action: 'more', command: 'h2h', player: 'crew', opponent: 'rival', melee: true, game: null, since: null, venue: null });
});

test('since takes a YYYY-MM-DD date and nothing else', () => {
  assert.deepEqual(parseSince(null), { since: null });
  assert.equal(parseSince('2026-01-01').since, Date.UTC(2026, 0, 1) / 1000);
  for (const junk of ['yesterday', '2026-13-01', '2026-02-30', '01-01-2026', '2026-1-1']) {
    assert.match(parseSince(junk).error, /Use YYYY-MM-DD/, junk);
  }
});

test('a button looks players up again: tracked ones from the list, anyone else on start.gg by profile slug', async () => {
  state.players = { 1: crew };
  state.links = {};
  const slugs = [];
  mockApi(({ query, variables }) => {
    if (query.includes('user(slug:')) {
      slugs.push(variables.slug);
      return { user: { id: 3, slug: 'user/opponent', player: { id: 31, gamerTag: 'Opponent' }, authorizations: [] } };
    }
    if (query.includes('events(query:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
  });
  const run = press(reportButton('Full report', 'more', 'h2h', { player: crew, opponent: { slug: 'user/opponent' } }));
  await handleButton(run);
  assert.deepEqual(slugs, ['user/opponent']);
  const [kind, answer] = run.calls.at(-1);
  assert.equal(kind, 'edit');
  assert.equal(answer.embeds[0].data.title, 'Crew vs Opponent');
});

test('a press that fails puts the report back the way it was and tells only whoever pressed it', async () => {
  state.players = { 1: crew };
  state.links = {};
  mockApi(({ query }) => (query.includes('user(slug:') ? { user: null } : assert.fail('nothing to look up for nobody')));
  const run = press(reportButton('Full report', 'more', 'h2h', { player: crew, opponent: { slug: 'user/gone' } }));
  await handleButton(run);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['update', 'edit', 'edit', 'followUp']);
  assert.ok(run.calls[1][1].components[0].components[0].disabled);
  const [, restored] = run.calls[2];
  assert.deepEqual([restored.content, restored.embeds, restored.components], [null, run.message.embeds, run.message.components]);
  const [, told] = run.calls[3];
  assert.equal(told.flags, MessageFlags.Ephemeral);
  assert.equal(told.content, 'Couldn\'t find a start.gg account for that player. Run `/h2h` again.');

  // a button from a report that's since gone away
  globalThis.fetch = async () => assert.fail('no start.gg lookup');
  const stale = press(reportButton('Full report', 'more', 'standings', { player: crew }));
  await handleButton(stale);
  assert.match(stale.calls.at(-1)[1].content, /doesn't work anymore, run the command again/);

  // something going wrong in a new report drops its thinking reply and answers privately
  const failed = press(reportButton('H2H vs Rival', 'new', 'h2h', { player: crew, opponent: rival }));
  failed.deferred = true;
  await buttonFailed(failed, 'Something went wrong: start.gg is down');
  assert.deepEqual(failed.calls, [['delete'], ['followUp', { content: 'Something went wrong: start.gg is down', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }]]);
});

test('two presses of a new report button each get an answer, sharing the lookups underneath', async () => {
  const a = { userId: 101, playerId: 1010, tag: 'Alpha', slug: 'user/alpha' };
  const b = { userId: 102, playerId: 1020, tag: 'Beta', slug: 'user/beta' };
  state.players = { 101: a, 102: b };
  state.links = {};
  let fetches = 0;
  mockApi(({ query }) => {
    fetches++;
    if (query.includes('events(query:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
  });
  // one page of meetings, one page per history and per events
  const button = reportButton('H2H vs Beta', 'new', 'h2h', { player: a, opponent: b });
  const first = press(button, { user: 'u1' });
  const second = press(button, { user: 'u2' });
  await Promise.all([handleButton(first), handleButton(second)]);
  // each presser gets their own answer: nothing is deleted, nobody hears it's loading
  for (const [who, run] of [['first', first], ['second', second]]) {
    const answer = run.calls.findLast(([kind]) => kind === 'edit')?.[1];
    assert.match(JSON.stringify(answer.embeds), /Alpha vs Beta/, who);
    assert.ok(run.calls.length > 1, `${who} answers`);
  }
  assert.ok(!second.calls.some(([kind, result]) => kind === 'followUp' && /already working/.test(result?.content ?? '')), 'no loading notice');
  assert.ok(!first.calls.concat(second.calls).some(([kind]) => kind === 'delete'), 'no deleted reply');
  // the history caches share the in-flight lookups, so two at once still cost one page each
  assert.equal(fetches, 5);
  // once it's done the same button runs on its own again, asking nothing new
  const third = press(button, { user: 'u3' });
  await handleButton(third);
  assert.match(JSON.stringify(third.calls.findLast(([kind]) => kind === 'edit')?.[1].embeds), /Alpha vs Beta/);
  assert.equal(fetches, 5);
});

test('a head-to-head button is a shortcut for the short report, in the set\'s game', async () => {
  const a = { userId: 401, playerId: 4010, tag: 'Alpha', slug: 'user/alpha' };
  const b = { userId: 402, playerId: 4020, tag: 'Beta', slug: 'user/beta' };
  const set = (game) => ({
    sides: [
      { id: 1, name: 'Alpha', playerIds: [4010], score: 2 },
      { id: 2, name: 'Beta', playerIds: [4020], score: 1 },
    ],
    event: { name: `${game} Singles`, slug: 'tournament/local/event/singles', videogame: game === 'Melee' ? { id: 1, displayName: 'Melee' } : { id: 1386, displayName: 'Ultimate' } },
  });
  // melee next sets filter to melee, the rest leave the game out for the odds to pick
  assert.match(h2hButton(set('Melee'), a).toJSON().custom_id, /:melee:::/);
  assert.doesNotMatch(h2hButton(set('Ultimate'), a).toJSON().custom_id, /melee/);
  // a display name alone still counts, for sets from before the id rode along
  assert.match(h2hButton({ sides: set('Melee').sides, event: { name: 'Bracket', videogame: { displayName: 'Melee' } } }, a).toJSON().custom_id, /:melee:::/);

  state.players = { 401: a, 402: b };
  state.links = {};
  const meeting = (id, at) => ({
    id, state: 3, completedAt: at, updatedAt: at, fullRoundText: 'Winners Final', winnerId: 1,
    event: { name: 'Ultimate Singles', slug: 'tournament/local/event/singles', videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'Local', isOnline: false } },
    slots: [[1, 4010, 'Alpha'], [2, 4020, 'Beta']].map(([entrantId, playerId, name], i) => ({
      entrant: { id: entrantId, name, initialSeedNum: i + 1, participants: [{ player: { id: playerId } }] },
      standing: { stats: { score: { value: 2 - i } } },
    })),
  });
  mockApi(({ query }) => {
    if (query.includes('events(query:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [meeting('m1', 1000), meeting('m2', 500)] } } };
  });
  const run = press(reportButton('H2H vs Beta', 'new', 'h2h', { player: a, opponent: b }));
  await handleButton(run);
  const [, answer] = run.calls.findLast(([kind]) => kind === 'edit');
  // short, so the record without splits and first played, with nothing more to press
  assert.match(JSON.stringify(answer.embeds), /Alpha 2-0 Beta/);
  assert.doesNotMatch(JSON.stringify(answer.embeds), /First played/);
  assert.doesNotMatch(JSON.stringify(answer.components), /Full report/);
});

test('two Full report presses share one swap, the second just hears it\'s loading', async () => {
  const a = { userId: 201, playerId: 2010, tag: 'Gamma', slug: 'user/gamma' };
  const b = { userId: 202, playerId: 2020, tag: 'Delta', slug: 'user/delta' };
  state.players = { 201: a, 202: b };
  state.links = {};
  let fetches = 0;
  mockApi(({ query }) => {
    fetches++;
    if (query.includes('events(query:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
  });
  const button = reportButton('Full report', 'more', 'h2h', { player: a, opponent: b });
  const first = press(button, { user: 'u1' });
  const second = press(button, { user: 'u2' });
  await Promise.all([handleButton(first), handleButton(second)]);
  // greyed out before anything else, then swapped for the full report
  assert.deepEqual(first.calls.slice(0, 2).map(([kind]) => kind), ['update', 'edit']);
  assert.ok(first.calls[1][1].components.every((row) => row.components.every((button) => button.disabled)));
  assert.match(JSON.stringify(first.calls.findLast(([kind]) => kind === 'edit')?.[1].embeds), /Gamma vs Delta/);
  assert.deepEqual(second.calls.map(([kind]) => kind), ['update', 'followUp']);
  assert.equal(second.calls[1][1].flags, MessageFlags.Ephemeral);
  assert.match(second.calls[1][1].content, /already working/);
  assert.equal(fetches, 5);
});

test('the same Full report on two messages swaps twice, and one with no message just answers', async () => {
  const a = { userId: 301, playerId: 3010, tag: 'Epsilon', slug: 'user/epsilon' };
  const b = { userId: 302, playerId: 3020, tag: 'Zeta', slug: 'user/zeta' };
  state.players = { 301: a, 302: b };
  state.links = {};
  mockApi(({ query }) => {
    if (query.includes('events(query:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
  });
  // different messages are different swaps, so both pressers get the full report
  const button = reportButton('Full report', 'more', 'h2h', { player: a, opponent: b });
  const one = press(button, { user: 'u1', messageId: 'm1' });
  const two = press(button, { user: 'u2', messageId: 'm2' });
  await Promise.all([handleButton(one), handleButton(two)]);
  for (const [who, run] of [['m1', one], ['m2', two]]) {
    assert.match(JSON.stringify(run.calls.findLast(([kind]) => kind === 'edit')?.[1].embeds), /Epsilon vs Zeta/, who);
    assert.ok(!run.calls.some(([kind, result]) => kind === 'followUp' && /already working/.test(result?.content ?? '')), `${who} shares nothing`);
  }
  // a message that went away has nothing to share on, but it still answers
  const gone = press(button, { user: 'u3' });
  delete gone.message.id;
  await handleButton(gone);
  assert.match(JSON.stringify(gone.calls.findLast(([kind]) => kind === 'edit')?.[1].embeds), /Epsilon vs Zeta/);
});

test('a /scout button compares with whoever pressed it, as long as start.gg still has their discord', async () => {
  state.players = { 1: { ...crew, discordId: 'someone-else' } };
  state.links = {};
  mockApi(() => ({ u1: { slug: 'user/crew', player: { gamerTag: 'Crew' }, authorizations: [{ externalId: 'someone-else' }] } }));
  const run = press(reportButton('Full report', 'more', 'scout', { opponent: rival }), { ephemeral: true });
  await handleButton(run);
  assert.equal(run.calls.at(-1)[0], 'followUp');
  assert.match(run.calls.at(-1)[1].content, /^\/scout needs to know who you are on start\.gg/);
});

test('a pressed button on a private report keeps its follow-ups private, and the full report drops the buttons', async () => {
  const calls = [];
  // what discord.js has for a button that deferred an update: it never says whether the message is ephemeral
  const interaction = {
    deferred: true, ephemeral: null,
    message: { flags: { has: (flag) => flag === MessageFlags.Ephemeral } },
    editReply: async (result) => calls.push(['edit', result]),
    followUp: async (result) => calls.push(['followUp', result]),
  };
  await sendEmbeds(interaction, Array.from({ length: 11 }, (_, i) => new EmbedBuilder().setDescription(`card ${i + 1}`)));
  assert.deepEqual(calls.map(([kind]) => kind), ['edit', 'followUp']);
  assert.deepEqual(calls[0][1].components, []);
  assert.equal(calls[1][1].flags, MessageFlags.Ephemeral);
});

// a press whose ack is already dead: the defer throws unknown interaction, so the retry
// delivers the report as a new message. posted collects channel sends, dm collects DM sends
function expiredPress(button, { ephemeral = false, user = 'crew-discord', messageId = 'm1', ack = 10062 } = {}) {
  const posted = [];
  const dm = [];
  const calls = [];
  const dead = async () => {
    const err = new Error('Unknown interaction');
    err.code = ack;
    throw err;
  };
  const message = {
    id: messageId, content: '', embeds: [new EmbedBuilder().setTitle('Short report')],
    components: buttonRow(button), flags: { has: () => ephemeral },
    edit: async (result) => calls.push(['messageEdit', result]),
  };
  const run = {
    customId: button.toJSON().custom_id, calls, posted, dm,
    user: { id: user, createDM: async () => ({ send: async (result) => dm.push(result) }) },
    message, channel: { send: async (result) => posted.push(result) },
    isButton: () => true,
    deferUpdate: async () => {
      if (ack === 40060) run.deferred = true;
      await dead();
    },
    deferReply: async () => {
      if (ack === 40060) run.deferred = true;
      await dead();
    },
    editReply: async (result) => calls.push(['edit', result]),
    followUp: async (result) => calls.push(['followUp', result]),
  };
  return run;
}

test('an expired Full report press runs once more, posting the report as a new message', async () => {
  const a = { userId: 701, playerId: 7010, tag: 'Hotel', slug: 'user/hotel' };
  const b = { userId: 702, playerId: 7020, tag: 'India', slug: 'user/india' };
  state.players = { 701: a, 702: b };
  state.links = {};
  mockApi(({ query }) => {
    if (query.includes('events(query:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
  });
  const run = expiredPress(reportButton('Full report', 'more', 'h2h', { player: a, opponent: b }));
  await handleButton(run);
  // the dead press answers nothing itself, its message just loses the buttons
  assert.deepEqual(run.calls.map(([kind]) => kind), ['messageEdit']);
  assert.ok(run.calls[0][1].components.every((row) => row.components.every((button) => button.disabled)));
  assert.equal(run.posted.length, 2);
  assert.match(run.posted[0].content, /<@crew-discord>.*expired.*Retrying \/h2h/);
  assert.match(JSON.stringify(run.posted[1].embeds), /Hotel vs India/);
  assert.equal(run.dm.length, 0);
});

test('an expired press on an ephemeral or private report retries by DM, never the channel', async () => {
  const a = { userId: 801, playerId: 8010, tag: 'Hotel', slug: 'user/hotel' };
  const b = { userId: 802, playerId: 8020, tag: 'India', slug: 'user/india' };
  state.players = { 801: a, 802: b };
  state.links = {};
  mockApi(({ query }) => {
    if (query.includes('events(query:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
  });
  const quiet = expiredPress(reportButton('Full report', 'more', 'h2h', { player: a, opponent: b }), { ephemeral: true });
  await handleButton(quiet);
  assert.equal(quiet.posted.length, 0);
  assert.equal(quiet.calls.length, 0);
  assert.equal(quiet.dm.length, 2);
  assert.match(quiet.dm[0].content, /expired.*Retrying \/h2h/);
  assert.doesNotMatch(quiet.dm[0].content, /<@/);
  assert.match(JSON.stringify(quiet.dm[1].embeds), /Hotel vs India/);

  // a Head to head button from a match call stays private even though its message is public
  const call = expiredPress(reportButton('Head to head', 'private', 'h2h', { player: a, opponent: b }));
  await handleButton(call);
  assert.equal(call.posted.length, 0);
  assert.match(JSON.stringify(call.dm.at(-1).embeds ?? call.dm.at(-1).content), /Hotel vs India/);
});

test('a press that answers twice keeps the normal swap, with no retry', async () => {
  const a = { userId: 901, playerId: 9010, tag: 'Hotel', slug: 'user/hotel' };
  const b = { userId: 902, playerId: 9020, tag: 'India', slug: 'user/india' };
  state.players = { 901: a, 902: b };
  state.links = {};
  mockApi(({ query }) => {
    if (query.includes('events(query:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
  });
  const run = expiredPress(reportButton('Full report', 'more', 'h2h', { player: a, opponent: b }), { ack: 40060 });
  await handleButton(run);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['edit', 'edit']);
  assert.match(JSON.stringify(run.calls.at(-1)[1].embeds), /Hotel vs India/);
  assert.equal(run.posted.length, 0);
  assert.equal(run.dm.length, 0);
});

test('a retry whose report fails says whose side failed instead of going quiet', async () => {
  const a = { userId: 1001, playerId: 10010, tag: 'Hotel', slug: 'user/hotel' };
  const b = { userId: 1002, playerId: 10020, tag: 'India', slug: 'user/india' };
  state.players = { 1001: a, 1002: b };
  state.links = {};
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const logged = console.error;
  console.error = () => {};
  try {
    const run = expiredPress(reportButton('Full report', 'more', 'h2h', { player: a, opponent: b }));
    await handleButton(run);
    assert.match(run.posted[0].content, /Retrying \/h2h/);
    assert.match(run.posted.at(-1).content, /start\.gg is having trouble/);
  } finally {
    console.error = logged;
  }
});

// a deferred command run this many seconds ago. records replies and channel posts in order
function waited(seconds, { ephemeral = false, customId = null, send } = {}) {
  const calls = [];
  return {
    calls, deferred: true, ephemeral, customId, commandName: 'stats', user: { id: '300' },
    createdTimestamp: Date.now() - seconds * 1000,
    isButton: () => Boolean(customId),
    editReply: async (result) => calls.push(['edit', result]),
    deleteReply: async () => calls.push(['delete']),
    followUp: async (result) => calls.push(['followUp', result]),
    channel: { send: send ?? (async (result) => calls.push(['send', result])) },
  };
}
const cards = (n) => Array.from({ length: n }, (_, i) => new EmbedBuilder().setDescription(`card ${i + 1}`));

test('a public answer over a minute late goes out as a new message pinging whoever asked, and the thinking reply goes', async () => {
  const run = waited(61);
  const row = buttonRow(reportButton('Full report', 'more', 'stats', { player: crew }));
  await sendEmbeds(run, cards(11), row);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['send', 'send', 'delete']);
  const [[, first], [, rest]] = run.calls;
  assert.equal(first.content, '<@300> here\'s your /stats.');
  assert.deepEqual(first.allowedMentions, { users: ['300'] });
  assert.equal(first.embeds.length, 10);
  assert.equal(first.components, row);
  // the rest of it pings nobody
  assert.deepEqual(rest.allowedMentions, { parse: [] });

  // a Full report press keeps the report it was swapping, without its greyed out buttons
  const swap = waited(90, { customId: reportButton('Full report', 'more', 'h2h', { player: crew, opponent: rival }).toJSON().custom_id });
  await sendEmbeds(swap, cards(1));
  assert.deepEqual(swap.calls.map(([kind]) => kind), ['send', 'edit']);
  assert.equal(swap.calls[0][1].content, '<@300> here\'s your /h2h.');
  assert.deepEqual(swap.calls[1][1], { content: null, components: [] });
});

test('a quick, private or unpostable answer edits the reply the usual way', async () => {
  for (const run of [waited(30), waited(120, { ephemeral: true })]) {
    await sendEmbeds(run, cards(1));
    assert.deepEqual(run.calls.map(([kind]) => kind), ['edit']);
  }
  // no permission to post in the channel
  const blocked = waited(120, { send: async () => { throw new Error('Missing Permissions'); } });
  const logged = console.error;
  console.error = () => {};
  try {
    await sendEmbeds(blocked, cards(1));
  } finally {
    console.error = logged;
  }
  assert.deepEqual(blocked.calls.map(([kind]) => kind), ['edit']);
});

// images.start.gg, where good.jpg downloads and gone.jpg is a 404. fetched lists every download
function mockPictures() {
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    if (String(url).endsWith('gone.jpg')) return { ok: false, status: 404 };
    return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  return fetched;
}
const good = 'https://images.start.gg/images/user/1/good.jpg';
const gone = 'https://images.start.gg/images/user/2/gone.jpg';
const pictured = (n, url) => cards(n).map((card) => card.setThumbnail(url));

test('start.gg pictures go up as files with each message that has them, downloaded once', async () => {
  const fetched = mockPictures();
  const run = waited(5);
  const [first, ...rest] = pictured(11, good);
  first.setAuthor({ name: 'Crew', iconURL: good });
  await sendEmbeds(run, [first, ...rest]);
  assert.deepEqual(fetched, [good]);
  assert.deepEqual(run.calls.map(([kind]) => kind), ['edit', 'followUp']);
  for (const [, sent] of run.calls) {
    assert.deepEqual(sent.files.map((file) => file.name), ['picture-0.jpg']);
    assert.ok(sent.embeds.every((card) => card.data.thumbnail.url === 'attachment://picture-0.jpg'));
  }
  assert.equal(first.data.author.icon_url, 'attachment://picture-0.jpg');
});

test('a start.gg picture that won\'t download comes off so the avatar stands in, and other links stay links', async () => {
  const avatar = 'https://cdn.discordapp.com/avatars/1/bot.png';
  setFallbackImage(avatar);
  try {
    const fetched = mockPictures();
    const run = waited(5);
    const [broken] = pictured(1, gone);
    broken.setAuthor({ name: 'Crew', iconURL: gone, url: 'https://start.gg/user/crew' });
    await sendEmbeds(run, [broken]);
    const [[, sent]] = run.calls;
    assert.deepEqual(sent.files, []);
    assert.equal(sent.embeds[0].data.thumbnail.url, avatar);
    // the author keeps its name and link
    assert.deepEqual(JSON.parse(JSON.stringify(sent.embeds[0])).author, { name: 'Crew', url: 'https://start.gg/user/crew' });

    const elsewhere = waited(5);
    await sendEmbeds(elsewhere, pictured(1, 'https://images.example/crew.png'));
    assert.equal(elsewhere.calls[0][1].embeds[0].data.thumbnail.url, 'https://images.example/crew.png');
    assert.deepEqual(fetched, [gone]);
  } finally {
    setFallbackImage(null);
  }
});

test('a reply that hasn\'t deferred does before downloading, and one without Attach Files keeps the link', async () => {
  const fetched = mockPictures();
  const calls = [];
  const quick = {
    user: { id: '300' },
    deferReply: async () => { calls.push(['defer']); quick.deferred = true; },
    reply: async (result) => calls.push(['reply', result]),
    editReply: async (result) => calls.push(['edit', result]),
  };
  await sendEmbeds(quick, pictured(1, good));
  assert.deepEqual(calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.equal(calls[1][1].files.length, 1);

  fetched.length = 0;
  const blocked = { ...waited(5), appPermissions: { has: () => false } };
  await sendEmbeds(blocked, pictured(1, good));
  assert.deepEqual(fetched, []);
  assert.deepEqual(blocked.calls[0][1].files, []);
  assert.equal(blocked.calls[0][1].embeds[0].data.thumbnail.url, good);
});
