import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { fromSide, startggUrl } from '../startgg.js';
import {
  colors, FOOTER, baseEmbed, split, withLines, playerLink, setUrl, vodLink, ordinal, medal, scoreText, upsetFactor, MAJOR_UPSET, shortRecord, count, venueText, mapUrl, bold, t, listOf,
} from './shared.js';

function tournamentEmbed(color, label, tournament) {
  const embed = baseEmbed(color)
    .setAuthor({ name: label })
    .setTitle(escapeMarkdown(tournament.name))
    .setURL(startggUrl(tournament.slug));

  const image = tournament.images?.[0]?.url;
  if (image) embed.setThumbnail(image);
  return embed;
}

// discord shows these in everyone's own timezone
function timeText(seconds) {
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}

// the venue and its street address when the TO put them on start.gg, linked to a map, otherwise the city.
// brackets come out of the link text so a venue name can't break the link
function locationText(tournament) {
  if (tournament.isOnline) return t('Online');
  const place = [tournament.city, tournament.addrState].filter(Boolean).join(', ');
  const venue = venueText(tournament);
  const address = tournament.venueAddress?.trim();
  if (address) return `[${escapeMarkdown(venue.replace(/[[\]]/g, ''))}](${mapUrl(address)})`;
  if (venue) return [escapeMarkdown(venue), place].filter(Boolean).join(', ');
  return place || t('Location TBA');
}

function eventTitle(entry) {
  if (!entry.entrants) return entry.event;
  return t`${entry.event} · ${entry.entrants} entrants`;
}

function findTracked(side, players) {
  return Object.values(players).find((player) => side.playerIds.includes(player.playerId));
}

function groupByEvent(tournament, players) {
  const entries = tournament.entries.filter((entry) => players[entry.userId])
    .map((entry) => ({ ...entry, player: players[entry.userId] }));
  return [...Map.groupBy(entries, (entry) => entry.eventSlug).values()];
}

function setEmbed(set, color, player, { author = true } = {}) {
  const game = set.event.videogame?.displayName;
  const tournament = set.event.tournament;

  const embed = baseEmbed(color, game ? `${FOOTER} · ${game}` : undefined)
    .setDescription(`**${set.round}** · ${escapeMarkdown(set.event.name)}\n[${escapeMarkdown(tournament.name)}](${startggUrl(tournament.slug)})`);

  if (player && author) embed.setAuthor({ name: player.tag, iconURL: player.image, url: startggUrl(player.slug) });

  // the player's picture big when the tournament has none
  const image = tournament.images?.[0]?.url ?? player?.image;
  if (image) embed.setThumbnail(image);
  return embed;
}

// heads a /t-o settings threads thread in the channel. tournament is the one sets carry under event
export function tournamentThread(tournament) {
  return tournamentEmbed(colors.thread, t('Tournament thread'), tournament)
    .setDescription(t('Set results and stream alerts from this tournament go in the thread.'));
}

// heads one event's thread with /t-o settings threads set to one per event
export function eventThread(event) {
  const game = event.videogame?.displayName;
  return tournamentEmbed(colors.thread, t('Event thread'), event.tournament)
    .setDescription(`**${escapeMarkdown(event.name)}**${game ? ` · ${game}` : ''}\n${t('Set results and stream alerts from this event go in the thread.')}`);
}

export function onStream(set, players) {
  const [a, b] = set.sides;
  const trackedA = findTracked(a, players);
  const [me, them] = trackedA ? [a, b] : [b, a];

  // twitch is the only source with a url we can build, otherwise just the name
  const { streamName, streamSource } = set.stream ?? {};
  const twitch = streamSource === 'TWITCH' && streamName ? `https://twitch.tv/${encodeURIComponent(streamName)}` : null;
  const watch = streamName ? (twitch ? `[twitch.tv/${escapeMarkdown(streamName)}](${twitch})` : escapeMarkdown(streamName)) : null;

  const card = setEmbed(set, colors.stream, trackedA ?? findTracked(b, players), { author: false })
    .setTitle(t`Stream alert · ${escapeMarkdown(me.name)} vs ${escapeMarkdown(them.name)}`)
    .setURL(twitch ?? setUrl(set));
  if (watch) card.addFields({ name: t('Watch'), value: watch });
  return card;
}

