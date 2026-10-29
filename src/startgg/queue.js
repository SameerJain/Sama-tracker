import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError } from '../errors.js';

const API_URL = 'https://api.start.gg/gql/alpha';

export const ULTIMATE = 1386;
export const MELEE = 1;

export function startggUrl(slug) {
  return `https://www.start.gg/${slug}`;
}

export function chunk(list, size) {
  const groups = [];
  for (let i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size));
  return groups;
}

// start.gg allows 80 requests a minute, so one goes out every 800ms.
// requests for a command go ahead of the background checks, and commands take turns
// so one that needs a lot of pages doesn't hold up everyone else's. servers take turns first, then
// the commands inside each, so a busy server's ten commands get one turn per round like a quiet
// server's one, instead of ten
const fromCommand = new AsyncLocalStorage();
// each server with commands waiting, in turn order, holding its commands' queues in their turn order.
// a server is in here only while one of its commands has a request waiting
const servers = [];
const background = [];
let requestGap = 800;
let nextSlot = 0;
let timer;
let dispatched = 0;

// tests run through hundreds of queued requests, so commands.test.js sets this to 0.
// the rate limit itself is still covered by requests.test.js and queue.test.js on the real gap
export function setRequestGap(ms) {
  requestGap = ms;
}

// a command's queue also counts what it sent and how often start.gg said to slow down. wait, when given,
// gets called on its first request and every request waits on what it returns, which is how someone's
// next command holds its requests until their last one is done. server is the discord server it ran in,
// left out for the single-server build and tests, which all share one turn
export const asCommand = (fn, wait, server = '') => fromCommand.run(Object.assign([], { sent: 0, limited: 0, wait, server }), fn);
export const inBackground = (fn) => fromCommand.run(background, fn);
// slippi.js keeps its own line the same way
export const isBackground = () => fromCommand.getStore() === background;
const waitingIn = (list) => list.reduce((sum, queue) => sum + queue.length, 0);
export const queueLength = () => servers.reduce((sum, server) => sum + waitingIn(server), background.length);

// for the command that calls it, a function that says how many requests it has sent and has waiting, and
// about how many seconds until the last one goes out. its server's other commands get a slot for each of
// its own that's left, and every other server gets one for each of its server's turns
export function commandProgress() {
  const queue = fromCommand.getStore();
  return () => {
    if (!queue || queue === background) return { sent: 0, waiting: 0, limited: 0, seconds: 0 };
    if (!queue.length) return { sent: queue.sent, waiting: 0, limited: queue.limited, seconds: 0 };
    const home = servers.find((server) => server.id === queue.server) ?? [queue];
    const turns = home.reduce((sum, other) => sum + (other === queue ? queue.length : Math.min(other.length, queue.length)), 0);
    const elsewhere = servers.reduce((sum, server) => sum + (server === home ? 0 : Math.min(waitingIn(server), turns)), 0);
    const seconds = Math.max(0, nextSlot - Date.now()) / 1000 + ((turns + elsewhere) * requestGap) / 1000;
    return { sent: queue.sent, waiting: queue.length, limited: queue.limited, seconds };
  };
}

// a command with its first request waiting joins its server's turn, and the server joins the rotation
// if none of its commands were waiting
function lineUp(queue) {
  let server = servers.find((each) => each.id === queue.server);
  if (!server) {
    server = Object.assign([], { id: queue.server });
    servers.push(server);
  }
  server.push(queue);
}

async function takeTurn() {
  const queue = fromCommand.getStore() ?? background;
  if (queue.wait) {
    queue.turn ??= Promise.resolve(queue.wait());
    await queue.turn;
  }
  return new Promise((resolve) => {
    if (queue !== background && !queue.length) lineUp(queue);
    queue.push(resolve);
    sendNext();
  });
}

function sendNext() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    // a 429 pushed everything back since this was scheduled
    if (Date.now() < nextSlot) return sendNext();
    // commands go ahead, but every 10th slot goes to the background checks when
    // they have something waiting, so a busy night can't starve match calls
    dispatched++;
    const server = dispatched % 10 === 0 && background.length ? null : servers.shift();
    const queue = server ? server.shift() : background;
    const next = queue.shift();
    if (!next) return;
    // the command goes to the back of its server's line, and the server to the back of everyone's
    if (server) {
      queue.sent++;
      if (queue.length) server.push(queue);
      if (server.length) servers.push(server);
    }
    nextSlot = Date.now() + requestGap;
    next();
    sendNext();
  }, Math.max(0, nextSlot - Date.now()));
}

