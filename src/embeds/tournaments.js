import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { fromSide, startggUrl } from '../startgg.js';
import { colors, FOOTER, baseEmbed, split, withLines, playerLink, setUrl, vodLink, ordinal, medal, scoreText, upsetFactor, shortRecord, count } from './shared.js';

const MAJOR_UPSET = 7; // seed 13 beating seed 1, or seed 17 beating seed 2

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

  // the player's picture big when the tournament has none
  const image = tournament.images?.[0]?.url ?? player?.image;
  if (image) embed.setThumbnail(image);
  return embed;
}

// heads a /messages threads thread in the channel. tournament is the one sets carry under event
export function tournamentThread(tournament) {
  return tournamentEmbed(colors.brand, 'Tournament thread', tournament)
    .setDescription('Set results and stream alerts from this tournament go in the thread.');
}

// heads one event's thread with /messages threads set to one per event
export function eventThread(event) {
  const game = event.videogame?.displayName;
  return tournamentEmbed(colors.brand, 'Event thread', event.tournament)
    .setDescription(`**${escapeMarkdown(event.name)}**${game ? ` · ${game}` : ''}\nSet results and stream alerts from this event go in the thread.`);
}

export function onStream(set, players) {
  const [a, b] = set.sides;
  const trackedA = findTracked(a, players);
  const [me, them] = trackedA ? [a, b] : [b, a];

  // twitch is the only source with a url we can build, otherwise just the name
  const { streamName, streamSource } = set.stream ?? {};
  const twitch = streamSource === 'TWITCH' && streamName ? `https://twitch.tv/${encodeURIComponent(streamName)}` : null;
  const watch = streamName ? (twitch ? `[twitch.tv/${escapeMarkdown(streamName)}](${twitch})` : escapeMarkdown(streamName)) : null;

  const card = setEmbed(set, colors.stream, trackedA ?? findTracked(b, players))
    .setTitle(`Stream alert · ${escapeMarkdown(me.name)} vs ${escapeMarkdown(them.name)}`)
    .setURL(twitch ?? setUrl(set));
  if (watch) card.addFields({ name: 'Watch', value: watch });
  return card;
}

// a called set for someone with match call pings on. both sides can be tracked, still one card.
// doubles shows the team names the way start.gg reports them
export function matchCall(set, players) {
  const [a, b] = set.sides;
  const trackedA = findTracked(a, players);
  const [me, them] = trackedA ? [a, b] : [b, a];

  return setEmbed(set, colors.live, trackedA ?? findTracked(b, players))
    .setTitle(`Match call · ${escapeMarkdown(me.name)} vs ${escapeMarkdown(them.name)}`)
    .setURL(setUrl(set));
}

export function setResult(set, players) {
  const [a, b] = set.sides;
  const trackedA = findTracked(a, players);
  const trackedB = findTracked(b, players);
  const clash = Boolean(trackedA && trackedB);

  // winner on the left with the W, loser on the right with the L, whoever is tracked
  const bWon = b.id === set.winnerId;
  const winner = bWon ? b : a;
  const loser = bWon ? a : b;
  // the card is still about the tracked one: their picture, and green or red for how they did
  const player = (bWon ? trackedB : trackedA) ?? (bWon ? trackedA : trackedB);
  const trackedWon = Boolean(bWon ? trackedB : trackedA);
  let color = trackedWon ? colors.win : colors.loss;
  if (clash) color = colors.clash;
  // nobody tracked, from a tracked tournament, so it's nobody's win or loss
  if (!trackedA && !trackedB) color = colors.brand;

  const embed = setEmbed(set, color, player)
    .setTitle(`Set result · W · ${escapeMarkdown(winner.name)} ${scoreText(winner, loser)} ${escapeMarkdown(loser.name)} · L`)
    .setURL(setUrl(set))
    .setTimestamp(set.completedAt * 1000);
  // DQ wins aren't upsets
  if (scoreText(winner, loser) !== 'DQ' && upsetFactor(winner, loser) >= MAJOR_UPSET) {
    embed.setDescription(`**Major upset** · seed ${winner.seed} beat seed ${loser.seed}\n${embed.data.description}`);
  }

  const characterLines = [];
  for (const side of [winner, loser]) {
    if (side.characters.length) {
      characterLines.push(`${escapeMarkdown(side.name)}: ${side.characters.join(', ')}`);
    }
  }
  if (characterLines.length) embed.addFields({ name: 'Characters', value: characterLines.join('\n') });
  // a ) would end the link early, same as the inline VOD links
  if (set.vod) embed.addFields({ name: 'VOD', value: `[Watch the VOD](${set.vod.replaceAll('(', '%28').replaceAll(')', '%29')})` });

  return embed;
}

// a set result card edited in after the TO changed the winner or score, or reported a reset set again
export function correctedResult(set, players) {
  const embed = setResult(set, players);
  return embed.setDescription(`**Corrected by TO**\n${embed.data.description}`);
}

