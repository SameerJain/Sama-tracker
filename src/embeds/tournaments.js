import { escapeMarkdown } from 'discord.js';
import { fromSide, startggUrl } from '../startgg.js';
import { colors, FOOTER, baseEmbed, split, withLines, playerLink, setUrl, ordinal, medal, scoreText, upsetFactor, shortRecord, count } from './shared.js';

const MAJOR_UPSET = 5; // seed 9 beating seed 2

function tournamentEmbed(color, label, tournament) {
  const embed = baseEmbed(color)
    .setAuthor({ name: label })
    .setTitle(tournament.name)
    .setURL(startggUrl(tournament.slug));

  const image = tournament.images?.[0]?.url;
  if (image) embed.setThumbnail(image);
  return embed;
}

// discord shows these in everyone's own timezone
function timeText(seconds) {
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}

function locationText(tournament) {
  if (tournament.isOnline) return 'Online';
  const place = [tournament.city, tournament.addrState].filter(Boolean).join(', ');
  return place || 'Location TBA';
}

function eventTitle(entry) {
  if (!entry.entrants) return entry.event;
  return `${entry.event} · ${entry.entrants} entrants`;
}

function findTracked(side, players) {
  return Object.values(players).find((player) => side.playerIds.includes(player.playerId));
}

function groupByEvent(tournament, players) {
  const entries = tournament.entries.filter((entry) => players[entry.userId])
    .map((entry) => ({ ...entry, player: players[entry.userId] }));
  return [...Map.groupBy(entries, (entry) => entry.eventSlug).values()];
}

function setEmbed(set, color, player) {
  const game = set.event.videogame?.displayName;
  const tournament = set.event.tournament;

  const embed = baseEmbed(color, game ? `${FOOTER} · ${game}` : undefined)
    .setDescription(`**${set.round}** · ${escapeMarkdown(set.event.name)}\n[${escapeMarkdown(tournament.name)}](${startggUrl(tournament.slug)})`);

  if (player) embed.setAuthor({ name: player.tag, iconURL: player.image, url: startggUrl(player.slug) });

  const image = tournament.images?.[0]?.url;
  if (image) embed.setThumbnail(image);
  return embed;
}

export function onStream(set, players) {
  const [a, b] = set.sides;
  const trackedA = findTracked(a, players);
  const [me, them] = trackedA ? [a, b] : [b, a];

  // twitch is the only source with a url we can build, otherwise just the name
  const { streamName, streamSource } = set.stream;
  const twitch = streamSource === 'TWITCH' ? `https://twitch.tv/${streamName}` : null;
  const watch = twitch ? `[twitch.tv/${escapeMarkdown(streamName)}](${twitch})` : escapeMarkdown(streamName);

  return setEmbed(set, colors.stream, trackedA ?? findTracked(b, players))
    .setTitle(`On stream · ${escapeMarkdown(me.name)} vs ${escapeMarkdown(them.name)}`)
    .setURL(twitch ?? setUrl(set))
    .addFields({ name: 'Watch', value: watch });
}

export function setResult(set, players) {
  const [a, b] = set.sides;
  const trackedA = findTracked(a, players);
  const trackedB = findTracked(b, players);
  const clash = Boolean(trackedA && trackedB);

  // tracked player first, or the winner if both are tracked
  const bFirst = clash ? b.id === set.winnerId : !trackedA;
  const me = bFirst ? b : a;
  const them = bFirst ? a : b;
  const player = bFirst ? trackedB : trackedA;
  const won = me.id === set.winnerId;

  let label = won ? 'W' : 'L';
  // DQ wins aren't upsets
  if (won && scoreText(me, them) !== 'DQ' && upsetFactor(me, them) >= MAJOR_UPSET) label = 'Major upset';
  let color = won ? colors.win : colors.loss;
  if (clash) color = colors.clash;

  const embed = setEmbed(set, color, player)
    .setTitle(`${label} · ${escapeMarkdown(me.name)} ${scoreText(me, them)} ${escapeMarkdown(them.name)}`)
    .setURL(setUrl(set))
    .setTimestamp(set.completedAt * 1000);

  const characterLines = [];
  for (const side of [me, them]) {
    if (side.characters.length) {
      characterLines.push(`${escapeMarkdown(side.name)}: ${side.characters.join(', ')}`);
    }
  }
  if (characterLines.length) embed.addFields({ name: 'Characters', value: characterLines.join('\n') });

  return embed;
}

