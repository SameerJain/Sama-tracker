# Tournament Switches and Next Opponents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/t-o settings` becomes the live default for every tournament, `/t-o tournament posts` overrides it per tournament, and a new next-opponent card runs on both plus `/notify next`.

**Architecture:** One resolver, `postsOn(type, tournament, dueAt)`, answers "is this kind on here" from a tournament's saved overrides, falling back to the server switch, read at each check. Every tournament post path calls it instead of `messageEnabled` or the old saved switches. Next opponents is a new tracker module beside `calls.js`, fed by two new start.gg lookups.

**Tech Stack:** Node 22 ES modules, discord.js, `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-tournament-switches-and-next-opponents-design.md`

## Global Constraints

- Follow AGENTS.md. Verify with `npm test`, never `npm start` or `npm run dev`. No commits or pushes: Samatron commits.
- Every `t` line needs Spanish in `src/i18n/es/`, and lines nothing says anymore come out. `node scripts/spanish.js` lists both. Whole sentences only, no fragments passed in as values.
- Discord limits: names ≤ 32 lowercase, descriptions and choice names ≤ 100, 25 options a level. `test/definitions.test.js` checks.
- Tournament kinds, in this order everywhere: `sets`, `streams`, `calls`, `next`, `top8`, `registration`. All start on server-wide. `events` and `bills` stay off by default.
- Off means nobody: no card of that kind from that tournament and no pings.
- Caps: `nextPosted` 1000, `nextPosts` 200. Next-opponent cards are watched 60 minutes.
- Unplayed set states are `[1, 4, 6, 7]`. Soonest order is called 6, queued 7, ready 4, waiting 1, then round, then set id.
- Style per AGENTS.md: short lowercase why-comments, no JSDoc, 2 spaces, single quotes, `export { ... }` at the bottom of command modules.

## Review Focus

1. **start.gg ignoring the state filter.** If `player.sets` or a test fake hands back finished sets, no next-opponent card may post for them. Task 5 filters by state and tests it.
2. **Abandoned brackets.** `player.sets` returns sets left unplayed years ago (the probe found one 791 days old). Only sets from tournaments going on now count. Task 5 tests a stale set.
3. **Restarts and repeat checks.** A second check with the same data posts nothing. Task 5 runs the check twice.
4. **Overrides surviving restarts.** A TO's `sets:on` override equals the old fixed value, so a migration that ran every startup would erase it. Task 1 runs the migration twice.
5. **Doubles.** Two player ids a side: the pairing key, the pings for all four and no Head to head button. Task 5 tests one.

---

### Task 1: The resolver, saved overrides and the migration

**Files:**
- Modify: `src/message-settings.js`, `src/store.js` (schema comment, `emptyGuild`), `src/tracker/shared.js` (`posting`), `src/tracker/maintenance.js` (`trackTournament`, `migrateTracking`), `test/fixtures.js` (`tracked`)
- Create: `test/switches.test.js` (copy the preamble from `test/to.test.js`, including its `run` helper)

**Interfaces:**
- Produces: `MESSAGE_TYPES.next = 'Next opponents'`, inserted after `calls`.
- Produces: `TOURNAMENT_POSTS = ['sets', 'streams', 'calls', 'next', 'top8', 'registration']` from message-settings.js.
- Produces: `postsOn(type, tournament = null, dueAt) -> boolean` from message-settings.js.
- Produces: `posting(tournament, kind) -> boolean` keeps its name and now means `Boolean(tournament?.tracked) && postsOn(kind, tournament)`.
- Produces: tracked shape `{ by, at, posts: { [kind]: boolean }, onAt: { [kind]: seconds }, schedule? }`. `trackTournament` saves `posts: {}` and no switch fields.
- Produces: `migrateTournamentPosts()` exported from maintenance.js, called inside `migrateTracking`.
- Produces: `emptyGuild` gains `nextPings: []`, `nextPosted: []` and `nextPosts: []`, used by Tasks 5 and 6.

- [ ] **Step 1: Write the failing tests in `test/switches.test.js`**

