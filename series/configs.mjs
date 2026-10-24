// what each series page says and shows. folders and scrape settings are in series.json
export const VIEWER = {
  'monday-night-smashball': {
    title: 'Monday Night SmashBall @ Heart of the Game',
    short: 'MNSB',
    extras: ['melee', 'sides'],
    sideGroups: [
      { label: 'Randoms & Squad Strike', cls: 's', re: 'random' },
      { label: 'Rivals of Aether', cls: 'r', re: 'rival' },
      { label: 'Amateur bracket', cls: 'u', re: 'amature|amateur' },
      { label: 'Doubles', cls: 'm', re: 'doubles|dubs' },
      { label: 'Smash 4', cls: 's', re: 'smash 4' },
    ],
    allWinners: ['ultimate'],
    allNote: 'Every tournament analyzed, with a link to its start.gg page. Click any header to sort.',
    meleeNote: 'Melee brackets rarely report per-game characters on start.gg, so there is no character table here, only standings.',
    sidesNote: "Everything that isn't Ultimate or Melee singles. Street Fighter 6 brackets (50 of them) aren't covered here, since this is Smash only.",
    readme: (c) => `# Monday Night SmashBall @ Heart of the Game: Ultimate stats

View: open \`index.html\` in a browser (double-click). No server, no build, no internet needed.
Charts are static SVGs in \`images/\`, raw numbers in \`data/\` (JSON + CSV).

## What's inside

- ${c.n} tournaments at 85 S Rossler Ave, Buffalo, NY (series numbers 1–183).
  Numbering quirks found by scraping: #59 was skipped (58 → 60), #56 ran as
  "Lights Out", #67 ran unnumbered (2024-06-17), #69 ran as "69.0+1.0",
  #96 ran twice (96 and 96/2 on 2025-01-06), #146 ran as "SmashBall 146
  Holiday Party" (no "Monday" in the name). #72 came from a fourth TO.
- Largest: ${c.top.name}, ${c.top.attendees} attendees, ${c.top.date}.
- Ultimate only: ${c.ultEvents} Ultimate Singles events, ${c.totalSets.toLocaleString('en-US')} sets, ${c.totalGames.toLocaleString('en-US')} games with
  reported characters, ${c.charCount} distinct characters. Plus a Melee top-10 from ${c.meleeEvents} events.
- Winners merged by start.gg player id across alias/sponsor changes.
  Nights-attended ranking from full Ultimate and Melee entrant lists, one per player per night
  (${c.enteredCount} distinct players).
- Page also has rivalries from every singles set (a checkbox narrows them
  to sets with characters reported), top-4 consistency and recent form, favourites and
  upsets, year-over-year retention, seasonality, character
  usage with 95% ranges, character matchups, loyalty tiers, return rates,
  cumulative player growth and a Buffalo card for players in both series.

## Data files

- \`data/tournaments.json/.csv\`: all ${c.n} tournaments + Ultimate winner
- \`data/standings-ultimate.json\`: top 4 of each Ultimate event
- \`data/winners.json/.csv\`: wins/podiums per player, signature character
- \`data/characters.json/.csv\`: games + game-wins per character
- \`data/matchups.json/.csv\`: character vs character game records (every pair with a reported game)
- \`data/head-to-head.json/.csv\`: player rivalries from every completed singles set, with games won from reported set scores
- \`data/podium-rates.json/.csv\`: top-4 and title rates over nights entered
- \`data/favourites.json\`: favourites, upsets, first-time champions and title spread
- \`data/seasonality.json/.csv\`: tournaments and average attendance by month of year
- \`data/retention.json/.csv\`: loyalty tiers, histogram, return rates, newcomers by year, cumulative players
- \`data/cross-series.json/.csv\`: players entered in both series, combined events and wins
- \`data/charts-data.json\`: arrays backing the charts

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
    short: 'Royale',
    academic: true,
    extras: ['redemption'],
    allWinners: ['ultimate', 'redemption', 'melee'],
    allNote: 'Every tournament analyzed, with a link to its start.gg page. Click any header to sort. Off-week club nights count for attendance, seasonality and crowds, but not for Ultimate winners or matchups; a redemption winner is shown only where an off week ran a redemption bracket. Melee ran only at #47–#49 (Stampede, Singles, Singles).',
    readme: (c) => `# UB Smash Royale stats

View: open \`index.html\` in a browser (double-click). No server, no build, no internet needed.
Charts are static SVGs in \`images/\`, raw numbers in \`data/\` (JSON + CSV).

## What's inside

- ${c.n} tournaments: ${c.numbered} numbered (series numbered 1–49; #13 skipped over summer 2024)
  plus ${c.offweeks} off-week club nights in between them during term. The off weeks
  count for attendance, seasonality, crowds and loyalty, but not for Ultimate
  winners or matchups; they join the redemption ranking only where one of them
  ran a redemption bracket that reported standings. The toggle at the top of
  the page switches the whole dataset between that view and on weeks only
  (\`on-weeks-only.html\`); winners and matchups are on weeks only in both.
- Largest: ${c.top.name}, ${c.top.attendees} attendees, ${c.top.date}.
- Winners merged by start.gg player id across alias/sponsor changes.
- Nights-attended ranking from full Ultimate and Melee entrant lists plus the
  off-week brackets, one per player per night (${c.enteredCount} distinct players).
- Redemption bracket ranked separately (${c.redemptionEvents} events).
- Page also has rivalries from every singles set (a switch narrows them
  to sets with characters reported, and an Include off weeks toggle adds the
  off-week nights' singles brackets on top of either), top-4 consistency and
  recent form, favourites and upsets, school-year retention, seasonality, character usage
  with 95% ranges, character matchups, loyalty tiers, return rates, cumulative
  player growth and a Buffalo card for players in both series.

## Data files

- \`data/tournaments.json/.csv\`: all ${c.n} tournaments + winners
- \`data/standings.json\`: top 4 of each event (Ultimate, Redemption, Melee)
- \`data/winners.json/.csv\`: wins/podiums per player
- \`data/matchups.json/.csv\`: character vs character game records (every pair with a reported game)
- \`data/head-to-head.json/.csv\`: player rivalries from every completed singles set, with games won from reported set scores
- \`data/podium-rates.json/.csv\`: top-4 and title rates over nights entered
- \`data/favourites.json\`: favourites, upsets, first-time champions and title spread
- \`data/seasonality.json/.csv\`: tournaments and average attendance by month of year
- \`data/retention.json/.csv\`: loyalty tiers, histogram, return rates, newcomers by year, cumulative players
- \`data/cross-series.json/.csv\`: players entered in both series, combined events and wins
- \`data/charts-data.json\`: arrays backing the charts

## Rebuild

Research scrape lives in \`../research_notes/ub-smash-royale/\`
(\`royale-all.json\`, \`tournaments-events.json\`, \`standings.json\`,
\`attendance-offweek.json\`, \`offweek-tournaments.json\`, and
\`offweek-chars-by-event.jsonl\` for the off-week singles sets).
To regenerate this folder:

\`\`\`sh
node ub-smash-royale/build.mjs
\`\`\`
`,
  },
};

// the third link in every series switcher: Samatracker, a static page with
// both series plus web versions of the bot's lookup commands. url is its
// Vercel address; empty means the switcher links at the hub relatively
// (works for local double-click viewing)
export const HUB = {
  title: 'Samatracker',
  short: 'Samatracker',
  url: 'https://samatracker.vercel.app',
  outDir: 'web',
};
