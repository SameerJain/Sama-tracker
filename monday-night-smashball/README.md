# Monday Night SmashBall @ Heart of the Game — Ultimate stats

View: open `index.html` in a browser (double-click). No server, no build, no internet needed.
Charts are static SVGs in `images/`, raw numbers in `data/` (JSON + CSV).

## What's inside

- 182 tournaments at 85 S Rossler Ave, Buffalo, NY (series numbers 1–183).
  Numbering quirks found by scraping: #59 was skipped (58 → 60), #56 ran as
  "Lights Out", #67 ran unnumbered (2024-06-17), #69 ran as "69.0+1.0",
  #96 ran twice (96 and 96/2 on 2025-01-06), #146 ran as "SmashBall 146
  Holiday Party" (no "Monday" in the name). #72 came from a fourth TO.
- Largest: Monday Night SmashBall 100 $100 POT BONUS @ Heart Of The Game, 58 attendees, 2025-02-03.
- Ultimate only: 180 Ultimate Singles events, 8,206 sets, 4,333 games with
  reported characters, 85 distinct characters. Plus a Melee top-10 from 57 events.
- Winners merged by start.gg player id across alias/sponsor changes.
  Events-entered ranking from full entrant lists (434 distinct players).

## Data files

- `data/tournaments.json/.csv` — all 182 tournaments + Ultimate winner
- `data/standings-ultimate.json` — top 4 of each Ultimate event
- `data/winners.json/.csv` — wins/podiums per player, signature character
- `data/characters.json/.csv` — games + game-wins per character
- `data/charts-data.json` — arrays backing the charts

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
