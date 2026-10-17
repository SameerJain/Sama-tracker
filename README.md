# Sama-tracker
(By Samatron)

<img src="screenshots/predict.png" alt="/predict" width="56%"> <img src="screenshots/h2h.png" alt="/h2h" width="42%">

<img src="screenshots/sm4sh.png" alt="/sm4sh" width="53%"> <img src="screenshots/recent.png" alt="/recent" width="45%">

See it running in [this Discord server](https://discord.gg/VuMz7Y2k2).

Follows start.gg players and posts to a Discord channel when one of them:

- finishes a set. Only their first DQ in an event gets posted, and big wins over higher seeds are marked as major upsets
- has a set on stream, called or at the front of the stream queue
- is entered in a tournament starting within the hour, if 3 or more of the crew are
- finishes a tournament, with where everyone placed. That waits 12 hours after the end since TOs often report top 4 late, or 24 if someone's placement still isn't in. After that it posts anyway, with start.gg's projected placement for anyone left in an unfinished bracket

Every Sunday at 9 pm ET it also posts a weekly crew recap with everyone's results, the biggest upset, the best finish and what they're signed up for next week. Only tracked players with at least one singles set that wasn't a DQ get in, and a week where nobody played posts nothing. `/messages` changes the day, time and timezone, or turns it off.

Recap placements come from finished events where the player played a set that week, even if the event started the week before. If the bot is down when the recap is due, it still goes out once it's back, as long as that's within a day. A restart partway through sends whatever hadn't gone out yet instead of starting over.

It also pings everyone who turned on reg pings when registration is about to close for a tournament someone set a reminder for, or one a reg admin runs.

## Setup

1. Create an app at https://discord.com/developers/applications and add a bot. Invite it with the `bot` and `applications.commands` scopes and the View Channel, Send Messages, Embed Links, Attach Files and Manage Roles permissions. Manage Roles is only for the Reg Reminders role. It doesn't need any privileged intents.
2. Make a start.gg API token under Settings > Developer Settings.
3. Copy `.env.example` to `.env` and fill it in. With Developer Mode on in Discord, right-click the server and the channel to copy their IDs. `ANTHROPIC_API_KEY` and `YOUTUBE_API_KEY` are optional. For the YouTube one, make a project in the Google Cloud Console, enable YouTube Data API v3 and create an API key under Credentials.
4. `npm install` and `npm start`. Needs Node 22.9+. `npm run dev` restarts it when you save a file. `npm test` runs the tests, which fake Discord and start.gg, so they never post anything.

### Deploying

Only run one copy at a time or everything gets posted twice. The bot keeps what it knows in one `state.json`. Point `STATE_DIR` at a folder that survives restarts, or leave it alone to keep `data/` in the project folder.

**Any Node host.** A VPS, a home server, an old laptop. Needs Node 22.9+.

```sh
npm install
npm start
```

To keep it running, use systemd or pm2. A unit file looks like:

```ini
# /etc/systemd/system/sama-tracker.service
[Unit]
Description=Sama-tracker
After=network-online.target

[Service]
WorkingDirectory=/srv/sama-tracker
ExecStart=/usr/bin/npm start
Restart=always
EnvironmentFile=/srv/sama-tracker/.env

[Install]
WantedBy=multi-user.target
```

**Docker.** Same places, plus Render, Fly.io, a NAS and anything else that runs containers.

```sh
docker build -t sama-tracker .
docker run -d --name sama-tracker --restart unless-stopped --env-file .env -v sama-data:/app/data sama-tracker
```

The `-v` keeps `state.json` in a named volume, so restarts and rebuilds don't wipe it. Skip it and a new container starts from nothing. Mount the volume somewhere else instead and set `STATE_DIR` to that path.

**Railway.** The included Dockerfile works as-is.

1. New project, deploy from this GitHub repo.
2. Put everything from `.env.example` in the service's Variables.
3. Right-click the canvas, add a volume and connect it to the service. The bot reads `RAILWAY_VOLUME_MOUNT_PATH` and writes there, so no setting needed. Without a volume, state is wiped on every redeploy.
4. Pushing to GitHub redeploys it.

### Discord name and roles

The app and bot username are `Sama-tracker` in the Discord Developer Portal. You can also rename the bot's server role to `Sama-tracker`. Keep its permissions and position, above `Reg Reminders`, so it can assign that role.

Keep the `Reg Reminders` name because `/reg_role` looks it up by name. Message footers say `Sama-tracker by Samatron`, from `FOOTER` in `src/embeds/shared.js`, and changing it there only affects new messages. Head-to-head cards add the game when all their sets are from that game, including Ultimate and Melee.

`/messages` always needs Manage Server. `/socials_edit` needs it by default, and you can hand it to other roles under Server Settings > Integrations > Sama-tracker.

## Commands

### General

```
/help                                          show the commands
/status                                        uptime, which machine, last start.gg checks
/socials                                       streams and social links saved for this server
/socials_edit add name:<who> link:<url>        add a link
/socials_edit remove link:<link>               remove one
/profile user:<@someone>                       their start.gg profile, if it has their Discord connected
/messages                                      show or change automatic posts
```

`/socials` lists the links saved with `/socials_edit`, so they live in the bot's data instead of the code. Links with the same name go on one line, labeled by site: X, Twitch, YouTube, Instagram, TikTok, Bluesky, Kick, Facebook, Threads and Discord. Links to anything else show in full. The `https://` is optional.

```
/socials_edit add name:abbrchive link:youtube.com/@abbrchive/featured
```

`/profile` links a server member's start.gg profile, or yours if you leave `user` out. It only counts a start.gg that has their Discord connected, checked on start.gg each time, so nobody can claim someone else's. start.gg can't be searched by Discord, so the bot goes through the accounts it already knows: tracked players, `/link`, and anyone it has seen registered with Discord connected through reg reminders, `/registered` or `/reg_warn`. It keeps the last 5000 of those. If none match, it reads who's registered for the current reg reminder tournaments. Someone it can't find can connect Discord on start.gg and run `/link`.

`/messages` turns each kind of automatic post on or off for the whole server and sets when the recap goes out. Every option is optional, so you can change several at once, or run it with none to see where things stand. Changes save right away and survive restarts.

```
/messages sets:False streams:False
/messages rollcall:False results:True registration:True recap:True
/messages recap_day:Sunday recap_time:20:00 timezone:America/New_York
```

The six switches are set results, stream alerts, tournament roll calls, tournament placements, registration reminders and the weekly recap. Whatever comes due while one is off gets skipped for good, so turning it back on doesn't dump what you missed. That holds even if the bot hadn't checked yet when you flipped it. Per-player `/sets` and `/stream` settings and personal `/reg_role` pings still apply on top.

Recap times are 24-hour `HH:MM` in a timezone like `America/New_York`, `America/Los_Angeles`, `Europe/London` or `UTC`. A new schedule starts with the next recap instead of sending one that's overdue. If daylight saving skips your time, the recap moves up by the jump, and a time that happens twice uses the first one.

### Player tracking

```
/track add profile:<link or ID>                track a start.gg player
/track remove player:<name>                    stop tracking someone
/track list                                    everyone being tracked
/upcoming                                      your tournaments, live ones first
/recent                                        your last 5 sets
/run                                           your current run in every bracket, next opponents
/stream player:<name or all> alerts:<on|off>   on-stream alerts on or off
/sets player:<name or all> results:<on|off>    automatic set results on or off
```

Only tracked players get their sets, streams and placements posted. The `player` and `opponent` pickers list tracked players, then anyone who linked themselves (below). `/track remove`, `/stream` and `/sets` only list tracked players, since they're about what gets posted. `/upcoming`, `/recent`, `/stream` and `/sets` also take `player:all`, which means everyone tracked. For `/recent` that's the 20 newest sets, 3 per player at most. Anyone can flip `/sets` and `/stream` for anyone tracked; sets that went out while one was off stay off, and turning results back on only posts sets from then on. `/track list` marks whoever has either one off.

### Linking yourself

```
/link profile:<link or ID>                     tie your Discord to your own start.gg
/unlink                                        undo it
```

Tracking and linking are different things. Anyone can `/track add` anyone, and that posts their sets, streams and placements here. Linking is only for yourself. It checks that the start.gg profile has your Discord connected, so nobody can link as someone else. After that the bot knows who you are:

- leave `player` out of `/upcoming`, `/recent`, `/run`, `/progress`, `/h2h`, `/stats`, `/characters` or `/predict` to look yourself up
- `/scout` works for you
- you're in the player picker, marked linked, so others can pick you in those lookups too
- `/profile` finds you

Nothing about you gets posted, and you're not in `/track list`. Tracked players whose start.gg has their Discord connected get all of this already, and `/link` tells them so instead of linking.

### Player stats

```
/h2h opponent:<name>                           your record against them, DQs left out
/h2h opponent:<name> verbose:True              every set, plus splits and streaks
/h2h opponent:<name> melee:True                just your Melee sets against them
/stats                                         recent set record, best finish, biggest upset
/stats verbose:True                            lifetime report
/stats melee:True                              Melee sets and placements only
/characters                                    characters from reported Ultimate or Melee games
/characters game:Melee                         just Melee, or game:Ultimate for just Ultimate
/characters verbose:True                       every game with characters reported
/predict opponent:<name>                       your odds of beating them
/predict opponent:<name> verbose:True          how each part of the prediction counts
/predict opponent:<name> melee:True            Melee odds even if they play another game more
/scout profile:<link or ID>                    scout any opponent, if you're tracked or linked
/scout profile:<link or ID> verbose:True       more history, habits, stages, your odds
/scout profile:<link or ID> melee:True         their Melee sets, characters and your Melee odds
/progress                                      last 30 days against the 30 before, by game
/progress verbose:True                         more on each period, plus 6 months of trend
/progress melee:True                           Melee only, at either length
```

Leaving out `player` looks up whoever ran the command. Add `player:<name>` for someone tracked instead, like `/h2h opponent:Sparg0 player:Leo`.

`verbose` is off unless you add `verbose:True`, and the `melee` options work the same way. Discord makes you pick True or False once you add the option, so leaving it out is the same as False.

### Registration

```
/set_reg_reminder tournament:<link>            ping people before registration closes
/delete_reg_reminder tournament:<name>         cancel a reg reminder
/reg_admin add profile:<link or ID>            reminders for every tournament they admin
/reg_admin remove admin:<name>                 stop doing that for them
/reg_admin list                                every reg admin
/reg_role ping:<on|off>                        reg reminder pings for yourself
/bracket                                       bracket links for live reg reminder tournaments
/registered tournament:<link>                  who in this server is registered
/registered tournament:<link> by_event:True    the same, listed by event
/reg_warn tournament:<link> user:<@someone>    warn someone who isn't registered yet
```

### Fun

```
/sm4sh                                         I LOVE SMASH BROS FOR WII U
/melee                                         MELEE IS THE ONLY REAL SMASH GAME
/ult                                           I HATE SMASH BROS ULTIMATE
/64                                            SMASH 64 DID IT FIRST
/brawl                                         BRAWL WAS GOOD ACTUALLY
/pplus                                         HAVE YOU HEARD ABOUT PROJECT+
/bills                                         Bills Mafia photo and rally cry
/view_pfp                                      the bot's profile picture, full size
```

### Command notes

`profile` takes a link like `start.gg/user/f64a83c8` or just the ID at the end. `player` and `opponent` autocomplete from tracked and linked players. If nothing matches, the list says so instead of sitting there empty.

Reg reminders go out a week, 3 days and a day before registration closes, then a last call 12 hours before. If registration stays open after the tournament starts, the start counts as the deadline. Ones already past when you set it get skipped, except the last call, which goes out right away inside those 12 hours.

Tournaments a reg admin is an admin of on start.gg get reminders set on their own, checked every 15 minutes. Deleting one with `/delete_reg_reminder` keeps it from coming back.

`/bracket` links every event's bracket for reg reminder tournaments from 30 minutes before they start until 6 hours after their end time.

Pings go to whoever turned them on with `/reg_role`, which only ever changes your own setting. If your Discord is connected on start.gg, you don't get pinged for tournaments you're already registered for. Some tournaments hide who's registered, and for those everyone with pings on gets pinged. The bot also gives you a Reg Reminders role so everyone can see who's in.

`/registered` is `/upcoming` for one tournament, going by everyone in the server instead of the tracked list. It lists each person by start.gg tag in bold, with their server name after it when that's different, and the events they're in listed underneath. It uses names instead of mentions, so nobody gets pinged. start.gg only knows someone's Discord if they connected it there, so people who didn't won't show up. `by_event:True` lists each event instead, the one with the most people from the server first, with how many of its entrants they are, then anyone registered who isn't in an event. If the tournament hides who's registered on start.gg, it says so.

`/reg_warn` is a manual, half-serious nudge. If they're registered it says "Already registered." and leaves them alone, with no mention and no ping. If they aren't, it pings them with a warning and the register link. It goes by the Discord connected on start.gg, so someone who registered without connecting it still gets warned. If the tournament hides who's registered, there's no telling, so it says so and sends nothing. Once registration closes it just says so.

`/h2h` lists the last 10 meetings. Every set between two players is in both their histories, so it reads just the one with fewer sets when all of it fits in 600 sets, and the last 600 of each when neither does. With `verbose:True` that goes up to 3000, and it lists every set, plus the record by game, as the higher and the lower seed and in grand finals, the current streak and when they first played. The last 10 show while the rest loads.

`melee:True` counts only Melee sets, and works with or without `verbose:True`. It filters the same sets, so it's no slower, and the reply says how many sets in other games it left out. Someone who mostly plays Ultimate can have older Melee sets past the 600, so add `verbose:True` if some are missing.

`/predict` puts head-to-head, common opponents and seeding together into one estimate of how far apart two players are:

- newer sets count more, and a set from a year ago counts half
- common opponents count by how much better each of you did against them, not just who did better
- seeding counts by how much higher one of you was seeded, at brackets you were both in, or by how high each of you is usually seeded for the size of the bracket if you never shared one
- how much a seed gap is worth comes from your own seeded sets in that game, and it's adjusted for whoever has been beating their seeding over their last 40 sets
- the less there is to go on, the closer the odds stay to 50%

It's the same from either side, so if A gets 70%, B gets 30%. Backtested in October 2026 on 368 past sets between tracked players, predicting each from only what was known before that tournament, it picked the winner 83% of the time, and when it said 90% or more the favourite won 97% of those. `verbose:True` gives the same odds and shows how much each part counted, what it says on its own, the common opponents, the shared brackets and what a seed was worth. With `melee:True` it goes by your Melee sets even when you play another game together more, and says so if you've never played Melee.

`/run` looks up the player's current tournaments directly, including ones that ended in the last 6 hours. It lists their finished sets and whether their placement is final. The next opponent shows up once start.gg has assigned one. It doesn't guess.

Someone in several brackets at once, like Ultimate, Melee and 64 at the same tournament, gets a card up top listing every event with the one that needs them soonest first: playing now, then called, queued, ready, waiting on a set, waiting for an opponent, not started and finished. Each line has their record in that event and the opponent, linked to the set. Every event that started gets its own card under that.

`/scout` answers privately, and only for tracked or linked players whose start.gg still has their Discord connected, checked on start.gg each time. It takes any opponent's profile without tracking them and shows their recent singles results, reported characters by game and your record against them. It looks at up to 600 sets each and 400 for characters, so older meetings and unreported characters can be missing. `melee:True` limits it to Melee sets, characters and odds.

`/scout verbose:True` reads up to 1200 of their sets, 800 for characters and stages, and every event they placed in. The quick `/scout` card shows first while the rest loads, then the full report replaces it. Every card stays private. You get:

- the same two cards as `/stats verbose:True` for them, including their record against everyone tracked
- form in each game over their last 20 sets and the last 90 days
- habits in the game you both play, or their main one if you don't share one. That's close sets (2-1, 3-2), record against higher and lower seeds, record on winners side, losers side and in grand finals, and how often they sweep or get swept
- each character's record and when they last played it, then the opponent characters and stages they lose and win on most. Those need 3 or more games, and stages only show up if the TO reported them
- your odds, worked out the same way as `/predict`, your last 10 sets against them and the opponents you've both played

`/progress` compares the 30 days before you run it with the 30 before that. Each game gets a card with the set record, games won, the current streak, average and best placement, and finishes above, on or below seed. DQs are left out. Placements come from finished events, counted in the 30 days the event started in. Seed comparisons use the same placement tiers as `/stats`, so seed 6 finishing 5th counts as on seed. A period with no sets shows no win rate instead of a made-up 0%. `melee:True` counts Melee only, at either length.

`/progress verbose:True` adds streaks (now, best and worst), close sets, sweeps, record against higher and lower seeds, best win and worst loss by seed, and the game record on each reported character to both periods. Under What changed it lists the change in win rate, games won and average finish, and anyone played in both periods with the record each time. Last is every 30 days for the past 180, newest first. If start.gg won't send the characters, it answers without them.

With `ANTHROPIC_API_KEY` set, the Smash fun commands get Claude Haiku to write a post as a Smash 4 superfan, a Melee purist, a burnt-out Ultimate player, a 64 old head, the last Brawl defender or a Project+ recruiter, with a random SmashWiki screenshot from that game, or a stage for P+. Otherwise they just say the line.

Each post gets real facts to work from so Haiku doesn't make things up: two of the game's own talking points from its file in `src/fun/`, a few paragraphs from a random SmashWiki article, and, with `YOUTUBE_API_KEY` set, richer context from a YouTube video. SmashWiki sources now include major tournaments and each game's global power-ranking series alongside characters, techniques, stages, patches and other game material. YouTube searches also cover rankings, stats, major recaps, meta analysis and community retrospectives. Haiku gets the video's creator description and tags, likes, comment count and up to five top relevant viewer comments. It treats those comments as community opinion rather than facts.

YouTube's official API does not let an API key download captions from someone else's video. Add the key to `.env` locally and to the Railway `YOUTUBE_API_KEY` variable; no OAuth setup is needed. Search results stay cached for a day, and only the selected video's comments are fetched. If SmashWiki or YouTube is down, the post goes out without that part.

`/bills` does not use AI. It picks a short rally cry and a large image from the Bills Mafia, Bills players, team, stadium and mascot collections on Wikimedia Commons, with the source linked on the card.

`/characters` shows one game, Ultimate or Melee. Pick it with `game`, or leave it out to get whichever of the two has more games with characters reported, or more sets if neither has any. `verbose:True` puts that game first, then a card for each other game they have characters reported in, up to 6 in all. A game you picked always gets its card, even with nothing reported. It looks at their last 400 singles sets in every game, or 1600 with verbose, and only sees games where the TO reported characters, which a lot of tournaments skip. The picture is their main's art from start.gg. With verbose, the usual card shows while the rest loads.

`/stats verbose:True` is two cards covering every singles event and up to 3000 sets: record by game and year, top 8s, finishes against seed, win streaks, biggest wins and losses, most played opponents and the record against everyone else tracked. The short `/stats` card shows while it loads. `melee:True` counts only Melee events and sets.

start.gg allows 80 requests a minute, and every page of someone's history is a request, so the first look at a player takes a while: 10 to 30 seconds for `/h2h`, `/predict` and `/characters`, and about a minute for the verbose ones with someone who has a couple thousand sets. When that's more than about 20 seconds, the reply says how many of the requests are done and about how long is left. After that it's a second or two for the next few hours, since every command shares the history already fetched and only asks for newer sets. When a few people run commands at once they take turns, so a slow one doesn't hold up the rest. Any command that makes 20 or more requests logs how many, how long it took and whether start.gg said to slow down, so the host's logs show what a slow one was waiting on. State is saved in `data/state.json`, or wherever `STATE_DIR` points.

## Source layout

- `src/commands/`: command definitions, routing and handlers grouped by players, stats, registration and settings. `history.js` owns the shared history caches.
- `src/embeds/`: Discord cards grouped by tournaments, stats, scouting, players and system messages. `shared.js` holds formatting and the footer.
- `src/fun/`: the six Smash posts, `/bills`, their reply handler and shared SmashWiki, YouTube and Commons helpers.
- `src/startgg.js`: start.gg requests, pagination and rate limiting.
- `src/tracker.js`: background checks and scheduled posts. `src/store.js` saves their state.
