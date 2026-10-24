import { state } from './store.js';
import { count as englishCount, ordinal as englishOrdinal } from './format.js';
import { es, nouns } from './i18n/es.js';

// what /t-o settings language offers. english is the key everything else is looked up by, so the code reads
// in english and a line with no translation yet still says something
export const LANGUAGES = { en: 'English', es: 'Español' };
const LOCALES = { en: 'en-US', es: 'es' };

// the server's language, per server in a multi-server build since state is
export function language() {
  return Object.hasOwn(LANGUAGES, state.messages?.language) ? state.messages.language : 'en';
}

export const locale = () => LOCALES[language()];

// english plus every language a server has picked, for the fun posts made ahead at startup outside any server
export function languagesInUse() {
  const picked = [state.messages?.language, ...Object.values(state.guilds ?? {}).map((guild) => guild?.messages?.language)];
  return ['en', ...new Set(picked.filter((lang) => lang !== 'en' && Object.hasOwn(LANGUAGES, lang)))];
}

// the same english can need two spanish lines: people take a personal "a" and tournaments don't. a key that starts
// with a context like [tournament] gets its own spanish, and the context comes off the english
const CONTEXT = /^\[\w+\] /;

// t`Tracking ${name}.` looks up 'Tracking {0}.' and puts the values back in, wherever the translation moved them
export function t(parts, ...values) {
  const key = typeof parts === 'string' ? parts : parts.reduce((text, part, i) => `${text}{${i - 1}}${part}`);
  const english = key.replace(CONTEXT, '');
  const text = language() === 'es' ? es[key] ?? english : english;
  return values.length ? text.replace(/\{(\d+)\}/g, (_, i) => values[i]) : text;
}

// count(3, 'set') is 3 sets, or the word's spanish pair from nouns
export function count(n, word, plural) {
  if (language() !== 'es') return englishCount(n, word, plural);
  const [one, many] = nouns[word] ?? [word, plural ?? `${word}s`];
  return `${n} ${n === 1 ? one : many}`;
}

// 3rd, or 3.º
export const ordinal = (n) => (language() === 'es' ? `${n}.º` : englishOrdinal(n));

// a, b and c, or a, b y c
export const listOf = (items) => new Intl.ListFormat(locale()).format(items);

// discord's permission names, the way its settings show them in the server's language
export const permissionList = (names) => listOf(names.map((name) => t(name)));

// spanish discord clients see these on the commands. the rest see the base, see commandsFor
const DISCORD_SPANISH = ['es-ES', 'es-419'];

// the commands with spanish next to every description and choice. lang picks the base one, which every
// other discord language shows: a single-server build registers the server's own language, so switching
// it switches the descriptions. names stay english, since they're what the handlers and /help go by,
// except the Apps menu ones, which are only ever read
export function commandsFor(commands, lang = 'en') {
  const spanish = (text) => es[text] ?? text;
  const localize = (text) => Object.fromEntries(DISCORD_SPANISH.map((code) => [code, spanish(text)]));
  const base = (text) => (lang === 'es' ? spanish(text) : text);
  const walk = (item) => {
    const copy = { ...item };
    if (item.description) {
      copy.description = base(item.description);
      copy.description_localizations = localize(item.description);
    } else {
      // an Apps menu command, which has no description
      copy.name_localizations = localize(item.name);
    }
    if (item.choices) {
      copy.choices = item.choices.map((choice) => ({ ...choice, name: base(choice.name), name_localizations: localize(choice.name) }));
    }
    if (item.options) copy.options = item.options.map(walk);
    return copy;
  };
  return commands.map(walk);
}
