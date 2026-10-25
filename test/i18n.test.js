import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-i18n-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commandsFor, count, language, languagesInUse, listOf, ordinal, permissionList, t } = await import('../src/i18n.js');
const { commands } = await import('../src/commands/definitions.js');
const { handleCommand } = await import('../src/commands/index.js');
const { help } = await import('../src/embeds/system.js');
after(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
  state.messages = {};
});

test('english is the default, and the saved server language picks what t says', () => {
  assert.equal(language(), 'en');
  assert.equal(t('Stats'), 'Stats');
  state.messages = { language: 'es' };
  assert.equal(language(), 'es');
  assert.equal(t('Stats'), 'Estadísticas');
  assert.equal(t`Stopped tracking ${'Sam'}.`, 'Dejé de seguir a Sam.');
  // anything saved that isn't a language reads as english
  state.messages = { language: 'fr' };
  assert.equal(language(), 'en');
});

test('a value can land anywhere in the spanish, and a line with no spanish stays english', () => {
  state.messages = { language: 'es' };
  assert.equal(t`${'Crew'}'s progress`, 'Progreso de Crew');
  assert.equal(t('not a line the bot has'), 'not a line the bot has');
  // a value that looks like a placeholder goes in as it is
  assert.equal(t`Linked to ${'{1}'}`, 'Vinculado a {1}');
});

test('a context tells two spanish lines apart and never shows in english', () => {
  assert.equal(t`[tournament] Stopped tracking ${'Genesis'}.`, 'Stopped tracking Genesis.');
  state.messages = { language: 'es' };
  assert.equal(t`[tournament] Stopped tracking ${'Genesis'}.`, 'Dejé de seguir Genesis.');
  assert.equal(t`Stopped tracking ${'Sam'}.`, 'Dejé de seguir a Sam.');
});

test('counts, ordinals, lists and permission names follow the language', () => {
  assert.equal(count(1, 'singles set'), '1 singles set');
  assert.equal(ordinal(3), '3rd');
  assert.equal(listOf(['a', 'b', 'c']), 'a, b, and c');
  assert.equal(permissionList(['View Channel', 'Embed Links']), 'View Channel and Embed Links');
  state.messages = { language: 'es' };
  assert.equal(count(1, 'singles set'), '1 set de singles');
  assert.equal(count(2, 'singles set'), '2 sets de singles');
  assert.equal(count(2, 'DQ'), '2 DQs');
  assert.equal(ordinal(3), '3.º');
  assert.equal(listOf(['a', 'b', 'c']), 'a, b y c');
  assert.equal(permissionList(['View Channel', 'Embed Links']), 'Ver canal e Insertar enlaces');
});

test('the spanish commands fit discord, keep their names and leave the definitions alone', () => {
  for (const lang of ['en', 'es']) {
    for (const command of commandsFor(commands, lang)) {
      let size = 0;
      const walk = (item) => {
        if (item.description !== undefined) {
          for (const text of [item.description, ...Object.values(item.description_localizations)]) {
            assert.ok(text.length >= 1 && text.length <= 100, `${command.name}: ${text}`);
          }
          size += item.name.length + item.description.length;
        } else {
          // an Apps menu command shows its name, up to 32 characters
          for (const name of Object.values(item.name_localizations)) assert.ok(name.length <= 32, name);
        }
        for (const choice of item.choices ?? []) {
          for (const name of [choice.name, ...Object.values(choice.name_localizations)]) assert.ok(name.length <= 100, name);
          size += choice.name.length + String(choice.value).length;
        }
        (item.options ?? []).forEach(walk);
      };
      walk(command);
      assert.ok(size <= 4000, `${command.name} is ${size} characters in ${lang}`);
    }
  }
  const spanish = commandsFor(commands, 'es');
  assert.deepEqual(spanish.map((command) => command.name), commands.map((command) => command.name));
  const help = spanish.find((command) => command.name === 'help');
  assert.match(help.description, /Lista corta/);
  assert.equal(help.description_localizations['es-419'], help.description);
  assert.equal(commands.find((command) => command.name === 'help').description_localizations, undefined);
  // english keeps english descriptions, with spanish only for spanish discord clients
  const english = commandsFor(commands, 'en').find((command) => command.name === 'help');
  assert.match(english.description, /^Short command list/);
  assert.match(english.description_localizations['es-ES'], /Lista corta/);
  const apps = commandsFor(commands, 'en').filter((command) => !command.description);
  assert.deepEqual(apps.map((command) => command.name_localizations['es-ES']), ['H2H conmigo', 'Estudiar rival']);
});

