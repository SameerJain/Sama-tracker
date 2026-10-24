# Tournament switches and next-opponent cards

Agreed with Samatron on 2026-10-24. Two changes that ship together, since next opponents is the first card built on the new switches.

## Why

- TOs don't press Call on start.gg, so match calls never fire. A card for "who you play next" works without the TO doing anything.
- The two TO levels aren't connected today. `/t-o tournament add` saves fixed switches (`sets`, `stream`, `top8`, `reminders` on, `calls` off) and never reads `/t-o settings` again. Turning `calls` on server-wide never reaches a tracked tournament.
- `/t-o settings` skips anything that came due while it was off, so turning `streams` on mid-set never announces that set.
- `/notify calls` makes a card and pings, `/notify streams` only pings. Nobody can say what "by tournament" vs "always" means.

## Switch model

| Level | Command | Meaning |
| --- | --- | --- |
| Every tournament | `/t-o settings <kind>:on\|off` | The default for every tournament. |
| One tournament | `/t-o tournament posts tournament:X <kind>:on\|off\|default` | Beats the default for that tournament. `default` drops the override. |
| You | `/notify streams\|calls\|next` | Whether you get pinged on a card that's being made anyway. Never makes a card. |

The kinds with both levels are the cards made around a tournament: `sets`, `streams`, `calls`, `next`, `top8` and `registration`. The tournament options `stream` and `reminders` are renamed `streams` and `registration` to match `/t-o settings`, on `/t-o tournament posts` and `/t-o tournament add`.

Every one starts on server-wide, `next` and `calls` included. `rollcall`, `results`, `events`, `slippi`, `recap` and `bills` stay server-only switches and keep their current defaults.

The answer for a tournament is its override if it has one, otherwise the server's switch, read at each check. Nothing is copied when a tournament is tracked.

### What on and off mean

Off means nobody: no card of that kind from that tournament, and no pings.

| Kind | On at a tracked tournament | On at an untracked tournament (tracked players entered it) | Pings |
| --- | --- | --- | --- |
| `sets` | Every finished set | Tracked players with `/track posts sets` on | none |
| `streams` | Every set on stream or up next in its queue | Tracked players with `/track posts stream` on | `/notify streams` |
| `calls` | Every called set | Sets with someone who has `/notify calls` on | `/notify calls` |
| `next` | Every next opponent, first sets skipped (below) | Sets with someone who has `/notify next` on, first set included | `/notify next` |
| `top8` | Each event's top 8 | none, as today | none |
| `registration` | Reg reminders and the 1-hour DMs | none, as today | Reg Reminders role, DMs by `/notify` |

`/track posts` only matters at tournaments nobody tracks. At an untracked tournament only the server switch applies.

`registration` off for a tournament now also stops its 1-hour DMs, since the DMs already go by the tournament's reminders and the server switch is now the default for those.

### Showing it

`/t-o tournament posts tournament:X` with no switches lists each kind as on or off, with "(default)" after the ones following the server. `/t-o settings` with no options is unchanged and says its switches are the default for every tournament.

## Real time

- Turning a kind on posts what's still live at the next check: a set on stream, a called set, a next opponent not yet played. That's 2 minutes for live cards and 15 for reminders and top 8s.
- Finished sets start from the moment `sets` turned on for that tournament, whichever level turned it on, so there's no backlog. This is the existing `lastCheck` and `enabledAt` behavior, extended to the default.
- Reminders and top 8s that came due while off stay skipped, as today.
- Turning a kind off stops it at the next check. Cards already posted stay.
- The server switch's "came due while off" skip goes away for `streams`, `calls` and `next`, since those are live.

## Next opponents

A set that hasn't started (waiting, ready, queued or called) with a player in both slots. One card per set.

- **Card**: both players, the event and round linked to the set, the station and the scheduled time when the TO set them. Magenta like `/run` and match calls. A **Head to head** button on singles, which comes off like the others. Goes in the tournament's thread like set results. `@Sam` in the message when Sam is in it with `/notify next` on.
- **First sets**: at a tracked tournament, round 1 sets don't post, so a bracket or pool start isn't a wall of cards. That's winners round 1, a pool's round 1 and a top cut's round 1. A set with someone who has `/notify next` on posts anyway, with the ping.
- **One at a time**: a set posts once it's the soonest unplayed set in its event for either of its players, by called, queued, ready, then waiting, then round. In a round-robin pool that's one card per player until they play it, though a player can show up on someone else's soonest card too.
- **TO changes a pairing**: for an hour after a card posts, the bot checks the set's players. If the TO fixed or reset a result and someone else landed in it, the card is crossed out with "Changed by the TO" and the new pairing posts. A set that empties and fills again with the same two players doesn't post twice.
- **Match calls** stay as they are. A called set gets its call ping as well.
- `/notify next:on` needs the person linked, or tracked with Discord on start.gg, like calls and streams. `/notify all` covers six. Turning it on catches a card already posted for someone else within the hour, by sending the card again with just the new pings, the way match calls do.
- Saved like every other post so a restart can't repeat it: the set ids that posted, capped at 1000, and the watched cards with their channel and message ids, capped at 200.

### start.gg cost

Checked every 2 minutes with the other set checks.

- `/notify next` people: 1 request per 20 players, like match calls. start.gg's per-player list has no "unplayed and live" filter, and it hands back sets left unplayed in abandoned brackets years ago, so only sets from tournaments going on now count.
- Tracked tournaments with `next` on: every unplayed set in their started events, 40 to a page. A 64-player bracket starts at about 4 requests and drops as sets get played.
- Pairing watch: 1 request per 50 watched cards.

A read-only check against a live bracket on 2026-10-24 found a set's `updatedAt` lands on the second the set feeding it finished, so "changed since the last check" would work for double elimination. Round-robin pools have every set filled from the start with numbered rounds, and their later sets never get touched, so that shortcut would miss them. Reading every unplayed set covers both, and "skip round 1, then each player's soonest set" is one rule for brackets and pools.

## Existing data

A one-time migration in `migrateSaved` drops each tracked tournament's saved switch that matches the old fixed value (`sets`, `stream`, `top8` and `reminders` true, `calls` false), so it follows the server. Anything else was a TO's choice and stays as an override, under the new names. Server switches stay as saved.

## Done means

- The code above, with `/t-o settings`, `/t-o tournament posts`, `/t-o tournament add` and `/notify` changed in `definitions.js`.
- `help()`, every reply and footnote, and the README's command tables, Tournaments, Automatic posts, Fixing posts, Turning posts on and off and request cost paragraphs say the same thing.
- Spanish for every new line, `node scripts/spanish.js` clean.
- Tests: the switch resolution and migration, live changes reaching a running tournament, off meaning nobody, next-opponent posting, first-set skipping, round robin, pairing changes and restart safety. `npm test` passes and `definitions.js` fits Discord's limits.
- AGENTS.md's Background posts and vocabulary updated for the new model.

## Not in this

- No `/track posts next`. `/notify next` covers a person at any tournament.
- Roll calls, placements and Discord events get no tournament-level switch.
