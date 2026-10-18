# Sama-tracker

By Samatron. A Discord bot for following your Smash crew on start.gg: results, stream alerts, tournament reminders, and player stats.

<img src="screenshots/predict.png" alt="/predict" width="56%"> <img src="screenshots/h2h.png" alt="/h2h" width="42%">

<img src="screenshots/sm4sh.png" alt="/sm4sh" width="53%"> <img src="screenshots/recent.png" alt="/recent" width="45%">

See it running in [this Discord server](https://discord.gg/VuMz7Y2k2).

## Use the bot

**Track a player** to post their placements in the channel. Anyone can add a player with `/track add`. Set results, stream alerts and match call pings start off; `/sets`, `/stream` and `/calls` turn them on.

**Follow Slippi ranked** with `/slippi`. Tracked and linked players get added on their own once their connect code shows up on start.gg, and rank changes get posted here.

**Link yourself** to use player lookups without automatic posts. Connect Discord on your start.gg profile, then run `/link`. Tracked players with Discord connected can already use these lookups without linking.

### Shared inputs and options

- `profile` accepts a start.gg profile link or its final ID, such as `start.gg/user/f64a83c8` or `f64a83c8`. `/scout` also accepts a tracked or linked player.
- The `player` and `opponent` pickers include tracked and linked players. `/track remove`, `/stream`, `/sets`, and `/calls` accept tracked players only. Leave an optional `player` blank to look yourself up.
- `player:all` works with `/upcoming`, `/recent`, `/stream`, `/sets`, and `/calls`, and includes everyone tracked.
- `verbose:True` adds the details shown in the stats table below. Leave it out for the short report, which has a **Full report** button that replaces it with the verbose report.
- `melee:True` limits `/stats`, `/h2h`, `/predict`, `/scout`, and `/progress` to Melee and adds Slippi ranked info, described under Slippi ranked below. It limits `/doubles` to Melee too, without Slippi info, since Slippi ranked is singles. `/characters` uses `game:Melee` or `game:Ultimate` instead.

### Tracking and accounts

| Command | What it does |
| --- | --- |
| `/track add profile:<link or ID>` | Start automatic posts for a player. Set results, stream alerts and match call pings start off. |
| `/track remove player:<name>` | Stop tracking them. |
| `/track list` | List tracked players, noting who has set results, stream alerts or match call pings on. |
| `/link profile:<link or ID>` | Link your own start.gg account. Leave out `profile` to find it by the Discord connected on start.gg, among the accounts `/profile` searches. |
| `/unlink` | Remove your link. This does not stop tracking. |
| `/upcoming` | Show live and upcoming tournaments. |
| `/recent` | Show your last 5 sets. With `player:all`, show up to 20, at most 3 per player, from up to 40 players: set results on first, then whoever played most recently. |
| `/run` | Show your run and next opponent in each current bracket. |
| `/stream player:<name or all> alerts:<on or off>` | Change stream alerts for tracked players. Newly tracked players start with them off. |
| `/stream_pings ping:<on or off>` | Get pinged for every stream alert, whoever is on stream. Only changes you, and you don't need to be tracked or linked. |
| `/sets player:<name or all> results:<on or off>` | Change automatic set results for tracked players. Newly tracked players start with them off. Sets finished before you turn them on are not posted. |
| `/calls player:<name or all> pings:<on or off>` | Change match call pings for tracked players. Newly tracked players start with them off. Pings players whose Discord is connected on start.gg, one message per called set. Doubles puts all four players in that one message. |

Anyone can change `/stream`, `/sets`, and `/calls` for tracked players. Use `/messages` for server-wide controls.

### Stats and matchups

| Command | Short report | With `verbose:True` |
| --- | --- | --- |
| `/stats` | Recent record, placements, and biggest upset. | Lifetime results, opponents, and seed performance. |
| `/doubles` | Recent 2v2 record, top partners, best finish, biggest upset, and latest events. | Up to 600 doubles sets: every partner's record and best finish together, teams played and lost to most, seeds, close sets, and best finishes. |
| `/h2h opponent:<name or link/ID>` | Overall record, last 10 meetings, and one-line predicted odds. | Every meeting, splits, streaks, and one-line predicted odds. |
| `/predict opponent:<name or link/ID>` | Estimated odds of winning. | The same odds, with the reasoning behind them. |
| `/scout profile:<player or link/ID>` | Any opponent's form, characters, toughest opponents and worst matchups, and your head-to-head. | More history, habits, toughest opponents and worst matchups, stages, and your odds. |
| `/progress` | Last 30 days against the previous 30, with changes in win rates and placements. | More detail on each period and a 6-month trend. |
| `/characters` | Reported characters in Ultimate or Melee. | More history and other games with reported characters. |

Add `player:<name or link/ID>` to look up someone else, for example `/h2h opponent:Sparg0 player:Leo`. In `/h2h` and `/predict`, either player can also be a start.gg link or ID, tracked or not. `/h2h` odds run the same prediction as `/predict` but stay one line. `verbose:True` doesn't change them; the **Why these odds** button under the card posts the `/predict` reasoning. `/scout` always uses you as the comparison player and replies privately. Your Discord must be connected on start.gg.

These reports count singles and leave DQs out of set records. `/doubles` is the exception: it counts 2v2 sets only, for one player, with whoever they teamed with. Its placements come from the events those sets were in, so an event they never played a set in doesn't show. Characters and stages appear only when the tournament organizer reports them. `/characters` defaults to whichever of Ultimate or Melee has more reported games, or more sets if neither has reported characters.

### Slippi ranked

| Command | What it does |
| --- | --- |
| `/slippi add code:<ABCD#123>` | Add a connect code to the watchlist. Leave out `code` to use the one on your start.gg, if you're tracked or linked. |
| `/slippi remove player:<name>` | Take someone off the watchlist. The automatic search won't add them back; `/slippi add` will. |
| `/slippi rank` | Show rank, rating, this season's record, daily leaderboard placement, top 3 characters and the last 3 seasons. `player:` takes someone on the watchlist or any connect code. Leave it out for yourself. |
| `/slippi leaderboard` | List the watchlist by rank, then rating, with each player's most played character. Shows the top 50. |

Rank cards and rank change posts show the rank badge from slippi.gg and start.gg's icon for the player's most played ranked character. The leaderboard shows the leader's badge. Slippi cards with no badge to show, like an empty leaderboard or a `/predict` card with only ranks, show the Slippi logo.

Melee reports also show Slippi ranked info for players on the watchlist. That covers reports run with `melee:True`, reports where everything found is Melee anyway, and `/h2h` or `/predict` odds that come out in Melee. Players who aren't on the watchlist get the same reports as before, with no extra lookups, and aren't mentioned in the Slippi section.

| Command | Slippi ranked adds |
| --- | --- |
| `/stats` | Rank, rating, season record, daily leaderboard placement and top characters. |
| `/progress` | The same, plus the change in rating since the end of last season. |
| `/h2h`, `/predict`, `/scout` | Rank, rating and season record for each player on the watchlist. It isn't part of the odds. Slippi has no ranked results between two players, and its ratings come from netplay, so they aren't mixed into a model built on start.gg sets. |
| `/characters game:Melee` | Ranked characters this season with game counts, next to what tournament organizers reported. |

`/predict melee:True` shows the ranks even when neither player has Melee sets on start.gg, so netplay-only players still get something to compare.

Netplay tournaments on start.gg ask for a connect code at registration, and start.gg keeps it. Once a day the bot looks for the codes of tracked and linked players who aren't on the watchlist yet, in their 8 newest online singles sets, and checks each player at most once a week. Anyone found goes on the watchlist with their start.gg tag. Offline-only players and people who play other games online have no code there, so add them with `code:`.

Ranks use slippi.gg's cutoffs: Bronze 1 through Master 3 by rating, and Grandmaster for a Master rating with a placement on Slippi's daily leaderboards. Fewer than 5 ranked sets in the season is Pending. Slippi has no public API. The bot uses the one slippi.gg uses, so a change on Slippi's side can stop rank checks until the bot is updated, and `/status` shows when the last check failed. Slippi doesn't share ranked match results, so posts show the new rank and rating change, not who they played.

### Registration

| Command | What it does |
| --- | --- |
| `/set_reg_reminder tournament:<link>` | Set registration reminders and track everyone registered. |
| `/delete_reg_reminder tournament:<name>` | Cancel reminders for a tournament, including ones added automatically. |
| `/reg_admin add profile:<link or ID>` | Automatically set reminders for tournaments this start.gg user admins. |
| `/reg_admin remove admin:<name>` | Stop adding reminders for that admin. |
| `/reg_admin list` | List saved admins. |
| `/reg_role ping:<on or off>` | Turn registration pings on or off for yourself. |
| `/bracket` | Link brackets for reminder tournaments, from 30 minutes before the start until 6 hours after the end. |
| `/registered tournament:<link>` | List registered server members. Add `by_event:True` to group them by event. |
| `/reg_warn tournament:<link> user:<@someone>` | Ping someone with a registration link if they have not registered. |

`tournament` takes a start.gg link, or pick a tournament the bot already knows: ones with reminders and ones tracked players are in, soonest first. `/set_reg_reminder` offers only upcoming ones without a reminder.

Reminders go out 7 days, 3 days, 1 day, and 12 hours before registration closes. If registration extends past the tournament start, the start is the deadline. Past reminders are skipped; a last call set within 12 hours goes out immediately. Setting a reminder also tracks everyone registered for the tournament, with set results, stream alerts and match call pings off.

Connect Discord on start.gg so the bot can recognize your registration and skip your reminder pings. Hidden entrant lists can prevent these checks. `/reg_warn` sends no ping if registration is closed, the person is registered, or the list is hidden. `/registered` lists names without pinging anyone.

### General

| Command | What it does |
| --- | --- |
| `/help` | Show the commands. |
| `/status` | Show uptime, when the latest version was deployed, the last start.gg and Slippi checks, and why a post last missed its tournament thread. A copy run on another computer also shows that computer's name. |
| `/profile` | Find a tracked or linked player's start.gg with `player:`, or a server member's with `user:`. Leave both blank for yourself. |
| `/messages` | Show or change automatic posts, tournament threads, and the recap schedule. |
| `/socials` | Show saved streams and social links. |
| `/socials_edit add name:<who> link:<url>` | Save a link. `https://` is optional; links with the same name share a line. |
| `/socials_edit remove link:<url>` | Remove a saved link. |

`/profile` checks the Discord connected on start.gg and searches accounts the bot has already seen: tracked players, people who used `/link` and people registered for a tournament the bot checks. If it cannot find you, connect Discord on start.gg and run `/link` with your profile link. Someone else has to be on that list first, then `/profile @them` finds them. Or pick them straight from the tracked and linked list with `player:`, no Discord matching needed.

`/messages` requires **Manage Server**. `/socials_edit` requires it by default; you can delegate that command under Server Settings > Integrations > Sama-tracker.

### Fun

`/64`, `/melee`, `/brawl`, `/sm4sh`, `/ult`, and `/pplus` are each a different character with their own Smash take. With `ANTHROPIC_API_KEY`, Claude Haiku writes each post in that character from the game's talking points. Half the posts use one of the game's own styles, and half use a shared scenario picked to fit that character, like a campaign speech, a news report or a famous movie scene. About 1 in 4 posts use a scenario Haiku makes up for that character first. About a third also draw on a SmashWiki article and a third on a YouTube video, which needs `YOUTUBE_API_KEY`; without it, those posts use an article. Every post comes with a SmashWiki screenshot. Without `ANTHROPIC_API_KEY`, the commands reply with their catchphrase.

`/bills` posts a Bills photo, meme or GIF with a rally cry and a link to the source. Photos come from Wikimedia Commons, memes from selected Imgflip posts, and GIFs from the official Bills and NFL GIPHY channels. It rotates the three types evenly and uses each image in a pool before repeating. The photo pool and rotations reset when the bot restarts. No AI or extra API keys needed.

`/view_pfp` posts the bot's profile picture at full size, the meme image its avatar comes from.

## Automatic posts

| Type | When it posts |
| --- | --- |
| Set results | After a tracked player with `/sets` on finishes a set. Only their first DQ per event is posted. |
| Stream alerts | When a tracked player with `/stream` on has a set on stream, called, or next in the stream queue. Pings everyone with `/stream_pings` on, 80 per message. |
| Match call pings | When a tracked player with `/calls` on has a set called. Pings their Discord when it is connected on start.gg, one message per set. Doubles puts all four players in that one message. |
| Tournament roll calls | An hour before a tournament with at least 3 tracked players. |
| Tournament placements | 12 hours after the tournament ends, or up to 24 hours if results are incomplete. Unfinished placements are marked as projected. |
| Top 8s | Off by default. With the placements post: the top 8 of each event a tracked player entered, listing everyone whether tracked or not. One card per event. Placements are marked as projected if the bracket isn't finished. If start.gg keeps failing on the top 8 for 12 hours, the placements post goes out without it. |
| Registration reminders | At the deadlines listed above, for people who enabled `/reg_role` pings. |
| Slippi rank changes | Within 30 minutes of a watchlist player moving to another rank, including their first rank of a season after Pending. A new season starting everyone over isn't posted. |
| Weekly recap | Sunday at 9 pm New York time by default: results, highlights, and next week's entries. Only tracked players with a non-DQ singles set that week are included. |

Set results, stream alerts and match call pings start off for newly tracked players. The set, stream and match call checks run every 2 minutes and ask start.gg about each player with that switch on, 20 players per request, so keeping them off keeps those checks small however many players are tracked.

Run `/messages` without options to see the current settings. Change any combination of the nine switches: `sets`, `streams`, `calls`, `rollcall`, `results`, `top8`, `registration`, `slippi`, and `recap`. Match call pings start off server-wide too; turn both that and `/calls` on to get them. Top 8s also start off.

```text
/messages sets:False streams:False
/messages recap_day:Sunday recap_time:20:00 timezone:America/New_York
```

Times use 24-hour `HH:MM` and the selected timezone, including daylight saving. Settings save immediately and survive restarts. Posts missed while a type is off are skipped when you turn it back on. Schedule changes apply to future recaps. Per-player `/sets`, `/stream`, and `/calls` settings and personal `/reg_role` and `/stream_pings` pings still apply.

### Tournament threads

`/messages threads:True` gives each tournament its own thread, so a big weekend doesn't flood the channel. The first set result or stream alert from a tournament posts a card with its name in the channel and starts a thread on it. That tournament's later set results and stream alerts go in the thread, and stream alert pings add people to it. Match call pings, roll calls, placements and top 8s stay in the channel. Threads are off by default.

The bot needs **Create Public Threads** and **Send Messages in Threads** in the channel. `/messages threads:True` checks for both and names any that are missing instead of turning threads on. If a post can't go in its thread later, for example after a permission is removed or a moderator locks the thread, it posts in the channel instead and `/status` shows why. A deleted thread is replaced by a new one on the tournament's next post. Threads archive after a day without posts and reopen when the next one goes in. `threads:False` sends everything back to the channel; turning it on again reuses each tournament's thread.

## Setup

Requires Node.js 22.9 or newer.

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications). Invite it with the `bot` and `applications.commands` scopes and these permissions: View Channel, Send Messages, Embed Links, Attach Files, and Manage Roles. Add Create Public Threads and Send Messages in Threads to use tournament threads. No privileged intents are needed.
2. Create a start.gg API token under Settings > Developer Settings.
3. Copy [.env.example](.env.example) to `.env`. Fill in `DISCORD_TOKEN`, `STARTGG_TOKEN`, `GUILD_ID`, and `CHANNEL_ID`. With Discord Developer Mode enabled, right-click the server and channel to copy their IDs.
4. Run:

