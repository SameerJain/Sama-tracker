# UB Smash Royale — stats

View: open `index.html` in a browser (double-click). No server, no build, no internet needed.
Charts are static SVGs in `images/`, raw numbers in `data/` (JSON + CSV).

## What's inside

- 48 tournaments (series numbered 1–49; #13 skipped over summer 2024).
- Largest: Smash Royale #1 - UB Smash Club, 65 attendees, 2023-09-06.
- Winners merged by start.gg player id across alias/sponsor changes.
- Events-entered ranking from full Ultimate entrant lists (271 distinct players).
- Redemption bracket ranked separately (29 events).

## Data files

- `data/tournaments.json/.csv` — all 48 tournaments + winners
- `data/standings.json` — top 4 of each event (Ultimate, Redemption, Melee)
- `data/winners.json/.csv` — wins/podiums per player
- `data/charts-data.json` — arrays backing the charts

## Rebuild

Research scrape lives in `../research_notes/ub-smash-royale/`
(`royale-all.json`, `tournaments-events.json`, `standings.json`).
To regenerate this folder:

```sh
node ub-smash-royale/build.mjs
```
