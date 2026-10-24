// lists every line the bot says in src that has no spanish yet, and spanish nothing says anymore:
//   node scripts/spanish.js
// test/i18n.test.js runs the same check. the keys are what t`` in src/i18n.js looks up: the english, with
// {0}, {1} where the ${} values go
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

// a string or template literal's text with its escapes applied, the way t receives it
const cook = (literal) => new Function(`return ${literal};`)();

function skipString(source, i) {
  const quote = source[i];
  i += 1;
  while (source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
  return i + 1;
}

// past the } that closes a ${, through any strings or templates inside it
function skipExpression(source, i) {
  let depth = 0;
  for (;;) {
    const c = source[i];
    if (c === '\'' || c === '"') i = skipString(source, i);
    else if (c === '`') i = readTemplate(source, i).end;
    else if (c === '{') {
      depth += 1;
      i += 1;
    } else if (c === '}') {
      if (!depth) return i + 1;
      depth -= 1;
      i += 1;
    } else {
      i += 1;
    }
  }
}

// a template literal from its opening backtick: the text between its ${}s, and where it ends
function readTemplate(source, start) {
  const parts = [];
  let raw = '';
  let i = start + 1;
  while (source[i] !== '`') {
    if (source[i] === '\\') {
      raw += source.slice(i, i + 2);
      i += 2;
    } else if (source[i] === '$' && source[i + 1] === '{') {
      parts.push(raw);
      raw = '';
      i = skipExpression(source, i + 2);
    } else {
      raw += source[i];
      i += 1;
    }
  }
  parts.push(raw);
  return { parts: parts.map((part) => cook(`\`${part}\``)), end: i + 1 };
}

// past one argument of a call, to the comma or ) after it
function skipArgument(source, i) {
  let depth = 0;
  for (;;) {
    const c = source[i];
    if (c === '\'' || c === '"') i = skipString(source, i);
    else if (c === '`') i = readTemplate(source, i).end;
    else if ('([{'.includes(c)) {
      depth += 1;
      i += 1;
    } else if (')]}'.includes(c)) {
      if (!depth) return i;
      depth -= 1;
      i += 1;
    } else if (c === ',' && !depth) {
      return i;
    } else {
      i += 1;
    }
  }
}

// the string literal starting at i, past any spaces, or null when the argument is anything else
function literalAt(source, i) {
  while (/\s/.test(source[i])) i += 1;
  if (source[i] !== '\'' && source[i] !== '"') return null;
  return cook(source.slice(i, skipString(source, i)));
}

// every key a t`` or t('') in this source looks up
export function keysIn(source) {
  const keys = [];
  // not the t in don't` at the end of a template
  for (const match of source.matchAll(/(?<![\w$.'\\])t(?=[`(])/g)) {
    const at = match.index + 1;
    if (source[at] === '`') {
      keys.push(readTemplate(source, at).parts.reduce((text, part, i) => `${text}{${i - 1}}${part}`));
    } else {
      const literal = literalAt(source, at + 1);
      if (literal !== null) keys.push(literal);
    }
  }
  return keys;
}

// t(NOT_LINKED) or t(WARNINGS[i]) looks up text kept in a constant, so every line in its value counts. only names
// in caps, the way the code names constants, and only ones made in the same file
export function constantKeysIn(source) {
  const keys = [];
  const names = new Set([...source.matchAll(/(?<![\w$.'\\])t\(([A-Z][A-Z0-9_]*)\b/g)].map((match) => match[1]));
  for (const name of names) {
    const at = source.search(new RegExp(`\\bconst ${name}\\s*=`));
    if (at === -1) continue;
    const start = source.indexOf('=', at) + 1;
    let end = start;
    // to the ; that ends the declaration, past any strings with one in them
    while (source[end] !== ';') {
      if ('\'"`'.includes(source[end])) end = source[end] === '`' ? readTemplate(source, end).end : skipString(source, end);
      else end += 1;
    }
    for (let i = start; i < end;) {
      if (source[i] === '\'' || source[i] === '"') {
        const close = skipString(source, i);
        keys.push(cook(source.slice(i, close)));
        i = close;
      } else {
        i += 1;
      }
    }
  }
  return keys;
}

// every word a count(n, 'word') in this source needs a spanish singular and plural for
export function nounsIn(source) {
  const words = [];
  for (const match of source.matchAll(/(?<![\w$.])count\(/g)) {
    const comma = skipArgument(source, match.index + match[0].length);
    if (source[comma] !== ',') continue;
    const word = literalAt(source, comma + 1);
    if (word !== null) words.push(word);
  }
  return words;
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : sourceFiles(path);
    return entry.name.endsWith('.js') && entry.name !== 'i18n.js' ? [path] : [];
  });
}

// every key and noun in src, by the file it's in
export function scan() {
  return sourceFiles(SRC).map((path) => {
    const source = readFileSync(path, 'utf8');
    return { file: relative(ROOT, path).replaceAll('\\', '/'), keys: [...keysIn(source), ...constantKeysIn(source)], nouns: nounsIn(source) };
  });
}

// what's missing, what's unused, and spanish that adds a value the english doesn't have. dynamic is the keys
// t gets from a variable, like the /t-o settings labels, which no t`` in src spells out
export function check(es, nouns, dynamic = []) {
  const files = scan();
  const used = new Set([...files.flatMap(({ keys }) => keys), ...dynamic]);
  const missing = files.flatMap(({ file, keys }) => keys.filter((key) => !Object.hasOwn(es, key)).map((key) => `${file}: ${key}`));
  missing.push(...dynamic.filter((key) => !Object.hasOwn(es, key)).map((key) => `(dynamic): ${key}`));
  const missingNouns = files.flatMap(({ file, nouns: words }) => words.filter((word) => !Object.hasOwn(nouns, word)).map((word) => `${file}: ${word}`));
  const usedNouns = new Set(files.flatMap(({ nouns: words }) => words));
  const unused = [
    ...Object.keys(es).filter((key) => !used.has(key)),
    ...Object.keys(nouns).filter((word) => !usedNouns.has(word)).map((word) => `noun: ${word}`),
  ];
  const placeholders = (text) => new Set(text.match(/\{\d+\}/g) ?? []);
  const extra = Object.entries(es).filter(([key, text]) => [...placeholders(text)].some((each) => !placeholders(key).has(each))).map(([key]) => key);
  return { missing: [...new Set(missing)], missingNouns: [...new Set(missingNouns)], unused, extra };
}

// what t and commandsFor get from variables: every description and choice in the commands, the Apps menu
// names, the /t-o settings labels, discord's permission names, the fun commands' lines and the Bills post titles.
// the multi-server commands, which have everything the single-server ones do
export async function dynamicKeys() {
  const { commands } = await import('../src/commands/definitions.js');
  const { MESSAGE_TYPES, THREAD_MODES, WEEKDAYS } = await import('../src/message-settings.js');
  const { POSTING_PERMISSIONS, THREAD_PERMISSIONS } = await import('../src/tracker/shared.js');
  const { funCommands } = await import('../src/fun/index.js');
  const { TITLES } = await import('../src/fun/bills.js');
  const keys = [];
  const walk = (item) => {
    keys.push(item.description ?? item.name);
    for (const choice of item.choices ?? []) keys.push(choice.name);
    for (const option of item.options ?? []) walk(option);
  };
  commands.forEach(walk);
  return [...new Set([
    ...keys, ...Object.values(MESSAGE_TYPES), ...Object.values(THREAD_MODES), ...WEEKDAYS,
    ...Object.values(POSTING_PERMISSIONS), ...Object.values(THREAD_PERMISSIONS),
    ...Object.values(funCommands).map((fun) => fun.line), ...TITLES,
  ])];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // the commands file reads these at import. multi-server has every command and option single-server does
  process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'sama-spanish-'));
  process.env.MULTI_GUILD = 'true';
  // the fun commands would start making posts with claude
  delete process.env.ANTHROPIC_API_KEY;
  const { es, nouns } = await import('../src/i18n/es.js');
  const { missing, missingNouns, unused, extra } = check(es, nouns, await dynamicKeys());
  const show = (title, list) => list.length && console.log(`${title} (${list.length}):\n${list.map((line) => `  ${line}`).join('\n')}\n`);
  show('No spanish yet', missing);
  show('No spanish count() word yet', missingNouns);
  show('Spanish nothing uses', unused);
  show('Spanish with a {n} the english lacks', extra);
  if (!missing.length && !missingNouns.length && !unused.length && !extra.length) console.log('Everything has spanish.');
}
