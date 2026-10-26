// /help, in src/embeds/system.js. the full list is the reference, so every line keeps all its detail
export default {
  'Sama-tracker': 'Sama-tracker',
  // the short card
  '**Start here**': '**Empieza aquí**',
  '`/link` tie your Discord to your start.gg, nothing gets posted. Leaving `player` out looks you up':
    '`/link` vincula tu Discord con tu start.gg, sin publicar nada. Dejar `player` vacío te busca a ti',
  '`/track add` post your placements here. TOs can add anyone': '`/track add` publica aquí tus posiciones. Los TOs pueden agregar a cualquiera',
  '`/notify` pings for match calls, next opponents, streams, reg reminders and 1-hour DMs':
    '`/notify` pings de llamados de partida, próximos rivales, streams, recordatorios de inscripción y DMs 1 hora antes',
  '`/help verbose:True` the full list with the details': '`/help verbose:True` la lista completa con los detalles',
  '**Look up stats**': '**Consulta estadísticas**',
  '`/stats` record and placements · `/recent` latest sets · `/run` current run and next opponent':
    '`/stats` récord y posiciones · `/recent` últimos sets · `/run` recorrido actual y próximo rival',
  '`/h2h opponent:` record and one-line odds · `/predict opponent:` odds and why':
    '`/h2h opponent:` historial y probabilidades en una línea · `/predict opponent:` probabilidades y por qué',
  '`/scout opponent:` form and habits · `/progress` last 30 days vs the 30 before':
    '`/scout opponent:` forma y hábitos · `/progress` últimos 30 días contra los 30 anteriores',
  '`/characters` reported characters · `/doubles` 2v2 record · `/upcoming` tournaments':
    '`/characters` personajes reportados · `/doubles` récord en 2v2 · `/upcoming` torneos',
  '**TOs**': '**TOs**',
  '`/t-o role add user:` hand out the TO role · `/t-o role set role:` use an existing role':
    '`/t-o role add user:` da el rol TO · `/t-o role set role:` usa un rol que ya existe',
  '`/t-o tournament event tournament:` make a Discord event · `/track posts` results and alerts on or off':
    '`/t-o tournament event tournament:` crea un evento de Discord · `/track posts` enciende o apaga resultados y avisos',
  '-# TOs can use `/t-o settings`, track, untrack, change posts and set pings for anyone. Until the server has a TO role, Manage Server counts as one':
    '-# Los TOs pueden usar `/t-o settings`, seguir y dejar de seguir, y cambiar publicaciones y pings de cualquiera. Mientras el servidor no tenga rol TO, Gestionar servidor cuenta como uno',
  '**Tournaments**': '**Torneos**',
  '`/registered tournament:` who\'s here · `/reg_warn tournament: user:` nudge the unregistered':
    '`/registered tournament:` quién de aquí va · `/reg_warn tournament: user:` avisa a quien no se ha inscrito',
  '`/bracket` bracket links · `/stream_link` stream links · `/slippi leaderboard` netplay ranks':
    '`/bracket` enlaces de brackets · `/stream_link` enlaces de streams · `/slippi leaderboard` rangos de netplay',
  '`/data` Samatracker and both series data pages': '`/data` Samatracker y las páginas de datos de ambas series',
  '`/t-o settings` what posts here and when · `/status` uptime and last checks':
    '`/t-o settings` qué se publica aquí y cuándo · `/status` tiempo encendido y últimas revisiones',
  '`/matchmaking role game:` get game pings · `/matchmaking search game:` find games':
    '`/matchmaking role game:` recibe pings para jugar · `/matchmaking search game:` busca partidas',
  '-# `/socials` saved links · `/profile` start.gg profiles · `/view_pfp` my picture · `/64` `/melee` `/brawl` `/sm4sh` `/ult` `/pplus` `/bills` for fun':
    '-# `/socials` enlaces guardados · `/profile` perfiles de start.gg · `/view_pfp` mi foto · `/64` `/melee` `/brawl` `/sm4sh` `/ult` `/pplus` `/bills` para divertirse',
  // the full list
  '**General**': '**General**',
  '`/help` this list': '`/help` esta lista',
  '`/status` uptime, when the latest version was deployed, the last start.gg and Slippi checks, and whether start.gg is down':
    '`/status` tiempo encendido, cuándo se publicó la última versión, las últimas revisiones de start.gg y Slippi, y si start.gg está caído',
  '`/data` links to Samatracker and both series data pages: every tournament\'s attendance, winners, who came to the most nights and characters':
    '`/data` enlaces a Samatracker y a las páginas de datos de ambas series: asistencia de cada torneo, ganadores, quién vino a más noches y personajes',
  '`/socials` saved streams and social links': '`/socials` streams y redes guardados',
  '`/socials_edit` add or remove those links. Manage Server by default':
    '`/socials_edit` agrega o quita esos enlaces. Por defecto, con Gestionar servidor',
  '**TO settings**': '**Ajustes de TO**',
  '-# Leave every option blank to see the current settings. Only TOs can change them':
    '-# Deja todas las opciones vacías para ver los ajustes actuales. Solo los TOs pueden cambiarlos',
  '**Tracking players**': '**Seguir jugadores**',
  '`/track add` track yourself, found by the Discord on your start.gg. TOs can add anyone by picking them with `user:` or by start.gg link or ID. Their placements post here':
    '`/track add` agrégate tú, encontrado por el Discord de tu start.gg. Los TOs pueden agregar a cualquiera eligiéndolo con `user:` o por enlace o ID de start.gg. Sus posiciones se publican aquí',
  '`/track remove` stop tracking yourself, or anyone if you\'re a TO. Asks first, then Undo puts them back with their settings for a minute':
    '`/track remove` deja de seguirte, o a cualquiera si eres TO. Pregunta primero, y luego Deshacer lo devuelve con sus ajustes durante un minuto',
  '`/track list` everyone tracked, and the tracked tournaments': '`/track list` todos los jugadores seguidos y los torneos seguidos',
  '`/track posts` your set results and stream alerts on or off. TOs can change anyone\'s, or everyone\'s with `player:all`, which asks first. Anyone can look':
    '`/track posts` enciende o apaga tus resultados de sets y avisos de stream. Los TOs pueden cambiar los de cualquiera, o los de todos con `player:all`, que pregunta primero. Cualquiera puede verlos',
  '`/t-o cleanup` untrack everyone whose start.gg Discord isn\'t in this server. Asks first. TOs only':
    '`/t-o cleanup` deja de seguir a todos los que no tengan su Discord de start.gg en este servidor. Pregunta primero. Solo TOs',
  '`/upcoming` tracked tournaments, and any other with 3 or more of the crew. `player:` checks one person, live from start.gg when linked but not tracked':
    '`/upcoming` torneos seguidos, y cualquier otro con 3 o más de la crew. `player:` revisa a una persona, en vivo desde start.gg si está vinculada pero no la sigo',
  '`/recent` latest sets': '`/recent` últimos sets',
  '`/run` your run and next opponent in each bracket, soonest first, with the station and scheduled time when the TO sets them':
    '`/run` tu recorrido y próximo rival en cada bracket, el más próximo primero, con la estación y la hora programada cuando el TO las pone',
  '-# New players start with set results and stream alerts off. `player:all` works with posts, upcoming and recent. Leaving `player` out means you':
    '-# Los jugadores nuevos empiezan con los resultados de sets y avisos de stream apagados. `player:all` funciona con posts, upcoming y recent. Dejar `player` vacío significa tú',
  '-# Players with no reported sets in 6 months come off the track list on their own':
    '-# Quien pase 6 meses sin sets reportados sale solo de la lista de seguidos',
  '`/t-o role add` give someone the TO role. TOs only': '`/t-o role add` dale a alguien el rol TO. Solo TOs',
  '`/t-o role set` use an existing server role for TO privileges. Needs Manage Server':
    '`/t-o role set` usa un rol que ya exista en el servidor para los permisos de TO. Necesita Gestionar servidor',
  '`/t-o role remove` take the TO role off someone. Refuses to remove the last known TO. TOs only':
    '`/t-o role remove` quítale a alguien el rol TO. No quita al último TO conocido. Solo TOs',
  '`/t-o role list` who the TOs are': '`/t-o role list` quiénes son los TOs',
  '-# TOs can control automatic messages, track, untrack, change posts and set pings for anyone, take anyone off the Slippi watchlist, and use `/t-o tournament` and `/t-o cleanup`. Everyone else only changes their own. Until the server has a TO role, Manage Server counts as one':
    '-# Los TOs manejan las publicaciones automáticas, siguen y dejan de seguir, cambian publicaciones y pings de cualquiera, quitan a cualquiera de la lista de Slippi y usan `/t-o tournament` y `/t-o cleanup`. Los demás solo cambian lo suyo. Mientras el servidor no tenga rol TO, Gestionar servidor cuenta como uno',
  '`/notify` your pings, or anyone\'s for a TO with `user:` or `player:`. `calls` covers match calls, `next` covers next opponents, `streams` covers stream sets, `registration` covers reg reminders, and `dm_registration` and `dm_start` cover 1-hour DMs. `all` changes all six. `player:all` changes everyone tracked and asks first. Leave them out to see yours':
    '`/notify` tus pings, o los de cualquiera para un TO con `user:` o `player:`. `calls` son los llamados de partida, `next` los próximos rivales, `streams` los sets en stream, `registration` los recordatorios de inscripción, y `dm_registration` y `dm_start` los DMs 1 hora antes. `all` cambia los seis. `player:all` cambia a todos los seguidos y pregunta primero. Déjalos vacíos para ver los tuyos',
  '-# Only TOs can see or change someone else\'s with `user:` or `player:`, and only `user:` or `player:`, not both. `calls`, `next` and `streams` need whoever it\'s for linked, or tracked with Discord on start.gg, and only ping where that post is on for the tournament. `registration` pings the Reg Reminders role. Registration DMs skip registered players when start.gg has their Discord. DMs only go to current server members, checked right before each goes out':
    '-# Solo los TOs pueden ver o cambiar los de otra persona con `user:` o `player:`, y solo uno de los dos, no ambos. `calls`, `next` y `streams` necesitan que esa persona esté vinculada, o seguida con Discord en start.gg, y solo dan ping donde esa publicación está encendida para el torneo. `registration` da ping al rol Reg Reminders. Los DMs de inscripción se saltan a quien ya está inscrito cuando start.gg tiene su Discord. Los DMs solo llegan a quien sigue en el servidor, revisado justo antes de mandar cada uno',
  '**Matchmaking**': '**Matchmaking**',
  '`/matchmaking role` get the Ultimate or Melee Matchmaking role with `game:`, or take it off if you have it. `duration:` keeps it for that many hours, like 2 or 0.5 for 30 minutes, then it comes off on its own':
    '`/matchmaking role` toma el rol Ultimate o Melee Matchmaking con `game:`, o quítatelo si ya lo tienes. `duration:` te lo deja esas horas, como 2, o 0.5 para 30 minutos, y luego se quita solo',
  '`/matchmaking search` ping that role to find games. `message:` says what you want, like your connect code. `thread:True` starts a thread to arrange them, named like `Melee:Sam (10/21)`. Only people with the role can, once every 10 minutes per game':
    '`/matchmaking search` dale ping a ese rol para buscar partidas. `message:` dice lo que buscas, como tu código de conexión. `thread:True` abre un hilo para organizarlas, con un nombre como `Melee:Sam (10/21)`. Solo quienes tienen el rol pueden usarlo, una vez cada 10 minutos por juego',
  '`/matchmaking channel` where a game\'s searches post with `game:` and `channel:`. TOs only to change it, anyone can look. Left out means wherever the command runs. `clear:True` goes back to that':
    '`/matchmaking channel` dónde se publican las búsquedas de un juego, con `game:` y `channel:`. Solo los TOs lo cambian, cualquiera puede verlo. Vacío significa donde se use el comando. `clear:True` vuelve a eso',
  '-# Anyone can @ the roles without the commands too. The bot makes each one the first time someone asks for it':
    '-# Cualquiera puede mencionar los roles con @ sin usar los comandos. El bot crea cada uno la primera vez que alguien lo pide',
  '**Linking yourself**': '**Vincularte**',
  '`/link` tie your Discord to your start.gg. Leave out the link and it finds yours':
    '`/link` vincula tu Discord con tu start.gg. Si dejas el enlace vacío, encuentra el tuyo',
  '`/unlink` undo that, with an Undo button for a minute': '`/unlink` deshace eso, con un botón Deshacer durante un minuto',
  '-# Tracking posts someone\'s results here. Linking posts nothing, it just tells commands who you are: a blank player means you, `/scout` works and others can pick you. Tracked players with Discord on start.gg don\'t need it':
    '-# Seguir a alguien publica sus resultados aquí. Vincular no publica nada, solo le dice a los comandos quién eres: un jugador vacío eres tú, `/scout` funciona y otros pueden elegirte. Los jugadores seguidos con Discord en start.gg no lo necesitan',
  '**Player stats**': '**Estadísticas de jugadores**',
  '`/stats` set record, placements and best upset': '`/stats` récord de sets, posiciones y mejor upset',
  '`/doubles` one player\'s 2v2 record, partners and placements': '`/doubles` récord en 2v2 de un jugador, sus compañeros y posiciones',
  '`/h2h` record against someone, with one-line odds': '`/h2h` historial contra alguien, con las probabilidades en una línea',
  '`/predict` odds of beating someone in Ultimate, or Melee with `melee:True`, and why. `verbose:True` is the full breakdown, with how much each part counts and bars':
    '`/predict` probabilidades de ganarle a alguien en Ultimate, o en Melee con `melee:True`, y por qué. `verbose:True` es el desglose completo, con cuánto cuenta cada parte y barras',
  '`/scout` an opponent\'s form, how often they win game 3 and game 5 in Ultimate, toughest opponents and worst matchups. Needs you tracked or linked, with Discord connected on start.gg':
    '`/scout` la forma de un rival, cuánto gana la partida 3 y la partida 5 en Ultimate, sus rivales más difíciles y peores matchups. Necesita que estés seguido o vinculado, con Discord conectado en start.gg',
  '`/progress` last 30 days vs the 30 before, by game': '`/progress` últimos 30 días contra los 30 anteriores, por juego',
  '`/characters` reported characters. `game:` Ultimate or Melee, left out it\'s whichever has more':
    '`/characters` personajes reportados. `game:` Ultimate o Melee; si lo dejas vacío, el que tenga más',
  '-# `verbose:True` shows more, same as the Full report button on short reports other than `/progress` and `/predict`. `melee:True` sticks to Melee and adds Slippi ranks for players on the watchlist, which all-Melee reports show anyway. Melee cards say Melee at the top, other games show nothing there since Ultimate is the default. Melee `/predict`, `/h2h` and `/scout` odds count them when both players are ranked, even with no Melee sets to go on. `/characters game:Melee` adds Slippi ranked picks. Slippi ranked is singles, so `/doubles` leaves it out':
    '-# `verbose:True` muestra más, igual que el botón Informe completo de los informes cortos, menos `/progress` y `/predict`. `melee:True` se queda en Melee y suma los rangos de Slippi de quienes están en la lista, que los informes de solo Melee muestran de todos modos. Las tarjetas de Melee dicen Melee arriba; los otros juegos no muestran nada ahí, porque Ultimate es el predeterminado. Las probabilidades de Melee en `/predict`, `/h2h` y `/scout` cuentan los rangos cuando los dos jugadores tienen uno, aunque no haya sets de Melee. `/characters game:Melee` suma los personajes de Slippi ranked. Slippi ranked es de singles, así que `/doubles` lo deja fuera',
  '-# `since:2026-01-01` counts only sets since that date, and `venue:` only offline or online tournaments, on `/stats`, `/h2h`, `/scout` and `/predict`. Full report buttons keep them':
    '-# `since:2026-01-01` cuenta solo los sets desde esa fecha, y `venue:` solo torneos presenciales o en línea, en `/stats`, `/h2h`, `/scout` y `/predict`. Los botones de Informe completo los mantienen',
  '-# Any player or opponent box also takes a start.gg profile link or ID, for someone nobody tracked or linked. It looks them up without tracking them':
    '-# Cualquier casilla de jugador u oponente también acepta un enlace o ID de perfil de start.gg, para alguien que nadie sigue ni vinculó. Lo busca sin seguirlo',
  '-# Your commands take start.gg turns one at a time. One sent while another loads says Queued and starts after it, up to 3 waiting. When start.gg is backed up for everyone, new commands ask you to try again in a minute. A public report done over a minute after you asked comes in a new message that pings you':
    '-# Tus comandos usan start.gg de uno en uno. Uno que mandes mientras otro carga dice En cola y empieza después, con hasta 3 esperando. Cuando start.gg está saturado para todos, los comandos nuevos te piden intentar en un minuto. Un informe público que termina más de un minuto después llega en un mensaje nuevo con ping para ti',
  '-# No typing: long-press someone, then Apps, then **H2H with me** or **Scout them**. `/run`, match calls, next opponents and stream alerts have head-to-head buttons for the set coming up, which run the short report and come off when it ends':
    '-# Sin escribir: mantén presionado a alguien, luego Aplicaciones, y luego **H2H conmigo** o **Estudiar rival**. `/run`, los llamados de partida, los próximos rivales y los avisos de stream tienen botones de cara a cara para el set que viene, que muestran el informe corto y se quitan cuando termina',
  '-# Player lists start with whoever you picked last, and a name matches with any spacing, case or punctuation. A name that matches nobody gets the closest one suggested':
    '-# Las listas de jugadores empiezan con quien elegiste la última vez, y un nombre coincide sin importar espacios, mayúsculas o signos. Si un nombre no coincide con nadie, se sugiere el más parecido',
  '-# An event named for Melee but tagged on start.gg as Ultimate counts as Melee, and the other way around':
    '-# Un evento con nombre de Melee pero marcado en start.gg como Ultimate cuenta como Melee, y al revés',
  '**Slippi ranked**': '**Slippi ranked**',
  '`/slippi add` add your connect code to the watchlist, or leave it out to find yours on your start.gg. TOs can add anyone\'s, and `user:` says whose it is':
    '`/slippi add` agrega tu código de conexión a la lista de Slippi, o déjalo vacío para encontrar el tuyo en tu start.gg. Los TOs pueden agregar el de cualquiera, y `user:` dice de quién es',
  '`/slippi remove` take yourself off the watchlist, or anyone if you\'re a TO':
    '`/slippi remove` quítate de la lista de Slippi, o a cualquiera si eres TO',
  '`/slippi rank` rank, rating, record, characters and past seasons. Takes any connect code, and left out finds the code you added in any server':
    '`/slippi rank` rango, rating, récord, personajes y temporadas pasadas. Acepta cualquier código de conexión, y vacío encuentra el código que agregaste en cualquier servidor',
  '`/slippi leaderboard` everyone on the watchlist, best rank first': '`/slippi leaderboard` todos en la lista de Slippi, el mejor rango primero',
  '-# Cards show the rank badge and their most played character. Tracked players get added on their own once their code turns up in a start.gg netplay registration. Ranks come from slippi.gg, which has no public API, so this can break if Slippi changes it':
    '-# Las tarjetas muestran la insignia de rango y el personaje más jugado. Los jugadores seguidos se agregan solos en cuanto su código aparece en una inscripción de netplay en start.gg. Los rangos salen de slippi.gg, que no tiene API pública, así que esto puede fallar si Slippi la cambia',
  '`/t-o tournament add` track a tournament. What it posts follows `/t-o settings`, and `registration:` sets reg reminders and 1-hour DMs for it alone. `schedule:` sets custom reminder times, `add_event:on` also makes a Discord event':
    '`/t-o tournament add` sigue un torneo. Lo que publica sigue a `/t-o settings`, y `registration:` fija solo para él los recordatorios de inscripción y los DMs 1 hora antes. `schedule:` pone horarios de recordatorio propios, `add_event:on` también crea un evento de Discord',
  '`/t-o tournament remove` stop tracking one. Asks first, then Undo puts it back for a minute':
    '`/t-o tournament remove` deja de seguir uno. Pregunta primero, y luego Deshacer lo devuelve durante un minuto',
  '`/t-o tournament posts` one tracked tournament\'s sets, streams, calls, next opponents, top 8s and registration on or off. `default` follows `/t-o settings` again. `schedule:` changes the reminder times, `schedule:default` goes back to the usual four':
    '`/t-o tournament posts` enciende o apaga los sets, streams, llamados, próximos rivales, top 8 e inscripción de un torneo seguido. `default` vuelve a seguir a `/t-o settings`. `schedule:` cambia los horarios de recordatorio, `schedule:default` vuelve a los cuatro de siempre',
  '`/registered` who here is registered, by name so nobody gets pinged. `by_event:True` groups it by event':
    '`/registered` quién de aquí está inscrito, por nombre para que nadie reciba ping. `by_event:True` lo agrupa por evento',
  '`/reg_warn` warn someone who isn\'t registered yet. If they are, it just says so. Once per person per tournament in 12 hours, and 10 a day from anyone but a TO':
    '`/reg_warn` avísale a alguien que todavía no se ha inscrito. Si ya lo está, solo lo dice. Una vez por persona y torneo cada 12 horas, y 10 al día para quien no es TO',
  '`/bracket` bracket links for tracked tournaments, 30 min before the start to 6 hours after the end':
    '`/bracket` enlaces de brackets de torneos seguidos, desde 30 min antes del inicio hasta 6 horas después del final',
  '`/stream_link` stream links for tournaments that are tracked or have tracked players, live or starting within 30 min':
    '`/stream_link` enlaces de stream de torneos seguidos o con jugadores seguidos, en vivo o que empiezan en menos de 30 min',
  '`/t-o tournament event` make a Discord event from a start.gg link, without tracking it. Its streams go in the description':
    '`/t-o tournament event` crea un evento de Discord desde un enlace de start.gg, sin seguirlo. Sus streams van en la descripción',
  '`/t-o tournament list` every tracked tournament, when and where, what it has off, its next reminder, and its Discord event and threads. Anyone can look':
    '`/t-o tournament list` cada torneo seguido, cuándo y dónde, qué tiene apagado, su próximo recordatorio, y su evento de Discord y sus hilos. Cualquiera puede verlo',
  '-# `/t-o tournament` is TOs only, other than `list`. `tournament:` takes a link or one the bot knows. Discord events follow start.gg\'s time, end time, cover photo, place and streams, checked hourly, and get cancelled if the tournament is deleted there. Cards and DMs show the venue\'s address when the TO put it on start.gg, linked to a map':
    '-# `/t-o tournament` es solo para TOs, salvo `list`. `tournament:` acepta un enlace o uno que el bot ya conoce. Los eventos de Discord siguen la hora, hora de fin, foto de portada, lugar y streams de start.gg, revisados cada hora, y se cancelan si el torneo se borra ahí. Las tarjetas y los DMs muestran la dirección del lugar cuando el TO la puso en start.gg, con enlace a un mapa',
  '**Fun**': '**Diversión**',
  '`/64` a 64 old head who says 64 did it first': '`/64` un veterano de 64 que dice que 64 lo hizo primero',
  '`/melee` a Melee purist with a take': '`/melee` un purista de Melee con una opinión',
  '`/brawl` the last person still defending Brawl': '`/brawl` la última persona que todavía defiende Brawl',
  '`/sm4sh` a love letter to Smash 4': '`/sm4sh` una carta de amor a Smash 4',
  '`/ult` an Ultimate player who hates Ultimate': '`/ult` un jugador de Ultimate que odia Ultimate',
  '`/pplus` a Project+ player who wants you on netplay': '`/pplus` un jugador de Project+ que te quiere en netplay',
  '`/bills` Live pro-Bills photos and official Bills GIFs. Never sends the same image twice in a row':
    '`/bills` fotos a favor de los Bills en vivo y GIFs oficiales de los Bills. Nunca manda la misma imagen dos veces seguidas',
  '`/view_pfp` my profile picture, full size': '`/view_pfp` mi foto de perfil, en tamaño completo',
  '-# `/t-o settings bills:True` posts Bills final scores here after each game, green for a win and red for a loss':
    '-# `/t-o settings bills:True` publica aquí el marcador final de los Bills después de cada partido, en verde si ganan y en rojo si pierden',
  '**Posted here automatically**': '**Se publica aquí automáticamente**',
  '**Posted here for tournaments**': '**Se publica aquí para los torneos**',
  '**Set results.** Every finished set at a tracked tournament, and anywhere else the sets of tracked players with set results on, plus a tracked player\'s first DQ in an event. For an hour after, a winner or score the TO fixes gets edited in, and a reset set gets marked. `/t-o settings set_colors` colors them green for a win, red for a loss, gold for crew vs crew and blue when nobody tracked played':
    '**Resultados de sets.** Cada set terminado en un torneo seguido, y en cualquier otro lado los sets de jugadores seguidos con resultados de sets activados, más el primer DQ de un jugador seguido en un evento. Durante una hora después, si el TO corrige el ganador o el marcador se edita, y un set reiniciado se marca. `/t-o settings set_colors` los pinta de verde si ganan, rojo si pierden, dorado si se enfrenta la crew y azul si no jugó nadie seguido',
  '**Stream alerts.** Sets on stream or up next in the stream queue for 30 seconds, at tracked tournaments and for tracked players with stream alerts on, pinging whoever is playing with `/notify streams` on':
    '**Avisos de stream.** Sets en stream o siguientes en la cola del stream por 30 segundos, en torneos seguidos y de jugadores seguidos con avisos de stream activados, con ping a quien juegue y tenga `/notify streams` activado',
  '**Match call pings.** Called sets with someone who has `/notify calls` on, pinging them with You\'re up and the station when start.gg has one, all four in one message for doubles. At a tracked tournament every called set posts, pinged or not. A call the TO takes back gets crossed out, and calling it again pings again':
    '**Pings de llamados de partida.** Sets llamados con alguien que tenga `/notify calls` activado, con ping y Te toca y la estación cuando start.gg la tiene, los cuatro en un mensaje en dobles. En un torneo seguido se publica cada set llamado, con ping o sin él. Si el TO quita un llamado se tacha, y si lo vuelve a llamar hay ping otra vez',
  '**Next opponents.** A set that hasn\'t started with both players known, once it\'s the soonest either of them has left in the event: called, queued, ready, then waiting, then by round. Every one at a tracked tournament except round 1, and anywhere else the ones with someone who has `/notify next` on, pinging them, round 1 included. Shows the station and scheduled time when the TO sets them. If the TO puts someone else in the set within the hour, the card gets crossed out':
    '**Próximos rivales.** Un set que no ha empezado y ya tiene a los dos jugadores, cuando es el más próximo que le queda a alguno de ellos en el evento: llamado, en cola, listo y luego en espera, y después por ronda. Todos en un torneo seguido salvo la ronda 1, y en otros los que tengan a alguien con `/notify next` activado, con ping, ronda 1 incluida. Muestra la estación y la hora programada cuando el TO las pone. Si el TO pone a otra persona en el set dentro de la hora, la tarjeta se tacha',
  '**Tournament roll calls.** An hour before a tournament with 3+ of the crew, with the streams from its start.gg page. At a tracked tournament that counts tracked players and anyone registered whose start.gg Discord is in this server':
    '**Pase de lista de torneos.** Una hora antes de un torneo con 3 o más de la crew, con los streams de su página de start.gg. En un torneo seguido cuenta a los jugadores seguidos y a cualquier inscrito cuyo Discord de start.gg esté en este servidor',
  '**Tournament placements.** Where the crew placed, with the top 8 when every event finishes at a tracked tournament, even if top 8 posts are off. Otherwise 12 hours after it ends. Projected placements get edited once start.gg has them final':
    '**Posiciones de torneos.** Dónde quedó la crew, con el top 8 cuando termina cada evento de un torneo seguido, aunque las publicaciones de top 8 estén apagadas. Si no, 12 horas después de que termina. Las posiciones proyectadas se editan cuando start.gg las tiene finales',
  '**Top 8s.** The full top 8 of each event at a tracked tournament, as soon as the bracket is finished':
    '**Top 8.** El top 8 completo de cada evento de un torneo seguido, en cuanto termina el bracket',
  '**Registration reminders.** Tracked tournaments 7 days, 3 days and a day out, then a last call 6 hours before, pinging the Reg Reminders role, unless a TO sets custom times with `schedule:`. `dm_registration` DMs you 1 hour before registration closes, skipped once you\'re registered, and `dm_start` DMs you 1 hour before the start, both only while you\'re in this server. When registration closes within an hour of the start there\'s one DM, the start one':
    '**Recordatorios de inscripción.** Torneos seguidos 7 días, 3 días y un día antes, y una última llamada 6 horas antes, con ping al rol Reg Reminders, salvo que un TO ponga horarios propios con `schedule:`. `dm_registration` te manda un DM 1 hora antes de que cierre la inscripción, salvo que ya estés inscrito, y `dm_start` te manda un DM 1 hora antes del inicio, los dos solo mientras sigas en este servidor. Cuando la inscripción cierra a menos de una hora del inicio, llega un solo DM, el del inicio',
  '**Discord events.** Each upcoming tracked tournament gets a Discord event with start.gg\'s cover photo and streams in the description, once. Off unless `/t-o settings events` turns it on':
    '**Eventos de Discord.** Cada próximo torneo seguido recibe un evento de Discord con la foto de portada de start.gg y los streams en la descripción, una vez. Apagado salvo que `/t-o settings events` lo encienda',
  '**Slippi rank changes.** Watchlist changes, checked every 30 minutes. Tracked players can be discovered from connect codes entered on start.gg. When a season ends, a wrap-up with the final ranks, biggest climbers and most played characters':
    '**Cambios de rango en Slippi.** Cambios en la lista de Slippi, revisados cada 30 minutos. Los jugadores seguidos se pueden descubrir por los códigos de conexión puestos en start.gg. Cuando termina una temporada, un cierre con los rangos finales, los que más subieron y los personajes más jugados',
  '**Bills final results.** The final score with the other team\'s logo, green for a win and red for a loss, checked daily and every 15 minutes on game day. Off unless `/t-o settings bills` turns it on':
    '**Resultados finales de los Bills.** El marcador final con el logo del otro equipo, en verde si ganan y en rojo si pierden, revisado cada día y cada 15 minutos el día del partido. Apagado salvo que `/t-o settings bills` lo encienda',
  '**Weekly crew recap.** Tracked players with a non-DQ singles set that week. Sunday 9 pm ET unless `/t-o settings` changes it':
    '**Resumen semanal de la crew.** Los jugadores seguidos con un set de singles sin DQ esa semana. Domingo 9 pm ET salvo que `/t-o settings` lo cambie',
  '**Bot updates.** A new version going live on Railway, with when it deployed and the commit message':
    '**Actualizaciones del bot.** Una versión nueva que sale en Railway, con cuándo se publicó y el mensaje del commit',
  '**Back online.** After the bot was off 10 minutes or more, for how long and that commands sent then need sending again. While start.gg is down, commands say so right away and the bot\'s status shows it':
    '**De vuelta en línea.** Cuando el bot estuvo apagado 10 minutos o más, por cuánto tiempo y que los comandos de ese rato hay que mandarlos otra vez. Mientras start.gg está caído, los comandos lo avisan enseguida y el estado del bot lo muestra',
  '-# Set results, stream alerts, match calls, next opponents, top 8s and registration reminders follow `/t-o settings` at every tournament, and `/t-o tournament posts` turns them on or off for one. Off means none of those cards from it and no pings. Live ones still going on post when turned back on':
    '-# Los resultados de sets, avisos de stream, llamados de partida, próximos rivales, top 8 y recordatorios de inscripción siguen `/t-o settings` en todos los torneos, y `/t-o tournament posts` los enciende o apaga para uno. Apagado significa ninguna de esas tarjetas de ese torneo y ningún ping. Los que siguen en curso se publican al volver a encenderlos',
  '-# Tracked tournaments post their set results, stream alerts, match calls and next opponents in a thread. `/t-o settings threads` picks off, one thread per tournament or one per event for everything, and one per event applies to tracked tournaments too. Each thread pins its channel card until the tournament ends. If a thread can\'t be used, they post here':
    '-# Los torneos seguidos publican sus resultados de sets, avisos de stream, llamados de partida y próximos rivales en un hilo. `/t-o settings threads` elige entre apagado, un hilo por torneo o uno por evento para todo, y uno por evento aplica también a los torneos seguidos. Cada hilo fija su tarjeta en el canal hasta que termina el torneo. Si no se puede usar un hilo, se publican aquí',
  '-# Page {0}/{1}': '-# Página {0}/{1}',
  '`/t-o settings channel:#channel` pick where bot replies and automatic posts go': '`/t-o settings channel:#channel` elige dónde van las respuestas y publicaciones del bot',
  '`/profile` someone\'s start.gg profile. Use `/track add` or `/link` with their profile link first. `user:` picks a server member, `player:` a tracked or linked player': '`/profile` el perfil de start.gg de alguien. Usa primero `/track add` o `/link` con su enlace. `user:` elige un miembro del servidor, `player:` un jugador seguido o vinculado',
  '`/t-o settings` automatic posts, which are also the default for every tournament, threads, set result colors, Discord event length, weekly recap schedule, language and the one bot channel. Turning off two or more posts at once asks first': '`/t-o settings` publicaciones automáticas y valores predeterminados para cada torneo, hilos, colores de resultados, duración de eventos de Discord, horario del resumen semanal, idioma y el canal del bot. Pide confirmación para desactivar dos o más publicaciones a la vez',
  '`channel:` picks the one channel for bot replies and automatic posts, with its threads. Settings work privately anywhere; matchmaking can use another channel': '`channel:` elige el único canal para respuestas y publicaciones automáticas del bot, con sus hilos. Los ajustes funcionan en privado desde cualquier canal; matchmaking puede usar otro',
  '-# `user:` picks a Discord member for `/stats`, `/progress`, `/characters`, `/doubles`, `/recent`, `/upcoming` and `/run`, instead of `player:`. Use `/track add` or `/link` first': '-# `user:` elige un miembro de Discord para `/stats`, `/progress`, `/characters`, `/doubles`, `/recent`, `/upcoming` y `/run`, en vez de `player:`. Usa primero `/track add` o `/link`',
};