// a set result card the TO reset or deleted after it went out. posted is the card as discord has it, kept
// as it was with the result marked, since start.gg no longer has the result to build it from
export function resetResult(posted) {
  const embed = EmbedBuilder.from(posted).setColor(colors.reset);
  if (posted.title && !posted.title.startsWith('Reset by TO')) embed.setTitle(`Reset by TO · ${posted.title}`.slice(0, 256));
  return embed.setDescription(`${posted.description ?? ''}\n-# The TO reset this set on start.gg. This card changes if it's reported again within an hour of the first result`.trim());
}

export function rollCall(tournament, players) {
  const lines = [`Starts ${timeText(tournament.startAt)}`, locationText(tournament)];
  for (const entries of groupByEvent(tournament, players)) {
    lines.push('', `**${escapeMarkdown(eventTitle(entries[0]))}**`, ...entries.map((entry) => playerLink(entry.player)));
  }
  return withLines(tournamentEmbed(colors.brand, 'Tournament roll call', tournament)
    .setTitle(`Tournament roll call · ${tournament.name}`.slice(0, 256)), lines);
}

export function regReminder(tournament, deadline, lastCall) {
  const register = startggUrl(`${tournament.slug}/register`);
  const closesFirst = deadline < tournament.startAt;
  // a late post reads wrong in present tense, like closes 21 hours ago
  const closed = deadline <= Math.floor(Date.now() / 1000);

  const lines = [`## ${closesFirst ? (closed ? 'Registration closed' : 'Registration closes') : 'Starts'} <t:${deadline}:R>`];
  if (closesFirst) lines.push(`**${closed ? 'Closed' : 'Closes'}:** <t:${deadline}:F>`);
  lines.push(`**Starts:** <t:${tournament.startAt}:F>`, `**Location:** ${locationText(tournament)}`);
  if (tournament.numAttendees) lines.push(`**Registered so far:** ${tournament.numAttendees}`);
  lines.push('', `**[Register on start.gg](${register})**`);

  const embed = baseEmbed(lastCall ? colors.reg : colors.regEarly)
    .setAuthor({ name: lastCall ? 'Last call to register' : 'Registration reminder' })
    .setTitle(`Registration reminder · ${tournament.name}`.slice(0, 256))
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
    return withLines(tournamentEmbed(colors.results, `Results · ${eventTitle(entries[0])}`, tournament)
      .setTitle(`Tournament placements · ${tournament.name}`.slice(0, 256)), entries.map(placementText));
  });
}

// the event's own top 8, everyone in it whether they're tracked or not. one card per event
export function topEight(tournament, events) {
  return events.map((event) => {
    const lines = event.standings.map((standing) => {
      const name = escapeMarkdown(standing.name);
      if (!event.done && !standing.final) return `${ordinal(standing.placement)} ${name} (projected)`;
      return `${medal(standing.placement)}${ordinal(standing.placement)} ${name}`;
    });
    if (!lines.length) lines.push('No placements reported on start.gg.');
    else if (!event.done) lines.push('-# The bracket wasn\'t finished on start.gg, so unfinished placements are projected');
    return tournamentEmbed(colors.results, `Top 8 · ${eventTitle(event)}`, tournament)
      .setTitle(`Top 8 · ${tournament.name}`.slice(0, 256))
      .setURL(startggUrl(`${event.eventSlug}/standings`))
      .setDescription(lines.join('\n'));
  });
}

// a link to each event's bracket
export function bracket(tournament) {
  const now = Math.floor(Date.now() / 1000);
  const started = tournament.startAt <= now;
  const lines = [`${started ? 'Started' : 'Starts'} <t:${tournament.startAt}:R>`, ''];
  // a tracked tournament gets its events at the first tournament check
  for (const event of tournament.events ?? []) lines.push(`[${escapeMarkdown(event.name)}](${startggUrl(`${event.slug}/brackets`)})`);
  return withLines(tournamentEmbed(started ? colors.live : colors.brand, started ? 'Live' : 'Starting soon', tournament), lines);
}

