# Sama-tracker

By Samatron. A Discord bot for following your Smash crew on start.gg: results, stream alerts, tournament reminders, and player stats.

<img src="screenshots/predict.png" alt="/predict" width="56%"> <img src="screenshots/h2h.png" alt="/h2h" width="42%">

<img src="screenshots/sm4sh.png" alt="/sm4sh" width="53%"> <img src="screenshots/recent.png" alt="/recent" width="45%">

See it running in [this Discord server](https://discord.gg/VuMz7Y2k2).

## Use the bot

**Track a player** to post their sets, stream alerts, and placements in the channel. Anyone can add a player with `/track add`.

**Link yourself** to use player lookups without automatic posts. Connect Discord on your start.gg profile, then run `/link`. Tracked players with Discord connected can already use these lookups without linking.

### Shared inputs and options

- `profile` accepts a start.gg profile link or its final ID, such as `start.gg/user/f64a83c8` or `f64a83c8`.
- The `player` and `opponent` pickers include tracked and linked players. `/track remove`, `/stream`, and `/sets` accept tracked players only. Leave an optional `player` blank to look yourself up.
- `player:all` works with `/upcoming`, `/recent`, `/stream`, and `/sets`, and includes everyone tracked.
- `verbose:True` adds the details shown in the stats table below. Leave it out for the short report.
- `melee:True` limits `/stats`, `/h2h`, `/predict`, `/scout`, and `/progress` to Melee. `/characters` uses `game:Melee` or `game:Ultimate` instead.

### Tracking and accounts

| Command | What it does |
| --- | --- |
| `/track add profile:<link or ID>` | Start automatic posts for a player. |
| `/track remove player:<name>` | Stop tracking them. |
| `/track list` | List tracked players and any muted alerts. |
| `/link profile:<link or ID>` | Link your own start.gg account. |
| `/unlink` | Remove your link. This does not stop tracking. |
| `/upcoming` | Show live and upcoming tournaments. |
| `/recent` | Show your last 5 sets. With `player:all`, show up to 20, at most 3 per player. |
| `/run` | Show your run and next opponent in each current bracket. |
| `/stream player:<name or all> alerts:<on or off>` | Change stream alerts for tracked players. |
| `/sets player:<name or all> results:<on or off>` | Change automatic set results for tracked players. |

Anyone can change `/stream` and `/sets` for tracked players. Use `/messages` for server-wide controls.

### Stats and matchups

| Command | Short report | With `verbose:True` |
| --- | --- | --- |
| `/stats` | Recent record, placements, and biggest upset. | Lifetime results, opponents, and seed performance. |
| `/h2h opponent:<name or link/ID>` | Overall record, last 10 meetings, and one-line predicted odds. | Every meeting, splits, streaks, and one-line predicted odds. |
| `/predict opponent:<name or link/ID>` | Estimated odds of winning. | The same odds, with the reasoning behind them. |
| `/scout profile:<link or ID>` | Any opponent's form, characters, toughest opponents and worst matchups, and your head-to-head. | More history, habits, toughest opponents and worst matchups, stages, and your odds. |
| `/progress` | Last 30 days against the previous 30, with changes in win rates and placements. | More detail on each period and a 6-month trend. |
| `/characters` | Reported characters in Ultimate or Melee. | More history and other games with reported characters. |

Add `player:<name or link/ID>` to look up someone else, for example `/h2h opponent:Sparg0 player:Leo`. In `/h2h` and `/predict`, either player can also be a start.gg link or ID, tracked or not. `/h2h` odds run the same prediction as `/predict` but stay one line. `verbose:True` doesn't change them, use `/predict` for the reasoning. `/scout` always uses you as the comparison player and replies privately. Your Discord must be connected on start.gg.

These reports count singles and leave DQs out of set records. Characters and stages appear only when the tournament organizer reports them. `/characters` defaults to whichever of Ultimate or Melee has more reported games, or more sets if neither has reported characters, and replies privately.

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

Reminders go out 7 days, 3 days, 1 day, and 12 hours before registration closes. If registration extends past the tournament start, the start is the deadline. Past reminders are skipped; a last call set within 12 hours goes out immediately. Setting a reminder also tracks everyone registered for the tournament, so their sets post.

Connect Discord on start.gg so the bot can recognize your registration and skip your reminder pings. Hidden entrant lists can prevent these checks. `/reg_warn` sends no ping if registration is closed, the person is registered, or the list is hidden. `/registered` lists names without pinging anyone.

### General

| Command | What it does |
| --- | --- |
| `/help` | Show the commands. |
| `/status` | Show uptime, host, and the last start.gg checks. |
| `/profile user:<@someone>` | Find a server member's start.gg profile. Leave `user` blank for yourself. |
| `/messages` | Show or change automatic posts and the recap schedule. |
| `/socials` | Show saved streams and social links. |
| `/socials_edit add name:<who> link:<url>` | Save a link. `https://` is optional; links with the same name share a line. |
| `/socials_edit remove link:<url>` | Remove a saved link. |

`/profile` checks the Discord connected on start.gg and searches accounts the bot has already seen: tracked players, people who used `/link` and people registered for a tournament the bot checks. If it cannot find you, connect Discord on start.gg and run `/link`. Someone else has to be on that list first, then `/profile @them` finds them.

`/messages` requires **Manage Server**. `/socials_edit` requires it by default; you can delegate that command under Server Settings > Integrations > Sama-tracker.

### Fun

`/sm4sh`, `/melee`, `/ult`, `/64`, `/brawl`, and `/pplus` each have their own Smash take. With `ANTHROPIC_API_KEY`, they use Claude Haiku, SmashWiki context, and an image. Without it, they reply with their catchphrase. `YOUTUBE_API_KEY` adds video context.

`/bills` posts a Bills Mafia photo and rally cry, with the image source linked. It does not use AI.

`/view_pfp` posts the bot's profile picture at full size, the meme image its avatar comes from.

## Automatic posts

| Type | When it posts |
| --- | --- |
| Set results | After a tracked player finishes a set. Only their first DQ per event is posted. |
| Stream alerts | When their set is on stream, called, or next in the stream queue. |
| Tournament roll calls | An hour before a tournament with at least 3 tracked players. |
| Tournament placements | 12 hours after the tournament ends, or up to 24 hours if results are incomplete. Unfinished placements are marked as projected. |
| Registration reminders | At the deadlines listed above, for people who enabled `/reg_role` pings. |
| Weekly recap | Sunday at 9 pm New York time by default: results, highlights, and next week's entries. Only tracked players with a non-DQ singles set that week are included. |

Run `/messages` without options to see the current settings. Change any combination of the six switches: `sets`, `streams`, `rollcall`, `results`, `registration`, and `recap`.

```text
/messages sets:False streams:False
/messages recap_day:Sunday recap_time:20:00 timezone:America/New_York
```

Times use 24-hour `HH:MM` and the selected timezone, including daylight saving. Settings save immediately and survive restarts. Posts missed while a type is off are skipped when you turn it back on. Schedule changes apply to future recaps. Per-player `/sets` and `/stream` settings and personal `/reg_role` pings still apply.

## Setup

Requires Node.js 22.9 or newer.

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications). Invite it with the `bot` and `applications.commands` scopes and these permissions: View Channel, Send Messages, Embed Links, Attach Files, and Manage Roles. No privileged intents are needed.
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
- Already tracked players are skipped, and attendees without a start.gg account are left out.
- The bot adds queued players within 30 seconds on its host and the tool reports how many. Players queued while the bot is down are added on its next start.

