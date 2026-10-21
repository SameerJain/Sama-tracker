import { ApiError } from '../errors.js';
import { query } from './queue.js';

// rosters don't change, so each game's only gets fetched once
const rosters = new Map();

function roster(videogameId) {
  if (!rosters.has(videogameId)) {
    const characters = query('query ($id: ID!) { videogame(id: $id) { characters { name images(type: "icon") { url } } } }', { id: videogameId })
      .then((data) => data.videogame?.characters ?? []);
    characters.catch(() => rosters.delete(videogameId));
    rosters.set(videogameId, characters);
  }
  return rosters.get(videogameId);
}

// start.gg's icon for an ultimate character is its render, older games get a smaller portrait.
// discord can't always load images.start.gg, so this downloads it to upload with the message
export async function getCharacterArt(name, videogameId) {
  const url = (await roster(videogameId)).find((character) => character.name === name)?.images?.[0]?.url;
  if (!url) return null;

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new ApiError('start.gg', `start.gg image returned ${res.status}`, res.status);
  const extension = new URL(url).pathname.split('.').pop();
  // one per game, a verbose reply has several
  return { attachment: Buffer.from(await res.arrayBuffer()), name: `character-${videogameId}.${extension}` };
}

// discord goes by the file's extension, so it comes from what start.gg says it sent
const PICTURE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export function isStartggImage(url) {
  try {
    return new URL(url).hostname === 'images.start.gg';
  } catch {
    return false;
  }
}

// a profile or tournament picture, downloaded to upload with the message for the same reason as the art.
// name is the file's name without its extension
export async function getImage(url, name, timeout) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new ApiError('start.gg', `start.gg image returned ${res.status}`, res.status);
  const extension = PICTURE_TYPES[res.headers.get('content-type')?.split(';')[0].trim()];
  if (!extension) throw new ApiError('start.gg', `start.gg image came back as ${res.headers.get('content-type')}`);
  return { attachment: Buffer.from(await res.arrayBuffer()), name: `${name}.${extension}` };
}
