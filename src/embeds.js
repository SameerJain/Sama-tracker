import { EmbedBuilder, embedLength, escapeMarkdown } from 'discord.js';
import { fromSide, startggUrl } from './startgg.js';
import { FORM_SETS } from './predict.js';
import { characterUsage } from './characters.js';

const colors = {
  brand: 0x5b21b6,
  win: 0x22c55e,
  loss: 0xef4444,
  clash: 0xf59e0b, // tracked vs tracked
  results: 0xfacc15,
  stream: 0x9146ff,
  live: 0xe11d48,
  sm4sh: 0x00a2e8,
  melee: 0x6a5acd,
  ult: 0xe60012,
  64: 0x009e49,
  brawl: 0xc9a227,
  pplus: 0x14b8a6,
  reg: 0xdc2626,
  regEarly: 0xf59e0b,
};

// double elim placements: 1, 2, 3, 4, 5, 7, 9, 13, 17, 25...
const PLACEMENTS = [1, 2];
for (let n = 2; n <= 4096; n *= 2) PLACEMENTS.push(n + 1, n * 1.5 + 1);

// index into PLACEMENTS, so seed 9 and 9th place are both 6
const step = (n) => PLACEMENTS.findLastIndex((place) => place <= n);

const MAJOR_UPSET = 5; // seed 9 beating seed 2
const RECENT_EVENTS = 4;
const CHARACTERS_SHOWN = 5;
const LIFETIME_EVENTS = 5;
const UPSETS_SHOWN = 3;
const OPPONENTS_SHOWN = 8;
const GAMES_SHOWN = 6;

function baseEmbed(color, footer = 'Sama-tracker') {
  return new EmbedBuilder().setColor(color).setFooter({ text: footer });
}

// lines grouped so each group fits in one description
function split(lines, max = 4096) {
  const groups = [];
  let size = Infinity;
  for (const line of lines) {
    if (size + line.length + 1 > max) {
      groups.push([]);
      size = 0;
    }
    groups.at(-1).push(line);
    size += line.length + 1;
  }
  return groups;
}

// a list too long for one embed carries on in more of the same color
function withLines(embed, lines) {
  const [first, ...rest] = split(lines).map((group) => group.join('\n'));
  return [embed.setDescription(first), ...rest.map((text) => baseEmbed(embed.data.color).setDescription(text))];
}

// a message fits 10 embeds and 6000 chars between them, the rest go in more messages
export function messages(list) {
  const batches = [];
  let size = Infinity;
  for (const embed of list) {
    const length = embedLength(embed.data);
    if (batches.at(-1)?.length === 10 || size + length > 6000) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1).push(embed);
    size += length;
  }
  return batches;
}

function tournamentEmbed(color, label, tournament) {
  const embed = baseEmbed(color)
    .setAuthor({ name: label })
    .setTitle(tournament.name)
    .setURL(startggUrl(tournament.slug));

  const image = tournament.images?.[0]?.url;
  if (image) embed.setThumbnail(image);
  return embed;
}

function playerLink(player) {
  return `[${escapeMarkdown(player.tag)}](${startggUrl(player.slug)})`;
}

function setUrl(set) {
  return startggUrl(`${set.event.slug}/set/${set.id}`);
}

function setLink(set) {
  return `[${escapeMarkdown(set.event.tournament.name)}](${setUrl(set)})`;
}