```sh
npm install
npm start
```

`ANTHROPIC_API_KEY` and `YOUTUBE_API_KEY` are optional. For YouTube, enable YouTube Data API v3 in a Google Cloud project and create an API key; OAuth is not needed.

The bot's role must sit above **Reg Reminders** so it can assign that role. Keep the `Reg Reminders` name because `/reg_role` uses it.

For development, `npm run dev` restarts on file changes. `npm test` uses fake Discord and start.gg responses without posting messages.

### Hosting and state

Run one copy of the bot to avoid duplicate posts. Keep `state.json` on persistent storage so tracking and settings survive redeploys. The storage location is `STATE_DIR`, then Railway's `RAILWAY_VOLUME_MOUNT_PATH` if set, otherwise `data/` in the project folder.

On a Node host, use systemd or pm2 to keep `npm start` running.

**Docker**

```sh
docker build -t sama-tracker .
docker run -d --name sama-tracker --restart unless-stopped --env-file .env -v sama-data:/app/data sama-tracker
```

The volume keeps state across container rebuilds. For another mount location, set `STATE_DIR` to match.

**Railway**

1. Deploy this repository. Railway uses the included Dockerfile.
2. Add the required `.env.example` values in the service's Variables, plus any optional API keys.
3. Attach a persistent volume. The bot uses its path automatically unless `STATE_DIR` overrides it.

