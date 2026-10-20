import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';

// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { articleExcerpt, categoryPages, excerpt, patchNotes } = await import('../src/fun/smashwiki.js');
const { addCommunity, searchVideos } = await import('../src/fun/youtube.js');
const { billsImagePool } = await import('../src/fun/bills.js');
const { SCENARIOS, funMessage, makeFun, pickStyle } = await import('../src/fun/generated.js');
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
      { id: 'a', snippet: { title: 'Armada vs Mango', channelTitle: 'VGBootCamp', publishedAt: '2014-06-01T00:00:00Z', tags: ['melee', 'apex'], description: 'Grand finals of Apex.\nhttps://twitter.com/vgbootcamp\n#melee #ssbm\n0:00 Game 1' }, statistics: { viewCount: '3200000', likeCount: '120000', commentCount: '8400' } },
      { snippet: { title: 'my local', channelTitle: 'someone', publishedAt: '2024-01-01T00:00:00Z', description: '' }, statistics: { viewCount: '40' } },
    ] });
  };
  assert.deepEqual(await searchVideos('melee grand finals'), [
    { id: 'a', title: 'Armada vs Mango', channel: 'VGBootCamp', year: '2014', views: 3200000, likes: 120000, commentCount: 8400, tags: ['melee', 'apex'], description: 'Grand finals of Apex. 0:00 Game 1' },
  ]);
  assert.deepEqual(asked, [['search', 'test-key', 'melee grand finals'], ['videos', 'test-key', 'a,b']]);

  globalThis.fetch = async () => json({ error: { message: 'The request cannot be completed because you have exceeded your quota.' } }, false);
  await assert.rejects(searchVideos('melee'), /YouTube: The request cannot be completed/);
});

test('youtube adds top viewer reactions without treating them as video facts', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    const { pathname, searchParams } = new URL(url);
    assert.ok(pathname.endsWith('/commentThreads'));
    assert.equal(searchParams.get('videoId'), 'a');
    assert.equal(searchParams.get('order'), 'relevance');
    return json({ items: [
      { snippet: { topLevelComment: { snippet: { textDisplay: 'The crowd pop here was unreal.' } } } },
      { snippet: { topLevelComment: { snippet: { textDisplay: 'This set changed how people saw the matchup.' } } } },
    ] });
  };
  const video = await addCommunity({ id: 'a', title: 'A set' });
  assert.deepEqual(video.community, ['The crowd pop here was unreal.', 'This set changed how people saw the matchup.']);
});

test('bills images come from the fan, player, team, stadium and mascot Commons categories', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    const params = new URL(url).searchParams;
    asked.push(params.get('gcmtitle'));
    return json({ query: { pages: [
      { title: 'File:Bills fan.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://images.example/fan.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Bills_fan.jpg' }] },
      { title: 'File:Bills logo.svg', imageinfo: [{ mime: 'image/svg+xml', thumburl: 'https://images.example/logo.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Bills_logo.svg' }] },
    ] } });
  };
  assert.deepEqual(await billsImagePool(), [{
    name: 'Bills fan', image: 'https://images.example/fan.jpg', page: 'https://commons.wikimedia.org/wiki/File:Bills_fan.jpg',
  }]);
  for (const category of ['Bills Mafia', 'Buffalo Bills players', 'Buffalo Bills', 'Highmark Stadium (Orchard Park, New York)', 'New Highmark Stadium', 'Billy Buffalo', 'Buffalo Bills coaches', 'War Memorial Stadium (Buffalo, New York)', 'Josh Allen in 2021', 'Josh Allen in 2025', 'James Cook (running back)', 'Terrel Bernard', 'Dalton Kincaid', 'Khalil Shakir', 'Keon Coleman', 'Ed Oliver', 'Dion Dawkins', 'Matt Milano', 'Greg Rousseau', 'Christian Benford', 'Taron Johnson', 'Jim Kelly', 'Thurman Thomas', 'Andre Reed', 'Bruce Smith (defensive end)', 'Marv Levy', 'Sean McDermott', 'Damar Hamlin', 'Tyler Bass']) {
    assert.ok(asked.includes(`Category:${category}`), category);
  }
});