```js
test('a tournament with no override follows the server switch, live', () => {
  const tournament = { tracked: { by: 'manual', at: 0, posts: {} } };
  state.messages = {};
  assert.equal(postsOn('streams', tournament), true);
  state.messages = { streams: false };
  assert.equal(postsOn('streams', tournament), false);
  assert.equal(posting(tournament, 'streams'), false);
});

test('a tournament override beats the server switch either way', () => {
  state.messages = { streams: false, sets: true };
  const tournament = { tracked: { by: 'manual', at: 0, posts: { streams: true, sets: false } } };
  assert.equal(postsOn('streams', tournament), true);
  assert.equal(postsOn('sets', tournament), false);
});

test('an override turned on skips what came due before it, and the default skips by enabledAt', () => {
  const tournament = { tracked: { by: 'manual', at: 0, posts: { sets: true }, onAt: { sets: 1000 } } };
  assert.equal(postsOn('sets', tournament, 999), false);
  assert.equal(postsOn('sets', tournament, 1000), true);
  state.messages = { enabledAt: { sets: 500 } };
  assert.equal(postsOn('sets', null, 499), false);
});

test('next opponents and match calls start on server-wide', () => {
  state.messages = {};
  assert.equal(postsOn('next'), true);
  assert.equal(postsOn('calls'), true);
});

test('old saved switches move to overrides only where a TO changed them, once', () => {
  state.tournaments = {
    1: { id: 1, tracked: { by: 'manual', at: 0, sets: true, stream: true, top8: true, reminders: true, calls: false } },
    2: { id: 2, tracked: { by: 'manual', at: 0, sets: false, stream: true, top8: true, reminders: false, calls: true } },
    3: { id: 3, tracked: { by: 'admin', at: 0, sets: true, stream: true, top8: true, reminders: true } },
  };
  migrateTournamentPosts();
  assert.deepEqual(state.tournaments[1].tracked, { by: 'manual', at: 0, posts: {} });
  assert.deepEqual(state.tournaments[2].tracked.posts, { sets: false, registration: false, calls: true });
  assert.deepEqual(state.tournaments[3].tracked.posts, {});
  // a TO's sets:on made after the move survives the next startup
  state.tournaments[1].tracked.posts.sets = true;
  migrateTracking();
  assert.deepEqual(state.tournaments[1].tracked.posts, { sets: true });
});
```

- [ ] **Step 2: Run them**

Run: `node --test test/switches.test.js`
Expected: FAIL, `postsOn` is not exported.

- [ ] **Step 3: Implement**

`postsOn` reads `tournament?.tracked?.posts?.[type]`. When that is `false` it returns false. When it is `true` it returns `dueAt == null || dueAt >= (tracked.onAt?.[type] ?? 0)`. With no override it returns `messageEnabled(type, dueAt)`.

`migrateTournamentPosts` changes only tracked tournaments that have no `posts` yet. It maps old names to new ones with the old fixed value: `sets→sets true`, `stream→streams true`, `calls→calls false`, `top8→top8 true`, `reminders→registration true`. It keeps a boolean that differs from the fixed value, deletes the old field, and keeps `by`, `at` and `schedule`. Delete the `tracked.calls ??= false` line from `migrateTracking`. Change the fixtures' `tracked` to `{ by: 'manual', at: 0, posts: {} }`. Rewrite the store.js schema comment for `tracked` and the three new keys.

- [ ] **Step 4: Run them**

Run: `node --test test/switches.test.js`
Expected: PASS. The full suite still fails until Task 2.

---

### Task 2: Every existing post goes by the resolver

**Files:**
- Modify: `src/tracker/shared.js` (`post`, `sendPinging`), `src/tracker/sets.js`, `src/tracker/streams.js`, `src/tracker/calls.js`, `src/tracker/reminders.js`, `src/tracker/tournaments.js`
- Modify tests that build old-shape `tracked` objects or flip `tracked.<kind>`: `misclicks`, `registration`, `event`, `dm`, `messages`, `features-tournaments`, `scale`, `profile`, `threads`, `features-reminders`, `features-sets`, `players`. Find them with `grep -n "tracked\.\(sets\|stream\|calls\|top8\|reminders\)\|stream: \(true\|false\)\|reminders: \(true\|false\)" test`.
- Test: `test/switches.test.js`

