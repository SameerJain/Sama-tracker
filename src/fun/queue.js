import { state, save } from '../store.js';

const QUEUE_SIZE = 3;

// posts made ahead of time so a command replies right away, kept full for busy servers. finished ones are saved
// in state.funQueue under the command's name, without their file bytes, so a restart serves them instead of
// throwing away paid-for posts. make() resolves to a new post, toSaved(post) is the part of it that gets saved,
// and fromSaved(entry) gets the post back from that, or null for an entry that can't be used anymore
export function postQueue(name, { make, toSaved, fromSaved }) {
  const queue = [];
  let nextId = 0;

  // a failed save only costs the queue surviving a restart
  function saveQueue(entries) {
    try {
      state.funQueue[name] = entries;
      save();
    } catch (err) {
      console.error(`${name} queued post save failed:`, err.message);
    }
  }

  function persist(id, post) {
    const saved = state.funQueue[name] ?? [];
    // a retry after a save failure shouldn't pile up the same post
    if (!saved.some((each) => each.id === id)) saved.push({ id, ...toSaved(post) });
    saveQueue(saved.slice(-QUEUE_SIZE));
  }

  function unpersist(id) {
    const saved = state.funQueue[name];
    if (saved?.some((each) => each.id === id)) saveQueue(saved.filter((each) => each.id !== id));
  }

  function add(id, post) {
    post.catch(() => {}); // handled in take
    queue.push({ id, post });
  }

  // the posts the run before this one saved. corrupt entries are dropped
  function restore() {
    const saved = state.funQueue[name] ?? [];
    const kept = [];
    for (const entry of saved.slice(-QUEUE_SIZE)) {
      const post = typeof entry?.id === 'number' ? fromSaved(entry) : null;
      if (!post) continue;
      kept.push(entry);
      nextId = Math.max(nextId, entry.id + 1);
      add(entry.id, post);
    }
    if (kept.length !== saved.length) saveQueue(kept);
  }

  function fill() {
    while (queue.length < QUEUE_SIZE) {
      const id = nextId++;
      add(id, make().then((post) => {
        persist(id, post);
        return post;
      }));
    }
  }

  // the persist above lands before the removal here, so a post taken while it's still being made saves and
  // then removes itself instead of lingering. one that failed gets made again now
  function take() {
    const next = queue.shift() ?? { post: make() };
    fill();
    const post = next.id === undefined ? next.post : next.post.finally(() => unpersist(next.id));
    return post.catch(make);
  }

  return { restore, fill, take };
}
