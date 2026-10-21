import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceFlow, attendanceHistogram, attendanceRanking, cumulativePlayers, crossSeries, histogramBuckets, loyaltyTier, loyaltyTiers, matchupMatrix, returnRates, seasonality, ULTIMATE_ROSTER } from '../series/shared/compute.mjs';
import { growthLine, line } from '../series/shared/charts.mjs';
import { clientModal, CLIENT_JS_UI, CLIENT_JS_SORT } from '../series/shared/page.mjs';

const row = (eventId, startAt, ids) => ({
  eventId, tournamentId: eventId, startAt, entrants: ids.map((id) => ({ name: 'P' + id, players: [{ id, tag: 'P' + id }] })),
});

test('attendance flow counts first, second and returning entries in date order', () => {
  // rows arrive out of order on purpose: the 2nd event listed is the earliest
  const flow = attendanceFlow([row(3, 300, [1, 2]), row(1, 100, [1, 2]), row(2, 200, [1, 3])], (r) => r.startAt);
  assert.deepEqual(flow.perEvent.map((r) => [r.first, r.second, r.returning]), [[2, 0, 0], [1, 1, 0], [0, 1, 1]]);
  assert.deepEqual(flow.counts, { 1: 3, 2: 2, 3: 1 });
  assert.equal(flow.perYear.length, 1);
  assert.deepEqual(
    (({ entrants, first, second, returning }) => [entrants, first, second, returning])(flow.perYear[0]),
    [6, 3, 2, 1],
  );
});

test('attendance flow dedupes a player within one event', () => {
  const doubles = { eventId: 1, tournamentId: 1, entrants: [{ name: 'A / B', players: [{ id: 1, tag: 'A' }, { id: 2, tag: 'B' }] }, { name: 'A', players: [{ id: 1, tag: 'A' }] }] };
  const flow = attendanceFlow([doubles], () => 100);
  assert.equal(flow.perEvent[0].entrants, 2);
  assert.equal(flow.perEvent[0].first, 2);
});

test('attendance ranking counts a player once per night across an off week\'s brackets', () => {
  // an off-week row holds every bracket from that night (singles, doubles,
  // squad strike), so a player in two of them still entered one event that night
  const rows = [
    { tournamentId: 1, entrants: [
      { name: 'Ann', players: [{ id: 1, tag: 'Ann' }] },
      { name: 'Ann / Bo', players: [{ id: 1, tag: 'Ann' }, { id: 2, tag: 'Bo' }] },
      { name: 'Cy', players: [{ id: 3, tag: 'Cy' }] },
    ] },
    { tournamentId: 2, entrants: [{ name: 'Ann', players: [{ id: 1, tag: 'Ann' }] }] },
  ];
  const ranked = attendanceRanking(rows, { 1: 2 });
  assert.deepEqual(ranked.map((p) => [p.tag, p.events, p.wins]), [['Ann', 2, 2], ['Bo', 1, 0], ['Cy', 1, 0]]);
  const flow = attendanceFlow(rows, (r) => r.tournamentId * 100);
  assert.deepEqual(flow.perEvent.map((r) => [r.entrants, r.first, r.second]), [[3, 3, 0], [1, 0, 1]]);
});

test('return rates: first-time rate is per entry, later rates convert from the previous stage', () => {
  const rates = returnRates({ a: 1, b: 2, c: 3, d: 5 });
  assert.equal(rates.distinct, 4);
  assert.equal(rates.totalEntries, 11);
  assert.equal(rates.firstTimeRate, 4 / 11);
  assert.deepEqual(rates.stages.map((s) => s.stage), [1, 2, 3, 5, 10, 20]);
  assert.deepEqual(rates.stages.map((s) => s.players), [4, 3, 2, 1, 0, 0]);
  assert.equal(rates.stages[0].conversion, null);
  assert.equal(rates.stages[1].conversion, 3 / 4); // second-time rate
  assert.equal(rates.stages[2].conversion, 2 / 3); // third-time rate
  assert.equal(rates.stages[3].conversion, 1 / 2);
  assert.deepEqual(returnRates({}), { distinct: 0, totalEntries: 0, firstTimeRate: 0, stages: returnRates({}).stages });
});

