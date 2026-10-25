import { state, save } from '../store.js';

// posts made ahead of time so a command replies right away, kept full for busy servers. finished ones are saved
// in state.funQueue under the command's name, without their file bytes, so a restart serves them instead of
// throwing away paid-for posts. make() resolves to a new post, toSaved(post) is the part of it that gets saved,
// and fromSaved(entry) gets the post back from that, or null for an entry that can't be used anymore
export function postQueue(name, { make, toSaved, fromSaved, size = 3 }) {
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
    saveQueue(saved.slice(-size));
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
    for (const entry of saved.slice(-size)) {
      const post = typeof entry?.id === 'number' ? fromSaved(entry) : null;
      if (!post) continue;
      kept.push(entry);
      nextId = Math.max(nextId, entry.id + 1);
      add(entry.id, post);
    }
    if (kept.length !== saved.length) saveQueue(kept);
  }

  // saved once it's done, unless it was taken or handed over while it was still being made
  function queueUp(post) {
    const id = nextId++;
    add(id, post.then((done) => {
      if (queue.some((each) => each.id === id)) persist(id, done);
      return done;
    }));
  }

  function fill() {
    while (queue.length < size) queueUp(make());
  }

  // the posts waiting here, oldest first, for another queue to take over. this one forgets them
  function handOver(count) {
    const given = queue.splice(0, Math.max(0, count));
    for (const { id } of given) unpersist(id);
    return given.map(({ post }) => post);
  }

  // fills the empty spots with the other queue's waiting posts, each passed through change(post) on the way,
  // like a language switch rewriting them
  function takeOver(other, change) {
    for (const post of other.handOver(size - queue.length)) queueUp(post.then(change));
  }

  // another server still needs the old language, so leave its posts there and rewrite copies for this one
  function copyOver(other, change) {
    for (const post of other.copy(size - queue.length)) queueUp(post.then(change));
  }

  function copy(count) {
    return queue.slice(0, Math.max(0, count)).map(({ post }) => post);
  }

  // one that failed gets made again now
  function take() {
    const next = queue.shift() ?? { post: make() };
    fill();
    const post = next.id === undefined ? next.post : next.post.finally(() => unpersist(next.id));
    return post.catch(make);
  }

  return { restore, fill, take, handOver, takeOver, copy, copyOver };
}