test('bills gifs come live from the official Buffalo Bills GIPHY channel', async () => {
  const module = await import('../src/fun/bills.js?live-giphy-pool');
  assert.equal(typeof module.billsGifPool, 'function');
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://giphy.com/buffalobills');
    return {
      ok: true,
      text: async () => [
        String.raw`\"id\":\"liveOne123\",\"title\":\"Josh Allen Celebration GIF by Buffalo Bills\",\"images\":{\"downsized\":{\"url\":\"https://media1.giphy.com/media/liveOne123/giphy.gif\"}}`,
        String.raw`\"id\":\"liveTwo456\",\"title\":\"Bills Mafia Sticker by Buffalo Bills\",\"images\":{\"downsized\":{\"url\":\"https://media2.giphy.com/media/liveTwo456/giphy.gif\"}}`,
        String.raw`\"id\":\"otherTeam9\",\"title\":\"Chiefs Win GIF by NFL\",\"images\":{\"downsized\":{\"url\":\"https://media3.giphy.com/media/otherTeam9/giphy.gif\"}}`,
      ].join(','),
    };
  };
  assert.deepEqual(await module.billsGifPool(), [
    { name: 'Josh Allen Celebration', image: 'https://media1.giphy.com/media/liveOne123/giphy.gif', page: 'https://giphy.com/gifs/liveOne123', source: 'GIPHY' },
    { name: 'Bills Mafia', image: 'https://media2.giphy.com/media/liveTwo456/giphy.gif', page: 'https://giphy.com/gifs/liveTwo456', source: 'GIPHY' },
  ]);
});

test('bills follows both thumbnail and category continuation without duplicating files', async () => {
  const image = (title, name) => ({ title: `File:${title}.jpg`, imageinfo: [{ mime: 'image/jpeg', thumburl: `https://images.example/${name}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}.jpg` }] });
  globalThis.fetch = async (url) => {
    const params = new URL(url).searchParams;
    if (params.get('gcmtitle') !== 'Category:Bills Mafia') return json({ query: { pages: [] } });
    if (params.get('gcmcontinue')) {
      assert.equal(params.get('continue'), 'gcmcontinue||');
      assert.equal(params.get('iicontinue'), null);
      return json({ query: { pages: [image('Third', 'third')] } });
    }
    if (params.get('iicontinue')) {
      assert.equal(params.get('continue'), '||');
      return json({ query: { pages: [image('First', 'first'), image('Second', 'second')] }, continue: { continue: 'gcmcontinue||', gcmcontinue: 'more-files' } });
    }
    return json({ query: { pages: [image('First', 'first'), { title: 'File:Second.jpg' }] }, continue: { continue: '||', iicontinue: 'more-thumbnails' } });
  };
  assert.deepEqual((await billsImagePool()).map(({ name }) => name), ['First', 'Second', 'Third']);
});

test('bills keeps the available photos if one Commons category fails', async () => {
  console.error = () => {};
  try {
    globalThis.fetch = async (url) => {
      if (new URL(url).searchParams.get('gcmtitle') === 'Category:Bills Mafia') return json({}, false);
      return json({ query: { pages: [{ title: 'File:Team.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://images.example/team.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Team.jpg' }] }] } });
    };
    assert.equal((await billsImagePool())[0].name, 'Team');
  } finally {
    console.error = originalError;
  }
});

test('bills stops loading photo categories when the pool timeout expires', async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  let requests = 0;
  console.error = () => {};
  try {
    globalThis.fetch = async () => {
      requests++;
      controller.abort();
      throw new Error('timed out');
    };
    await assert.rejects(billsImagePool(), /found no Bills images/);
    assert.equal(requests, 1);
  } finally {
    console.error = originalError;
  }
});

