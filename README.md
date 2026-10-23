# Sama-tracker

> **One server by default.** The bot serves a single Discord server set by `GUILD_ID` and `CHANNEL_ID`, so there is no invite link. Set `MULTI_GUILD=true` to serve every server it's invited to instead: invite it with `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=139870764032&scope=bot%20applications.commands` (replace `YOUR_CLIENT_ID` with the app's client id from the Developer Portal), then run `/setup channel:#channel` in each server. Commands register globally in that mode, so they can take up to an hour to appear on a server that just invited it. To run the code yourself instead, see [Run your own copy](#run-your-own-copy).

A Discord bot that follows a Smash crew and its local tournaments on start.gg and Slippi. It posts results and stream alerts in one channel, sends registration reminders, and answers slash commands with stats, head-to-heads and odds. With `MULTI_GUILD=true` each server gets its own track list, settings and posts channel from the one copy.

<img src="screenshots/predict.png" alt="/predict" width="56%"> <img src="screenshots/h2h.png" alt="/h2h" width="42%">

<img src="screenshots/sm4sh.png" alt="/sm4sh" width="53%"> <img src="screenshots/recent.png" alt="/recent" width="45%">

Made by Samatron. See it running in [this Discord server](https://discord.gg/VuMz7Y2k2).

[Get started](#get-started) · [Commands](#commands) · [Automatic posts](#automatic-posts) · [Run your own copy](#run-your-own-copy) · [Data and limits](#data-and-limits)

## Get started

1. **Pick the posts channel (multi-server only).** With `MULTI_GUILD=true` someone with Manage Server or the TO role runs `/setup channel:#channel` in each server. Every server tracks its own players and tournaments, with its own settings, in its own channel. Without it the bot answers commands but posts nothing. Single-server builds skip this: they post in `CHANNEL_ID`.
2. **Link yourself.** Connect Discord on your start.gg profile, then run `/link`. Commands then know who you are, and nothing gets posted about you. Tracked players with Discord connected can skip this.
3. **Set up the TO role.** `/t-o role set role:@TO(Buffalo)` uses a role already in the server, or `/t-o role add user:@someone` gives the default **TO** role to someone. TOs use `/t-o tournament`, control `/messages` and can change tracking for anyone. See [TOs](#tos).
4. **Track your tournaments.** A TO's `/t-o tournament add tournament:<link>` posts every set, stream alert, results card and top 8 from a tournament, plus registration reminders. `/t-o tournament event tournament:<link>` makes a Discord event from a link that keeps up with start.gg.
5. **Track yourself.** `/track add` posts your placements wherever you play, found by the Discord on your start.gg. `/track posts` turns on your set results and stream alerts too. TOs can do both for anyone.
6. **Pick your pings.** `/notify` pings you when your match is called, when your set is on stream, or for registration reminders, plus 1-hour DMs before registration closes and before the start. `/matchmaking_role` gets you pinged when someone wants Ultimate or Melee games, and `/matchmaking_search` asks. `/messages` controls posts for the whole server.
7. **Follow Slippi ranked.** `/slippi add` puts your connect code on the watchlist. Tracked players get added on their own once their code shows up on start.gg.

`/help` in Discord lists the commands in short form, on one card. `/help verbose:True` is the full list with the details.

## Commands

### Options that work across commands

| Option | What it does |
| --- | --- |
| `profile` | A start.gg profile link or its final ID, like `start.gg/user/f64a83c8` or `f64a83c8`. `/scout` also takes a tracked or linked player. |
| `player`, `opponent` | A tracked or linked player. Leave an optional `player` blank to look yourself up. `/track remove` and `/track posts` take tracked players only, and only TOs can pick someone else to change. |
| `player:all` | Everyone tracked, on `/upcoming`, `/recent`, `/track posts` and `/notify`. Changing everyone's posts or pings takes a TO. |
| `verbose:True` | The longer report in the stats table below. Short reports with anything to show, other than `/progress`, have a **Full report** button that swaps in the verbose one. |
| `melee:True` | Limits `/stats`, `/h2h`, `/predict`, `/predict_explained`, `/scout`, `/progress` and `/doubles` to Melee. All but `/doubles` add [Slippi ranked](#slippi-ranked) info. Slippi ranked is singles, so `/doubles` leaves it out. `/characters` uses `game:Melee` or `game:Ultimate` instead. |
| `since:2026-01-01` | Counts only sets since that date, on `/stats`, `/h2h`, `/scout`, `/predict` and `/predict_explained`. |
| `venue` | Only offline or only online tournaments, on the same four. Leave it out for both. |

Filtered reports name their filters on the card, and **Full report** buttons keep them.

Player pickers start with the last 5 people you picked. Once you type, names that start with it come first. Names match regardless of case, spaces or punctuation, so `tea leo` finds `Tea | Leo`. A name typed in full works without picking it from the list. A typed name that matches nobody gets the closest one from the same list suggested: one with it in their name, or one a few letters off. A valid connect code typed into `/slippi rank` is looked up live instead.

### Tracking and accounts

| Command | What it does |
| --- | --- |
| `/track add` | Post your placements, wherever you play. Leave out `profile` to find your start.gg by its Discord, or give your own link. TOs can add anyone with `profile:<link or ID>`. Set results and stream alerts start off. |
| `/track remove` | Stop tracking yourself, or anyone with `player:` if you're a TO. Asks first, then an **Undo** button puts them back with all their settings for a minute. |
| `/track list` | Tracked players, who has set results or stream alerts on, and the tracked tournaments. |
| `/track posts sets:<on or off> stream:<on or off>` | Your set results and stream alerts. Leave both out to see them. A TO can change anyone's with `player:<name>`, or everyone's with `player:all`, which asks first for `sets:off` unless it's already off for everyone. Anyone can look at anyone's. Sets finished before results go on aren't posted. |
| `/t-o cleanup` | Untrack everyone whose start.gg Discord isn't in this server. Names them and asks first, then **Undo** puts them back for a minute. Players with no Discord on start.gg stay unless you add `no_discord:True`. TOs only. |
| `/link profile:<link or ID>` | Link your own start.gg account. Leave out `profile` to find it by the Discord connected on start.gg, among the accounts `/profile` searches. |
| `/unlink` | Remove your link, with an **Undo** button for a minute. Tracking stays as it was. |
| `/upcoming` | Tracked tournaments, and any other live or upcoming tournament with 3 or more of the crew registered. `player:` checks one person instead, live from start.gg when they're linked but not tracked. |
| `/recent` | Your last 5 sets. With `player:all`, up to 20 sets, at most 3 per player, from up to 40 players: those with set results on first, then whoever played most recently. |
| `/run` | Your run and next opponent in each current bracket, with the station and scheduled time when the TO set them. Each next opponent gets a head-to-head button for the short report, up to 5, singles only. |

Anyone can track, untrack and change posts for themselves. Yourself means the start.gg you `/link`ed, or the one whose Discord is yours. Only TOs can do it for someone else. New players start with both off. Players with no reported sets in 6 months come off the track list on their own.

`/track remove`, `/track posts player:all sets:off`, `/notify player:all`, `/t-o cleanup` and `/t-o tournament remove` ask "Are you sure?" with buttons first, unless there'd be nothing to change. Only whoever ran the command can press them.

### TOs

| Command | What it does |
| --- | --- |
| `/t-o role add user:<@someone>` | Give someone the **TO** role. TOs only. |
| `/t-o role set role:<@role>` | Use any existing server role for TO privileges. Needs **Manage Server**. |
| `/t-o role remove user:<@someone>` | Take the TO role off someone. Refuses to remove the last known TO. TOs only. |
| `/t-o role list` | The TOs. Anyone can look. |

TOs can control `/messages`, manage tracking and pings for anyone, remove anyone from the Slippi watchlist, and use `/t-o tournament` and `/t-o cleanup`. Only TOs add or remove TOs. The role grants no Discord permissions.

The bot makes the TO role when first needed. A role named `TO` also counts, and `/t-o role set` can select any role. Renaming the selected role does not break it. Until the role exists, **Manage Server** counts as TO access. Afterward, **Manage Server** can change the selected role but grants no other TO tools. `/t-o role list` shows TOs after they use a command. On the bot's first start, Samatron gets the role through the Discord connected to their start.gg.

### Your pings

| Command | What it does |
| --- | --- |
| `/notify` | Which of your pings are on, and the posts about you if you're tracked. Only you see it. |
| `/notify calls:<on or off>` | Get pinged when your set is called, at any tournament. Needs your start.gg linked, or you tracked with Discord connected on start.gg. One message per called set, with everyone in it who has this on, all four players for doubles. |
| `/notify streams:<on or off>` | Get pinged when your set is on stream, at any tournament. Needs your start.gg linked, or you tracked with Discord connected on start.gg. |
| `/notify registration:<on or off>` | Get the **Reg Reminders** role and its pings for tracked tournaments. Everyone with the role gets pinged, even when already registered. |
| `/notify dm_registration:<on or off>` | Get a DM 1 hour before registration closes, with the tournament link, location and image. Skipped once you're registered, if start.gg has your Discord. Only while you're in this server. |
| `/notify dm_start:<on or off>` | Get a DM 1 hour before the tournament starts, with the tournament link, location and image. Only while you're in this server. |
| `/notify user:<@someone>` | Someone else's pings instead of yours, by server member. TOs only. Pick either `user` or `player`, not both. |
| `/notify player:<name>` | Someone else's pings instead of yours, by tracked player. TOs only. |
| `/notify player:all` | Every tracked player with Discord on start.gg. TOs only. Asks first. Players without Discord are skipped. |
| `/notify all:<on or off>` | All five at once. |

`/notify` changes your settings unless a TO picks `user:` or `player:`. Calls and streams need the person linked, or tracked with Discord connected on start.gg. Registration pings and DMs do not. Bulk `player:all` changes only tracked players. DMs go only to current server members, but settings remain if someone leaves.

### Matchmaking

| Command | What it does |
| --- | --- |
| `/matchmaking_role game:<Ultimate or Melee> duration:<hours>` | Give yourself the **Ultimate Matchmaking** or **Melee Matchmaking** role, or take it off if you have it. `duration` keeps it 0.5-24 hours, like 2 or 0.5 for 30 minutes, then it comes off on its own. Running it again without `duration` takes it off right away. Only you see the reply. |
| `/matchmaking_search game:<Ultimate or Melee> message:<text>` | Ping that role with a card naming you and your message, like a netplay connect code or where you're playing. Posts where the command runs, or in that game's channel from `/matchmaking_channel`. `message` is optional. `thread:True` starts a thread on your search to arrange games, named like `Melee:Sam (10/21)`. Only people with the role can use it. |
| `/matchmaking_channel game:<Ultimate or Melee> channel:<#channel>` | Set which channel that game's searches post in. Leave out `channel` to see where they go. `clear:True` goes back to posting where the command runs. Anyone can look, only TOs can change it. |

The bot makes each role the first time someone asks for it, with no permissions and set so anyone can @mention it, so typing `@Melee Matchmaking` works without the commands. A role renamed in server settings keeps working. Timed roles are saved, so a restart doesn't cancel them. A saved search channel that gets deleted posts where the command runs instead, until a TO sets a new one. If an admin turns off mentions for a role, `/matchmaking_search` says so instead of sending a ping nobody gets. Threads need **Create Public Threads** and **Send Messages in Threads** in the channel, and the search still posts when they are missing.

### Stats and matchups

| Command | Short report | With `verbose:True` |
| --- | --- | --- |
| `/stats` | Recent record, placements and biggest upset. | Lifetime results, opponents and seed performance. |
| `/doubles` | Recent 2v2 record, top partners, best finish, biggest upset and latest events. | Up to 600 doubles sets: every partner's record and best finish together, teams played and lost to most, seeds, close sets and best finishes. |
| `/h2h opponent:<name or link/ID>` | Overall record, last 10 meetings and one-line predicted odds. | Every meeting, splits, streaks and the same one-line odds. |
| `/predict opponent:<name or link/ID>` | Estimated odds of winning. | The same odds, with the reasoning behind them. |
| `/predict_explained opponent:<name or link/ID>` | Full breakdown of the odds, with shares, model numbers and bars. | Same, always explained. |
| `/scout profile:<player or link/ID>` | Any opponent's form, characters, toughest opponents and worst matchups, plus your head-to-head. | More history, habits, stages and your odds. |
| `/progress` | Last 30 days against the previous 30, with changes in win rates and placements. | More detail on each period, a 6-month trend and a win-rate graph. |
| `/characters` | Reported characters in Ultimate or Melee. | More history, and other games with reported characters. |

Add `player:` to look up someone else, like `/h2h opponent:Sparg0 player:Leo`. `/scout` takes the opponent as `profile:` instead, and compares them with you. In `/h2h`, `/predict` and `/predict_explained`, either player can be a start.gg link or ID, tracked or not.

`/h2h` runs the same prediction as `/predict` but keeps it to one line, even with `verbose:True`. Run `/predict` for the reasoning behind the odds, or `/predict_explained` for the full breakdown with shares and model numbers. `/scout` always compares the opponent with you, replies privately, and needs you tracked or linked, with Discord connected on start.gg.

> [!TIP]
> On a phone, skip the typing. Long-press a server member (right-click on desktop), open **Apps**, and pick **H2H with me** for `/h2h` or **Scout them** for `/scout`. Both find the member's start.gg the way `/profile` does, so the member has to be tracked, linked, or registered for a tournament the bot checks. **H2H with me** needs you tracked or linked too, and so does **Scout them**.

These reports count singles and leave DQs out of set records. `/doubles` counts 2v2 sets only, for one player, with whoever they teamed with. Its placements come from the events those sets were in, so an event where they never played a set doesn't show. Characters and stages appear only when the TO reports them. `/characters` picks whichever of Ultimate or Melee has more reported games, or more sets if neither has reported characters.

### Slippi ranked

| Command | What it does |
| --- | --- |
| `/slippi add code:<ABCD#123>` | Add your connect code to the watchlist, one per person. Leave out `code` to use the one on your start.gg, if you're tracked or linked. TOs can add anyone's. |
| `/slippi remove` | Take yourself off the watchlist, or anyone with `player:<name>` if you're a TO. The automatic search won't add them back, but `/slippi add` will. |
| `/slippi rank` | Rank, rating, this season's record, daily leaderboard placement, top 3 characters and the last 3 seasons. `player:` takes someone on the watchlist or any connect code. Leave it out for yourself if you're tracked or linked. |
| `/slippi leaderboard` | The watchlist by rank, then rating, with each player's most played character. Shows the top 50. |

Rank cards and rank change posts show slippi.gg's rank badge and start.gg's icon for the player's most played ranked character. The leaderboard shows the leader's badge. Slippi cards with no badge to show, like an empty leaderboard, show the Slippi logo. Every day, the bot checks tracked players not yet on the watchlist, each at most once a week, in their 8 newest finished online singles sets for a connect code and looks that code up on Slippi. `/link` alone does not do this.

Melee reports add Slippi ranked info for players on the watchlist. That covers reports run with `melee:True`, reports where everything found is Melee anyway, and `/h2h` or `/predict` odds that come out in Melee. Players who aren't on the watchlist get the same report as always, with no extra lookups.

| Command | Slippi ranked adds |
| --- | --- |
| `/stats` | Rank, rating, season record, daily leaderboard placement and top characters. |
| `/progress` | The same, plus the change in rating since the end of last season. |
| `/h2h`, `/predict`, `/scout` | Rank, rating and season record for each player on the watchlist. When both players are ranked and the odds are for Melee, their ratings count toward the odds, even with no Melee sets to go on. Otherwise the ranks are only shown. |
| `/characters game:Melee` | Ranked characters this season with game counts, next to what TOs reported. |

`/predict melee:True` gives Slippi odds even when neither player has Melee sets on start.gg, so netplay-only players can compare. With only one of them ranked, it shows the ranks and no odds.

Netplay tournaments on start.gg ask for a connect code at registration, and start.gg keeps it. Once a day the bot looks for the codes of tracked players not yet on the watchlist, in their 8 newest online singles sets, checking each player at most once a week. Anyone found goes on the watchlist under their start.gg tag. Linked players can use `/slippi add` themselves. Offline-only players and people who play other games online have no code there, so add them with `code:`.

Ranks use slippi.gg's cutoffs: Bronze 1 through Master 3 by rating, and Grandmaster for a Master rating with a placement on Slippi's daily leaderboards. A player with fewer than 5 ranked sets in the season is Pending. Slippi doesn't share ranked match results, so posts show the new rank and rating change, not who they played.

When a ranked season ends, the bot posts a wrap-up of it once: the watchlist's final ranks with ratings and records (the top 10), the 3 biggest rating gains on the season before, and the 3 characters the watchlist played most. Final ratings and records come from slippi.gg's season history, so a player who hasn't played the new season yet counts the same. Characters and daily leaderboard placements aren't in that history, so they come from the bot's last check before each player's reset. It goes out within 30 minutes of Slippi listing the season as finished, and a season that ended over a week before the bot sees it gets none. `/messages slippi` turns it off with the rank changes.

> [!NOTE]
> Slippi has no public API. The bot uses the one slippi.gg uses, so a change on Slippi's side can stop rank checks until the bot is updated. `/status` shows when the last check failed.

### Tournaments

A tracked tournament posts every set, whoever played, plus its stream alerts, results card and each event's top 8. Sets and stream alerts go in its own thread. It also sends registration reminders, and posts every called set with `calls:on` in `/t-o tournament posts`. Tracking players works alongside it: a tracked player with set results on gets posted at any tournament, tracked or not.

| Command | What it does |
| --- | --- |
| `/t-o tournament add tournament:<link>` | Track a tournament: every finished set, stream alerts, results, top 8s and registration reminders. `reminders:off` leaves out the reminders, `schedule:7d,3d,1d,6h` sets custom reminder times, `add_event:on` also makes a Discord event. |
| `/t-o tournament remove tournament:<name>` | Stop tracking it. Asks first, then **Undo** puts it back for a minute. |
| `/t-o tournament posts tournament:<name>` | Turn its `sets`, `stream`, `calls`, `top8` and `reminders` on or off. `schedule:` changes the reminder times, `schedule:default` goes back to the usual four. Leave them all out to see them. `calls` posts every called set, even with nobody to ping, and starts off. |
| `/t-o tournament event tournament:<link>` | Make a Discord event from a start.gg link, with the time and end time, venue, close time, events, streams and cover photo. It doesn't track the tournament. |
| `/bracket` | Bracket links for tracked tournaments, from 30 minutes before the start until 6 hours after the end. |
| `/stream_link` | Streams added on start.gg for tracked tournaments and tournaments tracked players entered, in the same window as `/bracket`. Twitch streams are links, and other sites show the stream name. If none are going on, none have a stream, or start.gg doesn't answer, it says to ask a TO in another channel. |
| `/registered tournament:<link>` | Registered server members, by name so nobody gets pinged. `by_event:True` groups them by event. |
| `/reg_warn tournament:<link> user:<@someone>` | Ping someone with a registration link if they haven't registered. Each person gets one warning per tournament every 12 hours. Anyone can use it. |

`/t-o tournament` is for [TOs](#tos). Discord shows it to everyone, since the bot checks the TO role itself, and anyone else gets a private no. Tournaments only get tracked by a TO running `/t-o tournament add`, never on their own.

`tournament` takes a start.gg link, or a tournament the bot already knows from the list: tracked ones and ones tracked players are in, soonest first. Tournaments nobody tracks are forgotten a month after they end. `/t-o tournament add` lists only ones that aren't tracked yet, and `/t-o tournament remove` and `/t-o tournament posts` only tracked ones. `/t-o tournament event` lists only upcoming ones, since Discord events have to start in the future, each once. `/t-o tournament add add_event:on` tracks the tournament and makes its Discord event. `/t-o tournament event` only makes the event. Both find an event made earlier for the same link instead of making another.

Discord events sync hourly with start.gg until they start. The bot copies changes to the name, times, cover, venue, registration close, streams, and events. It cancels an event if start.gg deletes or unpublishes the tournament. Changing the start.gg link does not cancel it because the bot uses the tournament ID. Discord edits remain until start.gg changes. The bot leaves started or manually deleted events alone. An event without an end time on start.gg runs `event_length` hours (5 unless the server changed it with `/messages event_length:`). A major or regional with no end time still gets 12 hours.

`/messages events:True` makes a Discord event on its own for each upcoming tracked tournament, once. An event a mod deletes isn't made again. It's off by default.

Roll calls, registration reminders, the 1-hour DMs, `/upcoming` and `/registered` show the venue and its street address when the TO put them on start.gg, as a link that opens the address in Google Maps. Without an address they show the city. Discord events put the venue and address in their location, or the address alone when both don't fit Discord's 100 characters.

At a tracked tournament, the crew for the roll call and the placements post is tracked players and anyone registered whose start.gg Discord is in this server. Linking alone does not add someone. A hidden entrant list leaves just the tracked players.

Tournament post changes apply while it is running. Sets turned on start from that moment, without posting the earlier backlog. Stream alerts turned on include a set that is still on stream.

Reminders go out 7 days, 3 days, 1 day and 6 hours before registration closes, unless a TO sets custom times for that tournament with `schedule:`, like `schedule:7d,12h,1h`. A schedule holds up to 10 reminders, each 1 hour to 30 days out, and the last one is the last call. `/track list` shows a custom schedule next to its tournament. If registration stays open past the tournament start, the start is the deadline. Past reminders are skipped, and a last call set within 6 hours goes out right away. Turning reminders back on, or changing the schedule, with `/t-o tournament posts` starts from the next one still to come.

`/notify dm_registration` sends a DM 1 hour before registration closes. `/notify dm_start` sends one 1 hour before the tournament starts. Both include the link, location, and image, require tournament reminders, and go only to current server members, checked right before each one goes out, so someone who left gets nothing. Leaving keeps your `/notify` switches for if you rejoin. These are the only DMs the bot sends on its own, and it answers nothing sent from a DM. Registration DMs skip registered players when start.gg has their Discord. If registration closes within an hour of the start, only the start DM goes out because it also has the registration link.

Connect Discord on start.gg so the bot recognizes your registration and skips your registration DMs and `/reg_warn`. Channel reminders ping the **Reg Reminders** role for everyone with it. A hidden entrant list blocks these checks. `/reg_warn` sends no ping if registration is closed, the person is registered, the list is hidden, or someone already warned them about that tournament in the last 12 hours. That last one tells only whoever ran it, with when they can be warned again.

### Server and general

| Command | What it does |
| --- | --- |
| `/help` | Short command list. `verbose:True` lists every command with the details. |
| `/setup channel:#channel` | Multi-server only. Show or set the channel automatic posts go in for this server. Anyone can look, and Manage Server or TOs can change it. A channel the bot can't view, send messages or embed links in gets turned down, and a missing Attach Files or thread permission gets a note. The next check posts in the new channel, no restart needed. Without it the bot answers commands but posts nothing. |
| `/status` | Uptime, when the latest version was deployed plus its message, the last start.gg and Slippi checks, how many players and tournaments are tracked, requests waiting on start.gg, whether start.gg is down right now, any downtime before the last start, why a post last missed its thread, and a link to the GitHub repo. A copy run on another computer also shows that computer's name. |
| `/profile` | A tracked or linked player's start.gg with `player:`, or a server member's with `user:`. Leave both blank for yourself. |
| `/messages` | Show or change automatic posts, threads (off, one per tournament or one per event), event length, set result colors and the recap schedule. Needs the TO role or **Manage Server**. |
| `/data` | Links to [Samatracker](https://samatracker.vercel.app), the web companion with cached player lookup, recent results and Slippi ranks, and both series data pages: the [Monday Night SmashBall data page](https://monday-night-smashball.vercel.app) and the [UB Smash Royale data page](https://ub-smash-royale.vercel.app), with every tournament's attendance, winners, most events entered and characters. |
| `/socials` | Saved streams and social links. |
| `/socials_edit add name:<who> link:<url>` | Save a link. `https://` is optional, and links with the same name share a line. |
| `/socials_edit remove link:<url>` | Remove a saved link. |

`/profile` checks the Discord connected on start.gg against accounts the bot has already seen: tracked players, people who used `/link`, and people registered for a tournament the bot checks. It reads registration lists again at most every 10 minutes. If it can't find you, connect Discord on start.gg and run `/link` with your profile link. To find someone else with `/profile @them`, they have to be on that list first. Or pick them from the tracked and linked list with `player:`, which needs no Discord matching.

`/socials_edit` needs **Manage Server** by default. You can hand it to other roles under Server Settings > Integrations > Sama-tracker, and the bot goes by that.

### Fun

`/64`, `/melee`, `/brawl`, `/sm4sh`, `/ult` and `/pplus` are each a different character with their own Smash take. With `ANTHROPIC_API_KEY` set, Claude Haiku writes each post in that character from the game's talking points. Every post comes with a SmashWiki screenshot. Posts are made ahead of time so the command replies right away, and ones already queued survive a restart. Without `ANTHROPIC_API_KEY`, each command replies with its catchphrase, which is also the fallback if a fetch fails with the key set.

`/bills` posts a pro-Bills photo or GIF with one of many messages and a link to the source. Photos load live from a broad set of Wikimedia Commons categories, and GIFs load live from the official Buffalo Bills GIPHY channel. It rotates the two types evenly, uses every image in a pool before repeating one and never sends the same image twice in a row. A small built-in GIF pool stands in if GIPHY is down. The pools reload when the bot restarts, but posts already queued and the spot in the rotation are kept, so a redeploy doesn't repeat or skip one. It needs no AI or API keys.

`/messages bills:True` posts the Bills final score here after each game, with the other team's logo, green for a win and red for a loss. Scores come from ESPN's public scoreboard, with quarters and yards. Off by default. It needs no AI or API keys.

`/view_pfp` posts the bot's profile picture at full size, the meme image its avatar comes from.

## Automatic posts

`/link` identifies you for commands. `/track` follows a player publicly. `/notify` controls pings. Tracking a tournament covers its whole bracket. Registered server members can appear in its roll call and placements. Anyone can appear in its sets, streams, or top 8.

Ping changes apply during a tournament. Turning calls or streams on catches one that is still active, even if its card already posted for someone else.

| Automatic message | When it posts | Who appears and what controls it |
| --- | --- | --- |
| Set results | Every finished set at a tracked tournament. Anywhere else, when a tracked player with set results on finishes a set. | `/track posts sets` controls a tracked player outside tracked tournaments. A tracked tournament includes everyone. |
| Stream alerts | Every set on stream or next in the stream queue at a tracked tournament. Anywhere else, when a tracked player with stream alerts on has a set there. A new alert waits 30 seconds to confirm. | `/track posts stream` controls a tracked player outside tracked tournaments. A tracked tournament includes everyone. `/notify streams` pings whoever is playing. |
| Match call pings | When start.gg marks a set called for someone with `/notify calls` on. The ping includes the station when available. A call taken back gets crossed out. At a tracked tournament with `calls:on`, every called set posts even with nobody to ping. | One card per set names everyone in it. `/notify calls` controls each person's ping. |
| Tournament roll calls | An hour before a tournament with at least 3 of the crew registered, with the stream links from its start.gg page. | Tracked players appear. At a tracked tournament, registered server members whose Discord is connected on start.gg count too. Linking alone does not add someone. |
| Tournament placements | With the top 8 as soon as every event finishes at a tracked tournament, even when top 8 posts are off. Otherwise 12 hours after the tournament ends. Unfinished placements are marked as projected. Notable upset wins by tracked players go under the placements. | Tracked players appear. At a tracked tournament, the same registered server members as roll calls appear too. |
| Top 8s | As soon as every event finishes at a tracked tournament. Delayed or failed top 8s retry as described below. | Everyone in each top 8 appears, tracked or not. |
| Registration reminders | At the deadlines under [Tournaments](#tournaments). | The card lists no players. `/notify registration` hands out the **Reg Reminders** role and pings it for everyone with it. |
| Registration DMs | 1 hour before registration closes at a tracked tournament. | DM with the tournament link, location and image. `/notify dm_registration` controls who gets one, skipped once registered when start.gg has their Discord. Only to current server members. Needs the tournament's reg reminders on. |
| Start DMs | 1 hour before a tracked tournament starts. | DM with the tournament link, location and image. `/notify dm_start` controls who gets one, only to current server members. Needs the tournament's reg reminders on. When registration closes within an hour of the start, only this one goes out. |
| Discord events | Off by default. Within 15 minutes of an upcoming tournament getting tracked. | `/messages events` controls it. With it off, a tournament only gets one from `/t-o tournament event` or `add_event:on`. |
| Slippi rank changes | Within 30 minutes of a watchlist player moving to another rank. A new season reset is not posted, the wrap-up covers it. | `/slippi add` and `/slippi remove` control the watchlist. Tracked players can be discovered from connect codes entered on start.gg. Linked-only players cannot. |
| Slippi season wrap-ups | Once per ranked season, within 30 minutes of Slippi listing it as finished. | Watchlist players with sets that season. Final ranks, biggest climbers and most played characters. `/messages slippi` controls it with rank changes. |
| Bills final results | Off by default. After each Bills game, with quarters and yards. | No player appears. |
| Weekly crew recap | Sunday at 9 pm New York time by default. A notable upset win by a tracked player goes on top. | Tracked players with a non-DQ singles set that week appear. There is no separate player switch. |
| Bot updates | When Railway starts a new deployment. | No player appears. Always posts, with when it deployed and the commit message, plus the outage below when there was one. |
| Back online | When the bot starts after being off for 10 minutes or more, like a crash or a hosting outage. A normal redeploy is quicker and doesn't post. | No player appears. Always posts, with how long it was down, that commands sent then need sending again, and what catches up. |

Set result cards put the winner on the left with a W and the loser on the right with an L. A winner seeded 7 or more placement tiers lower, like seed 17 over seed 2, gets Major upset. Tournament placements and the weekly recap list the same kind of wins by tracked players as notable upsets. `/messages set_colors` colors them green for a tracked win, red for a loss, gold when two tracked players meet and blue when nobody tracked played, so a small crew sees each member at a glance. Off, every card stays blue. Only a tracked player's first DQ per event is posted, so no-shows at a tracked tournament stay out. Top 8s list everyone, one card per event. An event that has not started holds the top 8 until the tournament's end time. A top 8 lookup that fails at placements time holds them back 12 hours, then they go without it. A top 8 that fails to send retries for up to 3 days.

Each card's side color says what kind of post it is. Only set results and the Bills final use the `set_colors` green, red and blue, and a set the TO resets turns grey. Gold is two players meeting: crew vs crew results, and `/h2h`, `/predict` and `/scout`'s matchup card. Match calls, `/run`, and `/bracket`, `/stream_link` and `/upcoming` once a tournament starts are magenta, next to Twitch purple for stream alerts. Registration reminders and the start DM are orange, and dark orange for the last call, its DM and `/reg_warn`. Placements, top 8s and the weekly recap are yellow, thread cards blue, `/status` and bot updates pink, and lookups and roll calls violet. Slippi cards take the rank's color, or Slippi green without one.

Singles stream alerts and match calls get a **Head to head** button for the short report that replies privately to whoever presses it. It comes off when the set ends or is deleted, or 12 hours after the post.

The set, stream and match call checks run every 2 minutes. Each asks start.gg only about players with that switch on, 20 players per request, so the checks stay small however many players are tracked. A tracked tournament that's going on adds one request per 20 of its events for its new sets, and one per live tournament for its stream queue. When the stream check finds a new set on stream, it asks again 30 seconds later to confirm. A set in a stream queue links that queue's stream. Rechecking recent set results and match calls takes one request per 50 posts, plus 1 per 10 set results whose winner or score changed. Bills finals check ESPN daily, every 15 minutes from an hour before kickoff until 8 hours after: one request plus one per new final. A roll call adds one request for its streams. 1-hour DMs look a tournament up every 15 minutes, only in the 3 hours before one is due, plus one request for who's registered before a registration DM.

After the bot has been down, set results from the last 3 hours still post and older ones are skipped. `/status` says when that happened. See [When something is down](#when-something-is-down) for what people see.

### Fixing posts that turn out wrong

TOs report the wrong winner, fix it a minute later, or call a set and take it back. The bot edits what it posted to match.

| Post | What changes |
| --- | --- |
| Set results | For an hour after a result posts, the bot checks it again every 2 minutes. If the TO changes the winner or score, the card is replaced with the new result marked **Corrected by TO**. If the TO resets or deletes the set, the card turns grey and its title starts with **Reset by TO**. If the set is reported again within that hour, the card shows the new result. |
| Match call pings | For 15 minutes after a call, the bot checks it every 2 minutes. If the set goes back to waiting, the ping is crossed out with "Uncalled by the TO", and calling it again pings again. This needs the `calls` switch on. |
| Discord events | Checked hourly until they start. A new time, end time, cover photo, name, venue, close time, streams or event list on start.gg gets edited in, and a tournament deleted there gets its event cancelled. Nothing is posted about it. |
| Placements and top 8s | Projected placements are checked hourly for 3 days. Once start.gg has every placement final, or every event in the top 8 finished, the post is edited to the final standings. If the final version no longer splits into the same number of messages, it goes out as a new post saying so. A top 8 with nothing reported when placements posted goes out as a new message once the bracket is finished. |

Some TOs tag an event with the wrong game, like a "Melee Singles" tagged as Ultimate. When an event's name says Melee and its tag says Ultimate, or the other way around, the bot goes by the name. That covers `melee:True`, `game:` and the game shown on cards. Events whose name mentions both games, or another game like Project+, keep their tag.

### Turning posts on and off

Run `/messages` without options to see the current settings. TOs and members with Manage Server can change any of the eleven switches: `sets`, `streams`, `calls`, `rollcall`, `results`, `top8`, `registration`, `events`, `slippi`, `recap` and `bills`, plus `event_length`. Only Bills finals and Discord events start off server-wide. `set_colors` colors set result cards green for a tracked win, red for a loss, gold when two tracked players meet and blue when nobody tracked played, and starts off. Turning `events` on checks for Manage Events first, and it makes events for upcoming tournaments already tracked. The `/notify` DMs go by each person's own setting and the tournament's reminders, not these switches. Match calls only ping people who turned on `/notify calls`, stream alerts only ping whoever is playing with `/notify streams` on, and top 8s only come from tracked tournaments.

```text
/messages sets:False streams:False
/messages recap_day:Sunday recap_time:20:00 timezone:America/New_York
```

Times use 24-hour `HH:MM` in the chosen timezone, with daylight saving. Settings save right away and survive restarts. Posts that came due while a type was off stay skipped after you turn it back on. Schedule changes apply to future recaps. Each player's `/track posts`, each tournament's `/t-o tournament posts` and everyone's own `/notify` pings still apply on top.

### Threads

`/messages threads` decides where set results and stream alerts go, so a big weekend doesn't flood the channel. A tracked tournament posts every set, so it always gets a thread. It has three modes:

| Mode | Where they go |
| --- | --- |
| **Off, post in the channel** | The channel, except a tracked tournament's, which go in its thread. This is the default. |
| **One thread per tournament** | A thread for each tournament, named after it. |
| **One thread per event** | A thread for each event, like `Genesis 11 · Ultimate Singles`. A tournament where the crew plays three events gets three threads. |

The first set result or stream alert from a tournament, or from an event in the per-event mode, posts a card with its name in the channel and starts a thread on it. The bot pins each card so the thread stays easy to find. A tournament card comes down once placements post or 6 hours after the end, and an event card comes down when that event finishes. Later set results and stream alerts from it go in the thread. Match call pings, roll calls, placements and top 8s stay in the channel in every mode. Discord has no threads inside threads, so the per-event threads sit side by side in the channel. Each card names its tournament and event.

The bot needs **Create Public Threads** and **Send Messages in Threads** in the channel. Picking either thread mode checks for both and names any that are missing instead of switching. Pinning thread cards needs **Manage Messages**; without it threads still work but the cards stay unpinned. If a post can't go in its thread later, say a permission was removed or a moderator locked the thread, it posts in the channel and `/status` shows why. A deleted thread gets replaced on the next post. Threads archive after a day without posts and reopen when the next one goes in. Switching to **Off** sends everything back to the channel, except a tracked tournament's sets and streams, which keep their thread. Switching modes keeps the old threads, so going back to a mode reuses them for 14 days. A server that turned threads on before there were three modes keeps one thread per tournament.

## Run your own copy

You need Node.js 22.9 or newer, a Discord bot and a start.gg API token.

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications). Invite it with the `bot` and `applications.commands` scopes and these permissions: View Channel, Send Messages, Embed Links and Attach Files. For threads, add Create Public Threads and Send Messages in Threads, plus Manage Messages so thread cards get pinned. For `/t-o tournament event`, `add_event:on` and `/messages events`, add Manage Events so it can make and update scheduled events. Manage Roles lets `/t-o role` make and hand out the TO role, `/notify registration` hand out the Reg Reminders role, and `/matchmaking_role` make and hand out the matchmaking roles. Reg reminder pings work without it, and without a TO role Manage Server counts as a TO. It needs no privileged intents. With `MULTI_GUILD=true` commands register globally, so invite it to as many servers as you like and run `/setup channel:#channel` in each.
2. Create a start.gg API token under Settings > Developer Settings.
3. Copy [.env.example](.env.example) to `.env` and fill it in. Single-server builds need `GUILD_ID` and `CHANNEL_ID` for their one server and channel. Multi-server builds leave both out and set `MULTI_GUILD=true` instead.
4. Install and start it:

   ```sh
   npm install
   npm start
   ```

5. Move the bot's role above **Reg Reminders** so it can hand out that role. Keep the name `Reg Reminders`, since `/notify registration` looks for it. The TO and matchmaking roles the bot makes start below its own. If you make them yourself, use `/t-o role set` for a TO role with another name, and keep roles the bot hands out below its role.
6. The bot gives Samatron's start.gg account the TO role on its first start. On your own copy, change `FIRST_TO` in `src/commands/to.js` to your start.gg profile, or hand yourself the role in server settings.

| Variable | Required | What it's for |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | The bot's token from the Developer Portal. |
| `STARTGG_TOKEN` | Yes | The start.gg API token. |
| `GUILD_ID` | Single-server only | The server. Commands register here. Leave out with `MULTI_GUILD=true`, which migrates it into that server's entry on first boot instead. |
| `CHANNEL_ID` | Single-server only | The channel for automatic posts. Leave out with `MULTI_GUILD=true`. |
| `MULTI_GUILD` | No | Set to `true` to serve every server the bot is invited to, each with its own track list, settings and `/setup` posts channel. Its commands only work in servers, not in a DM with the bot. Off by default. |
| `ANTHROPIC_API_KEY` | No | Claude Haiku writes the fun command posts. |
| `YOUTUBE_API_KEY` | No | YouTube videos for fun posts. Enable YouTube Data API v3 in a Google Cloud project and create an API key. OAuth isn't needed. |
| `STATE_DIR` | No | Where `state.json` lives. See [Hosting](#hosting). |

> [!WARNING]
> Run one copy of the bot total. It serves every server it's invited to from that one copy. A second copy posts everything twice and shares start.gg's rate limit with the first.

### Hosting

The bot quits at startup only when start.gg turns down `STARTGG_TOKEN`. If start.gg is down or slow when it starts, it logs that and starts anyway, and every check picks back up once start.gg answers.

Keep `state.json` on persistent storage so tracking and settings survive redeploys. With `MULTI_GUILD=true` one file holds every server under `state.guilds[guildId]`, each with its own players, tournaments, settings and posts channel. Every save also refreshes an hourly `state.json.bak`, which the bot falls back to if the main file ever reads corrupt. The bot stores it in `STATE_DIR`, else Railway's `RAILWAY_VOLUME_MOUNT_PATH` if set, else `data/` in the project folder. Every push to master redeploys, same as before.

**Node host.** Use systemd or pm2 to keep `npm start` running.

**Docker.** The volume keeps state across container rebuilds. To mount it somewhere else, set `STATE_DIR` to match.

```sh
docker build -t sama-tracker .
docker run -d --name sama-tracker --restart unless-stopped --env-file .env -v sama-data:/app/data sama-tracker
```

**Railway.** Deploy this repository and Railway builds the included Dockerfile. Add the required `.env.example` values under the service's Variables, plus any optional keys. Attach a persistent volume, and the bot uses its path unless `STATE_DIR` says otherwise. Every push to master redeploys it, and each new deployment posts a bot update where it posts everything else: the one channel, or each server's posts channel with `MULTI_GUILD=true`. Set the service's healthcheck path to `/health` so Railway waits for the new version to log in before switching traffic to it. It listens on Railway's `PORT`, or 3000 when that's unset. A port something else already holds gets logged, and the bot runs on without the healthcheck. The old version saves and signs off when Railway stops it. A volume can't be mounted on two deploys at once, so a redeploy still has a short gap while the new one starts, and sets from the last 3 hours post on catch-up.

### Development

`npm run dev` restarts on file changes. `npm run check` syntax-checks every file with node's own parser. `npm test` runs against fake Discord and start.gg responses and posts nothing. Both `npm start` and `npm run dev` join the real server with the tokens in `.env`, so don't run them next to a deployed copy.

`scripts/backtest.js` checks the `/predict` odds against sets the tracked players already played each other. Each set gets predicted from only what happened before it, and it prints log loss, Brier score and how often favourites at each level of confidence won. Fetching uses the start.gg token and shares its rate limit with a deployed copy, so save the histories once and score the saved copy after each change to `src/predict.js`:

```sh
node --env-file=.env scripts/backtest.js --save data/backtest.json
node scripts/backtest.js --load data/backtest.json
```

## Data and limits

Every card message has a picture: the player's or tournament's start.gg image when there is one. Set result, stream and match call cards fall back to the tracked player's picture when the tournament has none, and a message with no picture of its own shows the bot's avatar. Discord can't always load start.gg's pictures from a link, so command replies upload them with the message, up to 10 files and 8MB. A start.gg picture that won't download comes off the card, and the avatar shows if that leaves the message with none. Plain text replies, like errors and on/off confirmations, have none.

start.gg can leave out scores, seeds, characters and stages, and the bot leaves them unknown. Sets link their VOD when the TO adds one on start.gg.

Predictions estimate odds from head-to-head results, common opponents, seeding, and Slippi ratings when both players are ranked and the game is Melee. With no Melee sets, the odds come from Slippi alone. Newer sets count more, and thin data pulls the odds toward 50%.

Slippi rank checks ask about 20 watchlist players per request, one request a second. The connect code search asks start.gg about 10 players per request. Melee reports refresh a watchlist player's Slippi profile at most every 30 minutes and wait up to 3 seconds for it before falling back to the last rank check's numbers. If the Slippi section doesn't fit on a card, the report goes out without it.

### Speed and waiting

start.gg allows 80 requests a minute. A first lookup can take tens of seconds, or about a minute for a large report. Commands share cached history where they can, profile and tournament links that come back empty stay missed for 5 minutes, and long lookups show progress while they load. A **Full report** press on `/h2h` or `/predict` reuses its report's lookup, so it asks start.gg for nothing new. The other full reports read further back, but keep the pages the short report already has. Pressing a Full report button that's already loading shares the first lookup instead of asking again. The second press hears start.gg is on it. A press that expires before the bot can answer runs once more on its own, landing as a new message that pings whoever pressed instead of the timeout. Private and ephemeral reports retry by DM so they stay private.

Your commands take turns with start.gg one at a time. A command sent while your last one is still loading answers right away. If it needs start.gg, it says **Queued** with about how long your last one has left, counting everyone else's commands, and starts when that one finishes. Commands that don't need start.gg, like `/help`, don't wait. Up to 3 can wait behind the one running, and past that the bot asks you to try again. When start.gg is backed up for everyone, new commands ask you to try again in a minute instead of queueing. Every 10th request goes to the background checks, so automatic posts keep moving on busy nights.

A public report that finishes more than a minute after you ran it goes out as a new message that pings you, and the loading reply is removed. Private answers, like `/scout`, stay private and don't ping.

A command that fails says whose side it failed on: start.gg not answering, start.gg having trouble or limiting the bot, start.gg turning down the bot's token, Slippi, Discord missing a permission, or a bug in the bot itself. The details go in the bot's logs. A start.gg request that times out or gets a 5xx error is tried twice more before that.

### When something is down

| What's down | What people see |
| --- | --- |
| The bot itself, like a crash or a Railway outage | Discord's own "The application did not respond". The bot isn't running, so it can't answer or change that text, and its name shows offline in the member list. Once it's back after 10 minutes or more, it posts **Back online** in the posts channel with when it went down, for how long, and that commands sent then need sending again. A new version that comes up after an outage says the same on its bot update card instead. |
| start.gg | Once start.gg has sent nothing but timeouts and 5xx errors for 2 minutes, commands that need it answer right away with "start.gg has been down since ..." instead of each waiting about 90 seconds on retries. One command a minute still goes through to check, the automatic checks keep asking, and the first answer ends it for everyone. Meanwhile the bot's status in the member list reads "start.gg is down" and `/status` shows since when. |
| Slippi | Melee reports wait 3 seconds for Slippi, then use the last rank check's numbers, so they still go out. `/slippi` commands say Slippi didn't answer, and `/status` shows when the last rank check failed. |
| Discord | Commands say Discord is having trouble. Automatic posts that fail get retried where the post type does that, like top 8s. | Keeping Discord events up to date costs one start.gg request per upcoming event an hour.

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
| `/predict_explained` | Same history as `/predict`, always with the full breakdown. |
| `/scout` | Up to 600 sets per player and 400 sets for the opponent's characters. |
| `/scout verbose:True` | Up to 1,200 opponent sets, 800 for characters and stages, every finished event, and 600 of your sets. |
| `/characters` | Up to 400 sets, or 1,600 with verbose. Verbose shows up to 6 games. |
| `/progress` | 60 days, or 180 with verbose, split into 30-day periods. |

`melee:True` filters the history each report checks, and the limits above still apply. `/h2h`, `/predict` and `/predict_explained` check every meeting. Short `/stats` and `/doubles` read back far enough to fill their Melee set windows when they can. `since` and `venue` filter the same history: short `/stats` reads back far enough to fill its 30-set window for those too, and anything older than the checked history stays out.

`/progress` counts a placement toward the period when the event started. Average finishes account for bracket size. Seed comparisons use placement tiers, so seed 6 finishing 5th counts as on seed.

</details>
