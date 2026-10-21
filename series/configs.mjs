// Per-series viewer config for the shared builder in shared/site.mjs.
// Dirs and scrape settings live in series.json; this file is page-only config.
export const VIEWER = {
  'monday-night-smashball': {
    title: 'Monday Night SmashBall @ Heart of the Game',
    extras: ['melee', 'sides'],
    sideGroups: [
      { label: 'Randoms & Squad Strike', cls: 's', re: 'random' },
      { label: 'Rivals of Aether', cls: 'r', re: 'rival' },
      { label: 'Amateur bracket', cls: 'u', re: 'amature' },
      { label: 'Doubles', cls: 'm', re: 'doubles|dubs' },
      { label: 'Smash 4', cls: 's', re: 'smash 4' },
    ],
    allWinners: ['ultimate'],
    allNote: 'Every tournament analyzed, with a link to its start.gg page. Click any header to sort.',
    meleeNote: 'Melee brackets rarely report per-game characters on start.gg, so no character table here — standings only.',
    sidesNote: "Everything that isn't Ultimate or Melee singles. Street Fighter 6 brackets (50 of them) aren't covered here — Smash only.",
    readme: (c) => `# Monday Night SmashBall @ Heart of the Game — Ultimate stats

View: open \`index.html\` in a browser (double-click). No server, no build, no internet needed.
Charts are static SVGs in \`images/\`, raw numbers in \`data/\` (JSON + CSV).

## What's inside

- 182 tournaments at 85 S Rossler Ave, Buffalo, NY (series numbers 1–183).
  Numbering quirks found by scraping: #59 was skipped (58 → 60), #56 ran as
  "Lights Out", #67 ran unnumbered (2024-06-17), #69 ran as "69.0+1.0",
  #96 ran twice (96 and 96/2 on 2025-01-06), #146 ran as "SmashBall 146
  Holiday Party" (no "Monday" in the name). #72 came from a fourth TO.
- Largest: ${c.top.name}, ${c.top.attendees} attendees, ${c.top.date}.
- Ultimate only: ${c.ultEvents} Ultimate Singles events, ${c.totalSets.toLocaleString('en-US')} sets, ${c.totalGames.toLocaleString('en-US')} games with
  reported characters, ${c.charCount} distinct characters. Plus a Melee top-10 from ${c.meleeEvents} events.
- Winners merged by start.gg player id across alias/sponsor changes.
  Events-entered ranking from full entrant lists (${c.enteredCount} distinct players).

## Data files

- \`data/tournaments.json/.csv\` — all 182 tournaments + Ultimate winner
- \`data/standings-ultimate.json\` — top 4 of each Ultimate event
- \`data/winners.json/.csv\` — wins/podiums per player, signature character
- \`data/characters.json/.csv\` — games + game-wins per character
- \`data/charts-data.json\` — arrays backing the charts

## Rebuild

Research scrape lives in \`../research_notes/monday-night-smashball/\`
(\`tournaments.json\`, \`tournaments-events.json\`, \`standings.json\`,
\`chars-by-event.jsonl\`). To regenerate this folder:

\`\`\`sh
node monday-night-smashball/build.mjs
\`\`\`

To re-scrape start.gg (needs STARTGG_TOKEN in .env), see the scripts in
your temp dir: mnsg-step1/2/3/4u/scan/update (owner + NY date-chunk scan,
events, standings, character games).
`,
  },
  'ub-smash-royale': {
    title: 'UB Smash Royale',
    academic: true,
    extras: ['redemption'],
    allWinners: ['ultimate', 'redemption', 'melee'],
    allNote: 'Every tournament analyzed, with a link to its start.gg page. Click any header to sort. Melee ran only at #47–#49 (Stampede, Singles, Singles).',
    readme: (c) => `# UB Smash Royale — stats

View: open \`index.html\` in a browser (double-click). No server, no build, no internet needed.
Charts are static SVGs in \`images/\`, raw numbers in \`data/\` (JSON + CSV).

## What's inside

- 48 tournaments (series numbered 1–49; #13 skipped over summer 2024).
- Largest: ${c.top.name}, ${c.top.attendees} attendees, ${c.top.date}.
- Winners merged by start.gg player id across alias/sponsor changes.
- Events-entered ranking from full Ultimate entrant lists (${c.enteredCount} distinct players).
- Redemption bracket ranked separately (${c.redemptionEvents} events).

## Data files

- \`data/tournaments.json/.csv\` — all 48 tournaments + winners
- \`data/standings.json\` — top 4 of each event (Ultimate, Redemption, Melee)
- \`data/winners.json/.csv\` — wins/podiums per player
- \`data/charts-data.json\` — arrays backing the charts

## Rebuild

Research scrape lives in \`../research_notes/ub-smash-royale/\`
(\`royale-all.json\`, \`tournaments-events.json\`, \`standings.json\`).
To regenerate this folder:

\`\`\`sh
node ub-smash-royale/build.mjs
\`\`\`
`,
  },
};