test('bills uploads the image instead of hotlinking it', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const { default: bills } = await import('../src/fun/bills.js?upload');
  globalThis.fetch = async (url) => {
    if (String(url).includes('commons.wikimedia.org')) return json({ query: { pages: [
      { title: 'File:Bills fan.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://images.example/fan.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Bills_fan.jpg' }] },
    ] } });
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const post = await bills.takePost();
  assert.ok(Buffer.isBuffer(post.file.attachment));
  assert.equal(post.file.name, 'bills.jpg');
  const reply = bills.format(post);
  assert.equal(reply.embeds[0].data.image.url, 'attachment://bills.jpg');
  assert.deepEqual(reply.files, [post.file]);
  assert.match(reply.embeds[0].data.footer.text, /Wikimedia Commons/);
});

test('bills falls back to the image url when the download fails', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const { default: bills } = await import('../src/fun/bills.js?download-failure');
  console.error = () => {};
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('commons.wikimedia.org')) return json({ query: { pages: [{ title: 'File:Fan.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://images.example/fan.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Fan.jpg' }] }] } });
      throw new Error('nope');
    };
    const post = await bills.takePost();
    assert.equal(post.file, undefined);
    const reply = bills.format(post);
    assert.equal(reply.embeds[0].data.image.url, 'https://images.example/fan.jpg');
    assert.deepEqual(reply.files, []);
  } finally {
    console.error = originalError;
  }
});

test('bills rotates live photos and official Bills gifs, using each pool before repeating', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const { default: bills } = await import('../src/fun/bills.js?rotation');
  globalThis.fetch = async (url) => {
    if (String(url).includes('commons.wikimedia.org')) return json({ query: { pages: ['one', 'two', 'three'].map((name) => ({ title: `File:${name}.jpg`, imageinfo: [{ mime: 'image/jpeg', thumburl: `https://images.example/${name}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}.jpg` }] })) } });
    if (url === 'https://giphy.com/buffalobills') return { ok: true, text: async () => Array.from({ length: 20 }, (_, i) => String.raw`\"id\":\"liveGif${i}\",\"title\":\"Bills Celebration ${i} GIF by Buffalo Bills\",\"images\":{\"downsized\":{\"url\":\"https://media.giphy.com/media/liveGif${i}/giphy.gif\"}}`).join(',') };
    return { ok: true, arrayBuffer: async () => new Uint8Array([71, 73, 70, 56]).buffer };
  };
  const posts = [];
  for (let i = 0; i < 40; i++) posts.push(await bills.takePost());
  for (let i = 0; i < posts.length; i += 2) {
    assert.match(posts[i].page, /^https:\/\/commons\.wikimedia\.org\//);
    assert.match(posts[i + 1].page, /^https:\/\/giphy\.com\//);
  }
  assert.equal(new Set([posts[0].image, posts[2].image, posts[4].image]).size, 3);
  assert.notEqual(posts[4].image, posts[6].image);
  const gifs = posts.filter((_, i) => i % 2 === 1);
  assert.equal(new Set(gifs.map(({ image }) => image)).size, 20);
  assert.ok(gifs.every(({ image }) => !image.includes('P50teGDm254KLd1xMK')));
  const reply = bills.format(gifs[0]);
  assert.equal(reply.embeds[0].data.image.url, 'attachment://bills.gif');
  assert.match(reply.embeds[0].data.footer.text, /GIPHY/);
  assert.doesNotMatch(reply.embeds[0].data.footer.text, /Wikimedia Commons/);
  assert.equal(reply.files[0].attachment.toString(), 'GIF8');
});

test('bills never sends the same image twice in a row across different pools', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const { default: bills } = await import('../src/fun/bills.js?consecutive-repeat');
  globalThis.fetch = async (url) => {
    if (String(url).includes('commons.wikimedia.org')) return json({ query: { pages: [{
      title: 'File:Duplicate.jpg',
      imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://media.giphy.com/media/sameImage/giphy.gif', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Duplicate.jpg' }],
    }] } });
    if (url === 'https://giphy.com/buffalobills') return { ok: true, text: async () => [
      String.raw`\"id\":\"sameImage\",\"title\":\"Bills Celebration GIF by Buffalo Bills\",\"images\":{\"downsized\":{\"url\":\"https://media.giphy.com/media/sameImage/giphy.gif\"}}`,
      String.raw`\"id\":\"otherImage\",\"title\":\"Josh Allen GIF by Buffalo Bills\",\"images\":{\"downsized\":{\"url\":\"https://media.giphy.com/media/otherImage/giphy.gif\"}}`,
    ].join(',') };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const first = await bills.takePost();
  const second = await bills.takePost();
  assert.notEqual(first.image, second.image);
});

test('bills still posts official gifs when Commons is down, then retries the photos', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const { default: bills } = await import('../src/fun/bills.js?commons-failure');
  let down = true;
  console.error = () => {};
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('commons.wikimedia.org')) {
        if (down) return json({}, false);
        return json({ query: { pages: [{ title: 'File:Back.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://images.example/back.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Back.jpg' }] }] } });
      }
      if (url === 'https://giphy.com/buffalobills') return { ok: true, text: async () => String.raw`\"id\":\"liveBills1\",\"title\":\"Go Bills GIF by Buffalo Bills\",\"images\":{\"downsized\":{\"url\":\"https://media.giphy.com/media/liveBills1/giphy.gif\"}}` };
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    };
    assert.match((await bills.takePost()).page, /^https:\/\/giphy\.com\//);
    down = false;
    const posts = [];
    for (let i = 0; i < 3; i++) posts.push(await bills.takePost());
    assert.ok(posts.some(({ image }) => image === 'https://images.example/back.jpg'));
  } finally {
    console.error = originalError;
  }
});