test('loyalty tiers and histogram bucket every player exactly once', () => {
  const entered = [1, 2, 3, 5, 9, 10, 19, 20, 55].map((events) => ({ events }));
  assert.equal(loyaltyTier(1).label, 'One-timer');
  assert.equal(loyaltyTier(2).label, 'Returned');
  assert.equal(loyaltyTier(4).label, 'Recurring');
  assert.equal(loyaltyTier(9).label, 'Regular');
  assert.equal(loyaltyTier(19).label, 'Core');
  assert.equal(loyaltyTier(55).label, 'Loyalist');
  const tiers = loyaltyTiers(entered);
  assert.deepEqual(tiers.map((t) => t.players), [1, 1, 1, 2, 2, 2]);
  assert.equal(tiers.reduce((s, t) => s + t.players, 0), entered.length);
  assert.equal(tiers.reduce((s, t) => s + t.entries, 0), 124);
  assert.equal(tiers[5].pctEntries, (20 + 55) / 124);
  const hist = attendanceHistogram(entered);
  assert.equal(hist.reduce((s, b) => s + b.players, 0), entered.length);
  assert.deepEqual(hist.map((b) => [b.label, b.players]), [['1', 1], ['2', 1], ['3', 1], ['5', 1], ['6–9', 1], ['10–14', 1], ['15–19', 1], ['20–29', 1], ['50–55', 1]]);
  // every histogram bucket sits inside one tier, so its colour is that tier's
  for (const b of hist) assert.equal(b.color, loyaltyTier(b.min).color);
});

test('histogram sections are made from the data, ending at its max', () => {
  // a short series stops at its own max, a long one splits the old 50+ range
  // into 10-wide sections that end at the max instead of an open-ended bucket
  assert.deepEqual(histogramBuckets(3).map((b) => b.label), ['1', '2', '3']);
  assert.equal(histogramBuckets(48).at(-1).label, '40–48');
  assert.deepEqual(histogramBuckets(159).filter((b) => b.min >= 50).map((b) => b.label),
    ['50–59', '60–69', '70–79', '80–89', '90–99', '100–109', '110–119', '120–129', '130–139', '140–149', '150–159']);
  // far bigger attendance widens the sections instead of piling up bars
  assert.equal(histogramBuckets(250).at(-1).label, '240–250');
  assert.equal(histogramBuckets(0).length, 0);
  assert.deepEqual(attendanceHistogram([]), []);
  // the amounts are the section's own player counts, and a section ends at the max
  const hist = attendanceHistogram([{ events: 53 }, { events: 59 }, { events: 105 }, { events: 159 }]);
  assert.deepEqual(hist.map((b) => [b.label, b.players, b.max]), [['50–59', 2, 59], ['100–109', 1, 109], ['150–159', 1, 159]]);
});

test('seasonality pools attendance by month and keeps empty months', () => {
  const ts = (y, m, d, attendees) => ({ startAt: Date.UTC(y, m, d) / 1000, numAttendees: attendees });
  const season = seasonality([ts(2023, 0, 15, 10), ts(2024, 0, 20, 20), ts(2024, 8, 5, 40), ts(2023, 8, 12, 44)]);
  assert.equal(season.length, 12);
  assert.deepEqual(season[0], { month: 0, name: 'January', short: 'Jan', tournaments: 2, totalAttendees: 30, avgAttendees: 15 });
  assert.deepEqual(season[8], { month: 8, name: 'September', short: 'Sep', tournaments: 2, totalAttendees: 84, avgAttendees: 42 });
  // a month that never ran comes back empty, not missing: that is the school-year pattern
  assert.equal(season[6].tournaments, 0);
  assert.equal(season[6].avgAttendees, null);
  assert.deepEqual(seasonality([]).map((r) => r.avgAttendees), Array(12).fill(null));
});

test('cumulative players only goes up and ends at the distinct count', () => {
  const flow = attendanceFlow([row(1, 100, [1, 2]), row(2, 200, [1, 3]), row(3, 300, [4])], (r) => r.startAt);
  const cum = cumulativePlayers(flow.perEvent);
  assert.deepEqual(cum.map((p) => [p.newPlayers, p.total]), [[2, 2], [1, 3], [1, 4]]);
  assert.ok(cum.every((p, i) => i === 0 || p.total >= cum[i - 1].total));
});

