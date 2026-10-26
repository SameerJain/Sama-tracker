import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockApi } from './fixtures.js';

// someone in two servers the bot is in. a /link or a tracked discord in one used to mean nothing in the other,
// so /scout, /slippi rank, H2H with me and their /notify pings only worked in the server they linked in
const directory = mkdtempSync(join(tmpdir(), 'sama-cross-'));
process.env.STATE_DIR = directory;
process.env.MULTI_GUILD = 'true';
delete process.env.ANTHROPIC_API_KEY;
const { state, guildLocal, forGuild } = await import('../src/store.js');
const { verifiedCaller, findAccount, forgetParticipants } = await import('../src/accounts.js');
const { linkedPlayer } = await import('../src/commands/shared.js');
const { handleCommand } = await import('../src/commands/index.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const me = { userId: 7, playerId: 70, tag: 'Me', slug: 'user/me' };

// start.gg has this discord connected to user 7, or to nobody with null. participants is who's registered
// for any tournament it's asked about
function startgg7(discordId, participants = []) {
  const asked = [];
  mockApi(({ query }) => {
    asked.push(query);
    if (query.includes('participants(')) return { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: participants } } };
    if (query.includes('authorizations')) {
      const authorizations = discordId ? [{ externalId: discordId }] : [];
      return { u7: { slug: 'user/me', images: [], player: { gamerTag: 'Me' }, authorizations } };
    }
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  return asked;
}

beforeEach(() => {
  for (const id of ['first', 'second']) Object.assign(forGuild(id), { players: {}, links: {}, accounts: {}, tournaments: {} });
  forgetParticipants();
});

test('a /link in one server finds you in the other, and that server\'s own link or tracking comes first', async () => {
  forGuild('first').links['me-discord'] = me;
  assert.equal(await guildLocal.run('second', () => linkedPlayer('me-discord')?.tag), 'Me');
  // tracked in the second server under their own entry, which has the second server's switches on it
  forGuild('second').players[7] = { ...me, tag: 'Me here', setResults: false };
  assert.equal(await guildLocal.run('second', () => linkedPlayer('me-discord')?.tag), 'Me here');
  // somebody else's discord never matches
  assert.equal(await guildLocal.run('second', () => linkedPlayer('someone-else')), undefined);
});

test('a tracked player with their discord on start.gg counts in a server that never tracked them', async () => {
  forGuild('first').players[7] = { ...me, discordId: 'me-discord' };
  assert.equal(await guildLocal.run('second', () => linkedPlayer('me-discord')?.userId), 7);
});

test('/scout\'s caller check takes a link from another server, but still asks start.gg', async () => {
  forGuild('first').links['me-discord'] = me;
  startgg7('me-discord');
  assert.equal((await guildLocal.run('second', () => verifiedCaller('me-discord')))?.tag, 'Me');
  // disconnected on start.gg since, so the old link stops counting everywhere at once
  startgg7(null);
  assert.equal(await guildLocal.run('second', () => verifiedCaller('me-discord')), null);
});

test('the account finder looks at every server\'s tracked tournaments, once each', async () => {
  const tournament = { id: 5, name: 'Local', slug: 'tournament/local', tracked: { by: 'manual', at: 0, posts: {} } };
  forGuild('first').tournaments[5] = tournament;
  forGuild('second').tournaments[5] = { ...tournament };
  const registered = [{ gamerTag: 'Me', user: { id: 7, slug: 'user/me', authorizations: [{ externalId: 'me-discord' }] } }];
  const asked = startgg7('me-discord', registered);
  // a third server tracks nothing, and still finds them
  const found = await guildLocal.run('third', () => findAccount('me-discord'));
  assert.equal(found?.userId, '7');
  assert.equal(asked.filter((query) => query.includes('participants(')).length, 1);
});

test('/unlink in a server you never linked in says where the link is from', async () => {
  forGuild('first').links['me-discord'] = me;
  let reply;
  await handleCommand({
    commandName: 'unlink', guildId: 'second', guild: { id: 'second' }, user: { id: 'me-discord' },
    options: { getSubcommandGroup: () => null, getSubcommand: () => null },
    reply: async (result) => { reply = result; },
  });
  assert.equal(reply.content, 'You aren\'t linked in this server, but commands here still find you as Me from another server the bot is in. `/unlink` there takes it off.');
  assert.ok(forGuild('first').links['me-discord'], 'the other server keeps its link');
});
