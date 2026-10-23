import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscordAPIError, HTTPError } from 'discord.js';

// what someone is told when their command fails, and which start.gg failures get retried or stop the bot
const directory = mkdtempSync(join(tmpdir(), 'sama-errors-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { failureMessage } = await import('../src/commands/shared.js');
const { ApiError } = await import('../src/errors.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

// a discord.js error the way its REST client throws one
const discordError = (Kind, code) => Object.assign(Object.create(Kind.prototype), { code, message: 'from discord' });

test('a failed command says whether start.gg, slippi, discord or the bot itself went wrong', () => {
  const cases = [
    [new ApiError('start.gg', 'start.gg: Invalid authentication token', 401), 'start.gg turned down the bot\'s API token, so nothing from start.gg works until whoever runs the bot makes a new one.'],
    [new ApiError('start.gg', 'start.gg: HTTP 429', 429), 'start.gg is limiting how fast the bot can ask right now. Try again in a minute.'],
    [new ApiError('start.gg', 'start.gg didn\'t respond (timeout)'), 'start.gg didn\'t answer in time. Try again in a minute.'],
    [new ApiError('start.gg', 'start.gg: HTTP 502', 502), 'start.gg is having trouble right now. Try again in a few minutes.'],
    [new ApiError('start.gg', 'start.gg: Something went wrong', 200), 'Couldn\'t get that from start.gg right now. Try again in a minute.'],
    [new ApiError('Slippi', 'Slippi didn\'t respond (timeout)'), 'Slippi didn\'t answer in time. Try again in a minute.'],
    // slippi has no token, so a 401 from it isn't about start.gg's
    [new ApiError('Slippi', 'Slippi: HTTP 401', 401), 'Couldn\'t get that from Slippi right now. Try again in a minute.'],
    [discordError(DiscordAPIError, 50013), 'Discord says I\'m missing a permission for that. A server admin can check my role, in server settings and on this channel.'],
    [discordError(DiscordAPIError, 50001), 'Discord says I can\'t see what that needs. A server admin can check that my role can view this channel.'],
    [discordError(DiscordAPIError, 10007), 'That person isn\'t in this server anymore.'],
    [discordError(DiscordAPIError, 50035), 'Discord didn\'t let me do that just now. Try again in a minute.'],
    [discordError(HTTPError, undefined), 'Discord is having trouble right now. Try again in a few minutes.'],
    [new TypeError('Cannot read properties of undefined'), 'Something went wrong in the bot itself, not start.gg or Discord. It\'s in the bot\'s logs.'],
  ];
  for (const [err, message] of cases) assert.equal(failureMessage(err), message, err.message);
});

// start.gg answering with these statuses in turn, the last one for every request after
function answering(...statuses) {
  const seen = [];
  globalThis.fetch = async () => {
    const status = statuses[Math.min(seen.length, statuses.length - 1)];
    seen.push(status);
    if (status === 'down') throw new Error('fetch failed');
    if (status === 'errors') return { ok: true, status: 200, json: async () => ({ errors: [{ message: 'complexity too high' }] }) };
    return { ok: status === 200, status, json: async () => (status === 200 ? { data: { currentUser: { id: 1 } } } : { message: 'Invalid authentication token' }) };
  };
  return seen;
}

test('once start.gg has been down 2 minutes, commands hear so right away, one a minute still checks, and an answer ends it', async (t) => {
  startgg.resetOutage();
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000 });
  const command = () => startgg.asCommand(() => startgg.checkToken()).catch((err) => err);
  const seen = answering('down');

  // one request that timed out three times is a bad moment, not an outage
  await command();
  assert.equal(seen.length, 3);
  assert.equal(startgg.startggDownSince(), null);
  assert.equal(failureMessage(await command()), 'start.gg didn\'t answer in time. Try again in a minute.');

  t.mock.timers.tick(2 * 60 * 1000);
  assert.equal(startgg.startggDownSince(), 1_000_000);
  // the first command after goes through to check, the next doesn't wait on start.gg at all
  const before = seen.length;
  await command();
  assert.equal(seen.length, before + 1);
  const skipped = await command();
  assert.equal(seen.length, before + 1);
  assert.equal(failureMessage(skipped), 'start.gg has been down since <t:1000000:R>, so anything that needs it can\'t run right now. The bot is fine and picks back up on its own once start.gg answers. `/status` shows if it\'s still down.');
  // background checks keep asking
  await startgg.inBackground(() => startgg.checkToken()).catch(() => null);
  assert.equal(seen.length, before + 4);

  // a minute on, a command checks again, and start.gg answering ends it for everyone
  t.mock.timers.tick(60 * 1000);
  answering(200);
  assert.equal(await command(), undefined);
  assert.equal(startgg.startggDownSince(), null);
  assert.equal(await command(), undefined);

  // a refused token is start.gg answering, so it ends an outage the same as a good answer
  answering('down', 'down', 'down', 401);
  await command();
  t.mock.timers.tick(3 * 60 * 1000);
  await command();
  assert.equal(startgg.startggDownSince(), null);
  startgg.resetOutage();
});

test('a 5xx from start.gg gets the same 2 retries as a timeout, and a refused token gets none', async () => {
  const recovered = answering(502, 503, 200);
  await startgg.checkToken();
  assert.deepEqual(recovered, [502, 503, 200]);

  const down = answering(503);
  const failed = await startgg.checkToken().catch((err) => err);
  assert.deepEqual(down, [503, 503, 503]);
  assert.ok(failed instanceof ApiError);
  assert.equal(failed.status, 503);
  assert.equal(startgg.badToken(failed), false);

  const unreachable = answering('down');
  const timedOut = await startgg.checkToken().catch((err) => err);
  assert.equal(unreachable.length, 3);
  assert.equal(timedOut.status, null);
  assert.equal(startgg.badToken(timedOut), false);

  // the only failure startup quits over
  const refused = answering(401);
  const token = await startgg.checkToken().catch((err) => err);
  assert.deepEqual(refused, [401]);
  assert.equal(token.message, 'start.gg: Invalid authentication token');
  assert.equal(startgg.badToken(token), true);

  // a graphql error keeps start.gg's message, which the page splitting looks for
  answering('errors');
  const rejected = await startgg.checkToken().catch((err) => err);
  assert.equal(rejected.message, 'start.gg: complexity too high');
  assert.equal(rejected.source, 'start.gg');
});