// a called set for someone with match call pings on. both sides can be tracked, still one card.
// doubles shows the team names the way start.gg reports them. the station shows only when the TO set one
export function matchCall(set, players) {
  const [a, b] = set.sides;
  const trackedA = findTracked(a, players);
  const [me, them] = trackedA ? [a, b] : [b, a];

  const card = setEmbed(set, colors.live, trackedA ?? findTracked(b, players))
    .setTitle(t`Match call · ${escapeMarkdown(me.name)} vs ${escapeMarkdown(them.name)}`)
    .setURL(setUrl(set));
  if (set.station) {
    const [first, ...rest] = (card.data.description ?? '').split('\n');
    card.setDescription([t`${first} · **${t('Station')} ${set.station}**`, ...rest].join('\n'));
  }
  return card;
}

export function setResult(set, players, { setColors = false } = {}) {
  const [a, b] = set.sides;
  const trackedA = findTracked(a, players);
  const trackedB = findTracked(b, players);

  // winner on the left with the W, loser on the right with the L, whoever is tracked
  const bWon = b.id === set.winnerId;
  const winner = bWon ? b : a;
  const loser = bWon ? a : b;
  // no author, the title already names both sides. the thumbnail still falls back to the tracked player's picture
  const winnerTracked = bWon ? trackedB : trackedA;
  const player = winnerTracked ?? (bWon ? trackedA : trackedB);

  const embed = setEmbed(set, setColors ? resultColor(trackedA, trackedB, bWon) : colors.setDefault, player, { author: false })
    .setTitle(t`Set result · ${t('W')} · ${escapeMarkdown(winner.name)} ${scoreText(winner, loser)} ${escapeMarkdown(loser.name)} · ${t('L')}`)
    .setURL(setUrl(set))
    .setTimestamp(set.completedAt * 1000);
  // DQ wins aren't upsets
  if (scoreText(winner, loser) !== 'DQ' && upsetFactor(winner, loser) >= MAJOR_UPSET) {
    embed.setDescription(`${t`**Major upset** · seed ${winner.seed} beat seed ${loser.seed}`}\n${embed.data.description}`);
  }

  const characterLines = [];
  for (const side of [winner, loser]) {
    if (side.characters.length) {
      characterLines.push(`${escapeMarkdown(side.name)}: ${side.characters.map(escapeMarkdown).join(', ')}`);
    }
  }
  if (characterLines.length) embed.addFields({ name: t('Characters'), value: characterLines.join('\n') });
  // a ) would end the link early, same as the inline VOD links
  if (set.vod) embed.addFields({ name: t('VOD'), value: `[${t('Watch the VOD')}](${set.vod.replaceAll('(', '%28').replaceAll(')', '%29')})` });

  return embed;
}

// green when someone tracked won, red when they lost, gold when two tracked players met,
// blue when nobody tracked played
function resultColor(trackedA, trackedB, bWon) {
  if (!trackedA && !trackedB) return colors.setDefault;
  if (trackedA && trackedB) return colors.clash;
  return (bWon ? trackedB : trackedA) ? colors.win : colors.loss;
}

// a set result card edited in after the TO changed the winner or score, or reported a reset set again
export function correctedResult(set, players, options) {
  const embed = setResult(set, players, options);
  return embed.setDescription(`${t('**Corrected by TO**')}\n${embed.data.description}`);
}

// a set result card the TO reset or deleted after it went out. posted is the card as discord has it, kept
// as it was with the result marked, since start.gg no longer has the result to build it from
export function resetResult(posted) {
  const embed = EmbedBuilder.from(posted).setColor(colors.reset);
  const prefix = t('Reset by TO');
  if (posted.title && !posted.title.startsWith(prefix)) embed.setTitle(`${prefix} · ${posted.title}`.slice(0, 256));
  return embed.setDescription(`${posted.description ?? ''}\n${t('-# The TO reset this set on start.gg. This card changes if it\'s reported again within an hour of the first result')}`.trim());
}

