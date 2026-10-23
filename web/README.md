# Samatracker

The web companion to the Sama-tracker Discord bot. No server, no secrets, no
start.gg token: `index.html` reads the cached bundle in `data/buffalo.json`
and Slippi lookups go straight from the visitor's browser to slippi.gg.

View: serve the folder with any static server, since a page opened straight from
disk can't read its own data file or load modules. `data/buffalo.json` and `lib/`
have to exist first, so build them with `node web/build.mjs` (it only reads the
`data/*.json` in each series folder).

`lib/` is the bot's own code, copied in by the build: `src/format.js` for counts,
placements and medals, `src/slippi/shared.js` for ranks, connect codes and Slippi
profiles, and the rank badges from `src/assets`. So a rank or a plural reads the
same here as in Discord. Both files import nothing, which is what lets a browser
load them, so keep it that way.

## What's inside

Web versions of the bot's lookups (a bot-command → web mapping lives on the
page itself). Everything portable runs here; live tournaments, server roles
and pings, and AI posts stay in Discord.

- Buttons to both series data pages (Monday Night SmashBall, UB Smash Royale).
- Player lookup: events, podiums, characters, first and last appearance.
  Full cards carry follow, "this is me" and head-to-head buttons.
- Head-to-head: the set and game record from every Ultimate Singles set the
  two played at either series, plus shared tournaments and finals.
  Odds need live set histories, so those stay `/predict` in Discord.
- Followed: a track list in this browser's localStorage, like `/track`
  without posting anything. "This is me" is `/link` without an account.
- Buffalo overall: players in both series, by combined events.
- Series leaders and recent tournaments across both series.
- Slippi ranked lookup by connect code, with the same rank badges as the bot's
  cards, plus a watchlist kept in the browser's own localStorage (this device
  only, and it never pings anyone). "Refresh ranks" asks slippi.gg again.
- Status card with the bundle's freshness, so the staleness is visible.

## Rebuild

```sh
node series/build-all.mjs
```

That rebuilds both series viewers and this bundle. Or just the bundle:

```sh
node web/build.mjs
```

## Deploy

A third Vercel project rooted at `web/`, live at
https://samatracker.vercel.app (like the two series projects are rooted at
their folders). `node series/refresh.mjs --deploy-only` redeploys all three;
its address lives in `HUB.url` in `series/configs.mjs`, which the series
switchers link at.

## More analysis ideas (not built yet)

Cheap ones, from data already scraped: repeat finals (the same pair meeting
in two finals), first-time winners per year, attendance records by weekday
venue, character loyalty (players who never switch), longest gaps between
titles. Pricier ones, needing new scraping: upset rate by seed tier per
series, month-over-month newcomer stickiness per TO era.
