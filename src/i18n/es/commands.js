// src/commands: replies to slash commands and buttons, other than the settings ones in settings.js
export default {
  // shared.js: failureMessage
  'start.gg turned down the bot\'s API token, so nothing from start.gg works until whoever runs the bot makes a new one.':
    'start.gg rechazó el token de API del bot, así que nada de start.gg funciona hasta que quien maneja el bot cree uno nuevo.',
  'start.gg has been down since <t:{0}:R>, so anything that needs it can\'t run right now. The bot is fine and picks back up on its own once start.gg answers. `/status` shows if it\'s still down.':
    'start.gg está caído desde <t:{0}:R>, así que nada que lo necesite puede funcionar ahora. El bot está bien y retoma solo cuando start.gg responda. `/status` muestra si sigue caído.',
  '{0} is limiting how fast the bot can ask right now. Try again in a minute.':
    '{0} está limitando qué tan rápido puede preguntar el bot. Vuelve a intentarlo en un minuto.',
  '{0} didn\'t answer in time. Try again in a minute.': '{0} no respondió a tiempo. Vuelve a intentarlo en un minuto.',
  '{0} is having trouble right now. Try again in a few minutes.': '{0} está teniendo problemas. Vuelve a intentarlo en unos minutos.',
  'Couldn\'t get that from {0} right now. Try again in a minute.': 'No pude obtener eso de {0} ahora. Vuelve a intentarlo en un minuto.',
  'Discord says I\'m missing a permission for that. A server admin can check my role, in server settings and on this channel.':
    'Discord dice que me falta un permiso para eso. Un admin del servidor puede revisar mi rol, en los ajustes del servidor y en este canal.',
  'Discord says I can\'t see what that needs. A server admin can check that my role can view this channel.':
    'Discord dice que no puedo ver lo que eso necesita. Un admin del servidor puede revisar que mi rol pueda ver este canal.',
  'That person isn\'t in this server anymore.': 'Esa persona ya no está en este servidor.',
  'Discord didn\'t let me do that just now. Try again in a minute.': 'Discord no me dejó hacer eso ahora. Vuelve a intentarlo en un minuto.',
  'Discord is having trouble right now. Try again in a few minutes.': 'Discord está teniendo problemas. Vuelve a intentarlo en unos minutos.',
  'Something went wrong in the bot itself, not start.gg or Discord. It\'s in the bot\'s logs.':
    'Algo falló en el propio bot, no en start.gg ni en Discord. Quedó en los logs del bot.',
  // shared.js: late answers, report buttons, parseSince, countdown, lookups
  '<@{0}> here\'s your {1}.': '<@{0}> aquí tienes tu {1}.',
  'Full report': 'Informe completo',
  'H2H vs {0}': 'H2H vs {0}',
  '**{0}:** {1} · reminders {2}': '**{0}:** {1} · recordatorios {2}',
  'on (default)': 'sí (por defecto)',
  'off (default)': 'no (por defecto)',
  '-# default follows /t-o settings, which every tournament without its own setting goes by':
    '-# por defecto sigue /t-o settings, que rige a todo torneo sin ajuste propio',
  'Couldn\'t read `{0}` as a date. Use YYYY-MM-DD, like 2026-01-01.': 'No pude leer `{0}` como fecha. Usa AAAA-MM-DD, como 2026-01-01.',
  '**{0}** · {1} of {2} start.gg requests done, about {3} left\n-# start.gg allows 80 requests a minute, so the first look takes a while. Asking again in the next few hours is quick':
    '**{0}** · {1} de {2} consultas a start.gg listas, faltan unos {3}\n-# start.gg permite 80 consultas por minuto, así que la primera vez tarda. Volver a preguntar en las próximas horas es rápido',
  ' Did you mean **{0}**?': ' ¿Quisiste decir **{0}**?',
  'You aren\'t tracked. `/track add` tracks you.': 'No te sigo. `/track add` te agrega.',
  'Only tracked or linked players can be picked. `/track add` them, or they can `/link` their own start.gg.':
    'Solo se puede elegir a jugadores seguidos o vinculados. Agrégalos con `/track add`, o que vinculen su start.gg con `/link`.',
  'Only tracked players can be picked here. `/track list` shows who\'s tracked.':
    'Aquí solo se puede elegir a jugadores seguidos. `/track list` muestra a quién sigo.',
  'Pick a player, or `/link` your start.gg so leaving it out looks you up.':
    'Elige un jugador, o vincula tu start.gg con `/link` para que dejarlo vacío te busque a ti.',
  'Nobody tracked goes by `{0}`.{1}': 'No sigo a nadie llamado `{0}`.{1}',
  'Nobody tracked or linked goes by `{0}`.{1}': 'No hay nadie seguido ni vinculado llamado `{0}`.{1}',
  'Couldn\'t find a start.gg player for `{0}`. Use your profile link, like start.gg/user/f64a83c8.':
    'No encontré un jugador de start.gg para `{0}`. Usa el enlace de tu perfil, como start.gg/user/f64a83c8.',
  'Couldn\'t find a start.gg player for `{0}`. Use their profile link, like start.gg/user/f64a83c8.':
    'No encontré un jugador de start.gg para `{0}`. Usa el enlace de su perfil, como start.gg/user/f64a83c8.',
  ' Pick a tracked or linked player, or use a profile link or ID like start.gg/user/f64a83c8.':
    ' Elige un jugador seguido o vinculado, o usa un enlace o ID de perfil como start.gg/user/f64a83c8.',
  'Couldn\'t find a start.gg player for `{0}`.{1}': 'No encontré un jugador de start.gg para `{0}`.{1}',
  // confirm.js
  Cancel: 'Cancelar',
  Undo: 'Deshacer',
  'That button doesn\'t work anymore.': 'Ese botón ya no funciona.',
  'Only whoever ran `{0}` can press this.': 'Solo quien usó `{0}` puede presionar esto.',
  'Already on it, one press is enough.': 'Ya estoy en eso, con presionar una vez basta.',
  // turns.js
  'You have {0} commands going already. Try again once one is done.': 'Ya tienes {0} comandos en curso. Vuelve a intentarlo cuando termine uno.',
  'start.gg is backed up right now, try again in a minute.': 'start.gg está saturado ahora, vuelve a intentarlo en un minuto.',
  ', which has about {0} left': ', al que le faltan unos {0}',
  '**Queued** behind your {0}{1}. This one starts when it\'s done.': '**En cola** detrás de tu {0}{1}. Este empieza cuando termine.',
  // index.js: buttons, autocomplete
  '{0}The button press expired before I could answer. Retrying /{1} now.':
    '{0}El botón expiró antes de que pudiera responder. Reintentando /{1} ahora.',
  'That button doesn\'t work anymore, run the command again.': 'Ese botón ya no funciona, usa el comando otra vez.',
  'Couldn\'t find a start.gg account for that player. Run `/{0}` again.': 'No encontré una cuenta de start.gg para ese jugador. Usa `/{0}` otra vez.',
  'Start.gg is already working on that one. The full report swaps in when it\'s done.':
    'start.gg ya está trabajando en eso. El informe completo aparece cuando termine.',
  '{0} (linked)': '{0} (vinculado)',
  'Nobody tracked matches "{0}"': 'Ningún jugador seguido coincide con "{0}"',
  'Nobody tracked or linked matches "{0}", /track add them first': 'Nadie seguido ni vinculado coincide con "{0}", agrégalo con /track add primero',
  'Nobody is tracked yet, /track add someone first': 'Todavía no sigo a nadie, agrega a alguien con /track add primero',
  // players.js: track add and remove, cleanup, link, profile, recent, run
  '{0}\'s start.gg has a different Discord connected.': 'El start.gg de {0} tiene otro Discord conectado.',
  'If {0} is you, connect this Discord on your start.gg first.': 'Si {0} eres tú, conecta este Discord en tu start.gg primero.',
  'Only TOs can track someone else. {0}': 'Solo los TOs pueden seguir a otra persona. {0}',
  'Already tracking {0}.': 'Ya sigo a {0}.',
  'untrack someone else. Leave out `player` to untrack yourself': 'dejar de seguir a otra persona. Deja `player` vacío para quitarte tú',
  'track someone else. Leave out `user` to track yourself': 'seguir a otra persona. Deja `user` vacío para agregarte tú',
  'Pick either `user` or `profile`, not both.': 'Elige `user` o `profile`, no los dos.',
  'Couldn\'t find a start.gg with {0}\'s Discord connected. Ask them to run `/link` once, or add them with `profile:` and their start.gg link.':
    'No encontré un start.gg con el Discord de {0} conectado. Pídele que use `/link` una vez, o agrégalo con `profile:` y su enlace de start.gg.',
  'Stop tracking': 'Dejar de seguir',
  'Stop tracking {0}? Their set result and stream alert settings go with them.':
    '¿Dejar de seguir a {0}? Sus ajustes de resultados de sets y avisos de stream se van con él.',
  'They aren\'t tracked anymore.': 'Ya no lo sigo.',
  'Stopped tracking {0}.': 'Dejé de seguir a {0}.',
  'Still tracking {0}.': 'Sigo siguiendo a {0}.',
  '{0} is already tracked again.': 'Ya volví a seguir a {0}.',
  'Tracking {0} again, with the same settings as before.': 'Vuelvo a seguir a {0}, con los mismos ajustes de antes.',
  'Too late to undo. `/track add` them again, with set results and stream alerts starting off.':
    'Ya es tarde para deshacer. Agrégalo otra vez con `/track add`, con los resultados de sets y avisos de stream empezando apagados.',
  'clean up the track list': 'limpiar la lista de seguidos',
  '\n-# 1 player has no Discord on start.gg and stays. `no_discord:True` untracks them too':
    '\n-# 1 jugador no tiene Discord en start.gg y se queda. `no_discord:True` también lo quita',
  '\n-# {0} players have no Discord on start.gg and stay. `no_discord:True` untracks them too':
    '\n-# {0} jugadores no tienen Discord en start.gg y se quedan. `no_discord:True` también los quita',
  'Everyone tracked has their start.gg Discord in this server.{0}': 'Todos los que sigo tienen su Discord de start.gg en este servidor.{0}',
  '{0} more': '{0} más',
  'Untrack {0} whose start.gg Discord isn\'t in this server? {1}.{2}':
    '¿Dejar de seguir a {0} cuyo Discord de start.gg no está en este servidor? {1}.{2}',
  'Untrack {0} whose start.gg Discord isn\'t in this server or who have none? {1}.{2}':
    '¿Dejar de seguir a {0} cuyo Discord de start.gg no está en este servidor o que no tienen? {1}.{2}',
  'Untrack them': 'Dejar de seguirlos',
  'That button doesn\'t work anymore. Run `/t-o cleanup` again.': 'Ese botón ya no funciona. Usa `/t-o cleanup` otra vez.',
  'Untracked {0}.': 'Dejé de seguir a {0}.',
  'Everyone stays tracked.': 'Sigo siguiendo a todos.',
  'Too late to undo. `/track add` anyone you want back.': 'Ya es tarde para deshacer. Agrega con `/track add` a quien quieras de vuelta.',
  '{0}\'s start.gg has a different Discord account connected.': 'El start.gg de {0} tiene otra cuenta de Discord conectada.',
  'Connect your Discord on your start.gg profile first, then try again.':
    'Conecta tu Discord en tu perfil de start.gg primero y vuelve a intentarlo.',
  'Already linked to {0}. Leave the player out of a command like `/stats` to look yourself up.':
    'Ya estás vinculado a {0}. Deja el jugador vacío en un comando como `/stats` para buscarte a ti.',
  'Couldn\'t find a start.gg with this Discord connected among the accounts I\'ve seen. Connect it on your start.gg profile if you haven\'t, then run `{0}` with your profile link, like start.gg/user/f64a83c8.':
    'No encontré un start.gg con este Discord conectado entre las cuentas que he visto. Conéctalo en tu perfil de start.gg si no lo has hecho y usa `{0}` con el enlace de tu perfil, como start.gg/user/f64a83c8.',
  'No need to link. You\'re tracked as {0} with this Discord on your start.gg, so leaving the player out of a command already looks you up.':
    'No hace falta vincular. Te sigo como {0} con este Discord en tu start.gg, así que dejar el jugador vacío en un comando ya te busca a ti.',
  'You weren\'t linked.': 'No estabas vinculado.',
  'You aren\'t linked in this server, but commands here still find you as {0} from another server the bot is in. `/unlink` there takes it off.':
    'No estás vinculado en este servidor, pero los comandos de aquí te siguen encontrando como {0} desde otro servidor donde está el bot. `/unlink` allá lo quita.',
  'Unlinked from {0}.': 'Te desvinculé de {0}.',
  ' Commands still find you as {0}, since you\'re tracked with this Discord on your start.gg.':
    ' Los comandos te siguen encontrando como {0}, porque te sigo con este Discord en tu start.gg.',
  ' Leaving the player blank won\'t find you now, you\'re off the player list and `/scout` needs a link.':
    ' Dejar el jugador vacío ya no te encuentra: saliste de la lista de jugadores y `/scout` necesita un vínculo.',
  'You\'ve linked {0} since, so that stays.': 'Desde entonces vinculaste {0}, así que eso se queda.',
  'Linked to {0} again.': 'Vinculado a {0} otra vez.',
  'Too late to undo. `/link` again with your start.gg profile link.':
    'Ya es tarde para deshacer. Usa `/link` otra vez con el enlace de tu perfil de start.gg.',
  'Bots don\'t have start.gg accounts.': 'Los bots no tienen cuentas de start.gg.',
  'No sets found.': 'No encontré sets.',
  '{0} has no current tournament run on start.gg.': '{0} no tiene un torneo en curso en start.gg.',
  // to.js
  'Only TOs can {0}. `/t-o role list` shows who they are.': 'Solo los TOs pueden {0}. `/t-o role list` muestra quiénes son.',
  'Bots can\'t be TOs.': 'Los bots no pueden ser TOs.',
  'add TOs': 'agregar TOs',
  '{0} is already a TO.': '{0} ya es TO.',
  'I couldn\'t give {0} the TO role. That needs Manage Roles, with my role above TO.':
    'No pude darle el rol TO a {0}. Eso necesita Gestionar roles, con mi rol por encima de TO.',
  '{0} is a TO now. {1}': '{0} ya es TO. {1}',
  'TOs can control automatic messages, track, untrack, change posts and set pings for anyone, take anyone off the Slippi watchlist, and use `/t-o tournament` and `/t-o cleanup`.':
    'Los TOs manejan las publicaciones automáticas, siguen y dejan de seguir, cambian publicaciones y pings de cualquiera, quitan a cualquiera de la lista de Slippi y usan `/t-o tournament` y `/t-o cleanup`.',
  'You need Manage Server permission to set the TO role.': 'Necesitas el permiso Gestionar servidor para elegir el rol TO.',
  '{0} is the TO role now.': '{0} ahora es el rol TO.',
  'remove TOs': 'quitar TOs',
  '{0} isn\'t a TO.': '{0} no es TO.',
  '{0} is the last known TO. Add another TO first, or have someone with Manage Server set the TO role.':
    '{0} es el último TO conocido. Agrega otro TO primero, o pide a alguien con Gestionar servidor que elija el rol TO.',
  'I couldn\'t take the TO role off {0}. That needs Manage Roles, with my role above TO.':
    'No pude quitarle el rol TO a {0}. Eso necesita Gestionar roles, con mi rol por encima de TO.',
  '{0} isn\'t a TO anymore.': '{0} ya no es TO.',
  // tournaments.js
  'Couldn\'t read `{0}` as a reminder time. Use hours or days, like 7d,3d,1d,6h.':
    'No pude leer `{0}` como hora de recordatorio. Usa horas o días, como 7d,3d,1d,6h.',
  'Reminders run 1 hour to 30 days out, up to {0} of them, like 7d,3d,1d,6h.':
    'Los recordatorios van de 1 hora a 30 días antes, hasta {0}, como 7d,3d,1d,6h.',
  'Match calls': 'Llamados de partida',
  'Reg reminders': 'Recordatorios de inscripción',
  ' · ': ' · ',
  'Threads can\'t be started in <#{0}>, so its sets, stream alerts, match calls and next opponents post there instead.':
    'No se pueden abrir hilos en <#{0}>, así que sus sets, avisos de stream, llamados de partida y próximos rivales se publican ahí directamente.',
  'I need {0} in <#{1}> to start its thread. Until then its sets, stream alerts, match calls and next opponents post there instead.':
    'Necesito {0} en <#{1}> para abrir su hilo. Hasta entonces, sus sets, avisos de stream, llamados de partida y próximos rivales se publican ahí directamente.',
  'Tracking {0}.': 'Sigo {0}.',
  'No reg reminders.': 'Sin recordatorios de inscripción.',
  'Registration is closed, so no reg reminders.': 'La inscripción está cerrada, así que no hay recordatorios.',
  'Registration ends <t:{0}:R>, sending the last call now.': 'La inscripción cierra <t:{0}:R>, mando el último aviso ahora.',
  'Everyone with `/notify registration` on gets pinged {0} before registration ends, starting <t:{1}:R>.':
    'Quienes tengan `/notify registration` activado reciben un ping {0} antes de que cierre la inscripción, empezando <t:{1}:R>.',
  'track tournaments': 'seguir torneos',
  '{0} is already over.': '{0} ya terminó.',
  '{0} is already tracked. `/t-o tournament posts` changes what it posts.': 'Ya sigo {0}. `/t-o tournament posts` cambia lo que publica.',
  'stop tracking tournaments': 'dejar de seguir torneos',
  'That tournament isn\'t tracked. `/track list` shows the ones that are.': 'No sigo ese torneo. `/track list` muestra los que sí.',
  'Stop tracking {0}? Everything it posts stops.': '¿Dejar de seguir {0}? Todo lo que publica se detiene.',
  'It isn\'t tracked anymore.': 'Ya no lo sigo.',
  // the same replies about a tournament, which takes no personal "a"
  '[tournament] Already tracking {0}.': 'Ya sigo {0}.',
  '[tournament] Stopped tracking {0}.': 'Dejé de seguir {0}.',
  '[tournament] Still tracking {0}.': 'Sigo siguiendo {0}.',
  '[tournament] {0} is already tracked again.': 'Ya volví a seguir {0}.',
  '[tournament] Tracking {0} again, with the same settings as before.': 'Vuelvo a seguir {0}, con los mismos ajustes de antes.',
  'Too late to undo, it\'s over. `/t-o tournament add` it again.': 'Ya es tarde para deshacer, terminó. Agrégalo otra vez con `/t-o tournament add`.',
  'Too late to undo. `/t-o tournament add` it again.': 'Ya es tarde para deshacer. Agrégalo otra vez con `/t-o tournament add`.',
  'change what tournaments post': 'cambiar lo que publican los torneos',
  'That tournament isn\'t tracked. `/t-o tournament add` it first.': 'No sigo ese torneo. Agrégalo con `/t-o tournament add` primero.',
  '**{0}**': '**{0}**',
  '**{0}**\n{1}': '**{0}**\n{1}',
  '-# Reg reminders go out {0} before registration ends, starting from the next one still to come':
    '-# Los recordatorios de inscripción salen {0} antes de que cierre la inscripción, a partir del próximo pendiente',
  '-# Reg reminders are back to the usual 7 days, 3 days, 1 day and 6 hours before registration ends':
    '-# Los recordatorios de inscripción vuelven a lo normal: 7 días, 3 días, 1 día y 6 horas antes de que cierre la inscripción',
  '{0} has no start time on start.gg, so Discord can\'t schedule it.':
    '{0} no tiene hora de inicio en start.gg, así que Discord no puede programarlo.',
  '{0} already started <t:{1}:R>. Discord events have to start in the future.':
    '{0} ya empezó <t:{1}:R>. Los eventos de Discord tienen que empezar en el futuro.',
  'Made a Discord event for {0} on <t:{1}:F>: {2}': 'Creé un evento de Discord para {0} el <t:{1}:F>: {2}',
  '{0} already has a Discord event: {1}': '{0} ya tiene un evento de Discord: {1}',
  'make Discord events': 'crear eventos de Discord',
  // registration.js
  'Couldn\'t find a start.gg tournament for `{0}`. Paste its link, like start.gg/tournament/genesis-x.':
    'No encontré un torneo de start.gg para `{0}`. Pega su enlace, como start.gg/tournament/genesis-x.',
  'No tracked tournaments yet, /t-o tournament add one': 'Todavía no sigo ningún torneo, agrega uno con /t-o tournament add',
  'No tournaments to pick yet, paste a start.gg link': 'Todavía no hay torneos para elegir, pega un enlace de start.gg',
  'No tracked tournaments going on right now. Check the other channels if you\'re expecting one.':
    'No hay torneos seguidos en curso ahora. Revisa los otros canales si esperabas uno.',
  'If you were expecting a stream, ask a TO in another channel. `/socials` has the server\'s saved streams.':
    'Si esperabas un stream, pregúntale a un TO en otro canal. `/socials` tiene los streams guardados del servidor.',
  'No tracked tournaments are going on right now. {0}': 'No hay torneos seguidos en curso ahora. {0}',
  'Couldn\'t get stream links from start.gg right now. {0}': 'No pude obtener los enlaces de stream de start.gg ahora. {0}',
  'No stream links on start.gg for {0}. {1}': 'No hay enlaces de stream en start.gg para {0}. {1}',
  'start.gg hides who\'s registered for {0}, so there\'s no list to show.':
    'start.gg oculta quién está inscrito en {0}, así que no hay lista que mostrar.',
  'Bots don\'t need to register.': 'Los bots no necesitan inscribirse.',
  'Already registered.\n-# {0} · {1}': 'Ya está inscrito.\n-# {0} · {1}',
  'Registration for {0} already closed.': 'La inscripción de {0} ya cerró.',
  'Registration for {0} isn\'t open right now.': 'La inscripción de {0} no está abierta ahora.',
  'start.gg hides who\'s registered for {0}, so there\'s no telling if they are. No warning sent.':
    'start.gg oculta quién está inscrito en {0}, así que no hay forma de saber si lo está. No mandé el aviso.',
  '{0} was already warned about {1} <t:{2}:R>. They can be warned again <t:{3}:R>.':
    'A {0} ya se le avisó de {1} <t:{2}:R>. Se le puede volver a avisar <t:{3}:R>.',
  'You\'ve sent {0} registration warnings in the last day, the most anyone but a TO can. You can send another <t:{1}:R>.':
    'Enviaste {0} avisos de inscripción en el último día, el máximo para quien no es TO. Puedes enviar otro <t:{1}:R>.',
  // matchmaking.js
  'Duration is hours to keep the role, {0}-{1}. Leave it out to keep it until you take it off.':
    'La duración son las horas que te quedas con el rol, de {0} a {1}. Déjala vacía para quedártelo hasta que te lo quites.',
  '`/matchmaking search game:{0}` pings it, and so does typing @{1}.': '`/matchmaking search game:{0}` le da ping, y también escribir @{1}.',
  'Took off your **{0}** role, so it won\'t ping you anymore.': 'Te quité el rol **{0}**, así que ya no te llegarán sus pings.',
  'Keeping your **{0}** role for {1}, then it comes off on its own.': 'Te dejo el rol **{0}** por {1}, y después se quita solo.',
  'You have the **{0}** role now, so you\'ll get pinged when someone wants games. {1}':
    'Ya tienes el rol **{0}**, así que te llegará un ping cuando alguien busque partidas. {1}',
  'You have the **{0}** role now for {1}, so you\'ll get pinged when someone wants games. It comes off on its own after that. {2}':
    'Ya tienes el rol **{0}** por {1}, así que te llegará un ping cuando alguien busque partidas. Después se quita solo. {2}',
  'I couldn\'t change your **{0}** role. That needs Manage Roles, with my role above {1}.':
    'No pude cambiar tu rol **{0}**. Eso necesita Gestionar roles, con mi rol por encima de {1}.',
  'Discord didn\'t let me change your **{0}** role just now. Try again in a minute.':
    'Discord no me dejó cambiar tu rol **{0}** ahora. Vuelve a intentarlo en un minuto.',
  'You need the **{0}** role to ping it. `/matchmaking role game:{1}` gives it to you.':
    'Necesitas el rol **{0}** para darle ping. `/matchmaking role game:{1}` te lo da.',
  '**{0}** can\'t be pinged right now. A server admin can turn on "Allow anyone to @mention this role" in its settings.':
    'A **{0}** no se le puede dar ping ahora. Un admin del servidor puede activar "Permitir que cualquiera @mencione este rol" en los ajustes del rol.',
  'Posted your {0} search in <#{1}>.': 'Publiqué tu búsqueda de {0} en <#{1}>.',
  'You pinged **{0}** <t:{1}:R>. You can ping it again <t:{2}:R>, and anyone with the role can still answer that one.':
    'Le diste ping a **{0}** <t:{1}:R>. Puedes volver a darle ping <t:{2}:R>, y cualquiera con el rol todavía puede responder a ese.',
  'I couldn\'t post in <#{0}>. Give me View Channel and Send Messages there, then try again.':
    'No pude publicar en <#{0}>. Dame Ver canal y Enviar mensajes ahí, y vuelve a intentarlo.',
  'The saved {0} channel is gone, so this posted here. A TO can set a new one with `/matchmaking channel`.':
    'El canal guardado de {0} ya no existe, así que se publicó aquí. Un TO puede elegir otro con `/matchmaking channel`.',
  'Posted your search, but I couldn\'t start a thread here. A server admin can turn on **Create Public Threads** and **Send Messages in Threads** for this channel.':
    'Publiqué tu búsqueda, pero no pude abrir un hilo aquí. Un admin del servidor puede activar **Crear hilos públicos** y **Enviar mensajes en hilos** en este canal.',
  '**{0}** searches post in <#{1}>.': 'Las búsquedas de **{0}** se publican en <#{1}>.',
  '**{0}** searches post wherever the command runs.': 'Las búsquedas de **{0}** se publican donde se use el comando.',
  'Pick either a channel or `clear:True`, not both.': 'Elige un canal o `clear:True`, no los dos.',
  'set matchmaking channels': 'elegir canales de matchmaking',
  '**{0}** searches post wherever the command runs now.': 'Ahora las búsquedas de **{0}** se publican donde se use el comando.',
  'Couldn\'t use that channel for **{0}** searches. Pick one in this server.':
    'No puedo usar ese canal para las búsquedas de **{0}**. Elige uno de este servidor.',
  '**{0}** searches need a text channel.': 'Las búsquedas de **{0}** necesitan un canal de texto.',
  'I can\'t post in <#{0}>. Give me View Channel and Send Messages there first.':
    'No puedo publicar en <#{0}>. Dame Ver canal y Enviar mensajes ahí primero.',
  '**{0}** searches will post in <#{1}>.': 'Las búsquedas de **{0}** se publicarán en <#{1}>.',
  // slippi.js
  'That isn\'t a connect code. Use the one Slippi Launcher shows, like ABCD#123.':
    'Eso no es un código de conexión. Usa el que muestra Slippi Launcher, como ABCD#123.',
  'Add a connect code, like `/slippi add code:ABCD#123`. Left out, it looks for yours on your start.gg, so `/link` that first.':
    'Agrega un código de conexión, como `/slippi add code:ABCD#123`. Si lo dejas vacío, busca el tuyo en tu start.gg, así que vincúlalo con `/link` primero.',
  'You\'re on the watchlist as {0} ({1}). Only TOs can add someone else. `/slippi remove` takes you off first if your code changed.':
    'Estás en la lista de Slippi como {0} ({1}). Solo los TOs pueden agregar a otra persona. Si cambiaste de código, quítate primero con `/slippi remove`.',
  'Couldn\'t find a connect code on {0}\'s start.gg. It\'s saved when you register for a netplay tournament that asks for one. Use `code:` instead, like `/slippi add code:ABCD#123`.':
    'No encontré un código de conexión en el start.gg de {0}. Se guarda cuando te inscribes en un torneo de netplay que lo pide. Usa `code:`, como `/slippi add code:ABCD#123`.',
  'Slippi has nobody with the code {0}.': 'Slippi no tiene a nadie con el código {0}.',
  '{0} is already on the Slippi watchlist.': '{0} ya está en la lista de Slippi.',
  'Added {0} to the Slippi watchlist. Their rank changes get posted here.':
    'Agregué a {0} a la lista de Slippi. Sus cambios de rango se publican aquí.',
  'You aren\'t on the Slippi watchlist. Pick someone to take off, if you\'re a TO.':
    'No estás en la lista de Slippi. Si eres TO, elige a quién quitar.',
  'They aren\'t on the Slippi watchlist.{0}': 'No está en la lista de Slippi.{0}',
  ' `/slippi leaderboard` shows who is.': ' `/slippi leaderboard` muestra quiénes están.',
  'take someone else off the watchlist. Leave out `player` to take yourself off':
    'quitar a otra persona de la lista de Slippi. Deja `player` vacío para quitarte tú',
  'Took {0} ({1}) off the Slippi watchlist.': 'Quité a {0} ({1}) de la lista de Slippi.',
  'Nobody on the watchlist goes by that.{0}': 'No hay nadie con ese nombre en la lista de Slippi.{0}',
  ' Pick someone from the list, or type a connect code like ABCD#123.':
    ' Elige a alguien de la lista, o escribe un código de conexión como ABCD#123.',
  'Pick someone, or add your code with `/slippi add code:ABCD#123` so leaving it out finds you.':
    'Elige a alguien, o agrega tu código con `/slippi add code:ABCD#123` para que dejarlo vacío te encuentre.',
  'Couldn\'t find a connect code on {0}\'s start.gg. Add yours with `/slippi add code:ABCD#123` and leaving `player` out finds it after that.':
    'No encontré un código de conexión en el start.gg de {0}. Agrega el tuyo con `/slippi add code:ABCD#123` y después dejar `player` vacío lo encuentra.',
  'Bots don\'t have connect codes.': 'Los bots no tienen código de conexión.',
  'add someone else to the watchlist. Leave out `user` to add yourself':
    'agregar a otra persona a la lista de Slippi. Deja `user` vacío para agregarte tú',
  '{0} isn\'t tracked or linked, so there\'s no start.gg to find a code on. Add theirs with `code:`.':
    '{0} no está seguido ni vinculado, así que no hay start.gg donde buscar su código. Agrega el suyo con `code:`.',
  '{0} is on the watchlist as {1} ({2}). `/slippi remove` takes them off first if their code changed.':
    '{0} está en la lista de Slippi como {1} ({2}). Si cambió de código, quítalo primero con `/slippi remove`.',
  'You\'re on the watchlist as {0} ({1}). `/slippi remove` takes you off first if your code changed.':
    'Estás en la lista de Slippi como {0} ({1}). Si cambiaste de código, quítate primero con `/slippi remove`.',
  '{0} is on the Slippi watchlist as yours now.': '{0} está en la lista de Slippi como tuyo ahora.',
  '{0} is on the Slippi watchlist as {1}\'s now.': '{0} está en la lista de Slippi como el código de {1} ahora.',
  '\n-# Not tied to anyone, so `/slippi rank` with `player` left out won\'t find them. Add `user:` to say whose code it is.':
    '\n-# No es de nadie, así que `/slippi rank` con `player` vacío no lo encuentra. Agrega `user:` para decir de quién es el código.',
  'Slippi doesn\'t have {0} ({1}) anymore.': 'Slippi ya no tiene a {0} ({1}).',
  'Slippi has nobody with the code {0}.{1}': 'Slippi no tiene a nadie con el código {0}.{1}',
  'Look up {0}': 'Buscar {0}',
  'Look up {0} on start.gg': 'Buscar {0} en start.gg',
  'Nobody tracked or linked matches "{0}". Paste their start.gg profile link': 'Nadie seguido o vinculado coincide con "{0}". Pega su enlace de perfil de start.gg',
  'Nobody tracked or linked goes by `{0}`. Paste their start.gg profile link or ID, like start.gg/user/f64a83c8.':
    'Nadie seguido o vinculado se llama `{0}`. Pega su enlace o ID de perfil de start.gg, como start.gg/user/f64a83c8.',
  'Nobody is tracked yet. Paste a start.gg profile link to look anyone up': 'Todavía no sigo a nadie. Pega un enlace de perfil de start.gg para buscar a quien sea',
  'Nobody on the watchlist matches "{0}"': 'Nadie en la lista de Slippi coincide con "{0}"',
  'Nobody on the Slippi watchlist yet, /slippi add someone first':
    'Todavía no hay nadie en la lista de Slippi, agrega a alguien con /slippi add primero',
  // stats.js
  '/scout needs to know who you are on start.gg. Connect your Discord on your start.gg profile, then `/link` it.':
    '/scout necesita saber quién eres en start.gg. Conecta tu Discord en tu perfil de start.gg y vincúlalo con `/link`.',
  'Pick a player by name, a start.gg link or ID, or `/link` your start.gg so leaving it out looks you up.':
    'Elige un jugador por nombre, enlace o ID de start.gg, o vincula tu start.gg con `/link` para que dejarlo vacío te busque a ti.',
  'Pick two different players.': 'Elige dos jugadores distintos.',
  'Going through {0}\'s sets': 'Revisando los sets de {0}',
  'Use an opponent\'s profile, not your own.': 'Usa el perfil de un rival, no el tuyo.',
  'Scouting {0}': 'Estudiando a {0}',
  'Full report on its way': 'El informe completo viene en camino',
  'Finding {0} and {1}\'s meetings and odds': 'Buscando los enfrentamientos y las probabilidades de {0} y {1}',
  'Lifetime report on its way': 'El informe histórico viene en camino',
  'Going through {0}\'s doubles': 'Revisando los dobles de {0}',
  'Full doubles report on its way': 'El informe completo de dobles viene en camino',
  'Going through {0}\'s reported characters': 'Revisando los personajes reportados de {0}',
  'Every game on its way': 'Todos los juegos vienen en camino',
  '{0} other games': '{0} juegos más',
  'No characters reported for {0}': 'No hay personajes reportados en {0}',
  'Neither {0} nor {1} has played {2} singles on start.gg.': 'Ni {0} ni {1} han jugado singles de {2} en start.gg.',
  'Neither {0} nor {1} has played {2} singles on start.gg matching those filters.':
    'Ni {0} ni {1} han jugado singles de {2} en start.gg con esos filtros.',
  '{0} hasn\'t played {1} singles on start.gg.': '{0} no ha jugado singles de {1} en start.gg.',
  '{0} hasn\'t played {1} singles on start.gg matching those filters.': '{0} no ha jugado singles de {1} en start.gg con esos filtros.',
  'There\'s nothing on start.gg to go on for {0} and {1} in {2}.': 'start.gg no tiene nada con qué calcular {0} contra {1} en {2}.',
  '\n-# Leave out `melee` for Ultimate odds': '\n-# Quita `melee` para ver las probabilidades en Ultimate',
  '\n-# Add `melee:True` for Melee odds': '\n-# Agrega `melee:True` para ver las probabilidades en Melee',
  'Going through {0} and {1}\'s sets': 'Revisando los sets de {0} y {1}',
  'Going through {0} and {1}\'s sets for the full breakdown': 'Revisando los sets de {0} y {1} para el desglose completo',
  'Pick someone else. `/stats` is the one about you.': 'Elige a otra persona. `/stats` es el que habla de ti.',
  'Couldn\'t find a start.gg with {0}\'s Discord connected.\n-# Ask them to run `/link` with their start.gg link once, or to register for a tournament the bot checks. start.gg can\'t be searched by Discord':
    'No encontré un start.gg con el Discord de {0} conectado.\n-# Pídele que use `/link` una vez con su enlace de start.gg, o que se inscriba en un torneo que el bot revise. start.gg no se puede buscar por Discord',
  'Run `/link` with your start.gg first, so the bot knows which one is yours.':
    'Usa `/link` con tu start.gg primero, para que el bot sepa cuál es el tuyo.',
  'That\'s your own start.gg.': 'Ese es tu propio start.gg.',
  'Use the bot in <#{0}>. A TO picks the channel with `/t-o settings channel:`.': 'Usa el bot en <#{0}>. Un TO elige el canal con `/t-o settings channel:`.',
  'A TO needs to pick the bot channel with `/t-o settings channel:` first.': 'Un TO debe elegir primero el canal del bot con `/t-o settings channel:`.',
  'Couldn\'t find a start.gg with your Discord connected. Connect Discord on start.gg, then run `/track add` or `/link` with your profile link first.': 'No encontré una cuenta de start.gg con tu Discord conectado. Conecta Discord en start.gg y usa primero `/track add` o `/link` con el enlace a tu perfil.',
  'Couldn\'t find a start.gg with {0}\'s Discord connected.\n-# Use `/track add` with their start.gg profile link first (TOs can add someone else), or ask them to `/link` it. Connect Discord on start.gg so `user:` can find them': 'No encontré una cuenta de start.gg con el Discord de {0} conectado.\n-# Usa primero `/track add` con el enlace a su perfil de start.gg (los TO pueden agregar a otra persona), o pídele que use `/link`. Conecta Discord en start.gg para que `user:` pueda encontrarla',
  'No start.gg found for that member. Use `/track add` with their profile link, or ask them to `/link` it first.': 'No encontré el start.gg de ese miembro. Usa `/track add` con el enlace a su perfil, o pídele que use `/link` primero.',
};
