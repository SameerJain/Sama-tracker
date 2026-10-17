// youtube data api, for the joke posts. needs a key, and searches cost 100 of the 10,000 a day it allows,
// so each search's results get reused for a day
const API = 'https://www.googleapis.com/youtube/v3';
// links, sponsors and socials are most of a description, so only the start is worth sending
const DESCRIPTION_CHARS = 500;
// anything under this is usually someone's upload of their own set, which nobody else would know
const MIN_VIEWS = 10_000;

export const enabled = () => Boolean(process.env.YOUTUBE_API_KEY);

async function get(path, params) {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key: process.env.YOUTUBE_API_KEY })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return body;
}

// the top 50 for a search, with the whole description and view count, which search leaves out.
// only the well known ones if there are any
export async function searchVideos(q) {
  const found = await get('search', { part: 'snippet', type: 'video', q, maxResults: '50', relevanceLanguage: 'en' });
  const ids = (found.items ?? []).map((item) => item.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const { items = [] } = await get('videos', { part: 'snippet,statistics', id: ids.join(',') });
  const videos = items.map(({ snippet, statistics }) => ({
    title: snippet.title,
    channel: snippet.channelTitle,
    year: snippet.publishedAt.slice(0, 4),
    views: Number(statistics?.viewCount ?? 0),
    description: description(snippet.description ?? ''),
  }));
  const known = videos.filter((video) => video.views >= MIN_VIEWS);
  return known.length ? known : videos;
}

// without the link and hashtag lines. timestamps stay, they say what's in it
function description(text) {
  const kept = text.split('\n').map((line) => line.trim()).filter((line) => line && !/https?:\/\/|www\./.test(line) && !/^(#\S+\s*)+$/.test(line));
  const joined = kept.join(' ');
  return joined.length > DESCRIPTION_CHARS ? `${joined.slice(0, joined.lastIndexOf(' ', DESCRIPTION_CHARS))}…` : joined;
}