export function rollCall(tournament, players) {
  const lines = [`Starts ${timeText(tournament.startAt)}`, locationText(tournament)];
  for (const entries of groupByEvent(tournament, players)) {
    lines.push('', `**${escapeMarkdown(eventTitle(entries[0]))}**`, ...entries.map((entry) => playerLink(entry.player)));
  }
  return withLines(tournamentEmbed(colors.brand, 'Roll call', tournament), lines);
}

export function regReminder(tournament, deadline, lastCall) {
  const register = startggUrl(`${tournament.slug}/register`);
  const closesFirst = deadline < tournament.startAt;

  const lines = [`## ${closesFirst ? 'Registration closes' : 'Starts'} <t:${deadline}:R>`];
  if (closesFirst) lines.push(`**Closes:** <t:${deadline}:F>`);
  lines.push(`**Starts:** <t:${tournament.startAt}:F>`, `**Location:** ${locationText(tournament)}`);
  if (tournament.numAttendees) lines.push(`**Registered so far:** ${tournament.numAttendees}`);
  lines.push('', `**[Register on start.gg](${register})**`);

  const embed = baseEmbed(lastCall ? colors.reg : colors.regEarly)
    .setAuthor({ name: lastCall ? 'Last call to register' : 'Registration reminder' })
    .setTitle(tournament.name)
    .setURL(register)
    .setDescription(lines.join('\n'));

  // a big picture so it stands out, the logo if there's no banner
  const image = (type) => tournament.images?.find((each) => each.type === type)?.url;
  const banner = image('banner');
  const logo = image('profile');
  if (banner ?? logo) embed.setImage(banner ?? logo);
  if (banner && logo) embed.setThumbnail(logo);
  return embed;
}

const WARNINGS = [
  'This is your official warning',
  'The registration police have been notified',
  'No reg, no bracket',
  'The bracket isn\'t waiting for you',
];

// /reg_warn, for someone whose discord isn't on any registration for it
export function regWarning(tournament, deadline) {
  const register = startggUrl(`${tournament.slug}/register`);
  const lines = [
    `**NOT REGISTERED YET!!!!** Registration closes <t:${deadline}:R>.`,
    '',
    `**[Register on start.gg](${register})**`,
  ];
  const embed = baseEmbed(colors.reg)
    .setAuthor({ name: WARNINGS[Math.floor(Math.random() * WARNINGS.length)] })
    .setTitle(tournament.name)
    .setURL(register)
    .setDescription(lines.join('\n'));
  const logo = tournament.images?.find((image) => image.type === 'profile')?.url;
  if (logo) embed.setThumbnail(logo);
  return embed;
}

// start.gg tag, then their name in the server when it's different. the tag goes in bold when it heads a group
function memberName({ tag, name }, bold = false) {
  const shown = escapeMarkdown(tag ?? name ?? 'Unknown');
  const main = bold ? `**${shown}**` : shown;
  if (!tag || !name || name.toLowerCase() === tag.toLowerCase()) return main;
  return `${main} (${escapeMarkdown(name)})`;
}

// /registered. members are the participants who are in this server, entries say what they're in.
// names, not mentions, so nobody looks called out
export function registered(tournament, members, { byEvent = false } = {}) {
  const lines = [`**Time:** ${timeText(tournament.startAt)}`, `**Location:** ${locationText(tournament)}`];
  const entries = tournament.entries ?? [];
  const sorted = members.toSorted((a, b) => (a.tag ?? '').localeCompare(b.tag ?? ''));
  if (!members.length) lines.push('', 'Nobody from this server yet.');
  else if (byEvent) lines.push(...registeredByEvent(entries, sorted));
  else {
    const events = Map.groupBy(entries, (entry) => entry.userId);
    for (const member of sorted) {
      const entered = events.get(member.userId)?.map((entry) => `- ${escapeMarkdown(entry.event)}`) ?? [];
      // one string per person so a card that runs long never splits someone from their events
      lines.push('', [memberName(member, true), ...entered].join('\n'));
    }
  }
  return withLines(tournamentEmbed(colors.brand, `Registered from this server · ${members.length}`, tournament), lines);
}

