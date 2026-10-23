import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

// someone's commands taking turns. start.gg requests go out 800ms apart, a fake clock gets through them right away
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
const directory = mkdtempSync(join(tmpdir(), 'sama-queue-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { inTurn, QUEUED_PER_PERSON } = await import('../src/commands/turns.js');
const { reportButton } = await import('../src/commands/shared.js');
const startgg = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { mock.timers.reset(); globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

let requests = 0;
globalThis.fetch = async () => {
  requests++;
  return { ok: true, status: 200, json: async () => ({ data: { currentUser: { id: 1 } } }) };
};

// moves the fake clock until check passes
async function until(check) {
  for (let i = 0; i < 2000 && !check(); i++) {
    mock.timers.tick(100);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(check(), 'never happened');
}

// a discord interaction with what the line touches
function fake({ user = 'u1', commandName = 'stats', customId = null, guildId = null } = {}) {
  const calls = [];
  const run = {
    calls, user: { id: user }, commandName, customId, guildId, deferred: false, replied: false,
    isButton: () => Boolean(customId),
    deferReply: async (options) => { calls.push(['defer', options]); run.deferred = true; },
    editReply: async (content) => { calls.push(['edit', content]); },
    reply: async (content) => { calls.push(['reply', content]); run.replied = true; },
  };
  return run;
}

const edits = (run) => run.calls.filter(([kind]) => kind === 'edit').map(([, content]) => content);

test('a second command answers right away, says it is queued, and only asks start.gg once the first is done', async () => {
  let releaseFirst;
  const holding = new Promise((resolve) => { releaseFirst = resolve; });
  const first = fake();
  const firstDone = inTurn(first, async () => {
    await first.deferReply();
    await startgg.checkToken();
    await holding;
  });
  await until(() => requests === 1);

  const second = fake({ commandName: 'h2h' });
  const order = [];
  const secondDone = inTurn(second, async () => {
    await second.deferReply();
    order.push('answered');
    await startgg.checkToken();
    order.push('asked start.gg');
  });
  await until(() => edits(second).length === 1);
  assert.deepEqual(order, ['answered']);
  assert.equal(edits(second)[0], '**Queued** behind your /stats. This one starts when it\'s done.');

  // someone else never waits on them
  const other = fake({ user: 'u2' });
  let otherAsked = false;
  inTurn(other, () => startgg.checkToken().then(() => { otherAsked = true; }));
  await until(() => otherAsked);
  assert.deepEqual(other.calls, []);
  assert.deepEqual(order, ['answered']);

  releaseFirst();
  await until(() => order.length === 2);
  await Promise.all([firstDone, secondDone]);
  assert.equal(requests, 3);
});

test('a queued command that needs nothing from start.gg answers without waiting', async () => {
  let releaseFirst;
  const holding = new Promise((resolve) => { releaseFirst = resolve; });
  const firstDone = inTurn(fake(), () => holding);
  const help = fake({ commandName: 'help' });
  await inTurn(help, () => help.reply({ embeds: [] }));
  assert.deepEqual(help.calls.map(([kind]) => kind), ['reply']);
  releaseFirst();
  await firstDone;
});

test('the queued line says how long the one ahead has left, counting other people in the line', async () => {
  const before = requests;
  const first = fake();
  const firstDone = inTurn(first, async () => {
    await first.deferReply();
    await Promise.all(Array.from({ length: 20 }, () => startgg.checkToken()));
  });
  // someone else's command takes turns with it, so it has longer to go
  const otherDone = inTurn(fake({ user: 'u2' }), () => Promise.all(Array.from({ length: 20 }, () => startgg.checkToken())));
  await new Promise((resolve) => setImmediate(resolve));

  const button = fake({ customId: reportButton('Full report', 'more', 'scout', { opponent: { slug: 'user/abc' } }).toJSON().custom_id });
  const buttonDone = inTurn(button, async () => {
    await button.deferReply();
    await startgg.checkToken();
  });
  await until(() => edits(button).length === 1);
  // 40 requests at 800ms apart less the one already out, and buttons go by the report they run
  assert.match(edits(button)[0], /^\*\*Queued\*\* behind your \/stats, which has about 40 seconds left\. This one starts when it's done\.$/);
  await until(() => requests === before + 41);
  await Promise.all([firstDone, otherDone, buttonDone]);
});

test(`past ${QUEUED_PER_PERSON} waiting, the next is turned away and only they see why`, async () => {
  let release;
  const holding = new Promise((resolve) => { release = resolve; });
  const going = Array.from({ length: QUEUED_PER_PERSON + 1 }, () => inTurn(fake(), () => holding));
  const extra = fake();
  let ran = false;
  assert.equal(await inTurn(extra, () => { ran = true; }), false);
  assert.equal(ran, false);
  assert.deepEqual(extra.calls, [['reply', { content: `You have ${QUEUED_PER_PERSON + 1} commands going already. Try again once one is done.`, flags: MessageFlags.Ephemeral }]]);
  release();
  await Promise.all(going);
  // the line is clear again
  assert.equal(await inTurn(fake(), () => {}), true);
});

test('a slow command in one server never holds up the same person in another', async () => {
  let releaseFirst;
  const holding = new Promise((resolve) => { releaseFirst = resolve; });
  const firstDone = inTurn(fake({ guildId: 'g1' }), () => holding);
  await new Promise((resolve) => setImmediate(resolve));

  // the same user in another server answers and asks start.gg without waiting
  const other = fake({ guildId: 'g2' });
  let asked = false;
  const secondDone = inTurn(other, async () => {
    await other.deferReply();
    await startgg.checkToken();
    asked = true;
  });
  await until(() => asked);
  await secondDone;
  assert.deepEqual(other.calls.map(([kind]) => kind), ['defer'], 'no queued line for another server');
  releaseFirst();
  await firstDone;
});

test('the waiting room is per server: a full line in one turns away nobody in another', async () => {
  let release;
  const holding = new Promise((resolve) => { release = resolve; });
  const going = Array.from({ length: QUEUED_PER_PERSON + 1 }, () => inTurn(fake({ guildId: 'g1' }), () => holding));
  await new Promise((resolve) => setImmediate(resolve));

  const stranger = fake({ guildId: 'g2' });
  let ran = false;
  assert.equal(await inTurn(stranger, () => { ran = true; }), true);
  assert.equal(ran, true);

  const extra = fake({ commandName: 'h2h', guildId: 'g1' });
  let extraRan = false;
  assert.equal(await inTurn(extra, () => { extraRan = true; }), false);
  assert.equal(extraRan, false);
  assert.match(extra.calls[0][1].content, /You have 4 commands going already/);
  release();
  await Promise.all(going);
});

test('a command that throws still lets the next one go', async () => {
  const failed = inTurn(fake(), async () => {
    await startgg.checkToken();
    throw new Error('broke');
  });
  const next = fake();
  let asked = false;
  const nextDone = inTurn(next, async () => {
    await next.deferReply();
    await startgg.checkToken();
    asked = true;
  });
  const threw = assert.rejects(failed, /broke/);
  await until(() => asked);
  await threw;
  await nextDone;
});