// start.gg counts as down once nothing has come back but timeouts and 5xx errors for this long, at least
// DOWN_AFTER_FAILURES times. commands then hear so right away instead of each waiting out its retries, about
// 90 seconds. background checks keep asking, and so does one command a minute, so the first answer ends it
const DOWN_AFTER_MS = 2 * 60 * 1000;
const DOWN_AFTER_FAILURES = 3;
const PROBE_EVERY_MS = 60 * 1000;
let failingSince = null;
let failures = 0;
let lastProbe = 0;

function failed() {
  failingSince ??= Date.now();
  failures++;
}

function answered() {
  failingSince = null;
  failures = 0;
}

// unix seconds start.gg has been down since, or null while it's answering
export function startggDownSince(now = Date.now()) {
  if (!failingSince || failures < DOWN_AFTER_FAILURES || now - failingSince < DOWN_AFTER_MS) return null;
  return Math.floor(failingSince / 1000);
}

// for tests
export function resetOutage() {
  answered();
  lastProbe = 0;
}

// a command's request while start.gg is down fails without waiting, except one a minute that goes through to
// see if it's back. background checks and anything outside a command always go through
function skipWhileDown() {
  const queue = fromCommand.getStore();
  if (!queue || queue === background || !startggDownSince()) return false;
  if (Date.now() - lastProbe >= PROBE_EVERY_MS) {
    lastProbe = Date.now();
    return false;
  }
  return true;
}

// a background check runs every server's part back to back, so the same question from two servers in one pass,
// like the stream queue of a tournament both track, gets asked once. it's the same request, so it's the same
// answer whichever server asked. each caller gets its own copy, so one server changing what it got can't change
// another's. a pass is one check, so nothing is kept longer than that
const sharedPass = new AsyncLocalStorage();
export const sharingAcrossServers = (fn) => sharedPass.run(new Map(), fn);
export const isSharing = () => Boolean(sharedPass.getStore());

// variables can be a function, which gets called once it's this request's turn. those are never shared, since
// what they ask for isn't known until then
export function query(text, variables, retries = 2) {
  const shared = sharedPass.getStore();
  if (!shared || typeof variables === 'function') return ask(text, variables, retries);
  const key = JSON.stringify([text, variables ?? null]);
  let answer = shared.get(key);
  if (!answer) {
    answer = ask(text, variables, retries);
    shared.set(key, answer);
    // the next server asks again instead of getting the same failure
    answer.catch(() => {
      if (shared.get(key) === answer) shared.delete(key);
    });
  }
  return answer.then((data) => structuredClone(data));
}

// retries come back here, never through query, which would have them wait on their own shared answer
async function ask(text, variables, retries) {
  if (skipWhileDown()) throw new ApiError('start.gg', 'start.gg is down, so this wasn\'t sent');
  await takeTurn();

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.STARTGG_TOKEN}`,
      },
      body: JSON.stringify({ query: text, variables: typeof variables === 'function' ? variables() : variables }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    failed();
    // a slow request can time out even when start.gg is fine, so those retry within the same budget
    if (retries > 0) return ask(text, variables, retries - 1);
    throw new ApiError('start.gg', `start.gg didn't respond (${err.message})`);
  }
  if (res.status >= 500) failed();
  else answered();
  // still got limited, probably another copy running on the same token. everything waits
  if (res.status === 429 && retries > 0) {
    const queue = fromCommand.getStore();
    if (queue && queue !== background) queue.limited++;
    nextSlot = Date.now() + 15_000;
    return ask(text, variables, retries - 1);
  }
  // start.gg's servers hiccup now and then, so a 502 gets the same retries as a timeout
  if (res.status >= 500 && retries > 0) return ask(text, variables, retries - 1);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError('start.gg', `start.gg: ${body.message ?? `HTTP ${res.status}`}`, res.status);
  if (body.errors) throw new ApiError('start.gg', `start.gg: ${body.errors[0].message}`, res.status);
  return body.data;
}

