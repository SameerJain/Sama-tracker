# Dark Fundies Bot

Follows start.gg accounts and posts to a Discord channel when a tracked player:

- finishes a set (only their first DQ in an event, so people know they dropped out). A win over someone seeded far above them is marked as a major upset
- has a set on stream, either called or at the front of the stream queue (with the Twitch link)
- is entered in a tournament starting within the hour (only when 3 or more are entered)
- finishes a tournament (posts where the crew placed, best first)

## Setup

1. Create an app at https://discord.com/developers/applications and add a bot. Invite it with the `bot` and `applications.commands` scopes and the View Channel, Send Messages, Embed Links and Attach Files permissions.
2. Make a start.gg API token under Settings > Developer Settings.
3. Copy `.env.example` to `.env` and fill it in. With Developer Mode on in Discord, right-click the server and the channel to copy their IDs.
4. `npm install`, then `npm start`. Needs Node 20.6 or newer.

While editing the code, use `npm run dev` instead. It restarts the bot every time you save a file.

## Commands

```
/df help                                          show the commands
/df track add profile:<link or ID>                start tracking a start.gg player
/df track remove player:<name>                    stop tracking someone
/df track list                                    everyone being tracked
/df upcoming player:<name or all>                 tournaments they're in, live ones first
/df recent player:<name or all>                   the 5 latest sets, or 3 per player for all, grouped by player (20 max)
/df h2h player:<name> opponent:<name>             their singles record against each other (DQs don't count)
/df stats player:<name>                           set record, how they finish against their seed, best finish, biggest upset, latest events
/df predict player:<name> opponent:<name>         odds of one beating the other, and the stats behind it
/df stream player:<name or all> alerts:<on|off>   turn on-stream alerts on or off
/df sm4sh                                         I LOVE SMASH BROS FOR WII U
```

With `ANTHROPIC_API_KEY` in `.env`, `/df sm4sh` has Claude Haiku write a new love letter to Smash 4 each time, with a random screenshot from SmashWiki. Without a key, or if Claude is down or out of credits, it just says the line.

For `profile`, paste their start.gg profile link (like `start.gg/user/f64a83c8`) or just the ID at the end. `player` autocompletes from the tracked list.

Tracked players and posted sets are saved in `data/state.json`.

`/df predict` is plain math, no AI. It picks the game both players have played the most, then weighs four things from their singles history: head-to-head, who did better against the opponents they've both played, who got seeded higher at brackets they both entered, and their last 40 sets. Head-to-head counts the most, but only once they've played a few times, so without it the other three decide.

Each person can run one command at a time, and start.gg requests are spaced out to stay under its rate limit, so a busy server just means slower replies. `/df h2h` and `/df predict` can take 10 to 30 seconds the first time for a player, then they're quick for 10 minutes.

Run only one copy of the bot per token. A second copy posts everything twice.
