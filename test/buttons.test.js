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
const { reportButton, readButton, parseSince, buttonRow, sendEmbeds } = await import('../src/commands/shared.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ data: respond(JSON.parse(options.body)) }) });
}

const crew = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', discordId: 'crew-discord' };
const rival = { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival' };

// a press of this button on a short report that has it. records every call in order
function press(button, { ephemeral = false, user = 'crew-discord' } = {}) {
  const calls = [];
  const run = {
    customId: button.toJSON().custom_id, calls, user: { id: user },
    message: { content: '', embeds: [new EmbedBuilder().setTitle('Short report')], components: buttonRow(button), flags: { has: () => ephemeral } },
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
  const failed = press(reportButton('Why these odds', 'new', 'predict', { player: crew, opponent: rival }));
  failed.deferred = true;
  await buttonFailed(failed, 'Something went wrong: start.gg is down');
  assert.deepEqual(failed.calls, [['delete'], ['followUp', { content: 'Something went wrong: start.gg is down', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }]]);
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