// getPage(n) resolves to { totalPages, ... }. page 1 says how many there are, then the rest get asked
// for at once. the rate limit spaces them out, so nothing waits on the response before it
export async function allPages(getPage) {
  const first = await getPage(1);
  const rest = [];
  for (let page = 2; page <= first.totalPages; page++) rest.push(getPage(page));
  return [first, ...await Promise.all(rest)];
}

// start.gg's 1000 object limit counts what comes back, so a size that fits most players can still go over
// for one with more on their sets. getPage(page, perPage) resolves to { totalPages, nodes, ... }. a page that
// goes over gets asked for again as smaller pages covering the same sets, 40 as two 20s, 30 as two 15s and
// 15 as three 5s, so callers keep the page numbers they asked for. anything else on the page comes from its
// first part, which is the same page 1 when it's page 1
export async function fitPage(getPage, page, perPage) {
  try {
    return await getPage(page, perPage);
  } catch (err) {
    if (perPage <= 5 || !err.message.includes('complexity')) throw err;
    let parts = 2;
    while (perPage % parts) parts++;
    const size = perPage / parts;
    const pieces = await Promise.all(Array.from({ length: parts }, (_, i) => fitPage(getPage, (page - 1) * parts + i + 1, size)));
    return {
      ...pieces[0],
      totalPages: Math.ceil(Math.max(...pieces.map((piece) => piece.totalPages)) / parts),
      nodes: pieces.flatMap((piece) => piece.nodes),
    };
  }
}

// lookups that came back empty, so a retried typo or dead link doesn't cost a
// request every time. 5 minutes, room for a few hundred. cleared lookups just ask again
export const MISS_CACHE_MS = 5 * 60 * 1000;
const MISS_CACHE_SIZE = 300;
export const missedCache = new Map();
export function miss(key) {
  missedCache.delete(key);
  missedCache.set(key, Date.now());
  for (const old of [...missedCache.keys()].slice(0, -MISS_CACHE_SIZE)) missedCache.delete(old);
}
// for tests, which change who's registered between cases
export const forgetMisses = () => missedCache.clear();

// ids go straight into the query text, so only numeric start.gg ids get through
export function cleanId(id) {
  const text = String(id);
  if (!/^\d+$/.test(text)) throw new Error('bad start.gg id');
  return text;
}

// one field per id for a lookupMany query, named by prefix and id so the reply reads back by id,
// like p123: player(id: 123) { ... }
export function aliases(group, prefix, field, body) {
  return group.map((id) => `${prefix}${cleanId(id)}: ${field}(id: ${cleanId(id)}) { ${body} }`).join('\n');
}

// a bunch of lookups per request, aliased by id. start.gg's 1000 object limit counts what comes back
// and most checks come back empty, so groups start big and get split in half when they go over
export async function lookupMany(ids, toQuery, variables, size = 20) {
  const results = await Promise.all(chunk(ids, size).map((group) => lookupGroup(group, toQuery, variables)));
  return Object.assign({}, ...results);
}

async function lookupGroup(group, toQuery, variables) {
  try {
    return await query(toQuery(group), variables);
  } catch (err) {
    if (group.length === 1 || !err.message.includes('complexity')) throw err;
    const half = Math.ceil(group.length / 2);
    const [a, b] = await Promise.all([group.slice(0, half), group.slice(half)].map((each) => lookupGroup(each, toQuery, variables)));
    return { ...a, ...b };
  }
}

export async function checkToken() {
  await query('{ currentUser { id } }');
}

// start.gg refusing the token itself, which never fixes itself. anything else, like a timeout or a 502, can
export const badToken = (err) => err instanceof ApiError && err.source === 'start.gg' && [401, 403].includes(err.status);

// { totalPages, nodes } out of a paginated start.gg connection, which is null if what it's on is gone
export function connectionPage(connection) {
  return { totalPages: connection?.pageInfo?.totalPages ?? 0, nodes: connection?.nodes ?? [] };
}

// a getPage for fitPage: the query with page and perPage added to its variables, and pick finding the
// connection in the reply
export function pagesOf(text, variables, pick) {
  return async (page, perPage) => connectionPage(pick(await query(text, { ...variables, page, perPage })));
}
