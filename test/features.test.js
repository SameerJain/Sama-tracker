import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbedBuilder } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-features-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleCommand } = await import('../src/commands/index.js');
const api = await import('../src/startgg.js');
const embeds = await import('../src/embeds/index.js');
const { postWeeklyRecap } = await import('../src/tracker.js');
const tracker = await import('../src/tracker.js');
const { periodSummary } = await import('../src/reports.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ data: respond(JSON.parse(options.body)) }) });
}

const crewPlayer = { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' };
// a tournament tracked by hand with everything on, the way /t-o tournament add leaves it
const tracked = { by: 'manual', at: 0, sets: true, stream: true, top8: true, reminders: true };
const event = { name: 'Singles', slug: 'tournament/local/event/singles', startAt: 150, numEntrants: 32,
  videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'Local' } };
const node = (id, completedAt, playerId = 10, dq = false) => ({
  id, completedAt, winnerId: playerId, fullRoundText: 'Winners round 1', event,
  slots: [playerId, 99].map((id, i) => ({
    entrant: { id, name: i ? 'Opponent' : 'Active', initialSeedNum: i ? 2 : 9, participants: [{ player: { id } }] },
    standing: { stats: { score: { value: dq && !i ? -1 : i ? 1 : 2 } } },
  })),
});
// a set already parsed, from the first player's side. sides use player ids as entrant ids
const result = (id, at, [meId, meName, mySeed], [themId, themName, theirSeed], won, [mine, theirs], round = 'Winners round 1') => ({
  id, completedAt: at, winnerId: won ? meId : themId, round,
  event: { slug: `tournament/t-${id}/event/singles`, videogame: { displayName: 'Ultimate' }, tournament: { name: `T-${id}` } },
  sides: [{ id: meId, name: meName, playerIds: [meId], score: mine, seed: mySeed }, { id: themId, name: themName, playerIds: [themId], score: theirs, seed: theirSeed }],
});

// newest first, 30 days each like /progress
const DAY = 86400;
const periodsFor = (player, sets, events, until, length = 2) => Array.from({ length }, (_, i) => {
  const period = { since: until - (i + 1) * 30 * DAY, until: until - i * 30 * DAY };
  return { ...period, summary: periodSummary(player, sets, events, period.since, period.until) };
});

test('registers run, scout, and progress with their required inputs', () => {
  for (const name of ['run', 'progress']) {
    const command = commands.find(c => c.name === name);
    assert.equal(command?.options[0].name, 'player');
    assert.equal(command.options[0].autocomplete, true);
  }
  assert.equal(commands.find(c => c.name === 'scout')?.options[0].name, 'profile');
  assert.equal(commands.find(c => c.name === 'scout').options[0].autocomplete, true);
});

test('scout tells a tracked player saved without their discord to /link, without checking everyone tracked', async () => {
  state.players = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i + 1, { ...crewPlayer, userId: i + 1, playerId: 100 + i }]));
  mockApi(() => assert.fail('nobody is saved with this discord, so there is nothing to check'));
  const replies = [];
  await handleCommand({
    commandName: 'scout', user: { id: 'allowed' },
    options: { getSubcommand: () => null, getString: () => 'target' },
    deferReply: async () => {}, editReply: async r => replies.push(r),
  });
  assert.match(replies.at(-1), /\/link/);
});

test('scout refuses untracked Discord callers before fetching an opponent', async () => {
  state.players = { 1: { ...crewPlayer, discordId: 'outsider' } };
  mockApi(({ query }) => {
    assert.match(query, /authorizations/);
    return { u1: { player: { gamerTag: 'Active' }, authorizations: [{ externalId: 'allowed' }] } };
  });
  const replies = [];
  await handleCommand({
    commandName: 'scout', user: { id: 'outsider' },
    options: { getSubcommand: () => null, getString: (name) => (name === 'profile' ? 'target' : null) },
    deferReply: async () => {}, editReply: async r => replies.push(r),
  });
  assert.match(replies.at(-1), /\/link/);
});

test('tracked callers can scout an untracked opponent without adding them', async () => {
  // the daily profile refresh saves the discord on their start.gg
  state.players = { 1: { ...crewPlayer, discordId: 'allowed' } };
  const set = node('scout-meeting', 150);
  mockApi(({ query }) => {
    if (query.includes('user(slug:')) return { user: { id: 2, slug: 'user/target', player: { id: 99, gamerTag: 'Target' } } };
    if (query.includes('authorizations')) return { u1: { player: { gamerTag: 'Active' }, authorizations: [{ externalId: 'allowed' }] } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [{ ...set,
      games: [{ winnerId: 10, selections: [{ entrant: { id: 99 }, character: { name: 'Fox' } }] }],
    }] } } };
  });
  let reply;
  await handleCommand({
    commandName: 'scout', user: { id: 'allowed' }, deferred: true,
    options: { getSubcommand: () => null, getString: (name) => (name === 'profile' ? 'https://www.start.gg/user/target' : null), getBoolean: () => null },
    deferReply: async options => assert.ok(options.flags), editReply: async result => { reply = result; },
  });
  const text = reply.embeds.map(e => e.toJSON().description).join('\n');
  assert.match(text, /Fox/);
  assert.match(text, /### You vs Target\n\*\*Ultimate:\*\* 1-0/);
  assert.deepEqual(Object.keys(state.players), ['1']);
});

test('scout takes a tracked player pick, with no start.gg link lookup', async () => {
  state.players = { 1: { ...crewPlayer, discordId: 'allowed' }, 2: { userId: 2, playerId: 99, tag: 'Target', slug: 'user/target' } };
  const set = node('scout-pick', 150);
  mockApi(({ query }) => {
    if (query.includes('user(slug:')) return assert.fail('a list pick needs no link lookup');
    if (query.includes('authorizations')) return { u1: { player: { gamerTag: 'Active' }, authorizations: [{ externalId: 'allowed' }] } };
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [{ ...set,
      games: [{ winnerId: 10, selections: [{ entrant: { id: 99 }, character: { name: 'Fox' } }] }],
    }] } } };
  });
  let reply;
  await handleCommand({
    commandName: 'scout', user: { id: 'allowed' }, deferred: true,
    options: { getSubcommand: () => null, getString: (name) => name === 'profile' ? '2' : null, getBoolean: () => null },
    deferReply: async options => assert.ok(options.flags), editReply: async result => { reply = result; },
  });
  const cards = reply.embeds.map((e) => e.toJSON());
  assert.match(cards[0].title, /Scouting Target/);
  assert.match(cards.map((card) => card.description).join('\n'), /### You vs Target\n\*\*Ultimate:\*\* 1-0/);
});

