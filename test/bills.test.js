import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sama-bills-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const bills = await import('../src/bills.js');
const embeds = await import('../src/embeds/index.js');
const { postBillsResults, billsDelay, BILLS_BASELINE_HOURS, health } = await import('../src/tracker.js');
const { messageSettings } = await import('../src/message-settings.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const date = '2026-10-18T20:25Z';
const unix = Math.floor(Date.parse(date) / 1000);

function side(abbr, name, score, winner, record, logo) {
  return {
    team: { abbreviation: abbr, displayName: name, logos: [{ href: logo }] },
    score: score == null ? {} : { displayValue: String(score) },
    winner,
    record: [{ type: 'total', displayValue: record }],
  };
}

function event({ id = '1', completed = true, billsScore = 33, oppScore = 30, winner = true } = {}) {
  return {
    id, date, week: { text: 'Week 6' },
    competitions: [{
      status: { type: { completed } },
      venue: { fullName: 'Allegiant Stadium' },
      attendance: 62618,
      competitors: [
        side('LV', 'Las Vegas Raiders', oppScore, !winner, '3-3', 'https://images.example/lv.png'),
        side('BUF', 'Buffalo Bills', billsScore, winner, '5-1', 'https://images.example/buf.png'),
      ],
    }],
    links: [{ rel: ['summary', 'desktop', 'event'], href: `https://www.espn.com/nfl/game/_/gameId/${id}/bills-raiders` }],
  };
}

const summary = {
  header: { competitions: [{ competitors: [
    { team: { abbreviation: 'BUF' }, linescores: [{ displayValue: '3' }, { displayValue: '10' }, { displayValue: '10' }, { displayValue: '10' }] },
    { team: { abbreviation: 'LV' }, linescores: [{ displayValue: '7' }, { displayValue: '6' }, { displayValue: '0' }, { displayValue: '17' }] },
  ] }] },
  boxscore: { teams: [
    { team: { abbreviation: 'BUF' }, statistics: [{ name: 'totalYards', displayValue: '345' }, { name: 'turnovers', displayValue: '0' }] },
    { team: { abbreviation: 'LV' }, statistics: [{ name: 'totalYards', displayValue: '378' }, { name: 'turnovers', displayValue: '1' }] },
  ] },
};

let scheduled = [];
let detailsFail = false;

globalThis.fetch = async (url) => {
  if (String(url).includes('/summary?event=')) {
    if (detailsFail) throw new Error('ESPN down');
    return { ok: true, json: async () => summary };
  }
  assert.match(String(url), /site\.api\.espn\.com/);
  return { ok: true, json: async () => ({ events: scheduled }) };
};

function channel() {
  const sent = [];
  return { sent, send: async (message) => { sent.push(message); return { id: '1' }; } };
}

beforeEach(() => {
  scheduled = [];
  detailsFail = false;
  Object.assign(state, { messages: {}, billsPosted: [] });
  health.billsError = null;
});

test('the season year stays on last year through February', () => {
  assert.equal(bills.seasonYear(new Date('2026-10-18T00:00:00Z')), 2026);
  assert.equal(bills.seasonYear(new Date('2027-01-15T00:00:00Z')), 2026);
  assert.equal(bills.seasonYear(new Date('2026-09-01T00:00:00Z')), 2026);
});

test('schedule games keep Buffalo first with the other team and records', () => {
  const game = bills.toGame(event());
  assert.equal(game.id, '1');
  assert.equal(game.date, unix);
  assert.equal(game.week, 'Week 6');
  assert.equal(game.billsScore, 33);
  assert.equal(game.oppScore, 30);
  assert.equal(game.won, true);
  assert.equal(game.opponent.abbreviation, 'LV');
  assert.equal(game.opponent.logo, 'https://images.example/lv.png');
  assert.equal(game.billsRecord, '5-1');
  assert.equal(game.opponent.record, '3-3');

  const loss = bills.toGame(event({ billsScore: 20, oppScore: 27, winner: false }));
  assert.equal(loss.won, false);
  assert.equal(bills.toGame({ competitions: [] }), null);
});

test('only completed games with a score count as finals', async () => {
  scheduled = [event({ id: '1' }), event({ id: '2', completed: false, billsScore: null, oppScore: null }), event({ id: '3', billsScore: 20, oppScore: 27, winner: false })];
  assert.deepEqual((await bills.getFinals(2026)).map((game) => game.id), ['1', '3']);
});

test('the final card is green for a win and red for a loss, with the other team\'s logo', () => {
  const win = embeds.billsFinal(bills.toGame(event()), { lines: { BUF: ['3', '10'], LV: ['7', '6'] }, stats: { BUF: { yards: '345', turnovers: '0' }, LV: { yards: '378', turnovers: '1' } } });
  assert.match(win.data.title, /^Bills final · Bills 33.*Raiders 30/);
  assert.equal(win.data.color, 0x22c55e);
  assert.equal(win.data.thumbnail.url, 'https://images.example/lv.png');
  assert.match(win.data.description, /Bills win.*Week 6.*Allegiant Stadium/);
  assert.match(win.data.description, /5-1.*3-3/);
  assert.match(win.data.description, /By quarter.*BUF 3-10.*LV 7-6/);
  assert.match(win.data.description, /Yards.*BUF 345.*378/);
  assert.match(win.data.footer.text, /ESPN/);

  const loss = embeds.billsFinal(bills.toGame(event({ billsScore: 20, oppScore: 27, winner: false })));
  assert.equal(loss.data.color, 0xef4444);
  assert.match(loss.data.title, /Bills 20.*Raiders 27/);
});

test('a new final posts once in the channel with no pings', async () => {
  scheduled = [event({ id: '1' })];
  state.messages = { bills: true };
  const posts = channel();
  await postBillsResults(posts);
  assert.equal(posts.sent.length, 1);
  assert.deepEqual(posts.sent[0].allowedMentions, { parse: [] });
  assert.match(JSON.stringify(posts.sent[0].embeds), /Bills 33.*Raiders 30/);
  assert.deepEqual(state.billsPosted, ['1']);

  await postBillsResults(posts);
  assert.equal(posts.sent.length, 1, 'already posted, so nothing new');
});

test('finals while the switch is off stay skipped after it turns back on', async () => {
  scheduled = [event({ id: '1' })];
  state.messages = { bills: false };
  const posts = channel();
  await postBillsResults(posts);
  assert.equal(posts.sent.length, 0);
  assert.deepEqual(state.billsPosted, ['1']);

  state.messages = { bills: true, enabledAt: { bills: unix + 60 } };
  scheduled = [event({ id: '2' })];
  await postBillsResults(posts);
  assert.equal(posts.sent.length, 0, 'came due while off');
  assert.deepEqual(state.billsPosted, ['1', '2']);
});

test('bills finals start off server-wide', () => {
  state.messages = {};
  assert.equal(messageSettings().bills, false);
});

test('a final still posts its score when the details request fails', async () => {
  scheduled = [event({ id: '1' })];
  state.messages = { bills: true };
  detailsFail = true;
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const posts = channel();
    await postBillsResults(posts);
    assert.equal(posts.sent.length, 1);
    assert.match(JSON.stringify(posts.sent[0].embeds), /Bills 33.*Raiders 30/);
    assert.ok(errors.some((each) => each.includes('bills details')));
  } finally {
    console.error = originalError;
  }
});

