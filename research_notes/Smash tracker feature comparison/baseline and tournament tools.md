# Baseline and adjacent tournament Discord tools

## What does Sama-tracker already have?

### Takeaway
The bot already covers most obvious player-following basics, including the next opponent. The useful gaps are delivery and organization of information, rather than another generic results or reminder command. Checked against the local source on 2026-10-18; no live tokens, state, bot process, or production requests were used.

### Cited Findings
- Tracking and linked lookups are separate; set-result and stream-alert switches are per tracked player. Existing commands include `/upcoming`, `/recent`, `/run`, stats, H2H, predictions, scouting, character and stage history, progress, registration reminders, registrations, bracket links, socials, and message controls. Automatic posts cover sets, streams, roll calls, placements, registration, and a scheduled weekly recap. [README](/C:/Users/samee/Desktop/Sama-tracker/README.md:25), [automatic posts](/C:/Users/samee/Desktop/Sama-tracker/README.md:101).
- `/run` already fetches every current event's sets and presents the player's run and next opponent; the renderer distinguishes playing, called, queued, ready, and waiting states, ordered `[2, 6, 7, 4, 1]`. Do not recommend “next opponent” as wholly missing. [handler](/C:/Users/samee/Desktop/Sama-tracker/src/commands/players.js:197), [renderer](/C:/Users/samee/Desktop/Sama-tracker/src/embeds/tournaments.js:278).
- `/upcoming` already lists events the tracked or linked player entered, including a crew-wide view; it is not a broad geographic tournament discovery tool. The registered-player lookup drives it. [handler](/C:/Users/samee/Desktop/Sama-tracker/src/commands/players.js:129), [query](/C:/Users/samee/Desktop/Sama-tracker/src/startgg.js:576).
- `/reg_role` already creates/assigns the **Reg Reminders** role. Missing roles would be event participant, game, or ranking roles, not role support generally. [implementation](/C:/Users/samee/Desktop/Sama-tracker/src/commands/registration.js:158).
- Stream alerts already cover called sets and the next stream-queue set, and the stream queue is queried only for relevant live tournaments. Match-ready alerts for ordinary off-stream sets would be new. [stream lookup](/C:/Users/samee/Desktop/Sama-tracker/src/startgg.js:525), [tracker](/C:/Users/samee/Desktop/Sama-tracker/src/tracker.js:265).
- Startup selects one guild and one posting channel; the tracker posts there. A source search found no tournament-thread creation, scheduled-event creation, player DMs, leaderboard/export command, stage-striking workflow, or bracket-writing mutations. This is a conservative inventory of the current source, not proof against every possible undocumented behavior. [startup](/C:/Users/samee/Desktop/Sama-tracker/src/index.js:14), [command inventory](/C:/Users/samee/Desktop/Sama-tracker/src/commands/definitions.js:28), [persistent schema](/C:/Users/samee/Desktop/Sama-tracker/src/store.js:8).

### Inferences
- The strongest additions keep start.gg authoritative and reuse information the bot already reads. Tournament administration would change the product's purpose.

### Gaps
- No production behavior was tested. No claim is made that every externally readable bot is currently deployed or accepting invites.

## Which adjacent Discord tournament tools offer useful precedents?

### Takeaway
Tourney Bot and auTO are good feature references, but they run tournaments rather than primarily follow players. They support selective borrowing of threads, calendar entries, and match notifications, not replacement of Sama-tracker with a tournament platform.