test('scout quick shows toughest opponents without the caller, and worst matchups by game', async () => {
  const crew = { ...crewPlayer, tag: 'Crew' };
  const target = { userId: 2, playerId: 99, tag: 'Target', slug: 'user/target' };
  const theirs = [
    result('m1', 900, [99, 'Target', 2], [10, 'Crew', 1], true, [2, 1], 'Winners Final'),
    result('m2', 800, [99, 'Target', 2], [10, 'Crew', 1], false, [0, 2], 'Losers Final'),
    result('c1', 700, [99, 'Target', 1], [50, 'Common', 9], true, [2, 0], 'Grand Final'),
    result('c2', 600, [99, 'Target', 3], [50, 'Common', 4], false, [1, 2], 'Losers Round 1'),
    result('c3', 500, [99, 'Target', 3], [50, 'Common', 4], false, [1, 2], 'Losers Round 1'),
  ];
  const mine = [theirs[0], theirs[1]];
  const ultimate = { id: 1386, displayName: 'Ultimate' };
  const characterSets = [
    { id: 'x1', completedAt: 900, videogame: ultimate, games: [
      { character: 'Fox', against: 'Sheik', stage: 'Smashville', won: false },
      { character: 'Fox', against: 'Sheik', stage: 'Smashville', won: false },
      { character: 'Fox', against: 'Sheik', stage: 'Battlefield', won: true },
    ] },
    { id: 'x2', completedAt: 700, videogame: ultimate, games: [
      { character: 'Fox', against: 'Marth', stage: 'Battlefield', won: true },
      { character: 'Fox', against: 'Marth', stage: 'Battlefield', won: true },
      { character: 'Falco', against: 'Marth', stage: 'Smashville', won: true },
    ] },
  ];
  const quick = embeds.scout(crew, target, mine, theirs, characterSets).map((card) => card.toJSON().description).join('\n');
  // most losses first, and the caller stays out of it since head-to-head covers them
  assert.match(quick, /### Toughest opponents\n\*\*Common\*\* 1-2 \(33%\)/);
  assert.doesNotMatch(quick, /### Toughest opponents\n.*\*\*Crew\*\*/);
  // worst win rate against one character, by game
  assert.match(quick, /### Worst matchups\n\*\*Ultimate:\*\* Sheik 1-2 \(33%\)/);
  assert.match(quick, /that can be out of date/);

  // undefeated means no toughest opponents, and unreported means no worst matchups
  const clean = embeds.scout(crew, target, [], [theirs[0]], []).map((card) => card.toJSON().description).join('\n');
  assert.doesNotMatch(clean, /Toughest opponents|Worst matchups/);
});

test('scout verbose covers their history, habits, matchups, stages and your odds', async () => {
  const { predict } = await import('../src/predict.js');
  const crew = { ...crewPlayer, tag: 'Crew' };
  const target = { userId: 2, playerId: 99, tag: 'Target', slug: 'user/target' };
  // from Target's side, newest first. Crew is in the first two, Common in the others
  const theirs = [
    result('m1', 900, [99, 'Target', 2], [10, 'Crew', 1], true, [2, 1], 'Winners Final'),
    result('m2', 800, [99, 'Target', 2], [10, 'Crew', 1], false, [0, 2], 'Losers Final'),
    result('c1', 700, [99, 'Target', 1], [50, 'Common', 9], true, [2, 0], 'Grand Final'),
    result('c2', 600, [99, 'Target', 3], [50, 'Common', 4], false, [1, 2], 'Losers Round 1'),
  ];
  const mine = [theirs[0], theirs[1], result('c3', 500, [10, 'Crew', 1], [50, 'Common', 9], true, [2, 0])];
  const events = [{ placement: 1, seed: 1, dq: false, event: { ...event, slug: 'e/1', startAt: 700 } }];
  const ultimate = { id: 1386, displayName: 'Ultimate' };
  const characterSets = [
    { id: 'x1', completedAt: 900, videogame: ultimate, games: [
      { character: 'Fox', against: 'Sheik', stage: 'Smashville', won: false },
      { character: 'Fox', against: 'Sheik', stage: 'Smashville', won: false },
      { character: 'Fox', against: 'Sheik', stage: 'Battlefield', won: true },
    ] },
    { id: 'x2', completedAt: 700, videogame: ultimate, games: [
      { character: 'Fox', against: 'Marth', stage: 'Battlefield', won: true },
      { character: 'Fox', against: 'Marth', stage: 'Battlefield', won: true },
      { character: 'Falco', against: 'Marth', stage: 'Smashville', won: true },
    ] },
  ];
  const odds = predict(crew, target, mine, theirs);
  const cards = embeds.scoutReport(crew, target, { mine, theirs, characterSets, events, odds, players: { 1: crew } }).map(card => card.toJSON());
  const text = cards.map(card => [card.title, card.description, ...(card.fields ?? []).map(f => `${f.name}: ${f.value}`)].join('\n')).join('\n');

  // their lifetime numbers, including how they do against the crew
  assert.equal(cards[0].author.name, 'Scouting');
  assert.equal(cards[0].title, 'Target');
  assert.match(text, /Vs the crew: \*\*Crew\*\* 1-1/);

  assert.match(text, /Form and tendencies\n### Recent form\n\*\*Ultimate:\*\* 2-2 \(50%\) · last 4 sets · none in the last 90 days/);
  assert.ok(text.includes([
    '### Habits in Ultimate',
    '**Close sets:** 1-1 (50%)',
    '**Vs higher seeds:** 1-1 (50%) · **Vs lower seeds:** 1-1 (50%)',
    '**Bracket:** winners side 1-0 (100%) · losers side 0-2 (0%) · grand finals 1-0 (100%)',
    '**Sweeps:** won 1 of 2 without dropping a game · lost 1 of 2 without taking one',
  ].join('\n')), text);
  assert.match(text, /\*\*W\*\* 2-1 vs \*\*Crew\*\* · Winners Final · \[T-m1\]/);

  assert.match(text, /Characters and stages\n### Ultimate\n1\\\. \*\*Fox\*\* · 83% of games · won 3 of 5 \(60%\) · last <t:900:R>\n2\\\. \*\*Falco\*\*/);
  assert.match(text, /\*\*Struggles against:\*\* Sheik 1-2 \(33%\)\n\*\*Strong against:\*\* Marth 3-0 \(100%\)\n\*\*Fox struggles most vs:\*\* Sheik 1-2 \(33%\)\n\*\*Worst stages:\*\* Smashville 1-2 \(33%\)\n\*\*Best stages:\*\* Battlefield 3-0 \(100%\)/);
  assert.match(text, /Reported in 2 of their last 2 Ultimate sets · TO reporting can be out of date/);

  // players and characters they lose to most, with your record against the shared one
  assert.match(text, /### Toughest opponents in Ultimate\n\*\*Common\*\* 1-1 \(50%\) · you're 1-0 vs them/);
  assert.match(text, /### Worst matchups in Ultimate\nSheik 1-2 \(33%\)/);

  // the same odds /predict gives, from the caller's side
  const matchup = cards.at(-1);
  assert.equal(matchup.title, 'Crew vs Target');
  const [, chance] = embeds.prediction(crew, target, odds)[0].data.title.match(/^Crew (\d+)%/);
  assert.match(matchup.description, new RegExp(`^\\*\\*Odds:\\*\\* \\*\\*Crew\\*\\* ${chance}% · ${100 - chance}% \\*\\*Target\\*\\* in Ultimate\\n`
    + '\\*\\*Head-to-head:\\*\\* Ultimate 1-1 \\(50%\\)\\n\\*\\*L\\*\\* 1-2 · Winners Final · \\[T-m1\\].*\\n\\*\\*W\\*\\* 2-0 · Losers Final'));
  assert.match(matchup.description, /### Common opponents · 1 in Ultimate\n\*\*Common\*\*: \*\*Crew\*\* 1-0 · \*\*Target\*\* 1-1/);
  assert.doesNotMatch(text, /NaN|undefined|null/);
  for (const batch of embeds.messages(embeds.scoutReport(crew, target, { mine, theirs, characterSets, events, odds, players: { 1: crew } }))) {
    assert.ok(batch.length <= 10);
  }
});

test('scout verbose says so when nothing is reported, and skips what it has nothing for', () => {
  const crew = { ...crewPlayer, tag: 'Crew' };
  const target = { userId: 2, playerId: 99, tag: 'Target', slug: 'user/target' };
  const theirs = [result('only', 900, [99, 'Target', 2], [50, 'Someone', 1], true, [2, 0])];
  const unreported = [{ id: 'only', completedAt: 900, videogame: { id: 1386, displayName: 'Ultimate' }, games: [] }];
  const text = embeds.scoutReport(crew, target, { mine: [], theirs, characterSets: unreported, events: [], odds: null, players: {} })
    .map(card => card.toJSON().description).join('\n');
  assert.match(text, /No characters reported in their last 1 singles set\./);
  assert.match(text, /Head-to-head:\*\* you haven't played each other/);
  assert.doesNotMatch(text, /Odds|Common opponents|Close sets|Sweeps: lost/);

  const nothing = embeds.scoutReport(crew, target, { mine: [], theirs: [], characterSets: [], events: [], odds: null, players: {} }).map(card => card.toJSON());
  assert.deepEqual(nothing.map(card => card.title), ['Target', 'Crew vs Target']);
  assert.match(nothing[0].description, /Nothing on start.gg yet/);
});

test('scout verbose goes through their whole history and every event, and stays private', async () => {
  state.players = { 1: { ...crewPlayer, playerId: 11, discordId: 'allowed' } };
  const pages = [];
  const eventsFor = new Set();
  mockApi(({ query, variables }) => {
    if (query.includes('user(slug:')) return { user: { id: 2, slug: 'user/deep', player: { id: 98, gamerTag: 'Deep' } } };
    if (query.includes('authorizations')) return { u1: { player: { gamerTag: 'Active' }, authorizations: [{ externalId: 'allowed' }] } };
    if (query.includes('events(query:')) {
      eventsFor.add(variables.id);
      return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [{ ...event, state: 'COMPLETED', userEntrant: { initialSeedNum: 3, isDisqualified: false, standing: { placement: 2 } } }] } } };
    }
    const sets = variables.id === 98 && !query.includes('selections');
    if (sets) pages.push(variables.page);
    const set = { ...node(`deep-${variables.id}-${variables.page}`, 150 - variables.page, variables.id),
      games: [{ winnerId: variables.id, stage: { name: 'Battlefield' }, selections: [{ entrant: { id: variables.id }, character: { name: 'Fox' } }] }] };
    // past the 15 pages the short version stops at
    return { player: { sets: { pageInfo: { totalPages: sets ? 16 : 1 }, nodes: [set] } } };
  });
  const replies = [];
  const interaction = {
    commandName: 'scout', user: { id: 'allowed' },
    options: { getSubcommand: () => null, getString: (name) => (name === 'profile' ? 'start.gg/user/deep' : null), getBoolean: (name) => name === 'verbose' },
    deferReply: async options => { assert.ok(options.flags); Object.assign(interaction, { deferred: true, ephemeral: true }); },
    editReply: async r => replies.push(r),
    followUp: async r => { assert.ok(r.flags, 'follow-ups stay private'); replies.push(r); },
  };
  await handleCommand(interaction);
  assert.deepEqual(pages.toSorted((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 1));
  // theirs for the report, and yours too so the odds know how big your brackets were
  assert.deepEqual([...eventsFor].sort(), [1, 2]);
  const titles = replies.flatMap(r => r.embeds.map(e => e.toJSON().title));
  assert.deepEqual(titles.filter(Boolean), ['Deep', 'Form and tendencies', 'Characters and stages', 'Active vs Deep']);
});

test('progress, scout, characters and run cards show the start.gg profile picture', async () => {
  const { characterUsage } = await import('../src/characters.js');
  const crew = { ...crewPlayer, tag: 'Crew', slug: 'user/crew', image: 'https://images.example/crew.png' };
  const target = { userId: 2, playerId: 99, tag: 'Target', slug: 'user/target', image: 'https://images.example/target.png' };
  const until = 200 * DAY;

  // /progress, a game with results and the empty card
  const sets = [result('p1', until - DAY, [10, 'Crew', 1], [20, 'Rival', 2], true, [2, 0])];
  const [progressCard] = embeds.progress(crew, periodsFor(crew, sets, [], until)).map((card) => card.toJSON());
  assert.equal(progressCard.thumbnail.url, crew.image);
  const [emptyCard] = embeds.progress(crew, periodsFor(crew, [], [], until)).map((card) => card.toJSON());
  assert.equal(emptyCard.thumbnail.url, crew.image);

  // /scout quick shows the opponent
  const theirs = [result('m1', 900, [99, 'Target', 2], [50, 'Common', 1], true, [2, 0])];
  const [scoutCard] = embeds.scout(crew, target, [], theirs, []).map((card) => card.toJSON());
  assert.equal(scoutCard.thumbnail.url, target.image);

  // /scout verbose matchup shows the caller as author and the opponent as thumbnail
  const report = embeds.scoutReport(crew, target, { mine: [], theirs, characterSets: [], events: [], odds: null, players: {} }).map((card) => card.toJSON());
  const versus = report.at(-1);
  assert.equal(versus.title, 'Crew vs Target');
  assert.equal(versus.author.icon_url, crew.image);
  assert.equal(versus.thumbnail.url, target.image);

  // /characters falls back to it without art, art still wins
  assert.equal(embeds.characters(crew, characterUsage([]), {}).toJSON().thumbnail.url, crew.image);
  assert.equal(embeds.characters(crew, characterUsage([]), { file: 'character-1386.png' }).toJSON().thumbnail.url, 'attachment://character-1386.png');

  // /run per-event cards show the tournament picture like the overview
  const tournament = { name: 'Local', slug: 'tournament/local', images: [{ url: 'https://images.example/local.png' }] };
  const cards = embeds.run(crew, tournament, [
    runIn('Singles', { sets: [['1', 3, 'Rival', 'Winners round 1', true]] }),
    runIn('Doubles', { sets: [['2', 3, 'Team', 'Winners round 1', true]] }),
  ]);
  assert.ok(cards.length > 2);
  for (const card of cards) assert.equal(card.toJSON().thumbnail.url, 'https://images.example/local.png');
});

test('period history paginates through edits and filters by completion time', async () => {
  const node = (id, completedAt) => ({
    id, completedAt, winnerId: 10, event: { slug: 'event/test' },
    slots: [10, 20].map(id => ({ entrant: { id, name: 'P', participants: [{ player: { id } }] } })),
  });
  mockApi(({ variables }) => ({ player: { sets: {
    pageInfo: { totalPages: 2 },
    nodes: variables.page === 1 ? [node('old-edit', 10)] : [node('inside', 150), node('end', 200)],
  } } }));
  assert.deepEqual((await api.getPeriodHistory(10, 100, 200)).map(s => s.id), ['inside']);
});

const runPlayer = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew' };
const runTournament = { name: 'Local', slug: 'tournament/local' };
// a run in one event: entry like getTournament's, sets like getRunSets'. Crew is entrant 1
const runIn = (event, { started = true, sets = [], ...entry } = {}) => {
  const eventSlug = `tournament/local/event/${event.toLowerCase().replaceAll(' ', '-')}`;
  return {
    entry: { event, eventSlug, entrants: 32, started, final: false, done: false, ...entry },
    sets: sets.map(([id, setState, opponent, round, won]) => ({
      id, state: setState, round, completedAt: setState === 3 ? Number(id) : null, winnerId: setState === 3 ? (won ? 1 : 2) : null,
      event: { slug: eventSlug },
      sides: [{ id: 1, name: 'Crew', playerIds: [10], score: setState === 3 ? (won ? 2 : 0) : null }, { id: 2, name: opponent, playerIds: [20], score: setState === 3 ? (won ? 1 : 2) : null }],
    })),
  };
};
const descriptions = cards => cards.map(e => e.data.description).join('\n');

test('a run in one bracket shows the sets so far, the final standing and what is next', () => {
  const run = runIn('Singles', { sets: [['1', 3, 'Rival', 'Winners round 1', true], ['2', 6, 'Rival', 'Winners round 2']] });
  const cards = embeds.run(runPlayer, runTournament, [run]);
  assert.equal(cards.length, 1);
  const text = descriptions(cards);
  assert.match(text, /Still in the bracket/);
  assert.match(text, /\*\*W\*\* 2-1 vs \*\*Rival\*\*/);
  assert.match(text, /\*\*Next:\*\* called vs \*\*Rival\*\* · \[Winners round 2\]/);
  const ended = descriptions(embeds.run(runPlayer, runTournament, [{ ...run, entry: { ...run.entry, final: true, placement: 5 } }]));
  assert.match(ended, /Finished 5th of 32/);
  assert.doesNotMatch(ended, /Next/);
});

test('/run shows the station and a scheduled time still to come', () => {
  const now = 1_000_000;
  const run = runIn('Singles', { sets: [['2', 6, 'Rival', 'Winners round 2']] });
  const next = (set) => descriptions(embeds.run(runPlayer, runTournament, [{ ...run, sets: [{ ...run.sets[0], ...set }] }], now));
  assert.match(next({ station: 4 }), /\*\*Next:\*\* called vs \*\*Rival\*\* · \[Winners round 2\]\([^)]+\) · \*\*Station 4\*\*$/m);
  assert.match(next({ state: 1, startAt: now + 900 }), /\*\*Next:\*\* next vs \*\*Rival\*\* · \[Winners round 2\]\([^)]+\) · <t:1000900:t>$/m);
  // a time already gone by is the pool's start, from the round's schedule, so it's left out
  assert.doesNotMatch(next({ state: 1, startAt: now - 900 }), /<t:|Station/);
  // already playing, the time doesn't matter anymore
  assert.match(next({ state: 2, startAt: now + 900, station: 2 }), /playing vs \*\*Rival\*\* · \[Winners round 2\]\([^)]+\) · \*\*Station 2\*\*$/m);
  // who /run's buttons are about: the next opponent in each bracket, singles only
  const doubles = runIn('Doubles', { sets: [['3', 6, 'Team', 'Winners round 1']] });
  doubles.sets[0].sides[0].playerIds.push(11);
  assert.deepEqual(embeds.nextOpponents(runPlayer, [run, doubles]).map(({ them }) => them.name), ['Rival']);
});

test('a run in several brackets at once puts the one that needs them soonest first', () => {
  const cards = embeds.run(runPlayer, runTournament, [
    runIn('Melee Singles', { sets: [['1', 3, 'Fox Main', 'Winners round 1', true], ['5', 1, 'Marth Main', 'Winners round 2']] }),
    runIn('Brawl Singles', { done: true, final: true, placement: 3, sets: [['2', 3, 'Snake', 'Winners final', false]] }),
    runIn('Ultimate Singles', { sets: [['3', 3, 'Steve', 'Winners round 1', true], ['6', 6, 'Kazuya', 'Winners round 2']] }),
    runIn('64 Singles', { started: false }),
    runIn('P+ Singles', { sets: [['4', 3, 'Someone', 'Losers round 1', false]] }),
    runIn('Smash 4 Singles', { sets: [['7', 7, 'Bayo', 'Winners round 1']] }),
    runIn('Doubles', { sets: [['8', 4, 'Team', 'Winners round 1']] }),
  ]);
  const overview = cards[0].data;
  assert.equal(overview.author.name, 'Crew\'s run · 7 brackets');
  assert.deepEqual(overview.description.split('\n').slice(0, 7), [
    '**Ultimate Singles** (1-0) · called vs **Kazuya** · [Winners round 2](https://www.start.gg/tournament/local/event/ultimate-singles/set/6)',
    '**Smash 4 Singles** · queued vs **Bayo** · [Winners round 1](https://www.start.gg/tournament/local/event/smash-4-singles/set/7)',
    '**Doubles** · ready vs **Team** · [Winners round 1](https://www.start.gg/tournament/local/event/doubles/set/8)',
    '**Melee Singles** (1-0) · next vs **Marth Main** · [Winners round 2](https://www.start.gg/tournament/local/event/melee-singles/set/5)',
    '**P+ Singles** (0-1) · waiting for the next opponent',
    '**64 Singles** · hasn\'t started yet',
    '**Brawl Singles** (0-1) · finished 🥉 3rd of 32',
  ]);
  // a card for each that started, in the same order
  assert.deepEqual(cards.slice(1).map(card => card.data.title), [
    'Ultimate Singles · 32 entrants', 'Smash 4 Singles · 32 entrants', 'Doubles · 32 entrants', 'Melee Singles · 32 entrants', 'P+ Singles · 32 entrants', 'Brawl Singles · 32 entrants',
  ]);
  assert.match(descriptions(cards.slice(1, 2)), /\*\*Next:\*\* called vs \*\*Kazuya\*\*/);
  assert.match(descriptions(cards.slice(-1)), /Finished 🥉 3rd of 32\n\n\*\*L\*\* 0-2 vs \*\*Snake\*\*/);
});

test('/run asks for every bracket they are in at once', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...runPlayer } };
  state.tournaments = {};
  const asked = [];
  mockApi(({ query, variables }) => {
    if (query.includes('tournaments(query:')) return { u1: { tournaments: { nodes: [{ id: 5, name: 'Local', slug: 'tournament/local', startAt: now - 3600, endAt: now + 3600 }] } } };
    if (query.includes('userEntrant')) {
      return { tournament: { id: 5, name: 'Local', slug: 'tournament/local', startAt: now - 3600, endAt: now + 3600, events: [
        { id: 50, name: 'Ultimate Singles', slug: 'tournament/local/event/ultimate', state: 'ACTIVE', numEntrants: 40, u1: { id: 1, standing: null } },
        { id: 51, name: 'Melee Singles', slug: 'tournament/local/event/melee', state: 'ACTIVE', numEntrants: 20, u1: { id: 1, standing: null } },
        { id: 52, name: '64 Singles', slug: 'tournament/local/event/64', state: 'CREATED', numEntrants: 12, u1: { id: 1, standing: null } },
        { id: 53, name: 'Brawl Singles', slug: 'tournament/local/event/brawl', state: 'ACTIVE', numEntrants: 8, u1: null },
      ] } };
    }
    asked.push(variables.id);
    const opponent = variables.id === 50 ? 'Steve' : 'Fox Main';
    return { event: { sets: { pageInfo: { totalPages: 1 }, nodes: [{
      id: variables.id * 10, state: variables.id === 51 ? 6 : 1, fullRoundText: 'Winners round 2', event: { slug: 'tournament/local/event/x' },
      slots: [[1, 10, 'Crew'], [2, 20, opponent]].map(([id, player, name]) => ({ entrant: { id, name, initialSeedNum: 1, participants: [{ player: { id: player } }] }, standing: null })),
    }] } } };
  });
  let reply;
  await handleCommand({
    commandName: 'run', user: { id: 'anyone' }, deferred: true,
    options: { getSubcommand: () => null, getString: () => '1' },
    deferReply: async () => {}, editReply: async (r) => { reply = r; },
  });
  // not the one that hasn't started, or the one they aren't in
  assert.deepEqual(asked.toSorted(), [50, 51]);
  const text = reply.embeds.map(e => e.toJSON().description).join('\n');
  assert.match(text, /^\*\*Melee Singles\*\* · called vs \*\*Fox Main\*\*.*\n\*\*Ultimate Singles\*\* · next vs \*\*Steve\*\*.*\n\*\*64 Singles\*\* · hasn't started yet/);
});

test('progress handles placements without sets or seeds without inventing win rates', () => {
  const periods = periodsFor(crewPlayer, [], [{ event: { ...event, startAt: 70 * DAY }, placement: 5, seed: null }], 80 * DAY);
  const text = embeds.progress(crewPlayer, periods).map(e => e.toJSON().description).join('\n');
  assert.doesNotMatch(text, /NaN|0%/);
  assert.match(text, /5th/);
  assert.match(text, /no seeded finishes/i);
  // all of that shows with verbose too
  const verbose = embeds.progress(crewPlayer, periodsFor(crewPlayer, [], [{ event: { ...event, startAt: 70 * DAY }, placement: 5, seed: null }], 80 * DAY, 6), { verbose: true })
    .map(e => e.toJSON().description).join('\n');
  assert.doesNotMatch(verbose, /NaN|undefined|null|0%/);
  assert.match(verbose, /no seeded finishes/i);
});

test('progress verbose digs into both periods, says what changed, and shows six periods as a trend', () => {
  const until = 200 * DAY;
  const sets = [
    // last 30 days: beat Rival as the lower seed in a close set, beat a lower seed clean, lost to a lower seed
    result('now-1', until - DAY, [10, 'Active', 9], [20, 'Rival', 2], true, [2, 1]),
    result('now-2', until - 2 * DAY, [10, 'Active', 1], [30, 'Low', 17], true, [2, 0]),
    result('now-3', until - 3 * DAY, [10, 'Active', 1], [40, 'Upset', 25], false, [1, 2]),
    // the 30 before: lost to Rival
    result('before-1', until - 40 * DAY, [10, 'Active', 9], [20, 'Rival', 2], false, [0, 2]),
    // four months back
    result('old-1', until - 130 * DAY, [10, 'Active', 5], [30, 'Low', 9], true, [2, 0]),
  ];
  const events = [
    { event: { ...event, slug: 'e/now', startAt: until - DAY, numEntrants: 40 }, placement: 4, seed: 9 },
    { event: { ...event, slug: 'e/before', startAt: until - 40 * DAY, numEntrants: 40 }, placement: 20, seed: 9 },
  ];
  const characterSets = [
    { id: 'now-1', completedAt: until - DAY, videogame: { id: 1386, displayName: 'Ultimate' }, games: [{ character: 'Fox', against: 'Sheik', won: true }, { character: 'Fox', against: 'Sheik', won: true }] },
    { id: 'before-1', completedAt: until - 40 * DAY, videogame: { id: 1386, displayName: 'Ultimate' }, games: [{ character: 'Falco', against: 'Sheik', won: false }] },
  ];
  const periods = periodsFor(crewPlayer, sets, events, until, 6);
  const text = embeds.progress(crewPlayer, periods, { verbose: true, characterSets }).map(e => e.toJSON().description).join('\n');

  assert.ok(text.startsWith([
    '### Last 30 days',
    `-# <t:${until - 30 * DAY}:d> to <t:${until}:d>`,
    '**Sets:** 2-1 (67%)',
    '**Games:** 5-3 (63%)',
    '**Period-ending streak:** W2 · best W2 · worst L1',
    '**Close sets:** 1-1 (50%)',
    '**Sweeps:** won 1 of 2 without dropping a game · lost 0 of 1 without taking one',
    '**Vs higher seeds:** 1-0 (100%) · **Vs lower seeds:** 1-1 (50%)',
  ].join('\n')), text);
  assert.match(text, /\*\*Best win:\*\* beat \*\*Rival\*\* \(seed 2\) 2-1 as seed 9/);
  assert.match(text, /\*\*Worst loss:\*\* lost to \*\*Upset\*\* \(seed 25\) 1-2 as seed 1/);
  assert.match(text, /\*\*Game record by character:\*\* Fox 2-0 \(100%\)/);
  assert.match(text, /\*\*Game record by character:\*\* Falco 0-1 \(0%\)/);
  assert.ok(text.includes([
    '### What changed',
    '**Win rate:** up 66.7 points (1 set → 3 sets)',
    '**Games won:** up 62.5 points (2 games → 8 games)',
    '**Average finish:** top 50% → top 10% (1 event → 1 event)',
    '**Rematches, before → now:** **Rival** 0-1 → 1-0',
  ].join('\n')), text);
  const trend = text.split('### Every 30 days, newest first\n')[1].split('\n').slice(0, 6);
  assert.equal(trend.length, 6);
  assert.match(trend[0], /sets 2-1 \(67%\) · 1 event, average top 10%/);
  assert.match(trend[4], /sets 1-0 \(100%\)/);
  assert.match(trend[5], /no sets or events/);
  assert.doesNotMatch(text, /NaN|undefined|null/);

  // the short one compares results too; verbose keeps the longer breakdowns
  const short = embeds.progress(crewPlayer, periods.slice(0, 2)).map(e => e.toJSON().description).join('\n');
  assert.doesNotMatch(short, /Sweeps|Rematches|Best win|Worst loss|Every 30 days|Game record/);
  assert.match(short, /\*\*Games:\*\* 5-3 \(63%\)/);
  assert.match(short, /\*\*Period-ending streak:\*\* W2/);
  assert.match(short, /\*\*Close sets:\*\* 1-1 \(50%\)/);
  assert.match(short, /\*\*Vs higher seeds:\*\* 1-0 \(100%\) · \*\*Vs lower seeds:\*\* 1-1 \(50%\)/);
  assert.ok(short.includes([
    '### What changed',
    '**Win rate:** up 66.7 points (1 set → 3 sets)',
    '**Games won:** up 62.5 points (2 games → 8 games)',
    '**Average finish:** top 50% → top 10% (1 event → 1 event)',
  ].join('\n')), short);
});

test('progress verbose shows a win-rate trend graph, short does not', async () => {
  const { sparkline } = await import('../src/embeds/shared.js');
  assert.equal(sparkline([0, 0.5, 1]), '▁▅█');
  assert.equal(sparkline([null, 1]), '·█');
  const until = 200 * DAY;
  const sets = [
    ...[1, 2, 3].map((days) => result(`now-${days}`, until - days * DAY, [10, 'Active', 1], [20, 'Rival', 2], true, [2, 0])),
    ...[40, 41].map((days) => result(`before-${days}`, until - days * DAY, [10, 'Active', 1], [20, 'Rival', 2], false, [0, 2])),
  ];
  const periods = periodsFor(crewPlayer, sets, [], until, 6);
  const verbose = embeds.progress(crewPlayer, periods, { verbose: true }).map(e => e.toJSON().description).join('\n');
  assert.match(verbose, /\*\*Trend, oldest → newest:\*\* [▁▂▃▄▅▆▇█·]+ win rate/);
  const short = embeds.progress(crewPlayer, periods.slice(0, 2)).map(e => e.toJSON().description).join('\n');
  assert.doesNotMatch(short, /Trend, oldest/);
});

test('progress trend graph reads oldest first with exact win rates', () => {
  const until = 200 * DAY;
  const win = (id, days) => result(id, until - days * DAY, [10, 'Active', 1], [20, 'Rival', 2], true, [2, 0]);
  const loss = (id, days) => result(id, until - days * DAY, [10, 'Active', 1], [20, 'Rival', 2], false, [0, 2]);
  const sets = [win('n1', 5), win('n2', 10), win('m1', 45), loss('m2', 50), loss('o1', 70), loss('o2', 75)];
  const periods = periodsFor(crewPlayer, sets, [], until, 6);
  const text = embeds.progress(crewPlayer, periods, { verbose: true }).map(e => e.toJSON().description).join('\n');
  // newest period 2-0, one back 1-1, one before that 0-2, older three empty
  assert.ok(text.includes('**Trend, oldest → newest:** ···▁▅█ win rate'), text);
});

test('progress describes streaks at the end of each period', () => {
  const until = 200 * DAY;
  const sets = [
    ...[1, 2, 3].map((days) => result(`now-${days}`, until - days * DAY, [10, 'Active', 1], [20, 'Rival', 2], true, [2, 0])),
    ...[40, 41].map((days) => result(`before-${days}`, until - days * DAY, [10, 'Active', 1], [20, 'Rival', 2], false, [0, 2])),
  ];
  const periods = periodsFor(crewPlayer, sets, [], until);
  for (const verbose of [false, true]) {
    const text = embeds.progress(crewPlayer, periods, { verbose }).map(e => e.toJSON().description).join('\n');
    assert.match(text, /\*\*Period-ending streak:\*\* W3/);
    assert.match(text, /### Previous 30 days[\s\S]*\*\*Period-ending streak:\*\* L2/);
    assert.doesNotMatch(text, /going in|Streaks:\*\* now/);
  }
});

test('progress comparisons use reported samples and omit unavailable scores and seeds', () => {
  const until = 200 * DAY;
  const sets = [
    result('now', until - DAY, [10, 'Active', null], [20, 'Rival', null], true, [null, null]),
    result('before', until - 40 * DAY, [10, 'Active', null], [20, 'Rival', null], false, [0, 2]),
  ];
  const events = [
    { event: { ...event, startAt: until - DAY, numEntrants: 40 }, placement: 4, seed: null },
    { event: { ...event, startAt: until - 2 * DAY, numEntrants: null }, placement: 2, seed: null },
    { event: { ...event, startAt: until - 40 * DAY, numEntrants: 40 }, placement: 20, seed: null },
  ];
  const text = embeds.progress(crewPlayer, periodsFor(crewPlayer, sets, events, until)).map(e => e.toJSON().description).join('\n');
  assert.match(text, /\*\*Placements:\*\* 2 events · average top 10% \(1 with bracket size\)/);
  assert.match(text, /\*\*Average finish:\*\* top 50% → top 10% \(1 event → 1 event\)/);
  assert.match(text, /\*\*Win rate:\*\* up 100\.0 points \(1 set → 1 set\)/);
  assert.doesNotMatch(text, /Games won|Close sets|Vs higher seeds|Vs lower seeds|NaN|undefined|null/);
});

test('progress verbose asks start.gg about six periods and still answers when characters fail', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 12: { userId: 12, playerId: 120, tag: 'Trend', slug: 'user/trend' } };
  let asked;
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    // the character lookup is down
    if (query.includes('selections')) return { ok: false, status: 500, json: async () => ({}) };
    let data = { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    if (!query.includes('events(query:')) {
      asked = variables.filters.updatedAfter;
      data = { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [node('trend-old', now - 100 * DAY, 120)] } } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
  let reply;
  await handleCommand({
    commandName: 'progress', user: { id: 'anyone' }, deferred: true,
    options: { getSubcommand: () => null, getString: () => '12', getBoolean: (name) => name === 'verbose' },
    deferReply: async () => {}, editReply: async r => { reply = r; },
  });
  assert.ok(Math.abs(asked - (now - 180 * DAY)) < 60, 'six 30 day periods back');
  const text = reply.embeds.map(e => e.toJSON().description).join('\n');
  assert.match(text, /Every 30 days, newest first/);
  assert.match(text, /sets 1-0 \(100%\)/);
  assert.doesNotMatch(text, /Game record by character/);
});

// the recap's first look: which of the players asked about finished a set that week
const playedThisWeek = (query, playerIds) => Object.fromEntries([...query.matchAll(/p(\d+): player/g)]
  .map(([, id]) => [`p${id}`, { sets: { nodes: playerIds.includes(Number(id)) ? [{ id: 1 }] : [] } }]));

test('recap includes spanning-week finishes, excludes inactive players, and persists completion', async () => {
  const until = Date.parse('2026-10-26T01:00:00Z') / 1000;
  const next = Date.parse('2026-11-02T02:00:00Z') / 1000;
  state.weeklyRecap = undefined;
  state.players = { 1: crewPlayer, 2: { userId: 2, playerId: 20, tag: 'Inactive' }, 3: { userId: 3, playerId: 30, tag: 'DQ-only' } };
  state.tournaments = { 1: { name: 'Next local', slug: 'tournament/next', startAt: until + 86400, entries: [{ userId: 1 }, { userId: 2 }] } };
  state.tournaments[2] = { name: 'Late Sunday', slug: 'tournament/late', startAt: next - 1800, entries: [{ userId: 1 }] };
  state.tournaments[3] = { name: 'Following week', slug: 'tournament/following', startAt: next, entries: [{ userId: 1 }] };
  const histories = [];
  mockApi(({ query, variables }) => {
    // the first look, one set id each. Inactive has none, so their history never gets read
    if (query.includes('nodes { id }')) return playedThisWeek(query, [10, 30]);
    if (query.includes('user(id:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [{ ...event, startAt: until - 8 * 86400, state: 'COMPLETED', userEntrant: { initialSeedNum: 9, standing: { placement: 5 } } }] } } };
    histories.push(variables.id);
    const set = node('weekly', until - 10, variables.id, variables.id === 30);
    // seed 17 over seed 2 is a major upset, the kind the recap calls notable
    set.slots[0].entrant.initialSeedNum = 17;
    return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [set] } } };
  });
  const sent = [];
  const channel = { send: async r => sent.push(r) };
  await postWeeklyRecap(channel, until);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  const text = sent.flatMap(r => r.embeds.map(e => (e.data ?? e).description)).join('\n');
  assert.match(text, /Active/);
  assert.match(text, /Next local/);
  assert.match(text, /Late Sunday/);
  assert.match(text, /Notable upset/);
  assert.match(text, /Best finish/);
  assert.doesNotMatch(text, /Inactive|DQ-only|Following week/);
  assert.deepEqual(histories.sort(), [10, 30]);
  state.weeklyRecap = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).weeklyRecap;
  mockApi(() => assert.fail('A completed recap must not be fetched again'));
  await postWeeklyRecap(channel, until + 60);
  assert.equal(sent.length, 1);
});