test('bills keeps posts queued so bursts reply right away', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const { default: bills } = await import('../src/fun/bills.js?queued');
  let commons = 0;
  let giphy = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('commons.wikimedia.org')) {
      commons++;
      return json({ query: { pages: ['one', 'two', 'three'].map((name) => ({ title: `File:${name}.jpg`, imageinfo: [{ mime: 'image/jpeg', thumburl: `https://images.example/${name}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}.jpg` }] })) } });
    }
    if (url === 'https://giphy.com/buffalobills') {
      giphy++;
      return { ok: true, text: async () => Array.from({ length: 20 }, (_, i) => String.raw`\"id\":\"liveGif${i}\",\"title\":\"Bills Celebration ${i} GIF by Buffalo Bills\",\"images\":{\"downsized\":{\"url\":\"https://media.giphy.com/media/liveGif${i}/giphy.gif\"}}`).join(',') };
    }
    return { ok: true, arrayBuffer: async () => new Uint8Array([71, 73, 70, 56]).buffer };
  };
  const first = await bills.takePost();
  assert.ok(first.title);
  const loaded = { commons, giphy };
  assert.ok(loaded.commons > 0, 'the first post loads the photo pool');
  const second = await bills.takePost();
  assert.ok(second.title);
  assert.notEqual(second.image, first.image);
  // the second post was already queued in the backend: no new pool loads
  assert.equal(commons, loaded.commons);
  assert.equal(giphy, loaded.giphy);
});

test('the message lists the game\'s points, then the video and article as more of them', () => {
  const message = funMessage({
    style: 'a copypasta',
    points: ['one', 'two'],
    video: { title: 'Armada vs Mango', channel: 'VGBootCamp', year: '2014', views: 3200000, likes: 120000, commentCount: 8400, tags: ['melee', 'apex'], description: 'Grand finals.', community: ['The crowd was electric.'] },
    article: { about: 'the "Fox (SSBM)" article', text: 'Fox is fast.\nFox has a shine.' },
  });
  assert.equal(message, [
    'Style: a copypasta',
    'Talking points: one; two',
    'A YouTube video: "Armada vs Mango" from VGBootCamp, 2014, 3.2M views, 120K likes, 8.4K comments',
    'Creator description: Grand finals.',
    'Creator tags: melee, apex',
    'What viewers highlight in top relevant comments:\n- The crowd was electric.',
    'From the "Fox (SSBM)" article on SmashWiki:\nFox is fast.\nFox has a shine.',
  ].join('\n'));
  assert.equal(funMessage({ style: 's', points: ['one', 'two', 'three'] }), 'Style: s\nTalking points: one; two; three');
});

// taking a post refills the queue, which has to finish before fetch goes back to the real one
async function nextPostWritten(sent) {
  while (sent.length < 4) await new Promise((resolve) => setImmediate(resolve));
}