// the events with the most people from the server first. a person per line, since one event can be
// most of the server and too long for a single description
function registeredByEvent(entries, members) {
  const lines = [];
  const groups = [...Map.groupBy(entries, (entry) => entry.eventSlug).values()].sort((a, b) => b.length - a.length);
  for (const group of groups) {
    const userIds = new Set(group.map((entry) => entry.userId));
    const people = members.filter((member) => userIds.has(member.userId));
    const { event, entrants } = group[0];
    lines.push('', `**${escapeMarkdown(event)}** · ${entrants ? `${people.length} of ${entrants} entrants` : people.length}`);
    lines.push(...people.map((member) => `- ${memberName(member)}`));
  }
  // registered without entering anything
  const entered = new Set(entries.map((entry) => entry.userId));
  const none = members.filter((member) => !entered.has(member.userId));
  if (none.length) lines.push('', '**Not in an event**', ...none.map((member) => `- ${memberName(member)}`));
  return lines;
}

// one embed per event, best placement first
export function results(tournament, players) {
  return groupByEvent(tournament, players).flatMap((entries) => {
    entries.sort((a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity));
    return withLines(tournamentEmbed(colors.results, `Results · ${eventTitle(entries[0])}`, tournament), entries.map(placementText));
  });
}

// a link to each event's bracket
export function bracket(tournament) {
  const now = Math.floor(Date.now() / 1000);
  const started = tournament.startAt <= now;
  const lines = [`${started ? 'Started' : 'Starts'} <t:${tournament.startAt}:R>`, ''];
  for (const event of tournament.events) lines.push(`[${escapeMarkdown(event.name)}](${startggUrl(`${event.slug}/brackets`)})`);
  return withLines(tournamentEmbed(started ? colors.live : colors.brand, started ? 'Live' : 'Starting soon', tournament), lines);
}

function placementText(entry) {
  let name = playerLink(entry.player);
  if (entry.dq) name += ' (DQ)';
  if (!entry.placement) return `${name} (not reported)`;
  // the worst they can finish, so no medal
  if (!entry.done && !entry.final) return `${ordinal(entry.placement)} ${name} (projected)`;
  return `${medal(entry.placement)}${ordinal(entry.placement)} ${name}`;
}

// a card per tournament so each one gets its own image
export function upcoming(tournaments, players, who) {
  if (!tournaments.length) {
    const nobody = who === 'everyone' ? 'Nobody is' : `${escapeMarkdown(who)} isn't`;
    return [baseEmbed(colors.brand).setTitle(`Upcoming · ${escapeMarkdown(who)}`).setDescription(`${nobody} registered for anything yet.`)];
  }

  const now = Math.floor(Date.now() / 1000);
  const more = tournaments.length > 10 ? ` · next 10 of ${tournaments.length}` : '';
  return tournaments.slice(0, 10).map((tournament) => {
    if (tournament.startAt <= now) return upcomingCard(tournament, players, `Live · ${who}${more}`, colors.live);
    return upcomingCard(tournament, players, `Upcoming · ${who}${more}`, colors.brand);
  });
}

function upcomingCard(tournament, players, label, color) {
  const eventsByUser = new Map();
  for (const entry of tournament.entries) {
    if (!eventsByUser.has(entry.userId)) eventsByUser.set(entry.userId, []);
    eventsByUser.get(entry.userId).push(entry.event);
  }

  const lines = [
    `**Time:** ${timeText(tournament.startAt)}`,
    `**Location:** ${locationText(tournament)}`,
    '**Players:**',
  ];
  for (const [userId, events] of eventsByUser) {
    lines.push(`${playerLink(players[userId])}: ${events.join(', ')}`);
  }

  // a card per tournament, so a big one gets cut off instead of carrying on
  const [shown, ...rest] = split(lines, 4000);
  const hidden = rest.flat().length;
  if (hidden) shown.push(`-# and ${hidden} more`);
  return tournamentEmbed(color, label, tournament).setDescription(shown.join('\n'));
}