// streams are the ones on its start.gg page, [{ name, source }]
export function rollCall(tournament, players, streams = []) {
  const lines = [t`Starts ${timeText(tournament.startAt)}`, locationText(tournament)];
  if (streams.length) lines.push(t`**Streams:** ${streams.map(streamText).join(' · ')}`);
  for (const entries of groupByEvent(tournament, players)) {
    lines.push('', `**${escapeMarkdown(eventTitle(entries[0]))}**`, ...entries.map((entry) => playerLink(entry.player)));
  }
  return withLines(tournamentEmbed(colors.brand, t('Tournament roll call'), tournament)
    .setTitle(t`Tournament roll call · ${escapeMarkdown(tournament.name)}`.slice(0, 256)), lines);
}

// a big picture so a reminder stands out: the banner with the logo beside it, or the logo alone
function withBanner(embed, tournament) {
  const image = (type) => tournament.images?.find((each) => each.type === type)?.url;
  const banner = image('banner');
  const logo = image('profile');
  if (banner ?? logo) embed.setImage(banner ?? logo);
  if (banner && logo) embed.setThumbnail(logo);
  return embed;
}

export function regReminder(tournament, deadline, lastCall) {
  const register = startggUrl(`${tournament.slug}/register`);
  const closesFirst = deadline < tournament.startAt;
  // a late post reads wrong in present tense, like closes 21 hours ago
  const closed = deadline <= Math.floor(Date.now() / 1000);

  const head = closesFirst ? (closed ? t('Registration closed') : t('Registration closes')) : t('Starts');
  const lines = [`## ${head} <t:${deadline}:R>`];
  if (closesFirst) lines.push(t`**${closed ? t('Closed') : t('Closes')}:** <t:${deadline}:F>`);
  lines.push(t`**Starts:** <t:${tournament.startAt}:F>` , t`**Location:** ${locationText(tournament)}`);
  if (tournament.numAttendees) lines.push(t`**Registered so far:** ${tournament.numAttendees}`);
  lines.push('', t`**[Register on start.gg](${register})**`);

  const embed = baseEmbed(lastCall ? colors.reg : colors.regEarly)
    .setAuthor({ name: lastCall ? t('Last call to register') : t('Registration reminder') })
    .setTitle(t`Registration reminder · ${escapeMarkdown(tournament.name)}`.slice(0, 256))
    .setURL(register)
    .setDescription(lines.join('\n'));
  return withBanner(embed, tournament);
}

// DM 1 hour before the start, with the same picture, link and location as the reg reminder
export function startReminder(tournament) {
  const page = startggUrl(tournament.slug);
  const register = startggUrl(`${tournament.slug}/register`);
  const lines = [t`## Starts <t:${tournament.startAt}:R>`, t`**Starts:** <t:${tournament.startAt}:F>`, t`**Location:** ${locationText(tournament)}`];
  if (tournament.numAttendees) lines.push(t`**Registered so far:** ${tournament.numAttendees}`);
  lines.push('', t`**[Tournament page on start.gg](${page})**`);
  if (tournament.isRegistrationOpen !== false) lines.push(t`**[Register on start.gg](${register})**`);

  // a reminder like the reg ones, not a live card. it hasn't started yet
  const embed = baseEmbed(colors.regEarly)
    .setAuthor({ name: t('Tournament starts soon') })
    .setTitle(t`Starts soon · ${escapeMarkdown(tournament.name)}`.slice(0, 256))
    .setURL(page)
    .setDescription(lines.join('\n'));
  return withBanner(embed, tournament);
}

const WARNINGS = [
  'This is your official warning',
  'The registration police have been notified',
  'No reg, no bracket',
  'The bracket isn\'t waiting for you',
  'Registration won\'t wait for you',
  'Registration closes with or without you',
  'The bracket moves on without you',
  'Your seat isn\'t saved yet',
  'Don\'t sit this one out',
  'Your friend sent this warning',
  'Someone thinks you forgot to reg',
  'The clock is ticking on reg',
  'Don\'t let the cap fill without you',
  'Bracket starts with or without you',
  'Don\'t be that guy',
  'Bruh wya',
  'You don\'t have top player privilege to reg late',
  'reg now and you won\'t be seeded against steve',
  'reg u fool',
];

