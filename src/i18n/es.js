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

// count(n, word) in spanish, singular then plural, by the english word. a "more" word goes before "not shown" or "linked"
export const nouns = {
  set: ['set', 'sets'],
  game: ['partida', 'partidas'],
  player: ['jugador', 'jugadores'],
  'tracked player': ['jugador seguido', 'jugadores seguidos'],
  'active player': ['jugador activo', 'jugadores activos'],
  'ranked player': ['jugador con rango', 'jugadores con rango'],
  'more player': ['jugador más', 'jugadores más'],
  'more ranked player': ['jugador más con rango', 'jugadores más con rango'],
  'more person': ['persona más vinculada', 'personas más vinculadas'],
  'more character': ['personaje más', 'personajes más'],
  tournament: ['torneo', 'torneos'],
  event: ['evento', 'eventos'],
  bracket: ['bracket', 'brackets'],
  opponent: ['rival', 'rivales'],
  rating: ['rating', 'ratings'],
  'singles set': ['set de singles', 'sets de singles'],
  'doubles set': ['set de dobles', 'sets de dobles'],
  'seeded set': ['set con seed', 'sets con seed'],
  'older set': ['set anterior', 'sets anteriores'],
  'ranked set': ['set de ranked', 'sets de ranked'],
  DQ: ['DQ', 'DQs'],
  request: ['consulta', 'consultas'],
  second: ['segundo', 'segundos'],
  minute: ['minuto', 'minutos'],
  hour: ['hora', 'horas'],
  day: ['día', 'días'],
};