function percent(part, whole) {
  return `${Math.round((part / whole) * 100)}%`;
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

function ordinal(n) {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;

  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

function medal(placement) {
  if (placement === 1) return '🥇 ';
  if (placement === 2) return '🥈 ';
  if (placement === 3) return '🥉 ';
  return '';
}

function scoreText(me, them) {
  if (me.score === -1 || them.score === -1) return 'DQ'; // start.gg's DQ score
  if (me.score === null || them.score === null) return 'vs';
  return `${me.score}-${them.score}`;
}

function upsetFactor(winner, loser) {
  if (!winner.seed || !loser.seed) return 0;
  return step(winner.seed) - step(loser.seed);
}

function findTracked(side, players) {
  return Object.values(players).find((player) => side.playerIds.includes(player.playerId));
}

function groupByEvent(tournament, players) {
  const groups = new Map();
  for (const entry of tournament.entries) {
    const player = players[entry.userId];
    if (!player) continue;

    if (!groups.has(entry.eventSlug)) groups.set(entry.eventSlug, []);
    groups.get(entry.eventSlug).push({ ...entry, player });
  }
  return [...groups.values()];
}

function setEmbed(set, color, player) {
  const game = set.event.videogame?.displayName;
  const tournament = set.event.tournament;

  const embed = baseEmbed(color, game ? `Sama-tracker · ${game}` : undefined)
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
    `Not registered yet, and registration closes <t:${deadline}:R>.`,
    '',
    `**[Register on start.gg](${register})**`,
    '-# Already did? Connect Discord on start.gg so it shows up',
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

// /registered. members are the participants who are in this server, entries say what they're in
export function registered(tournament, members, total, linked) {
  const events = Map.groupBy(tournament.entries ?? [], (entry) => entry.userId);
  const lines = [`**Time:** ${timeText(tournament.startAt)}`, `**Location:** ${locationText(tournament)}`, ''];
  for (const member of members.toSorted((a, b) => (a.tag ?? '').localeCompare(b.tag ?? ''))) {
    const entered = events.get(member.userId)?.map((entry) => entry.event);
    lines.push(`<@${member.discordId}> · ${escapeMarkdown(member.tag ?? '')}${entered ? `: ${entered.join(', ')}` : ''}`);
  }
  if (!members.length) lines.push('Nobody from this server yet.');
  lines.push(`-# Goes by the Discord connected on start.gg, which ${linked} of the ${total} registered have`);
  return withLines(tournamentEmbed(colors.brand, `Registered from this server · ${members.length}`, tournament), lines);
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

// sets is newest first. verbose lists every set and adds splits, streaks and when they first played
export function headToHead(a, b, sets, verbose) {
  const results = sets.map((set) => fromSide(set, a.playerId));
  const wins = results.filter((result) => result.won).length;
  const losses = results.length - wins;

  const embed = baseEmbed(colors.clash).setAuthor({ name: a.tag, iconURL: a.image, url: startggUrl(a.slug) });
  if (b.image) embed.setThumbnail(b.image);

  if (!results.length) {
    return [embed
      .setTitle(`${escapeMarkdown(a.tag)} vs ${escapeMarkdown(b.tag)}`)
      .setDescription('They haven\'t played each other in singles on start.gg yet.')];
  }

  embed.setTitle(`${escapeMarkdown(a.tag)} ${wins}-${losses} ${escapeMarkdown(b.tag)}`);

  // some sets only have a winner reported, no score
  const scored = results.filter(({ me, them }) => me.score !== null && them.score !== null);
  const gamesWon = scored.reduce((sum, { me }) => sum + me.score, 0);
  const gamesLost = scored.reduce((sum, { them }) => sum + them.score, 0);

  const lines = [];
  if (gamesWon + gamesLost) {
    lines.push(`-# Games ${gamesWon}-${gamesLost} (${percent(gamesWon, gamesWon + gamesLost)} won)`);
  }
  if (wins !== losses) {
    const leader = wins > losses ? a : b;
    lines.push(`**${escapeMarkdown(leader.tag)} leads ${Math.max(wins, losses)}-${Math.min(wins, losses)}**`);
  }
  if (verbose) lines.push(...rivalry(a, b, results));
  if (lines.length) lines.push('');

  const shown = verbose ? results : results.slice(0, 10);
  for (const { set, me, them, won } of shown) {
    lines.push(`${won ? 'W' : 'L'} ${scoreText(me, them)} · ${set.round} · ${setLink(set)} · <t:${set.completedAt}:d>`);
  }
  if (shown.length < results.length) lines.push(`-# ${count(results.length - shown.length, 'older set')} not shown, \`verbose:True\` lists them all`);
  return withLines(embed, lines);
}

// /h2h verbose, from a's side like the title
function rivalry(a, b, results) {
  const tagA = escapeMarkdown(a.tag);
  const tagB = escapeMarkdown(b.tag);
  const record = (list) => winLoss(list.filter(({ won }) => won).length, list.filter(({ won }) => !won).length);
  const lines = [];

  const byGame = Map.groupBy(results, ({ set }) => set.event.videogame?.displayName ?? 'Other');
  if (byGame.size > 1) lines.push(`**By game:** ${[...byGame].map(([game, list]) => `${escapeMarkdown(game)} ${record(list)}`).join(' · ')}`);

  // who the bracket expected to win
  const seeded = results.filter(({ me, them }) => me.seed && them.seed && me.seed !== them.seed);
  const above = seeded.filter(({ me, them }) => me.seed < them.seed);
  if (above.length) lines.push(`**Seeded above ${tagB}:** ${tagA} ${record(above)}`);
  const below = seeded.filter(({ me, them }) => me.seed > them.seed);
  if (below.length) lines.push(`**Seeded below ${tagB}:** ${tagA} ${record(below)}`);

  const grands = results.filter(({ set }) => /grand final/i.test(set.round ?? ''));
  if (grands.length) lines.push(`**Grand finals:** ${tagA} ${record(grands)}`);

  const streak = results.findIndex((result) => result.won !== results[0].won);
  const run = streak === -1 ? results.length : streak;
  if (run > 1) lines.push(`**Streak:** ${escapeMarkdown((results[0].won ? a : b).tag)} has won the last ${run}`);

  const first = results.at(-1);
  lines.push(`**First played:** <t:${first.set.completedAt}:D> at ${setLink(first.set)}`);
  return lines;
}

const FACTORS = { h2h: 'Head-to-head', common: 'Common opponents', seeding: 'Seeding', form: 'Form' };

// verbose shows how much each part counted and what it says on its own, plus what's behind them
export function prediction(a, b, odds, verbose) {
  const chanceA = Math.min(99, Math.max(1, Math.round(odds.chance * 100)));
  const embed = baseEmbed(colors.clash, `Sama-tracker · ${odds.game}`)
    .setAuthor({ name: a.tag, iconURL: a.image, url: startggUrl(a.slug) })
    .setTitle(`${escapeMarkdown(a.tag)} ${chanceA}% · ${100 - chanceA}% ${escapeMarkdown(b.tag)}`);
  if (b.image) embed.setThumbnail(b.image);

  const tagA = escapeMarkdown(a.tag);
  const tagB = escapeMarkdown(b.tag);
  const { h2h, common, seeding, form } = odds;
  const lines = [];

  const losses = h2h.total - h2h.wins;
  if (!h2h.total) lines.push('**Head-to-head:** never played, so it comes down to the rest');
  else if (h2h.wins === losses) lines.push(`**Head-to-head:** even at ${h2h.wins}-${losses}`);
  else lines.push(`**Head-to-head:** ${h2h.wins > losses ? `${tagA} leads ${h2h.wins}-${losses}` : `${tagB} leads ${losses}-${h2h.wins}`}`);

  if (common.total) {
    lines.push(`**Common opponents:** ${common.total} shared. ${tagA} did better against ${common.better}, ${tagB} against ${common.worse}`);
  }
  if (seeding.total) {
    const higher = seeding.higher >= seeding.total - seeding.higher ? [tagA, seeding.higher] : [tagB, seeding.total - seeding.higher];
    lines.push(`**Seeding:** ${higher[0]} seeded higher in ${higher[1]} of ${seeding.total} shared brackets`);
  }
  const record = ({ wins, total }) => winLoss(wins, total - wins);
  lines.push(`**Form:** ${tagA} ${record(form.a)} · ${tagB} ${record(form.b)}, last ${FORM_SETS} sets each`);
  if (!verbose) return [embed.setDescription(lines.join('\n'))];

  section(lines, 'How it adds up', odds.factors.map(({ key, n, share, chance }) => {
    if (!n) return `${FACTORS[key]}: nothing to go on, so it doesn't count`;
    const lean = Math.round(chance * 100);
    let says = 'even';
    if (lean > 50) says = `${tagA} ${lean}%`;
    if (lean < 50) says = `${tagB} ${100 - lean}%`;
    return `${FACTORS[key]}: counts for ${percent(share, 1)} · on its own, ${says}`;
  }));
  const played = ({ a: x, b: y }) => x.total + y.total;
  section(lines, 'Common opponents', common.opponents.toSorted((x, y) => played(y) - played(x)).slice(0, OPPONENTS_SHOWN)
    .map(({ name, a: x, b: y }) => `${escapeMarkdown(name)}: ${tagA} ${x.wins}-${x.total - x.wins} · ${tagB} ${y.wins}-${y.total - y.wins}`));
  section(lines, 'Shared brackets', seeding.brackets.slice(0, OPPONENTS_SHOWN)
    .map(({ set, a: x, b: y }) => `[${escapeMarkdown(set.event.tournament.name)}](${startggUrl(set.event.slug)}) · ${tagA} seed ${x} · ${tagB} seed ${y}`));
  lines.push('-# Each part is weighted by how much it matters and how many sets it goes off, then they\'re averaged as log odds');
  return withLines(embed, lines);
}

export function stats(player, standings, sets) {
  const embed = baseEmbed(colors.brand)
    .setAuthor({ name: 'Stats' })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (player.image) embed.setThumbnail(player.image);

  const played = sets.map((set) => fromSide(set, player.playerId)).filter((result) => result && !result.dq);
  if (!played.length && !standings.length) return embed.setDescription('Nothing on start.gg yet.');

  const lines = [];
  if (played.length) {
    const records = new Map();
    for (const { set, won } of played) {
      const game = set.event.videogame?.displayName ?? 'Other';
      if (!records.has(game)) records.set(game, { wins: 0, losses: 0 });
      records.get(game)[won ? 'wins' : 'losses']++;
    }
    const recordText = [...records].map(([game, { wins, losses }]) => `${game} ${wins}-${losses} (${percent(wins, wins + losses)})`);
    lines.push(`**Recent sets:** ${recordText.join(' · ')}`);
  }

  // relative to bracket size, so 4th of 84 beats 3rd of 20
  const best = standings
    .filter(({ event }) => event.numEntrants)
    .sort((x, y) => x.placement / x.event.numEntrants - y.placement / y.event.numEntrants)[0];
  if (best) lines.push(`**Best finish:** ${placementLine(best)}`);

  // sets are newest first, so ties go to the latest one
  const upset = played
    .filter(({ me, them, won }) => won && upsetFactor(me, them) > 0)
    .sort((x, y) => upsetFactor(y.me, y.them) - upsetFactor(x.me, x.them))[0];
  if (upset) lines.push(`**Biggest upset:** ${upsetLine(upset)}`);

  if (standings.length) {
    lines.push('', '**Latest events**', ...standings.slice(0, RECENT_EVENTS).map(placementLine));
  }

  const from = [];
  if (played.length) from.push(played.length === 1 ? '1 singles set' : `${played.length} singles sets`);
  if (standings.length) from.push(standings.length === 1 ? '1 event' : `${standings.length} events`);
  lines.push(`-# From their last ${from.join(' and ')} on start.gg`);

  return embed.setDescription(lines.join('\n'));
}

export function run(player, tournament, entry, sets) {
  const embed = tournamentEmbed(colors.live, `${player.tag}'s run`, tournament);
  const finished = entry.done || entry.final || entry.dq;
  const lines = [`**${escapeMarkdown(eventTitle(entry))}**`];
  if (entry.dq) lines.push('Disqualified');
  else if (finished) lines.push(`Finished${entry.placement ? ` · ${ordinal(entry.placement)} place` : ' · placement pending'}`);
  else lines.push('Still in the bracket');
  const played = sets.filter((set) => set.state === 3 && set.winnerId)
    .sort((a, b) => a.completedAt - b.completedAt).map((set) => fromSide(set, player.playerId)).filter(Boolean);
  lines.push('');
  for (const { set, me, them, won } of played) {
    lines.push(`${won ? 'W' : 'L'} ${scoreText(me, them)} vs **${escapeMarkdown(them.name)}** · [${escapeMarkdown(set.round)}](${setUrl(set)})`);
  }
  if (!played.length) lines.push('No completed sets reported yet.');
  if (!finished) {
    const pending = sets.filter((set) => [1, 2, 6].includes(set.state));
    const next = pending.find((set) => set.state === 2 || set.state === 6) ?? pending[0];
    const result = next && fromSide(next, player.playerId);
    lines.push('', result
      ? `**Next:** ${escapeMarkdown(result.them.name)} · [${escapeMarkdown(next.round)}](${setUrl(next)})${next.state === 2 ? ' · in progress' : next.state === 6 ? ' · called' : ''}`
      : 'Next opponent has not been assigned yet.');
  }
  return withLines(embed, lines);
}

// a card per game, the last 30 days over the 30 before
export function progress(player, current, previous, { since, middle, until }) {
  const title = `${escapeMarkdown(player.tag)}'s progress`;
  const games = [...new Set([...current.games, ...previous.games].map(({ game }) => game))];
  if (!games.length) return [baseEmbed(colors.brand).setTitle(title).setDescription('No singles results in the last 60 days.')];

  return games.flatMap((game) => {
    const recent = current.games.find((entry) => entry.game === game);
    const before = previous.games.find((entry) => entry.game === game);
    const lines = [
      `**Last 30 days** · <t:${middle}:d> to <t:${until}:d>`, ...periodLines(recent),
      '',
      `**Previous 30 days** · <t:${since}:d> to <t:${middle}:d>`, ...periodLines(before),
    ];
    const rate = (data) => (data?.wins + data?.losses ? data.wins / (data.wins + data.losses) : null);
    if (rate(recent) !== null && rate(before) !== null) {
      const points = 100 * (rate(recent) - rate(before));
      lines.push('', `Win rate ${points >= 0 ? 'up' : 'down'} ${Math.abs(points).toFixed(1)} points`);
    }
    lines.push('-# Singles only, DQs left out. Events count toward the 30 days they started in, and vs seed goes by placement tier');
    return withLines(baseEmbed(colors.brand, `Sama-tracker · ${game}`).setTitle(title).setURL(startggUrl(player.slug)), lines);
  });
}

// one game in one period of /progress
function periodLines(data) {
  if (!data) return ['No sets or finished events.'];
  const lines = [`Sets: ${winLoss(data.wins, data.losses)}`];

  const sized = data.events.filter(({ event }) => event.numEntrants > 0);
  if (sized.length) {
    const average = sized.reduce((total, entry) => total + finish(entry), 0) / sized.length;
    lines.push(`Placements: ${count(data.events.length, 'event')} · average top ${Math.ceil(average * 100)}%`);
    lines.push(`Best: ${placementLine(sized.toSorted(byFinish)[0])}`);
  } else if (data.events.length) {
    lines.push(`Placements: ${count(data.events.length, 'event')}, no bracket sizes reported`);
  } else {
    lines.push('Placements: no finished events');
  }

  const seeded = data.events.filter(({ seed }) => seed > 0);
  if (!seeded.length) return [...lines, 'Vs seed: no seeded finishes reported'];
  const better = seeded.filter(({ placement, seed }) => step(placement) < step(seed)).length;
  const worse = seeded.filter(({ placement, seed }) => step(placement) > step(seed)).length;
  return [...lines, `Vs seed: ${better} better · ${seeded.length - better - worse} on seed · ${worse} worse`];
}

export function scout(player, opponent, mine, theirs, characterSets) {
  const played = theirs.map((set) => fromSide(set, opponent.playerId)).filter((result) => result && !result.dq);
  const meetings = [...new Map([...mine, ...theirs].map((set) => [set.id, set])).values()]
    .map((set) => fromSide(set, player.playerId)).filter((result) => result && !result.dq && result.them.playerIds.includes(opponent.playerId));
  const lines = ['**Recent form**'];
  const games = [...new Set(played.map(({ set }) => set.event.videogame?.displayName ?? 'Other'))];
  for (const game of games.slice(0, GAMES_SHOWN)) {
    const recent = played.filter(({ set }) => (set.event.videogame?.displayName ?? 'Other') === game).slice(0, 20);
    const wins = recent.filter(({ won }) => won).length;
    lines.push(`${escapeMarkdown(game)}: ${winLoss(wins, recent.length - wins)} · last ${recent.length} sets`);
  }
  if (!played.length) lines.push('No recent singles sets.');
  section(lines, 'Latest sets', played.slice(0, 5).map(({ set, me, them, won }) =>
    `${won ? 'W' : 'L'} ${scoreText(me, them)} vs ${escapeMarkdown(them.name)} · ${setLink(set)} · <t:${set.completedAt}:d>`));
  lines.push('', '**Reported characters**');
  const characterGames = [...new Map(characterSets.map((set) => [set.videogame.id, set.videogame])).values()];
  let reported = false;
  for (const game of characterGames.slice(0, GAMES_SHOWN)) {
    const usage = characterUsage(characterSets.filter((set) => set.videogame.id === game.id));
    if (!usage.reported) continue;
    reported = true;
    lines.push(`${escapeMarkdown(game.displayName)}: ${usage.characters.slice(0, 3).map((c) => `${escapeMarkdown(c.name)} (${count(c.games, 'game')})`).join(', ')}`);
  }
  if (!reported) lines.push('No characters reported in their recent sets.');
  lines.push('', `**Your head-to-head** · ${escapeMarkdown(player.tag)} vs ${escapeMarkdown(opponent.tag)}`);
  const sharedGames = [...new Set(meetings.map(({ set }) => set.event.videogame?.displayName ?? 'Other'))];
  for (const game of sharedGames.slice(0, GAMES_SHOWN)) {
    const sets = meetings.filter(({ set }) => (set.event.videogame?.displayName ?? 'Other') === game);
    const wins = sets.filter(({ won }) => won).length;
    lines.push(`${escapeMarkdown(game)}: ${winLoss(wins, sets.length - wins)}`);
  }
  if (!meetings.length) lines.push('You haven\'t played each other in singles, as far back as this checks.');
  lines.push('-# From up to 600 singles sets each, and 400 for characters. Characters only show up if the TO reported them');
  return withLines(baseEmbed(colors.brand).setTitle(`Scouting ${opponent.tag}`).setURL(startggUrl(opponent.slug)), lines);
}

// upcoming is [{ tournament, players }] for the active players' entries before the next recap
export function weeklyRecap(crew, upcoming, { since, until }) {
  const lines = [`<t:${since}:d> to <t:${until}:d> · ${count(crew.length, 'active player')}`];
  const wins = crew.flatMap(({ player, summary }) => summary.played.filter((result) => result.won).map((result) => ({ ...result, player })));
  const upset = wins.filter(({ me, them }) => upsetFactor(me, them) > 0)
    .sort((a, b) => upsetFactor(b.me, b.them) - upsetFactor(a.me, a.them))[0];
  if (upset) lines.push('', `**Biggest upset:** ${playerLink(upset.player)} ${upsetLine(upset)}`);
  const finishes = crew.flatMap(({ player, summary }) => summary.finishes.map((entry) => ({ ...entry, player })))
    .filter(({ event }) => event.numEntrants).sort(byFinish);
  if (finishes.length) lines.push(`**Best finish:** ${playerLink(finishes[0].player)} · ${placementLine(finishes[0])}`);
  for (const { player, summary } of crew) {
    lines.push('', `**${escapeMarkdown(player.tag)}**`);
    for (const game of summary.games) lines.push(`${escapeMarkdown(game.game)}: ${winLoss(game.wins, game.losses)}`);
    lines.push(...summary.finishes.map(placementLine));
    if (!summary.finishes.length) lines.push('No final placements reported for this week\'s events yet.');
  }
  const next = upcoming.map(({ tournament, players }) => `[${escapeMarkdown(tournament.name)}](${startggUrl(tournament.slug)}) · `
    + `<t:${tournament.startAt}:f> · ${players.map((player) => escapeMarkdown(player.tag)).join(', ')}`);
  section(lines, 'Upcoming this week', next.length ? next : ['Nobody who played this week is signed up for anything yet.']);
  lines.push('-# Singles only, and only people who played a set that wasn\'t a DQ');
  return withLines(baseEmbed(colors.results).setTitle('Weekly crew recap'), lines);
}

// beat Foo (seed 2) 3-1 as seed 9 at Tournament
function upsetLine({ set, me, them, won }) {
  const score = scoreText(me, them) === 'vs' ? '' : ` ${scoreText(me, them)}`;
  return `${won ? 'beat' : 'lost to'} ${escapeMarkdown(them.name)} (seed ${them.seed})${score} as seed ${me.seed} at ${setLink(set)}`;
}

// how big an upset the set was, whichever way it went
function upsetSize(result) {
  return result.won ? upsetFactor(result.me, result.them) : upsetFactor(result.them, result.me);
}

function winLoss(wins, losses) {
  return `${wins}-${losses}${wins + losses ? ` (${percent(wins, wins + losses)})` : ''}`;
}

// relative to bracket size, so 4th of 84 beats 3rd of 20
const finish = (entry) => entry.placement / entry.event.numEntrants;
const byFinish = (x, y) => finish(x) - finish(y) || y.event.numEntrants - x.event.numEntrants;

// events entered and set record, grouped by game or year
function breakdown(entered, played, eventKey, setKey) {
  const groups = new Map();
  const group = (key) => {
    if (!groups.has(key)) groups.set(key, { key, events: [], wins: 0, losses: 0 });
    return groups.get(key);
  };
  for (const entry of entered) group(eventKey(entry.event)).events.push(entry);
  for (const { set, won } of played) group(setKey(set))[won ? 'wins' : 'losses']++;
  return [...groups.values()];
}

// Ultimate · 180 events · won 3 · sets 420-300 (58%)
function breakdownLine({ key, events, wins, losses }) {
  const parts = [`**${escapeMarkdown(String(key))}**`];
  if (events.length) parts.push(count(events.length, 'event'));
  const firsts = events.filter((entry) => entry.placement === 1).length;
  const best = events.filter((entry) => entry.event.numEntrants).sort(byFinish)[0];
  if (firsts) parts.push(`won ${firsts}`);
  else if (best) parts.push(`best ${ordinal(best.placement)} of ${best.event.numEntrants}`);
  if (wins + losses) parts.push(`sets ${winLoss(wins, losses)}`);
  return parts.join(' · ');
}

function section(lines, title, list) {
  if (!list.length) return;
  if (lines.length) lines.push('');
  lines.push(`**${title}**`, ...list);
}

// two cards: the lifetime numbers, then the results behind them
export function lifetimeStats(player, events, sets, players) {
  const overview = baseEmbed(colors.brand)
    .setAuthor({ name: 'Lifetime stats' })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (player.image) overview.setThumbnail(player.image);

  const entered = events.filter((entry) => !entry.dq);
  const played = sets.map((set) => fromSide(set, player.playerId)).filter((result) => result && !result.dq);
  if (!entered.length && !played.length) return [overview.setDescription('Nothing on start.gg yet.')];

  const from = [];
  if (played.length) from.push(`${count(played.length, 'singles set')} since <t:${played.at(-1).set.completedAt}:D>`);
  if (entered.length) from.push(`${count(entered.length, 'event')} since <t:${entered.at(-1).event.startAt}:D>`);
  const dqs = events.length - entered.length;
  const latest = Math.max(played[0]?.set.completedAt ?? 0, entered[0]?.event.startAt ?? 0);
  overview.setDescription(`Last played <t:${latest}:R>\n-# From ${from.join(' and ')} on start.gg${dqs ? `, ${count(dqs, 'DQ')} left out` : ''}`);

  const sized = entered.filter((entry) => entry.event.numEntrants);
  const seeded = entered.filter((entry) => entry.seed);
  const stat = (name, value) => overview.addFields({ name, value: String(value), inline: true });

  if (entered.length) stat('Events', entered.length);
  if (played.length) {
    const wins = played.filter((result) => result.won).length;
    stat('Sets', winLoss(wins, played.length - wins));
  }
  const scored = played.filter(({ me, them }) => me.score !== null && them.score !== null);
  const gamesWon = scored.reduce((sum, { me }) => sum + me.score, 0);
  const gamesLost = scored.reduce((sum, { them }) => sum + them.score, 0);
  if (gamesWon + gamesLost) stat('Games', winLoss(gamesWon, gamesLost));

  if (entered.length) {
    stat('1st places', entered.filter((entry) => entry.placement === 1).length);
    stat('Top 3s', entered.filter((entry) => entry.placement <= 3).length);
    // top 8 of an 8 person bracket doesn't count
    stat('Top 8s', sized.filter((entry) => entry.event.numEntrants > 8 && entry.placement <= 8).length);
  }
  if (sized.length) {
    const finishes = sized.map(finish).sort((a, b) => a - b);
    stat('Typical finish', `top ${Math.ceil(finishes[Math.floor(finishes.length / 2)] * 100)}%`);
  }
  if (seeded.length) {
    const better = seeded.filter((entry) => step(entry.placement) < step(entry.seed)).length;
    const worse = seeded.filter((entry) => step(entry.placement) > step(entry.seed)).length;
    stat('Finish vs seed', `better ${percent(better, seeded.length)} · worse ${percent(worse, seeded.length)}`);
  }
  if (played.length) {
    let run = 0;
    let longest = 0;
    for (const { won } of played) {
      run = won ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    const streak = played.findIndex((result) => result.won !== played[0].won);
    stat('Win streak', `best ${longest}, now ${played[0].won ? 'W' : 'L'}${streak === -1 ? played.length : streak}`);
  }

  const gameOf = (event) => event.videogame?.displayName ?? 'Other';
  const byGame = breakdown(entered, played, gameOf, (set) => gameOf(set.event))
    .sort((a, b) => b.events.length - a.events.length || b.wins + b.losses - (a.wins + a.losses));
  if (byGame.length > 1) overview.addFields({ name: 'By game', value: byGame.slice(0, GAMES_SHOWN).map(breakdownLine).join('\n') });

  const yearOf = (seconds) => new Date(seconds * 1000).getUTCFullYear();
  const byYear = breakdown(entered, played, (event) => yearOf(event.startAt), (set) => yearOf(set.completedAt))
    .sort((a, b) => b.key - a.key);
  if (byYear.length > 1) overview.addFields({ name: 'By year', value: byYear.map(breakdownLine).join('\n') });

  const lines = [];
  const upsets = played.filter((result) => upsetSize(result) > 0).sort((x, y) => upsetSize(y) - upsetSize(x));
  // one per event, a bracket reset in grands is the same upset twice
  const top = (list) => list
    .filter((result, i) => list.findIndex((other) => other.set.event.slug === result.set.event.slug) === i)
    .slice(0, UPSETS_SHOWN)
    .map((result) => `${upsetLine(result)} · <t:${result.set.completedAt}:d>`);
  section(lines, 'Best finishes', sized.toSorted(byFinish).slice(0, LIFETIME_EVENTS).map(placementLine));
  section(lines, 'Latest events', entered.slice(0, LIFETIME_EVENTS).map(placementLine));
  section(lines, 'Biggest wins', top(upsets.filter((result) => result.won)));
  section(lines, 'Toughest losses', top(upsets.filter((result) => !result.won)));

  const results = baseEmbed(colors.brand);
  // way past what fits only with a lot of long tournament names
  if (lines.length) results.setDescription(split(lines)[0].join('\n'));

  const tracked = new Map(Object.values(players).map((each) => [each.playerId, each]));
  const opponents = new Map();
  for (const { them, won } of played) {
    // no start.gg account means no id, so those go by name
    const id = them.playerIds[0] ?? them.name;
    if (!opponents.has(id)) opponents.set(id, { name: tracked.get(id)?.tag ?? them.name, crew: tracked.has(id), wins: 0, losses: 0 });
    opponents.get(id)[won ? 'wins' : 'losses']++;
  }
  // sort is stable and sets are newest first, so ties go to who they played last
  const mostPlayed = [...opponents.values()].sort((a, b) => b.wins + b.losses - (a.wins + a.losses));
  const crew = mostPlayed.filter((each) => each.crew);
  const opponentLines = (list) => list.slice(0, OPPONENTS_SHOWN).map(({ name, wins, losses }) => `${escapeMarkdown(name)} ${wins}-${losses}`).join('\n');
  if (mostPlayed.length) results.addFields({ name: 'Most played', value: opponentLines(mostPlayed), inline: true });
  if (crew.length) results.addFields({ name: 'Vs the crew', value: opponentLines(crew), inline: true });

  return [overview, results];
}

// file is the uploaded art of their main. no game means it covers every game. note goes at the bottom
export function characters(player, usage, game, file, note) {
  const embed = baseEmbed(colors.brand, game ? `Sama-tracker · ${game}` : undefined)
    .setAuthor({ name: 'Characters' })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (file) embed.setThumbnail(`attachment://${file}`);

  const sets = game ? `${game} singles set` : 'singles set';
  const from = `their last ${count(usage.scanned, sets)}`;
  if (!usage.scanned) return embed.setDescription(`No ${sets}s on start.gg yet.`);
  if (!usage.reported) return embed.setDescription(`No characters reported in ${from}. Lots of tournaments don't bother.`);

  const lines = [];
  for (const [i, character] of usage.characters.slice(0, CHARACTERS_SHOWN).entries()) {
    const share = usage.characters.length > 1 ? ` · ${percent(character.games, usage.games)} of games` : '';
    const won = `won ${character.wins} of ${character.games} (${percent(character.wins, character.games)})`;
    const name = i === 0 ? `**${character.name}**` : character.name;
    // escaped so discord shows "1." as typed instead of making it a list
    lines.push(`${i + 1}\\. ${name}${share} · ${won}`);
    if (i === 0 && usage.best) lines.push(`-# Best vs ${usage.best.name} ${usage.best.wins}-${usage.best.games - usage.best.wins}`);
  }
  if (usage.characters.length > CHARACTERS_SHOWN) lines.push(`-# and ${usage.characters.length - CHARACTERS_SHOWN} more`);
  lines.push('', `-# Characters were reported in ${usage.reported} of ${from}`);
  if (note) lines.push(`-# ${note}`);

  return embed.setDescription(lines.join('\n'));
}

// 3rd of 20 (seed 2) · Ultimate Singles · Tournament · date
function placementLine({ placement, seed, dq, event }) {
  let text = `${medal(placement)}**${ordinal(placement)}**`;
  if (event.numEntrants) text += ` of ${event.numEntrants}`;
  const notes = [seed && `seed ${seed}`, dq && 'DQ'].filter(Boolean);
  if (notes.length) text += ` (${notes.join(', ')})`;
  const link = `[${escapeMarkdown(event.tournament.name)}](${startggUrl(event.slug)})`;
  return `${text} · ${escapeMarkdown(event.name)} · ${link} · <t:${event.startAt}:d>`;
}

export function trackedList(players) {
  const all = Object.values(players).sort((a, b) => a.tag.localeCompare(b.tag));
  const embed = baseEmbed(colors.brand).setTitle(`Tracking ${all.length}`);
  if (!all.length) return [embed.setDescription('Nobody yet. Add someone with `/track add`.')];
  const lines = all.map((player) => {
    if (player.streamAlerts === false) return `${playerLink(player)} · stream alerts off`;
    return playerLink(player);
  });
  lines.push('', '-# Only these players can be picked in commands. Anyone else can `/link` their start.gg to look themselves up');
  return withLines(embed, lines);
}

export function regAdmins(admins) {
  const all = Object.values(admins).sort((a, b) => a.tag.localeCompare(b.tag));
  const embed = baseEmbed(colors.brand).setTitle(`Reg admins · ${all.length}`);
  if (!all.length) return embed.setDescription('Nobody yet. Add a TO with `/reg_admin add`.');
  return embed.setDescription(`Their tournaments get reg reminders automatically.\n\n${all.map(playerLink).join('\n')}`);
}

const SITES = {
  'x.com': 'X', 'twitter.com': 'X', 'twitch.tv': 'Twitch', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
  'instagram.com': 'Instagram', 'tiktok.com': 'TikTok', 'bsky.app': 'Bluesky', 'kick.com': 'Kick',
  'facebook.com': 'Facebook', 'threads.net': 'Threads', 'discord.gg': 'Discord', 'discord.com': 'Discord',
};

// other sites show the whole link
function socialLink(url) {
  const site = SITES[new URL(url).hostname.replace(/^(www|m|mobile)\./, '')];
  return site ? `[${site}](${url})` : url;
}

export function socials(links) {
  const embed = baseEmbed(colors.brand).setTitle('Socials');
  if (!links.length) return [embed.setDescription('Nothing yet. Add a link with `/socials_edit add`.')];
  // a line per name, in the order they were added
  const lines = [...Map.groupBy(links, (link) => link.name)]
    .map(([name, group]) => `**${escapeMarkdown(name)}** · ${group.map((link) => socialLink(link.url)).join(' · ')}`);
  return withLines(embed, lines);
}

export function added(player) {
  const embed = baseEmbed(colors.brand)
    .setDescription(`Now tracking ${playerLink(player)}.`);
  if (player.image) embed.setThumbnail(player.image);
  return embed;
}

function count(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function status(info) {
  const ago = (seconds) => (seconds ? `<t:${seconds}:R>` : 'not yet');
  let setCheck = ago(info.setCheck);
  if (info.setError) setCheck += `, last try failed (${escapeMarkdown(info.setError)})`;

  const lines = [
    `**Started:** ${ago(info.startedAt)} on ${escapeMarkdown(info.host)}`,
    `**Last set check:** ${setCheck}`,
    `**Signups and placements updated:** ${ago(info.tournamentCheck)}`,
    `**Tracking:** ${count(info.players, 'player')} · ${count(info.tournaments, 'tournament')}`,
  ];
  if (info.queued) lines.push(`**Waiting on start.gg:** ${count(info.queued, 'request')}`);
  if (info.downSince) lines.push(`-# Was down from <t:${info.downSince}:f> until it started`);
  if (info.skippedBefore) lines.push(`-# Sets from then until <t:${info.skippedBefore}:f> didn't get posted`);

  return baseEmbed(colors.brand).setTitle('Status').setThumbnail(info.avatar).setDescription(lines.join('\n'));
}

export function joke(name, title, { text, screenshot, image }) {
  return baseEmbed(colors[name], `Sama-tracker · ${screenshot.name}`)
    .setTitle(title)
    .setURL(screenshot.page)
    .setDescription(text.slice(0, 4096))
    .setImage(`attachment://${image.name}`);
}

export function help() {
  const lines = [
    '**General**',
    '`/help` show the commands',
    '`/status` uptime and the last start.gg checks',
    '`/socials` streams and social links saved for this server',
    '`/socials_edit` add or remove those links. Manage Server permission by default',
    '`/messages` automatic post switches and recap day/time/timezone. Manage Server permission required',
    '',
    '**Player tracking**',
    '`/track add` track someone by start.gg link or ID',
    '`/track remove` stop tracking someone',
    '`/track list` everyone tracked',
    '`/upcoming` live and upcoming tournaments',
    '`/recent` latest sets',
    '`/run` current tournament run, results and next opponent',
    '`/stream` stream alerts on or off',
    '-# Only tracked players can be picked as the player. upcoming, recent and stream also take `all`',
    '',
    '**Looking yourself up**',
    '`/link` link your start.gg, then leave the player out of a command to get yourself. It doesn\'t track you',
    '`/unlink` undo that',
    '-# Tracked players with Discord connected on start.gg don\'t need to link',
    '',
    '**Player stats**',
    '`/h2h` record against someone. `verbose:True` for every set, splits and streaks',
    '`/stats` set record, placements and best upset. `verbose:True` for a lifetime report',
    '`/characters` Ultimate characters someone has reported and how they do on each, `verbose:True` for every game',
    '`/predict` odds of beating someone. `verbose:True` shows how each part counts',
    '`/scout profile:<link or ID>` scout any opponent. Only for tracked players with Discord connected on start.gg',
    '`/progress` last 30 days vs the previous 30, by game',
    '',
    '**Registration**',
    '`/set_reg_reminder` ping everyone with reg pings on as a tournament\'s registration deadline gets close',
    '`/delete_reg_reminder` cancel one',
    '`/reg_admin` TOs whose start.gg tournaments get reg reminders automatically',
    '`/reg_role` reg reminder pings on or off, skipped once you\'re registered if your Discord is connected on start.gg',
    '`/bracket` bracket links for reg reminder tournaments that are live or start within 30 min',
    '`/registered` who in this server is registered for a tournament',
    '`/reg_warn` warn someone who isn\'t registered yet. If they are, it just says so',
    '',
    '**Fun**',
    '`/sm4sh` a love letter to Smash 4',
    '`/melee` a Melee purist with a take',
    '`/ult` an Ultimate player who hates Ultimate',
    '`/64` a 64 old head who says 64 did it first',
    '`/brawl` the last person still defending Brawl',
    '`/pplus` a Project+ player who wants you on netplay',
    '`/pfp` my profile picture, full size',
    '',
    '**Posted here automatically**',
    '• finished sets, and a player\'s first DQ in an event',
    '• sets on stream or up next in the stream queue',
    '• a roll call an hour before a tournament with 3+ of the crew',
    '• registration reminders a week, 3 days and a day out, then a last call 12 hours before',
    '• where everyone placed, 12 hours after it ends, or 24 if the TO is late reporting',
    '• weekly crew recap, only players with a non-DQ singles set that week. Sunday 9 pm New York by default, `/messages` changes it',
  ];
  return baseEmbed(colors.brand).setTitle('Sama-tracker').setDescription(lines.join('\n'));
}