// /reg_warn, for someone whose discord isn't on any registration for it
export function regWarning(tournament, deadline) {
  const register = startggUrl(`${tournament.slug}/register`);
  const lines = [
    t`**NOT REGISTERED YET!!!!** Registration closes <t:${deadline}:R>.`,
    '',
    t`**[Register on start.gg](${register})**`,
  ];
  const embed = baseEmbed(colors.reg)
    .setAuthor({ name: t(WARNINGS[Math.floor(Math.random() * WARNINGS.length)]) })
    .setTitle(escapeMarkdown(tournament.name))
    .setURL(register)
    .setDescription(lines.join('\n'));
  const logo = tournament.images?.find((image) => image.type === 'profile')?.url;
  if (logo) embed.setThumbnail(logo);
  return embed;
}

// start.gg tag, then their name in the server when it's different. the tag goes in bold when it heads a group
function memberName({ tag, name }, highlight = false) {
  const shown = escapeMarkdown(tag ?? name ?? t('Unknown'));
  const main = highlight ? `**${shown}**` : shown;
  if (!tag || !name || name.toLowerCase() === tag.toLowerCase()) return main;
  return `${main} (${escapeMarkdown(name)})`;
}

// /registered. members are the participants who are in this server, entries say what they're in.
// names, not mentions, so nobody looks called out
export function registered(tournament, members, { byEvent = false } = {}) {
  const lines = [t`**Time:** ${timeText(tournament.startAt)}`, t`**Location:** ${locationText(tournament)}`];
  const entries = tournament.entries ?? [];
  const sorted = members.toSorted((a, b) => (a.tag ?? '').localeCompare(b.tag ?? ''));
  if (!members.length) lines.push('', t('Nobody from this server yet.'));
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
    lines.push('', entrants ? t`**${escapeMarkdown(event)}** · ${people.length} of ${entrants} entrants` : t`**${escapeMarkdown(event)}** · ${people.length}`);
    lines.push(...people.map((member) => `- ${memberName(member)}`));
  }
  // registered without entering anything
  const entered = new Set(entries.map((entry) => entry.userId));
  const none = members.filter((member) => !entered.has(member.userId));
  if (none.length) lines.push('', t('**Not in an event**'), ...none.map((member) => `- ${memberName(member)}`));
  return lines;
}

// one embed per event, best placement first. notable upset wins saved while sets posted go under the placements
export function results(tournament, players) {
  return groupByEvent(tournament, players).flatMap((entries) => {
    entries.sort((a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity));
    const lines = entries.map(placementText);
    const upsets = (tournament.notableUpsets ?? []).filter((upset) => upset.eventSlug === entries[0].eventSlug)
      .sort((a, b) => b.factor - a.factor).slice(0, 3).map((upset) => upsetText(upset, players));
    if (upsets.length) lines.push('', ...upsets);
    return withLines(tournamentEmbed(colors.results, t`Results · ${eventTitle(entries[0])}`, tournament)
      .setTitle(t`Tracked players' results from ${escapeMarkdown(tournament.name)}`.slice(0, 256)), lines);
  });
}

// a tracked player's notable upset win. the loser links too when they're also tracked
function upsetText(upset, players) {
  const winner = players[upset.winnerUserId] ? playerLink(players[upset.winnerUserId]) : bold(upset.winnerName);
  const loser = upset.loserUserId && players[upset.loserUserId] ? playerLink(players[upset.loserUserId]) : bold(upset.loserName);
  const score = upset.winnerScore == null || upset.loserScore == null ? '' : ` ${upset.winnerScore}-${upset.loserScore}`;
  const round = upset.round ? ` · [${escapeMarkdown(upset.round)}](${startggUrl(`${upset.eventSlug}/set/${upset.setId}`)})` : '';
  return t`**Notable upset:** ${winner} beat ${loser} (seed ${upset.loserSeed})${score} as seed ${upset.winnerSeed}${round}`;
}

