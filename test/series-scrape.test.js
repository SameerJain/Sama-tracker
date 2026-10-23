import assert from 'node:assert/strict';
import test, { after } from 'node:test';

// the series scrapes go through the bot's start.gg queue, so a fake fetch answers them the way it answers the bot
const { getCharGames, getEvents } = await import('../series/shared/scrape.mjs');
const { setRequestGap } = await import('../src/startgg/queue.js');
setRequestGap(0);
const originalFetch = globalThis.fetch;
const originalToken = process.env.STARTGG_TOKEN;
after(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.STARTGG_TOKEN;
  else process.env.STARTGG_TOKEN = originalToken;
});

// a finished set where entrant 1 beat entrant 2, with one reported game
const setNode = (id) => ({
  id,
  winnerId: 1,
  slots: [1, 2].map((entrant) => ({
    entrant: { id: entrant, participants: [{ player: { id: entrant * 10, gamerTag: `P${entrant}` } }] },
    standing: { stats: { score: { value: entrant === 1 ? 2 : 0 } } },
  })),
  games: [{ winnerId: 1, selections: [{ entrant: { id: 1 }, character: { name: 'Fox' } }, { entrant: { id: 2 }, character: { name: 'Falco' } }] }],
});

test('the scrape pages through an event, and a page start.gg calls too complex comes back as smaller pages', async () => {
  process.env.STARTGG_TOKEN = 'test-token';
  const asked = [];
  globalThis.fetch = async (_url, options) => {
    const { variables } = JSON.parse(options.body);
    asked.push(`${variables.page}x${variables.perPage}`);
    const reply = (data) => ({ ok: true, status: 200, json: async () => data });
    // 25 sets in all, 10 a page. page 2 at 10 is too much, so it goes as two pages of 5
    if (variables.perPage === 10 && variables.page === 2) {
      return reply({ errors: [{ message: 'Your query complexity is too high. A maximum of 1000 objects may be returned by each request.' }] });
    }
    const first = (variables.page - 1) * variables.perPage;
    const ids = Array.from({ length: variables.perPage }, (_, i) => first + i + 1).filter((id) => id <= 25);
    return reply({ data: { event: { sets: { pageInfo: { totalPages: Math.ceil(25 / variables.perPage) }, nodes: ids.map(setNode) } } } });
  };
  const result = await getCharGames(77, 10);
  assert.equal(result.totalSets, 25);
  assert.deepEqual(result.sets.map((set) => Number(set.id)), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.deepEqual(asked.toSorted(), ['1x10', '2x10', '3x10', '3x5', '4x5'].toSorted());
  assert.equal(result.games.length, 25);
  assert.deepEqual(result.sets[0], { id: '1', wPlayers: [{ id: 10, tag: 'P1' }], lPlayers: [{ id: 20, tag: 'P2' }], wScore: 2, lScore: 0, dq: false });
});

test('the scrape says the token is missing instead of sending a request start.gg would turn down', async () => {
  delete process.env.STARTGG_TOKEN;
  globalThis.fetch = async () => assert.fail('nothing should be sent');
  await assert.rejects(getEvents(1), /missing STARTGG_TOKEN/);
  await assert.rejects(getCharGames(1), /missing STARTGG_TOKEN/);
});
