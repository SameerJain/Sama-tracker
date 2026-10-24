import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'sama-language-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
delete process.env.MULTI_GUILD;
const { state, save } = await import('../src/store.js');
after(() => rmSync(directory, { recursive: true, force: true }));

// a new process on the same state folder, the way a new railway deploy starts on the volume
function startAgain() {
  const script = `
    const { registeredCommands } = await import('./src/commands/index.js');
    const { language } = await import('./src/i18n.js');
    const help = registeredCommands().find((command) => command.name === 'help');
    console.log(JSON.stringify({ language: language(), help: help.description }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, STATE_DIR: directory },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').at(-1));
}

test('the language a TO picks is saved, so the next deploy starts in it and registers the commands in it', () => {
  state.messages = { ...state.messages, sets: false, language: 'es' };
  save();
  const after = startAgain();
  assert.equal(after.language, 'es');
  assert.match(after.help, /^Lista corta/);

  state.messages = { ...state.messages, language: 'en' };
  save();
  const back = startAgain();
  assert.equal(back.language, 'en');
  assert.match(back.help, /^Short command list/);
});
