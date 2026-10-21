import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crewPlayer, tracked, node, DAY } from './fixtures.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-features-reminders-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands } = await import('../src/commands/index.js');
const embeds = await import('../src/embeds/index.js');
const tracker = await import('../src/tracker.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ data: respond(JSON.parse(options.body)) }) });
}

test('a new deploy saves when it first started, and a restart of the same one keeps that time', (t) => {
  state.deploy = null;
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000 });
  assert.deepEqual(tracker.recordDeploy({ RAILWAY_DEPLOYMENT_ID: 'd1' }), { id: 'd1', at: 1_000_000 });
  assert.deepEqual(state.deploy, { id: 'd1', at: 1_000_000 });
  assert.equal(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).deploy.id, 'd1');

  t.mock.timers.tick(60_000);
  assert.equal(tracker.recordDeploy({ RAILWAY_DEPLOYMENT_ID: 'd1' }), null);
  assert.equal(state.deploy.at, 1_000_000);
  assert.deepEqual(tracker.recordDeploy({ RAILWAY_DEPLOYMENT_ID: 'd2', RAILWAY_GIT_COMMIT_MESSAGE: 'Fixed a few bugs\nmore detail' }), { id: 'd2', at: 1_000_060, message: 'Fixed a few bugs' });
  assert.deepEqual(state.deploy, { id: 'd2', at: 1_000_060, message: 'Fixed a few bugs' });

  // a local run has no deploy id, so it leaves the server's alone and doesn't show it
  assert.equal(tracker.recordDeploy({}), null);
  assert.equal(state.deploy.id, 'd2');
  assert.equal(tracker.deployedAt({}), null);
  assert.equal(tracker.deployedAt({ RAILWAY_DEPLOYMENT_ID: 'd1' }), null);
  assert.equal(tracker.deployedAt({ RAILWAY_DEPLOYMENT_ID: 'd2' }), 1_000_060);
});

test('a bot update posts the date and commit message, never the commit id', async () => {
  const card = embeds.deployUpdate({ id: 'd2', at: 90, message: 'Fixed a few bugs' });
  assert.equal(card.data.title, 'Bot updated');
  assert.equal(card.data.color, 0xec4899);
  assert.match(card.data.description, /\*\*Latest version deployed:\*\* <t:90:R>/);
  assert.match(card.data.description, /Fixed a few bugs/);
  assert.doesNotMatch(card.data.description, /d0beb8f5/);

  const plain = embeds.deployUpdate({ id: 'd3', at: 91 });
  assert.match(plain.data.description, /<t:91:R>/);
  assert.doesNotMatch(plain.data.description, /\n/);

  const sent = [];
  const channel = { send: async (payload) => { sent.push(payload); return { id: 'm1', channelId: 'c1' }; } };
  await tracker.postDeployUpdate(channel, { id: 'd2', at: 90, message: 'Fixed a few bugs' });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.equal(sent[0].embeds[0].data.title, 'Bot updated');
  assert.match(sent[0].embeds[0].data.description, /Fixed a few bugs/);

  // a failed send logs instead of throwing, and the deploy id stays saved so it won't repeat
  await tracker.postDeployUpdate({ send: async () => { throw new Error('down'); } }, { id: 'd2', at: 90 });
});

test('/status shows when the latest version was deployed, and a local run shows its computer instead', () => {
  const info = { startedAt: 100, setCheck: 200, tournamentCheck: 300, players: 2, tournaments: 1, queued: 0 };
  const lines = (more) => embeds.status({ ...info, ...more }).data.description.split('\n');
  assert.deepEqual(lines({ host: null, deployedAt: 90 }).slice(0, 2), ['**Started:** <t:100:R>', '**Latest version deployed:** <t:90:R>']);
  assert.deepEqual(lines({ host: 'DESKTOP-1', deployedAt: null }).slice(0, 2), ['**Started:** <t:100:R> on DESKTOP-1', '**Last set check:** <t:200:R>']);
  assert.equal(lines({}).at(-1), '-# [GitHub](https://github.com/SameerJain/Sama-tracker)');
});

