import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-players-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleAutocomplete, handleCommand } = await import('../src/commands/index.js');
const embeds = await import('../src/embeds/index.js');
const { predict } = await import('../src/predict.js');
const { queueLength } = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ data: respond(JSON.parse(options.body)) }) });
}

// background checks a command kicks off, so they don't reach the next test's fake
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  const deadline = Date.now() + 3000;
  while (queueLength() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

// a command run by discordId, values are its options. returns the last reply or edit
async function run(commandName, discordId, values = {}, subcommand = null) {
  let reply;
  const interaction = {
    commandName, user: { id: discordId },
    options: { getSubcommand: () => subcommand, getString: name => values[name] ?? null, getBoolean: name => values[name] ?? null },
    reply: async result => { reply = result; },
    deferReply: async () => { interaction.deferred = true; },
    editReply: async result => { reply = result; },
  };
  await handleCommand(interaction);
  return reply;
}

const crew = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew' };
const me = { userId: 7, playerId: 70, tag: 'Me', slug: 'user/me' };
const noStats = () => ({ player: { recentStandings: [], sets: { nodes: [] } } });

test('single-player options are optional, and h2h and predict take the opponent first', () => {
  for (const name of ['upcoming', 'recent', 'run', 'progress', 'stats', 'characters']) {
    assert.equal(commands.find(c => c.name === name).options[0].required, false, name);
  }
  for (const name of ['h2h', 'predict']) {
    const [opponent, player, verbose] = commands.find(c => c.name === name).options;
    assert.deepEqual([opponent.name, opponent.required], ['opponent', true]);
    assert.deepEqual([player.name, player.required], ['player', false]);
    assert.equal(verbose.name, 'verbose');
    assert.ok(!verbose.required);
  }
  for (const name of ['progress']) {
    const melee = commands.find(c => c.name === name).options.at(-1);
    assert.deepEqual([melee.name, melee.type, melee.required], ['melee', 5, undefined], name);
  }
  for (const name of ['h2h', 'stats', 'scout', 'predict']) {
    const [melee, since, venue] = commands.find(c => c.name === name).options.slice(-3);
    assert.deepEqual([melee.name, melee.type, melee.required], ['melee', 5, undefined], name);
    assert.deepEqual([since.name, since.required], ['since', undefined], name);
    assert.deepEqual([venue.name, venue.required], ['venue', undefined], name);
    assert.deepEqual(venue.choices.map((choice) => choice.value), ['offline', 'online'], name);
  }
});

test('leaving the player out looks up whoever ran it, from /link or a tracked discord', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = { 'me-discord': me };
  mockApi(noStats);
  assert.equal((await run('stats', 'me-discord')).embeds[0].data.title, 'Me');
  assert.equal((await run('stats', 'crew-discord')).embeds[0].data.title, 'Crew');
});

test('stats asks start.gg for Melee standings only when the game option is enabled', async () => {
  // fresh playerId so the short /stats cache from earlier tests doesn't answer instead of start.gg
  state.players = { 1: { ...crew, playerId: 12, discordId: 'crew-discord' } };
  state.links = {};
  const requests = [];
  mockApi(({ variables }) => { requests.push(variables); return noStats(); });
  await run('stats', 'crew-discord', { melee: true });
  await run('stats', 'crew-discord', { melee: false });
  assert.deepEqual(requests.map(({ videogameId }) => videogameId), [1, undefined]);
});

test('nobody linked, or an untracked pick, says what to do instead', async () => {
  state.players = { 1: crew };
  state.links = {};
  const unlinked = await run('stats', 'stranger');
  assert.ok(unlinked.flags);
  assert.match(unlinked.content, /\/link/);
  assert.match((await run('stats', 'stranger', { player: 'Someone' })).content, /Only tracked or linked players.*\/track add.*\/link/);
});

test('matchup commands wait for every validation reply before finishing', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' }, 7: me };
  state.links = {};
  // a typed pick that matches nobody gets looked up as a link, and this one resolves to nobody
  mockApi(() => ({ user: null }));
  for (const commandName of ['h2h', 'predict']) {
    for (const [user, values, message] of [
      ['crew-discord', { opponent: 'missing' }, /Couldn't find a start\.gg player/],
      ['stranger', { opponent: '7' }, /\/link/],
      ['crew-discord', { opponent: '1' }, /Pick two different players/],
    ]) {
      const reply = Promise.withResolvers();
      let finished = false;
      let content;
      const interaction = {
        commandName, user: { id: user },
        options: { getSubcommand: () => null, getString: name => values[name] ?? null },
        reply: result => { content = result.content; return reply.promise; },
        deferReply: async () => { interaction.deferred = true; },
        deleteReply: async () => {},
        followUp: result => { content = result.content; return reply.promise; },
      };
      const handled = handleCommand(interaction).then(() => { finished = true; });
      await new Promise(resolve => setImmediate(resolve));
      const finishedBeforeReply = finished;
      reply.resolve();
      await handled;
      assert.match(content, message);
      assert.equal(finishedBeforeReply, false, `${commandName}: ${content}`);
    }
  }
});