// the shared scenarios the fake game picked
const MIX = ['candidate', 'scene', 'alien', 'pilot', 'subway', 'hostage'];

// a fun post with a fake Claude, so what Haiku would get can be checked. posts go in sent, and the
// requests for a made up scenario go in invented, answered by scenario()
function funPost(sent, { invented = [], scenario = async () => 'a lighthouse keeper signaling ships about the take' } = {}) {
  const client = { messages: { create: async (request) => {
    const content = request.messages[0].content;
    if (!content.startsWith('Style: ')) {
      invented.push(content);
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: await scenario() }] };
    }
    sent.push(content);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'post' }] };
  } } };
  return makeFun({
    name: 'melee', line: 'MELEE', category: 'Screenshots (SSBM)', prompt: 'p', styles: ['a rant'], scenarios: MIX, points: ['one', 'two', 'three'],
    articles: ['Techniques (SSBM)'], videos: ['melee combo video'], focus: /Melee/,
  }, client);
}

function fakeSites({ wikiDown = false } = {}) {
  globalThis.fetch = async (url) => {
    const { hostname, searchParams, pathname } = new URL(url);
    if (hostname === 'images.example') return json({});
    if (hostname === 'www.googleapis.com') {
      if (pathname.endsWith('/search')) return json({ items: [{ id: { videoId: 'a' } }] });
      if (pathname.endsWith('/commentThreads')) return json({ items: [] });
      return json({ items: [{ id: 'a', snippet: { title: 'Combo video', channelTitle: 'Someone', publishedAt: '2015-01-01T00:00:00Z', description: '' }, statistics: { viewCount: '50000' } }] });
    }
    if (searchParams.get('generator')) return json({ query: { pages: [{ title: 'File:Fox.png', imageinfo: [{ url: 'https://images.example/fox.png', descriptionurl: 'https://www.ssbwiki.com/File:Fox.png' }] }] } });
    if (wikiDown) return json({}, false);
    if (searchParams.get('list')) return json({ query: { categorymembers: [{ title: 'Wavedash' }] } });
    return json({ query: { pages: [{ extract: `Wavedash is a technique.\n${paragraph('In Melee it slides.')}` }] } });
  };
}

test('a post\'s style is one of the game\'s own half the time, or else one of its shared scenarios with a famous scene filled in', (t) => {
  // the first draw picks the game's styles or its shared ones, the rest pick from them
  let draws;
  t.mock.method(Math, 'random', () => draws.shift());
  const mix = [SCENARIOS.candidate, SCENARIOS.scene];
  const pick = (own, at, shared = mix) => {
    draws = [own ? 0.49 : 0.5, at, at];
    return pickStyle(['a rant', 'a copypasta'], shared);
  };
  assert.equal(pick(true, 0), 'a rant');
  assert.equal(pick(true, 0.99), 'a copypasta');
  assert.equal(pick(false, 0), SCENARIOS.candidate);
  assert.match(pick(false, 0.99), /^the .+, redone about the game: /);
  // a game with no shared ones always uses its own
  assert.equal(pick(false, 0, []), 'a rant');

  const every = Array.from({ length: 1000 }, (_, i) => pick(false, i / 1000, Object.values(SCENARIOS)));
  assert.ok(every.every((style) => !style.includes('{scene}')));
  assert.equal(new Set(every.map((style) => style.includes(', redone about the game: ') ? 'scene' : style)).size, Object.keys(SCENARIOS).length);
});

test('a game listing a shared scenario that doesn\'t exist fails at startup', () => {
  assert.throws(() => makeFun({ name: 'melee', line: 'MELEE', category: 'c', prompt: 'p', styles: ['a rant'], scenarios: ['candidate', 'mime'], points: ['one'] }, null),
    { message: '/melee lists scenarios that don\'t exist: mime' });
});

test('the smash commands go in release order with project+ sixth, and each one\'s scenarios exist', async () => {
  const { funCommands } = await import('../src/fun/index.js');
  assert.deepEqual(Object.keys(funCommands), ['64', 'melee', 'brawl', 'sm4sh', 'ult', 'pplus', 'bills']);
});

