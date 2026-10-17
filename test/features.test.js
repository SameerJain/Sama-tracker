import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-features-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
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
    options: { getSubcommand: () => null, getString: () => 'target' },
    deferReply: async () => {}, editReply: async r => replies.push(r),
  });
  assert.match(replies.at(-1), /\/link/);
});

test('tracked callers can scout an untracked opponent without adding them', async () => {
  state.players = { 1: crewPlayer };
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
    options: { getSubcommand: () => null, getString: () => 'https://www.start.gg/user/target', getBoolean: () => null },
    deferReply: async options => assert.ok(options.flags), editReply: async result => { reply = result; },
  });
  const text = reply.embeds.map(e => e.toJSON().description).join('\n');
  assert.match(text, /Fox/);
  assert.match(text, /### You vs Target\n\*\*Ultimate:\*\* 1-0/);
  assert.deepEqual(Object.keys(state.players), ['1']);
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
  assert.match(text, /\*\*Struggles against:\*\* Sheik 1-2 \(33%\)\n\*\*Strong against:\*\* Marth 3-0 \(100%\)\n\*\*Worst stages:\*\* Smashville 1-2 \(33%\)\n\*\*Best stages:\*\* Battlefield 3-0 \(100%\)/);
  assert.match(text, /Reported in 2 of their last 2 Ultimate sets/);

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
  state.players = { 1: { ...crewPlayer, playerId: 11 } };
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
    options: { getSubcommand: () => null, getString: () => 'start.gg/user/deep', getBoolean: (name) => name === 'verbose' },
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
    '**Streaks:** now W2 · best W2 · worst L1',
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
    '**Win rate:** up 66.7 points',
    '**Games won:** up 62.5 points',
    '**Average finish:** top 50% → top 10%',
    '**Rematches, before → now:** **Rival** 0-1 → 1-0',
  ].join('\n')), text);
  const trend = text.split('### Every 30 days, newest first\n')[1].split('\n').slice(0, 6);
  assert.equal(trend.length, 6);
  assert.match(trend[0], /sets 2-1 \(67%\) · 1 event, average top 10%/);
  assert.match(trend[4], /sets 1-0 \(100%\)/);
  assert.match(trend[5], /no sets or events/);
  assert.doesNotMatch(text, /NaN|undefined|null/);

  // the short one keeps the headline numbers and the streak, without the verbose dig
  const short = embeds.progress(crewPlayer, periods.slice(0, 2)).map(e => e.toJSON().description).join('\n');
  assert.doesNotMatch(short, /Streaks:|Sweeps|Close sets|What changed|Every 30 days|Game record/);
  assert.match(short, /\*\*Games:\*\* 5-3 \(63%\)/);
  assert.match(short, /\*\*Streak:\*\* W2 going in/);
  assert.match(short, /\n\*\*Win rate:\*\* up 66\.7 points\n/);
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

test('recap includes spanning-week finishes, excludes inactive players, and persists completion', async () => {
  const until = Date.parse('2026-10-26T01:00:00Z') / 1000;
  const next = Date.parse('2026-11-02T02:00:00Z') / 1000;
  state.weeklyRecap = undefined;
  state.players = { 1: crewPlayer, 2: { userId: 2, playerId: 20, tag: 'Inactive' }, 3: { userId: 3, playerId: 30, tag: 'DQ-only' } };
  state.tournaments = { 1: { name: 'Next local', slug: 'tournament/next', startAt: until + 86400, entries: [{ userId: 1 }, { userId: 2 }] } };
  state.tournaments[2] = { name: 'Late Sunday', slug: 'tournament/late', startAt: next - 1800, entries: [{ userId: 1 }] };
  state.tournaments[3] = { name: 'Following week', slug: 'tournament/following', startAt: next, entries: [{ userId: 1 }] };
  mockApi(({ query, variables }) => query.includes('user(id:')
    ? { user: { events: { pageInfo: { totalPages: 1 }, nodes: [{ ...event, startAt: until - 8 * 86400, state: 'COMPLETED', userEntrant: { initialSeedNum: 9, standing: { placement: 5 } } }] } } }
    : { player: { sets: { pageInfo: { totalPages: 1 }, nodes: variables.id === 20 ? [] : [node('weekly', until - 10, variables.id, variables.id === 30)] } } });
  const sent = [];
  const channel = { send: async r => sent.push(r) };
  await postWeeklyRecap(channel, until);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  const text = sent.flatMap(r => r.embeds.map(e => (e.data ?? e).description)).join('\n');
  assert.match(text, /Active/);
  assert.match(text, /Next local/);
  assert.match(text, /Late Sunday/);
  assert.match(text, /Biggest upset/);
  assert.match(text, /Best finish/);
  assert.doesNotMatch(text, /Inactive|DQ-only|Following week/);
  state.weeklyRecap = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).weeklyRecap;
  mockApi(() => assert.fail('A completed recap must not be fetched again'));
  await postWeeklyRecap(channel, until + 60);
  assert.equal(sent.length, 1);
});

