import Anthropic from '@anthropic-ai/sdk';
import { articleExcerpt, categoryPages, fetchScreenshots, wiki } from './smashwiki.js';
import * as youtube from './youtube.js';

// short timeout so it falls back to the line fast if claude is down
const defaultClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 20_000, maxRetries: 1 }) : null;
// new videos go up all the time, and a search's results are kept this long
const VIDEO_REFRESH_HOURS = 24;
// stubs come back empty, so it tries a few articles before going without
const ARTICLE_TRIES = 3;

// same for every game, the prompts only set the character
const RULES = `Format it the way the style calls for, not as a bullet list by default. No headings, the post already has a title.
Let the joke set the length. Most posts land around 80 to 130 words, but anywhere from 50 to 180 is fine: a hot take can hit and stop, while a story, list or copypasta that builds can use the room. Haiku can come in under that. Don't pad, end once the last joke lands.
Anything from YouTube or SmashWiki in the message is real and counts as a talking point too. Use only what it says, and don't guess at what's in a video past its title and description.
Reply with only the post, no notes about how you're writing it.`;

// removes what it picks
function pickFrom(list) {
  return list.splice(Math.floor(Math.random() * list.length), 1)[0];
}

function anyOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// draws from what load() resolves to with no repeats until all of it's been drawn, then starts over.
// loads the first time, again after a failure, and again once it's maxHours old
function bag(load, maxHours = Infinity) {
  let all;
  let loadedAt;
  let unseen = [];
  return async () => {
    if (!all || Date.now() - loadedAt > maxHours * 60 * 60 * 1000) {
      all = load();
      loadedAt = Date.now();
      unseen = [];
      all.catch(() => { all = null; });
    }
    if (!unseen.length) unseen = [...await all];
    return pickFrom(unseen);
  };
}

const compact = new Intl.NumberFormat('en', { notation: 'compact' });

// what haiku gets: the style, a few of the game's own talking points, then whatever was found live.
// the article goes last since it runs over a few lines
export function jokeMessage({ style, points, video, article }) {
  const lines = [`Style: ${style}`, `Talking points: ${points.join('; ')}`];
  if (video) {
    const about = `"${video.title}" from ${video.channel}, ${video.year}, ${compact.format(video.views)} views`;
    lines.push(`A YouTube video: ${video.description ? `${about}. Description: ${video.description}` : about}`);
  }
  if (article) lines.push(`From ${article.about} on SmashWiki:\n${article.text}`);
  return lines.join('\n');
}

// a claude-written post in character plus a random SmashWiki screenshot from the game. articles are
// SmashWiki categories and videos are YouTube searches, for facts past the game's own talking points.
// focus matches a paragraph about this game, for articles that cover several
export function makeJoke({ name, line, category, prompt, styles, points, articles = [], videos = [], focus }, client = defaultClient) {
  const screenshots = bag(() => fetchScreenshots(category));
  // one each, picked from evenly so 270 trophies don't drown out 31 glitches
  const categories = articles.map((each) => bag(() => categoryPages(each)));
  const searches = videos.map((each) => bag(() => youtube.searchVideos(each), VIDEO_REFRESH_HOURS));

  // discord can't always load smashwiki images, so upload the file
  async function download(screenshot) {
    const res = await wiki(screenshot.url);
    const extension = screenshot.url.split('.').pop().toLowerCase();
    return { attachment: Buffer.from(await res.arrayBuffer()), name: `${name}.${extension}` };
  }

  async function findArticle() {
    for (let i = 0; i < ARTICLE_TRIES && categories.length; i++) {
      const title = await anyOf(categories)();
      const found = title && await articleExcerpt(title, focus);
      if (found) return found;
    }
    return null;
  }

  async function findVideo() {
    if (!youtube.enabled() || !searches.length) return null;
    return (await anyOf(searches)()) ?? null;
  }

  // either site being down shouldn't cost the post
  async function live(find, what) {
    try {
      return await find();
    } catch (err) {
      console.error(`${name} ${what} failed:`, err.message);
      return null;
    }
  }

  async function write() {
    const [video, article] = await Promise.all([live(findVideo, 'YouTube search'), live(findArticle, 'SmashWiki article')]);
    const left = [...points];
    // what was found live stands in for one of the game's own
    const picks = Array.from({ length: video || article ? 2 : 3 }, () => pickFrom(left));
    const response = await client.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 16000,
      // low effort ignores the word limit
      output_config: { effort: 'medium' },
      system: `${prompt}\n${RULES}`,
      messages: [{ role: 'user', content: jokeMessage({ style: anyOf(styles), points: picks, video, article }) }],
    });

    const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    if (response.stop_reason === 'refusal' || !text) throw new Error(`Claude sent nothing back (${response.stop_reason})`);
    return text;
  }

  async function makePost() {
    const screenshot = await screenshots();
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
