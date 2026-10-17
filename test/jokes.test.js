import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';

// the jokes would call claude on import
delete process.env.ANTHROPIC_API_KEY;
const { articleExcerpt, categoryPages, excerpt, patchNotes } = await import('../src/jokes/smashwiki.js');
const { searchVideos } = await import('../src/jokes/youtube.js');
const { jokeMessage, makeJoke } = await import('../src/jokes/joke.js');
const originalFetch = globalThis.fetch;
const originalError = console.error;
after(() => { globalThis.fetch = originalFetch; console.error = originalError; });
beforeEach(() => { delete process.env.YOUTUBE_API_KEY; });

const json = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data, arrayBuffer: async () => new ArrayBuffer(4) });
const paragraph = (words) => `${words} ${'and then some more words about it '.repeat(4)}`.trim();

test('an excerpt starts after the opening line, leaves out the japanese, and stops at a sentence', () => {
  const text = [
    'Fox (フォックス, Fox) is a playable starter character in Super Smash Bros. Melee. He is fast.',
    'Gallery',
    paragraph('Fox is ranked 1st.'),
    paragraph('Fox has a shine.'),
  ].join('\n');
  // picks the last paragraph, then has to go back for more
  const picked = excerpt(text, { random: () => 0.99 });
  assert.equal(picked.split('\n')[0], 'Fox is a playable starter character in Super Smash Bros. Melee.');
  assert.match(picked, /Fox is ranked 1st\..*\nFox has a shine\./s);
  assert.doesNotMatch(picked, /フォックス|Gallery/);

  assert.equal(excerpt('A stub.\nToo short to say anything.'), null);
  const long = excerpt(`Opening line.\n${Array.from({ length: 60 }, (_, i) => `Sentence ${i} is about Super Smash Bros. Melee and goes on.`).join(' ')}`, { random: () => 0 });
  assert.ok(long.length <= 1800);
  assert.match(long, /goes on\.$/);
});

test('focus starts the excerpt at a paragraph about the right game', () => {
  const long = (words) => `${words} ${'and the bracket went on from there. '.repeat(12)}`.trim();
  const text = ['Supernova was a tournament.', long('In Ultimate, Miya won.'), long('In Brawl, Player-1 won his first major.'), long('In doubles a team won.'), long('In Melee someone won.'), long('Then it ended.')].join('\n');
  for (const random of [() => 0, () => 0.99]) {
    assert.match(excerpt(text, { focus: /Brawl\b/, random }), /^Supernova was a tournament\.\nIn Brawl, Player-1 won/);
  }
  // nothing about it, so anywhere
  assert.match(excerpt(text, { focus: /Smash 64/, random: () => 0 }), /^Supernova was a tournament\.\nIn Ultimate/);
});

test('patch notes come out as one fighter\'s changes in plain words', () => {
  const ultimate = [
    '{{#switch: {{{char|Universal}}}',
    '|Ness=',
    '*{{buff|[[Up tilt]] deals more damage (7% → 9%).}}',
    '**{{nerf|However, the [[knockback|launch]] was \'\'\'overcompensated\'\'\'.}}',
    '|Luigi=',
    '}}',
  ].join('\n');
  assert.equal(patchNotes(ultimate, () => 0), 'Ness:\nBuff: Up tilt deals more damage (7% → 9%).\nNerf: However, the launch was overcompensated.');
  // smash 4's go on the same line and can have the numbers after the sentence
  const sm4sh = '{{#switch: {{{char|Universal}}}\n|Kirby=*{{buff|Down throw deals 3.6% more damage|6.6%|10.2%}}\n*{{change|Inhale looks different{{GameIcon|SSB4}}.}}\n}}';
  assert.equal(patchNotes(sm4sh, () => 0), 'Kirby:\nBuff: Down throw deals 3.6% more damage\nChange: Inhale looks differentSSB4.');
  assert.equal(patchNotes('{| class="wikitable"\n|Forward smash||1||2\n|}'), null);
});

test('category pages leave out disambiguations and patch templates with a fighter after the version', async () => {
  const pages = [['Fox (SSBM)', 'Annie (disambiguation)'], ['Template:UpdateList (SSBU)/13.0.1', 'Template:UpdateList/1.0.8/Mario', 'Template:Navbox']];
  const asked = [];
  globalThis.fetch = async (url) => {
    const params = new URL(url).searchParams;
    asked.push(params.get('cmcontinue'));
    const page = params.get('cmcontinue') ? 1 : 0;
    return json({ query: { categorymembers: pages[page].map((title) => ({ title })) }, ...(page === 0 && { continue: { cmcontinue: 'next' } }) });
  };
  assert.deepEqual(await categoryPages('Trophies (SSBM)'), ['Fox (SSBM)', 'Template:UpdateList (SSBU)/13.0.1']);
  assert.deepEqual(asked, [null, 'next']);
});

test('a patch title reads the template, and an article title its text', async () => {
  globalThis.fetch = async (url) => {
    const params = new URL(url).searchParams;
    if (params.get('action') === 'parse') return json({ parse: { wikitext: '{{#switch: x\n|Peach=\n*{{buff|Peach Bomber grabs edges longer.}}\n}}' } });
    return json({ query: { pages: [{ extract: `Wavedash is a technique.\n${paragraph('In Melee it slides.')}` }] } });
  };
  assert.deepEqual(await articleExcerpt('Template:UpdateList (SSBU)/13.0.1'), { about: 'the version 13.0.1 patch notes', text: 'Peach:\nBuff: Peach Bomber grabs edges longer.' });
  const article = await articleExcerpt('Wavedash');
  assert.equal(article.about, 'the "Wavedash" article');
  assert.match(article.text, /^Wavedash is a technique\.\nIn Melee it slides/);
});