test('recap only calls major upset wins notable, and leaves out small ones and losses', async () => {
  const until = Date.parse('2026-10-26T01:00:00Z') / 1000;
  const weekly = (seed, won) => {
    const set = node(`weekly-${seed}-${won}`, until - 10, 10);
    set.slots[0].entrant.initialSeedNum = seed;
    set.slots[1].entrant.initialSeedNum = 2;
    // won means slot 0 takes it, otherwise slot 1 does
    set.winnerId = won ? 10 : 99;
    return set;
  };
  const textFor = async (sets) => {
    state.weeklyRecap = undefined;
    state.players = { 1: crewPlayer };
    state.tournaments = {};
    mockApi(({ query }) => {
      if (query.includes('nodes { id }')) return playedThisWeek(query, [10]);
      if (query.includes('user(id:')) return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [] } } };
      return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: sets } } };
    });
    const sent = [];
    await postWeeklyRecap({ send: async (r) => sent.push(r) }, until);
    return sent.flatMap((r) => r.embeds.map((e) => (e.data ?? e).description)).join('\n');
  };
  // seed 17 over seed 2 is major, seed 9 over seed 2 is short of it
  assert.match(await textFor([weekly(17, true)]), /Notable upset/);
  assert.doesNotMatch(await textFor([weekly(9, true)]), /Notable upset/);
  assert.doesNotMatch(await textFor([weekly(17, false)]), /Notable upset/);
});

