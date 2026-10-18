import * as embeds from '../embeds/index.js';

const API = 'https://commons.wikimedia.org/w/api.php';
// selected player galleries add photos without pulling in every former Bill's other teams
const CATEGORIES = [
  'Bills Mafia', 'Buffalo Bills players', 'Buffalo Bills', 'Highmark Stadium (Orchard Park, New York)', 'New Highmark Stadium', 'Billy Buffalo',
  'Josh Allen in 2018', 'Josh Allen in 2019', 'Josh Allen in 2021', 'Josh Allen in 2025',
  'James Cook (running back)', 'Terrel Bernard', 'Christian Benford', 'Dawson Knox', 'Greg Rousseau',
];
// checked links, not live searches, so unrelated memes stay out of the mix
const MEMES = [
  ['72v69k', 'Josh Allen in a big hat'],
  ['8ct3uv', 'Bills by a billion'],
  ['6srd64', 'Josh Allen vs the alarm clock'],
  ['4t7yao', 'Bills Mafia and folding tables'],
  ['1wyc1y', 'Circle the wagons'],
  ['7pdz5j', 'The struggle was real'],
  ['1qxu9q', 'Where else would you rather be?'],
].map(([id, name]) => ({ name, image: `https://i.imgflip.com/${id}.jpg`, page: `https://imgflip.com/i/${id}`, source: 'Imgflip' }));
// reactions from the official Buffalo Bills and NFL channels
const GIFS = [
  ['zw3lIgxdVc0I6JMJ1x', 'Josh Allen hello'],
  ['Y3xviAHFL6GykaRu6B', 'Josh Allen finger guns'],
  ['elqUYc9nQYRCEuL2Gq', 'Josh Allen thumbs up'],
  ['2t9lXRcMnr2Wt8D1LU', 'Josh Allen dancing'],
  ['WVWAcn33b93kO6hNvX', 'Bills dancing'],
].map(([id, name]) => ({ name, image: `https://media.giphy.com/media/${id}/giphy.gif`, page: `https://giphy.com/gifs/${id}`, source: 'GIPHY' }));
const TITLES = [
  'GO BILLS! 🦬🔥',
  'BILLS MAFIA! ❤️💙',
  'LET\'S GO BUFFALO! 🦬',
  'BILLS BY A BILLION! 🔥',
  'CIRCLE THE WAGONS! 🦬',
  'ONE BUFFALO! ❤️💙',
  'SQUISH THE FISH! 🦬',
  'HEY-EY-EY-EY! ❤️💙',
];

export async function billsImagePool() {
  const pages = [];
  const signal = AbortSignal.timeout(30_000);
  // one category at a time to avoid a burst of requests on the first post
  for (const category of CATEGORIES) {
    if (signal.aborted) break;
    let next = {};
    try {
      while (next) {
        const params = new URLSearchParams({
          action: 'query', format: 'json', formatversion: '2', generator: 'categorymembers',
          gcmtitle: `Category:${category}`, gcmtype: 'file', gcmlimit: '500',
          prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '1600', ...next,
        });
        const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': 'Sama-tracker' }, signal });
        if (!res.ok) throw new Error(`Wikimedia Commons returned ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.info);
        pages.push(...(data.query?.pages ?? []));
        next = data.continue;
      }
    } catch (err) {
      console.error(`bills category ${category} failed:`, err.message);
    }
  }

  const images = pages.flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info?.mime?.startsWith('image/') || info.mime === 'image/svg+xml' || !info.thumburl) return [];
    return [{
      name: page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '').replaceAll('_', ' '),
      image: info.thumburl,
      page: info.descriptionurl,
    }];
  });
  if (!images.length) throw new Error('Wikimedia Commons found no Bills images');
  return [...new Map(images.map((image) => [image.page, image])).values()];
}

// each pool gets used up before it repeats, with no repeat across the refill either
function cycle(load) {
  let all;
  let unseen = [];
  let last;
  return async () => {
    all ??= load();
    let pool;
    try {
      pool = await all;
    } catch (err) {
      all = null;
      throw err;
    }
    if (!unseen.length) unseen = [...pool];
    const choices = unseen.length > 1 ? unseen.filter(({ image }) => image !== last) : unseen;
    const picked = choices[Math.floor(Math.random() * choices.length)];
    unseen.splice(unseen.indexOf(picked), 1);
    last = picked.image;
    return picked;
  };
}

const pools = [cycle(billsImagePool), cycle(() => MEMES), cycle(() => GIFS)];
let kinds = [];

// upload the original bytes so gifs keep their animation
async function download(image) {
  const res = await fetch(image, { headers: { 'User-Agent': 'Sama-tracker' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Bills image returned ${res.status}`);
  const extension = new URL(image).pathname.split('.').pop().toLowerCase();
  return { attachment: Buffer.from(await res.arrayBuffer()), name: `bills.${extension}` };
}

async function takePost() {
  // one of each per round, so the larger photo pool doesn't crowd out memes and gifs
  if (!kinds.length) kinds = [0, 1, 2];
  const kind = kinds.splice(Math.floor(Math.random() * kinds.length), 1)[0];
  let picked;
  try {
    picked = await pools[kind]();
  } catch (err) {
    console.error('bills photos failed:', err.message);
    picked = await pools[1 + Math.floor(Math.random() * 2)]();
  }
  // a failed download falls back to the url, which discord usually still loads
  let file;
  try {
    file = await download(picked.image);
  } catch (err) {
    console.error('bills image download failed:', err.message);
  }
  return { ...picked, file, title: TITLES[Math.floor(Math.random() * TITLES.length)] };
}

export default {
  name: 'bills',
  line: 'GO BILLS! 🦬🔥',
  description: 'Bills photos, memes and GIFs with a rally cry',
  enabled: true,
  takePost,
  format: ({ title, image, file, page, name, source }) => ({
    embeds: [embeds.funImage(title, file ? `attachment://${file.name}` : image, page, name, source)],
    files: file ? [file] : [],
  }),
};
