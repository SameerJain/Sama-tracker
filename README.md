# Dark Fundies Bot

<img src="screenshots/predict.png" alt="/predict" width="56%"> <img src="screenshots/h2h.png" alt="/h2h" width="42%">

<img src="screenshots/sm4sh.png" alt="/sm4sh" width="53%"> <img src="screenshots/recent.png" alt="/recent" width="45%">

Follows start.gg players and posts to a Discord channel when one of them:

- finishes a set. Only their first DQ in an event gets posted, and big wins over higher seeds are marked as major upsets
- has a set on stream, called or at the front of the stream queue
- is entered in a tournament starting within the hour, if 3 or more of the crew are
- finishes a tournament, with where everyone placed

It also pings a role when registration is about to close for a tournament someone set a reminder for.

## Setup

1. Create an app at https://discord.com/developers/applications and add a bot. Invite it with the `bot` and `applications.commands` scopes and the View Channel, Send Messages, Embed Links, Attach Files and Manage Roles permissions. Manage Roles is only for the Reg Reminders role.
2. Make a start.gg API token under Settings > Developer Settings.
3. Copy `.env.example` to `.env` and fill it in. With Developer Mode on in Discord, right-click the server and the channel to copy their IDs. `ANTHROPIC_API_KEY` is optional.
4. `npm install` and `npm start`. Needs Node 22.9+. `npm run dev` restarts it when you save a file.

Only run one copy at a time or everything gets posted twice.

### Railway

1. New project, deploy from this GitHub repo.
2. Put everything from `.env.example` in the service's Variables.
3. Right-click the canvas, add a volume and connect it to the service. Any mount path works. Without it the tracked players get wiped on every deploy.

Pushing to GitHub redeploys it.

## Commands

```
/help                                          show the commands
/track add profile:<link or ID>                track a start.gg player
/track remove player:<name>                    stop tracking someone
/track list                                    everyone being tracked
/upcoming player:<name or all>                 their tournaments, live ones first
/recent player:<name or all>                   latest sets, 5 for one player or 3 each for all
/h2h player:<name> opponent:<name>             singles record against each other, DQs left out
/stats player:<name> [verbose:True]            recent set record, best finish, biggest upset, or a lifetime report
/characters player:<name>                      Ultimate characters from reported games, with records
/predict player:<name> opponent:<name>         odds of one beating the other
/stream player:<name or all> alerts:<on|off>   on-stream alerts on or off
/status                                        uptime, which machine, last start.gg checks
/set_reg_reminder tournament:<link>            ping Reg Reminders before registration closes
/delete_reg_reminder tournament:<name>         cancel a reg reminder
/reg_role ping:<on|off>                        reg reminder pings for yourself, on or off
/sm4sh                                         I LOVE SMASH BROS FOR WII U
/melee                                         MELEE IS THE ONLY REAL SMASH GAME
/ult                                           I HATE SMASH BROS ULTIMATE
/64                                            SMASH 64 DID IT FIRST
/brawl                                         BRAWL WAS GOOD ACTUALLY
/pplus                                         HAVE YOU HEARD ABOUT PROJECT+
/pfp                                           the bot's profile picture, full size
```

`profile` takes a link like `start.gg/user/f64a83c8` or just the ID at the end. `player` autocompletes from the tracked list.

Reg reminders go out a week, 3 days and a day before registration closes, then a last call 12 hours before. If registration stays open after the tournament starts, the start counts as the deadline. Ones already past when you set it get skipped, except the last call, which goes out right away inside those 12 hours.

Pings go to whoever turned them on with `/reg_role`, which only ever changes your own setting. If your Discord is linked on start.gg, you don't get pinged for tournaments you're already registered for. The bot also gives you a Reg Reminders role so everyone can see who's in.

`/predict` weighs head-to-head, results against common opponents, seeding at shared brackets and their last 40 sets.

With `ANTHROPIC_API_KEY` set, the joke commands get Claude Haiku to write a post as a Smash 4 superfan, a Melee purist, a burnt-out Ultimate player, a 64 old head, the last Brawl defender or a Project+ recruiter, with a random SmashWiki screenshot from that game (just stages for P+). Otherwise they just say the line.

`/characters` is Ultimate only and only sees games where the TO reported characters, which a lot of tournaments skip. The picture is their main's render.

`/stats verbose:True` is two cards covering every singles event and up to 3000 sets: record by game and year, top 8s, finishes against seed, win streaks, biggest wins and losses, most played opponents and the record against everyone else tracked.

start.gg is rate limited, so `/h2h`, `/predict` and `/characters` take 10 to 30 seconds the first time for a player. `/stats verbose:True` can take a minute for someone with a couple thousand sets. State is saved in `data/state.json`, or on the volume on Railway.