test('h2h and predict stop at the first link that matches nobody', async () => {
  state.players = {};
  state.links = {};
  let lookups = 0;
  mockApi(({ query }) => {
    if (query.includes('user(slug:')) lookups++;
    return { user: null };
  });
  for (const commandName of ['h2h', 'predict']) {
    lookups = 0;
    const replies = [];
    let deleted = false;
    const interaction = {
      commandName, user: { id: 'stranger' },
      options: { getSubcommand: () => null, getString: name => ({ player: 'start.gg/user/nope1', opponent: 'start.gg/user/nope2' })[name] ?? null, getBoolean: () => null },
      deferReply: async () => { interaction.deferred = true; },
      // discord answers a second delete of the same reply with Unknown Message
      deleteReply: async () => { if (deleted) throw new Error('Unknown Message'); deleted = true; },
      followUp: async result => replies.push(result.content),
    };
    await handleCommand(interaction);
    assert.equal(lookups, 1, commandName);
    assert.deepEqual(replies, ['Couldn\'t find a start.gg player for `start.gg/user/nope1`. Pick a tracked or linked player, or use a profile link or ID like start.gg/user/f64a83c8.']);
  }
});

test('h2h and predict take a start.gg link or ID for either player', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' }, 2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival' } };
  state.links = {};
  const requests = [];
  mockApi(({ query, variables }) => {
    requests.push({ query, variables });
    if (query.includes('user(slug:')) {
      // fresh ids, since the history caches outlive the test and later tests reuse 10 and 20
      if (variables.slug === 'user/other') return { user: { id: 34, slug: 'user/other', player: { id: 304, gamerTag: 'Other' }, authorizations: [] } };
      return { user: { id: 30, slug: 'user/opponent', player: { id: 300, gamerTag: 'Opponent' }, authorizations: [] } };
    }
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
  });
  // the opponent by link: the user lookup gives their player id, which drives the meetings lookup
  const byLink = (await run('h2h', 'crew-discord', { opponent: 'start.gg/user/opponent' })).embeds[0].data;
  assert.equal(byLink.title, 'Crew vs Opponent');
  assert.equal(requests[0].variables.slug, 'user/opponent');
  assert.equal(requests[1].variables.id, 10);
  assert.equal(requests[1].variables.opponentId, 300);

  // a bare ID works the same way, and the title still puts the opponent first
  requests.length = 0;
  const byId = (await run('h2h', 'crew-discord', { player: 'f64a83c8', opponent: '2' })).embeds[0].data;
  assert.equal(byId.title, 'Opponent vs Rival');
  assert.equal(requests[0].variables.slug, 'user/f64a83c8');
  assert.equal(requests[1].variables.id, 300);
  assert.equal(requests[1].variables.opponentId, 20);

  // /predict takes them the same way, even for someone with nothing linked
  const odds = await run('predict', 'stranger', { player: 'start.gg/user/other', opponent: 'start.gg/user/opponent' });
  assert.match(odds.content, /Other and Opponent haven't played singles in the same game/);
});