**Interfaces:**
- Consumes: `postsOn`, `posting`, `TOURNAMENT_POSTS` (Task 1), `trackedFor(set)` (existing).
- Produces: `sendPinging(postChannel, stillOn, ids, text, embed, components = [])`, where `stillOn` is `() => boolean` and replaces the `type` argument.
- Produces: `post(list, type, dueAt, postChannel = currentChannel(), tournament = null)`, which checks `postsOn(type, tournament, dueAt)` for tournament kinds and `messageEnabled` for the rest.

| Call site | Becomes |
| --- | --- |
| sets.js set loop `messageEnabled('sets', set.completedAt)` | `postsOn('sets', trackedFor(set), set.completedAt)`, so a tracked tournament with sets off silences `/track posts` players there too |
| streams.js `posting(tournament, 'stream')` (2) | `posting(tournament, 'streams')` |
| streams.js `messageEnabled('streams', wentLiveAt(set))` (2) | `postsOn('streams', trackedFor(set))`, no due time. Delete `wentLiveAt` |
| streams.js `streamedNow` player-alert sets | kept only when `postsOn('streams', trackedFor(set))` |
| calls.js `messageEnabled('calls', set.updatedAt)` (3) | `postsOn('calls', trackedFor(set))`, or `postsOn('calls', tournament)` in the tracked loop |
| calls.js `trackedLive('calls').filter(... === true)` | `trackedLive('calls')` |
| reminders.js `posting(tournament, 'reminders')` (2) | `posting(tournament, 'registration')` |
| reminders.js `messageEnabled('registration', dueAt)` | `postsOn('registration', tournament, dueAt)` |
| tournaments.js `posting(..., 'top8')` with `messageEnabled('top8', x)` | `posting(tournament, 'top8') && postsOn('top8', tournament, x)`, the same at each top 8 site, `verifyTopEight` included |
| `post(...)` and `editPosts` with `'top8'` | pass the tournament |

- [ ] **Step 1: Write the failing tests**

```js
test('server streams turned on mid-set announces a set already on stream', async () => {
  // a tracked live tournament, its queue has a set on stream that went live before streams came on
  state.messages = { streams: true, enabledAt: { streams: now } };
  await tracker.postStreamAlerts(channel, 0);
  assert.equal(sent.length, 1);
});

test('a tracked tournament with sets off posts nothing from it, even for /track posts players', async () => {
  state.tournaments[7].tracked.posts = { sets: false };
  await tracker.postNewSets(channel);
  assert.equal(sent.length, 0);
});

test('a tracked tournament posts every called set by default', async () => {
  state.messages = {};
  await tracker.postMatchCalls(channel);
  assert.equal(sent.length, 1);
});

test('registration off for a tournament stops its 1-hour DMs too', async () => {
  state.tournaments[7].tracked.posts = { registration: false };
  await tracker.postDmReminders(channel);
  assert.equal(dmsSent, 0);
});
```

Build each test's fake start.gg the way `test/features-sets.test.js` and `test/dm.test.js` do for stream queues, event sets, called sets and registrations.

- [ ] **Step 2: Run them**

Run: `node --test test/switches.test.js`
Expected: FAIL, since the old code still reads `tracked.stream` and the server switch skips.

- [ ] **Step 3: Apply the table and update the old-shape tests**

In existing tests, `tracked.calls = true` becomes `tracked.posts.calls = true`, and so on with the new names. Change the `messages.test.js` case "turning match calls back on skips what came due" to assert that a called set still called after `calls` comes back on does post. The skip still holds for `sets`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS except Spanish for Task 3's lines, which is fine until then. Fix any `no fake for` by adding a branch that returns empty sets.

---

### Task 3: The TO commands show and change both levels

**Files:**
- Modify: `src/commands/definitions.js`, `src/commands/tournaments.js`, `src/commands/settings.js` (`settingsText`), `src/embeds/system.js` (the `/track list` tournament lines at the top, plus help lines for `/t-o tournament add`, `/t-o tournament posts` and `/t-o settings`)
- Modify: `src/i18n/es/definitions.js`, `src/i18n/es/commands.js`, `src/i18n/es/settings.js`, `src/i18n/es/help.js`
- Test: `test/switches.test.js`, plus the existing `/t-o tournament` cases in `test/misclicks.test.js` and `test/features-tournaments.test.js`

