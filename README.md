# Sama-tracker

> **This bot has no invite link.** It's built for one Discord server, so you can't add it to yours the usual way. To use it you have to host your own copy, running 24/7 on a machine you control or on a cloud host. See [Run your own copy](#run-your-own-copy).

A Discord bot that follows a Smash crew and its local tournaments on start.gg and Slippi. It posts results and stream alerts in one channel, sends registration reminders, and answers slash commands with stats, head-to-heads and odds.

<img src="screenshots/predict.png" alt="/predict" width="56%"> <img src="screenshots/h2h.png" alt="/h2h" width="42%">

<img src="screenshots/sm4sh.png" alt="/sm4sh" width="53%"> <img src="screenshots/recent.png" alt="/recent" width="45%">

Made by Samatron. See it running in [this Discord server](https://discord.gg/VuMz7Y2k2).

[Get started](#get-started) · [Commands](#commands) · [Automatic posts](#automatic-posts) · [Run your own copy](#run-your-own-copy) · [Data and limits](#data-and-limits)

## Get started

1. **Link yourself.** Connect Discord on your start.gg profile, then run `/link`. Commands then know who you are, and nothing gets posted about you. Tracked players with Discord connected can skip this.
2. **Hand out the TO role.** TOs run `/tournament` and can change tracking for anyone. Everyone else only changes their own. `/to add user:@someone` gives someone the role. See [TOs](#tos).
3. **Track your tournaments.** A TO's `/tournament add tournament:<link>` posts every set, stream alert and top 8 from a tournament in its own thread, plus registration reminders. `/tournament event tournament:<link>` makes a Discord event from a link that keeps up with start.gg.
4. **Track yourself.** `/track add` posts your placements wherever you play, found by the Discord on your start.gg. `/track posts` turns on your set results and stream alerts too. TOs can do both for anyone.
5. **Pick your pings.** `/notify` pings you when your match is called, for every stream alert, or for registration reminders, plus 1-hour DMs before registration closes and before the start. `/matchmaking_role` gets you pinged when someone wants Ultimate or Melee games, and `/matchmaking_search` asks. `/messages` controls posts for the whole server.
6. **Follow Slippi ranked.** `/slippi add` puts your connect code on the watchlist. Tracked players get added on their own once their code shows up on start.gg.

`/help` in Discord lists every command in short form.

## Commands

### Options that work across commands

| Option | What it does |
| --- | --- |
| `profile` | A start.gg profile link or its final ID, like `start.gg/user/f64a83c8` or `f64a83c8`. `/scout` also takes a tracked or linked player. |
| `player`, `opponent` | A tracked or linked player. Leave an optional `player` blank to look yourself up. `/track remove` and `/track posts` take tracked players only, and only TOs can pick someone else to change. |
| `player:all` | Everyone tracked, on `/upcoming`, `/recent` and `/track posts`. Changing everyone's posts takes a TO. |
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
| `/track cleanup` | Untrack everyone whose start.gg Discord isn't in this server. Names them and asks first, then **Undo** puts them back for a minute. Players with no Discord on start.gg stay unless you add `no_discord:True`. TOs only. |
| `/link profile:<link or ID>` | Link your own start.gg account. Leave out `profile` to find it by the Discord connected on start.gg, among the accounts `/profile` searches. |
| `/unlink` | Remove your link, with an **Undo** button for a minute. Tracking stays as it was. |
| `/upcoming` | Tracked tournaments, and any other live or upcoming tournament with 3 or more of the crew registered. `player:` checks one person instead, live from start.gg when they're linked but not tracked. |
| `/recent` | Your last 5 sets. With `player:all`, up to 20 sets, at most 3 per player, from up to 40 players: those with set results on first, then whoever played most recently. |
| `/run` | Your run and next opponent in each current bracket, with the station and scheduled time when the TO set them. Each next opponent gets a head-to-head button, up to 5, singles only. |

Anyone can track, untrack and change posts for themselves. Yourself means the start.gg you `/link`ed, or the one whose Discord is yours. Only TOs can do it for someone else. New players start with both off. Players with no reported sets in 6 months come off the track list on their own.

`/track remove`, `/track posts player:all sets:off`, `/track cleanup` and `/tournament remove` ask "Are you sure?" with buttons first, unless there'd be nothing to change. Only whoever ran the command can press them.

### TOs

| Command | What it does |
| --- | --- |
| `/to add user:<@someone>` | Give someone the **TO** role. TOs only. |
| `/to remove user:<@someone>` | Take the TO role off someone, or off yourself. TOs only. |
| `/to list` | The TOs. Anyone can look. |

TOs can track, untrack and change posts for anyone, take anyone off the Slippi watchlist, and run `/tournament` and `/track cleanup`. Only TOs add or remove TOs. The role grants nothing in Discord itself. The bot checks for it.

The bot makes the TO role the first time it's needed. A role named `TO` made by hand counts too, and keeps counting if it's renamed later. Until the server has a TO role, anyone with Manage Server counts as a TO, so nobody gets locked out before it exists. Once it does, Manage Server alone isn't enough. A server admin can still hand the role out in server settings, and `/to list` shows those TOs once they've used a command. Samatron gets the role once when the bot first starts, found by the Discord on their start.gg, and another TO can take it off them for good.

### Your pings

| Command | What it does |
| --- | --- |
| `/notify` | Which of your pings are on, and the posts about you if you're tracked. Only you see it. |
| `/notify calls:<on or off>` | Get pinged when your set is called, at any tournament. Needs your start.gg linked, or you tracked with Discord connected on start.gg. One message per called set, with everyone in it who has this on, all four players for doubles. |
| `/notify streams:<on or off>` | Get pinged for every stream alert, whoever is on stream. |
| `/notify registration:<on or off>` | Get pinged for registration reminders, and get the **Reg Reminders** role. Skipped for tournaments you're already registered for, if start.gg has your Discord. |
| `/notify dm_registration:<on or off>` | Get a DM 1 hour before registration closes, with the tournament link, location and image. Skipped once you're registered, if start.gg has your Discord. |
| `/notify dm_start:<on or off>` | Get a DM 1 hour before the tournament starts, with the tournament link, location and image. |
| `/notify all:<on or off>` | All five at once. |

`/notify` only ever changes whoever ran it, and stream, registration and DM pings need no tracking or linking.

### Matchmaking

| Command | What it does |
| --- | --- |
| `/matchmaking_role game:<Ultimate or Melee>` | Give yourself the **Ultimate Matchmaking** or **Melee Matchmaking** role, or take it off if you have it. Only you see the reply. |
| `/matchmaking_search game:<Ultimate or Melee> message:<text>` | Ping that role here, with a card naming you and your message, like a netplay connect code or where you're playing. `message` is optional. Only people with the role can use it. |

The bot makes each role the first time someone asks for it, with no permissions and set so anyone can @mention it, so typing `@Melee Matchmaking` works without the commands. A role renamed in server settings keeps working. If an admin turns off mentions for a role, `/matchmaking_search` says so instead of sending a ping nobody gets.

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

> [!NOTE]
> Slippi has no public API. The bot uses the one slippi.gg uses, so a change on Slippi's side can stop rank checks until the bot is updated. `/status` shows when the last check failed.

### Tournaments

A tracked tournament posts every set, whoever played, plus its stream alerts and each event's top 8, in its own thread. It also sends registration reminders. Tracking players works alongside it: a tracked player with set results on gets posted at any tournament, tracked or not.

| Command | What it does |
| --- | --- |
| `/tournament add tournament:<link>` | Track a tournament: every finished set, stream alerts, top 8s and registration reminders. `reminders:off` leaves out the reminders, `add_event:on` also makes a Discord event. |
| `/tournament remove tournament:<name>` | Stop tracking it. Asks first, then **Undo** puts it back for a minute. |
| `/tournament posts tournament:<name>` | Turn its `sets`, `stream`, `top8` and `reminders` on or off. Leave them all out to see them. |
| `/tournament event tournament:<link>` | Make a Discord event from a start.gg link, with the time, venue, close time and events. It doesn't track the tournament. |
| `/bracket` | Bracket links for tracked tournaments, from 30 minutes before the start until 6 hours after the end. |
| `/stream_link` | Streams added on start.gg for tracked tournaments and tournaments tracked players entered, in the same window as `/bracket`. Twitch streams are links, and other sites show the stream name. If none are going on, none have a stream, or start.gg doesn't answer, it says to ask a TO in another channel. |
| `/registered tournament:<link>` | Registered server members, by name so nobody gets pinged. `by_event:True` groups them by event. |
| `/reg_warn tournament:<link> user:<@someone>` | Ping someone with a registration link if they haven't registered. Each person gets one warning per tournament every 12 hours. Anyone can use it. |

`/tournament` is for [TOs](#tos). Discord shows it to everyone, since the bot checks the TO role itself, and anyone else gets a private no. Tournaments only get tracked by a TO running `/tournament add`, never on their own.

`tournament` takes a start.gg link, or a tournament the bot already knows from the list: tracked ones and ones tracked players are in, soonest first. Tournaments nobody tracks are forgotten a month after they end. `/tournament add` lists only ones that aren't tracked yet, and `/tournament remove` and `/tournament posts` only tracked ones. `/tournament add add_event:on` tracks the tournament and makes its Discord event. `/tournament event` only makes the event. Both find an event made earlier for the same link instead of making another.

Discord events keep up with start.gg until they start. Once an hour the bot checks each one it made, and when the TO changes the time, name, venue, close time or events on start.gg, it edits them into the event. A tournament deleted or unpublished on start.gg gets its event cancelled. It goes by the tournament's start.gg ID, so a TO changing the link doesn't count as deleting it. An edit a mod makes in Discord stays until something changes on start.gg. An event a mod deletes, or one that has started, is left alone.

`/messages events:True` makes a Discord event on its own for each upcoming tracked tournament, once. An event a mod deletes isn't made again. It's off by default.

Roll calls, registration reminders, the 1-hour DMs, `/upcoming` and `/registered` show the venue and its street address when the TO put them on start.gg, as a link that opens the address in Google Maps. Without an address they show the city. Discord events put the venue and address in their location, or the address alone when both don't fit Discord's 100 characters.

At a tracked tournament, the crew for the roll call and the placements post is tracked players and anyone registered whose start.gg Discord is in this server. Linking alone does not add someone. A hidden entrant list leaves just the tracked players.

Reminders go out 7 days, 3 days, 1 day and 6 hours before registration closes. If registration stays open past the tournament start, the start is the deadline. Past reminders are skipped, and a last call set within 6 hours goes out right away. Turning reminders back on with `/tournament posts` starts from the next one still to come.

`/notify dm_registration` DMs you 1 hour before registration closes, and `/notify dm_start` DMs you 1 hour before the tournament starts. Both carry the tournament link, location and image, and need the tournament's reg reminders on. Registration DMs skip you once you're registered, if start.gg has your Discord. When registration closes within an hour of the start there's one DM, the start one, since it carries the register link too.

Connect Discord on start.gg so the bot recognizes your registration and skips your reminder pings. A hidden entrant list blocks these checks. `/reg_warn` sends no ping if registration is closed, the person is registered, the list is hidden, or someone already warned them about that tournament in the last 12 hours. That last one tells only whoever ran it, with when they can be warned again.

### Server and general

| Command | What it does |
| --- | --- |
| `/help` | List the commands. |
| `/status` | Uptime, when the latest version was deployed, the last start.gg and Slippi checks, how many players and tournaments are tracked, requests waiting on start.gg, the state file size and saves since start, any downtime before the last start, and why a post last missed its thread. A copy run on another computer also shows that computer's name. |
| `/profile` | A tracked or linked player's start.gg with `player:`, or a server member's with `user:`. Leave both blank for yourself. |
| `/messages` | Show or change automatic posts, threads (off, one per tournament or one per event) and the recap schedule. Needs **Manage Server**. |
| `/socials` | Saved streams and social links. |
| `/socials_edit add name:<who> link:<url>` | Save a link. `https://` is optional, and links with the same name share a line. |
| `/socials_edit remove link:<url>` | Remove a saved link. |

`/profile` checks the Discord connected on start.gg against accounts the bot has already seen: tracked players, people who used `/link`, and people registered for a tournament the bot checks. It reads registration lists again at most every 10 minutes. If it can't find you, connect Discord on start.gg and run `/link` with your profile link. To find someone else with `/profile @them`, they have to be on that list first. Or pick them from the tracked and linked list with `player:`, which needs no Discord matching.

`/socials_edit` needs **Manage Server** by default. You can hand it to other roles under Server Settings > Integrations > Sama-tracker, and the bot goes by that.

### Fun

`/64`, `/melee`, `/brawl`, `/sm4sh`, `/ult` and `/pplus` are each a different character with their own Smash take. With `ANTHROPIC_API_KEY` set, Claude Haiku writes each post in that character from the game's talking points. Every post comes with a SmashWiki screenshot. Without `ANTHROPIC_API_KEY`, each command replies with its catchphrase, which is also the fallback if a fetch fails with the key set.

`/bills` posts a Bills photo, meme or GIF with a message and a link to the source. Photos come from a broad set of Wikimedia Commons categories, memes from selected Imgflip posts, and GIFs from the official Bills and NFL GIPHY channels. It rotates the three types evenly, uses every image in a pool before repeating one and never sends the same image twice in a row. The pools and rotation reset when the bot restarts. It needs no AI or API keys.

`/messages bills:True` posts the Bills final score here after each game, with the other team's logo, green for a win and red for a loss. Scores come from ESPN's public scoreboard, with quarters and yards. Off by default. It needs no AI or API keys.

`/view_pfp` posts the bot's profile picture at full size, the meme image its avatar comes from.

## Automatic posts

`/link` identifies you for commands. `/track` follows a player publicly. `/notify` controls only your pings. Tracking a tournament covers its whole bracket. A registered server member can still appear in a tracked tournament's roll call or placements, and anyone can appear in its sets, streams or top 8.

| Automatic message | When it posts | Who appears and what controls it |
| --- | --- | --- |
| Set results | Every finished set at a tracked tournament. Anywhere else, when a tracked player with set results on finishes a set. | `/track posts sets` controls a tracked player outside tracked tournaments. A tracked tournament includes everyone. |
| Stream alerts | Every set on stream or next in the stream queue at a tracked tournament. Anywhere else, when a tracked player with stream alerts on has a set there. A new alert waits 30 seconds to confirm. | `/track posts stream` controls a tracked player outside tracked tournaments. A tracked tournament includes everyone. `/notify streams` only controls who gets pinged. |
| Match call pings | When a set is called for someone with `/notify calls` on. The ping says You're up, with the station number when the TO set one on start.gg. Calls taken back get crossed out, and one still waiting after 5 minutes pings once more. | One card per set names everyone in it. `/notify calls` controls each person's ping subscription. |
| Tournament roll calls | An hour before a tournament with at least 3 of the crew registered, with the stream links from its start.gg page. | Tracked players appear. At a tracked tournament, registered server members whose Discord is connected on start.gg count too. Linking alone does not add someone. |
| Tournament placements | 12 hours after the tournament ends, or after its bracket finishes if that's first. Unfinished placements are marked as projected. | Tracked players appear. At a tracked tournament, the same registered server members as roll calls appear too. |
| Top 8s | As soon as every event finishes at a tracked tournament. Delayed or failed top 8s retry as described below. | Everyone in each top 8 appears, tracked or not. |
| Registration reminders | At the deadlines under [Tournaments](#tournaments). | The card lists no players. `/notify registration` controls pings and skips subscribers already registered when start.gg has their Discord. |
| Registration DMs | 1 hour before registration closes at a tracked tournament. | DM with the tournament link, location and image. `/notify dm_registration` controls who gets one, skipped once registered when start.gg has their Discord. Needs the tournament's reg reminders on. |
| Start DMs | 1 hour before a tracked tournament starts. | DM with the tournament link, location and image. `/notify dm_start` controls who gets one. Needs the tournament's reg reminders on. When registration closes within an hour of the start, only this one goes out. |
| Discord events | Off by default. Within 15 minutes of an upcoming tournament getting tracked. | `/messages events` controls it. With it off, a tournament only gets one from `/tournament event` or `add_event:on`. |
| Slippi rank changes | Within 30 minutes of a watchlist player moving to another rank. A new season reset is not posted. | `/slippi add` and `/slippi remove` control the watchlist. Tracked players can be discovered from connect codes entered on start.gg. Linked-only players cannot. |
| Bills final results | Off by default. After each Bills game, with quarters and yards. | No player appears. |
| Weekly crew recap | Sunday at 9 pm New York time by default. | Tracked players with a non-DQ singles set that week appear. There is no separate player switch. |

Set result cards put the winner on the left with a W and the loser on the right with an L. A winner seeded 7 or more placement tiers lower, like seed 17 over seed 2, gets Major upset. Only a tracked player's first DQ per event is posted, so no-shows at a tracked tournament stay out. Top 8s list everyone, one card per event. An event that has not started holds the top 8 until the tournament's end time. A top 8 lookup that fails at placements time holds them back 12 hours, then they go without it. A top 8 that fails to send retries for up to 3 days.

Singles stream alerts and match calls get a **Head to head** button that replies privately to whoever presses it. It comes off when the set ends or is deleted, or 12 hours after the post.

The set, stream and match call checks run every 2 minutes. Each asks start.gg only about players with that switch on, 20 players per request, so the checks stay small however many players are tracked. A tracked tournament that's going on adds one request per 20 of its events for its new sets, and one per live tournament for its stream queue. When the stream check finds a new set on stream, it asks again 30 seconds later to confirm. A set in a stream queue links that queue's stream. Rechecking recent set results and match calls takes one request per 50 posts, plus 1 per 10 set results whose winner or score changed. Bills finals check ESPN daily, every 15 minutes from an hour before kickoff until 8 hours after: one request plus one per new final. A roll call adds one request for its streams. 1-hour DMs look a tournament up every 15 minutes, only in the 3 hours before one is due, plus one request for who's registered before a registration DM.

After the bot has been down, set results from the last 3 hours still post and older ones are skipped. `/status` says when that happened.

### Fixing posts that turn out wrong

TOs report the wrong winner, fix it a minute later, or call a set and take it back. The bot edits what it posted to match.

| Post | What changes |
| --- | --- |
| Set results | For an hour after a result posts, the bot checks it again every 2 minutes. If the TO changes the winner or score, the card is replaced with the new result marked **Corrected by TO**. If the TO resets or deletes the set, the card turns grey and its title starts with **Reset by TO**. If the set is reported again within that hour, the card shows the new result. |
| Match call pings | For 15 minutes after a call, the bot checks it every 2 minutes. If the set goes back to waiting, the ping is crossed out with "Uncalled by the TO", and calling it again pings again. If the set is still called 5 minutes in, the players get pinged once more in a reply ("You're still up, 5 min in. TOs usually DQ at 10"). This needs the `calls` switch on. |
| Discord events | Checked hourly until they start. A new time, name, venue, close time or event list on start.gg gets edited in, and a tournament deleted there gets its event cancelled. Nothing is posted about it. |
| Placements and top 8s | Projected placements are checked hourly for 3 days. Once start.gg has every placement final, or every event in the top 8 finished, the post is edited to the final standings. If the final version no longer splits into the same number of messages, it goes out as a new post saying so. A top 8 with nothing reported when placements posted goes out as a new message once the bracket is finished. |

Some TOs tag an event with the wrong game, like a "Melee Singles" tagged as Ultimate. When an event's name says Melee and its tag says Ultimate, or the other way around, the bot goes by the name. That covers `melee:True`, `game:` and the game shown on cards. Events whose name mentions both games, or another game like Project+, keep their tag.

### Turning posts on and off

Run `/messages` without options to see the current settings. Change any of the eleven switches: `sets`, `streams`, `calls`, `rollcall`, `results`, `top8`, `registration`, `events`, `slippi`, `recap` and `bills`. Only Bills finals and Discord events start off server-wide. Turning `events` on checks for Manage Events first, and it makes events for upcoming tournaments already tracked. The `/notify` DMs go by each person's own setting and the tournament's reminders, not these switches. Match calls only ping people who turned on `/notify calls`, and top 8s only come from tracked tournaments.

```text
/messages sets:False streams:False
/messages recap_day:Sunday recap_time:20:00 timezone:America/New_York
```

Times use 24-hour `HH:MM` in the chosen timezone, with daylight saving. Settings save right away and survive restarts. Posts that came due while a type was off stay skipped after you turn it back on. Schedule changes apply to future recaps. Each player's `/track posts`, each tournament's `/tournament posts` and everyone's own `/notify` pings still apply on top.

### Threads

`/messages threads` decides where set results and stream alerts go, so a big weekend doesn't flood the channel. A tracked tournament posts every set, so it always gets a thread. It has three modes:

| Mode | Where they go |
| --- | --- |
| **Off, post in the channel** | The channel, except a tracked tournament's, which go in its thread. This is the default. |
| **One thread per tournament** | A thread for each tournament, named after it. |
| **One thread per event** | A thread for each event, like `Genesis 11 · Ultimate Singles`. A tournament where the crew plays three events gets three threads. |

The first set result or stream alert from a tournament, or from an event in the per-event mode, posts a card with its name in the channel and starts a thread on it. One thread per tournament pins that card so the thread stays easy to find, and unpins it once placements post or 6 hours after the end. Later set results and stream alerts from it go in the thread. Match call pings, roll calls, placements and top 8s stay in the channel in every mode. Discord has no threads inside threads, so the per-event threads sit side by side in the channel. Each card names its tournament and event.

The bot needs **Create Public Threads** and **Send Messages in Threads** in the channel. Picking either thread mode checks for both and names any that are missing instead of switching. Pinning the tournament thread card needs **Manage Messages**; without it threads still work but the card stays unpinned. If a post can't go in its thread later, say a permission was removed or a moderator locked the thread, it posts in the channel and `/status` shows why. A deleted thread gets replaced on the next post. Threads archive after a day without posts and reopen when the next one goes in. Switching to **Off** sends everything back to the channel, except a tracked tournament's sets and streams, which keep their thread. Switching modes keeps the old threads, so going back to a mode reuses them for 14 days. A server that turned threads on before there were three modes keeps one thread per tournament.

## Run your own copy

You need Node.js 22.9 or newer, a Discord bot and a start.gg API token.

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications). Invite it with the `bot` and `applications.commands` scopes and these permissions: View Channel, Send Messages, Embed Links and Attach Files. For threads, add Create Public Threads and Send Messages in Threads, plus Manage Messages so tournament thread cards get pinned. For `/tournament event`, `add_event:on` and `/messages events`, add Manage Events so it can make and update scheduled events. Manage Roles lets `/to` make and hand out the TO role, `/notify registration` hand out the Reg Reminders role, and `/matchmaking_role` make and hand out the matchmaking roles. Reg reminder pings work without it, and without a TO role Manage Server counts as a TO. It needs no privileged intents.
2. Create a start.gg API token under Settings > Developer Settings.
3. Copy [.env.example](.env.example) to `.env` and fill it in. With Discord Developer Mode on, right-click the server and channel to copy their IDs.
4. Install and start it:

   ```sh
   npm install
   npm start
   ```

5. Move the bot's role above **Reg Reminders** so it can hand out that role. Keep the name `Reg Reminders`, since `/notify registration` looks for it. The TO and matchmaking roles the bot makes start below its own. If you make them yourself, name them `TO`, `Ultimate Matchmaking` and `Melee Matchmaking` and keep them below the bot's role.
6. The bot gives Samatron's start.gg account the TO role on its first start. On your own copy, change `FIRST_TO` in `src/commands/to.js` to your start.gg profile, or hand yourself the role in server settings.

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

The bot quits at startup only when start.gg turns down `STARTGG_TOKEN`. If start.gg is down or slow when it starts, it logs that and starts anyway, and every check picks back up once start.gg answers.

Keep `state.json` on persistent storage so tracking and settings survive redeploys. Every save also refreshes an hourly `state.json.bak`, which the bot falls back to if the main file ever reads corrupt. The bot stores it in `STATE_DIR`, else Railway's `RAILWAY_VOLUME_MOUNT_PATH` if set, else `data/` in the project folder.

**Node host.** Use systemd or pm2 to keep `npm start` running.

**Docker.** The volume keeps state across container rebuilds. To mount it somewhere else, set `STATE_DIR` to match.

```sh
docker build -t sama-tracker .
docker run -d --name sama-tracker --restart unless-stopped --env-file .env -v sama-data:/app/data sama-tracker
```

**Railway.** Deploy this repository and Railway builds the included Dockerfile. Add the required `.env.example` values under the service's Variables, plus any optional keys. Attach a persistent volume, and the bot uses its path unless `STATE_DIR` says otherwise. Every push to master redeploys it.

### Development

`npm run dev` restarts on file changes. `npm test` runs against fake Discord and start.gg responses and posts nothing. Both `npm start` and `npm run dev` join the real server with the tokens in `.env`, so don't run them next to a deployed copy.

## Data and limits

Every card message has a picture: the player's or tournament's start.gg image when there is one. Set result, stream and match call cards fall back to the tracked player's picture when the tournament has none, and a message with no picture of its own shows the bot's avatar. Discord can't always load start.gg's pictures from a link, so command replies upload them with the message, up to 10 files and 8MB. A start.gg picture that won't download comes off the card, and the avatar shows if that leaves the message with none. Plain text replies, like errors and on/off confirmations, have none.

start.gg can leave out scores, seeds, characters and stages, and the bot leaves them unknown. Sets link their VOD when the TO adds one on start.gg.

Predictions estimate odds from head-to-head results, common opponents, seeding, and Slippi ratings when both players are ranked and the game is Melee. With no Melee sets, the odds come from Slippi alone. Newer sets count more, and thin data pulls the odds toward 50%.

Slippi rank checks ask about 20 watchlist players per request, one request a second. The connect code search asks start.gg about 10 players per request. Melee reports refresh a watchlist player's Slippi profile at most every 30 minutes and wait up to 3 seconds for it before falling back to the last rank check's numbers. If the Slippi section doesn't fit on a card, the report goes out without it.

### Speed and waiting

start.gg allows 80 requests a minute. A first lookup can take tens of seconds, or about a minute for a large report. Commands share cached history where they can, profile and tournament links that come back empty stay missed for 5 minutes, and long lookups show progress while they load. A **Full report** press on `/h2h` or `/predict` reuses its report's lookup, so it asks start.gg for nothing new. The other full reports read further back, but keep the pages the short report already has. Pressing a Full report button that's already loading shares the first lookup instead of asking again. The second press hears start.gg is on it.

Your commands take turns with start.gg one at a time. A command sent while your last one is still loading answers right away. If it needs start.gg, it says **Queued** with about how long your last one has left, counting everyone else's commands, and starts when that one finishes. Commands that don't need start.gg, like `/help`, don't wait. Up to 3 can wait behind the one running, and past that the bot asks you to try again. When start.gg is backed up for everyone, new commands ask you to try again in a minute instead of queueing. Every 10th request goes to the background checks, so automatic posts keep moving on busy nights.

A public report that finishes more than a minute after you ran it goes out as a new message that pings you, and the loading reply is removed. Private answers, like `/scout`, stay private and don't ping.

A command that fails says whose side it failed on: start.gg not answering, start.gg having trouble or limiting the bot, start.gg turning down the bot's token, Slippi, Discord missing a permission, or a bug in the bot itself. The details go in the bot's logs. A start.gg request that times out or gets a 5xx error is tried twice more before that. Keeping Discord events up to date costs one start.gg request per upcoming event an hour.

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