A push to master redeploys it automatically.

### Tracking a tournament's attendees

Add everyone at a tournament to the track from the bot's host, without using Discord. Run `npm run track` (or `node tools/track-attendees.js` in the app folder) and paste a start.gg tournament link when it asks.

- A link from the tournament's attendees page adds just the events that page is filtered to. A plain tournament link adds everyone registered. Example filter: `start.gg/tournament/smashcade-2-4/attendees?filter={"eventIds":["1682422"]}`.
- Already tracked players are skipped, and attendees without a start.gg account are left out. New players start with set results, stream alerts and match call pings off, as with `/track add`.
- The bot adds queued players within 30 seconds on its host and the tool reports how many. Players queued while the bot is down are added on its next start.

On Railway, run `railway ssh`, then `npm run track` or `node tools/track-attendees.js`.

## Data and report limits

Every card message has a picture. It's the player's or tournament's start.gg image when there is one; set result, stream and match call cards fall back to the tracked player's picture when the tournament has none. A message with no picture of its own shows the bot's avatar. Plain text replies, like errors and on/off confirmations, have none.

start.gg can omit scores, seeds, characters, and stages. Missing data stays unknown. Predictions estimate outcomes from head-to-head results, common opponents, and seeding; newer sets count more, and limited data pulls the odds toward 50%.