test('recap retries unfinished message batches without reposting successful batches', async () => {
  const until = Date.parse('2026-10-19T01:00:00Z') / 1000;
  state.players = { 1: crewPlayer };
  state.tournaments = {};
  state.weeklyRecap = undefined;
  mockApi(({ query }) => query.includes('nodes { id }') ? playedThisWeek(query, [10]) : query.includes('user(id:')
    ? { user: { events: { pageInfo: { totalPages: 1 }, nodes: Array.from({ length: 30 }, (_, i) => ({
      ...event, slug: `tournament/long/event/${i}`, tournament: { name: `Local ${i} ${'x'.repeat(100)}` }, startAt: until - 100,
      state: 'COMPLETED', userEntrant: { standing: { placement: 5 } },
    })) } } }
    : { player: { sets: { pageInfo: { totalPages: 1 }, nodes: Array.from({ length: 30 }, (_, i) => ({
      ...node(`long-weekly-${i}`, until - 10), event: { ...event, slug: `tournament/long/event/${i}` },
    })) } } });
  let sends = 0;
  await assert.rejects(postWeeklyRecap({ send: async () => {
    if (++sends === 2) throw new Error('Discord unavailable');
  } }, until), /Discord unavailable/);
  assert.equal(state.weeklyRecap.sent, 1);
  assert.equal(state.weeklyRecap.done, false);
  assert.ok(state.weeklyRecap.batches.length > 1);
  const pending = state.weeklyRecap.batches.slice(state.weeklyRecap.sent);
  state.players = {};
  mockApi(() => assert.fail('Retry the saved recap instead of rebuilding different message batches'));
  const retried = [];
  await postWeeklyRecap({ send: async r => retried.push(r) }, until + 60);
  assert.ok(retried.length > 0);
  assert.deepEqual(retried.map(r => r.embeds), pending);
  assert.equal(state.weeklyRecap.done, true);
});

test('a week with no activity posts nothing', async () => {
  state.players = { 1: crewPlayer };
  state.weeklyRecap = undefined;
  mockApi(() => ({ player: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } }));
  await postWeeklyRecap({ send: async () => assert.fail('No empty recap') }, Date.parse('2026-10-19T01:00:00Z') / 1000);
  assert.equal(state.weeklyRecap.done, true);
});

test('tournament roll calls and placements disable mentions', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.messages = { rollcall: true, results: true };
  state.players = Object.fromEntries([1, 2, 3].map((userId) => [userId, {
    userId, playerId: userId * 10, tag: `Player ${userId}`, slug: `user/player-${userId}`,
  }]));
  const entries = [1, 2, 3].map((userId) => ({
    userId, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: userId, final: true,
  }));
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };

  await tracker.postRollCall({ name: 'Local', slug: 'tournament/local', startAt: now + 1800, entries }, channel);
  await tracker.postResults({ name: 'Local', slug: 'tournament/local', startAt: now - 14 * 3600, endAt: now - 13 * 3600, entries }, channel);

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map(({ allowedMentions }) => allowedMentions), [{ parse: [] }, { parse: [] }]);
  assert.equal(sent[0].embeds[0].data.title, 'Tournament roll call · Local');
  assert.equal(sent[1].embeds[0].data.title, "Tracked players' results from Local");
});

test('results list notable upset wins, including tracked vs tracked, and skip losses and small ones', () => {
  const players = {
    1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival' },
  };
  const entries = [
    { userId: 1, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 5, final: true },
    { userId: 2, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 9, final: true },
  ];
  const upset = (setId, winnerUserId, loserUserId, winnerSeed, loserSeed) => ({
    setId, winnerUserId, winnerName: players[winnerUserId].tag, winnerSeed,
    loserUserId, loserName: players[loserUserId].tag, loserSeed,
    winnerScore: 3, loserScore: 1, eventSlug: event.slug, round: 'Winners round 1', factor: 7,
  });
  // tracked vs tracked still shows as the winner's upset
  const [card] = embeds.results({ name: 'Local', slug: 'tournament/local', entries, notableUpsets: [upset('s1', 1, 2, 17, 2)] }, players);
  assert.match(card.data.description, /\*\*Notable upset:\*\*.*Active.*Rival.*seed 2.*3-1.*seed 17/);
  // nothing saved means no upset line at all
  const [plain] = embeds.results({ name: 'Local', slug: 'tournament/local', entries }, players);
  assert.doesNotMatch(plain.data.description, /Notable upset/);
});

test('the set check saves notable upset wins per tournament, and skips losses, small ones, doubles and DQs', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = {
    1: { ...crewPlayer, lastCheck: now - 120 },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastCheck: now - 120 },
  };
  state.tournaments = { 5: { id: 5, name: 'Local', slug: 'tournament/local', startAt: now - 3600, endAt: now + 3600, entries: [] } };
  state.messages = {};
  state.posted = [];
  state.dqs = [];
  const major = { ...node('major-win', now - 60), state: 3 };
  major.slots[0].entrant.initialSeedNum = 17;
  major.slots[1].entrant.initialSeedNum = 2;
  // slot 0 (Active) beats slot 1, factor 7
  const small = { ...node('small-win', now - 60), state: 3 };
  // Active seeded 2 loses to seed 17: major the other way, but a loss so it stays out
  const lost = { ...node('major-loss', now - 60), state: 3, winnerId: 99 };
  lost.slots[0].entrant.initialSeedNum = 2;
  lost.slots[1].entrant.initialSeedNum = 17;
  const doubles = { ...node('doubles-win', now - 60), state: 3 };
  doubles.slots[0].entrant.initialSeedNum = 17;
  doubles.slots[0].entrant.participants.push({ player: { id: 20 } });
  doubles.slots[0].playerIds = [10, 20];
  const dq = { ...node('dq-win', now - 60), state: 3 };
  dq.slots[0].entrant.initialSeedNum = 17;
  dq.slots[0].standing.stats.score.value = -1;
  for (const set of [major, small, lost, doubles, dq]) {
    set.event = { ...event, tournament: { name: 'Local', slug: 'tournament/local' } };
  }
  mockApi(() => ({ p10: { sets: { nodes: [major, small, lost, doubles, dq] } }, p20: { sets: { nodes: [] } } }));
  await tracker.postNewSets({ send: async () => ({}) });
  const saved = state.tournaments[5].notableUpsets ?? [];
  assert.deepEqual(saved.map((upset) => upset.setId), ['major-win']);
  assert.equal(saved[0].winnerUserId, 1);
  const [card] = embeds.results(
    { name: 'Local', slug: 'tournament/local', entries: [{ userId: 1, event: 'Singles', eventSlug: event.slug, placement: 1, final: true }], notableUpsets: saved },
    state.players,
  );
  assert.match(card.data.description, /Notable upset/);
});