### Cited Findings
- **Tourney Bot:** official commands document match threads with live-match pings, player scoring, check-in, disputes, Discord server-event creation (`/event`), tournament-linked leaderboards, ranking roles, and CSV leaderboard export. Its tournament discovery page has bracket/status/region filters. These are documented capabilities; hosting availability and each feature's plan entitlement were not tested. [Official commands](https://tourneybot.gg/commands), [discovery](https://tourneybot.gg/tournaments).
- **Historical scope for Tourney Bot:** an official 2023-10-19 article documents bracket types. Its Discord support community was created in 2017, which dates that community, not necessarily the present feature set. [Official 2023 documentation](https://docs.tourneybot.gg/blog/2023/10/19/bracket-types), [official Discord listing](https://discord.com/servers/285894122349527040).
- **auTO:** an open-source Challonge netplay tournament bot whose README lists match pings, private text/voice rooms, self-reported scores, a TO-triggered no-show DQ timer, and RPS to decide who strikes first. It lists several Melee communities as users. GitHub marks the repository archived on 2023-06-20. It is a historical design precedent, not a verified currently running alternative. Its RPS feature should not be described as a full stage-striking system. [Author's repository and README](https://github.com/mtimkovich/auTO).
- **Challonge's Discord integrations:** a dated 2021 official article described both Tournament Kings integration and a Premier Discord bot for community announcements, event developments, and match reminders. This is historical evidence; it does not establish present pricing or uninterrupted service. It overlaps Tourney Bot's ecosystem rather than providing another independent player-following competitor. [Challonge, July 12, 2021](https://foo.challonge.com/2021/07/12/how-to-create-your-own-community-on-challonge/).

### Inferences
- Tourney Bot's `/event` is the cleanest small feature to borrow: a selected start.gg tournament could become a Discord Scheduled Event that members can find and subscribe to.
- auTO's match pings show a player convenience gap: Sama-tracker currently tells you when asked through `/run`, but does not automatically notify you that an off-stream match is called.
- Match rooms are appropriate for a tournament organizer. One thread per tournament is the smaller and better-fitting adaptation for a crew-following bot.

### Gaps
- A proposed Braacket Discord integration was not verified in primary documentation; omit it as a bot integration unless another researcher provides evidence. Braacket's web rankings are a separate comparison.
- Dragora's search-index text advertised start.gg operations, but the actual site timed out; omit it rather than treating a snippet as verified functionality.
- No robust documented candidate in this research established automated Smash stage striking in Discord. Do not elevate auTO's RPS into that claim.

## What additions fit this bot, and what are their limits?

### Takeaway
Prioritize a selected-tournament calendar entry, tournament threads, and optional personal match alerts. A leaderboard can be useful if its scoring rule is explicit; full registration, score-reporting, check-in, and DQ management are a different and much larger product.

### Cited Findings
- start.gg officially limits requests to an average of 80 per 60 seconds and 1,000 returned objects including nesting. The bot already queues requests at 800 ms and favors commands over background traffic. Broad discovery or faster personal alerts must use that queue rather than independent polling. [Official limits](https://developer.start.gg/docs/rate-limits/), [queue](/C:/Users/samee/Desktop/Sama-tracker/src/startgg.js:15).
- The bot's set reads already contain entrant IDs, player IDs, state, event, and round. `getSets` accepts states; `getRunSets` reads the current bracket. Identity matching already checks the Discord connection on start.gg. These are usable foundations for optional match notifications. [sets](/C:/Users/samee/Desktop/Sama-tracker/src/startgg.js:178), [filter](/C:/Users/samee/Desktop/Sama-tracker/src/startgg.js:249), [run query](/C:/Users/samee/Desktop/Sama-tracker/src/startgg.js:319), [identity check](/C:/Users/samee/Desktop/Sama-tracker/src/accounts.js:48).
- start.gg's Set schema exposes `station`, `startAt`, and `vodUrl`, which are absent from the bot's general set fields. These are feasible optional enrichments when populated, not a guarantee that tournament organizers supply the data. [Official schema reference](https://developer.start.gg/reference/set.doc/), [current fields](/C:/Users/samee/Desktop/Sama-tracker/src/startgg.js:183).
- Discord external Scheduled Events require a location and end time; creating them needs `CREATE_EVENTS`. A guild may have at most 100 active or scheduled events. This makes explicitly selected or thresholded crew events preferable to publishing every imported attendee's tournament. [Discord event API](https://docs.discord.com/developers/resources/guild-scheduled-event).
- Discord threads need thread-specific creation and sending permissions, and archived or locked threads have lifecycle restrictions. Existing plain-channel sending permissions are insufficient by themselves. [Discord thread API](https://docs.discord.com/developers/topics/threads).
- start.gg offers a report-set mutation. Presence of that API does not establish that the bot's current token may report arbitrary participants' scores. Administrative permission and account authorization would require separate investigation before building tournament-write commands. [Official mutation example](https://developer.start.gg/docs/examples/mutations/report-set/).

### Inferences

Scope labels below are engineering estimates, not measured schedules. “Small” assumes an explicit command and few persisted identifiers; automation, configuration and recovery make it medium.

| Candidate | Existing baseline | True addition | Fit / rough scope | Main limit |
| --- | --- | --- | --- | --- |
| Add a known tournament to Discord Events | Upcoming/registration and tournament dates | `/calendar add` or button for one selected event | **High; small–medium** | `CREATE_EVENTS`; update/cancel changed dates; save the Discord event ID to avoid duplicate events. [Discord API](https://docs.discord.com/developers/resources/guild-scheduled-event) |
| One discussion/feed thread per tournament | All automatic reports use the configured channel | Route that tournament's stream/results posts to its saved thread | **High if channel volume is annoying; medium** | Thread permissions, deleted/archived threads, fallback behavior. Saves channel clutter without bracket administration. [Discord API](https://docs.discord.com/developers/topics/threads) |
| Opt-in called/ready-set alert | `/run` shows next opponent; stream posts cover on-stream sets | Notify a linked player when an ordinary match becomes callable/ready | **Medium–high; medium** | Must distinguish called/ready from merely assigned, retain one send marker per set/person, handle failed DMs or use an explicitly selected in-server destination, and accept polling delay. No “never miss a DQ” promise. [baseline run states](/C:/Users/samee/Desktop/Sama-tracker/src/embeds/tournaments.js:278), [queue](/C:/Users/samee/Desktop/Sama-tracker/src/startgg.js:15) |
| Station/time on `/run` | Round and opponent already shown | Show station and scheduled time only when supplied | **High; small** | Additional fields/object count; missing or stale organizer data. [schema](https://developer.start.gg/reference/set.doc/) |
| VOD link on completed-set/report cards | Stream links and set links | Link a reported VOD directly | **High; small** | `vodUrl` is optional and does not supply automatic YouTube search or timestamps. [schema](https://developer.start.gg/reference/set.doc/) |
| Crew leaderboard plus CSV | Individual stats, progress, weekly recap | Compare the crew across a selected season; export rows | **Medium; medium** | Define metric and coverage. Win percentage favors easier/smaller brackets; a ranking should not imply an objective regional PR. Tourney Bot has this precedent. [commands](https://tourneybot.gg/commands) |
| Regional/game event discovery | Upcoming entries/reminder tournaments only | Find tournaments nobody in the crew has entered yet | **Medium; medium** | New start.gg search query/filter validation and caching. Not the same as another `/upcoming` view. [baseline](/C:/Users/samee/Desktop/Sama-tracker/src/commands/players.js:129) |
| Auto assign per-event roles | One self-selected registration role | Participant/game roles and removal when event finishes | **Low–medium; medium** | Role sprawl, event lifecycle, authorization and Discord-linked accounts. Better justified for a recurring local than all tracked tournaments. [existing role](/C:/Users/samee/Desktop/Sama-tracker/src/commands/registration.js:158) |
| Score reporting, check-in, no-show DQs, private match rooms | Read-oriented following/reporting | Tournament administration and bracket mutations | **Low for present purpose; large** | Event ownership, authorization, disputes, tournament rules and recovery. Use/borrow a dedicated TO tool if actually hosting events. [auTO](https://github.com/mtimkovich/auTO), [start.gg mutation](https://developer.start.gg/docs/examples/mutations/report-set/) |

### Gaps
- No live query validated station/VOD completeness or tournament-search filters. Missing data should stay unknown, as the README already requires.
- Native calendar synchronization and reliable personal alerts need lifecycle/deduplication design; they are not one-line wrappers around a Discord send.
- New commands and user-visible behavior must still follow this repository's code, option text, help, README and test requirements. This research changed no app code and ran no bot startup.
