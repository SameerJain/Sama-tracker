import Anthropic from '@anthropic-ai/sdk';

// short timeout so it falls back to the line fast if claude is down
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 20_000, maxRetries: 1 }) : null;

async function wiki(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dark-fundies-bot' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`SmashWiki returned ${res.status}`);
  return res;
}

async function fetchScreenshots(category) {
  const files = [];
  let next = {};
  while (next) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'categorymembers',
      gcmtitle: `Category:${category}`,
      gcmtype: 'file',
      gcmlimit: '500',
      prop: 'imageinfo',
      iiprop: 'url',
      ...next,
    });
    const data = await (await wiki(`https://www.ssbwiki.com/api.php?${params}`)).json();

    for (const page of data.query.pages) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      // "File:Animal_Crossing_Stage_SSB4.jpg" -> "Animal Crossing Stage SSB4"
      const name = page.title.replace(/^File:/, '').replace(/\.\w+$/, '').replaceAll('_', ' ');
      files.push({ name, url: info.url, page: info.descriptionurl });
    }
    next = data.continue;
  }
  return files;
}

// same for every game, the prompts only set the character
const RULES = `Format it the way the style calls for, not as a bullet list by default. No headings, the post already has a title.
Let the joke set the length. Most posts land around 80 to 130 words, but anywhere from 50 to 180 is fine: a hot take can hit and stop, while a story, list or copypasta that builds can use the room. Haiku can come in under that. Don't pad, end once the last joke lands.
Reply with only the post, no notes about how you're writing it.`;

// removes what it picks
function pickFrom(list) {
  return list.splice(Math.floor(Math.random() * list.length), 1)[0];
}

// a claude-written post in character plus a random SmashWiki screenshot from the game
export function makeJoke({ name, line, category, prompt, styles, points }) {
  // fetched once, the first time it's needed
  let screenshots;
  // no repeats until every screenshot has been shown
  let unseen = [];

  function allScreenshots() {
    if (!screenshots) {
      screenshots = fetchScreenshots(category);
      screenshots.catch(() => { screenshots = null; });
    }
    return screenshots;
  }

  // discord can't always load smashwiki images, so upload the file
  async function download(screenshot) {
    const res = await wiki(screenshot.url);
    const extension = screenshot.url.split('.').pop().toLowerCase();
    return { attachment: Buffer.from(await res.arrayBuffer()), name: `${name}.${extension}` };
  }

  async function write() {
    const left = [...points];
    const response = await client.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 16000,
      // low effort ignores the word limit
      output_config: { effort: 'medium' },
      system: `${prompt}\n${RULES}`,
      messages: [{
        role: 'user',
        content: [
          `Style: ${pickFrom([...styles])}`,
          `Talking points: ${[pickFrom(left), pickFrom(left), pickFrom(left)].join('; ')}`,
        ].join('\n'),
      }],
    });

    const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    if (response.stop_reason === 'refusal' || !text) throw new Error(`Claude sent nothing back (${response.stop_reason})`);
    return text;
  }

  async function makePost() {
    if (!unseen.length) unseen = [...await allScreenshots()];
    const screenshot = pickFrom(unseen);
    const [text, image] = await Promise.all([write(), download(screenshot)]);
    return { text, screenshot, image };
  }

  // made ahead of time so the command replies right away
  let nextPost;

  function prepare() {
    nextPost = makePost();
    nextPost.catch(() => {}); // handled in takePost
  }

  function takePost() {
    const ready = nextPost;
    prepare();
    // if the prefetched one failed, try again now
    return ready.catch(makePost);
  }

  if (client) prepare();
  return { name, line, enabled: Boolean(client), takePost };
}
