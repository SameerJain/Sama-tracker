import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-doubles-'));
process.env.STATE_DIR = directory;
delete process.env.ANTHROPIC_API_KEY;
const { doubles, doublesReport } = await import('../src/embeds/doubles.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const player = { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew' };
const ultimate = { id: 60, slug: 'tournament/a/event/doubles', name: 'Ultimate Doubles', startAt: 1000, numEntrants: 24, videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'A' } };
const melee = { ...ultimate, id: 61, slug: 'tournament/b/event/doubles', name: 'Melee Doubles', videogame: { id: 1, displayName: 'Melee' }, tournament: { name: 'B' } };

// a set the way toSet leaves it. mine and theirs are [[playerId, tag], ...], won is from crew's side
function set(id, { partner = [11, 'Partner'], them = [[20, 'Rival'], [21, 'Ally']], name = 'Rival / Ally', won = true, score = [2, 1], seeds = [3, 1], event = ultimate, completedAt = 2000 } = {}) {
  const side = (entrant, players, team, seed, points) => ({ id: entrant, name: team, seed, playerIds: players.map(([pid]) => pid), tags: players.map(([, tag]) => tag), score: points });
  return {
    id, completedAt, round: 'Winners Final', winnerId: won ? 1 : 2, event,
    sides: [side(1, [[10, 'Crew'], partner], 'Crew team', seeds[0], score[0]), side(2, them, name, seeds[1], score[1])],
  };
}

const text = (embeds) => JSON.stringify([embeds].flat().map((embed) => embed.toJSON()));

test('partners get their record from sets and their events from placements, most sets first', () => {
  const sets = [
    set('1', { completedAt: 3000 }), set('2', { won: false, score: [0, 2], completedAt: 2900 }),
    set('3', { partner: [12, 'Other'], completedAt: 2800 }),
  ];
  const events = [{ placement: 2, seed: 4, dq: false, event: ultimate, partners: [{ id: 11, tag: 'Partner' }] }];
  const card = text(doubles(player, sets, events));
  assert.match(card, /### Partners\\n\*\*Partner\*\* · 1-1 \(50%\) · 1 event\\n\*\*Other\*\* · 1-0 \(100%\)/);
  assert.match(card, /Best finish:\*\* 🥈 \*\*2nd\*\* of 24 \(seed 4\).*with \*\*Partner\*\*/);
  // seed 3 beating seed 1 is an upset, and it names who they won it with
  assert.match(card, /Biggest upset:\*\* beat \*\*Rival \/ Ally\*\* \(seed 1\) 2-1 as seed 3 at \[A\]\([^)]+\) with \*\*Partner\*\*/);
  assert.match(card, /From their last 3 doubles sets and 1 event on start\.gg/);
});

test('DQs stay out of the record and the events, and the full report says how many', () => {
  const sets = [set('1'), set('2', { score: [2, -1] })];
  const events = [
    { placement: 5, seed: 2, dq: false, event: ultimate, partners: [{ id: 11, tag: 'Partner' }] },
    { placement: 9, seed: 1, dq: true, event: melee, partners: [{ id: 11, tag: 'Partner' }] },
  ];
  assert.match(text(doubles(player, sets, events)), /Ultimate 1-0 \(100%\)/);
  const [overview] = doublesReport(player, sets, events);
  assert.match(text(overview), /1 DQ left out/);
  assert.equal(overview.toJSON().fields.find(({ name }) => name === 'Events').value, '1');
});

test('the same two opponents are one team under any team name, and lost to most goes by losses', () => {
  const sets = [
    set('1', { name: 'Rival / Ally', completedAt: 3000 }), set('2', { name: 'Cool Team', won: false, score: [1, 2], completedAt: 2900 }),
    set('3', { them: [[30, 'Third'], [31, 'Fourth']], name: 'Third / Fourth', won: false, score: [0, 2], completedAt: 2800 }),
    set('4', { them: [[30, 'Third'], [31, 'Fourth']], name: 'Third / Fourth', won: false, score: [1, 2], completedAt: 2700 }),
  ];
  const cards = doublesReport(player, sets, []);
  const fields = cards.at(-1).toJSON().fields;
  // newest name wins, since sets are newest first
  assert.equal(fields.find(({ name }) => name === 'Most played teams').value, '**Rival / Ally** 1-1\n**Third / Fourth** 0-2');
  assert.equal(fields.find(({ name }) => name === 'Lost to most').value, '**Third / Fourth** 0-2\n**Rival / Ally** 1-1');
  // 2-1, 1-2 and 1-2 went to the last game, 0-2 didn't
  assert.match(text(cards), /Close sets:\*\* 1-2 \(33%\)/);
  assert.match(text(cards), /2v2 only, DQs left out/);
});

test('melee wording when nothing is left after filtering', () => {
  assert.match(text(doubles(player, [], [], { melee: true })), /No Melee doubles sets on start\.gg yet\./);
  assert.match(text(doublesReport(player, [], [])), /No doubles sets on start\.gg yet\./);
});

test('melee doubles says so at the top, ultimate shows nothing there', () => {
  assert.equal(doubles(player, [], [], { melee: true }).toJSON().author.name, 'Melee doubles stats');
  assert.equal(doubles(player, [], []).toJSON().author.name, 'Doubles stats');
  assert.equal(doublesReport(player, [], [], { melee: true })[0].toJSON().author.name, 'Melee full doubles stats');
  assert.equal(doublesReport(player, [], [])[0].toJSON().author.name, 'Full doubles stats');
});

test('doubles events skip unfinished ones and leave the player out of their own partners', async () => {
  const queries = [];
  globalThis.fetch = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    queries.push(query);
    const entrant = (placement) => ({ initialSeedNum: 2, isDisqualified: false, standing: { placement }, participants: [{ player: { id: 10, gamerTag: 'Crew' } }, { player: { id: 11, gamerTag: 'Partner' } }] });
    return { ok: true, json: async () => ({ data: {
      e60: { ...ultimate, state: 'COMPLETED', userEntrant: entrant(3) },
      e61: { ...melee, state: 'ACTIVE', userEntrant: entrant(1) },
      e62: null,
    } }) };
  };
  const events = await startgg.getDoublesEvents(player, [60, 61, 62]);
  assert.deepEqual([...events.keys()], [60]);
  assert.deepEqual(events.get(60).partners, [{ id: 11, tag: 'Partner' }]);
  assert.equal(events.get(60).placement, 3);
  assert.match(queries[0], /userEntrant\(userId: 1\)/);
});

test('doubles history asks for 2v2 sets with tags, and keeps the tags on each side', async () => {
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body).query;
    return { ok: true, json: async () => ({ data: { player: { sets: { pageInfo: { totalPages: 3 }, nodes: [{
      id: 5, completedAt: 100, fullRoundText: 'Grand Final', winnerId: 1, event: ultimate,
      slots: [1, 2].map((entrant) => ({
        entrant: { id: entrant, name: `Team ${entrant}`, initialSeedNum: entrant, participants: [{ player: { id: entrant * 10, gamerTag: `A${entrant}` } }, { player: { id: entrant * 10 + 1, gamerTag: `B${entrant}` } }] },
        standing: { stats: { score: { value: 3 - entrant } } },
      })),
    }] } } } }) };
  };
  const page = await startgg.getDoublesHistory(10, 1);
  assert.match(sent, /entrantSize: \[2\]/);
  assert.equal(page.totalPages, 3);
  assert.deepEqual(page.sets[0].sides[0].tags, ['A1', 'B1']);
  assert.deepEqual(startgg.fromSide(page.sets[0], 11).me.playerIds, [10, 11]);
});