On Railway, run `railway ssh`, then `npm run track` or `node tools/track-attendees.js`.

## Data and report limits

start.gg can omit scores, seeds, characters, and stages. Missing data stays unknown. Predictions estimate outcomes from head-to-head results, common opponents, and seeding; newer sets count more, and limited data pulls the odds toward 50%.

First lookups can take tens of seconds or about a minute for a large report. start.gg limits requests, and commands share cached history where available. Long history lookups show progress while they load.

<details>
<summary>History limits and placement calculations</summary>

| Command | History checked |
| --- | --- |
| `/stats` | Latest 15 standings and 30 singles sets. With `melee:True`, standings are game-filtered and older pages are read for 30 Melee sets, or all available if fewer. |
| `/stats verbose:True` | Every finished singles event and up to 3,000 sets. |
| `/h2h` | All available meetings against the selected opponent, plus up to 600 sets per player for one-line predicted odds, in either report length. |
| `/predict` | Up to 600 sets per player. Verbose explains the same prediction. |
| `/scout` | Up to 600 sets per player and 400 sets for the opponent's characters. |
| `/scout verbose:True` | Up to 1,200 opponent sets, 800 for characters and stages, every finished event, and 600 of your sets. |
| `/characters` | Up to 400 sets, or 1,600 with verbose. Verbose shows up to 6 games. |
| `/progress` | 60 days, or 180 with verbose, split into 30-day periods. |

`melee:True` filters the history each report checks. The limits above still apply. `/h2h` checks every meeting; short `/stats` reads back far enough to fill its Melee set window when possible.

Progress placements count toward the period when the event started. Average finishes account for bracket size. Seed comparisons use placement tiers, so seed 6 finishing 5th counts as on seed.

</details>
