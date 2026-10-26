import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockApi as answerWith } from './fixtures.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-players-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleAutocomplete, handleCommand } = await import('../src/commands/index.js');
const embeds = await import('../src/embeds/index.js');
const { predict } = await import('../src/predict.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const { queueLength, forgetMisses } = startgg;
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  // a new fake answers everything again, including links that missed before
  forgetMisses();
  answerWith(respond);
}

// background checks a command kicks off, so they don't reach the next test's fake
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  const deadline = Date.now() + 3000;
  while (queueLength() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

// a command run by discordId, values are its options. returns the last reply or edit
// to-discord is a TO: the server has no TO role here, so Manage Server counts as one. anyone else isn't.
// values.user is the member a user: option picked, values.member their server membership for role changes
async function run(commandName, discordId, values = {}, subcommand = null) {
  let reply;
  const interaction = {
    commandName, user: { id: discordId }, memberPermissions: { has: () => discordId === 'to-discord' },
    guild: { roles: { cache: { get: () => undefined, find: (fn) => (values.role && fn(values.role) ? values.role : undefined) }, create: async ({ name }) => ({ id: `${name}-role`, name }) } },
    options: {
      getSubcommand: () => subcommand, getString: name => values[name] ?? null, getBoolean: name => values[name] ?? null,
      getUser: name => values[name] ?? null, getMember: name => name === 'user' ? values.member ?? null : null,
    },
    reply: async result => { reply = result; },
    deferReply: async () => { interaction.deferred = true; },
    editReply: async result => { reply = result; },
    deleteReply: async () => {},
    followUp: async result => { reply = result; },
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

test('/run leaves out a finished saved tournament that start.gg still calls upcoming', async () => {
  const now = Math.floor(Date.now() / 1000);
  const royale = { id: 49, name: 'Smash Royale #49', slug: 'tournament/smash-royale-49', startAt: now - 12 * 3600, endAt: now + 3600 };
  const graveyard = { id: 50, name: 'The Graveyard', slug: 'tournament/the-graveyard', startAt: now - 3600, endAt: now + 6 * 3600 };
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = {};
  state.tournaments = { 49: { ...royale, userIds: [1], resultsPosted: true } };
  const lookedUp = [];
  mockApi(({ query, variables }) => {
    if (query.includes('tournaments(query:')) return { u1: { tournaments: { nodes: [royale, graveyard] } } };
    if (query.includes('tournament(id: $id)')) {
      lookedUp.push(Number(variables.id));
      const found = Number(variables.id) === 49 ? royale : graveyard;
      return { tournament: { ...found, events: [{
        id: Number(variables.id) * 10, name: 'Ultimate Singles', slug: `${found.slug}/event/ultimate-singles`, state: 'ACTIVE', numEntrants: 32,
        u1: { id: 1, isDisqualified: false, standing: { placement: 3, isFinal: false } },
      }] } };
    }
    if (query.includes('event(id:')) return { event: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    throw new Error(`no fake for ${query.slice(0, 80)}`);
  });

  const reply = await run('run', 'crew-discord');

  assert.deepEqual(lookedUp, [50]);
  assert.match(reply.embeds[0].data.title, /Graveyard/);
  assert.doesNotMatch(reply.embeds[0].data.title, /Royale/);
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

test('nobody linked says to link, a typo gets the closest name, and a profile ID gets looked up on start.gg', async () => {
  state.players = { 1: crew };
  state.links = {};
  const unlinked = await run('stats', 'stranger');
  assert.ok(unlinked.flags);
  assert.match(unlinked.content, /\/link/);
  let asked = 0;
  mockApi(() => { asked++; return { user: null }; });
  // a name can't be a profile, so start.gg isn't asked
  const typo = await run('stats', 'stranger', { player: 'Crw' });
  assert.ok(typo.flags, 'only whoever ran it sees the miss');
  assert.equal(typo.content, 'Nobody tracked or linked goes by `Crw`. Did you mean **Crew**?');
  assert.equal(asked, 0);
  const missed = await run('stats', 'stranger', { player: 'f64a83c8' });
  assert.ok(missed.flags);
  assert.match(missed.content, /^Couldn't find a start\.gg player for `f64a83c8`\./);
  assert.equal(asked, 1);
});

test('every stat command takes a pasted start.gg profile link for someone nobody tracks', async () => {
  state.players = { 1: crew };
  state.links = {};
  mockApi(({ query }) => (query.includes('user(slug:')
    ? { user: { id: 50, slug: 'user/abc123', images: [], player: { id: 500, gamerTag: 'Stranger' }, authorizations: [] } }
    : noStats()));
  for (const name of ['stats', 'doubles', 'progress', 'run']) {
    const reply = await run(name, 'crew-discord', { player: 'start.gg/user/abc123' });
    assert.match(JSON.stringify(reply), /Stranger/, name);
    await settle();
  }
  // nobody got tracked or linked by it
  assert.deepEqual(Object.keys(state.players), ['1']);
  assert.deepEqual(state.links, {});
});

test('matchup commands wait for every validation reply before finishing', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' }, 7: me };
  state.links = {};
  // a pasted link gets looked up, and this one resolves to nobody. a plain name that matches nobody answers too
  mockApi(() => ({ user: null }));
  for (const commandName of ['h2h', 'predict']) {
    for (const [user, values, message] of [
      ['crew-discord', { opponent: 'start.gg/user/missing' }, /Couldn't find a start\.gg player/],
      ['crew-discord', { opponent: 'missing' }, /Nobody tracked or linked goes by `missing`/],
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
    // the miss from the last command stays cached for 5 minutes, so start fresh
    forgetMisses();
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
  assert.equal(odds.content, 'Neither Other nor Opponent has played Ultimate singles on start.gg.');
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
  for (const subcommand of ['posts', 'remove']) {
    const reply = await run('track', 'crew-discord', { player: '7', sets: 'off', stream: 'off' }, subcommand);
    assert.match(reply.content, /Only tracked players can be picked here/, subcommand);
  }
  assert.equal(state.links['me-discord'].streamAlerts, undefined);
  assert.equal(state.links['me-discord'].setResults, undefined);
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
      options: { getSubcommand: () => null, getString: (name) => (name === 'opponent' ? 'start.gg/user/them' : null), getBoolean: () => null },
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
  const reply = await run('scout', 'crew-discord', { opponent: 'start.gg/user/ghost' });
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
  assert.match((await run('link', 'crew-discord', { profile: 'start.gg/user/crew' })).content, /^No need to link/);
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
  state.tournaments = {};
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

test('/track posts for someone from /link says they aren\'t tracked instead of pretending', async () => {
  state.players = { 1: crew };
  state.links = { 'me-discord': me };
  const reply = await run('track', 'me-discord', { sets: 'off', stream: 'off' }, 'posts');
  assert.ok(reply.flags);
  assert.equal(reply.content, 'You aren\'t tracked. `/track add` tracks you.');
  assert.equal(state.links['me-discord'].streamAlerts, undefined);
  assert.equal(state.links['me-discord'].setResults, undefined);
});

test('/track posts changes one or both switches, and with none says where they\'re at', async () => {
  state.players = { 1: { ...crew, setResults: false, streamAlerts: false }, 2: { userId: 2, playerId: 20, tag: 'Old', slug: 'user/old' } };
  state.links = {};
  // anyone can look
  const shown = await run('track', 'someone', { player: '1' }, 'posts');
  assert.ok(shown.flags);
  assert.equal(shown.content, 'Crew: set results off, stream alerts off.');
  // saved before either started off, so both count as on
  assert.equal((await run('track', 'someone', { player: 'all' }, 'posts')).content, 'Set results are on for 1 and stream alerts for 1 of the 2 tracked players.');

  assert.equal((await run('track', 'to-discord', { player: '1', sets: 'on', stream: 'on' }, 'posts')).content, 'Set results and stream alerts on for Crew.');
  assert.ok(state.players[1].setResultsOnAt > 0);
  assert.equal(state.players[1].streamAlerts, true);
  assert.equal((await run('track', 'to-discord', { player: '1', sets: 'off', stream: 'on' }, 'posts')).content, 'Set results off and stream alerts on for Crew.');
  // stream alerts save no on time: they're about sets live right now
  assert.equal(state.players[1].streamAlertsOnAt, undefined);
  assert.equal((await run('track', 'to-discord', { player: 'all', stream: 'off' }, 'posts')).content, 'Stream alerts off for everyone.');
  assert.ok(Object.values(state.players).every((player) => player.streamAlerts === false));
});

test('/track posts lets anyone change their own and only TOs change someone else\'s or everyone\'s', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord', setResults: false }, 2: { userId: 2, playerId: 20, tag: 'Old', slug: 'user/old', setResults: false } };
  state.links = { 'me-discord': { ...me, userId: 2 } };
  // someone else's, by someone who isn't a TO, changes nothing
  const refused = await run('track', 'someone', { player: '1', sets: 'on' }, 'posts');
  assert.ok(refused.flags);
  assert.equal(refused.content, 'Only TOs can change someone else\'s posts. Leave out `player` to change yours. `/t-o role list` shows who they are.');
  assert.equal((await run('track', 'someone', { player: 'all', sets: 'on' }, 'posts')).content, 'Only TOs can change everyone\'s posts. `/t-o role list` shows who they are.');
  assert.equal(state.players[1].setResults, false);

  // their own, left out or picked, by the discord on their start.gg or their /link
  assert.equal((await run('track', 'crew-discord', { sets: 'on' }, 'posts')).content, 'Set results on for Crew.');
  assert.equal((await run('track', 'me-discord', { player: '2', sets: 'on' }, 'posts')).content, 'Set results on for Old.');
  assert.equal(state.players[2].setResults, true);
});

test('/notify changes your own pings, and match calls need their start.gg', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = { 'me-discord': me };
  state.callPings = [];
  state.streamPings = [];
  state.regPings = [];
  state.regDmPings = [];
  state.startDmPings = [];
  state.messages = {};
  globalThis.fetch = async () => assert.fail('no start.gg lookup');

  // nobody to look up, so calls and streams stay off
  const stranger = await run('notify', 'stranger', { calls: 'on', streams: 'on' });
  assert.ok(stranger.flags);
  assert.match(stranger.content, /^Match call pings need your start\.gg, so `\/link` first\..*\nStream alert pings need your start\.gg, so `\/link` first\..*$/);
  assert.deepEqual(state.callPings, []);
  assert.deepEqual(state.streamPings, []);

  // linked, or tracked with this discord on start.gg
  assert.match((await run('notify', 'me-discord', { calls: 'on' })).content, /^You'll get pinged when your match is called\.$/);
  assert.match((await run('notify', 'crew-discord', { calls: 'on' })).content, /^You'll get pinged when your match is called\.$/);
  assert.deepEqual(state.callPings, ['me-discord', 'crew-discord']);
  assert.match((await run('notify', 'me-discord', { streams: 'on' })).content, /^You'll get pinged when your set is on stream\.$/);
  assert.deepEqual(state.streamPings, ['me-discord']);

  // nothing given shows where theirs are at, and a tracked player's own posts
  const mine = await run('notify', 'crew-discord');
  assert.ok(mine.flags);
  assert.match(mine.content, /\*\*Match calls:\*\* on\n\*\*Next opponents:\*\* off\n\*\*Stream alerts:\*\* off\n\*\*Reg reminders:\*\* off\n\*\*Registration DMs:\*\* off\n\*\*Start DMs:\*\* off\n-# You're tracked as Crew, with set results on and stream alerts on/);
  assert.doesNotMatch((await run('notify', 'me-discord')).content, /You're tracked/);

  // DMs opt in and out per person
  assert.match((await run('notify', 'me-discord', { dm_registration: 'on', dm_start: 'on' })).content, /DM 1 hour before registration closes.*\n.*DM 1 hour before the tournament starts/);
  assert.deepEqual(state.regDmPings, ['me-discord']);
  assert.deepEqual(state.startDmPings, ['me-discord']);
  assert.match((await run('notify', 'me-discord', { dm_registration: 'off' })).content, /^No more registration DMs\.$/);
  assert.deepEqual(state.regDmPings, []);
  assert.deepEqual(state.startDmPings, ['me-discord']);

  assert.match((await run('notify', 'me-discord', { calls: 'off' })).content, /^No more match call pings\.$/);
  assert.deepEqual(state.callPings, ['crew-discord']);
  state.callPings = [];
  state.streamPings = [];
  state.regDmPings = [];
  state.startDmPings = [];
});

test('/notify next:on saves the ping for a linked person and says so, and needs a start.gg', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = { 'me-discord': me };
  Object.assign(state, { callPings: [], nextPings: [], streamPings: [], regPings: [], regDmPings: [], startDmPings: [], messages: {} });
  globalThis.fetch = async () => assert.fail('no start.gg lookup');

  // nothing to look up, so it stays off
  const stranger = await run('notify', 'stranger', { next: 'on' });
  assert.equal(stranger.content, 'Next opponent pings need your start.gg, so `/link` first. Leave out the link and it finds yours.');
  assert.deepEqual(state.nextPings, []);

  assert.equal((await run('notify', 'me-discord', { next: 'on' })).content, 'You\'ll get pinged when your next opponent is set.');
  assert.deepEqual(state.nextPings, ['me-discord']);
  assert.match((await run('notify', 'me-discord')).content, /\*\*Match calls:\*\* off\n\*\*Next opponents:\*\* on\n\*\*Stream alerts:\*\* off/);

  // next off server-wide is the default for every tournament, so the pings only come where a TO turned a tournament on
  state.messages = { next: false, streams: false };
  const footnoted = await run('notify', 'crew-discord', { next: 'on', streams: 'on', calls: 'on' });
  assert.deepEqual(footnoted.content.split('\n'), [
    'You\'ll get pinged when your match is called.',
    'You\'ll get pinged when your next opponent is set.',
    'You\'ll get pinged when your set is on stream.',
    '-# Next opponents are off by default for tournaments, so pings only come where `/t-o tournament posts` turned them on.',
    '-# Stream alerts are off by default for tournaments, so pings only come where `/t-o tournament posts` turned them on.',
  ]);
  // turning one off, or failing to turn it on, says nothing about the server
  assert.equal((await run('notify', 'crew-discord', { next: 'off' })).content, 'No more next opponent pings.');
  assert.equal((await run('notify', 'stranger', { next: 'on' })).content.split('\n').length, 1);
  assert.deepEqual(state.nextPings, ['me-discord']);
  Object.assign(state, { callPings: [], nextPings: [], streamPings: [], messages: {} });
});

test('/notify lets TOs look at and change anyone\'s pings', async () => {
  state.players = { 1: { ...crew, discordId: 'crew-discord' } };
  state.links = { 'me-discord': me };
  state.callPings = [];
  state.streamPings = [];
  state.regPings = [];
  state.regDmPings = [];
  state.startDmPings = [];
  state.messages = {};
  const as = (id) => ({ id, displayName: id.replace('-discord', '') });
  const membership = (displayName) => {
    const changed = [];
    return { displayName, changed, roles: { add: async (role) => changed.push(['add', role.name]), remove: async (role) => changed.push(['remove', role.name]) } };
  };

  // someone who isn't a TO gets nothing about someone else, look or change
  const refused = await run('notify', 'someone', { user: as('me-discord'), member: membership('Me'), calls: 'on' });
  assert.ok(refused.flags);
  assert.equal(refused.content, 'Only TOs can see or change someone else\'s pings. Leave out `user` for yours. `/t-o role list` shows who they are.');
  assert.deepEqual(state.callPings, []);
  assert.equal((await run('notify', 'someone', { user: as('me-discord'), member: membership('Me') })).content, refused.content);

  // picking yourself in user: is the same as leaving it out
  assert.match((await run('notify', 'me-discord', { user: as('me-discord'), member: membership('Me'), calls: 'on' })).content, /^You'll get pinged when your match is called\.$/);
  assert.deepEqual(state.callPings, ['me-discord']);

  // a TO sets someone else's, going by their start.gg
  state.callPings = [];
  const theirs = await run('notify', 'to-discord', { user: as('me-discord'), member: membership('Me'), calls: 'on', streams: 'on' });
  assert.ok(theirs.flags);
  assert.match(theirs.content, /^They'll get pinged when their match is called\.\nThey'll get pinged when their set is on stream\.$/);
  assert.deepEqual(state.callPings, ['me-discord']);
  assert.deepEqual(state.streamPings, ['me-discord']);

  // nobody to look up, so theirs stay off with a nudge to link them
  const stranger = await run('notify', 'to-discord', { user: as('stranger'), member: membership('stranger'), streams: 'on' });
  assert.match(stranger.content, /^Stream alert pings need their start\.gg\. Ask them to run `\/link` with their profile link\.$/);
  assert.deepEqual(state.streamPings, ['me-discord']);

  // looking shows their pings and their tracked posts
  const seen = await run('notify', 'to-discord', { user: as('crew-discord'), member: membership('Crew') });
  assert.match(seen.content, /^\*\*Crew's pings\*\*\n\*\*Match calls:\*\* off.*-# They're tracked as Crew, with set results on and stream alerts on/s);

  // DMs opt in the same way, and everything turns back off. registration defers, so those answers are strings
  const all = await run('notify', 'to-discord', { user: as('me-discord'), member: membership('Me'), all: 'on' });
  assert.match(all, /They'll get pinged when their match is called\..*They'll get a DM 1 hour before the tournament starts,/s);
  assert.deepEqual(state.regDmPings, ['me-discord']);
  assert.deepEqual(state.startDmPings, ['me-discord']);

  // registration hands them the role, taking it off when it's turned back off
  const member = membership('Me');
  await run('notify', 'to-discord', { user: as('me-discord'), member, registration: 'on' });
  assert.deepEqual(member.changed, [['add', 'Reg Reminders']]);
  assert.deepEqual(state.regPings, ['me-discord']);
  const off = await run('notify', 'to-discord', { user: as('me-discord'), member, role: { id: 'reg-role', name: 'Reg Reminders' }, registration: 'off' });
  assert.match(off, /^No more reg reminder pings\.$/);
  assert.deepEqual(member.changed, [['add', 'Reg Reminders'], ['remove', 'Reg Reminders']]);
  assert.deepEqual(state.regPings, []);

  // bots need no pings, and leavers aren't in the server to change
  assert.equal((await run('notify', 'to-discord', { user: { id: 'bot-1', bot: true } })).content, 'Bots don\'t need pings.');
  assert.equal((await run('notify', 'to-discord', { user: as('ghost') })).content, 'Pick someone in this server.');
  state.callPings = [];
  state.streamPings = [];
  state.regPings = [];
  state.regDmPings = [];
  state.startDmPings = [];
});

test('/notify registration makes its role mentionable so the role ping notifies', async () => {
  state.regPings = [];
  let created = null;
  let edited = null;
  const guild = {
    roles: {
      cache: { get: () => undefined, find: () => undefined, },
      create: async (args) => { created = args; return { id: 'reg-role', name: 'Reg Reminders', ...args }; },
    },
  };
  const member = { displayName: 'Me', roles: { add: async () => {}, remove: async () => {} } };
  const interaction = {
    commandName: 'notify', user: { id: 'me-discord' }, memberPermissions: { has: () => false },
    guild, member,
    options: {
      getSubcommand: () => null, getString: (name) => (name === 'registration' ? 'on' : null),
      getBoolean: () => null, getUser: () => null, getMember: () => member,
    },
    reply: async () => {}, deferReply: async () => {}, editReply: async () => {},
  };
  const { handleCommand } = await import('../src/commands/index.js');
  state.links = { 'me-discord': { userId: 7, playerId: 70, tag: 'Me', slug: 'user/me' } };
  await handleCommand(interaction);
  assert.equal(created?.name, 'Reg Reminders');
  assert.equal(created?.mentionable, true);

  // an existing role that isn't mentionable gets fixed on the next opt-in
  const existing = { id: 'reg-role', name: 'Reg Reminders', mentionable: false, edit: async (args) => { edited = args; return existing; } };
  const guild2 = { roles: { cache: { get: () => undefined, find: (fn) => (fn(existing) ? existing : undefined) }, create: async () => assert.fail('role already exists') } };
  const interaction2 = { ...interaction, guild: guild2 };
  await handleCommand(interaction2);
  assert.deepEqual(edited, { mentionable: true });
  state.regPings = [];
});

test('/notify lets TOs pick a tracked player without a member mention', async () => {
  state.players = {
    1: { ...crew, discordId: 'crew-discord' },
    2: { userId: 2, playerId: 20, tag: 'No Discord', slug: 'user/no-discord' },
  };
  state.links = {};
  state.callPings = [];
  state.streamPings = [];

  const refused = await run('notify', 'someone', { player: '1', calls: 'on' });
  assert.equal(refused.content, 'Only TOs can see or change a tracked player\'s pings. Leave out `player` for yours. `/t-o role list` shows who they are.');
  assert.deepEqual(state.callPings, []);

  const changed = await run('notify', 'to-discord', { player: '1', calls: 'on', streams: 'on' });
  assert.match(changed.content, /^They'll get pinged when their match is called\.\nThey'll get pinged when their set is on stream\.$/);
  assert.deepEqual(state.callPings, ['crew-discord']);
  assert.deepEqual(state.streamPings, ['crew-discord']);
  assert.match((await run('notify', 'to-discord', { player: '1' })).content, /^\*\*Crew's pings\*\*/);
  assert.equal((await run('notify', 'to-discord', { player: '2', calls: 'on' })).content, 'No Discord has no Discord connected on start.gg, so there is nobody to ping.');
  assert.equal((await run('notify', 'to-discord', { player: '1', user: { id: 'crew-discord' } })).content, 'Pick either `user` or `player`, not both.');
});

test('/track add starts set results and stream alerts off and says how to turn them on', async () => {
  state.players = {};
  state.links = {};
  state.tournaments = {};
  // the second answer is for the tournament check it kicks off
  mockApi(({ query }) => (query.includes('user(slug:') ? { user: { id: 8, slug: 'user/new', player: { id: 80, gamerTag: 'New' } } } : {}));
  const reply = await run('track', 'to-discord', { profile: 'start.gg/user/new' }, 'add');
  assert.match(reply.embeds[0].data.description, /^Now tracking \[New\].*\. Their placements post here\.\n-# Set results and stream alerts start off\. `\/track posts` turns them on$/);
  assert.equal(state.players[8].setResults, false);
  assert.equal(state.players[8].streamAlerts, false);
  assert.equal(state.players[8].callPings, undefined);
  await settle();
});

test('/track add and remove let anyone track or untrack themselves, and only TOs someone else', async () => {
  state.players = {};
  state.links = {};
  state.tournaments = {};
  state.accounts = { 'new-discord': 8 };
  const profile = { id: 8, slug: 'user/new', images: [], player: { id: 80, gamerTag: 'New' }, authorizations: [{ externalId: 'new-discord' }] };
  mockApi(({ query }) => {
    if (query.includes('user(slug:')) return { user: profile };
    // the account search reads the discord on each saved account live
    if (query.includes('u8: user')) return { u8: { slug: 'user/new', player: { gamerTag: 'New' }, images: [], authorizations: [{ externalId: 'new-discord' }] } };
    return {};
  });

  // someone else's start.gg isn't theirs to track
  const refused = await run('track', 'someone', { profile: 'start.gg/user/new' }, 'add');
  assert.equal(refused.content, 'Only TOs can track someone else. New\'s start.gg has a different Discord connected.');
  assert.ok(refused.flags);
  assert.equal(state.players[8], undefined);

  // left out, it finds theirs by the discord connected on start.gg
  const added = await run('track', 'new-discord', {}, 'add');
  assert.match(added.embeds[0].data.description, /^Now tracking \[New\]/);
  assert.equal(state.players[8].discordId, 'new-discord');
  await settle();

  // untracking: someone else can't, they can, left out or by name
  const blocked = await run('track', 'someone', { player: '8' }, 'remove');
  assert.equal(blocked.content, 'Only TOs can untrack someone else. Leave out `player` to untrack yourself. `/t-o role list` shows who they are.');
  assert.match((await run('track', 'new-discord', {}, 'remove')).content, /^Stop tracking New\?/);
  assert.match((await run('track', 'to-discord', { player: '8' }, 'remove')).content, /^Stop tracking New\?/);
  assert.equal((await run('track', 'someone', {}, 'remove')).content, 'You aren\'t tracked. `/track add` tracks you.');
  state.accounts = {};
});

test('/track add user: picks a server member, found by the Discord on their start.gg, and someone else takes a TO', async () => {
  state.players = {};
  state.links = {};
  state.tournaments = {};
  state.accounts = { 'new-discord': 8 };
  const profile = { id: 8, slug: 'user/new', images: [], player: { id: 80, gamerTag: 'New' }, authorizations: [{ externalId: 'new-discord' }] };
  mockApi(({ query }) => {
    if (query.includes('user(slug:')) return { user: profile };
    if (query.includes('u8: user')) return { u8: { slug: 'user/new', player: { gamerTag: 'New' }, images: [], authorizations: [{ externalId: 'new-discord' }] } };
    return {};
  });
  const pick = (id, displayName = 'New') => ({ user: { id }, member: { displayName } });

  const refused = await run('track', 'someone', pick('new-discord'), 'add');
  assert.equal(refused.content, 'Only TOs can track someone else. Leave out `user` to track yourself. `/t-o role list` shows who they are.');
  assert.ok(refused.flags);
  assert.equal(state.players[8], undefined);

  const added = await run('track', 'to-discord', pick('new-discord'), 'add');
  assert.match(added.embeds[0].data.description, /^Now tracking \[New\]/);
  assert.equal(state.players[8].discordId, 'new-discord');
  await settle();

  // picking yourself needs no TO, the same as leaving it out
  delete state.players[8];
  const self = await run('track', 'new-discord', pick('new-discord'), 'add');
  assert.match(self.embeds[0].data.description, /^Now tracking \[New\]/);
  await settle();

  // the name, never a mention, says why there's nothing to track yet
  const unknown = await run('track', 'to-discord', pick('stranger-discord', 'Stranger'), 'add');
  assert.equal(unknown.content, 'Couldn\'t find a start.gg with Stranger\'s Discord connected. Ask them to run `/link` once, or add them with `profile:` and their start.gg link.');
  assert.deepEqual(unknown.allowedMentions, { parse: [] });

  assert.equal((await run('track', 'to-discord', { user: { id: 'helper', bot: true }, member: {} }, 'add')).content, 'Bots don\'t have start.gg accounts.');
  assert.equal((await run('track', 'to-discord', { ...pick('new-discord'), profile: 'start.gg/user/new' }, 'add')).content, 'Pick either `user` or `profile`, not both.');
  assert.equal((await run('track', 'to-discord', { user: { id: 'gone' } }, 'add')).content, 'Pick someone in this server.');
  state.accounts = {};
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

test('/track list only notes what differs from a new player, then lists tracked tournaments', () => {
  const now = Math.floor(Date.now() / 1000);
  const [list, tournaments] = embeds.trackedList({
    1: { ...crew, setResults: false, streamAlerts: false },
    2: { userId: 2, playerId: 20, tag: 'Old', slug: 'user/old' },
    3: { userId: 3, playerId: 30, tag: 'Quiet', slug: 'user/quiet', setResults: true, streamAlerts: false },
    4: { userId: 4, playerId: 40, tag: 'Streamer', slug: 'user/streamer', setResults: false, streamAlerts: true },
  }, 0, {
    5: { id: 5, name: 'Weekly', slug: 'tournament/weekly', startAt: now + 86400, tracked: { by: 'admin', at: 0, posts: { top8: false, calls: false } } },
    6: { id: 6, name: 'Local', slug: 'tournament/local', startAt: now + 3600, tracked: { by: 'manual', at: 0, posts: { calls: true } } },
    // the crew's, not tracked, and one that's over
    7: { id: 7, name: 'Major', slug: 'tournament/major', startAt: now },
    8: { id: 8, name: 'Done', slug: 'tournament/done', startAt: now - 86400, resultsPosted: true, tracked: { by: 'manual' } },
  });
  const lines = Object.fromEntries(list.data.description.split('\n').slice(0, 4).map((line) => {
    const tag = line.match(/^\[(.+?)\]/)?.[1];
    return [tag, line];
  }));
  assert.equal(lines.Crew, '[Crew](https://www.start.gg/user/crew)');
  // saved before either started off, so both still count as on
  assert.match(lines.Old, /\[Old\].* · set results on · stream alerts on$/);
  assert.match(lines.Quiet, /\[Quiet\].* · set results on$/);
  assert.match(lines.Streamer, /\[Streamer\].* · stream alerts on$/);
  assert.match(list.data.description, /plus their sets and streams once `\/track posts` turns them on/);

  assert.equal(tournaments.data.title, 'Tracked tournaments · 2');
  const [first, second] = tournaments.data.description.split('\n');
  assert.equal(first, `[Local](https://www.start.gg/tournament/local) · <t:${now + 3600}:d>`);
  assert.equal(second, `[Weekly](https://www.start.gg/tournament/weekly) · <t:${now + 86400}:d> · match calls off · top 8s off`);
});

test('/t-o tournament list says what\'s going on now, where, and links each tournament\'s event and threads', () => {
  const now = Math.floor(Date.now() / 1000);
  const [card] = embeds.tournamentList({
    5: {
      id: 5, name: 'Weekly', slug: 'tournament/weekly', startAt: now + 86400, city: 'Buffalo', addrState: 'NY',
      tracked: { by: 'manual', at: 0, posts: { top8: false }, schedule: [48, 6] }, images: [{ url: 'https://images.example/weekly.png' }],
    },
    6: { id: 6, name: 'Live', slug: 'tournament/live', startAt: now - 3600, endAt: now + 3600, isOnline: true, tracked: { by: 'manual', at: 0, posts: {} } },
    7: { id: 7, name: 'Done', slug: 'tournament/done', startAt: now - 86400, resultsPosted: true, tracked: { by: 'manual', at: 0, posts: {} } },
  }, {
    now,
    reminders: { 5: now + 3600 },
    events: { 5: { eventId: 'event-5' }, 6: { eventId: 'event-6', gone: true } },
    // one per event for the live one, keyed by event slugs that start with its own
    threads: { 'tournament/live/event/singles': { id: 'thread-1' }, 'tournament/live/event/doubles': { id: 'thread-2' }, 'tournament/lively': { id: 'not-it' } },
    guildId: 'server',
  });
  assert.equal(card.data.title, 'Tracked tournaments · 2');
  assert.equal(card.data.thumbnail.url, 'https://images.example/weekly.png');
  const [live, liveNotes, , weekly, weeklyNotes] = card.data.description.split('\n');
  assert.equal(live, '**[Live](https://www.start.gg/tournament/live)**');
  // the event a mod deleted isn't linked, and a slug that only starts the same isn't its thread
  assert.equal(liveNotes, `Going on now, started <t:${now - 3600}:R> · Online · <#thread-1> · <#thread-2>`);
  assert.equal(weekly, '**[Weekly](https://www.start.gg/tournament/weekly)**');
  assert.equal(weeklyNotes, `<t:${now + 86400}:f> · <t:${now + 86400}:R> · Buffalo, NY · top 8s off · reminders 2d, 6h · next reminder <t:${now + 3600}:R> · [Discord event](https://discord.com/events/server/event-5)`);

  const [empty] = embeds.tournamentList({}, { now });
  assert.match(empty.data.description, /^None yet\. A TO can track one with `\/t-o tournament add`\./);
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
  const choicesFor = async (typed, commandName = 'stats', subcommand = null) => {
    let choices;
    await handleAutocomplete({ commandName, user: { id: 'anyone' }, options: { getSubcommand: () => subcommand, getFocused: () => typed }, respond: async c => { choices = c; } });
    return choices;
  };
  state.players = {};
  state.links = {};
  // a stat command looks up anyone by a pasted start.gg link, so what's typed is offered as one
  assert.deepEqual(await choicesFor('start.gg/user/abc123'), [{ name: 'Look up start.gg/user/abc123 on start.gg', value: 'start.gg/user/abc123' }]);
  assert.deepEqual(await choicesFor(''), [{ name: 'Nobody is tracked yet. Paste a start.gg profile link to look anyone up', value: 'nobody' }]);
  assert.deepEqual(await choicesFor('Leo', 'profile'), [{ name: 'Nobody is tracked yet, /track add someone first', value: 'Leo' }]);
  state.players = { 1: crew };
  // a name can't be a profile, so it isn't offered as a lookup
  assert.deepEqual(await choicesFor('Leo', 'h2h'), [{ name: 'Nobody tracked or linked matches "Leo". Paste their start.gg profile link', value: 'Leo' }]);
  assert.deepEqual(await choicesFor('f64a83c8', 'h2h'), [{ name: 'Look up f64a83c8 on start.gg', value: 'f64a83c8' }]);
  assert.deepEqual(await choicesFor('Leo', 'profile'), [{ name: 'Nobody tracked or linked matches "Leo", /track add them first', value: 'Leo' }]);
  assert.deepEqual(await choicesFor('cr'), [{ name: 'Crew', value: '1' }]);

  // linked people come after the tracked ones, marked, and only where they can be picked
  state.links = { 'me-discord': { ...me, tag: 'Crewmate' } };
  assert.deepEqual(await choicesFor('cr'), [{ name: 'Crew', value: '1' }, { name: 'Crewmate (linked)', value: '7' }]);
  assert.deepEqual(await choicesFor('cr', 'track', 'posts'), [{ name: 'Crew', value: '1' }]);
  assert.deepEqual(await choicesFor('cr', 'track', 'remove'), [{ name: 'Crew', value: '1' }]);
  assert.deepEqual(await choicesFor('mate', 'track', 'posts'), [{ name: 'Nobody tracked matches "mate"', value: 'mate' }]);
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

test('/upcoming only lists tournaments with 3 or more of the crew registered', async () => {
  const third = { userId: 3, playerId: 30, tag: 'Third', slug: 'user/third' };
  state.players = { 1: { ...crew, discordId: 'crew-discord' }, 2: b, 3: third };
  state.links = {};
  const now = Math.floor(Date.now() / 1000);
  const entry = (userId, event) => ({ userId, event, eventSlug: `tournament/t/event/${event}`, eventId: userId });
  const tourney = (id, name, entries) => ({
    id, name, slug: `tournament/${name}`, startAt: now + 3600, endAt: now + 7200,
    city: 'Buffalo', addrState: 'NY', images: [], entries, userIds: [...new Set(entries.map((each) => each.userId))],
  });
  state.tournaments = {
    // two of the crew in three events still stays out, it counts people
    5: tourney(5, 'duo', [entry(1, 'Singles'), entry(1, 'Doubles'), entry(2, 'Singles')]),
    6: tourney(6, 'crew-major', [entry(1, 'Singles'), entry(2, 'Singles'), entry(3, 'Singles')]),
  };
  const all = await run('upcoming', 'crew-discord', { player: 'all' });
  assert.deepEqual(all.embeds.map((embed) => embed.data.title), ['crew-major']);
  // one player still only sees their own events, but only in crew tournaments
  const mine = await run('upcoming', 'crew-discord', { player: '1' });
  assert.deepEqual(mine.embeds.map((embed) => embed.data.title), ['crew-major']);
  assert.match(mine.embeds[0].data.description, /\*\*Players:\*\*\n\[Crew\]\(.*\): Singles/);
  // nothing with enough crew says so
  state.tournaments = { 5: tourney(5, 'duo', [entry(1, 'Singles'), entry(2, 'Singles')]) };
  assert.match((await run('upcoming', 'crew-discord', { player: 'all' })).embeds[0].data.description, /No upcoming tournament has 3 or more of the crew registered yet/);
  assert.match((await run('upcoming', 'crew-discord', { player: '1' })).embeds[0].data.description, /Crew has no upcoming tournament with 3 or more of the crew registered yet/);
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
  assert.match(text, /\*\*Head-to-head:\*\* [█░]{10} \d+%/);
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

// fresh ids each, since the history caches outlive the test
function predictPair(id, games) {
  state.players = { [id]: { userId: id, playerId: id, tag: 'Crew', slug: `user/crew${id}`, discordId: 'crew-discord' }, [id + 1]: { userId: id + 1, playerId: id + 1, tag: 'Rival', slug: `user/rival${id}` } };
  state.links = {};
  const nodes = games.map((game, i) => predictNode(i + 1, game, [id, id + 1], i % 2 ? [0, 2] : [2, 0]));
  mockApi(({ query }) => {
    if (query.includes('user(id:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes } } };
  });
}

test('predict sticks to Ultimate without melee, even for two who mostly play Melee', async () => {
  predictPair(871, [MELEE, MELEE, MELEE, ULTIMATE]);
  const ultimate = (await run('predict', 'crew-discord', { opponent: '872' })).embeds[0].data;
  assert.match(ultimate.title, /Crew \d+% · \d+% Rival/);
  assert.doesNotMatch(ultimate.author?.name ?? '', /Melee/);
  const melee = (await run('predict', 'crew-discord', { opponent: '872', melee: true })).embeds[0].data;
  assert.match(melee.author.name, /Melee/);
});

test('predict without melee names who has never played Ultimate and points at melee:True', async () => {
  predictPair(881, [MELEE, MELEE]);
  assert.equal((await run('predict', 'crew-discord', { opponent: '882' })).content,
    'Neither Crew nor Rival has played Ultimate singles on start.gg.\n-# Add `melee:True` for Melee odds');
  assert.match((await run('predict', 'crew-discord', { opponent: '882', melee: true })).embeds[0].data.title, /Crew \d+% · \d+% Rival/);
});
