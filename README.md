# Sama-tracker

A Discord bot that follows a Smash crew on start.gg and Slippi. It posts results and stream alerts in one channel, sends registration reminders, and answers slash commands with stats, head-to-heads and odds.

<img src="screenshots/predict.png" alt="/predict" width="56%"> <img src="screenshots/h2h.png" alt="/h2h" width="42%">

<img src="screenshots/sm4sh.png" alt="/sm4sh" width="53%"> <img src="screenshots/recent.png" alt="/recent" width="45%">

Made by Samatron. See it running in [this Discord server](https://discord.gg/VuMz7Y2k2).

[Get started](#get-started) · [Commands](#commands) · [Automatic posts](#automatic-posts) · [Run your own copy](#run-your-own-copy) · [Data and limits](#data-and-limits)

## Get started

1. **Link yourself.** Connect Discord on your start.gg profile, then run `/link`. Commands then know who you are, and nothing gets posted about you. Tracked players with Discord connected can skip this.
2. **Track your crew.** `/track add profile:<link>` posts a player's placements in the channel. Anyone can add someone.
3. **Turn on more posts.** Set results, stream alerts and match call pings start off for each player. `/sets`, `/stream` and `/calls` turn them on. `/messages` controls posts for the whole server.
4. **Follow Slippi ranked.** `/slippi add` puts a connect code on the watchlist. Tracked and linked players get added on their own once their code shows up on start.gg.

`/help` in Discord lists every command in short form.

## Commands

### Options that work across commands

| Option | What it does |
| --- | --- |
| `profile` | A start.gg profile link or its final ID, like `start.gg/user/f64a83c8` or `f64a83c8`. `/scout` also takes a tracked or linked player. |
| `player`, `opponent` | A tracked or linked player. Leave an optional `player` blank to look yourself up. `/track remove`, `/stream`, `/sets` and `/calls` take tracked players only. |
| `player:all` | Everyone tracked, on `/upcoming`, `/recent`, `/stream`, `/sets` and `/calls`. |
| `verbose:True` | The longer report in the stats table below. Short reports have a **Full report** button that swaps in the verbose one. |
| `melee:True` | Limits `/stats`, `/h2h`, `/predict`, `/scout`, `/progress` and `/doubles` to Melee. All but `/doubles` add [Slippi ranked](#slippi-ranked) info. Slippi ranked is singles, so `/doubles` leaves it out. `/characters` uses `game:Melee` or `game:Ultimate` instead. |
| `since:2026-01-01` | Counts only sets since that date, on `/stats`, `/h2h`, `/scout` and `/predict`. |
| `venue` | Only offline or only online tournaments, on the same four. Leave it out for both. |

Filtered reports name their filters on the card, and **Full report** buttons keep them.

Player pickers list the last 5 people you picked first. Names match regardless of case, spaces or punctuation, so `tea leo` finds `Tea | Leo`. A name typed in full works without picking it from the list. A typed name or connect code that matches nobody gets the closest tracked, linked or watchlisted player suggested: one with it in their name, or one a typo or two away.

### Tracking and accounts

| Command | What it does |
| --- | --- |
| `/track add profile:<link or ID>` | Start automatic posts for a player. Set results, stream alerts and match call pings start off. |
| `/track remove player:<name>` | Stop tracking them. Asks first, then an **Undo** button puts them back with all their settings for a minute. |
| `/track list` | List tracked players and who has set results, stream alerts or match call pings on. |
| `/link profile:<link or ID>` | Link your own start.gg account. Leave out `profile` to find it by the Discord connected on start.gg, among the accounts `/profile` searches. |
| `/unlink` | Remove your link, with an **Undo** button for a minute. Tracking stays as it was. |
| `/upcoming` | Live and upcoming tournaments with 3 or more of the crew registered. |
| `/recent` | Your last 5 sets. With `player:all`, up to 20 sets, at most 3 per player, from up to 40 players: those with set results on first, then whoever played most recently. |
| `/run` | Your run and next opponent in each current bracket, with the station and scheduled time when the TO set them. Each next opponent gets a head-to-head button. |
| `/stream player:<name or all> alerts:<on or off>` | Stream alerts for tracked players. |
| `/stream_pings ping:<on or off>` | Get pinged for every stream alert, whoever is on stream. Only changes you, and you don't need to be tracked or linked. |
| `/sets player:<name or all> results:<on or off>` | Automatic set results for tracked players. Sets finished before you turn them on aren't posted. `player:all results:off` asks first. |
| `/calls player:<name or all> pings:<on or off>` | Match call pings for tracked players whose Discord is connected on start.gg. One message per called set, with all four players in it for doubles. |

Anyone can change `/stream`, `/sets` and `/calls` for any tracked player. New players start with all three off. Players with no reported sets in 6 months come off the track list on their own.

`/track remove`, `/sets player:all results:off` and `/delete_reg_reminder` ask "Are you sure?" with buttons first. Only whoever ran the command can press them.

### Stats and matchups

| Command | Short report | With `verbose:True` |
| --- | --- | --- |
| `/stats` | Recent record, placements and biggest upset. | Lifetime results, opponents and seed performance. |
| `/doubles` | Recent 2v2 record, top partners, best finish, biggest upset and latest events. | Up to 600 doubles sets: every partner's record and best finish together, teams played and lost to most, seeds, close sets and best finishes. |
| `/h2h opponent:<name or link/ID>` | Overall record, last 10 meetings and one-line predicted odds. | Every meeting, splits, streaks and the same one-line odds. |
| `/predict opponent:<name or link/ID>` | Estimated odds of winning. | The same odds, with the reasoning behind them. |
| `/scout profile:<player or link/ID>` | Any opponent's form, characters, toughest opponents and worst matchups, plus your head-to-head. | More history, habits, stages and your odds. |
| `/progress` | Last 30 days against the previous 30, with changes in win rates and placements. | More detail on each period and a 6-month trend. |
| `/characters` | Reported characters in Ultimate or Melee. | More history, and other games with reported characters. |

Add `player:` to look up someone else, like `/h2h opponent:Sparg0 player:Leo`. In `/h2h` and `/predict`, either player can be a start.gg link or ID, tracked or not.

`/h2h` runs the same prediction as `/predict` but keeps it to one line, even with `verbose:True`. Run `/predict` for the reasoning behind the odds. `/scout` always compares the opponent with you, replies privately, and needs your Discord connected on start.gg.

> [!TIP]
> On a phone, skip the typing. Long-press a server member (right-click on desktop), open **Apps**, and pick **H2H with me** for `/h2h` or **Scout them** for `/scout`. Both find the member's start.gg the way `/profile` does, so the member has to be tracked, linked, or registered for a tournament the bot checks. **H2H with me** needs you tracked or linked too.

These reports count singles and leave DQs out of set records. `/doubles` counts 2v2 sets only, for one player, with whoever they teamed with. Its placements come from the events those sets were in, so an event where they never played a set doesn't show. Characters and stages appear only when the TO reports them. `/characters` picks whichever of Ultimate or Melee has more reported games, or more sets if neither has reported characters.

### Slippi ranked

| Command | What it does |
| --- | --- |
| `/slippi add code:<ABCD#123>` | Add a connect code to the watchlist. Leave out `code` to use the one on your start.gg, if you're tracked or linked. |
| `/slippi remove player:<name>` | Take someone off the watchlist. The automatic search won't add them back, but `/slippi add` will. |
| `/slippi rank` | Rank, rating, this season's record, daily leaderboard placement, top 3 characters and the last 3 seasons. `player:` takes someone on the watchlist or any connect code. Leave it out for yourself. |
| `/slippi leaderboard` | The watchlist by rank, then rating, with each player's most played character. Shows the top 50. |

Rank cards and rank change posts show slippi.gg's rank badge and start.gg's icon for the player's most played ranked character. The leaderboard shows the leader's badge. Slippi cards with no badge to show, like an empty leaderboard, show the Slippi logo.

Melee reports add Slippi ranked info for players on the watchlist. That covers reports run with `melee:True`, reports where everything found is Melee anyway, and `/h2h` or `/predict` odds that come out in Melee. Players who aren't on the watchlist get the same report as always, with no extra lookups.

| Command | Slippi ranked adds |
| --- | --- |
| `/stats` | Rank, rating, season record, daily leaderboard placement and top characters. |
| `/progress` | The same, plus the change in rating since the end of last season. |
| `/h2h`, `/predict`, `/scout` | Rank, rating and season record for each player on the watchlist. When both players are ranked and the odds are for Melee, their ratings count toward the odds, even with no Melee sets to go on. Otherwise the ranks are only shown. |
| `/characters game:Melee` | Ranked characters this season with game counts, next to what TOs reported. |

`/predict melee:True` gives Slippi odds even when neither player has Melee sets on start.gg, so netplay-only players can compare. With only one of them ranked, it shows the ranks and no odds.

Netplay tournaments on start.gg ask for a connect code at registration, and start.gg keeps it. Once a day the bot looks for the codes of tracked and linked players not yet on the watchlist, in their 8 newest online singles sets, checking each player at most once a week. Anyone found goes on the watchlist under their start.gg tag. Offline-only players and people who play other games online have no code there, so add them with `code:`.

Ranks use slippi.gg's cutoffs: Bronze 1 through Master 3 by rating, and Grandmaster for a Master rating with a placement on Slippi's daily leaderboards. A player with fewer than 5 ranked sets in the season is Pending. Slippi doesn't share ranked match results, so posts show the new rank and rating change, not who they played.

> [!NOTE]
> Slippi has no public API. The bot uses the one slippi.gg uses, so a change on Slippi's side can stop rank checks until the bot is updated. `/status` shows when the last check failed.

### Registration

| Command | What it does |
| --- | --- |
| `/set_reg_reminder tournament:<link>` | Set registration reminders and track everyone registered (80 or fewer). |
| `/delete_reg_reminder tournament:<name>` | Cancel reminders for a tournament, including ones added automatically. Asks first. |
| `/reg_admin add profile:<link or ID>` | Set reminders automatically for every tournament this start.gg user admins. |
| `/reg_admin remove admin:<name>` | Stop adding reminders for that admin. |
| `/reg_admin list` | List saved admins. |
| `/reg_role ping:<on or off>` | Registration pings for yourself. |
| `/bracket` | Bracket links for reminder tournaments, from 30 minutes before the start until 6 hours after the end. |
| `/stream_link` | Streams added on start.gg for reminder tournaments and tournaments tracked players entered, in the same window as `/bracket`. Twitch streams are links, and other sites show the stream name. If none are going on, none have a stream, or start.gg doesn't answer, it says to ask a TO in another channel. |
| `/registered tournament:<link>` | Registered server members, by name so nobody gets pinged. `by_event:True` groups them by event. |
| `/reg_warn tournament:<link> user:<@someone>` | Ping someone with a registration link if they haven't registered. Each person gets one warning per tournament every 12 hours. |

`tournament` takes a start.gg link, or a tournament the bot already knows from the list: ones with reminders and ones tracked players are in, soonest first. `/set_reg_reminder` lists only upcoming ones without a reminder.

Reminders go out 7 days, 3 days, 1 day and 12 hours before registration closes. If registration stays open past the tournament start, the start is the deadline. Past reminders are skipped, and a last call set within 12 hours goes out right away. Setting a reminder also tracks everyone registered when 80 or fewer are registered, with set results, stream alerts and match call pings off. Over 80, nobody is tracked.

Connect Discord on start.gg so the bot recognizes your registration and skips your reminder pings. A hidden entrant list blocks these checks. `/reg_warn` sends no ping if registration is closed, the person is registered, the list is hidden, or someone already warned them about that tournament in the last 12 hours. That last one tells only whoever ran it, with when they can be warned again.

### Server and general

| Command | What it does |
| --- | --- |
| `/help` | List the commands. |
| `/status` | Uptime, when the latest version was deployed, the last start.gg and Slippi checks, how many players and tournaments are tracked, requests waiting on start.gg, any downtime before the last start, and why a post last missed its thread. A copy run on another computer also shows that computer's name. |
| `/profile` | A tracked or linked player's start.gg with `player:`, or a server member's with `user:`. Leave both blank for yourself. |
| `/messages` | Show or change automatic posts, threads (off, one per tournament or one per event) and the recap schedule. Needs **Manage Server**. |
| `/socials` | Saved streams and social links. |
| `/socials_edit add name:<who> link:<url>` | Save a link. `https://` is optional, and links with the same name share a line. |
| `/socials_edit remove link:<url>` | Remove a saved link. |

`/profile` checks the Discord connected on start.gg against accounts the bot has already seen: tracked players, people who used `/link`, and people registered for a tournament the bot checks. It reads registration lists again at most every 10 minutes. If it can't find you, connect Discord on start.gg and run `/link` with your profile link. To find someone else with `/profile @them`, they have to be on that list first. Or pick them from the tracked and linked list with `player:`, which needs no Discord matching.

`/socials_edit` needs **Manage Server** by default. You can hand it to other roles under Server Settings > Integrations > Sama-tracker.

### Fun

`/64`, `/melee`, `/brawl`, `/sm4sh`, `/ult` and `/pplus` are each a different character with their own Smash take. With `ANTHROPIC_API_KEY` set, Claude Haiku writes each post in that character from the game's talking points. Every post comes with a SmashWiki screenshot. Without `ANTHROPIC_API_KEY`, each command replies with its catchphrase.

`/bills` posts a Bills photo, meme or GIF with a rally cry and a link to the source. Photos come from Wikimedia Commons, memes from selected Imgflip posts, and GIFs from the official Bills and NFL GIPHY channels. It rotates the three types evenly and uses every image in a pool before repeating one. The pools and rotation reset when the bot restarts. It needs no AI or API keys.

`/messages bills:True` posts the Bills final score here after each game, with the other team's logo, green for a win and red for a loss. Scores come from ESPN's public scoreboard, with quarters and yards. Off by default. It needs no AI or API keys.

`/view_pfp` posts the bot's profile picture at full size, the meme image its avatar comes from.

## Automatic posts

| Type | When it posts |
| --- | --- |
| Set results | After a tracked player with `/sets` on finishes a set. The winner is on the left with a W and the loser on the right with an L, whoever is tracked. A winner seeded 7 or more placement tiers lower, like seed 17 over seed 2, gets Major upset. Only a player's first DQ per event is posted. |
| Stream alerts | When a tracked player with `/stream` on has a set on stream, called, or next in the stream queue. A new one waits 30 seconds and posts only if the set is still on the same stream, so a set put on stream by mistake and taken back isn't posted. Pings everyone with `/stream_pings` on, 80 per message. |
| Match call pings | When a tracked player with `/calls` on has a set called. Pings their Discord when it's connected on start.gg, one message per set, with all four players in it for doubles. |
| Tournament roll calls | An hour before a tournament with at least 3 tracked players. |
| Tournament placements | 12 hours after the tournament ends, or up to 24 hours if results are incomplete. Unfinished placements are marked as projected. |
| Top 8s | Off by default. As soon as every event a tracked player entered is finished: the top 8 of each event, listing everyone, tracked or not. One card per event. If the bracket still isn't finished when placements post, it goes with them marked as projected instead. If start.gg keeps failing on the top 8 for 12 hours, the placements post goes out without it. If the top 8 post itself fails to send, it is retried hourly for 3 days. |
| Registration reminders | At the deadlines under [Registration](#registration), for people who turned on `/reg_role`. |
| Slippi rank changes | Within 30 minutes of a watchlist player moving to another rank, including their first rank of a season after Pending. A new season resetting everyone isn't posted. |
| Bills final results | Off by default. After each Bills game: the final score with the other team's logo, green for a win and red for a loss, plus quarters and yards. |
| Weekly recap | Sunday at 9 pm New York time by default: results, highlights and next week's entries. Only tracked players with a non-DQ singles set that week are included. |

Singles stream alerts and match calls get a **Head to head** button that replies privately to whoever presses it. It comes off when the set ends, or 12 hours after the post.

The set, stream and match call checks run every 2 minutes. Each asks start.gg only about players with that switch on, 20 players per request, so the checks stay small however many players are tracked. When the stream check finds a new set on stream, it asks again 30 seconds later to confirm. A set in a stream queue links that queue's stream. Rechecking recent set results and match calls takes one request per 50 posts, plus 1 per 10 set results whose winner or score changed. Bills finals check ESPN daily, every 15 minutes from an hour before kickoff until 8 hours after: one request plus one per new final.

After the bot has been down, set results from the last 3 hours still post and older ones are skipped. `/status` says when that happened.

### Fixing posts that turn out wrong

TOs report the wrong winner, fix it a minute later, or call a set and take it back. The bot edits what it posted to match.

| Post | What changes |
| --- | --- |
| Set results | For an hour after a result posts, the bot checks it again every 2 minutes. If the TO changes the winner or score, the card is replaced with the new result marked **Corrected by TO**. If the TO resets or deletes the set, the card turns grey and its title starts with **Reset by TO**. If the set is reported again within that hour, the card shows the new result. |
| Match call pings | For 15 minutes after a call, the bot checks it every 2 minutes. If the set goes back to waiting, the ping is crossed out with "Uncalled by the TO", and calling it again pings again. If the set is still called 5 minutes in, the players get pinged once more in a reply: "called 5 min ago, TOs usually DQ at 10". This needs the `calls` switch on. |
| Placements and top 8s | Projected placements are checked hourly for 3 days. Once start.gg has every placement final, or every event in the top 8 finished, the post is edited to the final standings. If the final version no longer splits into the same number of messages, it goes out as a new post saying so. |

Some TOs tag an event with the wrong game, like a "Melee Singles" tagged as Ultimate. When an event's name says Melee and its tag says Ultimate, or the other way around, the bot goes by the name. That covers `melee:True`, `game:` and the game shown on cards. Events whose name mentions both games, or another game like Project+, keep their tag.

### Turning posts on and off

Run `/messages` without options to see the current settings. Change any of the ten switches: `sets`, `streams`, `calls`, `rollcall`, `results`, `top8`, `registration`, `slippi`, `recap` and `bills`. Match call pings, top 8s and Bills finals start off server-wide. For match call pings, turn on both the `calls` switch and `/calls` for the player.

```text
/messages sets:False streams:False
/messages recap_day:Sunday recap_time:20:00 timezone:America/New_York
```

Times use 24-hour `HH:MM` in the chosen timezone, with daylight saving. Settings save right away and survive restarts. Posts that came due while a type was off stay skipped after you turn it back on. Schedule changes apply to future recaps. Per-player `/sets`, `/stream` and `/calls` and personal `/reg_role` and `/stream_pings` pings still apply on top.

### Threads

`/messages threads` decides where set results and stream alerts go, so a big weekend doesn't flood the channel. It has three modes:

| Mode | Where they go |
| --- | --- |
| **Off, post in the channel** | The channel. This is the default. |
| **One thread per tournament** | A thread for each tournament, named after it. |
| **One thread per event** | A thread for each event, like `Genesis 11 · Ultimate Singles`. A tournament where the crew plays three events gets three threads. |

The first set result or stream alert from a tournament, or from an event in the per-event mode, posts a card with its name in the channel and starts a thread on it. One thread per tournament pins that card so the thread stays easy to find, and unpins it once the tournament is over. Later set results and stream alerts from it go in the thread, and stream alert pings add people to it. Match call pings, roll calls, placements and top 8s stay in the channel in every mode. Discord has no threads inside threads, so the per-event threads sit side by side in the channel. Each card names its tournament and event.

The bot needs **Create Public Threads** and **Send Messages in Threads** in the channel. Picking either thread mode checks for both and names any that are missing instead of switching. Pinning the tournament thread card needs **Manage Messages**; without it threads still work but the card stays unpinned. If a post can't go in its thread later, say a permission was removed or a moderator locked the thread, it posts in the channel and `/status` shows why. A deleted thread gets replaced on the next post. Threads archive after a day without posts and reopen when the next one goes in. Switching to **Off** sends everything back to the channel. Switching modes keeps the old threads, so going back to a mode reuses them for 14 days. A server that turned threads on before there were three modes keeps one thread per tournament.

## Run your own copy

You need Node.js 22.9 or newer, a Discord bot and a start.gg API token.

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications). Invite it with the `bot` and `applications.commands` scopes and these permissions: View Channel, Send Messages, Embed Links, Attach Files and Manage Roles. For threads, add Create Public Threads and Send Messages in Threads, plus Manage Messages so tournament thread cards get pinned. It needs no privileged intents.
2. Create a start.gg API token under Settings > Developer Settings.
3. Copy [.env.example](.env.example) to `.env` and fill it in. With Discord Developer Mode on, right-click the server and channel to copy their IDs.
4. Install and start it:

   ```sh
   npm install
   npm start
   ```

5. Move the bot's role above **Reg Reminders** so it can hand out that role. Keep the name `Reg Reminders`, since `/reg_role` looks for it.

| Variable | Required | What it's for |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | The bot's token from the Developer Portal. |
| `STARTGG_TOKEN` | Yes | The start.gg API token. |
| `GUILD_ID` | Yes | The server. Commands register here. |
| `CHANNEL_ID` | Yes | The channel for automatic posts. |
| `ANTHROPIC_API_KEY` | No | Claude Haiku writes the fun command posts. |
| `YOUTUBE_API_KEY` | No | YouTube videos for fun posts. Enable YouTube Data API v3 in a Google Cloud project and create an API key. OAuth isn't needed. |
| `STATE_DIR` | No | Where `state.json` lives. See [Hosting](#hosting). |

> [!WARNING]
> Run one copy of the bot per server. A second copy posts everything twice and shares start.gg's rate limit with the first.

### Hosting

Keep `state.json` on persistent storage so tracking and settings survive redeploys. The bot stores it in `STATE_DIR`, else Railway's `RAILWAY_VOLUME_MOUNT_PATH` if set, else `data/` in the project folder.

**Node host.** Use systemd or pm2 to keep `npm start` running.

**Docker.** The volume keeps state across container rebuilds. To mount it somewhere else, set `STATE_DIR` to match.

```sh
docker build -t sama-tracker .
docker run -d --name sama-tracker --restart unless-stopped --env-file .env -v sama-data:/app/data sama-tracker
```

**Railway.** Deploy this repository and Railway builds the included Dockerfile. Add the required `.env.example` values under the service's Variables, plus any optional keys. Attach a persistent volume, and the bot uses its path unless `STATE_DIR` says otherwise. Every push to master redeploys it.

### Tracking a tournament's attendees

To add everyone at a tournament without going through Discord, run `npm run track` (or `node tools/track-attendees.js`) on the bot's host and paste a start.gg tournament link when it asks. On Railway, run `railway ssh` first.

- A link from the tournament's attendees page adds just the events that page is filtered to, like `start.gg/tournament/smashcade-2-4/attendees?filter={"eventIds":["1682422"]}`. A plain tournament link adds everyone registered.
- It refuses tournaments with more than 80 attendees, even when the link filters to one event. `/track add` the crew instead.
- It skips players already tracked and leaves out attendees without a start.gg account. New players start with set results, stream alerts and match call pings off, the same as `/track add`.
- The bot adds the queued players within 30 seconds and the tool reports how many. Players queued while the bot is down get added on its next start.

### Development

`npm run dev` restarts on file changes. `npm test` runs against fake Discord and start.gg responses and posts nothing. Both `npm start` and `npm run dev` join the real server with the tokens in `.env`, so don't run them next to a deployed copy.

## Data and limits

Every card message has a picture: the player's or tournament's start.gg image when there is one. Set result, stream and match call cards fall back to the tracked player's picture when the tournament has none, and a message with no picture of its own shows the bot's avatar. Plain text replies, like errors and on/off confirmations, have none.

start.gg can leave out scores, seeds, characters and stages, and the bot leaves them unknown. Sets link their VOD when the TO adds one on start.gg.

Predictions estimate odds from head-to-head results, common opponents, seeding, and Slippi ratings when both players are ranked and the game is Melee. With no Melee sets, the odds come from Slippi alone. Newer sets count more, and thin data pulls the odds toward 50%.

Slippi rank checks ask about 20 watchlist players per request, one request a second. The connect code search asks start.gg about 10 players per request. Melee reports refresh a watchlist player's Slippi profile at most every 30 minutes and wait up to 3 seconds for it before falling back to the last rank check's numbers. If the Slippi section doesn't fit on a card, the report goes out without it.

### Speed and waiting

start.gg allows 80 requests a minute. A first lookup can take tens of seconds, or about a minute for a large report. Commands share cached history where they can, and long lookups show progress while they load. A **Full report** press on `/h2h` or `/predict` reuses its report's lookup, so it asks start.gg for nothing new. The other full reports read further back, but keep the pages the short report already has. Pressing a Full report button that's already loading shares the first lookup instead of asking again. The second press hears start.gg is on it.

Your commands take turns with start.gg one at a time. A command sent while your last one is still loading answers right away. If it needs start.gg, it says **Queued** with about how long your last one has left, counting everyone else's commands, and starts when that one finishes. Commands that don't need start.gg, like `/help`, don't wait. Up to 3 can wait behind the one running, and past that the bot asks you to try again.

A public report that finishes more than a minute after you ran it goes out as a new message that pings you, and the loading reply is removed. Private answers, like `/scout`, stay private and don't ping.

<details>
<summary>History limits and placement math</summary>

| Command | History checked |
| --- | --- |
| `/stats` | Latest 15 standings and 30 singles sets. With `melee:True`, standings are filtered by game and older pages are read for 30 Melee sets, or all there are if fewer. |
| `/stats verbose:True` | Every finished singles event and up to 3,000 sets. |
| `/doubles` | Latest 30 doubles sets and the events they're from. With `melee:True`, up to 300 sets are read for 30 Melee ones. |
| `/doubles verbose:True` | Up to 600 doubles sets and the events they're from. |
| `/h2h` | Every meeting with the opponent, plus up to 600 sets per player for the one-line odds, in either report length. |
| `/predict` | Every meeting between the two players, plus up to 600 sets per player. Verbose explains the same prediction. |
| `/scout` | Up to 600 sets per player and 400 sets for the opponent's characters. |
| `/scout verbose:True` | Up to 1,200 opponent sets, 800 for characters and stages, every finished event, and 600 of your sets. |
| `/characters` | Up to 400 sets, or 1,600 with verbose. Verbose shows up to 6 games. |
| `/progress` | 60 days, or 180 with verbose, split into 30-day periods. |

`melee:True` filters the history each report checks, and the limits above still apply. `/h2h` and `/predict` check every meeting. Short `/stats` and `/doubles` read back far enough to fill their Melee set windows when they can. `since` and `venue` filter the same history: short `/stats` reads back far enough to fill its 30-set window for those too, and anything older than the checked history stays out.

`/progress` counts a placement toward the period when the event started. Average finishes account for bracket size. Seed comparisons use placement tiers, so seed 6 finishing 5th counts as on seed.

</details>