test('roll calls link the streams on the tournament page, and post without them if that fails', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.messages = {};
  state.players = Object.fromEntries([1, 2, 3].map((userId) => [userId, {
    userId, playerId: userId * 10, tag: `Player ${userId}`, slug: `user/player-${userId}`,
  }]));
  const entries = [1, 2, 3].map((userId) => ({ userId, event: 'Singles', eventSlug: event.slug, entrants: 32 }));
  const tournament = () => ({ id: 4, name: 'Local', slug: 'tournament/local', startAt: now + 1800, entries });
  let asked = 0;
  mockApi(({ query }) => {
    asked++;
    assert.match(query, /t4: tournament\(id: 4\) \{ streams/);
    return { t4: { streams: [{ streamName: 'localstream', streamSource: 'TWITCH' }, { streamName: 'backup', streamSource: 'YOUTUBE' }] } };
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };
  await tracker.postRollCall(tournament(), channel);
  assert.equal(asked, 1);
  assert.match(sent[0].embeds[0].data.description, /\*\*Streams:\*\* \[twitch\.tv\/localstream\]\(https:\/\/twitch\.tv\/localstream\) · backup \(Youtube\)/);

  // start.gg failing leaves the streams out, not the roll call
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) });
  const logged = console.error;
  console.error = () => {};
  try {
    await tracker.postRollCall(tournament(), channel);
  } finally {
    console.error = logged;
  }
  assert.equal(sent.length, 2);
  assert.equal(sent[1].embeds[0].data.title, 'Tournament roll call · Local');
  assert.doesNotMatch(sent[1].embeds[0].data.description, /Streams/);

  // turned off, it doesn't ask
  state.messages = { rollcall: false };
  asked = 0;
  mockApi(() => { asked++; return {}; });
  await tracker.postRollCall(tournament(), channel);
  assert.equal(asked, 0);
  assert.equal(sent.length, 2);
  state.messages = {};
});

test('top 8s only come from tracked tournaments, every event with everyone in it', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer }, 2: { userId: 2, playerId: 20, tag: 'Second', slug: 'user/second' } };
  const doubles = { eventId: 502, event: 'Doubles', eventSlug: 'tournament/local/event/doubles', entrants: 12, started: true, placement: 4, final: true };
  const entries = [
    { userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 5, final: true },
    { userId: 2, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 9, final: true },
    { userId: 1, ...doubles },
  ];
  const finished = () => ({ name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600, entries });
  const standing = (placement, name, isFinal = true) => ({ placement, isFinal, entrant: { name } });
  const asked = [];
  mockApi(({ query }) => {
    asked.push(query);
    return {
      e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ'), standing(2, 'Runner'), standing(3, 'Third'), standing(4, 'Fourth'),
        standing(5, 'Active'), standing(5, 'Stranger'), standing(7, 'Seventh'), standing(7, 'Also_Seventh')] } },
      e502: { state: 'ACTIVE', standings: { nodes: [standing(1, 'Team A'), standing(2, 'Team B', false)] } },
    };
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };

  // the crew's tournament that nobody tracked gets placements and no top 8
  state.messages = {};
  const untracked = { ...finished(), tracked: undefined };
  await tracker.postResults(untracked, channel);
  assert.equal(asked.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(untracked.resultsPosted, true);
  assert.equal(untracked.top8Posted, true);

  // and switched off server-wide or for the tournament, neither does a tracked one
  for (const [messages, top8] of [[{ top8: false }, true], [{}, false]]) {
    state.messages = messages;
    sent.length = 0;
    const quiet = { ...finished(), tracked: { ...tracked, top8 } };
    await tracker.postResults(quiet, channel);
    assert.equal(asked.length, 0);
    assert.equal(sent.length, 1);
    assert.equal(quiet.top8Posted, true);
  }

  state.messages = {};
  sent.length = 0;
  const posted = finished();
  await tracker.postResults(posted, channel);
  // one lookup for both events, and the singles event only once even with two of the crew in it
  assert.equal(asked.length, 1);
  assert.equal(asked[0].match(/e501: event/g).length, 1);
  assert.equal(sent.length, 2);
  const cards = sent[1].embeds.map((card) => card.toJSON());
  assert.deepEqual(cards.map((card) => card.author.name), ['Top 8 · Singles · 32 entrants', 'Top 8 · Doubles · 12 entrants']);
  assert.deepEqual(cards.map((card) => card.title), ['Top 8 from Local', 'Top 8 from Local']);
  assert.equal(cards[0].url, 'https://www.start.gg/tournament/local/event/singles/standings');
  assert.equal(cards[0].description, ['🥇 1st Champ', '🥈 2nd Runner', '🥉 3rd Third', '4th Fourth', '5th Active', '5th Stranger', '7th Seventh', '7th Also\\_Seventh'].join('\n'));
  assert.match(cards[1].description, /^🥇 1st Team A\n2nd Team B \(projected\)\n-# The bracket wasn't finished/);
  assert.deepEqual(sent[1].allowedMentions, { parse: [] });
  assert.equal(posted.resultsPosted, true);

  // start.gg failing posts nothing, so the next check sends both instead of repeating the placements
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) });
  sent.length = 0;
  const failed = finished();
  await assert.rejects(tracker.postResults(failed, channel), /start\.gg: down/);
  assert.equal(sent.length, 0);
  assert.equal(failed.resultsPosted, undefined);

  // 12 hours of that and the placements stop waiting on it
  const stuck = { ...finished(), startAt: now - 27 * 3600, endAt: now - 26 * 3600 };
  await tracker.postResults(stuck, channel);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results · /);
  assert.equal(stuck.resultsPosted, true);

  // discord turning down the top 8 doesn't put the placements up a second time
  mockApi(() => ({ e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ')] } } }));
  const picky = { send: async (payload) => {
    if (payload.embeds.some((card) => card.toJSON().author.name.startsWith('Top 8'))) throw new Error('Missing Permissions');
    sent.push(payload);
  } };
  sent.length = 0;
  const rejected = finished();
  await tracker.postResults(rejected, picky);
  assert.equal(sent.length, 1);
  assert.equal(rejected.resultsPosted, true);
});

test('results and the top 8 go out together as soon as the bracket is finished', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer } };
  const entry = (done) => ({ userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32,
    started: true, done, placement: 5, final: true });
  const standing = (placement, name) => ({ placement, isFinal: true, entrant: { name } });
  const asked = [];
  mockApi(({ query }) => {
    asked.push(query);
    return { e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ'), standing(2, 'Runner')] } } };
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };

  // bracket done but the tournament hasn't ended: results and top 8 still go together
  state.messages = { top8: true };
  const live = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 2 * 3600, endAt: now + 2 * 3600, entries: [entry(true)] };
  await tracker.postResults(live, channel);
  assert.equal(sent.length, 2);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.match(sent[1].embeds[0].toJSON().author.name, /^Top 8/);
  assert.equal(live.resultsPosted, true);
  assert.equal(live.top8Posted, true);

  // the next check doesn't post it again
  await tracker.postResults(live, channel);
  assert.equal(sent.length, 2);

  // once the old placements deadline passes, neither goes out again
  sent.length = 0;
  live.startAt = now - 14 * 3600;
  live.endAt = now - 13 * 3600;
  await tracker.postResults(live, channel);
  assert.equal(sent.length, 0);
  assert.equal(live.resultsPosted, true);

  // top 8 switched off still posts results on the same bracket-finished trigger
  state.messages = { top8: false };
  asked.length = 0;
  sent.length = 0;
  const quiet = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 2 * 3600, endAt: now + 2 * 3600, entries: [entry(true)] };
  await tracker.postResults(quiet, channel);
  assert.equal(asked.length, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.equal(quiet.top8Posted, true);
  assert.equal(quiet.resultsPosted, true);

  // a bracket still running posts nothing and asks nothing
  state.messages = { top8: true };
  asked.length = 0;
  const running = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 2 * 3600, endAt: now + 2 * 3600, entries: [entry(false)] };
  await tracker.postResults(running, channel);
  assert.equal(asked.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(running.top8Posted, undefined);

  // finished entries but an unfinished event on start.gg waits too
  mockApi(() => ({ e501: { state: 'ACTIVE', standings: { nodes: [standing(1, 'Champ')] } } }));
  const undecided = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 2 * 3600, endAt: now + 2 * 3600, entries: [entry(true)] };
  await tracker.postResults(undecided, channel);
  assert.equal(sent.length, 1);
  assert.equal(undecided.top8Posted, undefined);
});

test('a top 8 that fails to send is retried by the fail-safe instead of being lost', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer } };
  const entries = [{ userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32,
    started: true, done: true, placement: 5, final: true }];
  const standing = (placement, name) => ({ placement, isFinal: true, entrant: { name } });
  mockApi(() => ({ e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ'), standing(2, 'Runner')] } } }));
  state.messages = { top8: true };
  const sent = [];
  let rejectTopEight = true;
  const channel = { send: async (payload) => {
    if (rejectTopEight && payload.embeds.some((card) => card.toJSON().author.name.startsWith('Top 8'))) throw new Error('Missing Permissions');
    sent.push(payload);
    return { id: `m${sent.length}`, channelId: 'c1' };
  } };

  // placements due but the top 8 fails on discord: placements still go out, marked for retry
  const tournament = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600, entries };
  await tracker.postResults(tournament, channel);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.equal(tournament.resultsPosted, true);
  assert.equal(tournament.top8Posted, undefined);
  assert.equal(tournament.top8Failed, true);

  // the fail-safe sends the missing top 8 once discord accepts it, without reposting placements
  rejectTopEight = false;
  sent.length = 0;
  assert.equal(await tracker.verifyTopEight(tournament, channel), true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Top 8/);
  assert.equal(tournament.top8Posted, true);
  assert.equal(tournament.top8Failed, undefined);

  // and stays quiet afterwards
  mockApi(() => { throw new Error('already verified'); });
  sent.length = 0;
  assert.equal(await tracker.verifyTopEight(tournament, channel), true);
  assert.equal(sent.length, 0);

  // switched off it waits instead of sending, keeping the marker
  const muted = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries, resultsPosted: true, top8Failed: true, top8FailedAt: now };
  state.messages = { top8: false };
  sent.length = 0;
  assert.equal(await tracker.verifyTopEight(muted, channel), false);
  assert.equal(sent.length, 0);
  assert.equal(muted.top8Failed, true);

  // a start.gg failure waits an hour before trying again. the one lookup is 3 requests, since a 5xx gets 2 retries
  state.messages = { top8: true };
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return { ok: false, status: 500, json: async () => ({ message: 'down' }) };
  };
  const flaky = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries, resultsPosted: true, top8Failed: true, top8FailedAt: now };
  assert.equal(await tracker.verifyTopEight(flaky, channel), false);
  assert.equal(flaky.top8Failed, true);
  assert.equal(await tracker.verifyTopEight(flaky, channel), false);
  assert.equal(fetches, 3);

  // after 3 days it gives up without sending
  const stale = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries, resultsPosted: true, top8Failed: true, top8FailedAt: now - 4 * 86400 };
  mockApi(() => { throw new Error('should have given up'); });
  sent.length = 0;
  assert.equal(await tracker.verifyTopEight(stale, channel), false);
  assert.equal(sent.length, 0);
  assert.equal(stale.top8Failed, undefined);

  // tournaments from before the marker existed never get a second top 8
  const legacy = { name: 'Local', slug: 'tournament/local', startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries, resultsPosted: true };
  mockApi(() => { throw new Error('legacy must not be fetched'); });
  assert.equal(await tracker.verifyTopEight(legacy, channel), true);
  assert.equal(sent.length, 0);
  assert.equal(legacy.top8Posted, undefined);
});

test('placements and the top 8 go out at 12 hours even when the TO is still reporting', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer } };
  state.messages = { top8: true };
  const entries = [{ userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32,
    started: true, done: false, placement: 5, final: false }];
  const standing = (placement, name, isFinal) => ({ placement, isFinal, entrant: { name } });
  mockApi(() => ({ e501: { state: 'ACTIVE', standings: { nodes: [standing(1, 'Champ', true), standing(5, 'Active', false)] } } }));
  const sent = [];
  const channel = { send: async (payload) => { sent.push(payload); return { id: `m${sent.length}`, channelId: 'c1' }; } };

  // 13 hours after the end with the bracket unfinished: no waiting for 24 hours
  const tournament = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 14 * 3600, endAt: now - 13 * 3600, entries };
  await tracker.postResults(tournament, channel);
  assert.equal(sent.length, 2);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.match(sent[0].embeds[0].toJSON().description, /\(projected\)/);
  assert.match(sent[1].embeds[0].toJSON().author.name, /^Top 8/);
  assert.match(sent[1].embeds[0].toJSON().description, /\(projected\)/);
  assert.equal(tournament.resultsPosted, true);
  assert.equal(tournament.top8Posted, true);
  assert.ok(tournament.projected);
});

test('a top 8 with nothing reported at 12 hours goes out as a new message once the event completes', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer } };
  state.messages = { top8: true };
  const entries = [{ userId: 1, eventId: 501, event: 'Singles', eventSlug: event.slug, entrants: 32,
    started: true, done: false, placement: 5, final: true }];
  // start.gg keeps erroring on the top 8, so placements go out without it
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) });
  const sent = [];
  const channel = { send: async (payload) => { sent.push(payload); return { id: `m${sent.length}`, channelId: 'c1' }; } };
  const tournament = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 27 * 3600, endAt: now - 26 * 3600, entries };
  await tracker.postResults(tournament, channel);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Results/);
  assert.equal(tournament.resultsPosted, true);
  assert.equal(tournament.top8Posted, undefined);
  assert.ok(tournament.projected);

  // the TO completes the event later: the final top 8 goes out on its own
  const standing = (placement, name) => ({ placement, isFinal: true, entrant: { name } });
  mockApi(() => ({ e501: { state: 'COMPLETED', standings: { nodes: [standing(1, 'Champ'), standing(5, 'Active')] } } }));
  tournament.projected.checkedAt = now - 3601;
  sent.length = 0;
  await tracker.correctPlacements(tournament, channel);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().author.name, /^Top 8/);
  assert.doesNotMatch(sent[0].embeds[0].toJSON().description, /projected/);
  assert.equal(tournament.top8Posted, true);
  assert.equal(tournament.projected, undefined);
});

