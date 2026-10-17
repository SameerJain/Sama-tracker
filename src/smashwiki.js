// ssbwiki.com, for the joke posts: screenshots to go with them, and article excerpts for haiku to riff on
const API = 'https://www.ssbwiki.com/api.php';
// a couple of paragraphs, enough real facts for a post without it wandering off topic
const EXCERPT_CHARS = 1200;
const EXCERPT_MAX = 1800;
// anything shorter is a leftover heading, caption or "see here" link
const MIN_PARAGRAPH = 80;
// "Fox (フォックス, Fox)". haiku can't use the japanese and it eats into the excerpt
const JAPANESE = /\s*\([^()]*[぀-ヿ㐀-鿿＀-￯][^()]*\)/g;

export async function wiki(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Sama-tracker' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`SmashWiki returned ${res.status}`);
  return res;
}

async function query(params) {
  return (await wiki(`${API}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params })}`)).json();
}

// lists come 500 at a time
async function everyPage(params, read) {
  const results = [];
  let next = {};
  while (next) {
    const data = await query({ ...params, ...next });
    results.push(...read(data.query ?? {}));
    next = data.continue;
  }
  return results;
}

export function fetchScreenshots(category) {
  return everyPage({ generator: 'categorymembers', gcmtitle: `Category:${category}`, gcmtype: 'file', gcmlimit: '500', prop: 'imageinfo', iiprop: 'url' }, ({ pages = [] }) => pages
    .filter((page) => page.imageinfo?.[0])
    // "File:Animal_Crossing_Stage_SSB4.jpg" -> "Animal Crossing Stage SSB4"
    .map((page) => ({ name: page.title.replace(/^File:/, '').replace(/\.\w+$/, '').replaceAll('_', ' '), url: page.imageinfo[0].url, page: page.imageinfo[0].descriptionurl })));
}

// a patch's notes are a template like "Template:UpdateList (SSBU)/13.0.1". the ones with a fighter
// after the version are hitbox tables with no words in them
const PATCH = /^Template:UpdateList[^/]*\/(\d+(?:\.\d+)+)$/;

// articles and patch notes, not files, subcategories or disambiguation pages
export async function categoryPages(category) {
  const titles = await everyPage({ list: 'categorymembers', cmtitle: `Category:${category}`, cmtype: 'page', cmlimit: '500' }, ({ categorymembers = [] }) => categorymembers.map((page) => page.title));
  return titles.filter((title) => (title.startsWith('Template:') ? PATCH.test(title) : !title.endsWith('(disambiguation)')));
}

// { about, text } for the post, or null if there's nothing worth saying in it.
// focus matches paragraphs about the right game, see excerpt
export async function articleExcerpt(title, focus) {
  const version = title.match(PATCH)?.[1];
  if (version) {
    const notes = patchNotes(await wikitext(title));
    return notes && { about: `the version ${version} patch notes`, text: notes };
  }
  const { query: found } = await query({ prop: 'extracts', explaintext: '1', titles: title, redirects: '1' });
  const text = found?.pages?.[0]?.extract && excerpt(found.pages[0].extract, { focus });
  return text && { about: `the "${title}" article`, text };
}

async function wikitext(title) {
  const params = new URLSearchParams({ action: 'parse', format: 'json', formatversion: '2', prop: 'wikitext', page: title });
  return (await (await wiki(`${API}?${params}`)).json()).parse?.wikitext ?? '';
}

const CHANGES = { buff: 'Buff', nerf: 'Nerf', change: 'Change', bugfix: 'Bug fix', newbug: 'New bug' };

// one fighter's changes, out of a {{#switch}} with a "|Fighter=" section of bullets each
export function patchNotes(source, random = Math.random) {
  const sections = [...source.matchAll(/^\|([^=\n|{}]+)=\s*((?:\*.*(?:\n|$))+)/gm)];
  if (!sections.length) return null;
  const [, fighter, bullets] = sections[Math.floor(random() * sections.length)];
  const lines = bullets.split('\n').map((line) => plain(line.replace(/^\*+/, ''))).filter(Boolean);
  return clip(`${fighter.trim()}:\n${lines.join('\n')}`, EXCERPT_MAX);
}

// wiki markup down to the words. templates keep their first part, which for {{buff|...}} is the sentence.
// smash 4's sometimes have the old and new numbers after it
function plain(markup) {
  let text = markup.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').replace(/<[^>]+>/g, ' ');
  // innermost first, since they nest
  for (let before; before !== text;) {
    before = text;
    text = text.replace(/\{\{([^{}|]+)(?:\|([^{}]*))?\}\}/g, (_, name, args = '') => {
      const kind = CHANGES[name.trim().toLowerCase()];
      const [first] = args.split('|');
      return kind ? `${kind}: ${first}` : first;
    });
  }
  return text.replace(/\s+/g, ' ').trim();
}

// a run of paragraphs from a random spot, after the article's first line so it's clear what it's about.
// tournaments and techniques cover several games, so it starts at one that matches focus if any do.
// random is there so tests can pick the spot
export function excerpt(text, { focus, random = Math.random } = {}) {
  const lines = text.replace(JAPANESE, '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const paragraphs = lines.filter((line) => line.length >= MIN_PARAGRAPH);
  if (!paragraphs.length) return null;

  const about = paragraphs.flatMap((paragraph, i) => (focus?.test(paragraph) ? [i] : []));
  const spots = about.length ? about : paragraphs.map((_, i) => i);
  // forward from the spot, then back from it if that hit the end first
  let start = spots[Math.floor(random() * spots.length)];
  let end = start;
  let size = 0;
  while (size < EXCERPT_CHARS && (end < paragraphs.length || start > 0)) {
    size += end < paragraphs.length ? paragraphs[end++].length : paragraphs[--start].length;
  }
  const picked = paragraphs.slice(start, end);
  if (picked[0] !== lines[0]) picked.unshift(lines[0].slice(0, sentenceEnds(lines[0])[0]));
  return clip(picked.join('\n'), EXCERPT_MAX);
}

// where sentences end. "Super Smash Bros." is in half the first lines and isn't one
function sentenceEnds(text) {
  return [...text.matchAll(/[.!?](?=\s|$)/g)]
    .map((match) => match.index + 1)
    .filter((end) => !/\b(Bros|Mr|Dr|Jr|St|vs|Ver|No)\.$/.test(text.slice(Math.max(0, end - 6), end)));
}

// cut at the last full sentence that fits
function clip(text, max) {
  if (text.length <= max) return text;
  const end = sentenceEnds(text).filter((each) => each <= max).at(-1) ?? 0;
  return end > max / 2 ? text.slice(0, end) : `${text.slice(0, text.lastIndexOf(' ', max))}…`;
}