**Interfaces:**
- Consumes: `postsOn`, `TOURNAMENT_POSTS`, the tracked shape (Task 1).
- Produces: `overrideOption(name, description)` in definitions.js, a String option with choices `on`, `off` and `default`.
- Produces: `/t-o tournament posts` options `tournament` (required), `sets`, `streams`, `calls`, `next`, `top8`, `registration` and `schedule`. `/t-o tournament add` renames `reminders` to `registration`.
- Produces: `postsText(tournament)` lists each kind as one of four whole strings: `on`, `off`, `on (default)` or `off (default)`.

Exact text:
- Subcommand `posts`: `What one tracked tournament posts. default follows /t-o settings. Leave all out to see`
- `sets`: `Every finished set` · `streams`: `Every set on stream or up next in the stream queue` · `calls`: `Every set the TO calls on start.gg` · `next`: `Each next opponent once both players are known, round 1 left out` · `top8`: `Each event's top 8 once the bracket is finished` · `registration`: `Reg reminders, plus 1-hour DMs for people with /notify on`
- `/t-o tournament add registration`: `Reg reminders and 1-hour DMs. Leave out to follow /t-o settings`
- `/t-o settings` options for tournament kinds: `${label} on or off, the default for every tournament`. Everything else keeps `${label} on or off`.
- Reply footnote: `-# default follows /t-o settings, which every tournament without its own setting goes by`
- Remove question: `Stop tracking ${name}? Everything it posts stops.`
- `settingsText` footnotes, replacing "Posts missed while a message type is off...":
  - `-# Set results, stream alerts, match calls, next opponents, top 8s and reg reminders here are the default for every tournament. /t-o tournament posts changes one tournament.`
  - `-# Stream alerts, match calls and next opponents still going on post when switched back on. Anything else missed while off stays skipped. Recap schedule changes apply to future recaps.`

- [ ] **Step 1: Write the failing tests**, through `run('t-o', 'to-discord', { group: 'tournament', subcommand: 'posts', values })`

```js
test('/t-o tournament posts saves an override, and default drops it', async () => {
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', streams: 'off' } });
  assert.deepEqual(state.tournaments[7].tracked.posts, { streams: false });
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', streams: 'default' } });
  assert.deepEqual(state.tournaments[7].tracked.posts, {});
});

test('/t-o tournament posts with nothing picked marks the kinds following the server', async () => {
  state.tournaments[7].tracked.posts = { calls: false };
  const { content } = said(await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local' } }));
  assert.match(content, /\*\*Match calls:\*\* off(?! \(default\))/);
  assert.match(content, /\*\*Stream alerts:\*\* on \(default\)/);
});

test('turning sets on for one tournament starts from now, through either level', async () => {
  state.messages = { sets: false };
  await run('t-o', to, { group: 'tournament', subcommand: 'posts', values: { tournament: 'local', sets: 'on' } });
  assert.ok(state.tournaments[7].tracked.onAt.sets >= now);
});

test('/t-o tournament add registration:off saves an override, and leaving it out saves none', async () => {
  // getRegistration fake answers two tournaments, 7 and 8
  await run('t-o', to, { group: 'tournament', subcommand: 'add', values: { tournament: 'local', registration: 'off' } });
  assert.deepEqual(state.tournaments[7].tracked.posts, { registration: false });
  await run('t-o', to, { group: 'tournament', subcommand: 'add', values: { tournament: 'weekly' } });
  assert.deepEqual(state.tournaments[8].tracked.posts, {});
});
```

- [ ] **Step 2: Run them**