test('a tracked tournament\'s top 8 covers every event, and waits for one that hasn\'t started until the end time', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = {};
  state.messages = {};
  const standing = (placement, name) => ({ placement, isFinal: true, entrant: { name } });
  const asked = [];
  mockApi(({ query }) => {
    asked.push(query);
    return Object.fromEntries([...query.matchAll(/\be(\d+): event/g)].map(([, id]) => [`e${id}`, { state: 'COMPLETED', standings: { nodes: [standing(1, `Champ ${id}`)] } }]));
  });
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };
  // nobody from the crew entered, and doubles runs after singles
  const events = (doubles) => [
    { id: 601, name: 'Singles', slug: 'tournament/local/event/singles', state: 'COMPLETED', numEntrants: 40 },
    { id: 602, name: 'Doubles', slug: 'tournament/local/event/doubles', state: doubles, numEntrants: 12 },
  ];
  const tournament = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 4 * 3600, endAt: now + 3600, entries: [], events: events('CREATED') };
  await tracker.postResults(tournament, channel);
  assert.equal(asked.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(tournament.doneAt, undefined);

  tournament.events = events('COMPLETED');
  await tracker.postResults(tournament, channel);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].embeds.map((card) => card.toJSON().author.name), ['Top 8 · Singles · 40 entrants', 'Top 8 · Doubles · 12 entrants']);
  assert.ok(tournament.doneAt);
  assert.equal(tournament.top8Posted, true);

  // one that never started, like a raffle, stops holding it back once the end time passes
  sent.length = 0;
  const raffle = { name: 'Local', slug: 'tournament/local', tracked, startAt: now - 4 * 3600, endAt: now - 60, entries: [], events: events('CREATED') };
  await tracker.postResults(raffle, channel);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].embeds.map((card) => card.toJSON().author.name), ['Top 8 · Singles · 40 entrants']);
});

test('every message gets a picture, the bot avatar on its first card when nothing in it has one', () => {
  const avatar = 'https://cdn.discordapp.com/avatars/bot/avatar.png';
  const plain = (n) => new EmbedBuilder().setTitle(`Card ${n}`).setDescription('text');
  // before discord says who the bot is there's nothing to fall back on
  assert.equal(embeds.messages([plain(0)])[0][0].data.thumbnail, undefined);

  embeds.setFallbackImage(avatar);
  try {
    // one per message, not one per card
    const batches = embeds.messages(Array.from({ length: 12 }, (_, i) => plain(i)));
    assert.deepEqual(batches.map((batch) => batch.map((card) => card.data.thumbnail?.url ?? null)),
      [[avatar, ...Array(9).fill(null)], [avatar, null]]);
    // a picture anywhere in the message is enough
    const [[first, pictured]] = embeds.messages([plain(1), plain(2).setImage('https://example.com/banner.png')]);
    assert.equal(first.data.thumbnail, undefined);
    assert.equal(pictured.data.image.url, 'https://example.com/banner.png');
    assert.equal(embeds.withImage([plain(3)])[0].data.thumbnail.url, avatar);

    // a set card at a tournament with no picture shows the tracked player's, bigger than the bot's
    const players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active', image: 'https://images.start.gg/active.png' } };
    const parsed = result('no-art', 100, [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 1]);
    const set = { ...parsed, event: { ...parsed.event, name: 'Singles' }, sides: parsed.sides.map((side) => ({ ...side, characters: [] })) };
    assert.equal(embeds.setResult(set, players).data.thumbnail.url, 'https://images.start.gg/active.png');
  } finally {
    embeds.setFallbackImage(null);
  }
});

test('set result cards link the VOD when the TO added one, and skip it otherwise', () => {
  const players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' } };
  const sides = [[10, 'Active', 9], [99, 'Opponent', 2]];
  const named = (set) => ({ ...set, event: { ...set.event, name: 'Singles' }, sides: set.sides.map((side) => ({ ...side, characters: [] })) });
  const withVod = { ...named(result('v1', 100, sides[0], sides[1], true, [2, 1])), vod: 'https://youtube.example/vod' };
  const fields = embeds.setResult(withVod, players).data.fields ?? [];
  assert.match(fields.find((field) => field.name === 'VOD').value, /\[Watch the VOD\]\(https:\/\/youtube\.example\/vod\)/);
  const plain = embeds.setResult(named(result('v2', 100, sides[0], sides[1], true, [2, 1])), players);
  assert.ok(!(plain.data.fields ?? []).some((field) => field.name === 'VOD'));
});

test('set result cards put the winner on the left with a W and the loser on the right with an L', async () => {
  const { colors } = await import('../src/embeds/shared.js');
  const players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' } };
  const card = (id, me, them, won, score) => {
    const set = result(id, 100, me, them, won, score);
    return embeds.setResult({ ...set, event: { ...set.event, name: 'Singles' }, sides: set.sides.map((side, i) => ({ ...side, characters: [i ? 'Wario' : 'Pac-Man'] })) }, players).data;
  };

  const win = card('w', [10, 'Active', 2], [99, 'Opponent', 3], true, [3, 0]);
  assert.equal(win.title, 'Set result · W · Active 3-0 Opponent · L');
  assert.equal(win.color, colors.win);

  // a tracked player losing to someone untracked: the winner still goes first, the card stays theirs
  const loss = card('l', [10, 'Active', 2], [99, 'Opponent', 3], false, [1, 3]);
  assert.equal(loss.title, 'Set result · W · Opponent 3-1 Active · L');
  assert.equal(loss.color, colors.win);
  assert.equal(loss.author, undefined);
  assert.equal(loss.fields.find((field) => field.name === 'Characters').value, 'Opponent: Wario\nActive: Pac-Man');
  assert.doesNotMatch(loss.description, /Major upset/);

  // nobody tracked, from a tracked tournament, and two tracked players fighting are green too
  const stranger = card('s', [98, 'Visitor', 1], [99, 'Guest', 2], true, [2, 1]);
  assert.equal(stranger.color, colors.win);
  const both = { ...players, 2: { userId: 2, playerId: 99, tag: 'Opponent', slug: 'user/opponent' } };
  const clashSet = result('c', 100, [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 0]);
  const clash = embeds.setResult({ ...clashSet, event: { ...clashSet.event, name: 'Singles' }, sides: clashSet.sides.map((side) => ({ ...side, characters: [] })) }, both).data;
  assert.equal(clash.color, colors.win);

  // seed 17 over seed 2 is a major upset whoever won it. seed 9 over seed 2 is short of it
  const upset = card('u', [10, 'Active', 2], [99, 'Opponent', 17], false, [1, 2]);
  assert.equal(upset.title, 'Set result · W · Opponent 2-1 Active · L');
  assert.match(upset.description, /^\*\*Major upset\*\* · seed 17 beat seed 2\n\*\*Winners round 1\*\*/);
  assert.doesNotMatch(card('n', [10, 'Active', 2], [99, 'Opponent', 9], false, [1, 2]).description, /Major upset/);
  // DQ wins aren't upsets
  assert.doesNotMatch(card('d', [10, 'Active', 2], [99, 'Opponent', 17], false, [-1, 0]).description, /Major upset/);
});

test('set_colors paints set result cards green for a win, red for a loss, gold for crew vs crew', async () => {
  const { colors } = await import('../src/embeds/shared.js');
  const players = { 1: { userId: 1, playerId: 10, tag: 'Active', slug: 'user/active' } };
  const card = (id, me, them, won, score, list = players) => {
    const set = result(id, 100, me, them, won, score);
    return embeds.setResult({ ...set, event: { ...set.event, name: 'Singles' }, sides: set.sides.map((side) => ({ ...side, characters: [] })) }, list, { setColors: true }).data;
  };

  assert.equal(card('w', [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 1]).color, colors.win);
  assert.equal(card('l', [10, 'Active', 2], [99, 'Opponent', 3], false, [1, 3]).color, colors.loss);
  // nobody tracked, from a tracked tournament
  assert.equal(card('s', [98, 'Visitor', 1], [99, 'Guest', 2], true, [2, 1]).color, colors.brand);
  const both = { ...players, 2: { userId: 2, playerId: 99, tag: 'Opponent', slug: 'user/opponent' } };
  assert.equal(card('c', [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 0], both).color, colors.clash);
  // a corrected card keeps its colors
  const set = result('w', 100, [10, 'Active', 2], [99, 'Opponent', 3], true, [2, 1]);
  const corrected = embeds.correctedResult({ ...set, event: { ...set.event, name: 'Singles' }, sides: set.sides.map((side) => ({ ...side, characters: [] })) }, players, { setColors: true }).data;
  assert.equal(corrected.color, colors.win);
  assert.match(corrected.description, /Corrected by TO/);
});

test('muted automatic messages are consumed without posting or replaying them later', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120, discordId: 'crew-discord' } };
  state.callPings = ['crew-discord'];
  state.messages = { sets: false, streams: false, calls: false, rollcall: false, results: false, registration: false };
  state.posted = [];
  state.dqs = [];
  state.streamed = [];
  state.called = [];
  state.tournaments = {};
  let current = { ...node('muted-set', now), state: 3 };
  mockApi(() => ({ p10: { sets: { nodes: [current] } } }));
  await tracker.postNewSets(channel);
  assert.ok(state.posted.includes('muted-set'));
  state.messages.sets = true;
  await tracker.postNewSets(channel);
  assert.equal(sent.length, 0);
  current = { ...node('new-set', now), state: 3 };
  await tracker.postNewSets(channel);
  assert.equal(sent.length, 1);

  current = { ...node('muted-stream', now), state: 2, stream: { streamName: 'example', streamSource: 'TWITCH' } };
  await tracker.postStreamAlerts(channel, 0);
  assert.ok(state.streamed.includes('muted-stream'));
  state.messages.streams = true;
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 1);

  current = { ...node('muted-call', now), state: 6, updatedAt: now };
  await tracker.postMatchCalls(channel);
  assert.ok(state.called.includes('muted-call'));
  state.messages.calls = true;
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 1);

  const upcoming = { startAt: now + 1800, entries: [1, 2, 3].map(userId => ({ userId })) };
  await tracker.postRollCall(upcoming, channel);
  assert.equal(upcoming.rollCallPosted, true);
  const finished = { startAt: now - 27 * 3600, endAt: now - 26 * 3600, entries: [{ started: true }] };
  await tracker.postResults(finished, channel);
  assert.equal(finished.resultsPosted, true);

  state.tournaments = { 1: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, entries: [], tracked, reminder: { next: 0 } } };
  mockApi(() => ({ tournament: { id: 1, startAt: now + 86400, endAt: now + 2 * 86400,
    registrationClosesAt: now + 3600, isRegistrationOpen: true, events: [] } }));
  await tracker.postRegReminders(channel);
  assert.equal(state.tournaments[1].reminder.next, 4);
  assert.equal(sent.length, 1);
});

// answers only for the players a query names, like start.gg does, and keeps who got asked about
function mockSetCheck(nodesFor) {
  const asked = [];
  mockApi(({ query }) => {
    const aliases = [...query.matchAll(/(p\d+): player\(/g)].map(([, alias]) => alias);
    asked.push(aliases);
    return Object.fromEntries(aliases.map(alias => [alias, { sets: { nodes: nodesFor[alias] ?? [] } }]));
  });
  return asked;
}

const setsCommand = (values) => {
  const interaction = {
    // Manage Server counts as a TO while the server has no TO role, and only a TO can change someone else's posts
    commandName: 'track', user: { id: 'someone' }, memberPermissions: { has: () => true },
    options: { getSubcommand: () => 'posts', getString: name => values[name] ?? null },
    reply: async r => { interaction.replied = r; },
  };
  return handleCommand(interaction).then(() => interaction.replied);
};

test('set results off keeps a player out of the set check and /track posts sets:on doesn\'t dump the backlog', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, lastCheck: now - 120, setResults: false },
    // saved before set results started off, so no field still means on
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastCheck: now - 120 },
  };
  state.posted = [];
  state.dqs = [];
  const nodes = { p10: [{ ...node('while-off', now - 60), state: 3 }], p20: [{ ...node('shown-set', now - 60, 20), state: 3 }] };
  const asked = mockSetCheck(nodes);

  await tracker.postNewSets(channel);
  assert.deepEqual(asked, [['p20']]);
  assert.ok(sent.every(({ embeds: [card] }) => card.data.author === undefined));
  assert.match(sent[0].embeds[0].data.title, /^Set result · /);
  // the set's over, so no head to head button
  assert.equal(sent[0].components, undefined);

  assert.equal((await setsCommand({ player: '1', sets: 'on' })).content, 'Set results on for Active.');
  assert.ok(state.players[1].setResultsOnAt >= now);

  // the set from while they were off is in the fetch window now, but it stays out
  await tracker.postNewSets(channel);
  assert.deepEqual(asked.at(-1), ['p10', 'p20']);
  assert.equal(sent.length, 1);
  assert.ok(state.posted.includes('while-off'));

  nodes.p10.push({ ...node('after-on', state.players[1].setResultsOnAt), state: 3 });
  await tracker.postNewSets(channel);
  assert.ok(sent.every(({ embeds: [card] }) => card.data.author === undefined));
  assert.deepEqual(sent.map(({ embeds: [card] }) => card.data.title.slice(0, 12)), ['Set result ·', 'Set result ·']);
});

