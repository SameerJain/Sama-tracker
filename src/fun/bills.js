import * as embeds from '../embeds/index.js';

const API = 'https://commons.wikimedia.org/w/api.php';
const GIPHY = 'https://giphy.com/buffalobills';
// selected player galleries add photos without pulling in every former Bill's other teams
const CATEGORIES = [
  'Bills Mafia', 'Buffalo Bills players', 'Buffalo Bills', 'Highmark Stadium (Orchard Park, New York)', 'New Highmark Stadium', 'Billy Buffalo',
  'Buffalo Bills coaches', 'War Memorial Stadium (Buffalo, New York)',
  'Josh Allen in 2018', 'Josh Allen in 2019', 'Josh Allen in 2021', 'Josh Allen in 2025',
  'James Cook (running back)', 'Terrel Bernard', 'Christian Benford', 'Dawson Knox', 'Greg Rousseau',
  'Dalton Kincaid', 'Khalil Shakir', 'Keon Coleman', 'Ed Oliver',
  'Dion Dawkins', 'Matt Milano', 'Taron Johnson',
  'Jim Kelly', 'Thurman Thomas', 'Andre Reed', 'Bruce Smith (defensive end)',
  'Marv Levy', 'Sean McDermott', 'Damar Hamlin', 'Tyler Bass',
];
// a small fallback if the official Bills channel is down
const FALLBACK_GIFS = [
  ['zw3lIgxdVc0I6JMJ1x', 'Josh Allen hello'],
  ['Y3xviAHFL6GykaRu6B', 'Josh Allen finger guns'],
  ['elqUYc9nQYRCEuL2Gq', 'Josh Allen thumbs up'],
  ['2t9lXRcMnr2Wt8D1LU', 'Josh Allen dancing'],
  ['WVWAcn33b93kO6hNvX', 'Bills dancing'],
  ['TgmwKWhG18tcOqJhN7', 'Josh Allen reaction'],
  ['J6205HegEoe5VPdpPk', 'Josh Allen celebration'],
  ['VhPxOrVh5ps5ExWtPJ', 'Josh Allen game day'],
  ['ElWkVF5A4A0SiMabcd', 'Bills reaction'],
  ['gTAXtUgxmE6yebkumf', 'Bills celebration'],
  ['DJzagZbyMa8wpxqc7o', 'Josh Allen touchdown reaction'],
  ['MG4xPu5dZpU3vxJxfL', 'Josh Allen says lets go'],
  ['3McruKxflKTnKT7P8Q', 'Josh Allen celebration dance'],
  ['xT39DfijnPhLm7RYw8', 'Bills touchdown celebration'],
  ['l0CLT3OZ5eHOWcJiM', 'LeSean McCoy touchdown'],
  ['JIX5lShrgLatcKhU4q', 'Bills playoff celebration'],
  ['3o6fJa7A2t8oZ8XuqQ', 'Bills end zone celebration'],
  ['hqTvpwsFCHHLiaHXUh', 'Bills touchdown'],
  ['3o7TKW5SaCnLmbj5OU', 'Sammy Watkins touchdown'],
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
  'THE BILLS MAKE ME WANNA SHOUT! 🦬',
  'WHERE ELSE WOULD YOU RATHER BE? ❤️💙',
  'BUFFALO ALL THE WAY! 🦬🔥',
  'JOSH ALLEN IS OUR QUARTERBACK! ❤️💙',
  'NOBODY CIRCLES THE WAGONS LIKE BUFFALO! 🦬',
  'WELCOME TO BUFFALO! ❄️🦬',
  'THE MAFIA IS EVERYWHERE! ❤️💙',
  'THIS TEAM, THIS CITY! 🦬',
  'BLUE CHEESE ONLY! ❤️💙',
  'BREAK OUT THE FOLDING TABLES! 🦬🔥',
  '17 LOOKING GOOD! ❤️💙',
  'BUFFALO VS EVERYBODY! 🦬',
  'STAMPEDE INCOMING! 🔥🦬',
  'KEEP THE WAGONS MOVING! ❤️💙',
  'ANOTHER DAY IN BILLS COUNTRY! 🦬',
  'RED, WHITE AND BUFFALO BLUE! ❤️💙',
  'THE HERD IS HERE! 🦬🔥',
  'BILLS FOOTBALL IS BACK! ❤️💙',
  'PLAY THE SHOUT SONG! 🦬',
  'BUFFALO STANDS TOGETHER! ❤️💙',
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

export async function billsGifPool() {
  const res = await fetch(GIPHY, { headers: { 'User-Agent': 'Sama-tracker' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GIPHY returned ${res.status}`);
  const html = await res.text();
  const gifs = [...html.matchAll(/\\"id\\":\\"([A-Za-z0-9]+)\\",\\"title\\":\\"([^"\\]+) (?:GIF|Sticker) by Buffalo Bills\\",\\"images\\":.*?\\"downsized\\":\{\\"url\\":\\"([^"\\]+\.gif)\\"/gs)]
    .map(([, id, name, image]) => ({ name, image, page: `https://giphy.com/gifs/${id}`, source: 'GIPHY' }));
  if (!gifs.length) throw new Error('GIPHY found no official Bills GIFs');
  return [...new Map(gifs.map((gif) => [gif.image, gif])).values()];
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

async function officialGifPool() {
  try {
    return await billsGifPool();
  } catch (err) {
    console.error('bills gifs failed:', err.message);
    return FALLBACK_GIFS;
  }
}

const pools = [cycle(billsImagePool), cycle(officialGifPool)];
let kinds = [];
let lastImage;

// upload the original bytes so gifs keep their animation
async function download(image) {
  const res = await fetch(image, { headers: { 'User-Agent': 'Sama-tracker' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Bills image returned ${res.status}`);
  const extension = new URL(image).pathname.split('.').pop().toLowerCase();
  return { attachment: Buffer.from(await res.arrayBuffer()), name: `bills.${extension}` };
}

async function takePost() {
  // one of each per round, so the larger photo pool doesn't crowd out gifs
  if (!kinds.length) kinds = [0, 1];
  const kind = kinds.splice(Math.floor(Math.random() * kinds.length), 1)[0];
  let picked;
  try {
    picked = await pools[kind]();
  } catch (err) {
    console.error('bills media failed:', err.message);
    picked = await pools[1 - kind]();
  }
  if (picked.image === lastImage) picked = await pools[kind]();
  lastImage = picked.image;
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
  description: 'Live pro-Bills photos and official GIFs with a message',
  enabled: true,
  takePost,
  format: ({ title, image, file, page, name, source }) => ({
    embeds: [embeds.funImage(title, file ? `attachment://${file.name}` : image, page, name, source)],
    files: file ? [file] : [],
  }),
};