Run: `node --test test/switches.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`tournamentPosts` compares `postsOn(kind, tournament)` before and after. A kind that goes from off to on sets `tracked.onAt[kind] = now`. `sets` also sets `tournament.lastCheck = now`, and `registration` deletes `reminder.next`, as today. `trackLines` builds its reply from `postsText` instead of the fixed sentence. Add Spanish, and remove the Spanish for lines nothing says anymore (`Every set`, `stream alerts off`, the old footnotes).

- [ ] **Step 4: Run them**

Run: `node --test test/switches.test.js test/definitions.test.js test/misclicks.test.js test/features-tournaments.test.js && node scripts/spanish.js`
Expected: PASS, and the Spanish script lists nothing for these files.

---

### Task 4: start.gg lookups for unplayed sets

**Files:**
- Modify: `src/startgg/sets.js`, `src/startgg.js` (exports)
- Test: `test/startgg.test.js`

**Interfaces:**
- Produces: `UNPLAYED_STATES = [1, 4, 6, 7]` exported from sets.js and startgg.js.
- Produces: `toSet` adds `roundNumber: node.round ?? null` and `groupId: node.phaseGroup?.id ?? null`. `event.tournament` passes `startAt` and `endAt` through when asked for.
- Produces: `getNextSets(playerIds) -> Promise<Set[]>`: `player.sets(perPage: 4, page: 1, filters: { state: UNPLAYED_STATES })` per player, 20 a request through `lookupMany`, deduped by id, both slots filled.
- Produces: `getUnplayedEventSets(eventIds) -> Promise<Set[]>`: every unplayed set in these events, `showByes: false`, 40 a page, all pages, through `setsInEvents` with a `{ fields, perPage }` argument.
- Produces: `getSetPairings(setIds) -> Promise<Map<id, { state, playerIds: number[][] } | null>>`: 50 a request, with `state` and each slot's participant player ids. Null when deleted.
- The fields for unplayed sets leave out `games`, `vodUrl` and slot `standing`. They add `round`, `startAt`, `phaseGroup { id }` and `event.tournament { startAt endAt }`. That's about 15 objects a set, so 40 a page is about 600.

- [ ] **Step 1: Write the failing tests**

```js
test('getNextSets asks for unplayed sets and keeps only filled ones', async () => {
  // fake answers p10 with one filled waiting set and one with an empty slot
  const sets = await startgg.getNextSets([10]);
  assert.deepEqual(sets.map((set) => [set.id, set.roundNumber, set.state]), [['501', 2, 1]]);
  assert.deepEqual(lastVariables.filters, { state: [1, 4, 6, 7] });
});

test('getUnplayedEventSets reads every page at 40 a page', async () => { /* totalPages 2, both read, perPage 40 */ });