test('/help is one short card by default, and verbose lists every command', () => {
  const [short, ...shortRest] = embeds.help();
  assert.equal(short.data.title, 'Sama-tracker');
  assert.deepEqual(shortRest, []);
  assert.ok(short.data.description.length < 4096);
  assert.match(short.data.description, /`\/help verbose:True`/);
  assert.match(short.data.description, /`\/track add`/);
  assert.doesNotMatch(short.data.description, /Page \d+\//);

  const cards = embeds.help(true);
  assert.equal(cards[0].data.title, 'Sama-tracker');
  assert.ok(cards.length > 1);
  for (const [i, card] of cards.entries()) {
    const page = `-# Page ${i + 1}/${cards.length}`;
    assert.ok(card.data.description.length <= 4096);
    assert.ok(card.data.description.startsWith(`${page}\n**`));
    assert.ok(card.data.description.endsWith(`\n${page}`));
  }
  const text = cards.map(card => card.data.description).join('\n');
  for (const title of ['Set results', 'Stream alerts', 'Match call pings', 'Tournament roll calls', 'Tournament placements', 'Top 8s', 'Registration reminders', 'Slippi rank changes', 'Bills final results', 'Weekly crew recap', 'Bot updates']) {
    assert.match(text, new RegExp(`\\*\\*${title}\\.\\*\\*`));
  }
  for (const { name, type } of commands) {
    // the Apps menu ones on a member go by their menu name, not a slash
    assert.match(text, type === 2 ? new RegExp(`\\*\\*${name}\\*\\*`) : new RegExp(`\`/${name}[\` ]`), name);
  }
});

test('sections past discord\'s 4096 carry on in another card, cut only between sections', () => {
  const section = (title, lines) => [`**${title}**`, ...Array.from({ length: lines }, (_, i) => `${title} ${i} ${'x'.repeat(90)}`)];
  const card = { data: { color: 1, footer: { text: 'footer' } }, setDescription(text) { this.data.description = text; return this; } };
  const [first, second, third] = embeds.withSections(card, [section('One', 20), section('Two', 20), section('Three', 30)]);
  assert.match(first.data.description, /^\*\*One\*\*\n.*\n\n\*\*Two\*\*\n/s);
  assert.match(second.data.description, /^\*\*Three\*\*\n/);
  assert.equal(second.data.color, 1);
  assert.equal(second.data.footer.text, 'footer');
  assert.equal(third, undefined);

  // one section too long for a card on its own still fits
  const cards = embeds.withSections(card, [section('Huge', 60)]);
  assert.equal(cards.length, 2);
  assert.ok(cards.every(each => each.data.description.length <= 4096));
});

test('saved reg reminders become tracked tournaments, and match call pings move to discords only if they were reaching anyone', () => {
  const now = Math.floor(Date.now() / 1000);
  state.tournaments = { 6: { id: 6, name: 'Crew Weekly', slug: 'tournament/crew-weekly', startAt: now + DAY, entries: [{ userId: 1 }], userIds: [1] } };
  state.regReminders = {
    5: { id: 5, name: 'Local', slug: 'tournament/local', deadline: now + 3600, next: 2, startAt: now + 7200, endAt: now + 9000, images: [] },
    // a reg admin's, before the reminder check filled anything in
    6: { id: 6, name: 'Crew Weekly', slug: 'tournament/crew-weekly' },
  };
  state.players = {
    1: { ...crewPlayer, discordId: 'crew-discord', callPings: true },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', callPings: false },
    3: { userId: 3, playerId: 30, tag: 'Quiet', slug: 'user/quiet', callPings: true },
  };
  state.callPings = [];
  state.dqWarnPings = ['crew-discord'];
  state.messages = { calls: true, callsWarn: 5, callsDq: 10 };
  tracker.migrateTracking(now);

  assert.equal(state.regReminders, undefined);
  assert.deepEqual(state.tournaments[5].tracked, { by: 'manual', at: now, sets: true, stream: true, top8: true, reminders: true });
  assert.deepEqual(state.tournaments[5].reminder, { deadline: now + 3600, next: 2 });
  // its sets are looked at from now on, and the next tournament check fills in the rest
  assert.equal(state.tournaments[5].lastCheck, now);
  assert.equal(state.tournaments[5].checkedAt, 0);
  assert.deepEqual([state.tournaments[5].entries, state.tournaments[5].userIds], [[], []]);
  // one tracked players were already in keeps them
  assert.deepEqual(state.tournaments[6].userIds, [1]);
  assert.ok(state.tournaments[6].tracked);
  // no discord on start.gg has nobody to ping
  assert.deepEqual(state.callPings, ['crew-discord']);
  assert.ok(Object.values(state.players).every((player) => !Object.hasOwn(player, 'callPings')));
  assert.equal(state.dqWarnPings, undefined);
  assert.equal(state.messages.callsWarn, undefined);
  assert.equal(state.messages.callsDq, undefined);

  // with the server switch off nobody was getting pinged, so nothing carries over
  state.players = { 1: { ...crewPlayer, discordId: 'crew-discord', callPings: true } };
  state.callPings = [];
  state.messages = {};
  tracker.migrateTracking(now);
  assert.deepEqual(state.callPings, []);
  assert.equal(state.players[1].callPings, undefined);
  state.tournaments = {};
});

test('reg reminders come from tracked tournaments with reminders on', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.messages = {};
  state.regPings = ['fan'];
  const reminding = (reminders) => ({ id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, entries: [], tracked: { ...tracked, reminders }, reminder: {} });
  state.tournaments = { 1: reminding(false), 2: { ...reminding(true), id: 2, tracked: undefined } };
  const asked = [];
  mockApi(({ query }) => {
    asked.push(query.includes('participants(') ? 'participants' : 'registration');
    if (query.includes('participants(')) return { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { tournament: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000, registrationClosesAt: now + 3600, isRegistrationOpen: true, images: [], events: [] } };
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };
  // switched off for the tournament, or not tracked, asks start.gg nothing
  await tracker.postRegReminders(channel);
  assert.deepEqual(asked, []);

  state.tournaments[1].tracked.reminders = true;
  await tracker.postRegReminders(channel);
  assert.deepEqual(asked, ['registration', 'participants']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, '<@fan> last call');
  assert.equal(state.tournaments[1].reminder.next, 4);

  // past the last call, nothing left to ask about
  await tracker.postRegReminders(channel);
  assert.equal(asked.length, 2);
  state.regPings = [];
  state.tournaments = {};
});

test('the last call waits until 6 hours before registration closes', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.messages = {};
  state.regPings = ['fan'];
  let closesAt = now + 8 * 3600;
  state.tournaments = { 1: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, entries: [], tracked, reminder: { next: 3 } } };
  mockApi(({ query }) => {
    if (query.includes('participants(')) return { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { tournament: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000, registrationClosesAt: closesAt, isRegistrationOpen: true, images: [], events: [] } };
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };

  // 8 hours out is past where the old 12 hour last call went, but not due yet
  await tracker.postRegReminders(channel);
  assert.equal(sent.length, 0);
  assert.equal(state.tournaments[1].reminder.next, 3);
  assert.equal(tracker.nextRegReminder(closesAt), 3);

  closesAt = now + 5 * 3600;
  await tracker.postRegReminders(channel);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, '<@fan> last call');
  assert.equal(state.tournaments[1].reminder.next, 4);
  state.regPings = [];
  state.tournaments = {};
});

