# Dark Fundies Bot

Follows start.gg accounts and posts to a Discord channel when a tracked player:

- finishes a set
- is entered in a tournament starting within 6 hours
- gets a final placement

## Setup

1. Create an app at https://discord.com/developers/applications and add a bot. Invite it with the `bot` and `applications.commands` scopes and the View Channel, Send Messages and Embed Links permissions.
2. Make a start.gg API token under Settings > Developer Settings.
3. Copy `.env.example` to `.env` and fill it in. With Developer Mode on in Discord, right-click the server and the channel to copy their IDs.
4. `npm install`, then `npm start`.

## Commands

```
/df help
/df track add profile:<link or ID>
/df track remove player:<name>
/df track list
/df upcoming player:<name or all>
/df recent player:<name or all>
```

Tracked players and posted sets are saved in `data/state.json`.