test('chart lines carry hover targets and their axis scale for the tooltip', () => {
  const svg = line([
    { startAt: 100, attendees: 10, name: 'One', date: '1970-01-01' },
    { startAt: 200, attendees: 30, name: 'Two', date: '1970-01-01' },
    { startAt: 300, attendees: 20, name: 'Three', date: '1970-01-01' },
  ]).svg;
  // every drawn line gets an invisible fat twin the mouse can actually hit,
  // labelled with its series so the tooltip can name it
  for (const series of ['attendance', 'average', 'straight-line trend (whole)', 'straight-line trend (1970)']) assert.ok(svg.includes(series), series);
  assert.match(svg, /class="hit"/);
  assert.match(svg, /data-x0="100"/);
  assert.match(svg, /data-ymax="30"/);
  // the hover tooltip lives in the shared page script and reads the scale back
  assert.match(CLIENT_JS_UI, /linetip/);
  assert.match(CLIENT_JS_UI, /svg \.hit/);
  // and it snaps: it only shows when the mouse is on the line, marks the
  // nearest point of the line, and reads out that point's values
  assert.match(CLIENT_JS_UI, /closestOnLine/);
  assert.match(CLIENT_JS_UI, /snapdot/);
  assert.match(CLIENT_JS_UI, /snap\.dist > SNAP_PX/);
  // backslashes in the emitted script's regexes must survive the template
  // literal it is written in, or the point parsing silently breaks
  assert.ok(CLIENT_JS_UI.includes('/\\s+/'));
  assert.ok(CLIENT_JS_UI.includes('-?\\d+\\.?\\d*'));
  // and the emitted page scripts still parse as javascript (a stray literal
  // newline in a string would kill every handler on the page at once)
  assert.doesNotThrow(() => new Function(CLIENT_JS_UI));
  assert.doesNotThrow(() => new Function(CLIENT_JS_SORT));
});

test('growth line reads out the running total', () => {
  const svg = growthLine([
    { startAt: 100, total: 2, newPlayers: 2, date: '1970-01-01', name: 'One' },
    { startAt: 200, total: 5, newPlayers: 3, date: '1970-01-01', name: 'Two' },
  ]);
  assert.match(svg, /distinct players ever \(5\)/);
  assert.match(svg, /data-y="5"/);
});

test('matchup matrix counts both sides of every reported game', () => {
  const games = [
    { wChar: 'Fox', lChar: 'Falco' }, { wChar: 'Fox', lChar: 'Falco' }, { wChar: 'Falco', lChar: 'Fox' },
    { wChar: 'Fox', lChar: 'Fox' }, { wChar: 'Marth', lChar: 'Fox' }, { wChar: 'Marth' },
  ];
  const m = matchupMatrix(games, 2);
  assert.deepEqual(m.chars, ['Fox', 'Falco']);
  assert.deepEqual(m.cells.Fox.Falco, { games: 3, wins: 2, winrate: 2 / 3 });
  assert.deepEqual(m.cells.Falco.Fox, { games: 3, wins: 1, winrate: 1 / 3 });
  // the mirror game counts both sides, so it lands at 50% by construction
  assert.deepEqual(m.cells.Fox.Fox, { games: 2, wins: 1, winrate: 0.5 });
  assert.equal(m.cells.Marth, undefined);
});

test('only games with both characters reported enter the matrix', () => {
  const games = [
    { wChar: 'Fox', lChar: 'Falco' }, { wChar: 'Falco', lChar: 'Fox' }, { wChar: 'Fox', lChar: 'Falco' },
    { wChar: 'Fox' }, { lChar: 'Falco' }, { wChar: 'Fox', lChar: '' }, {},
    { wChar: 'Marth', lChar: 'Fox' }, { wChar: 'Solo' },
  ];
  const m = matchupMatrix(games, { minGames: 1 });
  // the one-sided and empty games above count for nothing, not even toward a
  // character's game total, so Solo never even becomes a row or column
  assert.deepEqual(m.cells.Fox.Falco, { games: 3, wins: 2, winrate: 2 / 3 });
  assert.deepEqual(m.chars, ['Fox', 'Falco', 'Marth']);
  // every pair that met is in, however few games: Marth met Fox once
  assert.deepEqual(m.cells.Marth.Fox, { games: 1, wins: 1, winrate: 1 });
  assert.deepEqual(m.cells.Fox.Marth, { games: 1, wins: 0, winrate: 0 });
});