test('recap retries unfinished message batches without reposting successful batches', async () => {
  const until = Date.parse('2026-10-19T01:00:00Z') / 1000;
  state.players = { 1: crewPlayer };
  state.tournaments = {};
  state.weeklyRecap = undefined;
  mockApi(({ query }) => query.includes('user(id:')
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
});

test('muted automatic messages are consumed without posting or replaying them later', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120 } };
  state.messages = { sets: false, streams: false, rollcall: false, results: false, registration: false };
  state.posted = [];
  state.dqs = [];
  state.streamed = [];
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
  await tracker.postStreamAlerts(channel);
  assert.ok(state.streamed.includes('muted-stream'));
  state.messages.streams = true;
  await tracker.postStreamAlerts(channel);
  assert.equal(sent.length, 1);

  const upcoming = { startAt: now + 1800, entries: [1, 2, 3].map(userId => ({ userId })) };
  await tracker.postRollCall(upcoming, channel);
  assert.equal(upcoming.rollCallPosted, true);
  const finished = { startAt: now - 27 * 3600, endAt: now - 26 * 3600, entries: [{ started: true }] };
  await tracker.postResults(finished, channel);
  assert.equal(finished.resultsPosted, true);

  state.regAdmins = {};
  state.regReminders = { 1: { id: 1, name: 'Local', slug: 'tournament/local', next: 0 } };
  mockApi(() => ({ tournament: { id: 1, startAt: now + 86400, endAt: now + 2 * 86400,
    registrationClosesAt: now + 3600, isRegistrationOpen: true, events: [] } }));
  await tracker.postRegReminders(channel);
  assert.equal(state.regReminders[1].next, 4);
  assert.equal(sent.length, 1);
});

test('set results off keeps a player\'s sets out and coming back on doesn\'t dump the backlog', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = {};
  state.players = {
    1: { ...crewPlayer, lastCheck: now - 120, setResults: false },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastCheck: now - 120 },
  };
  state.posted = [];
  state.dqs = [];
  mockApi(() => ({
    p10: { sets: { nodes: [{ ...node('muted-set', now - 60), state: 3 }] } },
    p20: { sets: { nodes: [{ ...node('shown-set', now - 60, 20), state: 3 }] } },
  }));

  await tracker.postNewSets(channel);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].embeds[0].data.author.name, 'Rival');

  // the fetch window covers the muted set again, but it stays skipped
  state.players[1].setResults = true;
  await tracker.postNewSets(channel);
  assert.equal(sent.length, 1);
});

test('re-enabling between polls skips events that became due before re-enabling', async () => {
  const now = Math.floor(Date.now() / 1000);
  const sent = [];
  const channel = { send: async payload => sent.push(payload) };
  state.messages = { enabledAt: Object.fromEntries(['sets', 'streams', 'rollcall', 'results', 'registration'].map(type => [type, now])) };
  state.players = { 1: { ...crewPlayer, lastCheck: now - 120 } };
  state.posted = [];
  state.dqs = [];
  state.streamed = [];
  state.tournaments = {};
  let current = { ...node('unpolled-muted-set', now - 60), state: 3, updatedAt: now - 60 };
  mockApi(() => ({ p10: { sets: { nodes: [current] } } }));
  await tracker.postNewSets(channel);
  current = { ...current, id: 'unpolled-muted-stream', state: 2, stream: { streamName: 'example', streamSource: 'TWITCH' } };
  await tracker.postStreamAlerts(channel);
  for (const userId of [2, 3]) state.players[userId] = { userId, playerId: userId * 10, tag: `Player ${userId}`, slug: `user/player${userId}` };
  await tracker.postRollCall({ name: 'Local', slug: 'tournament/local', startAt: now + 1800,
    entries: [1, 2, 3].map(userId => ({ userId, event: 'Singles', eventSlug: event.slug, entrants: 32 })) }, channel);
  await tracker.postResults({ name: 'Local', slug: 'tournament/local', startAt: now - 14 * 3600, endAt: now - 13 * 3600,
    entries: [{ userId: 1, event: 'Singles', eventSlug: event.slug, entrants: 32, started: true, placement: 5, final: true }] }, channel);
  state.regAdmins = {};
  state.regReminders = { 1: { id: 1, name: 'Local', slug: 'tournament/local', next: 0 } };
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
  await tracker.postStreamAlerts({ send: async payload => sent.push(payload) });
  assert.equal(sent.length, 1);
});