// the event's own top 8, everyone in it whether they're tracked or not. one card per event
export function topEight(tournament, events) {
  return events.map((event) => {
    const lines = event.standings.map((standing) => {
      const name = escapeMarkdown(standing.name);
      if (!event.done && !standing.final) return t`${ordinal(standing.placement)} ${name} (projected)`;
      return `${medal(standing.placement)}${ordinal(standing.placement)} ${name}`;
    });
    if (!lines.length) lines.push(t('No placements reported on start.gg.'));
    else if (!event.done) lines.push(t('-# The bracket wasn\'t finished on start.gg, so unfinished placements are projected'));
    return tournamentEmbed(colors.results, t`Top 8 · ${eventTitle(event)}`, tournament)
      .setTitle(t`Top 8 from ${escapeMarkdown(tournament.name)}`.slice(0, 256))
      .setURL(startggUrl(`${event.eventSlug}/standings`))
      .setDescription(lines.join('\n'));
  });
}

// a link to each event's bracket
export function bracket(tournament) {
  const now = Math.floor(Date.now() / 1000);
  const started = tournament.startAt <= now;
  const lines = [t`${started ? t('Started') : t('Starts')} <t:${tournament.startAt}:R>`, ''];
  // a tracked tournament gets its events at the first tournament check
  for (const event of tournament.events ?? []) lines.push(`[${escapeMarkdown(event.name)}](${startggUrl(`${event.slug}/brackets`)})`);
  return withLines(tournamentEmbed(started ? colors.live : colors.brand, started ? t('Live') : t('Starting soon'), tournament), lines);
}

// start.gg only says which site a stream is on, and twitch is the only one its name makes a link for
function streamText({ name, source }) {
  if (source === 'TWITCH') return `[twitch.tv/${escapeMarkdown(name)}](https://twitch.tv/${encodeURIComponent(name)})`;
  return `${escapeMarkdown(name)}${source ? ` (${source.charAt(0)}${source.slice(1).toLowerCase()})` : ''}`;
}

// /stream_link
export function streamLinks(tournament, streams) {
  const now = Math.floor(Date.now() / 1000);
  const started = tournament.startAt <= now;
  const lines = [t`${started ? t('Started') : t('Starts')} <t:${tournament.startAt}:R>`, '', ...streams.map(streamText)];
  return withLines(tournamentEmbed(started ? colors.live : colors.brand, started ? t('Live') : t('Starting soon'), tournament), lines);
}

function placementText(entry) {
  let name = playerLink(entry.player);
  if (entry.dq) name += ` ${t('(DQ)')}`;
  if (!entry.placement) return `${name} ${t('(not reported)')}`;
  // the worst they can finish, so no medal
  if (!entry.done && !entry.final) return t`${ordinal(entry.placement)} ${name} (projected)`;
  return `${medal(entry.placement)}${ordinal(entry.placement)} ${name}`;
}

// a card per tournament so each one gets its own image. minimum is how many of the crew
// a tournament needs to list, for the empty answer
export function upcoming(tournaments, players, who, { minimum = 0 } = {}) {
  if (!tournaments.length) {
    const everyone = who === 'everyone';
    let description = everyone ? t('Nobody is registered for anything yet.') : t`${escapeMarkdown(who)} isn't registered for anything yet.`;
    if (minimum > 1 && everyone) description = t`No upcoming tournament has ${minimum} or more of the crew registered yet.`;
    if (minimum > 1 && !everyone) description = t`${escapeMarkdown(who)} has no upcoming tournament with ${minimum} or more of the crew registered yet.`;
    return [baseEmbed(colors.brand).setTitle(t`Upcoming · ${escapeMarkdown(who)}`).setDescription(description)];
  }

  const now = Math.floor(Date.now() / 1000);
  const more = tournaments.length > 10 ? t` · next 10 of ${tournaments.length}` : '';
  return tournaments.slice(0, 10).map((tournament) => {
    const live = tournament.startAt <= now;
    return upcomingCard(tournament, players, t`${live ? t('Live') : t('Upcoming')} · ${who}${more}`, live ? colors.live : colors.brand);
  });
}