Slippi rank checks ask about 20 watchlist players per request, one request a second. The connect code search asks start.gg about 10 players per request. Melee reports refresh a watchlist player's Slippi profile at most every 30 minutes and wait up to 3 seconds for it, then use the last rank check's numbers. If the Slippi section doesn't fit on a card, the report goes out without it.

First lookups can take tens of seconds or about a minute for a large report. start.gg limits requests, and commands share cached history where available. Long history lookups show progress while they load.

<details>
<summary>History limits and placement calculations</summary>

| Command | History checked |
| --- | --- |
| `/stats` | Latest 15 standings and 30 singles sets. With `melee:True`, standings are game-filtered and older pages are read for 30 Melee sets, or all available if fewer. |
| `/stats verbose:True` | Every finished singles event and up to 3,000 sets. |
| `/doubles` | Latest 30 doubles sets and the events they're from. With `melee:True`, up to 300 sets are read for 30 Melee ones. |
| `/doubles verbose:True` | Up to 600 doubles sets and the events they're from. |
| `/h2h` | All available meetings against the selected opponent, plus up to 600 sets per player for one-line predicted odds, in either report length. |
| `/predict` | Every meeting between the two players, plus up to 600 sets per player. Verbose explains the same prediction. |
| `/scout` | Up to 600 sets per player and 400 sets for the opponent's characters. |
| `/scout verbose:True` | Up to 1,200 opponent sets, 800 for characters and stages, every finished event, and 600 of your sets. |
| `/characters` | Up to 400 sets, or 1,600 with verbose. Verbose shows up to 6 games. |
| `/progress` | 60 days, or 180 with verbose, split into 30-day periods. |

`melee:True` filters the history each report checks. The limits above still apply. `/h2h` and `/predict` check every meeting; short `/stats` and `/doubles` read back far enough to fill their Melee set windows when possible.

Progress placements count toward the period when the event started. Average finishes account for bracket size. Seed comparisons use placement tiers, so seed 6 finishing 5th counts as on seed.

</details>