test('youtube search fills in each video\'s description and views, and keeps the well known ones', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  const asked = [];
  globalThis.fetch = async (url) => {
    const { pathname, searchParams } = new URL(url);
    asked.push([pathname.split('/').pop(), searchParams.get('key'), searchParams.get('q') ?? searchParams.get('id')]);
    if (pathname.endsWith('/search')) return json({ items: [{ id: { videoId: 'a' } }, { id: { videoId: 'b' } }, { id: { kind: 'youtube#channel' } }] });
    return json({ items: [
      { snippet: { title: 'Armada vs Mango', channelTitle: 'VGBootCamp', publishedAt: '2014-06-01T00:00:00Z', description: 'Grand finals of Apex.\nhttps://twitter.com/vgbootcamp\n#melee #ssbm\n0:00 Game 1' }, statistics: { viewCount: '3200000' } },
      { snippet: { title: 'my local', channelTitle: 'someone', publishedAt: '2024-01-01T00:00:00Z', description: '' }, statistics: { viewCount: '40' } },
    ] });
  };
  assert.deepEqual(await searchVideos('melee grand finals'), [
    { title: 'Armada vs Mango', channel: 'VGBootCamp', year: '2014', views: 3200000, description: 'Grand finals of Apex. 0:00 Game 1' },
  ]);
  assert.deepEqual(asked, [['search', 'test-key', 'melee grand finals'], ['videos', 'test-key', 'a,b']]);

  globalThis.fetch = async () => json({ error: { message: 'The request cannot be completed because you have exceeded your quota.' } }, false);
  await assert.rejects(searchVideos('melee'), /YouTube: The request cannot be completed/);
});

test('the message lists the game\'s points, then the video and article as more of them', () => {
  const message = jokeMessage({
    style: 'a copypasta',
    points: ['one', 'two'],
    video: { title: 'Armada vs Mango', channel: 'VGBootCamp', year: '2014', views: 3200000, description: 'Grand finals.' },
    article: { about: 'the "Fox (SSBM)" article', text: 'Fox is fast.\nFox has a shine.' },
  });
  assert.equal(message, [
    'Style: a copypasta',
    'Talking points: one; two',
    'A YouTube video: "Armada vs Mango" from VGBootCamp, 2014, 3.2M views. Description: Grand finals.',
    'From the "Fox (SSBM)" article on SmashWiki:\nFox is fast.\nFox has a shine.',
  ].join('\n'));
  assert.equal(jokeMessage({ style: 's', points: ['one', 'two', 'three'] }), 'Style: s\nTalking points: one; two; three');
});

// taking a post starts on the next one, which has to finish before fetch goes back to the real one
async function nextPostWritten(sent) {
  while (sent.length < 2) await new Promise((resolve) => setImmediate(resolve));
}

// a joke with a fake claude, so what haiku would get can be checked
function joke(sent) {
  const client = { messages: { create: async (request) => {
    sent.push(request.messages[0].content);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'post' }] };
  } } };
  return makeJoke({
    name: 'melee', line: 'MELEE', category: 'Screenshots (SSBM)', prompt: 'p', styles: ['a rant'], points: ['one', 'two', 'three'],
    articles: ['Techniques (SSBM)'], videos: ['melee combo video'], focus: /Melee/,
  }, client);
}

function fakeSites({ wikiDown = false } = {}) {
  globalThis.fetch = async (url) => {
    const { hostname, searchParams, pathname } = new URL(url);
    if (hostname === 'images.example') return json({});
    if (hostname === 'www.googleapis.com') {
      return pathname.endsWith('/search')
        ? json({ items: [{ id: { videoId: 'a' } }] })
        : json({ items: [{ snippet: { title: 'Combo video', channelTitle: 'Someone', publishedAt: '2015-01-01T00:00:00Z', description: '' }, statistics: { viewCount: '50000' } }] });
    }
    if (searchParams.get('generator')) return json({ query: { pages: [{ title: 'File:Fox.png', imageinfo: [{ url: 'https://images.example/fox.png', descriptionurl: 'https://www.ssbwiki.com/File:Fox.png' }] }] } });
    if (wikiDown) return json({}, false);
    if (searchParams.get('list')) return json({ query: { categorymembers: [{ title: 'Wavedash' }] } });
    return json({ query: { pages: [{ extract: `Wavedash is a technique.\n${paragraph('In Melee it slides.')}` }] } });
  };
}

test('a post gets a video and an article on top of two of the game\'s points', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  fakeSites();
  const sent = [];
  const post = await joke(sent).takePost();
  await nextPostWritten(sent);
  assert.equal(post.text, 'post');
  assert.equal(post.image.name, 'melee.png');
  const [message] = sent;
  assert.match(message, /^Style: a rant\nTalking points: [a-z]+; [a-z]+\n/);
  assert.match(message, /\nA YouTube video: "Combo video" from Someone, 2015, 50K views\n/);
  assert.match(message, /\nFrom the "Wavedash" article on SmashWiki:\nWavedash is a technique\.\nIn Melee it slides/);
});

test('smashwiki articles down and no youtube key still makes a post, from three of the game\'s points', async () => {
  fakeSites({ wikiDown: true });
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));
  const sent = [];
  const post = await joke(sent).takePost();
  await nextPostWritten(sent);
  console.error = originalError;
  assert.equal(post.text, 'post');
  assert.match(sent[0], /^Style: a rant\nTalking points: [a-z]+; [a-z]+; [a-z]+$/);
  // once for that post and once for the next one it started on
  assert.deepEqual(errors, Array(2).fill('melee SmashWiki article failed: SmashWiki returned 500'));
});