test('a custom reminder schedule sends that many reminders at those times', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.messages = {};
  state.regPings = ['fan'];
  state.tournaments = { 1: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 10 * 86400, entries: [], tracked: { ...tracked, schedule: [48, 6] }, reminder: {} } };
  let closesAt = now + 50 * 3600;
  mockApi(({ query }) => {
    if (query.includes('participants(')) return { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { tournament: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 10 * 86400, endAt: now + 10 * 86400 + 3600, registrationClosesAt: closesAt, isRegistrationOpen: true, images: [], events: [] } };
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };

  // 50 hours out is past the 48 hour one, so nothing yet
  await tracker.postRegReminders(channel);
  assert.equal(sent.length, 0);
  assert.equal(state.tournaments[1].reminder.next, 0);
  assert.equal(tracker.nextRegReminder(closesAt, [48, 6]), 0);

  // the first one goes out as a plain reminder, not the last call
  closesAt = now + 47 * 3600;
  await tracker.postRegReminders(channel);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, '<@fan> registration reminder');
  assert.equal(state.tournaments[1].reminder.next, 1);

  // the last entry in a custom schedule is the last call
  closesAt = now + 5 * 3600;
  await tracker.postRegReminders(channel);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].content, '<@fan> last call');
  assert.equal(state.tournaments[1].reminder.next, 2);
  state.regPings = [];
  state.tournaments = {};
});

