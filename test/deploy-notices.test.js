import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-deploy-notices-'));
process.env.STATE_DIR = directory;
process.env.MULTI_GUILD = 'true';
delete process.env.ANTHROPIC_API_KEY;
const { state, forGuild, cleanState } = await import('../src/store.js');
const { dropGuildChannel, postStartNotice, setBotClient } = await import('../src/tracker.js');
const { setFallbackImage } = await import('../src/embeds/index.js');
setFallbackImage('https://example.com/avatar.png');
after(() => rmSync(directory, { recursive: true, force: true }));

const deploy = { id: 'release-1', at: 100, message: 'Fix commands' };
let channels;
beforeEach(() => {
  for (const id of Object.keys(state.guilds)) dropGuildChannel(id);
  state.guilds = {};
  state.deploy = deploy;
  channels = new Map();
  setBotClient({ channels: { fetch: async id => channels.get(id) } });
});

function addServer(id, { fail = false, language = 'en' } = {}) {
  const sent = [];
  const channel = {
    id: `${id}-posts`, isTextBased: () => true, sent, fail,
    send: async payload => {
      if (channel.fail) throw new Error('Missing Permissions');
      sent.push(payload);
    },
  };
  channels.set(channel.id, channel);
  Object.assign(forGuild(id), { channelId: channel.id, messages: { language } });
  return channel;
}

test('each server gets one update in its own language, including after a restart', async () => {
  const first = addServer('first');
  const second = addServer('second', { language: 'es' });
  await postStartNotice({ deploy });
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 1);
  assert.equal(first.sent[0].embeds[0].data.title, 'Bot updated');
  assert.notEqual(second.sent[0].embeds[0].data.title, 'Bot updated');
  state.guilds = cleanState(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8'))).guilds;
  await postStartNotice({ deploy });
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 1);
  await postStartNotice({ deploy: { ...deploy, id: 'release-2' } });
  assert.equal(first.sent.length, 2);
  assert.equal(second.sent.length, 2);
});

test('a failed send retries only the server that missed it', async () => {
  const first = addServer('first');
  const second = addServer('second', { fail: true });
  await postStartNotice({ deploy });
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 0);
  second.fail = false;
  await postStartNotice({ deploy });
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 1);
});

test('a server configured after startup still gets the current update', async () => {
  const first = addServer('first');
  forGuild('second');
  await postStartNotice({ deploy });
  const second = addServer('second');
  await postStartNotice({ deploy });
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 1);
});

test('overlapping checks never duplicate a server update', async () => {
  const channel = addServer('first');
  await Promise.all([postStartNotice({ deploy }), postStartNotice({ deploy })]);
  assert.equal(channel.sent.length, 1);
});

test('an outage on the same deployment still gets a back online notice', async () => {
  const channel = addServer('first');
  await postStartNotice({ deploy });
  await postStartNotice({ deploy, outage: { from: 100, to: 1000 } });
  assert.equal(channel.sent.length, 2);
  assert.equal(channel.sent[1].embeds[0].data.title, 'Back online');
});

test('saved channel ids survive loading for every server, and malformed ids do not', () => {
  const saved = cleanState({ channelId: 'single', guilds: { first: { channelId: 'first-posts' }, second: { channelId: 'second-posts' }, bad: { channelId: {} } } });
  assert.equal(saved.channelId, 'single');
  assert.equal(saved.guilds.first.channelId, 'first-posts');
  assert.equal(saved.guilds.second.channelId, 'second-posts');
  assert.equal(saved.guilds.bad.channelId, null);
});