test('the set check sends nothing to start.gg when nobody has set results on', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120, setResults: false } };
  globalThis.fetch = async () => assert.fail('nobody to ask about');
  await tracker.postNewSets({ send: async () => assert.fail('nothing to post') });
  // still counts as a check, so a restart doesn't think the bot was down
  assert.equal(tracker.health.setError, null);
  assert.ok(state.players[1].lastCheck >= now);
});

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

test('/track posts sets:on only marks when results came on for players switching from off', async () => {
  state.players = {
    1: { ...crewPlayer, setResults: false },
    2: { userId: 2, playerId: 20, tag: 'On', slug: 'user/on', setResults: true, setResultsOnAt: 5 },
    3: { userId: 3, playerId: 30, tag: 'Old', slug: 'user/old' },
  };
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await setsCommand({ player: 'all', sets: 'on' })).content, 'Set results on for everyone.');
  assert.ok(state.players[1].setResultsOnAt >= now);
  // already on, so sets they finished before this still count
  assert.equal(state.players[2].setResultsOnAt, 5);
  assert.equal(state.players[3].setResultsOnAt, undefined);
  assert.ok(Object.values(state.players).every(player => player.setResults === true));

  // everyone at once asks first, confirm.test.js presses the buttons
  assert.match((await setsCommand({ player: 'all', sets: 'off' })).content, /^Turn set results off for all 3 tracked players\?/);
  assert.equal(state.players[1].setResults, true);
  assert.equal((await setsCommand({ player: '1', sets: 'off' })).content, 'Set results off for Active.');
  assert.equal(state.players[1].setResults, false);
});

test('re-enabling between polls skips events that became due before re-enabling', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = { calls: true, enabledAt: Object.fromEntries(['sets', 'streams', 'calls', 'rollcall', 'results', 'registration'].map(type => [type, now])) };
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120, discordId: 'crew-discord' } };
  state.callPings = ['crew-discord'];
  state.posted = [];
  state.dqs = [];
  state.streamed = [];
  state.called = [];
  state.tournaments = {};
  let current = { ...node('unpolled-muted-set', now - 60), state: 3, updatedAt: now - 60 };
  mockApi(() => ({ p10: { sets: { nodes: [current] } } }));
  await tracker.postNewSets(channel);
  current = { ...current, id: 'unpolled-muted-stream', state: 2, stream: { streamName: 'example', streamSource: 'TWITCH' } };
  await tracker.postStreamAlerts(channel, 0);
  current = { ...current, id: 'unpolled-muted-call', state: 6, updatedAt: now - 60 };
  await tracker.postMatchCalls(channel);
  assert.ok(state.called.includes('unpolled-muted-call'));
  for (const userId of [2, 3]) state.players[userId] = { userId, playerId: userId * 10, tag: `Player ${userId}`, slug: `user/player${userId}` };
  await tracker.postRollCall({ name: 'Local', slug: 'tournament/local', startAt: now + 1800,
    entries: [1, 2, 3].map(userId => ({ userId, event: 'Singles', eventSlug: event.slug, entrants: 32 })) }, channel);
  await tracker.postResults({ name: 'Local', slug: 'tournament/local', startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries: [{ userId: 1, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 5, final: true }] }, channel);
  state.tournaments = { 1: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, entries: [], tracked, reminder: { next: 0 } } };
  mockApi(() => ({ tournament: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 2 * 86400,
    registrationClosesAt: now + 3600, isRegistrationOpen: true, events: [] } }));
  await tracker.postRegReminders(channel);
  assert.equal(sent.length, 0);
});

test('a set only waiting at the front of a stream queue still posts after streams come back on', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  state.messages = { enabledAt: { streams: now } };
  state.players = { 1: { ...crewPlayer, lastCheck: now } };
  state.streamed = [];
  state.tournaments = { 1: { id: 1, name: 'Local', startAt: now - 3600, endAt: now + 3600, entries: [{ userId: 1 }] } };
  // queued an hour ago, never called
  const queued = { ...node('queued', null), state: 1, updatedAt: now - 3600, stream: null };
  mockApi(({ query }) => (query.includes('streamQueue')
    ? { tournament: { streamQueue: [{ stream: { streamName: 'local', streamSource: 'TWITCH' }, sets: [queued] }] } }
    : { p10: { sets: { nodes: [] } } }));
  await tracker.postStreamAlerts({ send: async payload => sent.push(payload) }, 0);
  assert.equal(sent.length, 1);
});

test('a stream alert links the queue the set is in, not a stream it was moved off', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  state.messages = {};
  state.players = { 1: { ...crewPlayer, lastCheck: now } };
  state.streamed = [];
  state.tournaments = { 1: { id: 1, name: 'Local', startAt: now - 3600, endAt: now + 3600, entries: [{ userId: 1 }] } };
  const moved = { ...node('moved', null), state: 2, updatedAt: now, stream: { streamName: 'winters_hq', streamSource: 'TWITCH' } };
  mockApi(({ query }) => (query.includes('streamQueue')
    ? { tournament: { streamQueue: [{ stream: { streamName: '716esports', streamSource: 'TWITCH' }, sets: [moved] }] } }
    : { p10: { sets: { nodes: [] } } }));
  await tracker.postStreamAlerts({ send: async payload => sent.push(payload) }, 0);
  assert.equal(sent.length, 1);
  const card = JSON.stringify(sent[0].embeds);
  assert.ok(card.includes('https://twitch.tv/716esports'));
  assert.ok(!card.includes('winters_hq'));
});

test('a set put on stream by mistake and taken back before the confirm look is not posted', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = { 1: { ...crewPlayer, lastCheck: now } };
  state.streamed = [];
  state.tournaments = {};
  const on = streamName => ({ ...node('flub', null), state: 2, updatedAt: now, stream: { streamName, streamSource: 'TWITCH' } });
  // each check asks twice: what's on stream, then again after the wait
  let answers = [[on('local')], []];
  mockApi(() => ({ p10: { sets: { nodes: answers.shift() ?? [] } } }));
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 0);
  assert.ok(!state.streamed.includes('flub'));

  // moved to another stream during the wait, so it waits for it to settle
  answers = [[on('local')], [on('other')]];
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 0);

  // put back on stream later and left there
  answers = [[on('other')], [on('other')]];
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 1);
  assert.ok(JSON.stringify(sent[0].embeds).includes('twitch.tv/other'));
  assert.ok(state.streamed.includes('flub'));

  // nothing new, so no second look
  let asked = 0;
  mockApi(() => (asked++, { p10: { sets: { nodes: [on('other')] } } }));
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(asked, 1);
});

test('stream alerts ping only whoever is playing with /notify streams on', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, discordId: 'crew-discord', lastCheck: now },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord', lastCheck: now },
  };
  state.links = {};
  state.streamed = [];
  state.tournaments = {};
  state.streamPings = [];
  let current;
  mockApi(() => ({ p10: { sets: { nodes: [current] } } }));
  const streamed = id => ({ ...node(id, null), state: 2, updatedAt: now, stream: { streamName: 'local', streamSource: 'TWITCH' } });

  const replies = [];
  const fromInteraction = (id, ping) => ({ user: { id }, options: { getString: (name) => (name === 'streams' ? ping : null), getUser: () => null }, reply: async (result) => replies.push(result) });
  const { notify } = await import('../src/commands/settings.js');
  // nobody to look up, so it stays off
  await notify(fromInteraction('fan', 'on'));
  assert.match(replies.at(-1).content, /Stream alert pings need your start\.gg/);
  assert.deepEqual(state.streamPings, []);
  // tracked with this discord on start.gg counts
  await notify(fromInteraction('crew-discord', 'on'));
  await notify(fromInteraction('crew-discord', 'on'));
  await notify(fromInteraction('rival-discord', 'on'));
  await notify(fromInteraction('rival-discord', 'off'));
  assert.deepEqual(state.streamPings, ['crew-discord']);

  // a player who opts in while the same set is still on stream gets the alert too
  state.streamPings = [];
  current = streamed('mid-tournament-opt-in');
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent[0].content, undefined);
  state.streamPings = ['crew-discord'];
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent[1].content, '<@crew-discord> on stream');

  current = streamed('one-fan');
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].content, '<@crew-discord> on stream');
  assert.deepEqual(sent[2].allowedMentions, { users: ['crew-discord'] });
  assert.equal(sent[2].embeds.length, 1);
  // against someone only known from the set, by player id, answered just to whoever presses it
  const [button] = sent[2].components[0].toJSON().components;
  assert.deepEqual([button.label, button.custom_id], ['Head to head', 'private:h2h:active:#99::::']);

  // someone with pings on who isn't playing gets no ping, but the card still posts
  state.streamPings = ['rival-discord'];
  current = streamed('not-playing');
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent[3].content, undefined);
  assert.deepEqual(sent[3].allowedMentions, { users: [] });
  assert.equal(sent[3].components.length, 1);

  // nobody opted in still posts the card, pinging no one
  state.streamPings = [];
  current = streamed('no-fans');
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent[4].content, undefined);
  assert.deepEqual(sent[4].allowedMentions, { users: [] });
  assert.equal(sent[4].components.length, 1);
  state.streamPings = [];
});

test('opting into match calls mid-tournament catches a call already posted for the opponent', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => { sent.push(payload); return { id: `m${sent.length}`, channelId: 'c1' }; } };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, discordId: 'crew-discord' },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
  };
  state.links = {};
  state.callPings = ['rival-discord'];
  state.called = [];
  state.callPosts = [];
  const called = {
    ...node('701', null), state: 6, updatedAt: now - 60,
    slots: [[1, 10, 'Active'], [2, 20, 'Rival']].map(([entrant, player, name]) => ({
      entrant: { id: entrant, name, initialSeedNum: entrant, participants: [{ player: { id: player } }] }, standing: null,
    })),
  };
  mockApi(() => ({ p10: { sets: { nodes: [called] } }, p20: { sets: { nodes: [called] } } }));

  await tracker.postMatchCalls(channel);
  assert.equal(sent[0].content, `<@rival-discord> You're up`);

  state.callPings.push('crew-discord');
  await tracker.postMatchCalls(channel);
  assert.equal(sent[1].content, `<@crew-discord> You're up`);
  assert.deepEqual(sent[1].allowedMentions, { users: ['crew-discord'] });
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

test('stream alerts start off, keeping a new player out of the stream check and their tournament\'s queues', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: tracker.newTracked(crewPlayer),
    // saved before stream alerts started off, so no field still means on
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival' },
  };
  state.streamed = [];
  // only the new player is in it, so its stream queue isn't worth a request
  state.tournaments = { 1: { id: 1, name: 'Local', startAt: now - 3600, endAt: now + 3600, entries: [{ userId: 1 }] } };
  const live = (id, playerId) => ({ ...node(id, null, playerId), state: 2, updatedAt: now - 60, stream: { streamName: 'local', streamSource: 'TWITCH' } });
  const nodes = { p10: [live('new-on-stream', 10)], p20: [live('rival-on-stream', 20)] };
  const asked = [];
  mockApi(({ query }) => {
    if (query.includes('streamQueue')) {
      asked.push('queue');
      return { tournament: { streamQueue: [] } };
    }
    const aliases = [...query.matchAll(/(p\d+): player\(/g)].map(([, alias]) => alias);
    asked.push(...aliases);
    return Object.fromEntries(aliases.map(alias => [alias, { sets: { nodes: nodes[alias] } }]));
  });
  await tracker.postStreamAlerts(channel, 0);
  // asked twice, the second to confirm it's still on stream
  assert.deepEqual(asked, ['p20', 'p20']);
  assert.equal(sent.length, 1);

  const interaction = {
    // a TO, since it's someone else's
    commandName: 'track', user: { id: 'someone' }, memberPermissions: { has: () => true },
    options: { getSubcommand: () => 'posts', getString: name => ({ player: '1', stream: 'on' })[name] ?? null },
    reply: async r => { interaction.replied = r; },
  };
  await handleCommand(interaction);
  assert.equal(interaction.replied.content, 'Stream alerts on for Active.');
  // a set on stream right now is still worth announcing, so there's no cutoff like set results have
  await tracker.postStreamAlerts(channel, 0);
  assert.deepEqual(asked.slice(2).toSorted(), ['p10', 'p10', 'p20', 'p20', 'queue', 'queue']);
  assert.equal(sent.length, 2);
});

