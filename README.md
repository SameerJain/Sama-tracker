# Dark Fundies Bot

<img src="screenshots/predict.png" alt="/df predict" width="56%"> <img src="screenshots/h2h.png" alt="/df h2h" width="42%">

<img src="screenshots/sm4sh.png" alt="/df sm4sh" width="53%"> <img src="screenshots/recent.png" alt="/df recent" width="45%">

Follows start.gg players and posts to a Discord channel when one of them:

- finishes a set. Only their first DQ in an event gets posted, and big wins over higher seeds are marked as major upsets
- has a set on stream, called or at the front of the stream queue
- is entered in a tournament starting within the hour, if 3 or more of the crew are
- finishes a tournament, with where everyone placed

## Setup

1. Create an app at https://discord.com/developers/applications and add a bot. Invite it with the `bot` and `applications.commands` scopes and the View Channel, Send Messages, Embed Links and Attach Files permissions.
2. Make a start.gg API token under Settings > Developer Settings.
3. Copy `.env.example` to `.env` and fill it in. With Developer Mode on in Discord, right-click the server and the channel to copy their IDs. `ANTHROPIC_API_KEY` is optional.
4. `npm install` and `npm start`. Needs Node 20.6+. `npm run dev` restarts it when you save a file.

Only run one copy at a time or everything gets posted twice.

## Commands

```
/df help                                          show the commands
/df track add profile:<link or ID>                track a start.gg player
/df track remove player:<name>                    stop tracking someone
/df track list                                    everyone being tracked
/df upcoming player:<name or all>                 their tournaments, live ones first
/df recent player:<name or all>                   latest sets, 5 for one player or 3 each for all
/df h2h player:<name> opponent:<name>             singles record against each other, DQs left out
/df stats player:<name>                           recent set record, best finish, biggest upset
/df predict player:<name> opponent:<name>         odds of one beating the other
/df stream player:<name or all> alerts:<on|off>   on-stream alerts on or off
/df sm4sh                                         I LOVE SMASH BROS FOR WII U
```

`profile` takes a link like `start.gg/user/f64a83c8` or just the ID at the end. `player` autocompletes from the tracked list.

`/df predict` weighs head-to-head, results against common opponents, seeding at shared brackets and their last 40 sets.

With `ANTHROPIC_API_KEY` set, `/df sm4sh` gets Claude Haiku to write a Smash 4 love letter and attaches a random SmashWiki screenshot. Otherwise it just says the line.

start.gg is rate limited, so `/df h2h` and `/df predict` take 10 to 30 seconds the first time for a player. State is saved in `data/state.json`.
