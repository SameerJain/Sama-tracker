import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const directory = mkdtempSync(join(tmpdir(), 'sama-health-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { healthPort, isHealthReady, setHealthReady, startHealth, stopHealth } = await import('../src/health.js');
const tracker = await import('../src/tracker.js');
after(async () => { await stopHealth(); rmSync(directory, { recursive: true, force: true }); });

async function get(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

test('the health endpoint answers 503 while starting and 200 once ready', async () => {
  const server = startHealth(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const { port } = server.address();
  // starting over returns the same server instead of a second one
  assert.equal(startHealth(0), server);

  assert.deepEqual(await get(port, '/health'), { status: 503, body: { status: 'starting' } });
  setHealthReady(true);
  assert.ok(isHealthReady());
  assert.deepEqual(await get(port, '/health'), { status: 200, body: { status: 'ok' } });
  // stopping flips it back, so railway stops sending traffic before the shutdown
  setHealthReady(false);
  assert.deepEqual(await get(port, '/health'), { status: 503, body: { status: 'starting' } });
  assert.equal((await get(port, '/nope')).status, 404);

  await stopHealth();
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  // stopping twice is fine, and the server starts again after
  await stopHealth();
  setHealthReady(true);
  const again = startHealth(port);
  await new Promise((resolve) => again.on('listening', resolve));
  assert.deepEqual(await get(port, '/health'), { status: 200, body: { status: 'ok' } });
  await stopHealth();
  setHealthReady(false);
});

test('a taken port logs and leaves the bot running instead of crashing', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const holder = http.createServer();
  await new Promise((resolve) => holder.listen(0, resolve));
  const { port } = holder.address();

  const server = startHealth(port);
  await new Promise((resolve) => server.on('error', resolve));
  assert.match(errors.mock.calls[0].arguments[0], new RegExp(`couldn't listen on port ${port}.*keeps running`));
  // forgotten, so it can be started again once the port is free
  assert.notEqual(startHealth(0), server);
  await stopHealth();
  await new Promise((resolve) => holder.close(resolve));
});

test('the health port comes from PORT, defaulting to 3000', () => {
  assert.equal(healthPort({ PORT: '8080' }), 8080);
  assert.equal(healthPort({ PORT: 'abc' }), 3000);
  assert.equal(healthPort({}), 3000);
});

test('stopping the tracker is safe even when it never started', () => {
  assert.equal(typeof tracker.stopTracking, 'function');
  tracker.stopTracking();
});