// /stream_link. start.gg only says which site a stream is on, and twitch is the only one its name makes a link for
export function streamLinks(tournament, streams) {
  const now = Math.floor(Date.now() / 1000);
  const started = tournament.startAt <= now;
  const lines = [`${started ? 'Started' : 'Starts'} <t:${tournament.startAt}:R>`, ''];
  for (const { name, source } of streams) {
    if (source === 'TWITCH') lines.push(`[twitch.tv/${escapeMarkdown(name)}](https://twitch.tv/${encodeURIComponent(name)})`);
    else lines.push(`${escapeMarkdown(name)}${source ? ` (${source.charAt(0)}${source.slice(1).toLowerCase()})` : ''}`);
  }
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

// a card per tournament so each one gets its own image. minimum is how many of the crew
// a tournament needs to list, for the empty answer
export function upcoming(tournaments, players, who, { minimum = 0 } = {}) {
  if (!tournaments.length) {
    const description = minimum > 1
      ? (who === 'everyone'
        ? `No upcoming tournament has ${minimum} or more of the crew registered yet.`
        : `${escapeMarkdown(who)} has no upcoming tournament with ${minimum} or more of the crew registered yet.`)
      : `${who === 'everyone' ? 'Nobody is' : `${escapeMarkdown(who)} isn't`} registered for anything yet.`;
    return [baseEmbed(colors.brand).setTitle(`Upcoming · ${escapeMarkdown(who)}`).setDescription(description)];
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
    // a tracked tournament shows before anyone from the crew signs up
    eventsByUser.size ? '**Players:**' : 'Nobody from the crew registered yet.',
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

const NEXT_TEXT = { 2: 'playing vs', 6: 'called vs', 7: 'queued vs', 4: 'ready vs', 1: 'next vs' };

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

// called vs **Foo** · Winners Round 2 · **Station 4**, linked. start.gg fills startAt from the round's
// schedule when the set has none, so a time already gone by is the pool's start and gets left out.
// discord shows the time in each viewer's own timezone
function nextText({ set, them }, now) {
  const round = set.round ? ` · [${escapeMarkdown(set.round)}](${setUrl(set)})` : '';
  const station = set.station ? ` · **Station ${set.station}**` : '';
  const time = set.state !== 2 && set.startAt > now ? ` · <t:${set.startAt}:t>` : '';
  return `${NEXT_TEXT[set.state]} **${escapeMarkdown(them.name)}**${round}${station}${time}`;
}

function statusText({ entry, finished }) {
  if (entry.dq) return 'Disqualified';
  if (finished) return entry.placement ? `Finished ${medal(entry.placement)}${ordinal(entry.placement)}${entry.entrants ? ` of ${entry.entrants}` : ''}` : 'Finished, placement pending';
  if (!entry.started) return 'Hasn\'t started yet';
  return 'Still in the bracket';
}

// the overview says what's next for the ones still going
function overviewText(status, now) {
  if (status.finished || !status.entry.started) return statusText(status).replace(/^./, (letter) => letter.toLowerCase());
  return status.next ? nextText(status.next, now) : 'waiting for the next opponent';
}

// one event's sets so far and what's next. completed sets link their VOD when the TO added one
function runLines(status, now) {
  const lines = status.played.map(({ set, me, them, won }) => {
    const round = set.round ? ` · [${escapeMarkdown(set.round)}](${setUrl(set)})` : '';
    return `**${won ? 'W' : 'L'}** ${scoreText(me, them)} vs **${escapeMarkdown(them.name)}**${round}${vodLink(set)}`;
  });
  if (!lines.length && status.entry.started) lines.push('No completed sets reported yet.');
  if (status.finished || !status.entry.started) return lines;
  return [...lines, '', status.next ? `**Next:** ${nextText(status.next, now)}` : 'Next opponent has not been assigned yet.'];
}

// runs is { entry, sets } for each event they're in at the tournament. someone in several brackets goes back
// and forth between them, so those get a card up top with the one that needs them soonest first
export function run(player, tournament, runs, now = Math.floor(Date.now() / 1000)) {
  const statuses = runStatuses(player, runs);
  if (statuses.length === 1) {
    const [status] = statuses;
    const lines = [`**${escapeMarkdown(eventTitle(status.entry))}**`, statusText(status), '', ...runLines(status, now)];
    return withLines(tournamentEmbed(colors.live, `${player.tag}'s run`, tournament), lines);
  }

  const overview = statuses.map((status) => {
    const record = status.played.length ? ` (${shortRecord(status.played)})` : '';
    return `**${escapeMarkdown(status.entry.event)}**${record} · ${overviewText(status, now)}`;
  });
  overview.push('-# The one that needs you soonest is first');
  const cards = withLines(tournamentEmbed(colors.live, `${player.tag}'s run · ${count(statuses.length, 'bracket')}`, tournament), overview);
  for (const status of statuses.filter(({ entry }) => entry.started)) {
    const card = baseEmbed(colors.live).setTitle(escapeMarkdown(eventTitle(status.entry))).setURL(startggUrl(status.entry.eventSlug));
    const image = tournament.images?.[0]?.url;
    if (image) card.setThumbnail(image);
    cards.push(...withLines(card, [statusText(status), '', ...runLines(status, now)]));
  }
  return cards;
}

const runStatuses = (player, runs) => runs.map((each) => runStatus(player, each)).sort((a, b) => a.rank - b.rank);

// who they play next in each bracket, soonest first, for /run's head-to-head buttons. singles only
export function nextOpponents(player, runs) {
  return runStatuses(player, runs).map((status) => status.next)
    .filter((next) => next && next.set.sides.every((side) => side.playerIds.length === 1));
}
