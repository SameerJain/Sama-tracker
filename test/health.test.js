import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';

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

// a raw request, since fetch won't send a path this broken. node's URL parser throws on //[, and a throw in the
// handler used to crash the whole bot from anyone who could reach the port
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: bot\r\nConnection: close\r\n\r\n`));
    let reply = '';
    socket.on('data', (chunk) => { reply += chunk; });
    socket.on('end', () => resolve(reply.split('\r\n')[0]));
    socket.on('error', reject);
  });
}

test('broken request paths get a 404 instead of taking the bot down', async () => {
  const server = startHealth(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const { port } = server.address();
  setHealthReady(true);
  for (const path of ['//[', '//a:b@[x', '//%zz', '/../../etc/passwd']) assert.equal(await rawGet(port, path), 'HTTP/1.1 404 Not Found', path);
  // still answering, and a query string doesn't hide the health check
  assert.deepEqual(await get(port, '/health?from=railway'), { status: 200, body: { status: 'ok' } });
  setHealthReady(false);
  await stopHealth();
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