test('getSetPairings gives each set its players by side, null once deleted', async () => {
  const pairings = await startgg.getSetPairings(['501', '502']);
  assert.deepEqual(pairings.get('501'), { state: 1, playerIds: [[10], [20]] });
  assert.equal(pairings.get('502'), null);
});
```

- [ ] **Step 2: Run them**

Run: `node --test test/startgg.test.js`
Expected: FAIL, not exported.

- [ ] **Step 3: Implement as listed under Interfaces.**

- [ ] **Step 4: Run them**

Run: `node --test test/startgg.test.js test/requests.test.js`
Expected: PASS.

---

### Task 5: Next-opponent posts

**Files:**
- Create: `src/tracker/next.js`
- Modify: `src/embeds/tournaments.js` (`nextOpponent`), `src/embeds/index.js`, `src/tracker.js` (exports), `src/tracker/maintenance.js` (`checkSets`), `src/tracker/shared.js` (constants), `src/i18n/es/embeds.js`, `src/i18n/es/tracker.js`
- Create: `test/next.test.js` (the preamble from `test/features-sets.test.js`)

**Interfaces:**
- Consumes: `getNextSets`, `getUnplayedEventSets`, `getSetPairings`, `UNPLAYED_STATES` (Task 4). `postsOn`, `posting`, `trackedLive`, `trackedFor`, `eventsOf`, `endTime`, `RUNS_LATE_HOURS` (existing or Task 1). `sendPinging` (Task 2). `tournamentPosts`, `h2hRow`, `rememberButton`, `linkedPlayer`, `editPost`, `mentions`, `postRefs` (existing).
- Produces: `nextOpponent(set, players) -> EmbedBuilder`. Color `colors.live`, title `Next opponent · ${me} vs ${them}`, URL `setUrl(set)`. The first description line gets ` · **Station N**` when there's a station and ` · <t:startAt:t>` when `startAt` is in the future. Share the station code with `matchCall`.
- Produces: `postNextOpponents(postChannel = currentChannel())` and `followNextOpponents(postChannel = currentChannel())`.
- Produces: `NEXT_WATCH_MINUTES = 60` in tracker/shared.js.
- Produces: `pairKey(setId, playerIdsBySide) -> string`, internal to next.js. It's `${setId}:${sideA}:${sideB}`, each side being its sorted player ids joined by `+`, with the two sides sorted too. Posting builds it from `set.sides.map((side) => side.playerIds)` and the follow-up from `getSetPairings`' `playerIds`, so the two always compare.
- Saves: `state.nextPosted` holds pairing keys, and `state.nextPosts` holds `{ setId, key, channelId, messageId, at, discordIds, text }`.

`postNextOpponents`:
1. Make no request when nobody has `nextPings` and no tracked tournament is live with `next` on.
2. Candidates come from `getNextSets` for the `/notify next` people, the way `callers()` works in calls.js, plus `getUnplayedEventSets` for each `trackedLive('next')` tournament's started, unfinished events. Keep a candidate only when its state is in `UNPLAYED_STATES` and its tournament is going on: `startAt <= now <= endTime + RUNS_LATE_HOURS`.
3. Soonest: group by event slug and player id, sort by the order in Global Constraints, then by `Math.abs(roundNumber)`, then `Number(id)`. A set is eligible when it's first for either of its players.
4. For each eligible set: `tournament = trackedFor(set)` and `ids` = the `/notify next` people in it. Skip when `!postsOn('next', tournament)`, or when it's round 1 at a tracked tournament with no ids, or when it's at an untracked tournament with no ids. A key already posted sends again only to ids not yet in its `nextPosts` entry. Otherwise send with `sendPinging(tournamentPosts(set, postChannel), () => postsOn('next', trackedFor(set)), ids, t('Next opponent'), embeds.nextOpponent(set, people), h2hRow(set, fallback))`. Then `rememberButton`, save the watch and the key, and save per set.

`followNextOpponents` drops watches older than 60 minutes and asks `getSetPairings` once for the rest:
- Deleted, in progress or done: stop watching.
- Both slots filled with a different key: edit the post to content `${mentions} ~~${text}~~ ${t('Changed by the TO, the new pairing posts next')}`, with `components: []` and `allowedMentions: { parse: [] }`, then stop watching.
- A slot empty: keep watching.

`checkSets` runs `followNextOpponents()` and then `postNextOpponents()` after `followCalls()`.

- [ ] **Step 1: Write the failing tests in `test/next.test.js`**

```js
test('a /notify next person gets their first opponent with a ping, at an untracked tournament', ...)
  // getNextSets fake: one round 1 waiting set with player 10. assert one send, content '<@d10> Next opponent', title 'Next opponent · Active vs Opponent'
test('a tracked tournament posts everyone\'s next opponent but leaves round 1 out', ...)
  // getUnplayedEventSets fake: a round 1 set and a round 2 set, nobody pinged. assert only the round 2 card
test('round 1 at a tracked tournament still posts for someone with /notify next on', ...)
test('a round-robin player gets their soonest set only, and the next once they play it', ...)
  // three filled waiting sets for player 10, rounds 1-3, group the same. assert round 1 only (with a ping). then drop it from the fake and run again: round 2 posts
test('next off for a tournament posts nothing there, pings included', ...)
test('the same check twice posts once', ...)
test('a finished set from start.gg is never a next opponent', ...)            // Review Focus 1
test('an unplayed set from a tournament long over is left out', ...)           // Review Focus 2, tournament startAt 791 days ago
test('doubles pings all four with no Head to head button', ...)                // Review Focus 5
test('turning /notify next on catches a card already posted, pinging just them', ...)
test('a pairing the TO changes gets crossed out and the new one posts', ...)
  // post, then getSetPairings says another player id in side 2: followNextOpponents edits with the cross-out, postNextOpponents posts the new key
