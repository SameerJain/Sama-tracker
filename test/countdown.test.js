import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settle } from './fixtures.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-countdown-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
// start.gg requests go out 800ms apart, a fake clock gets through minutes of them right away
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
const { state } = await import('../src/store.js');
const { handleCommand } = await import('../src/commands/index.js');
const startgg = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { mock.timers.reset(); globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

// moves the fake clock until it settles
test('progress counts the command\'s own requests and a turn for each one another command still has', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { currentUser: { id: 1 } } }) });
  const ask = (n) => Promise.all(Array.from({ length: n }, () => startgg.checkToken()));
  let before;
  let after;
  const other = startgg.asCommand(() => ask(3));
  const mine = startgg.asCommand(async () => {
    const progress = startgg.commandProgress();
    const requests = ask(10);
    before = progress();
    await requests;
    after = progress();
  });
  await settle(Promise.all([other, mine]));
  // 10 of its own, and the other command's 3 take turns with them
  assert.deepEqual([before.sent, before.waiting], [0, 10]);
  assert.ok(Math.abs(before.seconds - 13 * 0.8) < 0.9, `${before.seconds}`);
  assert.deepEqual([after.sent, after.waiting, after.seconds], [10, 0, 0]);
});

// pages is how many each history has. Them has plenty, so /scout verbose has to go well past the quick report
function fakeStartgg(pages) {
  const asked = [];
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    let data;
    if (query.includes('user(id:') && query.includes('authorizations')) data = { u1: { slug: 'user/me', player: { gamerTag: 'Me' }, authorizations: [{ externalId: 'me' }] } };
    else if (query.includes('user(slug:')) data = { user: { id: 2, slug: 'user/them', player: { id: 99, gamerTag: 'Them' } } };
    else if (query.includes('events(query:')) data = { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    else {
      asked.push(`${query.includes('selections') ? 'characters' : 'sets'} ${variables.id} ${variables.page}`);
      const node = {
        id: `${variables.id}-${variables.page}`, completedAt: 1000 - variables.page, fullRoundText: 'Winners Round 1', winnerId: variables.id,
        event: { slug: 'tournament/t/event/e', videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'T' } },
        slots: [variables.id, 5].map((id) => ({ entrant: { id, name: `P${id}`, initialSeedNum: 1, participants: [{ player: { id } }] }, standing: { stats: { score: { value: 1 } } } })),
        games: [],
      };
      data = { player: { sets: { pageInfo: { totalPages: pages[variables.id] ?? 1 }, nodes: [node] } } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
  return asked;
}

function scoutInteraction(edits, verbose) {
  const interaction = {
    commandName: 'scout', user: { id: 'me' },
    options: { getSubcommand: () => null, getString: (name) => (name === 'profile' ? 'start.gg/user/them' : null), getBoolean: (name) => name === 'verbose' && verbose },
    deferReply: async () => Object.assign(interaction, { deferred: true, ephemeral: true }),
    editReply: async (result) => {
      // slow enough that one is usually still going out when the answer is ready
      if (typeof result === 'string') await new Promise((resolve) => setTimeout(resolve, 14_000));
      edits.push(result);
    },
    followUp: async (result) => edits.push(result),
  };
  return interaction;
}

const COUNTDOWN = /^\*\*Full report on its way\*\* · (\d+) of (\d+) start\.gg requests done, about \d+ (seconds|minutes) left\n-# start\.gg allows 80 requests a minute/;

test('/scout verbose shows the quick report while the rest loads, counts up, then the full report replaces it', async () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Me', slug: 'user/me', discordId: 'me' } };
  const asked = fakeStartgg({ 99: 40 });
  const edits = [];
  await settle(startgg.asCommand(() => handleCommand(scoutInteraction(edits, true))));

  // the quick report goes up with the first countdown
  const preview = edits.find((edit) => typeof edit === 'object' && COUNTDOWN.test(edit.content ?? ''));
  assert.ok(preview, 'quick report shown while the rest loads');
  assert.equal(preview.embeds.length, 1);
  assert.equal(preview.embeds[0].toJSON().title, 'Scouting Them');
  const countdown = edits.filter((edit) => typeof edit === 'string' && COUNTDOWN.test(edit));
  const done = [preview.content, ...countdown].map((edit) => Number(edit.match(COUNTDOWN)[1]));
  assert.deepEqual(done, done.toSorted((a, b) => a - b), 'only goes up');

  // the full report comes after every countdown edit and clears its text
  const answer = edits.findLastIndex((edit) => typeof edit === 'object' && edit.content === null);
  assert.ok(answer > edits.findLastIndex((edit) => typeof edit === 'string'));
  assert.equal(edits[answer].embeds[0].toJSON().author.name, 'Scouting');

  // 30 pages of their sets and 20 of characters, none fetched twice
  assert.equal(asked.filter((each) => each.startsWith('sets 99')).length, 30);
  assert.equal(asked.filter((each) => each.startsWith('characters 99')).length, 20);
  assert.equal(new Set(asked).size, asked.length);
});

test('a second /scout verbose soon after is all cached, so it answers without a preview or a countdown', async () => {
  const asked = fakeStartgg({ 99: 40 });
  const edits = [];
  await settle(startgg.asCommand(() => handleCommand(scoutInteraction(edits, true))));
  // only the caller check and the opponent lookup, and their events
  assert.deepEqual(asked, []);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].content, null);
});
