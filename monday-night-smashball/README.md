# Monday Night SmashBall @ Heart of the Game: Ultimate stats

View: open `index.html` in a browser (double-click). No server, no build, no internet needed.
Charts are static SVGs in `images/`, raw numbers in `data/` (JSON + CSV).

## What's inside

- 183 tournaments at 85 S Rossler Ave, Buffalo, NY (series numbers 1–183).
  Numbering quirks found by scraping: #59 was skipped (58 → 60), #56 ran as
  "Lights Out", #67 ran unnumbered (2024-06-17), #69 ran as "69.0+1.0",
  #96 ran twice (96 and 96/2 on 2025-01-06), #146 ran as "SmashBall 146
  Holiday Party" (no "Monday" in the name). #72 came from a fourth TO.
- Largest: Monday Night SmashBall 100 $100 POT BONUS @ Heart Of The Game, 58 attendees, 2025-02-03.
- Ultimate only: 182 Ultimate Singles events, 8,274 sets, 4,420 games with
  reported characters, 85 distinct characters. Plus a Melee top-10 from 57 events.
- Winners merged by start.gg player id across alias/sponsor changes.
  Nights-attended ranking from full Ultimate and Melee entrant lists, one per player per night
  (489 distinct players).
- Page also has rivalries from every singles set (a checkbox narrows them
  to sets with characters reported), top-4 consistency and recent form, favourites and
  upsets, year-over-year retention, seasonality, character
  usage with 95% ranges, character matchups, loyalty tiers, return rates,
  cumulative player growth and a Buffalo card for players in both series.

## Data files

- `data/tournaments.json/.csv`: all 183 tournaments + Ultimate winner
- `data/standings-ultimate.json`: top 4 of each Ultimate event
- `data/winners.json/.csv`: wins/podiums per player, signature character
- `data/characters.json/.csv`: games + game-wins per character
- `data/matchups.json/.csv`: character vs character game records (every pair with a reported game)
- `data/head-to-head.json/.csv`: player rivalries from every completed singles set, with games won from reported set scores
- `data/podium-rates.json/.csv`: top-4 and title rates over nights entered
- `data/favourites.json`: favourites, upsets, first-time champions and title spread
- `data/seasonality.json/.csv`: tournaments and average attendance by month of year
- `data/retention.json/.csv`: loyalty tiers, histogram, return rates, newcomers by year, cumulative players
- `data/cross-series.json/.csv`: players entered in both series, combined events and wins
- `data/charts-data.json`: arrays backing the charts

## Rebuild

Research scrape lives in `../research_notes/monday-night-smashball/`
(`tournaments.json`, `tournaments-events.json`, `standings.json`,
`chars-by-event.jsonl`). To regenerate this folder:

```sh
node monday-night-smashball/build.mjs
```

To re-scrape start.gg (needs STARTGG_TOKEN in .env), see the scripts in
your temp dir: mnsg-step1/2/3/4u/scan/update (owner + NY date-chunk scan,
events, standings, character games).