test('a set that empties and fills again with the same players posts once', ...)
```

- [ ] **Step 2: Run them**

Run: `node --test test/next.test.js`
Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement as listed above, with Spanish for `Next opponent`, the title and the cross-out line**

- [ ] **Step 4: Run them**

Run: `node --test test/next.test.js test/colors.test.js test/buttons.test.js`
Expected: PASS.

---

### Task 6: `/notify next`

**Files:**
- Modify: `src/commands/definitions.js`, `src/commands/settings.js` (`PINGS`, `notifyText`, `changePings`, `notifyEveryone`, the server-off footnote), `src/embeds/system.js` (help), `src/i18n/es/*.js`
- Test: `test/next.test.js`, `test/misclicks.test.js` ("changes all five" becomes six)

**Interfaces:**
- Consumes: `state.nextPings` (Task 1), `postsOn` (Task 1).
- Produces: `PINGS.next = { list: 'nextPings', ... }`, right after `calls`. `PING_ORDER` grows to 6, so the button code is 6 characters.
- `/notify` description: `Your pings for calls, next opponents, streams, reg reminders and 1-hour DMs. TOs can set anyone's`
- `next` option: `Your next opponent being decided. Needs you linked, or tracked with Discord on start.gg`
- `all`: `All six at once`
- Replies: `You'll get pinged when your next opponent is set.` / `They'll get pinged when their next opponent is set.` / `No more next opponent pings.` / `next opponents on` / `next opponents off`
- Not linked: `Next opponent pings need your start.gg, so /link first. Leave out the link and it finds yours.` / `Next opponent pings need their start.gg. Ask them to run /link with their profile link.`
- `callsOff` becomes `pingsOff(type)` for `calls`, `streams` and `next`, shown when that server switch is off:
  - `-# Match calls are off by default for tournaments, so pings only come where /t-o tournament posts turned them on.`
  - The same sentence for stream alerts and next opponents, each written out whole.
- `notifyText` adds `**Next opponents:** ...` after match calls. `notifyEveryone` adds it to its summary.

- [ ] **Step 1: Write the failing tests**

```js
test('/notify next:on saves the ping for a linked person and says so', async () => { /* nextPings includes them, reply matches /next opponent is set/ */ });
test('/notify next:on without a start.gg says to /link first and saves nothing', async () => { /* ... */ });
test('/notify all:on turns on all six', async () => { /* each list includes them */ });
```

- [ ] **Step 2: Run them**

Run: `node --test test/next.test.js test/misclicks.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement as listed under Interfaces, with Spanish**

- [ ] **Step 4: Run them**

Run: `node --test test/next.test.js test/misclicks.test.js test/players.test.js test/definitions.test.js && node scripts/spanish.js`
Expected: PASS, and the Spanish script lists nothing.

---

### Task 7: Help, README and AGENTS.md say the same thing

**Files:**
- Modify: `src/embeds/system.js` (`help()`), `src/i18n/es/help.js`, `README.md`, `AGENTS.md`

- [ ] **Step 1: `help()`**

Add a next-opponent line under automatic posts and rewrite the match call line for the new model. The `/notify` line names `next` and says six. The `/t-o tournament` lines say `default`. Add a line saying `/t-o settings` is the default for every tournament.

- [ ] **Step 2: README**

- Your pings: a `/notify next` row, and the `all` row says six.
- Tournaments: the intro, the `add` and `posts` rows, and the "Tournament post changes apply" paragraph rewritten for default and override, applied live.
- Automatic posts: a Next opponents row, the set result, stream and match call rows rewritten for off meaning nobody, and the "Ping changes apply" paragraph adds next.
- The request cost paragraph adds next opponents' costs from the spec.
- Fixing posts: a next-opponent row for crossing out a changed pairing.
- Turning posts on and off: twelve switches, which six are tournament defaults, and live changes.

- [ ] **Step 3: AGENTS.md**

Rewrite the Background posts paragraphs for `postsOn`, the tracked shape and the migration. Add `tracker/next.js` to how it fits together, `nextPosted` 1000 and `nextPosts` 200 to the state caps, and the `/notify` DMs note now that registration's default covers them. Update the 2026-10-23 test count line.

- [ ] **Step 4: Verify everything**

Run: `npm test`
Expected: all pass, the count higher than 599. Then run `node scripts/spanish.js` and expect it to list nothing. Read through the `/t-o tournament posts` and `/notify` descriptions in `definitions.js` for tone.
