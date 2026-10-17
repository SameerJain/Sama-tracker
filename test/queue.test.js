import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';

// start.gg requests go out 800ms apart, a fake clock gets through minutes of them right away
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
const startgg = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { mock.timers.reset(); globalThis.fetch = originalFetch; });

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

const okFetch = () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) });
};

test('a burst of commands all gets through, one request every 800ms', async () => {
  okFetch();
  let calls = 0;
  const counting = globalThis.fetch;
  globalThis.fetch = async (...args) => { calls++; return counting(...args); };
  const start = Date.now();
  const finished = await settle(Promise.all(Array.from({ length: 5 }, () => startgg.asCommand(async () => {
    for (let n = 0; n < 20; n++) await startgg.checkToken();
  }))));
  assert.equal(finished.length, 5);
  assert.equal(calls, 100);
  assert.equal(startgg.queueLength(), 0);
  // 100 requests at 800ms apart, so nothing skipped the rate limit
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 79_000, `${elapsed}ms for 100 requests`);
  assert.ok(elapsed < 100_000, `${elapsed}ms for 100 requests`);
});

test('a small command takes turns with a big one instead of waiting behind it', async () => {
  okFetch();
  let calls = 0;
  const counting = globalThis.fetch;
  globalThis.fetch = async (...args) => { calls++; return counting(...args); };
  const start = Date.now();
  let smallDone;
  const big = startgg.asCommand(async () => {
    for (let n = 0; n < 30; n++) await startgg.checkToken();
  });
  const small = startgg.asCommand(async () => {
    for (let n = 0; n < 2; n++) await startgg.checkToken();
    smallDone = Date.now() - start;
  });
  await settle(Promise.all([big, small]));
  assert.equal(calls, 32);
  assert.equal(startgg.queueLength(), 0);
  // two of its own slots plus a turn each for the big one, not 30 slots behind it
  assert.ok(smallDone < 10_000, `${smallDone}ms`);
});

test('429s push everything back 15 seconds, then every request still goes through', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    // the first three go out before the token notices the other copy
    if (calls <= 3) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  };
  const start = Date.now();
  const seen = [];
  await settle(Promise.all([1, 2].map(() => startgg.asCommand(async () => {
    for (let n = 0; n < 3; n++) await startgg.checkToken();
    seen.push(startgg.commandProgress()());
  }))));
  // six requests plus one retry for each 429
  assert.equal(calls, 9);
  assert.deepEqual(seen.map((progress) => progress.waiting), [0, 0]);
  assert.equal(seen.reduce((sum, progress) => sum + progress.sent, 0), 9);
  assert.equal(seen.reduce((sum, progress) => sum + progress.limited, 0), 3);
  assert.equal(startgg.queueLength(), 0);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 45_000, `${elapsed}ms`);
  assert.ok(elapsed < 120_000, `${elapsed}ms`);
});

test("a command's requests go ahead of the background checks", async () => {
  const order = [];
  globalThis.fetch = async (_url, options) => {
    order.push(JSON.parse(options.body).query.includes('currentUser') ? 'command' : 'background');
    return { ok: true, status: 200, json: async () => ({ data: { currentUser: { id: 1 }, u1: { slug: 'user/t', player: { gamerTag: 'T' }, authorizations: [] } } }) };
  };
  const background = startgg.inBackground(() => startgg.getProfiles(['1']));
  const command = startgg.asCommand(() => startgg.checkToken());
  const [profiles] = await settle(Promise.all([background, command]));
  assert.deepEqual(order, ['command', 'background']);
  assert.equal(profiles[0][1].tag, 'T');
  assert.equal(startgg.queueLength(), 0);
});