test('click popups can list plain names, not just tournament links', () => {
  const script = clientModal({
    'h:0': { title: 'Players with 1 event (2)', items: ['Ann — 1 event', 'Bo — 1 event'] },
    'p1:1': { title: 'Ann — 1 1st place', links: [{ n: 'Tourney', d: '2024-01-01', u: 'https://www.start.gg/tournament/x' }] },
  });
  // the names ride along in the popup data, and the popup renders items as
  // plain rows while links stay links (an entry has one or the other)
  assert.match(script, /Players with 1 event \(2\)/);
  assert.match(script, /Ann — 1 event/);
  assert.match(script, /info\.items/);
  assert.match(script, /info\.links/);
});

test('the matrix leaves Random Character out: it is a random pick, not a character', () => {
  const games = [
    { wChar: 'Random Character', lChar: 'Fox' }, { wChar: 'Fox', lChar: 'Random Character' },
    { wChar: 'Random Character', lChar: 'Random Character' }, { wChar: 'Fox', lChar: 'Falco' },
  ];
  const m = matchupMatrix(games, 15);
  assert.ok(!m.chars.includes('Random Character'));
  assert.equal(m.cells['Random Character'], undefined);
  assert.equal(m.cells.Fox['Random Character'], undefined);
  assert.deepEqual(m.cells.Fox.Falco, { games: 1, wins: 1, winrate: 1 });
});

test('the matrix can take every character at or above a game count instead of a top N', () => {
  const games = [
    ...Array.from({ length: 3 }, () => ({ wChar: 'Fox', lChar: 'Falco' })),
    { wChar: 'Marth', lChar: 'Fox' },
  ];
  // Fox 4 reported games, Falco 3, Marth 1: a top-2 slice and a 3+ cutoff agree here
  assert.deepEqual(matchupMatrix(games, 2).chars, ['Fox', 'Falco']);
  assert.deepEqual(matchupMatrix(games, { minGames: 3 }).chars, ['Fox', 'Falco']);
  assert.deepEqual(matchupMatrix(games, { minGames: 4 }).chars, ['Fox']);
});

test('matrix cells highlight their row and column on click', () => {
  // one delegated listener covers the matrix generated later in the browser too
  assert.match(CLIENT_JS_UI, /addEventListener\('click'/);
  assert.match(CLIENT_JS_UI, /closest\('\.matrix td'\)/);
  assert.match(CLIENT_JS_UI, /hl-line/);
  assert.match(CLIENT_JS_UI, /hl-cell/);
  // clicking the picked-out cell again clears the highlight
  assert.match(CLIENT_JS_UI, /wasCell/);
});

test('the full roster is the 86 Ultimate selections, start.gg spellings, no Random', () => {
  assert.equal(ULTIMATE_ROSTER.length, 86);
  assert.equal(new Set(ULTIMATE_ROSTER).size, 86);
  assert.ok(!ULTIMATE_ROSTER.includes('Random Character'));
  // the two nobody in the data has reported, plus the spellings start.gg uses
  for (const name of ['Toon Link', 'Min Min', 'Rosalina', 'Simon Belmont', 'Mr. Game & Watch', 'Pyra & Mythra']) assert.ok(ULTIMATE_ROSTER.includes(name), name);
});

test('cross-series merges only players entered in every series, by player id', () => {
  const series = [
    { slug: 'a', entered: [{ id: '1', tag: 'Ann', events: 10 }, { id: '2', tag: 'Bo', events: 3 }, { id: 'name:X', tag: 'X', events: 9 }], winners: [{ id: '1', tag: 'Ann', wins: 2, podiums: 5 }] },
    { slug: 'b', entered: [{ id: '1', tag: 'Ann!', events: 4 }, { id: '3', tag: 'Cy', events: 7 }], winners: [{ id: '1', tag: 'Ann', wins: 1, podiums: 3 }] },
  ];
  const both = crossSeries(series);
  assert.equal(both.length, 1);
  assert.equal(both[0].id, '1');
  assert.equal(both[0].totalEvents, 14);
  assert.equal(both[0].totalWins, 3);
  assert.equal(both[0].totalPodiums, 8);
  assert.deepEqual(both[0].per, { a: { events: 10, wins: 2, podiums: 5 }, b: { events: 4, wins: 1, podiums: 3 } });
});
