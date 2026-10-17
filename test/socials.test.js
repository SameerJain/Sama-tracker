import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-socials-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
// the jokes would call claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleAutocomplete, handleCommand } = await import('../src/commands/index.js');
after(() => rmSync(directory, { recursive: true, force: true }));

async function run(commandName, subcommand, values = {}) {
  let reply;
  await handleCommand({
    commandName,
    options: { getSubcommand: () => subcommand, getString: name => values[name] ?? null },
    reply: async result => { reply = result; },
  });
  return reply;
}

const add = (name, link) => run('socials_edit', 'add', { name, link });
const remove = link => run('socials_edit', 'remove', { link });
const shown = async () => (await run('socials', null)).embeds[0].data.description;

test('socials runs on its own and editing is for server managers by default', () => {
  assert.equal(commands.find(c => c.name === 'socials')?.options, undefined);
  const edit = commands.find(c => c.name === 'socials_edit');
  assert.equal(edit?.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
  assert.deepEqual(edit.options.map(o => o.name), ['add', 'remove']);
});

test('an empty list says how to add a link', async () => {
  state.socials = [];
  assert.match(await shown(), /\/socials_edit add/);
});

test('links save without https and share a line under the first spelling of a name', async () => {
  state.socials = [];
  await add('716 Esports', 'x.com/716esports');
  await add('716 esports', 'https://www.twitch.tv/716esports');
  await add('abbrchive', 'https://www.youtube.com/@abbrchive/featured');

  const saved = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).socials;
  assert.deepEqual(saved, [
    { name: '716 Esports', url: 'https://x.com/716esports' },
    { name: '716 Esports', url: 'https://www.twitch.tv/716esports' },
    { name: 'abbrchive', url: 'https://www.youtube.com/@abbrchive/featured' },
  ]);
  assert.equal(await shown(), [
    '**716 Esports** · [X](https://x.com/716esports) · [Twitch](https://www.twitch.tv/716esports)',
    '**abbrchive** · [YouTube](https://www.youtube.com/@abbrchive/featured)',
  ].join('\n'));
});

test('other sites show the whole link and names cannot add formatting', async () => {
  state.socials = [];
  await add('Winters_HQ*', 'winters.example/stream');
  await add('Parens', 'example.com/a(b)');
  assert.equal(await shown(), [
    '**Winters\\_HQ\\*** · https://winters.example/stream',
    '**Parens** · https://example.com/a%28b%29',
  ].join('\n'));
});

test('non-links, disguised hosts, duplicates and overlong links are refused without saving', async () => {
  state.socials = [{ name: '716 Esports', url: 'https://x.com/716esports' }];
  for (const link of ['not a link', 'localhost', 'javascript:alert(1)', 'https://twitch.tv@evil.example', 'x.com/716esports', `x.com/${'a'.repeat(100)}`]) {
    const reply = await add('Someone', link);
    assert.ok(reply.flags, link);
    assert.doesNotMatch(reply.content, /^Added/, link);
  }
  assert.equal(state.socials.length, 1);
});

test('follow-ups stay private when the reply was', async () => {
  state.socials = Array.from({ length: 120 }, (_, i) => ({ name: `Stream team number ${i} ${'x'.repeat(40)}`, url: `https://twitch.tv/team${i}` }));
  for (const ephemeral of [true, false]) {
    const followUps = [];
    await handleCommand({
      commandName: 'socials', ephemeral,
      options: { getSubcommand: () => null },
      reply: async () => {}, followUp: async r => followUps.push(r),
    });
    assert.ok(followUps.length > 0);
    for (const followUp of followUps) assert.equal(Boolean(followUp.flags), ephemeral);
  }
});

test('remove autocompletes by name or link and accepts a typed link', async () => {
  state.socials = [
    { name: '716 Esports', url: 'https://x.com/716esports' },
    { name: 'Winters HQ', url: 'https://twitch.tv/wintershq' },
  ];
  let choices;
  await handleAutocomplete({
    commandName: 'socials_edit',
    options: { getSubcommand: () => 'remove', getFocused: () => 'Winter' },
    respond: async result => { choices = result; },
  });
  assert.deepEqual(choices, [{ name: 'Winters HQ · twitch.tv/wintershq', value: 'https://twitch.tv/wintershq' }]);

  await remove('https://twitch.tv/wintershq');
  await remove('x.com/716esports');
  assert.deepEqual(state.socials, []);
  assert.match((await remove('x.com/716esports')).content, /isn't in/);
});
