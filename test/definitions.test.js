import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// discord rejects the whole registration when one command breaks a limit,
// and nothing else checks definitions.js, so this fails before discord does
const directory = mkdtempSync(join(tmpdir(), 'sama-definitions-'));
process.env.STATE_DIR = directory;
delete process.env.ANTHROPIC_API_KEY;
const { commands } = await import('../src/commands/definitions.js');
after(() => rmSync(directory, { recursive: true, force: true }));

function walkOptions(options, visit) {
  for (const option of options ?? []) {
    visit(option);
    walkOptions(option.options, visit);
  }
}

test('slash commands fit discord limits', async () => {
  const slash = commands.filter((command) => command.type === undefined);
  // 100 total, user commands are separate
  assert.ok(slash.length <= 100, `too many commands: ${slash.length}`);
  assert.ok(slash.length > 30, `expected most commands, got ${slash.length}`);

  for (const command of slash) {
    assert.match(command.name, /^[a-z0-9_-]{1,32}$/, `bad command name: ${command.name}`);
    assert.ok(command.description.length <= 100, `long description: ${command.name}`);
    assert.ok((command.options?.length ?? 0) <= 25, `too many options: ${command.name}`);

    // required options come before optional ones, discord rejects the reverse. per level
    function checkLevel(options, where) {
      let seenOptional = false;
      for (const option of options ?? []) {
        if (option.required) assert.equal(seenOptional, false, `required after optional: ${where} ${option.name}`);
        else if (option.type !== 1 && option.type !== 2) seenOptional = true;
        checkLevel(option.options, `${where} ${option.name}`);
      }
    }
    checkLevel(command.options, command.name);

    walkOptions(command.options, (option) => {
      assert.match(option.name, /^[a-z0-9_-]{1,32}$/, `bad option name: ${command.name} ${option.name}`);
      assert.ok((option.description?.length ?? 0) <= 100, `long option description: ${command.name} ${option.name}`);
      assert.ok((option.choices?.length ?? 0) <= 25, `too many choices: ${command.name} ${option.name}`);
      for (const choice of option.choices ?? []) {
        assert.ok(choice.name.length <= 100, `long choice name: ${command.name} ${option.name} ${choice.name}`);
      }
    });

    // names, descriptions and choices under 4000 chars combined per command
    let chars = command.name.length + command.description.length;
    walkOptions(command.options, (option) => {
      chars += option.name.length + (option.description?.length ?? 0);
      for (const choice of option.choices ?? []) chars += choice.name.length + String(choice.value).length;
    });
    assert.ok(chars <= 4000, `too much text: ${command.name} has ${chars} chars`);
  }
});

test('user commands fit discord limits', async () => {
  const { ApplicationCommandType } = await import('discord.js');
  const user = commands.filter((command) => command.type === ApplicationCommandType.User);
  assert.ok(user.length <= 5, `too many user commands: ${user.length}`);
  for (const command of user) {
    // the name is what the menu shows, so capitals and spaces are fine
    assert.ok(command.name.length <= 100, `long user command name: ${command.name}`);
    assert.equal(command.description, undefined, `user commands take no description: ${command.name}`);
  }
});