// start.gg set states that are still to be played, the one that needs them soonest first:
// in progress, called, queued, ready, then waiting
const UP_NEXT = [2, 6, 7, 4, 1];

const NEXT_TEXT = { 2: 'playing', 6: 'called vs', 7: 'queued vs', 4: 'ready vs', 1: 'next vs' };

// where a run in one event stands. rank sorts the events by how soon they need them
function runStatus(player, { entry, sets }) {
  const played = sets.filter((set) => set.state === 3 && set.winnerId)
    .sort((a, b) => a.completedAt - b.completedAt).map((set) => fromSide(set, player.playerId)).filter(Boolean);
  const finished = entry.done || entry.final || entry.dq;
  const pending = finished ? [] : sets.filter((set) => UP_NEXT.includes(set.state)).sort((a, b) => UP_NEXT.indexOf(a.state) - UP_NEXT.indexOf(b.state));
  const next = pending.map((set) => fromSide(set, player.playerId)).find(Boolean);
  let rank = UP_NEXT.length;
  if (next) rank = UP_NEXT.indexOf(next.set.state);
  else if (!entry.started) rank += 1;
  else if (finished) rank += 2;
  return { entry, played, finished, next, rank };
}

// called vs **Foo** · Winners Round 2, linked
function nextText({ set, them }) {
  const round = set.round ? ` · [${escapeMarkdown(set.round)}](${setUrl(set)})` : '';
  return `${NEXT_TEXT[set.state]} **${escapeMarkdown(them.name)}**${round}`;
}

function statusText({ entry, finished }) {
  if (entry.dq) return 'Disqualified';
  if (finished) return entry.placement ? `Finished ${medal(entry.placement)}${ordinal(entry.placement)}${entry.entrants ? ` of ${entry.entrants}` : ''}` : 'Finished, placement pending';
  if (!entry.started) return 'Hasn\'t started yet';
  return 'Still in the bracket';
}

// the overview says what's next for the ones still going
function overviewText(status) {
  if (status.finished || !status.entry.started) return statusText(status).replace(/^./, (letter) => letter.toLowerCase());
  return status.next ? nextText(status.next) : 'waiting for the next opponent';
}

// one event's sets so far and what's next
function runLines(status) {
  const lines = status.played.map(({ set, me, them, won }) => {
    const round = set.round ? ` · [${escapeMarkdown(set.round)}](${setUrl(set)})` : '';
    return `**${won ? 'W' : 'L'}** ${scoreText(me, them)} vs **${escapeMarkdown(them.name)}**${round}`;
  });
  if (!lines.length && status.entry.started) lines.push('No completed sets reported yet.');
  if (status.finished || !status.entry.started) return lines;
  return [...lines, '', status.next ? `**Next:** ${nextText(status.next)}` : 'Next opponent has not been assigned yet.'];
}

// runs is { entry, sets } for each event they're in at the tournament. someone in several brackets goes back
// and forth between them, so those get a card up top with the one that needs them soonest first
export function run(player, tournament, runs) {
  const statuses = runs.map((each) => runStatus(player, each)).sort((a, b) => a.rank - b.rank);
  if (statuses.length === 1) {
    const [status] = statuses;
    const lines = [`**${escapeMarkdown(eventTitle(status.entry))}**`, statusText(status), '', ...runLines(status)];
    return withLines(tournamentEmbed(colors.live, `${player.tag}'s run`, tournament), lines);
  }

  const overview = statuses.map((status) => {
    const record = status.played.length ? ` (${shortRecord(status.played)})` : '';
    return `**${escapeMarkdown(status.entry.event)}**${record} · ${overviewText(status)}`;
  });
  overview.push('-# The one that needs you soonest is first');
  const cards = withLines(tournamentEmbed(colors.live, `${player.tag}'s run · ${count(statuses.length, 'bracket')}`, tournament), overview);
  for (const status of statuses.filter(({ entry }) => entry.started)) {
    const card = baseEmbed(colors.live).setTitle(escapeMarkdown(eventTitle(status.entry))).setURL(startggUrl(status.entry.eventSlug));
    cards.push(...withLines(card, [statusText(status), '', ...runLines(status)]));
  }
  return cards;
}
