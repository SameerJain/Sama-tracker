import * as embeds from '../embeds/index.js';

const API = 'https://commons.wikimedia.org/w/api.php';
const CATEGORIES = ['Bills Mafia', 'Buffalo Bills players', 'Buffalo Bills', 'Highmark Stadium (Orchard Park, New York)', 'New Highmark Stadium', 'Billy Buffalo'];
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
  const pages = await Promise.all(CATEGORIES.map(async (category) => {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', generator: 'categorymembers',
      gcmtitle: `Category:${category}`, gcmtype: 'file', gcmlimit: '500',
      prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '1600',
    });
    const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': 'Sama-tracker' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Wikimedia Commons returned ${res.status}`);
    return (await res.json()).query?.pages ?? [];
  }));

  const images = pages.flat().flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info?.mime?.startsWith('image/') || info.mime === 'image/svg+xml' || !info.thumburl) return [];
    return [{
      name: page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '').replaceAll('_', ' '),
      image: info.thumburl,
      page: info.descriptionurl,
    }];
  });
  return [...new Map(images.map((image) => [image.image, image])).values()];
}

let images;

// discord can't always load wikimedia images, so upload the file like the smash posts do
async function download(image) {
  const res = await fetch(image, { headers: { 'User-Agent': 'Sama-tracker' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Wikimedia Commons image returned ${res.status}`);
  const extension = new URL(image).pathname.split('.').pop().toLowerCase();
  return { attachment: Buffer.from(await res.arrayBuffer()), name: `bills.${extension}` };
}

async function takePost() {
  images ??= billsImagePool();
  let pool;
  try {
    pool = await images;
  } catch (err) {
    images = null;
    throw err;
  }
  if (!pool.length) throw new Error('Wikimedia Commons found no Bills images');
  const picked = pool[Math.floor(Math.random() * pool.length)];
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
  enabled: true,
  takePost,
  format: ({ title, image, file, page, name }) => ({
    embeds: [embeds.funImage(title, file ? `attachment://${file.name}` : image, page, name)],
    files: file ? [file] : [],
  }),
};
