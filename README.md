# Dark Fundies Bot

Follows start.gg accounts and posts to a Discord channel when a tracked player:

- finishes a set (only their first DQ in an event, so people know they dropped out)
- has a set on stream, either called or at the front of the stream queue (with the Twitch link)
- is entered in a tournament starting within the hour (only when 3 or more are entered)
- finishes a tournament (posts where the crew placed, best first)

## Setup

1. Create an app at https://discord.com/developers/applications and add a bot. Invite it with the `bot` and `applications.commands` scopes and the View Channel, Send Messages and Embed Links permissions.
2. Make a start.gg API token under Settings > Developer Settings.
3. Copy `.env.example` to `.env` and fill it in. With Developer Mode on in Discord, right-click the server and the channel to copy their IDs.
4. `npm install`, then `npm start`.

While editing the code, use `npm run dev` instead. It restarts the bot every time you save a file.

## Commands

```
/df help                                          show the commands
/df track add profile:<link or ID>                start tracking a start.gg player
/df track remove player:<name>                    stop tracking someone
/df track list                                    everyone being tracked
/df upcoming player:<name or all>                 tournaments they're in, live ones first
/df recent player:<name or all>                   the 5 latest sets
/df stream player:<name or all> alerts:<on|off>   turn on-stream alerts on or off
```

For `profile`, paste their start.gg profile link (like `start.gg/user/f64a83c8`) or just the ID at the end. `player` autocompletes from the tracked list.

Tracked players and posted sets are saved in `data/state.json`.