test('an ESPN outage keeps old posts and shows on health', async () => {
  state.messages = { bills: true };
  state.billsPosted = ['1'];
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  try {
    await postBillsResults(channel());
    assert.match(health.billsError, /ESPN returned 500/);
    assert.deepEqual(state.billsPosted, ['1']);
  } finally {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/summary?event=')) return { ok: true, json: async () => summary };
      return { ok: true, json: async () => ({ events: scheduled }) };
    };
  }
});

test('the schedule state carries the next kickoff with the finals', async () => {
  scheduled = [event({ id: '1' }), event({ id: '2', completed: false, billsScore: null, oppScore: null, winner: null })];
  const { finals, nextDate } = await bills.getScheduleState(2026);
  assert.deepEqual(finals.map((game) => game.id), ['1']);
  assert.equal(nextDate, unix);
});

test('game day polls every 15 minutes, otherwise daily', () => {
  const day = 24 * 60 * 60;
  const baseline = BILLS_BASELINE_HOURS * 60 * 60 * 1000;
  const gameday = 15 * 60 * 1000;
  const kickoff = 1_000_000;
  assert.equal(billsDelay(null, kickoff), baseline);
  assert.equal(billsDelay(kickoff + 2 * day, kickoff), baseline);
  assert.equal(billsDelay(kickoff, kickoff - 30 * 60), gameday);
  assert.equal(billsDelay(kickoff, kickoff + 4 * 60 * 60), gameday);
  assert.equal(billsDelay(kickoff, kickoff + 9 * 60 * 60), baseline);
});

test('the next check is tight when a game is near and daily otherwise', async () => {
  state.messages = { bills: true };
  const baseline = BILLS_BASELINE_HOURS * 60 * 60 * 1000;
  // no game left on the schedule
  scheduled = [event({ id: '1' })];
  assert.equal(await postBillsResults(channel()), baseline);
  // a game starting in half an hour
  const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  scheduled = [{ ...event({ id: '2', completed: false, billsScore: null, oppScore: null, winner: null }), date: soon }];
  assert.equal(await postBillsResults(channel()), 15 * 60 * 1000);
});
