# Sama-tracker

> **One server by default.** The bot serves a single Discord server set by `GUILD_ID` and `CHANNEL_ID`, so there is no invite link. Set `MULTI_GUILD=true` to serve every server it's invited to instead: invite it with `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2252117909761024&scope=bot%20applications.commands` (replace `YOUR_CLIENT_ID` with the app's client id from the Developer Portal), then run `/t-o settings channel:#channel` in each server. Commands register globally in that mode, so they can take up to an hour to appear on a server that just invited it. To run the code yourself instead, see [Run your own copy](#run-your-own-copy).

A Discord bot that follows a Smash crew and its local tournaments on start.gg and Slippi. It posts results and stream alerts in one channel, sends registration reminders, and answers slash commands with stats, head-to-heads and odds. With `MULTI_GUILD=true` each server gets its own track list, settings and posts channel from the one copy.

<img src="screenshots/predict.png" alt="/predict" width="56%"> <img src="screenshots/h2h.png" alt="/h2h" width="42%">

<img src="screenshots/sm4sh.png" alt="/sm4sh" width="53%"> <img src="screenshots/recent.png" alt="/recent" width="45%">

Made by Samatron. See it running in [this Discord server](https://discord.gg/VuMz7Y2k2).

[Get started](#get-started) · [Commands](#commands) · [Automatic posts](#automatic-posts) · [Run your own copy](#run-your-own-copy) · [Data and limits](#data-and-limits)

## Get started

1. **Pick the bot channel.** A TO runs `/t-o settings channel:#channel` in each server. Bot replies and automatic posts use that channel and its threads. Settings work privately anywhere, and matchmaking can use its own channels. Single-server builds start with `CHANNEL_ID` until a TO changes it.
2. **Link yourself.** Connect Discord on your start.gg profile, then run `/link`. Commands then know who you are, and nothing gets posted about you. Tracked players with Discord connected can skip this.
3. **Set up the TO role.** `/t-o role set role:@TO(Buffalo)` uses a role already in the server, or `/t-o role add user:@someone` gives the default **TO** role to someone. TOs use `/t-o tournament`, change `/t-o settings` and can change tracking for anyone. See [TOs](#tos).
4. **Track your tournaments.** A TO's `/t-o tournament add tournament:<link>` posts every set, stream alert, match call, next opponent, results card and top 8 from a tournament, plus registration reminders, following `/t-o settings`. `/t-o tournament event tournament:<link>` makes a Discord event from a link that keeps up with start.gg, and `/t-o tournament list` shows everything tracked.
5. **Track yourself.** `/track add` posts your placements wherever you play, found by the Discord on your start.gg. `/track posts` turns on your set results and stream alerts too. TOs can do both for anyone.
6. **Pick your pings.** `/notify` pings you when your match is called, when your next opponent is set, when your set is on stream, or for registration reminders, plus 1-hour DMs before registration closes and before the start. `/matchmaking role` gets you pinged when someone wants Ultimate or Melee games, and `/matchmaking search` asks. `/t-o settings` controls posts for the whole server.
7. **Follow Slippi ranked.** `/slippi add` puts your connect code on the watchlist. Tracked players get added on their own once their code shows up on start.gg.

`/help` in Discord lists the commands in short form, on one card. `/help verbose:True` is the full list with the details.

## Commands

### Options that work across commands

| Option | What it does |
| --- | --- |
| `profile` | A start.gg profile link or its final ID, like `start.gg/user/f64a83c8` or `f64a83c8`. `/scout` also takes a tracked or linked player. |
| `player`, `opponent` | A tracked or linked player. Leave an optional `player` blank to look yourself up. `/track remove` and `/track posts` take tracked players only, and only TOs can pick someone else to change. |
| `player:all` | Everyone tracked, on `/upcoming`, `/recent`, `/track posts` and `/notify`. Changing everyone's posts or pings takes a TO. |
| `verbose:True` | The longer report in the stats table below. Short reports with anything to show, other than `/progress` and `/predict`, have a **Full report** button that swaps in the verbose one. |
| `melee:True` | Limits `/stats`, `/h2h`, `/predict`, `/scout`, `/progress` and `/doubles` to Melee. All but `/doubles` add [Slippi ranked](#slippi-ranked) info. Slippi ranked is singles, so `/doubles` leaves it out. `/characters` uses `game:Melee` or `game:Ultimate` instead. |
| `since:2026-01-01` | Counts only sets since that date, on `/stats`, `/h2h`, `/scout` and `/predict`. |
| `venue` | Only offline or only online tournaments, on the same four. Leave it out for both. |

Filtered reports name their filters on the card, and **Full report** buttons keep them.

Player pickers start with the last 5 people you picked. Once you type, names that start with it come first. Names match regardless of case, spaces or punctuation, so `tea leo` finds `Tea | Leo`. A name typed in full works without picking it from the list. A typed name that matches nobody gets the closest one from the same list suggested: one with it in their name, or one a few letters off. A valid connect code typed into `/slippi rank` is looked up live instead.

### Tracking and accounts

| Command | What it does |
| --- | --- |
| `/track add` | Post your placements, wherever you play. Leave out `profile` to find your start.gg by its Discord, or give your own link. TOs can add anyone with `profile:<link or ID>`, or pick a server member from the list with `user:@someone`, found by the Discord on their start.gg the way `/profile` finds people. Set results and stream alerts start off. |
| `/track remove` | Stop tracking yourself, or anyone with `player:` if you're a TO. Asks first, then an **Undo** button puts them back with all their settings for a minute. |
| `/track list` | Tracked players, who has set results or stream alerts on, and the tracked tournaments. |
| `/track posts sets:<on or off> stream:<on or off>` | Your set results and stream alerts. Leave both out to see them. A TO can change anyone's with `player:<name>`, or everyone's with `player:all`, which asks first for `sets:off` unless it's already off for everyone. Anyone can look at anyone's. Sets finished before results go on aren't posted. |
| `/t-o cleanup` | Untrack everyone whose start.gg Discord isn't in this server. Names them and asks first, then **Undo** puts them back for a minute. Players with no Discord on start.gg stay unless you add `no_discord:True`. TOs only. |
| `/link profile:<link or ID>` | Link your own start.gg account. Leave out `profile` to find it by the Discord connected on start.gg, among the accounts `/profile` searches. With `MULTI_GUILD=true` a link counts in every server the bot is in, until a server has its own. |
| `/unlink` | Remove your link, with an **Undo** button for a minute. Tracking stays as it was. |
| `/upcoming [user:<member>]` | Tracked tournaments, and any other live or upcoming tournament with 3 or more of the crew registered. `player:` checks one person instead, live from start.gg when they're linked but not tracked. |
| `/recent [user:<member>]` | Your last 5 sets. With `player:all`, up to 20 sets, at most 3 per player, from up to 40 players: those with set results on first, then whoever played most recently. |
| `/run [user:<member>]` | Your run and next opponent in each current bracket, with the station and scheduled time when the TO set them. Each next opponent gets a head-to-head button for the short report, up to 5, singles only. |

Anyone can track, untrack and change posts for themselves. Yourself means the start.gg you `/link`ed, or the one whose Discord is yours. Only TOs can do it for someone else. New players start with both off. Players with no reported sets in 6 months come off the track list on their own.

`/track remove`, `/track posts player:all sets:off`, `/notify player:all`, `/t-o cleanup` and `/t-o tournament remove` ask "Are you sure?" with buttons first, unless there'd be nothing to change. Only whoever ran the command can press them.

### TOs

| Command | What it does |
| --- | --- |
| `/t-o role add user:<@someone>` | Give someone the **TO** role. TOs only. |
| `/t-o role set role:<@role>` | Use any existing server role for TO privileges. Needs **Manage Server**. |
| `/t-o role remove user:<@someone>` | Take the TO role off someone. Refuses to remove the last known TO. TOs only. |
| `/t-o role list` | The TOs. Anyone can look. |

TOs can change `/t-o settings`, manage tracking and pings for anyone, remove anyone from the Slippi watchlist, and use `/t-o tournament` and `/t-o cleanup`. Only TOs add or remove TOs. The role grants no Discord permissions.

The bot makes the TO role when first needed. A role named `TO` also counts, and `/t-o role set` can select any role. Renaming the selected role does not break it. Until the role exists, **Manage Server** counts as TO access. Afterward, **Manage Server** can change the selected role but grants no other TO tools. `/t-o role list` shows TOs after they use a command. On the bot's first start, Samatron gets the role through the Discord connected to their start.gg.

### Your pings

| Command | What it does |
| --- | --- |
| `/notify` | Which of your pings are on, and the posts about you if you're tracked. Only you see it. |
| `/notify calls:<on or off>` | Get pinged when your set is called, at any tournament with match calls on. Needs your start.gg linked, or you tracked with Discord connected on start.gg. One message per called set, with everyone in it who has this on, all four players for doubles. |
| `/notify next:<on or off>` | Get pinged when your next opponent is set, at any tournament with next opponents on, round 1 included. Needs your start.gg linked, or you tracked with Discord connected on start.gg. One card per set, with everyone in it who has this on. |
| `/notify streams:<on or off>` | Get pinged when your set is on stream, at any tournament with stream alerts on. Needs your start.gg linked, or you tracked with Discord connected on start.gg. |
| `/notify registration:<on or off>` | Get the **Reg Reminders** role and its pings for tracked tournaments. Everyone with the role gets pinged, even when already registered. |
| `/notify dm_registration:<on or off>` | Get a DM 1 hour before registration closes, with the tournament link, location and image. Skipped once you're registered, if start.gg has your Discord. Only while you're in this server. |
| `/notify dm_start:<on or off>` | Get a DM 1 hour before the tournament starts, with the tournament link, location and image. Only while you're in this server. |
| `/notify user:<@someone>` | Someone else's pings instead of yours, by server member. TOs only. Pick either `user` or `player`, not both. |
| `/notify player:<name>` | Someone else's pings instead of yours, by tracked player. TOs only. |
| `/notify player:all` | Every tracked player with Discord on start.gg. TOs only. Asks first. Players without Discord are skipped. |
| `/notify all:<on or off>` | All six at once. |

`/notify` changes your settings unless a TO picks `user:` or `player:`. Calls, next opponents and streams need the person linked, or tracked with Discord connected on start.gg. Registration pings and DMs do not. Calls, next opponents and streams only ping where that post is on for the tournament, which `/t-o settings` sets for every tournament and `/t-o tournament posts` for one. Turning one on while it's off server-wide says so. Bulk `player:all` changes only tracked players. DMs go only to current server members, but settings remain if someone leaves.

### Matchmaking

| Command | What it does |
| --- | --- |
| `/matchmaking role game:<Ultimate or Melee> duration:<hours>` | Give yourself the **Ultimate Matchmaking** or **Melee Matchmaking** role, or take it off if you have it. `duration` keeps it 0.5-24 hours, like 2 or 0.5 for 30 minutes, then it comes off on its own. Running it again without `duration` takes it off right away. Only you see the reply. |
| `/matchmaking search game:<Ultimate or Melee> message:<text>` | Ping that role with a card naming you and your message, like a netplay connect code or where you're playing. Posts where the command runs, or in that game's channel from `/matchmaking channel`. `message` is optional. `thread:True` starts a thread on your search to arrange games, named like `Melee:Sam (10/21)`. Only people with the role can use it, once every 10 minutes per game, so nobody can ping the role over and over. A search that couldn't post doesn't count. |
| `/matchmaking channel game:<Ultimate or Melee> channel:<#channel>` | Set which channel that game's searches post in. Leave out `channel` to see where they go. `clear:True` goes back to posting where the command runs. Anyone can look, only TOs can change it. |

The bot makes each role the first time someone asks for it, with no permissions and set so anyone can @mention it, so typing `@Melee Matchmaking` works without the commands. A role renamed in server settings keeps working. Timed roles are saved, so a restart doesn't cancel them. A saved search channel that gets deleted posts where the command runs instead, until a TO sets a new one. If an admin turns off mentions for a role, `/matchmaking search` says so instead of sending a ping nobody gets. Threads need **Create Public Threads** and **Send Messages in Threads** in the channel, and the search still posts when they are missing.

### Stats and matchups

| Command | Short report | With `verbose:True` |
| --- | --- | --- |
| `/stats [user:<member>]` | Recent record, placements and biggest upset. | Lifetime results, opponents and seed performance. |
| `/doubles [user:<member>]` | Recent 2v2 record, top partners, best finish, biggest upset and latest events. | Up to 600 doubles sets: every partner's record and best finish together, teams played and lost to most, seeds, close sets and best finishes. |
| `/h2h opponent:<name or link/ID>` | Overall record, last 10 meetings and one-line predicted odds. | Every meeting, splits, streaks and the same one-line odds. |
| `/predict opponent:<name or link/ID>` | Estimated odds of winning, and why. | The full breakdown: how much each part counts, with bars, model numbers and how sure the odds are. |
| `/scout opponent:<player or link/ID>` | Any opponent's form, how often they win game 3 and game 5 in Ultimate, characters, toughest opponents and worst matchups, plus your head-to-head. | More history, habits, game 3 and game 5 win rates in every game, stages and your odds. |
| `/progress [user:<member>]` | Last 30 days against the previous 30, with changes in win rates and placements. | More detail on each period, a 6-month trend and a win-rate graph. |
| `/characters [user:<member>]` | Reported characters in Ultimate or Melee. | More history, and other games with reported characters. |

Add `player:` to look up someone else, like `/h2h opponent:Sparg0 player:Leo`. `/scout` always compares the opponent with you. For `/stats`, `/progress`, `/characters`, `/doubles`, `/recent`, `/upcoming` and `/run`, `user:` opens Discord's member picker with usernames, avatars and status. Use it instead of `player:` after the member has used `/link` or been added with `/track add`. Any `player:` or `opponent:` also takes a start.gg profile link or ID, like `start.gg/user/f64a83c8`, so you can look up someone nobody tracked or linked. That only looks them up and doesn't track them. A pasted link or ID that matches no name shows up in the list as a start.gg lookup. A name that matches nobody gets the closest tracked or linked one suggested right away.

`/h2h` runs the same prediction as `/predict` but keeps it to one line, even with `verbose:True`. Both give Ultimate odds unless `melee:True`, even for two players who mostly play Melee, and say so when one of them has never played that game. Run `/predict` for the reasoning behind the odds, and add `verbose:True` for the full breakdown with bars and model numbers. `/scout` always compares the opponent with you, replies privately, and needs you tracked or linked, with Discord connected on start.gg.

> [!TIP]
> On a phone, skip the typing. Long-press a server member (right-click on desktop), open **Apps**, and pick **H2H with me** for `/h2h` or **Scout them** for `/scout`. Both find the member's start.gg the way `/profile` does, so the member has to be tracked, linked, or registered for a tournament the bot checks. **H2H with me** needs you tracked or linked too, and so does **Scout them**.

These reports count singles and leave DQs out of set records. `/scout`'s game 3 rate counts best-of-3 sets that went to game 3, and its game 5 rate best-of-5 sets that went to game 5, by the final score, so a best-of-5's game 3 never counts as a game 3. Sets without a reported score stay out. `/doubles` counts 2v2 sets only, for one player, with whoever they teamed with. Its placements come from the events those sets were in, so an event where they never played a set doesn't show. Characters and stages appear only when the TO reports them. `/characters` picks whichever of Ultimate or Melee has more reported games, or more sets if neither has reported characters.

### Slippi ranked

| Command | What it does |
| --- | --- |
| `/slippi add code:<ABCD#123>` | Add your connect code to the watchlist, one per person. Leave out `code` to use the one on your start.gg, if you're tracked or linked, or the one you added in another server. TOs can add anyone's, and `user:@member` says whose it is. A TO's typed code with no `user` belongs to nobody, and the reply says so. |
| `/slippi remove` | Take yourself off the watchlist, or anyone with `player:<name>` if you're a TO. The automatic search won't add them back, but `/slippi add` will. |
| `/slippi rank` | Rank, rating, this season's record, daily leaderboard placement, top 3 characters and the last 3 seasons. `player:` takes someone on the watchlist or any connect code. Left out, it's the code you're on the watchlist with, in this server or another, then the one on your start.gg. |
| `/slippi leaderboard` | The watchlist by rank, then rating, with each player's most played character. Shows the top 50. |

Rank cards and rank change posts show slippi.gg's rank badge and start.gg's icon for the player's most played ranked character. The leaderboard shows the leader's badge. Slippi cards with no badge to show, like an empty leaderboard, show the Slippi logo. Every day, the bot checks tracked players not yet on the watchlist, each at most once a week, in their 8 newest finished online singles sets for a connect code and looks that code up on Slippi. `/link` alone does not do this.

Melee reports add Slippi ranked info for players on the watchlist. That covers reports run with `melee:True` and reports where everything found is Melee anyway. Players who aren't on the watchlist get the same report as always, with no extra lookups.

| Command | Slippi ranked adds |
| --- | --- |
| `/stats [user:<member>]` | Rank, rating, season record, daily leaderboard placement and top characters. |
| `/progress [user:<member>]` | The same, plus the change in rating since the end of last season. |
| `/h2h`, `/predict`, `/scout` | Rank, rating and season record for each player on the watchlist. When both players are ranked and the odds are for Melee, their ratings count toward the odds, even with no Melee sets to go on. Otherwise the ranks are only shown. |
| `/characters game:Melee` | Ranked characters this season with game counts, next to what TOs reported. |

`/predict melee:True` gives Slippi odds even when neither player has Melee sets on start.gg, so netplay-only players can compare. With only one of them ranked, it shows the ranks and no odds.

Netplay tournaments on start.gg ask for a connect code at registration, and start.gg keeps it. Once a day the bot looks for the codes of tracked players not yet on the watchlist, in their 8 newest online singles sets, checking each player at most once a week. Anyone found goes on the watchlist under their start.gg tag. Linked players can use `/slippi add` themselves. Offline-only players and people who play other games online have no code there, so add them with `code:`.

Ranks use slippi.gg's cutoffs: Bronze 1 through Master 3 by rating, and Grandmaster for a Master rating with a placement on Slippi's daily leaderboards. A player with fewer than 5 ranked sets in the season is Pending. Slippi doesn't share ranked match results, so posts show the new rank and rating change, not who they played.

When a ranked season ends, the bot posts a wrap-up of it once: the watchlist's final ranks with ratings and records (the top 10), the 3 biggest rating gains on the season before, and the 3 characters the watchlist played most. Final ratings and records come from slippi.gg's season history, so a player who hasn't played the new season yet counts the same. Characters and daily leaderboard placements aren't in that history, so they come from the bot's last check before each player's reset. It goes out within 30 minutes of Slippi listing the season as finished, and a season that ended over a week before the bot sees it gets none. `/t-o settings slippi:True` turns it on with the rank changes.

> [!NOTE]
> Slippi has no public API. The bot uses the one slippi.gg uses, so a change on Slippi's side can stop rank checks until the bot is updated. `/status` shows when the last check failed.

### Tournaments

A tracked tournament posts every set, whoever played, plus its stream alerts, called sets, next opponents, results card and each event's top 8. Sets, stream alerts, match calls and next opponents go in its own thread. It also sends registration reminders. What it posts follows `/t-o settings`, the default for every tournament, read at each check, and `/t-o tournament posts` turns any of it on or off for that tournament alone. Tracking players works alongside it: a tracked player with set results on gets posted at any tournament, tracked or not.

| Command | What it does |
| --- | --- |
| `/t-o tournament add tournament:<link>` | Track a tournament: every finished set, stream alerts, match calls, next opponents, results, top 8s and registration reminders, each following `/t-o settings`. `registration:off` leaves out its reminders and 1-hour DMs, `schedule:7d,3d,1d,6h` sets custom reminder times, `add_event:on` also makes a Discord event. |
| `/t-o tournament remove tournament:<name>` | Stop tracking it. Asks first, then **Undo** puts it back for a minute. |
| `/t-o tournament posts tournament:<name>` | Turn its `sets`, `streams`, `calls`, `next`, `top8` and `registration` on or off, or `default` to follow `/t-o settings` again. `schedule:` changes the reminder times, `schedule:default` goes back to the usual four. Leave them all out to see them, with (default) after the ones following the server. |
| `/t-o tournament event tournament:<link>` | Make a Discord event from a start.gg link, with the time and end time, venue, close time, events, streams and cover photo. It doesn't track the tournament. |
| `/t-o tournament list` | Every tracked tournament that hasn't posted its results yet, soonest first: when it starts or that it's going on, where, what it has off, custom reminder times, the next reg reminder, and its Discord event and threads once it has them. Anyone can look. `/track list` has a one-line version under the players. |
| `/bracket` | Bracket links for tracked tournaments, from 30 minutes before the start until 6 hours after the end. |
| `/stream_link` | Streams added on start.gg for tracked tournaments and tournaments tracked players entered, in the same window as `/bracket`. Twitch streams are links, and other sites show the stream name. If none are going on, none have a stream, or start.gg doesn't answer, it says to ask a TO in another channel. |
| `/registered tournament:<link>` | Registered server members, by name so nobody gets pinged. `by_event:True` groups them by event. |
| `/reg_warn tournament:<link> user:<@someone>` | Ping someone with a registration link if they haven't registered. Each person gets one warning per tournament every 12 hours. Anyone can use it, up to 10 warnings in any 24 hours, and TOs as often as they like. |

`/t-o tournament` is for [TOs](#tos). Discord shows it to everyone, since the bot checks the TO role itself, and anyone else gets a private no. Tournaments only get tracked by a TO running `/t-o tournament add`, never on their own.

`tournament` takes a start.gg link, or a tournament the bot already knows from the list: tracked ones and ones tracked players are in, soonest first. Tournaments nobody tracks are forgotten a month after they end. `/t-o tournament add` lists only ones that aren't tracked yet, and `/t-o tournament remove` and `/t-o tournament posts` only tracked ones. `/t-o tournament event` lists only upcoming ones, since Discord events have to start in the future, each once. `/t-o tournament add add_event:on` tracks the tournament and makes its Discord event. `/t-o tournament event` only makes the event. Both find an event made earlier for the same link instead of making another.

Discord events sync hourly with start.gg until they start. The bot copies changes to the name, times, cover, venue, registration close, streams, and events. It cancels an event if start.gg deletes or unpublishes the tournament. Changing the start.gg link does not cancel it because the bot uses the tournament ID. Discord edits remain until start.gg changes. The bot leaves started or manually deleted events alone. An event without an end time on start.gg runs `event_length` hours (5 unless the server changed it with `/t-o settings event_length:`). A major or regional with no end time still gets 12 hours.

`/t-o settings events:True` makes a Discord event on its own for each upcoming tracked tournament, once. An event a mod deletes isn't made again. It's off by default.

Roll calls, registration reminders, the 1-hour DMs, `/upcoming` and `/registered` show the venue and its street address when the TO put them on start.gg, as a link that opens the address in Google Maps. Without an address they show the city. Discord events put the venue and address in their location, or the address alone when both don't fit Discord's 100 characters.

At a tracked tournament, the crew for the roll call and the placements post is tracked players and anyone registered whose start.gg Discord is in this server. Linking alone does not add someone. A hidden entrant list leaves just the tracked players.

Changes at either level reach a tournament that's running at the next check: 2 minutes for sets, stream alerts, match calls and next opponents, 15 for reminders and top 8s. Off means nobody: no card of that kind from that tournament and no pings, even for people with `/notify` on. Sets turned on start from that moment, whichever level turned them on, without posting the earlier backlog. Stream alerts, match calls and next opponents turned on include a set that's still going on. Reminders and top 8s that came due while off stay skipped. Cards already posted stay when a kind is turned off.

Tournaments tracked before the switches had defaults kept only the choices a TO made, so the rest follow `/t-o settings`.

Reminders go out 7 days, 3 days, 1 day and 6 hours before registration closes, unless a TO sets custom times for that tournament with `schedule:`, like `schedule:7d,12h,1h`. A schedule holds up to 10 reminders, each 1 hour to 30 days out, and the last one is the last call. `/track list` shows a custom schedule next to its tournament. If registration stays open past the tournament start, the start is the deadline. Past reminders are skipped, and a last call set within 6 hours goes out right away. Turning `registration` back on, or changing the schedule, with `/t-o tournament posts` starts from the next one still to come.

`/notify dm_registration` sends a DM 1 hour before registration closes. `/notify dm_start` sends one 1 hour before the tournament starts. Both include the link, location, and image, need the tournament's `registration` on, and go only to current server members, checked right before each one goes out, so someone who left gets nothing. Leaving keeps your `/notify` switches for if you rejoin. These are the only DMs the bot sends on its own, and it answers nothing sent from a DM. Registration DMs skip registered players when start.gg has their Discord. If registration closes within an hour of the start, only the start DM goes out because it also has the registration link. Someone in two servers that both track the tournament gets each DM once.

Connect Discord on start.gg so the bot recognizes your registration and skips your registration DMs and `/reg_warn`. Channel reminders ping the **Reg Reminders** role for everyone with it. A hidden entrant list blocks these checks. `/reg_warn` sends no ping if registration is closed, the person is registered, the list is hidden, or someone already warned them about that tournament in the last 12 hours. That last one tells only whoever ran it, with when they can be warned again. Someone who isn't a TO and has sent 10 warnings in the last 24 hours gets told privately when they can send the next one, before the bot asks start.gg anything. Only warnings that pinged someone count toward the 10.

### Server and general

| Command | What it does |
| --- | --- |
| `/help` | Short command list. `verbose:True` lists every command with the details. |
| `/t-o settings` | Every server setting in one command: automatic posts, threads, set colors, Discord event length, weekly recap schedule, language, the one bot channel for replies and automatic posts. Settings replies are private and work anywhere. Anyone can view them; only TOs can change them. |
| `/status` | Uptime, when the latest version was deployed plus its message, the last start.gg and Slippi checks, how many players and tournaments are tracked, requests waiting on start.gg, whether start.gg is down right now, any downtime before the last start, why a post last missed its thread, and a link to the GitHub repo. A copy run on another computer also shows that computer's name. |
| `/profile` | Use `/track add` or `/link` with a start.gg profile link first. Then pick a server member with `user:` or a tracked or linked player with `player:`. Leave both blank for yourself. |
| `/data` | Links to [Samatracker](https://samatracker.vercel.app), the web companion with cached player lookup, recent results and Slippi ranks, and both series data pages: the [Monday Night SmashBall data page](https://monday-night-smashball.vercel.app) and the [UB Smash Royale data page](https://ub-smash-royale.vercel.app), with every tournament's attendance, winners, who came to the most nights, counting Ultimate and Melee, and characters. |
| `/socials` | Saved streams and social links. |
| `/socials_edit add name:<who> link:<url>` | Save a link. `https://` is optional, and links with the same name share a line. |
| `/socials_edit remove link:<url>` | Remove a saved link. |

`/profile` checks the Discord connected on start.gg against accounts the bot has already seen: tracked players, people who used `/link`, and people registered for a tournament the bot checks. With `MULTI_GUILD=true` that's in any server the bot is in, and any server's tracked tournaments, so a new server finds people another one already knows, and `/track add` and `/link` with no link find you the same way. A `/link`, or being tracked with Discord connected on start.gg, counts in every server too: leaving the player out of `/stats`, `/scout` or `/slippi rank`, H2H with me and your `/notify` pings all find you in a server you never linked in. That server's own link or tracking comes first, and `/unlink` only takes off the link in the server it runs in. It reads registration lists again at most every 10 minutes. If it can't find you, connect Discord on start.gg and run `/track add` or `/link` with your profile link first. `/track add` takes the same profile links, IDs and automatic lookup as `/link`, and TOs can also pick someone else with `user:`. To find someone else with `/profile @them`, they have to be on that list first. Or pick them from the tracked and linked list with `player:`, which needs no Discord matching.

`/socials_edit` needs **Manage Server** by default. You can hand it to other roles under Server Settings > Integrations > Sama-tracker, and the bot goes by that.

### Fun

`/64`, `/melee`, `/brawl`, `/sm4sh`, `/ult` and `/pplus` are each a different character with their own Smash take. With `ANTHROPIC_API_KEY` set, Claude Haiku writes each post in that character from the game's talking points. Every post comes with a SmashWiki screenshot. Each command keeps 5 posts made ahead so it replies right away, and ones already queued survive a restart. Without `ANTHROPIC_API_KEY`, each command replies with its catchphrase, which is also the fallback if a fetch fails with the key set.

`/bills` posts a pro-Bills photo or GIF with one of many messages and a link to the source. Photos load live from a broad set of Wikimedia Commons categories, and GIFs load live from the official Buffalo Bills GIPHY channel. It rotates the two types evenly, uses every image in a pool before repeating one and never sends the same image twice in a row. A small built-in GIF pool stands in if GIPHY is down. It starts loading its 5-post queue when the bot comes online. The pools reload when the bot restarts, but posts already queued and the spot in the rotation are kept, so a redeploy doesn't repeat or skip one. It needs no AI or API keys.

`/t-o settings bills:True` posts the Bills final score here after each game, with the other team's logo, green for a win and red for a loss. Scores come from ESPN's public scoreboard, with quarters and yards. Off by default. It needs no AI or API keys.

`/view_pfp` posts the bot's profile picture at full size, the meme image its avatar comes from.

## Automatic posts

`/link` identifies you for commands. `/track` follows a player publicly. `/notify` controls pings. Tracking a tournament covers its whole bracket. Registered server members can appear in its roll call and placements. Anyone can appear in its sets, streams, or top 8.

Ping changes apply during a tournament. Turning calls or streams on catches one that is still active, even if its card already posted for someone else, and next opponents do the same for an hour after the card.

Set results, stream alerts, match calls, next opponents, top 8s and registration reminders each have a switch in `/t-o settings` that's the default for every tournament, and `/t-o tournament posts` beats it for one. Off means nobody: no card of that kind from that tournament and no pings.

| Automatic message | When it posts | Who appears and what controls it |
| --- | --- | --- |
| Set results | Every finished set at a tracked tournament. Anywhere else, when a tracked player with set results on finishes a set. | `sets` turns them on or off per tournament. `/track posts sets` picks the tracked players posted outside tracked tournaments. A tracked tournament includes everyone. |
| Stream alerts | Every set on stream or next in the stream queue at a tracked tournament. Anywhere else, when a tracked player with stream alerts on has a set there. A new alert waits 30 seconds to confirm. | `streams` turns them on or off per tournament. `/track posts stream` picks the tracked players posted outside tracked tournaments. A tracked tournament includes everyone. `/notify streams` pings whoever is playing. |
| Match call pings | When start.gg marks a set called: every one at a tracked tournament, and anywhere else ones with someone who has `/notify calls` on. The ping includes the station when available. A call taken back gets crossed out. | `calls` turns them on or off per tournament. One card per set names everyone in it. `/notify calls` controls each person's ping. |
| Next opponents | A set that hasn't started, once both players are known and it's the soonest one either of them has left in the event: called, queued, ready, then waiting, then by round. Every one at a tracked tournament except round 1, so a bracket or pool starting isn't a wall of cards. Anywhere else, ones with someone who has `/notify next` on, round 1 included. Shows the station and scheduled time when the TO set them. | `next` turns them on or off per tournament. One card per set. `/notify next` pings whoever is in it. In a round-robin pool that's one card per player until they play it, though a player can show up on someone else's card too. |
| Tournament roll calls | An hour before a tournament with at least 3 of the crew registered, with the stream links from its start.gg page. | Tracked players appear. At a tracked tournament, registered server members whose Discord is connected on start.gg count too. Linking alone does not add someone. |
| Tournament placements | With the top 8 as soon as every event finishes at a tracked tournament. If start.gg leaves an event active after every standing is final, they go out after a 1-hour correction window instead. Otherwise they go out 12 hours after the tournament ends. Unfinished placements are marked as projected. Notable upset wins by tracked players go under the placements. | Tracked players appear. At a tracked tournament, the same registered server members as roll calls appear too. |
| Top 8s | As soon as every event finishes at a tracked tournament, or 1 hour after every standing is final when start.gg still calls it active. Delayed or failed top 8s retry as described below. | Everyone in each top 8 appears, tracked or not. |
| Registration reminders | At the deadlines under [Tournaments](#tournaments). | The card lists no players. `/notify registration` hands out the **Reg Reminders** role and pings it for everyone with it. |
| Registration DMs | 1 hour before registration closes at a tracked tournament. | DM with the tournament link, location and image. `/notify dm_registration` controls who gets one, skipped once registered when start.gg has their Discord. Only to current server members. Needs the tournament's `registration` on. |
| Start DMs | 1 hour before a tracked tournament starts. | DM with the tournament link, location and image. `/notify dm_start` controls who gets one, only to current server members. Needs the tournament's `registration` on. When registration closes within an hour of the start, only this one goes out. |
| Discord events | Off by default. Within 15 minutes of an upcoming tournament getting tracked. | `/t-o settings events` controls it. With it off, a tournament only gets one from `/t-o tournament event` or `add_event:on`. |
| Slippi rank changes | Within 30 minutes of a watchlist player moving to another rank. A new season reset is not posted, the wrap-up covers it. | `/slippi add` and `/slippi remove` control the watchlist. Tracked players can be discovered from connect codes entered on start.gg. Linked-only players cannot. |
| Slippi season wrap-ups | Once per ranked season, within 30 minutes of Slippi listing it as finished. | Watchlist players with sets that season. Final ranks, biggest climbers and most played characters. `/t-o settings slippi` controls it with rank changes. |
| Bills final results | Off by default. After each Bills game, with quarters and yards. | No player appears. |
| Weekly crew recap | Sunday at 9 pm New York time by default. A notable upset win by a tracked player goes on top. | Tracked players with a non-DQ singles set that week appear. There is no separate player switch. |
| Bot updates | Once per deployment in every server's bot channel. Missed notices retry every minute, including after channel setup or a restart. | No player appears. Shows when it deployed and the commit message, plus the outage below when there was one. |
| Back online | When the bot starts after being off for 10 minutes or more, like a crash or a hosting outage. A normal redeploy is quicker and doesn't post. | No player appears. Always posts, with how long it was down, that commands sent then need sending again, and what catches up. |

Set result cards put the winner on the left with a W and the loser on the right with an L. A winner seeded 7 or more placement tiers lower, like seed 17 over seed 2, gets Major upset. Tournament placements and the weekly recap list the same kind of wins by tracked players as notable upsets. `/t-o settings set_colors` colors them green for a tracked win, red for a loss, gold when two tracked players meet and blue when nobody tracked played, so a small crew sees each member at a glance. Off, every card stays blue. Only a tracked player's first DQ per event is posted, so no-shows at a tracked tournament stay out. Top 8s list everyone, one card per event. An event that has not started holds the top 8 until the tournament's end time. If all standings are final but the TO leaves the event active, a 1-hour correction window starts; after it, the bot treats the tournament as finished and `/run` leaves it out. A top 8 lookup that fails at placements time holds them back 12 hours, then they go without it. A top 8 that fails to send retries for up to 3 days.

Each card's side color says what kind of post it is. Only set results and the Bills final use the `set_colors` green, red and blue, and a set the TO resets turns grey. Gold is two players meeting: crew vs crew results, and `/h2h`, `/predict` and `/scout`'s matchup card. Match calls, next opponents, `/run`, and `/bracket`, `/stream_link` and `/upcoming` once a tournament starts are magenta, next to Twitch purple for stream alerts. Registration reminders and the start DM are orange, and dark orange for the last call, its DM and `/reg_warn`. Placements, top 8s and the weekly recap are yellow, thread cards blue, `/status` and bot updates pink, and lookups and roll calls violet. Slippi cards take the rank's color, or Slippi green without one.

Singles stream alerts, match calls and next opponents get a **Head to head** button for the short report that replies privately to whoever presses it. It comes off when the set ends or is deleted, or 12 hours after the post.

The set, stream, match call and next opponent checks run every 2 minutes. Each asks start.gg only about players with that switch on, 20 players per request and 15 for next opponents, so the checks stay small however many players are tracked. Next opponents for `/notify next` also take 1 request per 8 of those people with 4 or more unplayed sets at a tournament going on, like early in a round-robin pool, to read the rest of their sets there. A tracked tournament with next opponents on reads every unplayed set in its started events, 40 to a page, so a 64-player bracket starts at about 4 requests and drops as sets get played. With nobody to look for, the next opponent check asks start.gg nothing. A tracked tournament that's going on adds one request per 20 of its events for its new sets, and one per live tournament for its stream queue. When the stream check finds a new set on stream, it asks again 30 seconds later to confirm. A set in a stream queue links that queue's stream. Rechecking recent set results, match calls and next opponents takes one request per 50 posts, plus 1 per 10 set results whose winner or score changed. Bills finals check ESPN daily, every 15 minutes from an hour before kickoff until 8 hours after: one request plus one per new final. A roll call adds one request for its streams. 1-hour DMs look a tournament up every 15 minutes, only in the 3 hours before one is due, plus one request for who's registered before a registration DM.

After the bot has been down, set results from the last 3 hours still post and older ones are skipped. `/status` says when that happened. See [When something is down](#when-something-is-down) for what people see.

### Fixing posts that turn out wrong

TOs report the wrong winner, fix it a minute later, or call a set and take it back. The bot edits what it posted to match.

| Post | What changes |
| --- | --- |
| Set results | For an hour after a result posts, the bot checks it again every 2 minutes. If the TO changes the winner or score, the card is replaced with the new result marked **Corrected by TO**. If the TO resets or deletes the set, the card turns grey and its title starts with **Reset by TO**. If the set is reported again within that hour, the card shows the new result. |
| Match call pings | For 15 minutes after a call, the bot checks it every 2 minutes. If the set goes back to waiting, the ping is crossed out with "Uncalled by the TO", and calling it again pings again. This needs the `calls` switch on. |
| Next opponents | For an hour after a card posts, the bot checks who is in the set every 2 minutes. If the TO fixes or resets a result and someone else lands in it, the card is crossed out with "Changed by the TO" and the new pairing posts if it's someone's next. A set that empties and fills again with the same two posts nothing new, and one the TO changes back posts again. |
| Discord events | Checked hourly until they start. A new time, end time, cover photo, name, venue, close time, streams or event list on start.gg gets edited in, and a tournament deleted there gets its event cancelled. Nothing is posted about it. |
| Placements and top 8s | Projected placements are checked hourly for 3 days. Once start.gg has every placement final, or every event in the top 8 finished, the post is edited to the final standings. If the final version no longer splits into the same number of messages, it goes out as a new post saying so. A top 8 with nothing reported when placements posted goes out as a new message once the bracket is finished. |

Some TOs tag an event with the wrong game, like a "Melee Singles" tagged as Ultimate. When an event's name says Melee and its tag says Ultimate, or the other way around, the bot goes by the name. That covers `melee:True`, `game:` and the game shown on cards. Events whose name mentions both games, or another game like Project+, keep their tag.

### Turning posts on and off

Run `/t-o settings` without options to see every setting privately. TOs can change any of the twelve switches: `sets`, `streams`, `calls`, `next`, `rollcall`, `results`, `top8`, `registration`, `events`, `slippi`, `recap` and `bills`, plus the thread mode, event length, set colors, recap schedule, language and the bot channel. Six of them, `sets`, `streams`, `calls`, `next`, `top8` and `registration`, are the default for every tournament, and `/t-o tournament posts` beats them for one. Only Bills finals and Discord events start off server-wide. `set_colors` colors set result cards green for a tracked win, red for a loss, gold when two tracked players meet and blue when nobody tracked played, and starts off. Turning `events` on checks for Manage Events first, and it makes events for upcoming tournaments already tracked. The `/notify` DMs go by each person's own setting and the tournament's `registration`, which follows this switch unless `/t-o tournament posts` changed it. Match calls only ping people who turned on `/notify calls`, next opponents only ping people with `/notify next` on, stream alerts only ping whoever is playing with `/notify streams` on, and top 8s only come from tracked tournaments.

Turning off two or more switches that are on, in one command, asks first, the way `/t-o cleanup` does. Only whoever ran it can press **Turn them off** or **Cancel**, the buttons work for 5 minutes, and Cancel changes nothing. Everything else in the same command goes through with the press. One switch at a time, or ones already off, change right away.

```text
/t-o settings sets:False streams:False day:Sunday time:20:00 timezone:America/New_York
```

Times use 24-hour `HH:MM` in the chosen timezone, with daylight saving. Settings save right away and survive restarts. A stream alert, match call or next opponent still going on posts at the next check when its type is turned back on. Anything else that came due while a type was off stays skipped after you turn it back on. Schedule changes apply to future recaps. Each player's `/track posts`, each tournament's `/t-o tournament posts` and everyone's own `/notify` pings still apply on top.

Each server has one bot channel, picked with `/t-o settings channel:#channel`. Commands and automatic posts use it and its threads; a command used elsewhere gets a private reply pointing there. `/t-o settings` works privately anywhere so a TO can set or replace the channel. `/matchmaking` works elsewhere and keeps its own per-game channel settings. The old `commands_channel` and `commands_anywhere` options are removed.

### Language

`/t-o settings language:Español` switches everything the bot says in the server to Spanish: `/help`, every reply, card, button, automatic post and DM. `language:English` switches back, and English is the default. The language saves with the other settings, so it stays through restarts and new deploys. Command and option names stay in English, since they're what you type, but their descriptions switch. A single-server build registers the commands again in the new language, so the descriptions change right away. Multi-server builds share one set of commands across every server, so there the descriptions follow each person's own Discord language, Spanish for anyone whose Discord is in Spanish.

Names from start.gg stay as start.gg has them, like tournaments, events, rounds and players, and Discord shows dates and times in each person's own language. Fun posts are written in Spanish with the same characters and talking points. Each one keeps 5 posts made ahead. Switching the language rewrites queued posts into the new one; if another server still uses the old language, its queue stays intact and rewritten copies fill the new queue. Samatracker and the series data pages stay in English.

### Threads

`/t-o settings threads` decides where set results, stream alerts, match calls and next opponents go, so a big weekend doesn't flood the channel. A tracked tournament posts every set, so it always gets a thread. It has three modes:

| Mode | Where they go |
| --- | --- |
| **Off, post in the channel** | The channel, except a tracked tournament's, which go in its thread. This is the default. |
| **One thread per tournament** | A thread for each tournament, named after it. |
| **One thread per event** | A thread for each event, like `Genesis 11 · Ultimate Singles`. A tournament where the crew plays three events gets three threads. |

The first set result, stream alert, match call or next opponent from a tournament, or from an event in the per-event mode, posts a card with its name in the channel and starts a thread on it. The bot pins each card so the thread stays easy to find, as many at once as there are tournaments and events going. Every card from a tournament, its event cards included, stays pinned until the tournament is over, then they all come down together: once placements post or 6 hours after the end. Later ones from it go in the thread, pings included. Roll calls, placements and top 8s stay in the channel in every mode. Discord has no threads inside threads, so the per-event threads sit side by side in the channel. Each card names its tournament and event.

The bot needs **Create Public Threads** and **Send Messages in Threads** in the channel. Picking either thread mode checks for both and names any that are missing instead of switching. Pinning thread cards needs **Pin Messages**, which Discord split off from Manage Messages in 2026; without it threads still work but the cards stay unpinned, and picking a posts channel says so. If a post can't go in its thread later, say a permission was removed or a moderator locked the thread, it posts in the channel and `/status` shows why. A deleted thread gets replaced on the next post. Threads archive after a day without posts and reopen when the next one goes in. Switching to **Off** sends everything back to the channel, except a tracked tournament's, which keep their thread. Switching modes keeps the old threads, so going back to a mode reuses them for 14 days. A server that turned threads on before there were three modes keeps one thread per tournament.

## Run your own copy

You need Node.js 22.9 or newer, a Discord bot and a start.gg API token.

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications). Invite it with the `bot` and `applications.commands` scopes and these permissions: View Channel, Send Messages, Embed Links and Attach Files. For threads, add Create Public Threads and Send Messages in Threads, plus Pin Messages so thread cards get pinned. For `/t-o tournament event`, `add_event:on` and `/t-o settings events`, add Manage Events so it can make and update scheduled events. Manage Roles lets `/t-o role` make and hand out the TO role, `/notify registration` hand out the Reg Reminders role, and `/matchmaking role` make and hand out the matchmaking roles. Reg reminder pings work without it, and without a TO role Manage Server counts as a TO. It needs no privileged intents. With `MULTI_GUILD=true` commands register globally, so invite it to as many servers as you like and run `/t-o settings channel:#channel` in each.
2. Create a start.gg API token under Settings > Developer Settings.
3. Copy [.env.example](.env.example) to `.env` and fill it in. Single-server builds need `GUILD_ID` and `CHANNEL_ID` for their one server and channel. Multi-server builds set `MULTI_GUILD=true`. A new multi-server copy leaves `GUILD_ID` and `CHANNEL_ID` out. A bot switching from single-server keeps both, so that server's track list, settings and posts channel move over.
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
| `GUILD_ID` | Single-server, or switching to multi-server | The server. Single-server commands register here. With `MULTI_GUILD=true` it's only used to move this server's track list and settings into its own entry, so keep it set when switching a single-server bot over, and leave it out of a new multi-server copy. |
| `CHANNEL_ID` | Single-server, or switching to multi-server | The initial bot channel for replies and automatic posts. A TO can replace it with `/t-o settings channel:` in either mode. |
| `MULTI_GUILD` | No | Set to `true` to serve every server the bot is invited to, each with its own track list, settings and `/t-o settings channel` posts channel. Its commands only work in servers, not in a DM with the bot. Off by default. Switching either way clears the other mode's commands at startup, so none show twice. |
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

Every card message has a picture: the player's or tournament's start.gg image when there is one. Set result, stream, match call and next opponent cards fall back to the tracked player's picture when the tournament has none, and a message with no picture of its own shows the bot's avatar. Discord can't always load start.gg's pictures from a link, so command replies upload them with the message, up to 10 files and 8MB. A start.gg picture that won't download comes off the card, and the avatar shows if that leaves the message with none. Plain text replies, like errors and on/off confirmations, have none.

start.gg can leave out scores, seeds, characters and stages, and the bot leaves them unknown. Sets link their VOD when the TO adds one on start.gg.

Predictions are for Ultimate unless `melee:True` asks for Melee. They estimate odds from head-to-head results, common opponents, seeding, and Slippi ratings when both players are ranked and the game is Melee. With no Melee sets, the odds come from Slippi alone. Newer sets count more, and thin data pulls the odds toward 50%.

Slippi rank checks ask about 20 watchlist players per request, one request a second. The connect code search asks start.gg about 10 players per request. Melee reports refresh a watchlist player's Slippi profile at most every 30 minutes and wait up to 3 seconds for it before falling back to the last rank check's numbers. If the Slippi section doesn't fit on a card, the report goes out without it.

### Speed and waiting

start.gg allows 80 requests a minute. A first lookup can take tens of seconds, or about a minute for a large report. Commands share cached history where they can, profile and tournament links that come back empty stay missed for 5 minutes, and long lookups show progress while they load. A **Full report** press on `/h2h` reuses its report's lookup, so it asks start.gg for nothing new. The other full reports read further back, but keep the pages the short report already has. Pressing a Full report button that's already loading shares the first lookup instead of asking again. The second press hears start.gg is on it. A press that expires before the bot can answer runs once more on its own, landing as a new message that pings whoever pressed instead of the timeout. Private and ephemeral reports retry by DM so they stay private.

Your commands take turns with start.gg one at a time. A command sent while your last one is still loading answers right away. If it needs start.gg, it says **Queued** with about how long your last one has left, counting everyone else's commands, and starts when that one finishes. Commands that don't need start.gg, like `/help`, don't wait. Up to 3 can wait behind the one running, and past that the bot asks you to try again. When start.gg is backed up for everyone, new commands ask you to try again in a minute instead of queueing. Every 10th request goes to the background checks, so automatic posts keep moving on busy nights.

A public report that finishes more than a minute after you ran it goes out as a new message that pings you, and the loading reply is removed. Private answers, like `/scout`, stay private and don't ping.

A command that fails says whose side it failed on: start.gg not answering, start.gg having trouble or limiting the bot, start.gg turning down the bot's token, Slippi, Discord missing a permission, or a bug in the bot itself. The details go in the bot's logs. A start.gg request that times out or gets a 5xx error is tried twice more before that.

### When something is down

| What's down | What people see |
| --- | --- |
| The bot itself, like a crash or a Railway outage | Discord's own "The application did not respond". The bot isn't running, so it can't answer or change that text, and its name shows offline in the member list. Once it's back after 10 minutes or more, it posts **Back online** in the posts channel with when it went down, for how long, and that commands sent then need sending again. A new version that comes up after an outage says the same on its bot update card instead. |
| start.gg | Once start.gg has sent nothing but timeouts and 5xx errors for 2 minutes, commands that need it answer right away with "start.gg has been down since ..." instead of each waiting about 90 seconds on retries. One command a minute still goes through to check, the automatic checks keep asking, and the first answer ends it for everyone. Meanwhile the bot's status in the member list reads "start.gg is down" and `/status` shows since when. |
| Slippi | Melee reports wait 3 seconds for Slippi, then use the last rank check's numbers, so they still go out. `/slippi` commands say Slippi didn't answer, and `/status` shows when the last rank check failed. |
| Discord | Commands say Discord is having trouble. Automatic posts that fail get retried where the post type does that, like top 8s. |

Keeping Discord events up to date costs one start.gg request per upcoming event an hour.

<details>
<summary>History limits and placement math</summary>

| Command | History checked |
| --- | --- |
| `/stats [user:<member>]` | Latest 15 standings and 30 singles sets. With `melee:True`, standings are filtered by game and older pages are read for 30 Melee sets, or all there are if fewer. |
| `/stats verbose:True` | Every finished singles event and up to 3,000 sets. |
| `/doubles [user:<member>]` | Latest 30 doubles sets and the events they're from. With `melee:True`, up to 300 sets are read for 30 Melee ones. |
| `/doubles verbose:True` | Up to 600 doubles sets and the events they're from. |
| `/h2h` | Every meeting with the opponent, plus up to 600 sets per player for the one-line odds, in either report length. |
| `/predict` | Every meeting between the two players, plus up to 600 sets per player. Verbose breaks down the same prediction. |
| `/scout` | Up to 600 sets per player and 400 sets for the opponent's characters. |
| `/scout verbose:True` | Up to 1,200 opponent sets, 800 for characters and stages, every finished event, and 600 of your sets. |
| `/characters [user:<member>]` | Up to 400 sets, or 1,600 with verbose. Verbose shows up to 6 games. |
| `/progress [user:<member>]` | 60 days, or 180 with verbose, split into 30-day periods. |

`melee:True` filters the history each report checks, and the limits above still apply. `/h2h` and `/predict` check every meeting. Short `/stats` and `/doubles` read back far enough to fill their Melee set windows when they can. `since` and `venue` filter the same history: short `/stats` reads back far enough to fill its 30-set window for those too, and anything older than the checked history stays out.

`/progress` counts a placement toward the period when the event started. Average finishes account for bracket size. Seed comparisons use placement tiers, so seed 6 finishing 5th counts as on seed.

</details>