// the same value for every Math.random call. under 1/3 a post uses only the game's points,
// under 2/3 it tries a video first, and above that an article first. under 1/4 haiku makes up the style
async function postWith(t, random, options) {
  t.mock.method(Math, 'random', () => random);
  const sent = [];
  const post = await funPost(sent, options).takePost();
  await nextPostWritten(sent);
  return { post, message: sent[0] };
}

test('some posts run on a scenario haiku makes up first for the game\'s character, from a few in its mix', async (t) => {
  fakeSites();
  const invented = [];
  const { message } = await postWith(t, 0, { invented });
  assert.match(message, /^Style: a lighthouse keeper signaling ships about the take\n/);
  const [character, existing] = invented[0].split('\n\n');
  assert.equal(character, 'The character:\np');
  const [heading, ...examples] = existing.split('\n');
  assert.equal(heading, 'Scenarios that already exist:');
  assert.equal(examples.length, 5);
  const mix = MIX.map((each) => SCENARIOS[each]);
  assert.ok(examples.every((each) => mix.includes(each.slice(2)) || /^- the .+, redone about the game: /.test(each)));
});

test('a made up scenario that fails falls back to the lists', async (t) => {
  fakeSites();
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));
  const { post, message } = await postWith(t, 0, { scenario: async () => { throw new Error('overloaded'); } });
  console.error = originalError;
  assert.equal(post.text, 'post');
  assert.match(message, /^Style: a rant\n/);
  assert.deepEqual(errors, Array(4).fill('melee made up scenario failed: overloaded'));
});

test('most posts take their style from the lists', async (t) => {
  fakeSites();
  const invented = [];
  await postWith(t, 0.5, { invented });
  assert.deepEqual(invented, []);
});

test('a post can draw on a youtube video and two of the game\'s points', async (t) => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  fakeSites();
  const { post, message } = await postWith(t, 0.5);
  assert.equal(post.text, 'post');
  assert.equal(post.image.name, 'melee.png');
  assert.match(message, /^Style: .+\nTalking points: [a-z]+; [a-z]+\nA YouTube video: "Combo video" from Someone, 2015, 50K views$/);
  assert.doesNotMatch(message, /SmashWiki/);
});

test('a post can draw on a smashwiki article instead, even with a youtube key', async (t) => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  fakeSites();
  const { message } = await postWith(t, 0.9);
  assert.match(message, /^Style: .+\nTalking points: [a-z]+; [a-z]+\nFrom the "Wavedash" article on SmashWiki:\nWavedash is a technique\.\nIn Melee it slides/);
  assert.doesNotMatch(message, /YouTube/);
});

test('some posts use only three of the game\'s points', async (t) => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  fakeSites();
  const { message } = await postWith(t, 0);
  assert.match(message, /^Style: .+\nTalking points: [a-z]+; [a-z]+; [a-z]+$/);
});

test('a post that would use a video uses an article without a youtube key', async (t) => {
  fakeSites();
  const { message } = await postWith(t, 0.5);
  assert.match(message, /\nFrom the "Wavedash" article on SmashWiki:\n/);
});

test('smashwiki articles down and no youtube key still makes a post, from three of the game\'s points', async (t) => {
  fakeSites({ wikiDown: true });
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));
  const { post, message } = await postWith(t, 0.9);
  console.error = originalError;
  assert.equal(post.text, 'post');
  assert.match(message, /^Style: .+\nTalking points: [a-z]+; [a-z]+; [a-z]+$/);
  // one for that post and the three more queued ahead plus its refill
  assert.deepEqual(errors, Array(4).fill('melee SmashWiki article failed: SmashWiki returned 500'));
});

test('more than one post stays queued so bursts reply right away', async (t) => {
  fakeSites();
  t.mock.method(Math, 'random', () => 0.5);
  const sent = [];
  const fun = funPost(sent);
  while (sent.length < 3) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(sent.length >= 3);
  assert.equal((await fun.takePost()).text, 'post');
  await nextPostWritten(sent);
  assert.equal((await fun.takePost()).text, 'post');
  await nextPostWritten(sent);
});
