import Anthropic from '@anthropic-ai/sdk';

export const LINE = 'I LOVE SMASH BROS FOR WII U';

const PROMPT = `You are a competitive Super Smash Bros. for Wii U player and the game's biggest fan, posting in a Discord server of Smash players.
Write a post about how much you love the game, in the style given in the message. Talk about it the way a competitive player would: the gameplay, the meta, the tournaments, the community. Let that show instead of announcing it.
Be funny and over the top: absurd exaggeration, unhinged devotion, petty jabs at the other Smash games. Specific jokes beat generic hype.
Build it around one or two of the talking points in the message, not all of them. Never name real players, commentators or anyone else from the scene.
This crowd notices mistakes, so for Smash 4 specifics stick to the talking points. Ice Climbers, Snake, Wolf and Pokemon Trainer aren't in Smash 4, and Smash Run is only on 3DS.
Format it the way the style calls for, not as a bullet list by default. No headings, the post already has a title. Jokes land harder short: at most 5 sentences (8 short lines for poems and lists) and 30 to 80 words, unless the style says otherwise.
Reply with only the post, no notes about how you're writing it.`;

const STYLES = [
  'an all-caps hype rant in one paragraph',
  'a love letter that starts "Dear Smash 4," and gets way too emotional',
  'a numbered top 3',
  'a commentator losing it over a hype moment as if it is happening live',
  'a short rhyming poem',
  'a copypasta',
  'an old head telling the kids how good they had it',
  'a hot take that ends with "fight me"',
  'a dating profile for the game',
  'a winner\'s interview after taking a major',
  'two or three haiku',
  'a five star review',
  'a gushing superfan defending it as the best Smash ever like someone just said otherwise: an over-the-top opener, two or three short bolded bullet point reasons, then a sign-off, under 100 words',
];

// haiku mixes up the smash games without real facts to go off
const TALKING_POINTS = [
  'Ryu as DLC, with real fighting game inputs that make his specials stronger',
  'Diddy Kong\'s down throw to up air, the hoo-hah, ran early Smash 4 until patches toned it down',
  'Bayonetta came as DLC and became the most dominant and most complained about character, with ladder combos and Witch Time',
  'Cloud came as DLC and was top tier right away, with Limit Break and a huge sword',
  'Smash 4 was the first Smash with online balance patches, so the meta kept changing',
  'rage: the more damage you have, the harder your hits launch',
  'ledge trumping: grabbing the ledge pops off whoever is already hanging there',
  'perfect pivoting, a tricky movement tech for spacing',
  'Sheik, with needles, Bouncing Fish and fast aerials, was one of the best characters for much of the game',
  'Rosalina & Luma being a nightmare early on, two fighters at once',
  'Mewtwo returning as DLC',
  'newcomers like Greninja, Shulk, Mega Man, Pac-Man, Villager and Duck Hunt',
  'custom moves existed, but most tournaments banned them',
  'starter stages like Battlefield, Final Destination, Smashville, Town and City and Lylat Cruise',
  '8-Player Smash on the Wii U',
  'For Glory, the online 1v1 mode on Omega stages with no items',
  'Nintendo made a GameCube controller adapter for the Wii U just for this game',
  'Little Mac: a monster on the ground, a rock off stage',
  'a slower, more defensive neutral than Melee, all patience, shields and reads',
  'big events like Genesis, CEO, EVO, The Big House, 2GG and Umebura in Japan',
];

// short timeout so it falls back to the line fast if claude is down
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 20_000, maxRetries: 1 }) : null;

export const enabled = Boolean(client);

// all ~1800 wii u screenshots on smashwiki, fetched once
let screenshots;

function allScreenshots() {
  if (!screenshots) {
    screenshots = fetchScreenshots();
    screenshots.catch(() => { screenshots = null; });
  }
  return screenshots;
}

async function wiki(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dark-fundies-bot' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`SmashWiki returned ${res.status}`);
  return res;
}

async function fetchScreenshots() {
  const files = [];
  let next = {};
  while (next) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'categorymembers',
      gcmtitle: 'Category:Screenshots (SSB4-Wii U)',
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

// discord can't always load smashwiki images, so upload the file
async function download(screenshot) {
  const res = await wiki(screenshot.url);
  const extension = screenshot.url.split('.').pop().toLowerCase();
  return { attachment: Buffer.from(await res.arrayBuffer()), name: `sm4sh.${extension}` };
}

// removes what it picks
function pickFrom(list) {
  return list.splice(Math.floor(Math.random() * list.length), 1)[0];
}

// no repeats until every screenshot has been shown
let unseen = [];

function pickScreenshot(files) {
  if (!unseen.length) unseen = [...files];
  return pickFrom(unseen);
}

async function loveLetter() {
  const points = [...TALKING_POINTS];
  const response = await client.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 16000,
    // low effort ignores the word limit
    output_config: { effort: 'medium' },
    system: PROMPT,
    messages: [{
      role: 'user',
      content: [
        `Style: ${pickFrom([...STYLES])}`,
        `Talking points: ${[pickFrom(points), pickFrom(points), pickFrom(points)].join('; ')}`,
      ].join('\n'),
    }],
  });

  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  if (response.stop_reason === 'refusal' || !text) throw new Error(`Claude sent nothing back (${response.stop_reason})`);
  return text;
}

async function makePost() {
  const screenshot = pickScreenshot(await allScreenshots());
  const [text, image] = await Promise.all([loveLetter(), download(screenshot)]);
  return { text, screenshot, image };
}

// made ahead of time so /df sm4sh replies right away
let nextPost;

function prepare() {
  nextPost = makePost();
  nextPost.catch(() => {}); // handled in takePost
}

export function takePost() {
  const ready = nextPost;
  prepare();
  // if the prefetched one failed, try again now
  return ready.catch(makePost);
}

if (enabled) prepare();