// /t-o settings with language:, from someone with Manage Server on a server with no TO role yet
async function switchLanguage(lang, guild) {
  let reply;
  await handleCommand({
    commandName: 't-o', guild, user: { id: 'manager' },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.ManageGuild },
    options: {
      getSubcommandGroup: () => null, getSubcommand: () => 'settings', getBoolean: () => null, getInteger: () => null, getChannel: () => null,
      getString: (name) => (name === 'language' ? lang : null),
    },
    reply: async (result) => { reply = result; },
  });
  return reply;
}

test('switching the language answers in it and registers the commands in it, single-server', async () => {
  const registered = [];
  const guild = { commands: { set: async (list) => registered.push(list) } };
  const reply = await switchLanguage('es', guild);
  assert.equal(state.messages.language, 'es');
  assert.match(reply.content, /^\*\*Publicaciones automáticas\*\*/);
  assert.match(reply.content, /\*\*Idioma:\*\* Español/);
  assert.equal(registered.length, 1);
  assert.match(registered[0].find((command) => command.name === 'help').description, /Lista corta/);

  await switchLanguage('en', guild);
  assert.match(registered[1].find((command) => command.name === 'help').description, /^Short command list/);
});

test('a registration that fails after the switch only gets logged, since the language already saved', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const reply = await switchLanguage('es', { commands: { set: async () => { throw new Error('rate limited'); } } });
  assert.match(reply.content, /Idioma:\*\* Español/);
  assert.equal(state.messages.language, 'es');
  assert.match(logged.join('\n'), /registering the commands in the new language failed: rate limited/);
});

test('/help reads in spanish, short and full, within discord\'s card limit', () => {
  state.messages = { language: 'es' };
  assert.match(help(false)[0].data.description, /^\*\*Empieza aquí\*\*/);
  const full = help(true);
  assert.ok(full.every((card) => card.data.description.length <= 4096));
  assert.match(full[0].data.description, /^-# Página 1\/\d/);
  assert.ok(full.some((card) => /\*\*Vincularte\*\*/.test(card.data.description)));
  assert.ok(full.every((card) => !/\*\*Linking yourself\*\*|\*\*Player stats\*\*/.test(card.data.description)));
});

test('only the languages servers use get fun posts made ahead', () => {
  assert.deepEqual(languagesInUse(), ['en']);
  // a server on spanish has no use for english posts
  state.messages = { language: 'es' };
  assert.deepEqual(languagesInUse(), ['es']);
  state.messages = {};
  process.env.MULTI_GUILD = 'true';
  try {
    assert.deepEqual(languagesInUse(), ['en'], 'nobody joined yet');
    state.guilds = { one: { messages: { language: 'es' } }, two: { messages: {} } };
    assert.deepEqual(languagesInUse().sort(), ['en', 'es']);
    state.guilds = { one: { messages: { language: 'es' } } };
    assert.deepEqual(languagesInUse(), ['es']);
  } finally {
    delete process.env.MULTI_GUILD;
    state.guilds = {};
  }
});

test('an Undo pressed too late answers in the language at the press, not the one at startup', async () => {
  // players.js registers the unlink kind when it loads
  const { handleChoice } = await import('../src/commands/confirm.js');
  await import('../src/commands/players.js');
  let reply;
  const press = {
    customId: 'undo:unlink:x:me', user: { id: 'me' },
    update: async () => {},
    followUp: async (result) => { reply = result; },
  };
  state.messages = { language: 'es' };
  await handleChoice(press);
  assert.match(reply.content, /^Ya es tarde para deshacer/);
  state.messages = {};
  await handleChoice(press);
  assert.match(reply.content, /^Too late to undo/);
});
