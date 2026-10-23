// spanish for everything the bot says, keyed by its english, one file per part of the code. test/i18n.test.js
// fails on a t`` in src with no line here, and on a line here nothing uses anymore
import commands from './es/commands.js';
import definitions from './es/definitions.js';
import embeds from './es/embeds.js';
import fun from './es/fun.js';
import help from './es/help.js';
import settings from './es/settings.js';
import tracker from './es/tracker.js';

export const parts = { commands, definitions, embeds, fun, help, settings, tracker };
export const es = Object.assign({}, ...Object.values(parts));

// count(n, word) in spanish, singular then plural, by the english word
export const nouns = {
  set: ['set', 'sets'],
  game: ['partida', 'partidas'],
  player: ['jugador', 'jugadores'],
  tournament: ['torneo', 'torneos'],
  event: ['evento', 'eventos'],
  entrant: ['participante', 'participantes'],
  hour: ['hora', 'horas'],
  minute: ['minuto', 'minutos'],
  day: ['día', 'días'],
  week: ['semana', 'semanas'],
  second: ['segundo', 'segundos'],
  opponent: ['rival', 'rivales'],
  match: ['partida', 'partidas'],
  bracket: ['bracket', 'brackets'],
  person: ['persona', 'personas'],
  people: ['persona', 'personas'],
  TO: ['TO', 'TOs'],
  link: ['enlace', 'enlaces'],
  request: ['solicitud', 'solicitudes'],
  season: ['temporada', 'temporadas'],
  rating: ['rating', 'ratings'],
  reminder: ['recordatorio', 'recordatorios'],
  win: ['victoria', 'victorias'],
  loss: ['derrota', 'derrotas'],
  member: ['miembro', 'miembros'],
  stream: ['stream', 'streams'],
  partner: ['compañero', 'compañeros'],
  team: ['equipo', 'equipos'],
};