test('match call pings only go to people who turned them on, and the server switch still mutes them', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: tracker.newTracked({ ...crewPlayer, discordId: 'crew-discord' }),
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
  };
  state.links = {};
  // nobody turned them on, and someone who did has no start.gg to go by
  state.callPings = ['stranger-discord'];
  state.called = [];
  const called = (id, playerId) => ({ ...node(id, null, playerId), state: 6, updatedAt: now - 60 });
  const asked = [];
  mockApi(({ query }) => {
    const aliases = [...query.matchAll(/(p\d+): player\(/g)].map(([, alias]) => alias);
    asked.push(...aliases);
    return Object.fromEntries(aliases.map(alias => [alias, { sets: { nodes: [] } }]));
  });
  await tracker.postMatchCalls(channel);
  assert.deepEqual(asked, []);
  assert.equal(sent.length, 0);
  assert.deepEqual(state.called, []);

  // turned on, but the server switch is off
  state.callPings = ['crew-discord'];
  state.messages = { calls: false };
  mockApi(() => ({ p10: { sets: { nodes: [called('server-off', 10)] } } }));
  await tracker.postMatchCalls(channel);
  assert.ok(state.called.includes('server-off'));
  assert.equal(sent.length, 0);
  state.callPings = [];
});

test('match call pings mention connected discords, one message per set', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, discordId: 'crew-discord' },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
  };
  // linked, so known without being tracked
  state.links = { 'quiet-discord': { userId: 3, playerId: 30, tag: 'Quiet', slug: 'user/quiet', discordId: 'quiet-discord' } };
  state.callPings = ['crew-discord', 'rival-discord', 'quiet-discord'];
  state.called = [];
  // both tracked players in the same called set, on a station
  const both = {
    id: 'both-called', state: 6, completedAt: null, updatedAt: now - 60, fullRoundText: 'Winners round 1', winnerId: null, stream: null, station: { number: 4 }, event,
    slots: [[1, 10, 'Active'], [2, 20, 'Rival']].map(([entrant, player, name]) => ({
      entrant: { id: entrant, name, initialSeedNum: entrant, participants: [{ player: { id: player } }] },
      standing: null,
    })),
  };
  const solo = {
    id: 'solo-called', state: 6, completedAt: null, updatedAt: now - 60, fullRoundText: 'Losers round 1', winnerId: null, stream: null, event,
    slots: [[3, 30, 'Quiet'], [4, 99, 'Opponent']].map(([entrant, player, name]) => ({
      entrant: { id: entrant, name, initialSeedNum: entrant, participants: [{ player: { id: player } }] },
      standing: null,
    })),
  };
  mockApi(({ query }) => {
    if (query.includes('p10')) return { p10: { sets: { nodes: [both] } }, p20: { sets: { nodes: [both] } }, p30: { sets: { nodes: [solo] } } };
    return { p20: { sets: { nodes: [both] } }, p30: { sets: { nodes: [solo] } } };
  });
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 2);
  // one message for the shared set, with both pings in it
  assert.match(sent[0].content, /<@crew-discord>.*<@rival-discord>|<@rival-discord>.*<@crew-discord>/);
  assert.match(sent[0].content, /You're up - Station 4/);
  assert.deepEqual(sent[0].allowedMentions, { users: ['crew-discord', 'rival-discord'] });
  assert.match(sent[0].embeds[0].data.title, /Match call · /);
  assert.match(sent[0].embeds[0].data.description, /Station 4/);
  // only linked, and the card and button are still about them. no station on start.gg, so none shows
  assert.equal(sent[1].content, `<@quiet-discord> You're up`);
  assert.doesNotMatch(sent[1].content, /Station/);
  assert.doesNotMatch(sent[1].embeds[0].data.description, /Station/);
  assert.deepEqual(sent[1].allowedMentions, { users: ['quiet-discord'] });
  assert.equal(sent[1].embeds[0].data.author.name, 'Quiet');
  assert.deepEqual([...state.called].sort(), ['both-called', 'solo-called']);
  // both tracked, it's about whoever's first on the list, and the other is only known from the set by player id
  assert.equal(sent[0].components[0].toJSON().components[0].custom_id, 'private:h2h:active:#20::::');
  assert.equal(sent[1].components[0].toJSON().components[0].custom_id, 'private:h2h:quiet:#99::::');

  // a second check sends nothing new
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 2);
  state.links = {};
  state.callPings = [];
});

test('match call pings put all four doubles players in one message', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, discordId: 'crew-discord' },
    2: { userId: 2, playerId: 11, tag: 'Partner', slug: 'user/partner', discordId: 'partner-discord' },
    3: { userId: 3, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord' },
    4: { userId: 4, playerId: 21, tag: 'Fourth', slug: 'user/fourth' },
  };
  state.links = {};
  state.callPings = ['crew-discord', 'partner-discord', 'rival-discord'];
  state.called = [];
  const team = (entrant, name, seed, ids) => ({
    entrant: { id: entrant, name, initialSeedNum: seed, participants: ids.map((id) => ({ player: { id } })) },
    standing: null,
  });
  // all four tracked players in one 2v2 set. the fourth never turned pings on
  const doubles = {
    id: 'doubles-called', state: 6, completedAt: null, updatedAt: now - 60, fullRoundText: 'Winners semifinal', winnerId: null, stream: null, event,
    slots: [team(1, 'Crew + Partner', 1, [10, 11]), team(2, 'Rival + Fourth', 2, [20, 21])],
  };
  // 99 is nobody tracked, so only the ones with pings on get pinged
  const mixed = {
    id: 'mixed-called', state: 6, completedAt: null, updatedAt: now - 60, fullRoundText: 'Losers round 1', winnerId: null, stream: null, event,
    slots: [team(3, 'Crew + Stranger', 1, [10, 99]), team(4, 'Rival + Fourth', 2, [20, 21])],
  };
  mockApi(() => ({
    p10: { sets: { nodes: [doubles, mixed] } }, p11: { sets: { nodes: [doubles] } },
    p20: { sets: { nodes: [doubles, mixed] } }, p21: { sets: { nodes: [doubles, mixed] } },
  }));
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 2);
  // one message for the 2v2 set, with every connected discord in it
  assert.deepEqual(sent[0].allowedMentions, { users: ['crew-discord', 'partner-discord', 'rival-discord'] });
  assert.match(sent[0].content, /You're up/);
  assert.match(sent[0].embeds[0].data.title, /Match call · /);
  // the untracked stranger adds no ping, still one message
  assert.deepEqual(sent[1].allowedMentions, { users: ['crew-discord', 'rival-discord'] });
  // /h2h is singles, so no button
  assert.deepEqual(sent.map((each) => each.components), [[], []]);
  assert.deepEqual([...state.called].sort(), ['doubles-called', 'mixed-called']);

  // a second check sends nothing new
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 2);
  state.callPings = [];
});

test('match calls and stream alerts lose their Head to head button once the set is over', async () => {
  const now = Math.floor(Date.now() / 1000);
  const edits = [];
  let nextId = 0;
  const messages = {
    edit: async (id, payload) => {
      if (id === 'gone') throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      edits.push([id, payload]);
    },
  };
  const channel = {
    send: async () => ({ id: `m${++nextId}`, channelId: 'c1' }),
    client: { channels: { fetch: async (id) => { assert.equal(id, 'c1'); return { messages }; } } },
  };
  state.messages = {};
  state.players = { 1: { ...crewPlayer, discordId: 'crew-discord', streamAlerts: false } };
  state.links = {};
  state.callPings = ['crew-discord'];
  state.called = [];
  state.buttons = [];
  const called = { ...node('501', null), state: 6, updatedAt: now - 60, stream: null };
  let states = {};
  const asked = [];
  mockApi(({ query }) => {
    if (query.includes('set(id:')) {
      const ids = [...query.matchAll(/s(\d+): set/g)].map(([, id]) => id);
      asked.push(ids);
      return Object.fromEntries(ids.map((id) => [`s${id}`, id in states ? { state: states[id] } : null]));
    }
    return { p10: { sets: { nodes: [called] } } };
  });
  await tracker.postMatchCalls(channel);
  assert.deepEqual(state.buttons.map(({ setId, channelId, messageId }) => [setId, channelId, messageId]), [['501', 'c1', 'm1']]);

  // still being played, so it keeps the button
  states = { 501: 2 };
  await tracker.clearFinishedButtons(channel);
  assert.deepEqual(edits, []);
  assert.equal(state.buttons.length, 1);

  states = { 501: 3 };
  await tracker.clearFinishedButtons(channel);
  assert.deepEqual(edits, [['m1', { components: [] }]]);
  assert.deepEqual(state.buttons, []);

  // a deleted set or post counts as over, and one 12 hours old goes without asking start.gg
  states = { 502: 2 };
  state.buttons = [
    { setId: '502', channelId: 'c1', messageId: 'live', at: now },
    { setId: '503', channelId: 'c1', messageId: 'gone', at: now },
    { setId: '504', channelId: 'c1', messageId: 'old', at: now - 13 * 3600 },
  ];
  asked.length = 0;
  await tracker.clearFinishedButtons(channel);
  assert.deepEqual(asked, [['502', '503']]);
  assert.deepEqual(edits.slice(1).map(([id]) => id), ['old']);
  assert.deepEqual(state.buttons.map(({ messageId }) => messageId), ['live']);

  // with nothing saved it asks start.gg nothing
  state.buttons = [];
  asked.length = 0;
  await tracker.clearFinishedButtons(channel);
  assert.deepEqual(asked, []);
});

test('a stream alert saves the message with the card', async () => {
  const now = Math.floor(Date.now() / 1000);
  let nextId = 0;
  const channel = { send: async () => ({ id: `m${++nextId}`, channelId: 'c1' }) };
  state.messages = {};
  state.players = { 1: { ...crewPlayer, discordId: 'crew-discord', lastCheck: now } };
  state.links = {};
  state.streamed = [];
  state.tournaments = {};
  state.buttons = [];
  // only whoever is playing gets pinged, so one message with the card
  state.streamPings = ['crew-discord', 'rival-discord'];
  const live = { ...node('601', null), state: 2, updatedAt: now, stream: { streamName: 'local', streamSource: 'TWITCH' } };
  mockApi(() => ({ p10: { sets: { nodes: [live] } } }));
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(nextId, 1);
  assert.deepEqual(state.buttons.map(({ setId, messageId }) => [setId, messageId]), [['601', 'm1']]);
  state.streamPings = [];
  state.buttons = [];
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
  state.messages = { calls: true };
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

  // with the server switch off nobody was getting pinged, so nothing carries over
  state.players = { 1: { ...crewPlayer, discordId: 'crew-discord', callPings: true } };
  state.callPings = [];
  state.messages = {};
  tracker.migrateTracking(now);
  assert.deepEqual(state.callPings, []);
  assert.equal(state.players[1].callPings, undefined);
  state.tournaments = {};
});

test('a tracked tournament\'s crew counts registered server members but not linked-only players', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.players = { 1: { ...crewPlayer, discordId: 'active-discord' } };
  state.links = { 'linked-discord': { userId: 7, playerId: 70, tag: 'Linked', slug: 'user/linked' } };
  state.accounts = {};
  const local = { id: 5, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 7200, entries: [], userIds: [], tracked };
  const participant = (tag, id, discordId) => ({ gamerTag: tag, user: { id, slug: `user/${tag.toLowerCase()}`, authorizations: discordId ? [{ externalId: discordId }] : [] } });
  mockApi(() => ({ tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [
    participant('Active', 1, 'active-discord'), participant('Linked', 7), participant('Member', 8, 'member-discord'), participant('Other', 10, 'other-discord'),
    participant('Visitor', 9, 'visitor-discord'), { gamerTag: 'Added by the TO', user: null },
  ] } } }));
  const guild = { members: { fetch: async ({ user: ids }) => new Map(ids.filter((id) => ['member-discord', 'other-discord'].includes(id)).map((id) => [id, {}])) } };
  await tracker.refreshCrew(local, guild);
  // tracked players go by userIds, the rest are saved to be named
  assert.deepEqual(local.userIds, [1]);
  assert.deepEqual(local.crew, { 8: { userId: 8, slug: 'user/member', tag: 'Member' }, 10: { userId: 10, slug: 'user/other', tag: 'Other' } });

  // one tracked player, but three of the crew, so the roll call goes out and names them all
  local.entries = [1, 8, 10].map((userId) => ({ userId, event: 'Singles', eventSlug: 'tournament/local/event/singles', entrants: 32 }));
  state.messages = {};
  const sent = [];
  await tracker.postRollCall(local, { send: async (payload) => sent.push(payload) });
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].data.description, /\[Active\]\(https:\/\/www\.start\.gg\/user\/active\)\n\[Member\].*\n\[Other\]/s);
  assert.doesNotMatch(sent[0].embeds[0].data.description, /Linked/);

  // start.gg failing keeps the crew it had
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) });
  const logged = console.error;
  console.error = () => {};
  try {
    await tracker.refreshCrew(local, guild);
  } finally {
    console.error = logged;
  }
  assert.deepEqual(Object.keys(local.crew), ['8', '10']);
  state.links = {};
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
