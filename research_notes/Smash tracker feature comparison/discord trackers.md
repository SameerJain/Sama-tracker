# Discord trackers most similar to Sama-tracker

Research checked 2026-10-18. This is a feature comparison, not a recommendation to switch bots. The local baseline is [README.md](../../README.md): persistent player tracking, set/placement posts, stream alerts, registration reminders, account linking, stats, h2h, prediction, scouting, character/stage reports, progress, and weekly recaps. No broad popularity claims were independently verified or used.

## Which historical and current Discord projects are closest?

### Takeaway

Tournify is the strongest historical precedent for a player/event result feed. Setbot is the closest current stream-following precedent. Result-Bot and start.gg Event Adder are narrower companions whose distinctive features transfer well to this project.

### Cited Findings

#### 1. Tournify Discord Bot — Migwel / author account Mig_Well

- The author announced the tracker on **2019-12-28**, describing live smash.gg tournament updates in Discord, optional filtering to particular players, and Challonge support. This author post links directly to the repository. — [Author launch post](https://www.reddit.com/r/smashbros/comments/egvr2j/i_made_a_tournament_tracker_discord_bot/)
- `subscribe tournamentUrl (player)` follows one event's results, with all entrants by default or a named player. `participants tournamentUrl` returns the event's entrant list. The README names smash.gg, Challonge and chess.com as supported hosts; it explicitly says supplying a list of multiple players was **not yet implemented**. — [Author repository README](https://github.com/Migwel/tournify_discord_bot#commands)
- Tournify's underlying service clarifies that a smash.gg "tournament" subscription means an individual **event** (e.g. Melee singles), rather than every event at Genesis. — [Tournify service README](https://github.com/Migwel/Tournify#supported-tournament-hosts)
- Historical status: the repository was created 2019-10-27. Latest default-branch commit is dated **2021-12-14**, a dependency update. The README calls the bot alpha. This is evidence of a historical implementation, **not confirmation the hosted bot still works**. Repository `pushed_at` is later and should not be presented as a later feature release. — [GitHub repository metadata](https://api.github.com/repos/Migwel/tournify_discord_bot), [Latest default-branch commit metadata](https://api.github.com/repos/Migwel/tournify_discord_bot/commits/a9f7d3737c25126d571825a96e05245456aa59a9), [README](https://github.com/Migwel/tournify_discord_bot)
- **Overlap:** automated set results for chosen players. **Documented difference:** subscribe to an entire event without permanently tracking every player; follow other bracket providers. These capabilities are absent from Sama's documented commands. — [Tournify commands](https://github.com/Migwel/tournify_discord_bot#commands), [Local baseline](../../README.md)

#### 2. Setbot / Smash Radar — Math (@mathssbm), source owner jmarquis

- The official page credits **Math**, links to @mathssbm, and links its open source website to `jmarquis/smashevents`. This is the **Smash/Rivals stream notifier**, not the unrelated Discord SET card-game bot also named setbot. — [Official Setbot page](https://smashradar.com/setbot), [Linked source repository](https://github.com/jmarquis/smashevents)
- `/subscribe` follows a player's streamed sets in the channel where it is run; setup optionally selects a **Discord role to ping for each set announcement**. The page says data primarily comes from start.gg and currently documents Twitch streams only. — [Official setup and limitations](https://smashradar.com/setbot)
- The implementation keys subscriptions by player, server and channel; it supports a tag search with player-selection UI as well as a start.gg profile link. The notification code also checks `entrant.player2`, demonstrating doubles-aware player subscriptions. — [Setbot implementation](https://github.com/jmarquis/smashevents/blob/main/app/lib/setbot.rb)
- Date/status evidence: the public Setbot page was added **2025-04-18**; role-ping documentation changed 2025-04-24. The parent Smash Radar repository's latest default-branch commit is **2026-10-17**. A readable invite page and recent project commits indicate a currently maintained project, but no live Discord install/notification was tested. Do **not** call the parent repository's June 2024 creation date Setbot's launch date. — [Page introduction](https://github.com/jmarquis/smashevents/commit/551d2ae4d3d0ab5db25550b2900fb55e0aecb04a), [Role-ping note](https://github.com/jmarquis/smashevents/commit/be86b411562265c650691b456824614192239f77), [Latest commit metadata](https://api.github.com/repos/jmarquis/smashevents/commits/8a4a169de0509401c83a180d8aaac297e3d92ba4)
- **Overlap:** player stream alerts. **Documented difference:** per-channel subscriptions and configurable fan-role pings; search for previously unknown players by tag. Sama is deliberately one channel, documents profile URLs/IDs for adding previously unknown players, and does not ping names in stream posts. Doubles support warrants a code check by the coordinator before being listed as a confirmed Sama gap. — [Setbot source](https://github.com/jmarquis/smashevents/blob/main/app/lib/setbot.rb), [Local baseline](../../README.md)

#### 3. Results Bot (repository Result-Bot) — jamespericles

- Built for the Alulu local Smash Ultimate scene and generalized for deployment to another scene, it fetches results the day after an event, posts the top eight in Discord, and uses the **Top8er API to generate a top-eight graphic** alongside the placements message. — [Author README](https://github.com/jamespericles/Result-Bot#description)
- `/get_event_standing` retrieves a numbered weekly event, accepts the number of placements, and defaults to the top three. Top8er integration requires contacting its author for the API URI and permission; the README does not promise a public unrestricted endpoint. — [Commands and installation](https://github.com/jamespericles/Result-Bot#additional-functionality)
- Date/status evidence: created **2023-06-15**, latest default-branch commit **2024-05-08**. The historical README says it was deployed for local scenes; current live hosting was not tested. — [Repository metadata](https://api.github.com/repos/jamespericles/Result-Bot), [Latest commit metadata](https://api.github.com/repos/jamespericles/Result-Bot/commits/8c585812937b84b3c1a3387c3bf42482bbf72605)
- **Overlap:** automatic local-event placement posts. **Documented difference:** shareable top-eight image and on-demand event standings beyond tracked players. Sama's posts cover the tracked crew; its README has no general event standings command or standings-image generation. — [Results Bot README](https://github.com/jamespericles/Result-Bot), [Local baseline](../../README.md)

#### 4. start.gg Event Adder Discord Bot — kequach

- This narrowly scoped bot discovers upcoming tournaments by country and game, then creates **native Discord scheduled events** with actual tournament start/end times, games, venue, stream links, and a start.gg link. It runs twice daily and checks existing event names to avoid duplicates. — [Author README](https://github.com/kequach/start.gg-event-adder#features)
- Its documented default is German Melee events; the README describes configurable country and multiple game IDs. It advertises an official hosted invite, which is not proof of ongoing operation. — [Configuration and hosted invite](https://github.com/kequach/start.gg-event-adder)
- Date/status evidence: repository created and latest default-branch commit both **2025-10-07**. Treat this as an available open source implementation with an advertised hosted version, rather than a verified active service. — [Repository metadata](https://api.github.com/repos/kequach/start.gg-event-adder), [Latest commit metadata](https://api.github.com/repos/kequach/start.gg-event-adder/commits/fc82cb42d571057be99d393c52cc19e7942237c9)
- **Overlap:** tournament discovery/visibility and reminders. **Documented difference:** native server calendar events, plus discovery before anyone in the tracked crew registers. Sama's `/upcoming` and reminders do not create Discord scheduled events. — [Event Adder behavior](https://github.com/kequach/start.gg-event-adder#how-it-works), [Local baseline](../../README.md)

### Inferences

- These projects do not establish that Sama lacks player stats, h2h or recaps: Sama already provides all three, with substantially broader documented analysis than these narrow trackers. Their useful additions concern notification control, temporary tournament scope, discovery/calendar integration and presentation.
- A single-channel design means Setbot's arbitrary channel routing is only valuable if the owner wants to broaden the project. Its optional role ping is independently useful in one channel.

### Gaps

- No hosted bot was installed or tested; uptime, invitation success, notification latency and long-term accuracy remain unverified.
- Found no reliable relevant SmasherBot evidence. Search results for that spelling were unrelated; do not include a guessed product.
- TournaBot is relevant to tournament-start reminders and DQ calling but belongs to the coordinator's separate tournament-operations research. [Repository](https://github.com/Ayaan-Govil/TournaBot)

## Which missing features are most worth adapting?

### Takeaway

The strongest additions within Sama's current purpose are opt-in stream-role pings, temporary event subscriptions, and native Discord calendar entries. Graphics and broader discovery are useful second steps; cross-provider support requires more maintenance.

### Cited Findings

- **Stream-role pings:** Setbot supplies a role picker specifically for fans following a player's streamed sets. — [Official Setbot setup](https://smashradar.com/setbot)
- **Temporary event watching:** Tournify subscribes to the results of one selected event, optionally for one entrant. — [Tournify commands](https://github.com/Migwel/tournify_discord_bot#commands)
- **Native calendar entries and location/game discovery:** Event Adder creates Discord scheduled events from upcoming start.gg tournaments selected by country/game. — [Event Adder documentation](https://github.com/kequach/start.gg-event-adder#how-it-works)
- **Shareable results graphics:** Results Bot generates a top-eight image, while also providing a configurable number of placements for one weekly event. — [Results Bot description and commands](https://github.com/jamespericles/Result-Bot)

### Inferences

- **High fit, modest scope:** allow a player to opt into a stream-alert role, explicitly configured by an admin, with only that role allowed to be mentioned. This adapts Setbot's fan notification behavior to Sama's one channel; it is separate from Sama's existing registration ping role.
- **High fit, moderate scope:** an event-watch command that expires after final results. Track one bracket or selected entrants for a weekend without adding everyone to permanent `state.players`. Optional "top eight only" or "upsets only" are proposed filters, **not documented Tournify capabilities**.
- **High fit, moderate scope:** create a native Discord scheduled event when a registration reminder is set, then update/cancel it when the source changes. The source examples demonstrate creation, not robust rescheduling/cancellation sync; those are proposed product details.
- **Medium fit:** a requested tournament standings report and optional PNG recap/results card. Start with a fixed local image template; adopting Top8er's private integration is unnecessary until access is confirmed. Template rendering is a recommendation, **not a feature claimed for Result-Bot**.
- **Medium fit:** search for local upcoming events using a configured region/game; surface candidates in a command or digest rather than automatically posting every regional tournament. Event Adder demonstrates country/game filters, not a documented radius search.
- **Lower priority:** Challonge support if the crew actually plays events hosted there. Historical Tournify proves the product idea; it does not prove its older adapters work against today's APIs.

### Gaps

- Implementation effort estimates are comparative judgments, not measured estimates. Native Discord event permissions, start.gg query complexity, polling budgets, and Discord scheduling limits need primary documentation review during design.
- Whether the crew wants fan pings, event-wide feeds, or neighboring-region discovery is unknown. These are candidate additions, not an instruction to implement them.