test('reg reminders ping the Reg Reminders role instead of each person, even when registered', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.messages = {};
  state.regPings = ['fan', 'registered-fan'];
  state.tournaments = { 1: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, entries: [], tracked, reminder: {} } };
  mockApi(({ query }) => {
    if (query.includes('participants(')) {
      return { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [
        { gamerTag: 'Registered', user: { id: 2, slug: 'user/registered', authorizations: [{ externalId: 'registered-fan' }] } },
      ] } } };
    }
    return { tournament: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000, registrationClosesAt: now + 3600, isRegistrationOpen: true, images: [], events: [] } };
  });
  const sent = [];
  const role = { id: 'reg-role', name: 'Reg Reminders' };
  const channel = { send: async (payload) => { sent.push(payload); return {}; }, guild: { roles: { cache: { find: (fn) => (fn(role) ? role : undefined) } } } };
  await tracker.postRegReminders(channel);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, '<@&reg-role> last call');
  assert.deepEqual(sent[0].allowedMentions, { roles: ['reg-role'] });
  state.regPings = [];
  state.tournaments = {};
});

test('newly tracked players save when they were added, so the prune knows they are not inactive', () => {
  const before = Math.floor(Date.now() / 1000);
  const player = tracker.newTracked(crewPlayer);
  assert.ok(player.trackedAt >= before);
  assert.ok(player.lastCheck >= before);
});

test('players with no reported sets in 6 months come off the track list silently', async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = now - 200 * DAY;
  const recent = now - 10 * DAY;
  state.players = {
    1: { ...crewPlayer, lastSetAt: recent, trackedAt: recent },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastSetAt: old, trackedAt: old },
    // never played, tracked long ago
    3: { userId: 3, playerId: 30, tag: 'Quiet', slug: 'user/quiet', trackedAt: old },
    4: { userId: 4, playerId: 40, tag: 'New', slug: 'user/new', trackedAt: recent },
  };
  // only the stale two get a fresh lookup, and start.gg has nothing new for either.
  // the prune takes no channel, so nothing can go out on discord
  const asked = [];
  mockApi(({ query }) => {
    const aliases = [...query.matchAll(/(p\d+): player\(/g)].map(([, alias]) => alias);
    asked.push(...aliases);
    return Object.fromEntries(aliases.map((alias) => [alias, { sets: { nodes: [] } }]));
  });
  const pruned = await tracker.pruneInactive(now);
  assert.deepEqual(pruned.map((player) => player.tag).sort(), ['Quiet', 'Rival']);
  assert.deepEqual(Object.keys(state.players).sort(), ['1', '4']);
  assert.deepEqual(asked.sort(), ['p20', 'p30']);
});

test('a stale player with a recent set on start.gg stays, with a fresh last set time', async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = now - 200 * DAY;
  state.players = {
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastSetAt: old, trackedAt: old },
  };
  mockApi(() => ({ p20: { sets: { nodes: [node('recent-set', now - DAY, 20)] } } }));
  assert.deepEqual(await tracker.pruneInactive(now), []);
  assert.equal(state.players[2].lastSetAt, now - DAY);
});

test('a failed prune lookup keeps everyone tracked', async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = now - 200 * DAY;
  state.players = {
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastSetAt: old, trackedAt: old },
  };
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.deepEqual(await tracker.pruneInactive(now), []);
  assert.ok(state.players[2]);
});
