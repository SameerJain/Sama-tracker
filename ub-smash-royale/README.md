# UB Smash Royale stats

View: open `index.html` in a browser (double-click). No server, no build, no internet needed.
Charts are static SVGs in `images/`, raw numbers in `data/` (JSON + CSV).

## What's inside

- 78 tournaments: 48 numbered (series numbered 1–49; #13 skipped over summer 2024)
  plus 30 off-week club nights in between them during term. The off weeks
  count for attendance, seasonality, crowds and loyalty, but not for Ultimate
  winners or matchups; they join the redemption ranking only where one of them
  ran a redemption bracket that reported standings. The toggle at the top of
  the page switches the whole dataset between that view and on weeks only
  (`on-weeks-only.html`); winners and matchups are on weeks only in both.
- Largest: Smash Royale #1 - UB Smash Club, 65 attendees, 2023-09-06.
- Winners merged by start.gg player id across alias/sponsor changes.
- Nights-attended ranking from full Ultimate and Melee entrant lists plus the
  off-week brackets, one per player per night (351 distinct players).
- Redemption bracket ranked separately (32 events).
- Page also has rivalries from every singles set (a switch narrows them
  to sets with characters reported, and an Include off weeks toggle adds the
  off-week nights' singles brackets on top of either), top-4 consistency and
  recent form, favourites and upsets, school-year retention, seasonality, character usage
  with 95% ranges, character matchups, loyalty tiers, return rates, cumulative
  player growth and a Buffalo card for players in both series.

## Data files

- `data/tournaments.json/.csv`: all 78 tournaments + winners
- `data/standings.json`: top 4 of each event (Ultimate, Redemption, Melee)
- `data/winners.json/.csv`: wins/podiums per player
- `data/matchups.json/.csv`: character vs character game records (every pair with a reported game)
- `data/head-to-head.json/.csv`: player rivalries from every completed singles set, with games won from reported set scores
- `data/podium-rates.json/.csv`: top-4 and title rates over nights entered
- `data/favourites.json`: favourites, upsets, first-time champions and title spread
- `data/seasonality.json/.csv`: tournaments and average attendance by month of year
- `data/retention.json/.csv`: loyalty tiers, histogram, return rates, newcomers by year, cumulative players
- `data/cross-series.json/.csv`: players entered in both series, combined events and wins
- `data/charts-data.json`: arrays backing the charts

## Rebuild

Research scrape lives in `../research_notes/ub-smash-royale/`
(`royale-all.json`, `tournaments-events.json`, `standings.json`,
`attendance-offweek.json`, `offweek-tournaments.json`, and
`offweek-chars-by-event.jsonl` for the off-week singles sets).
To regenerate this folder:

```sh
node ub-smash-royale/build.mjs
```
