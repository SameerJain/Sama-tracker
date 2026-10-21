import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// wrong shapes in state.json shouldn't stick around to crash whoever reads them
const directory = mkdtempSync(join(tmpdir(), 'sama-store-'));
process.env.STATE_DIR = directory;
delete process.env.ANTHROPIC_API_KEY;
const { cleanState } = await import('../src/store.js');
after(() => rmSync(directory, { recursive: true, force: true }));

test('a non-object file loads as empty instead of spreading keys', async () => {
  assert.deepEqual(cleanState(JSON.parse('"hi"')).players, {});
  assert.deepEqual(cleanState(JSON.parse('[1,2]')).players, {});
  assert.deepEqual(cleanState(null).players, {});
});

test('wrong-typed keys fall back, good ones stay', async () => {
  const cleaned = cleanState({ players: [], posted: {}, toRole: null, weeklyRecap: 'soon', deploy: 7, tournaments: { 1: { id: 1 } }, futureKey: 1 });
  assert.deepEqual(cleaned.players, {});
  assert.deepEqual(cleaned.posted, []);
  assert.deepEqual(cleaned.toRole, { id: null, members: [], seeded: false });
  assert.equal(cleaned.weeklyRecap, null);
  assert.equal(cleaned.deploy, null);
  assert.deepEqual(cleaned.tournaments, { 1: { id: 1 } });
  assert.equal(cleaned.futureKey, 1);
});

test('missing keys fill in without sharing references', async () => {
  const first = cleanState({});
  const second = cleanState({});
  first.players[7] = { tag: 'Leak' };
  assert.deepEqual(second.players, {});
});
