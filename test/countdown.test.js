import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-countdown-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
// the jokes would call claude on import
delete process.env.ANTHROPIC_API_KEY;
// start.gg requests go out 800ms apart, a fake clock gets through minutes of them right away
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands.js');
const startgg = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { mock.timers.reset(); globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

// moves the fake clock until it settles
async function settle(promise) {
  let done = false;
  promise.finally(() => { done = true; }).catch(() => {});
  while (!done) {
    mock.timers.tick(100);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return promise;
}

test('the wait counts the command\'s own requests and a turn for each one another command still has', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { currentUser: { id: 1 } } }) });
  const ask = (n) => Promise.all(Array.from({ length: n }, () => startgg.checkToken()));
  let seconds;
  const other = startgg.asCommand(() => ask(3));
  const mine = startgg.asCommand(async () => {
    const wait = startgg.commandWait();
    const requests = ask(10);
    seconds = wait();
    await requests;
    // nothing left
    assert.equal(Math.round(wait()), 0);
  });
  await settle(Promise.all([other, mine]));
  // 10 of its own, and the other command's 3 take turns with them
  assert.ok(Math.abs(seconds - 13 * 0.8) < 0.9, `${seconds}`);
});

// Them has 40 pages of sets and 40 of characters, so /scout verbose is about a minute of requests
function respond(query, variables) {
  if (query.includes('user(id:') && query.includes('authorizations')) return { u1: { slug: 'user/me', player: { gamerTag: 'Me' }, authorizations: [{ externalId: 'me' }] } };
  if (query.includes('user(slug:')) return { user: { id: 2, slug: 'user/them', player: { id: 99, gamerTag: 'Them' } } };
  if (query.includes('events(query:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
  const node = {
    id: `${variables.id}-${variables.page}`, completedAt: 1000 - variables.page, fullRoundText: 'Winners Round 1', winnerId: variables.id,
    event: { slug: 'tournament/t/event/e', videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'T' } },
    slots: [variables.id, 5].map((id) => ({ entrant: { id, name: `P${id}`, initialSeedNum: 1, participants: [{ player: { id } }] }, standing: { stats: { score: { value: 1 } } } })),
    games: [],
  };
  return { player: { sets: { pageInfo: { totalPages: variables.id === 99 ? 40 : 1 }, nodes: [node] } } };
}

test('a slow /scout verbose counts down in its thinking reply, then the answer replaces it', async () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Me', slug: 'user/me', discordId: 'me' } };
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    return { ok: true, json: async () => ({ data: respond(query, variables) }) };
  };
  const edits = [];
  const interaction = {
    commandName: 'scout', user: { id: 'me' },
    options: { getSubcommand: () => null, getString: () => 'start.gg/user/them', getBoolean: () => true },
    deferReply: async () => Object.assign(interaction, { deferred: true, ephemeral: true }),
    editReply: async (result) => {
      // slow enough that one is usually still going out when the answer is ready
      if (typeof result === 'string') await new Promise((resolve) => setTimeout(resolve, 14_000));
      edits.push(result);
    },
    followUp: async (result) => edits.push(result),
  };
  await settle(startgg.asCommand(() => handleCommand(interaction)));

  const countdown = edits.filter((edit) => typeof edit === 'string');
  assert.ok(countdown.length >= 2, `${countdown.length} countdown edits`);
  for (const edit of countdown) assert.match(edit, /^Scouting Them's whole start\.gg history\. About \d+ (seconds|minutes) left, since start\.gg only allows 80 requests a minute\./);
  const left = countdown.map((edit) => Number(edit.match(/About (\d+)/)[1]) * (edit.includes('minutes') ? 60 : 1));
  assert.deepEqual(left, left.toSorted((a, b) => b - a), 'counts down');
  // the answer comes after every countdown edit and clears its text
  const answer = edits.findIndex((edit) => typeof edit === 'object');
  assert.ok(answer > edits.findLastIndex((edit) => typeof edit === 'string'));
  assert.equal(edits[answer].content, null);
  assert.equal(edits[answer].embeds[0].toJSON().title, 'Them');
});