function upcomingCard(tournament, players, label, color) {
  const eventsByUser = new Map();
  for (const { userId, event } of tournament.entries) {
    if (!eventsByUser.has(userId)) eventsByUser.set(userId, []);
    eventsByUser.get(userId).push(event);
  }

  const lines = [
    t`**Time:** ${timeText(tournament.startAt)}`,
    t`**Location:** ${locationText(tournament)}`,
    // a tracked tournament shows before anyone from the crew signs up
    eventsByUser.size ? t('**Players:**') : t('Nobody from the crew registered yet.'),
  ];
  for (const [userId, events] of eventsByUser) {
    lines.push(`${playerLink(players[userId])}: ${events.map(escapeMarkdown).join(', ')}`);
  }

  // a card per tournament, so a big one gets cut off instead of carrying on
  const [shown, ...rest] = split(lines, 4000);
  const hidden = rest.flat().length;
  if (hidden) shown.push(t`-# and ${hidden} more`);
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
  const soonest = (a, b) => UP_NEXT.indexOf(a.state) - UP_NEXT.indexOf(b.state);
  const pending = finished ? [] : sets.filter((set) => UP_NEXT.includes(set.state)).sort(soonest);
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
  const station = set.station ? t` · **${t('Station')} ${set.station}**` : '';
  const time = set.state !== 2 && set.startAt > now ? ` · <t:${set.startAt}:t>` : '';
  return `${t(NEXT_TEXT[set.state])} **${escapeMarkdown(them.name)}**${round}${station}${time}`;
}

function statusText({ entry, finished }) {
  if (entry.dq) return t('Disqualified');
  if (finished && !entry.placement) return t('Finished, placement pending');
  if (finished) return t`Finished ${medal(entry.placement)}${ordinal(entry.placement)}${entry.entrants ? t` of ${entry.entrants}` : ''}`;
  if (!entry.started) return t('Hasn\'t started yet');
  return t('Still in the bracket');
}

// the overview says what's next for the ones still going
function overviewText(status, now) {
  if (status.finished || !status.entry.started) return statusText(status).replace(/^./, (letter) => letter.toLowerCase());
  return status.next ? nextText(status.next, now) : t('waiting for the next opponent');
}

// one event's sets so far and what's next. completed sets link their VOD when the TO added one
function runLines(status, now) {
  const lines = status.played.map(({ set, me, them, won }) => {
    const round = set.round ? ` · [${escapeMarkdown(set.round)}](${setUrl(set)})` : '';
    return t`**${won ? t('W') : t('L')}** ${scoreText(me, them)} vs **${escapeMarkdown(them.name)}**${round}${vodLink(set)}`;
  });
  if (!lines.length && status.entry.started) lines.push(t('No completed sets reported yet.'));
  if (status.finished || !status.entry.started) return lines;
  return [...lines, '', status.next ? t`**Next:** ${nextText(status.next, now)}` : t('Next opponent has not been assigned yet.')];
}

// runs is { entry, sets } for each event they're in at the tournament. someone in several brackets goes back
// and forth between them, so those get a card up top with the one that needs them soonest first
export function run(player, tournament, runs, now = Math.floor(Date.now() / 1000)) {
  const statuses = runStatuses(player, runs);
  if (statuses.length === 1) {
    const [status] = statuses;
    const lines = [`**${escapeMarkdown(eventTitle(status.entry))}**`, statusText(status), '', ...runLines(status, now)];
    return withLines(tournamentEmbed(colors.live, t`${player.tag}'s run`, tournament), lines);
  }

  const overview = statuses.map((status) => {
    const record = status.played.length ? ` (${shortRecord(status.played)})` : '';
    return `**${escapeMarkdown(status.entry.event)}**${record} · ${overviewText(status, now)}`;
  });
  overview.push(t('-# The one that needs you soonest is first'));
  const cards = withLines(tournamentEmbed(colors.live, t`${player.tag}'s run · ${count(statuses.length, 'bracket')}`, tournament), overview);
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