test('/link checks the discord on start.gg and does not track them', async () => {
  state.players = { 1: crew };
  state.links = {};
  const profile = authorizations => ({ user: { id: 7, slug: 'user/me', player: { id: 70, gamerTag: 'Me' }, authorizations } });

  mockApi(() => profile([{ externalId: 'me-discord' }]));
  const [linked] = (await run('link', 'me-discord', { profile: 'start.gg/user/me' })).embeds;
  assert.equal(linked.data.title, 'Linked to Me');
  // says everything that works now, and that you aren't tracked
  assert.match(linked.data.description, /`\/stats` `\/recent`.*`\/predict`/);
  assert.match(linked.data.description, /`\/scout`\*\* any opponent/);
  assert.match(linked.data.description, /Player list:\*\* you're in it, marked linked/);
  assert.match(linked.data.description, /Not tracked/);
  assert.equal(state.links['me-discord'].playerId, 70);
  assert.deepEqual(Object.keys(state.players), ['1']);
  assert.match((await run('link', 'me-discord', { profile: 'start.gg/user/me' })).content, /^Already linked to Me/);

  mockApi(() => profile([{ externalId: 'someone-else' }]));
  assert.match(await run('link', 'imposter', { profile: 'start.gg/user/me' }), /different Discord/);
  mockApi(() => profile([]));
  assert.match(await run('link', 'imposter', { profile: 'start.gg/user/me' }), /Connect your Discord/);
  assert.equal(state.links.imposter, undefined);

  assert.match((await run('unlink', 'me-discord')).content, /^Unlinked from Me\. Leaving the player blank won't find you now/);
  assert.equal(state.links['me-discord'], undefined);
});

test('linked people can be picked in lookups, but not in the commands about what gets posted', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = { 'me-discord': me };
  mockApi(noStats);
  // by the id autocomplete sends, or typed out
  assert.equal((await run('stats', 'crew-discord', { player: '7' })).embeds[0].data.title, 'Me');
  assert.equal((await run('stats', 'crew-discord', { player: 'me' })).embeds[0].data.title, 'Me');
  for (const [command, values] of [['stream', { alerts: 'off' }], ['sets', { results: 'off' }], ['calls', { pings: 'off' }], ['track', {}]]) {
    const reply = await run(command, 'crew-discord', { player: '7', ...values }, command === 'track' ? 'remove' : null);
    assert.match(reply.content, /Only tracked players can be picked here/, command);
  }
  assert.equal(state.links['me-discord'].streamAlerts, undefined);
});

test('/scout works for someone linked, as long as start.gg still has their discord', async () => {
  state.players = {};
  state.links = { 'me-discord': me };
  const replies = [];
  const scout = (discordFor7) => {
    mockApi(({ query }) => {
      if (query.includes('user(slug:')) return { user: { id: 3, slug: 'user/them', player: { id: 30, gamerTag: 'Them' } } };
      if (query.includes('authorizations')) return { u7: { player: { gamerTag: 'Me' }, authorizations: discordFor7 ? [{ externalId: discordFor7 }] : [] } };
      return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    });
    const interaction = {
      commandName: 'scout', user: { id: 'me-discord' },
      options: { getSubcommand: () => null, getString: (name) => (name === 'profile' ? 'start.gg/user/them' : null), getBoolean: () => null },
      deferReply: async () => { interaction.deferred = true; }, editReply: async (reply) => replies.push(reply),
    };
    return handleCommand(interaction);
  };
  await scout('me-discord');
  assert.equal(replies.at(-1).embeds[0].data.title, 'Scouting Them');
  // disconnected on start.gg since linking
  await scout(null);
  assert.match(replies.at(-1), /needs to know who you are.*\/link/);
});

test('/scout says the same thing as /track add when start.gg has nobody for the profile', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = {};
  mockApi(({ query }) => (query.includes('user(id:')
    ? { u1: { player: { gamerTag: 'Crew' }, authorizations: [{ externalId: 'crew-discord' }] } }
    : { user: null }));
  const reply = await run('scout', 'crew-discord', { profile: 'start.gg/user/ghost' });
  assert.match(reply.content, /Couldn't find a start\.gg player for `start\.gg\/user\/ghost`\./);
});

test('/link refuses when commands already find you, and fixes a tracked discord that was out of date', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = {};
  globalThis.fetch = async () => assert.fail('no start.gg lookup when the tracked discord already matches');
  const tracked = await run('link', 'crew-discord', { profile: 'start.gg/user/crew' });
  assert.ok(tracked.flags);
  assert.match(tracked.content, /^No need to link\. You're tracked as Crew/);
  assert.equal(state.links['crew-discord'], undefined);

  // connected discord on start.gg after the last refresh
  state.players = { 1: { ...crew } };
  mockApi(() => ({ user: { id: 1, slug: 'user/crew', player: { id: 10, gamerTag: 'Crew' }, authorizations: [{ externalId: 'crew-discord' }] } }));
  assert.match(await run('link', 'crew-discord', { profile: 'start.gg/user/crew' }), /^No need to link/);
  assert.equal(state.links['crew-discord'], undefined);
  assert.equal(state.players[1].discordId, 'crew-discord');
  mockApi(noStats);
  assert.equal((await run('stats', 'crew-discord')).embeds[0].data.title, 'Crew');
});

test('/link to a different profile says what it replaced', async () => {
  state.players = {};
  state.links = { 'me-discord': { ...me, userId: 8, tag: 'Old Me' } };
  mockApi(() => ({ user: { id: 7, slug: 'user/me', player: { id: 70, gamerTag: 'Me' }, authorizations: [{ externalId: 'me-discord' }] } }));
  const [linked] = (await run('link', 'me-discord', { profile: 'start.gg/user/me' })).embeds;
  assert.match(linked.data.description, /Replaced your link to Old Me/);
  assert.equal(state.links['me-discord'].userId, 7);
});

test('/link with the profile left out finds your start.gg by the Discord connected there', async () => {
  state.players = {};
  state.links = {};
  state.regReminders = {};
  // seen in a tournament's participant list
  state.accounts = { 'me-discord': 7 };
  const requests = [];
  mockApi(({ query, variables }) => {
    requests.push(query.includes('user(slug:') ? variables.slug : 'profiles');
    if (query.includes('user(slug:')) return { user: { id: 7, slug: 'user/me', player: { id: 70, gamerTag: 'Me' }, authorizations: [{ externalId: 'me-discord' }] } };
    return { u7: { slug: 'user/me', player: { gamerTag: 'Me' }, authorizations: [{ externalId: 'me-discord' }] } };
  });
  const [linked] = (await run('link', 'me-discord')).embeds;
  assert.equal(linked.data.title, 'Linked to Me');
  assert.equal(state.links['me-discord'].playerId, 70);
  // start.gg still has this discord on it, then the player behind it
  assert.deepEqual(requests, ['profiles', 'user/me']);

  // nobody saved for this discord, so there's nothing to ask start.gg
  globalThis.fetch = async () => assert.fail('no start.gg lookup');
  const missing = await run('link', 'stranger');
  assert.match(missing, /^Couldn't find a start\.gg with this Discord connected.*run `\/link` with your profile link/);
  assert.equal(state.links.stranger, undefined);
  state.accounts = {};
});

test('/stream for someone from /link says there are no alerts instead of pretending', async () => {
  state.players = { 1: crew };
  state.links = { 'me-discord': me };
  const reply = await run('stream', 'me-discord', { alerts: 'off' });
  assert.ok(reply.flags);
  assert.match(reply.content, /aren't tracked/);
  assert.equal(state.links['me-discord'].streamAlerts, undefined);
});

test('/calls for someone from /link says there are no pings to change instead of pretending', async () => {
  state.players = { 1: crew };
  state.links = { 'me-discord': me };
  const reply = await run('calls', 'me-discord', { pings: 'off' });
  assert.ok(reply.flags);
  assert.match(reply.content, /aren't tracked/);
  assert.equal(state.links['me-discord'].callPings, undefined);
});

test('/sets for someone from /link says there are no results to change instead of pretending', async () => {
  state.players = { 1: crew };
  state.links = { 'me-discord': me };
  const reply = await run('sets', 'me-discord', { results: 'off' });
  assert.ok(reply.flags);
  assert.match(reply.content, /aren't tracked/);
  assert.equal(state.links['me-discord'].setResults, undefined);
});

test('/track add starts set results, stream alerts and match call pings off and says how to turn them on', async () => {
  state.players = {};
  state.links = {};
  state.tournaments = {};
  // the second answer is for the tournament check it kicks off
  mockApi(({ query }) => (query.includes('user(slug:') ? { user: { id: 8, slug: 'user/new', player: { id: 80, gamerTag: 'New' } } } : {}));
  const reply = await run('track', 'someone', { profile: 'start.gg/user/new' }, 'add');
  assert.match(reply.embeds[0].data.description, /^Now tracking \[New\].*\. Their placements post here\.\n-# Set results, stream alerts and match call pings start off\. `\/sets`, `\/stream` and `\/calls` turn them on$/);
  assert.equal(state.players[8].setResults, false);
  assert.equal(state.players[8].streamAlerts, false);
  assert.equal(state.players[8].callPings, false);
  await settle();
});

test('/recent all asks about players with set results on first, since only their last set time stays fresh', async () => {
  // the 40 with results off played later, as far as the set check last saw
  state.players = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [100 + i,
    { userId: 100 + i, playerId: 1000 + i, tag: `Off ${i}`, slug: `user/off${i}`, setResults: false, lastSetAt: 500 }]));
  state.players[1] = { ...crew, lastSetAt: 100 };
  const asked = [];
  mockApi(({ query }) => {
    asked.push(...[...query.matchAll(/(p\d+): player\(/g)].map(([, alias]) => alias));
    return {};
  });
  assert.equal(await run('recent', 'someone', { player: 'all' }), 'No sets found.');
  assert.equal(asked.length, 40);
  assert.ok(asked.includes('p10'));
});

test('/track list only notes what differs from a new player', () => {
  const [list] = embeds.trackedList({
    1: { ...crew, setResults: false, streamAlerts: false, callPings: false },
    2: { userId: 2, playerId: 20, tag: 'Old', slug: 'user/old' },
    3: { userId: 3, playerId: 30, tag: 'Quiet', slug: 'user/quiet', setResults: true, streamAlerts: false, callPings: false },
    4: { userId: 4, playerId: 40, tag: 'Streamer', slug: 'user/streamer', setResults: false, streamAlerts: true, callPings: false },
    5: { userId: 5, playerId: 50, tag: 'Called', slug: 'user/called', setResults: false, streamAlerts: false, callPings: true },
  });
  const lines = Object.fromEntries(list.data.description.split('\n').slice(0, 5).map((line) => {
    const tag = line.match(/^\[(.+?)\]/)?.[1];
    return [tag, line];
  }));
  assert.equal(lines.Crew, '[Crew](https://www.start.gg/user/crew)');
  // saved before either started off, so both still count as on. match call pings need an explicit on
  assert.match(lines.Old, /\[Old\].* · set results on · stream alerts on$/);
  assert.match(lines.Quiet, /\[Quiet\].* · set results on$/);
  assert.match(lines.Streamer, /\[Streamer\].* · stream alerts on$/);
  assert.match(lines.Called, /\[Called\].* · match call pings on$/);
  assert.match(list.data.description, /plus their sets, streams and match calls once `\/sets`, `\/stream` and `\/calls` turn them on/);
});

test('autocomplete puts recent picks first and matches names loosely', async () => {
  const { lookup, rememberPick } = await import('../src/commands/shared.js');
  const choicesFor = async (typed, discordId) => {
    let choices;
    await handleAutocomplete({ commandName: 'h2h', user: { id: discordId }, options: { getSubcommand: () => null, getFocused: () => typed }, respond: async c => { choices = c; } });
    return choices.map((choice) => choice.name);
  };
  state.players = Object.fromEntries(['Alpha', 'Tea | Leo', 'Zed', 'Leon'].map((tag, i) => [i + 1, { userId: i + 1, playerId: 10 + i, tag, slug: `user/${i + 1}` }]));
  state.links = { 'me-discord': { userId: 7, playerId: 70, tag: 'Me', slug: 'user/me' } };
  state.recentPicks = {};

  const everyone = ['Alpha', 'Tea | Leo', 'Zed', 'Leon', 'Me (linked)'];
  assert.deepEqual(await choicesFor('', 'me-discord'), everyone);
  rememberPick('me-discord', 4);
  rememberPick('me-discord', 3);
  // your own is what leaving it out does, so it doesn't take a spot
  rememberPick('me-discord', 7);
  assert.deepEqual(state.recentPicks['me-discord'], ['3', '4']);
  assert.deepEqual(await choicesFor('', 'me-discord'), ['Zed', 'Leon', 'Alpha', 'Tea | Leo', 'Me (linked)']);
  // someone else's picks don't move yours
  assert.deepEqual(await choicesFor('', 'other-discord'), everyone);
  // a name that starts with what's typed still beats a recent pick
  rememberPick('me-discord', 2);
  assert.deepEqual(await choicesFor('leo', 'me-discord'), ['Leon', 'Tea | Leo']);
  assert.deepEqual(await choicesFor('tea leo', 'me-discord'), ['Tea | Leo']);
  assert.deepEqual(await choicesFor('TEALEO', 'me-discord'), ['Tea | Leo']);

  // typed out and sent without picking from the list
  assert.equal(lookup(state.players, 'tea leo', 'tag')?.userId, 2);
  assert.equal(lookup(state.players, 'tealeo', 'tag')?.userId, 2);
  assert.equal(lookup(state.players, '!!', 'tag'), undefined);
  state.recentPicks = {};
});

test('autocomplete explains an empty list instead of showing nothing', async () => {
  const choicesFor = async (typed, commandName = 'stats') => {
    let choices;
    await handleAutocomplete({ commandName, user: { id: 'anyone' }, options: { getSubcommand: () => null, getFocused: () => typed }, respond: async c => { choices = c; } });
    return choices;
  };
  state.players = {};
  state.links = {};
  assert.deepEqual(await choicesFor('Leo'), [{ name: 'Nobody is tracked yet, /track add someone first', value: 'Leo' }]);
  state.players = { 1: crew };
  assert.deepEqual(await choicesFor('Leo'), [{ name: 'Nobody tracked or linked matches "Leo", /track add them first', value: 'Leo' }]);
  assert.deepEqual(await choicesFor('cr'), [{ name: 'Crew', value: '1' }]);

  // linked people come after the tracked ones, marked, and only where they can be picked
  state.links = { 'me-discord': { ...me, tag: 'Crewmate' } };
  assert.deepEqual(await choicesFor('cr'), [{ name: 'Crew', value: '1' }, { name: 'Crewmate (linked)', value: '7' }]);
  assert.deepEqual(await choicesFor('cr', 'sets'), [{ name: 'Crew', value: '1' }]);
  assert.deepEqual(await choicesFor('cr', 'calls'), [{ name: 'Crew', value: '1' }]);
  assert.deepEqual(await choicesFor('mate', 'stream'), [{ name: 'Nobody tracked matches "mate"', value: 'mate' }]);
});

// a won, b lost. seeds and rounds vary so every verbose line has something to show
const a = { ...crew, tag: 'A', playerId: 10 };
const b = { userId: 2, playerId: 20, tag: 'B', slug: 'user/b' };
const meeting = (i, won, { seedA = 3, seedB = 5, round = 'Winners round 1', game = 'Ultimate' } = {}) => ({
  id: String(i), completedAt: 1000 - i, winnerId: won ? 1 : 2, round,
  event: { slug: `tournament/t${i}/event/singles`, videogame: { displayName: game }, tournament: { name: `T${i}` } },
  sides: [{ id: 1, name: 'A', playerIds: [10], score: won ? 2 : 0, seed: seedA }, { id: 2, name: 'B', playerIds: [20], score: won ? 0 : 2, seed: seedB }],
});

test('h2h shows 10 sets by default and everything with splits and streaks when verbose', () => {
  const sets = [
    meeting(0, true), meeting(1, true), meeting(2, false, { seedA: 9, seedB: 2, round: 'Grand Final' }),
    ...Array.from({ length: 9 }, (_, i) => meeting(i + 3, i % 2 === 0, { game: i < 2 ? 'Melee' : 'Ultimate' })),
  ];
  const text = list => list.map(e => e.data.description).join('\n');

  const short = text(embeds.headToHead(a, b, sets));
  assert.equal(short.match(/^\*\*[WL]\*\* /gm).length, 10);
  assert.match(short, /2 older sets not shown/);

  const full = text(embeds.headToHead(a, b, sets, { verbose: true }));
  assert.equal(full.match(/^\*\*[WL]\*\* /gm).length, 12);
  assert.match(full, /By game:.*Ultimate.*Melee/);
  assert.match(full, /Seeded above B:\*\* \*\*A\*\* 7-4/);
  assert.match(full, /Seeded below B:\*\* \*\*A\*\* 0-1/);
  assert.match(full, /Grand finals:\*\* \*\*A\*\* 0-1/);
  assert.match(full, /Streak:\*\* \*\*A\*\* has won the last 2/);
  assert.match(full, /First played:.*T11/);
  assert.equal(embeds.headToHead(a, b, sets)[0].data.footer.text, 'Sama-tracker by Samatron');
});

test('h2h set lines link the VOD only when the TO added one', () => {
  const withVod = { ...meeting(0, true), vod: 'https://youtube.example/vod' };
  const [card] = embeds.headToHead(a, b, [withVod, meeting(1, false)]);
  assert.match(card.data.description, /\[VOD\]\(https:\/\/youtube\.example\/vod\)/);
  assert.equal(card.data.description.match(/\[VOD\]/g).length, 1);
  // a ) in the link would end the markdown early, so it gets encoded
  const paren = { ...meeting(0, true), vod: 'https://youtube.example/watch?v=abc(def)' };
  assert.match(embeds.headToHead(a, b, [paren])[0].data.description, /\[VOD\]\(https:\/\/youtube\.example\/watch\?v=abc%28def%29\)/);
});

test('h2h melee says so in the footer and how many sets in other games it left out', () => {
  const [card] = embeds.headToHead(a, b, [meeting(0, true, { game: 'Melee' })], { melee: true, otherGames: 3 });
  assert.equal(card.data.title, 'A 1-0 B');
  assert.equal(card.data.author.name, 'A · Melee');
  assert.equal(card.data.footer.text, 'Sama-tracker by Samatron · Melee');
  assert.match(card.data.description, /\n-# Melee only, 3 sets in other games left out$/);
  // ultimate stays the default with nothing at the top
  assert.equal(embeds.headToHead(a, b, [meeting(0, true)])[0].data.author.name, 'A');

  const [none] = embeds.headToHead(a, b, [], { melee: true, otherGames: 1 });
  assert.equal(none.data.title, 'A vs B');
  assert.equal(none.data.description, 'They haven\'t played each other in Melee singles on start.gg yet.\n-# 1 set in other games left out, leave out `melee` to count them');
  assert.equal(embeds.headToHead(a, b, [], { melee: true })[0].data.description, 'They haven\'t played each other in Melee singles on start.gg yet.');
});

test('h2h fetches only meetings with the selected opponent and filters Melee from those', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' }, 2: b };
  state.links = {};
  const MELEE = { id: 1, displayName: 'Melee' };
  const ULTIMATE = { id: 1386, displayName: 'Ultimate' };
  const node = (id, videogame, won) => ({
    id, completedAt: 1000 - id, fullRoundText: 'Winners Final', winnerId: won ? 1 : 2,
    event: { slug: `tournament/t${id}/event/singles`, videogame, tournament: { name: `T${id}` } },
    slots: [[1, 10, 'Crew'], [2, 20, 'B']].map(([entrant, player, name]) => ({ entrant: { id: entrant, name, initialSeedNum: entrant, participants: [{ player: { id: player } }] }, standing: null })),
  });
  const requests = [];
  mockApi(({ query, variables }) => {
    requests.push({ query, variables });
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [node(1, MELEE, true), node(2, ULTIMATE, false), node(3, MELEE, true)] } } };
  });
  const all = (await run('h2h', 'crew-discord', { opponent: '2' })).embeds[0].data;
  assert.equal(all.title, 'Crew 2-1 B');
  assert.doesNotMatch(all.description, /other games/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].variables.id, crew.playerId);
  assert.equal(requests[0].variables.opponentId, b.playerId);
  assert.match(requests[0].query, /opponentId:\s*\$opponentId/);

  const melee = (await run('h2h', 'crew-discord', { opponent: '2', melee: true })).embeds[0].data;
  assert.equal(melee.title, 'Crew 2-0 B');
  assert.equal(melee.footer.text, 'Sama-tracker by Samatron · Melee');
  assert.equal(melee.description.match(/^\*\*[WL]\*\* /gm).length, 2);
  assert.match(melee.description, /Melee only, 1 set in other games left out/);
  assert.equal((await run('h2h', 'crew-discord', { opponent: '2', melee: false })).embeds[0].data.title, 'Crew 2-1 B');
});

test('h2h melee and verbose combine: splits and streaks come from the Melee sets only', () => {
  const sets = [
    meeting(0, true, { game: 'Melee' }), meeting(1, false, { seedA: 9, seedB: 2, game: 'Melee' }),
    meeting(2, true), meeting(3, true),
  ];
  const meleeSets = sets.filter(({ event }) => event.videogame.displayName === 'Melee');
  const [card] = embeds.headToHead(a, b, meleeSets, { verbose: true, melee: true, otherGames: 2 });
  assert.equal(card.data.footer.text, 'Sama-tracker by Samatron · Melee');
  assert.match(card.data.description, /Seeded above B:\*\* \*\*A\*\* 1-0/);
  assert.match(card.data.description, /Seeded below B:\*\* \*\*A\*\* 0-1/);
  assert.match(card.data.description, /First played:.*T1/);
  assert.match(card.data.description, /Melee only, 2 sets in other games left out/);
  assert.equal(card.data.description.match(/^\*\*[WL]\*\* /gm).length, 2);
  // just the one game left, so no split line
  assert.doesNotMatch(card.data.description, /By game/);
});

test('/h2h venue and since leave out online sets and old ones, and name the filters', async () => {
  // fresh ids since the history caches outlive the test and earlier h2h runs used 10 and 20
  state.players = { 71: { ...crew, userId: 71, playerId: 71, discordId: 'crew-discord' }, 72: { ...b, userId: 72, playerId: 72 } };
  state.links = {};
  const now = Math.floor(Date.now() / 1000);
  const ULTIMATE = { id: 1386, displayName: 'Ultimate' };
  // id, seconds ago, offline or not, crew won or not
  const specs = [[1, 100, false, true], [2, 200, true, true], [3, 300, false, false], [4, 90000, false, true]];
  const nodes = specs.map(([id, ago, online, won]) => ({
    id, completedAt: now - ago, fullRoundText: 'Winners Final', winnerId: won ? 1 : 2,
    event: { slug: `tournament/t${id}/event/singles`, videogame: ULTIMATE, tournament: { name: `T${id}`, isOnline: online } },
    slots: [[1, 71, 'Crew'], [2, 72, 'B']].map(([entrant, player, name]) => ({ entrant: { id: entrant, name, initialSeedNum: entrant, participants: [{ player: { id: player } }] }, standing: null })),
  }));
  mockApi(({ query }) => {
    if (query.includes('user(id:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes } } };
  });
  const title = async (values) => (await run('h2h', 'crew-discord', { opponent: '72', ...values })).embeds[0].data;
  // date granularity is days, so these land on whole days whatever time it is
  const day = (ago) => new Date((now - ago) * 1000).toISOString().slice(0, 10);
  const plain = await title({});
  assert.equal(plain.title, 'Crew 3-1 B');
  assert.doesNotMatch(plain.description, /Offline only|Online only|since <t:/);
  const offline = await title({ venue: 'offline' });
  assert.equal(offline.title, 'Crew 2-1 B');
  assert.match(offline.description, /-# Offline only$/m);
  assert.equal((await title({ venue: 'online' })).title, 'Crew 1-0 B');
  const everything = await title({ since: day(90000) });
  assert.equal(everything.title, 'Crew 3-1 B');
  assert.match(everything.description, /Since <t:\d+:D>/);
  // tomorrow leaves nothing, so it says so instead of nobody having played
  const nothing = await title({ since: day(-86400) });
  assert.equal(nothing.title, 'Crew vs B');
  assert.match(nothing.description, /haven't played each other in singles on start\.gg yet matching those filters/);
  const both = await title({ venue: 'offline', since: day(90000) });
  assert.equal(both.title, 'Crew 2-1 B');
  assert.match(both.description, /-# Offline only · since <t:\d+:D>$/m);
});

test('h2h shows one-line predicted odds in both report lengths, never the breakdown', () => {
  const vs = (i, me, opponent, won) => ({
    id: `${me}-${i}`, completedAt: 1000 - i, winnerId: won ? me : opponent,
    event: { slug: `tournament/t${i}/event/singles`, videogame: { displayName: 'Ultimate' }, tournament: { name: `T${i}` } },
    sides: [{ id: me, name: `P${me}`, playerIds: [me], score: 2, seed: 2 }, { id: opponent, name: `P${opponent}`, playerIds: [opponent], score: 1, seed: 4 }],
  });
  const historyA = [vs(0, 10, 20, true), vs(1, 10, 30, true)];
  const historyB = [vs(0, 20, 10, false), vs(1, 20, 30, false)];
  const odds = predict(a, b, historyA, historyB);
  const sets = [meeting(0, true), meeting(1, false)];

  const short = embeds.headToHead(a, b, sets, { odds })[0].data.description;
  const full = embeds.headToHead(a, b, sets, { verbose: true, odds })[0].data.description;
  for (const text of [short, full]) {
    assert.match(text, /\*\*Predicted:\*\* \*\*A\*\* \d+% · \d+% \*\*B\*\* in Ultimate/);
    // only the raw percentage, one line
    assert.equal(text.match(/Predicted/g).length, 1);
    assert.doesNotMatch(text, /How it adds up/);
    assert.doesNotMatch(text, /Starting from even/);
  }
  // verbose still lists everything, the odds line just comes first
  assert.match(full, /First played/);
  // no odds means no line, the way it looked before
  assert.doesNotMatch(embeds.headToHead(a, b, sets)[0].data.description, /Predicted/);
  // even with no meetings the odds still show
  assert.match(embeds.headToHead(a, b, [], { odds })[0].data.description, /haven't played each other.*\n\*\*Predicted:\*\*/);
});

test('h2h melee shows Melee odds, and none when there is no shared Melee game', () => {
  const meleeOdds = { game: 'Melee', chance: 0.7 };
  const [card] = embeds.headToHead(a, b, [meeting(0, true, { game: 'Melee' })], { melee: true, otherGames: 2, odds: meleeOdds });
  assert.match(card.data.description, /\*\*Predicted:\*\* \*\*A\*\* 70% · 30% \*\*B\*\* in Melee/);
  assert.match(card.data.description, /Melee only, 2 sets in other games left out/);
  const [verbose] = embeds.headToHead(a, b, [meeting(0, true, { game: 'Melee' })], { verbose: true, melee: true, otherGames: 2, odds: meleeOdds });
  assert.match(verbose.data.description, /\*\*Predicted:\*\* \*\*A\*\* 70% · 30% \*\*B\*\* in Melee/);
  assert.doesNotMatch(verbose.data.description, /How it adds up/);
  // null odds, like melee with only Ultimate histories, adds no line
  assert.doesNotMatch(embeds.headToHead(a, b, [meeting(0, true)], { melee: true, otherGames: 1 })[0].data.description, /Predicted/);
});

test('h2h runs predict behind the scenes for both report lengths and both games', async () => {
  // fresh ids so the cached histories from earlier tests don't leak in
  const playerA = { userId: 80, playerId: 80, tag: 'Alpha', slug: 'user/alpha' };
  const playerB = { userId: 81, playerId: 81, tag: 'Beta', slug: 'user/beta' };
  state.players = { 80: { ...playerA, discordId: 'alpha-discord' }, 81: playerB };
  state.links = {};
  const node = (id, videogame, players) => ({
    id, completedAt: 1000 - id, fullRoundText: 'Winners Final', winnerId: 1,
    event: { slug: `tournament/t${id}/event/singles`, videogame, tournament: { name: `T${id}` } },
    slots: players.map((player, i) => ({ entrant: { id: i + 1, name: `P${player}`, initialSeedNum: i + 1, participants: [{ player: { id: player } }] }, standing: null })),
  });
  mockApi(({ query, variables }) => {
    if (query.includes('user(id:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    // meetings and histories are all Ultimate here, so non-melee has odds and melee has none
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [node(1, ULTIMATE, [80, 81]), node(2, ULTIMATE, [80, 82])] } } };
  });
  const short = (await run('h2h', 'alpha-discord', { opponent: '81' })).embeds[0].data;
  assert.match(short.title, /Alpha.*Beta/);
  assert.match(short.description, /\*\*Predicted:\*\* \*\*Alpha\*\* \d+% · \d+% \*\*Beta\*\* in Ultimate/);
  assert.doesNotMatch(short.description, /How it adds up/);

  const full = (await run('h2h', 'alpha-discord', { opponent: '81', verbose: true })).embeds[0].data;
  assert.match(full.description, /\*\*Predicted:\*\* \*\*Alpha\*\* \d+% · \d+% \*\*Beta\*\* in Ultimate/);
  assert.match(full.description, /First played/);
  assert.doesNotMatch(full.description, /How it adds up/);

  const melee = (await run('h2h', 'alpha-discord', { opponent: '81', melee: true })).embeds[0].data;
  assert.doesNotMatch(melee.description, /Predicted/);
  assert.match(melee.description, /haven't played each other in Melee singles/);
});

test('melee cards say Melee at the top, other games show nothing there', () => {
  const tag = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew' };
  const opp = { userId: 2, playerId: 20, tag: 'Opp', slug: 'user/opp' };
  assert.equal(embeds.stats(tag, [], [], { melee: true }).data.author.name, 'Melee stats');
  assert.equal(embeds.stats(tag, [], []).data.author.name, 'Stats');
  assert.equal(embeds.lifetimeStats(tag, [], [], {}, { melee: true })[0].data.author.name, 'Melee lifetime stats');
  assert.equal(embeds.lifetimeStats(tag, [], [], {}, { label: 'Scouting', melee: true })[0].data.author.name, 'Melee scouting');
  assert.equal(embeds.lifetimeStats(tag, [], [], {})[0].data.author.name, 'Lifetime stats');
  const periods = [{ since: 0, until: 30 * 86400, summary: { games: [] } }, { since: -30 * 86400, until: 0, summary: { games: [] } }];
  assert.equal(embeds.progress(tag, periods, { melee: true })[0].data.title, "Crew's Melee progress");
  assert.equal(embeds.progress(tag, periods)[0].data.title, "Crew's progress");
  assert.equal(embeds.scout(tag, opp, [], [], [], { melee: true })[0].data.title, 'Melee scouting Opp');
  assert.equal(embeds.scout(tag, opp, [], [], [])[0].data.title, 'Scouting Opp');
  const report = embeds.scoutReport(tag, opp, { mine: [], theirs: [], characterSets: [], events: [], odds: null, players: {}, melee: true });
  assert.equal(report.find((card) => card.data.title === 'Crew vs Opp').data.author.name, 'Crew · Melee');
  assert.equal(embeds.characters(tag, { scanned: 0, reported: 0, characters: [] }, { game: 'Melee' }).data.author.name, 'Melee characters');
  assert.equal(embeds.characters(tag, { scanned: 0, reported: 0, characters: [] }, { game: 'Ultimate' }).data.author.name, 'Characters');
});

test('predict verbose explains the same odds the short version shows', () => {
  const vs = (i, me, opponent, won) => ({
    id: `${me}-${i}`, completedAt: 1000 - i, winnerId: won ? me : opponent,
    event: { slug: `tournament/t${i % 3}/event/singles`, videogame: { displayName: 'Ultimate' }, tournament: { name: `T${i % 3}` } },
    sides: [{ id: me, name: `P${me}`, playerIds: [me], score: 2, seed: me === 10 ? 2 : 4 }, { id: opponent, name: `P${opponent}`, playerIds: [opponent], score: 1, seed: 8 }],
  });
  const historyA = [vs(0, 10, 20, true), vs(1, 10, 30, true), vs(2, 10, 30, false)];
  const historyB = [vs(0, 20, 30, false), vs(1, 20, 30, false), vs(2, 20, 40, true)];
  const odds = predict(a, b, historyA, historyB);
  const short = embeds.prediction(a, b, odds);
  const full = embeds.prediction(a, b, odds, true);
  assert.equal(full[0].data.title, short[0].data.title);
  // melee odds say so at the top, ultimate stays the default with nothing there
  assert.equal(short[0].data.author.name, 'A');
  assert.equal(embeds.prediction(a, b, { ...odds, game: 'Melee' })[0].data.author.name, 'A · Melee');
  const text = full.map(e => e.data.description).join('\n');
  assert.match(text, /How it adds up/);
  assert.match(text, /\*\*Head-to-head:\*\* counts for \d+%/);
  assert.match(text, /### Common opponents\n\*\*P30\*\*: \*\*A\*\* 1-1 · \*\*B\*\* 0-2/);
  assert.match(text, /Shared brackets/);
});

// a start.gg set node for /predict, entrant 1 winning. a -1 in scores makes it a DQ for both sides
const predictNode = (id, videogame, players, scores = [2, 0]) => ({
  id, completedAt: 1000 - id, fullRoundText: 'Winners Final', winnerId: 1,
  event: { slug: `tournament/t${id}/event/singles`, videogame, tournament: { name: `T${id}` } },
  slots: players.map((player, i) => ({ entrant: { id: i + 1, name: `P${player}`, initialSeedNum: i + 1, participants: [{ player: { id: player } }] }, standing: { stats: { score: { value: scores[i] } } } })),
});
const ULTIMATE = { id: 1386, displayName: 'Ultimate' };
const MELEE = { id: 1, displayName: 'Melee' };

test('predict melee names whoever has never played it, and the game the odds do work for', async () => {
  // fresh ids since the history caches outlive the test and earlier h2h runs used 10 and 20
  const freshCrew = { userId: 61, playerId: 61, tag: 'Crew', slug: 'user/crew' };
  const freshRival = { userId: 62, playerId: 62, tag: 'Rival', slug: 'user/rival' };
  state.players = { 61: { ...freshCrew, discordId: 'crew-discord' }, 62: freshRival };
  state.links = {};
  // crew has a melee set and rival has never played it, so melee has no odds, but they have an ultimate set together
  mockApi(({ query, variables }) => {
    if (query.includes('user(id:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    const crewSets = [predictNode(1, ULTIMATE, [61, 62]), predictNode(2, MELEE, [61, 30])];
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: variables.id === 61 ? crewSets : [predictNode(1, ULTIMATE, [61, 62])] } } };
  });
  assert.equal((await run('predict', 'crew-discord', { opponent: '62', melee: true })).content,
    'Rival hasn\'t played Melee singles on start.gg.\n-# Leave out `melee` for Ultimate odds');
  // the wording is only about the reply, the odds without melee are the same as ever
  assert.match((await run('predict', 'crew-discord', { opponent: '62' })).embeds[0].data.title, /Crew \d+% · \d+% Rival/);
});

test('predict melee gives no such hint when the shared game is all DQs for one of them', async () => {
  state.players = { 1: { ...crew, playerId: 40, discordId: 'crew-discord' }, 2: { userId: 2, playerId: 50, tag: 'Rival', slug: 'user/rival' } };
  state.links = {};
  // rival's only ultimate set here is a DQ, so leaving melee out wouldn't give ultimate odds either
  mockApi(({ query, variables }) => {
    if (query.includes('user(id:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    const crewSets = [predictNode(1, MELEE, [40, 30]), predictNode(2, ULTIMATE, [40, 60]), predictNode(3, ULTIMATE, [40, 50], [2, -1])];
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: variables.id === 40 ? crewSets : [predictNode(3, ULTIMATE, [40, 50], [2, -1])] } } };
  });
  assert.equal((await run('predict', 'crew-discord', { opponent: '2', melee: true })).content,
    'Rival hasn\'t played Melee singles on start.gg.');
});
