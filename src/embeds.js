import { EmbedBuilder, embedLength, escapeMarkdown } from 'discord.js';
import { fromSide, startggUrl } from './startgg.js';
import { FORM_SETS } from './predict.js';
import { characterUsage, leans } from './characters.js';

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
// /scout's form line per game, and how many sets it lists
const RECENT_SETS = 20;
const LATEST_SETS = 5;
// /scout verbose
const SCOUT_LATEST_SETS = 8;
const SCOUT_CHARACTER_GAMES = 3;
const MEETINGS_SHOWN = 10;
const LEANS_SHOWN = 3;
// /progress verbose, opponents played in both periods
const REMATCHES_SHOWN = 5;
const DAY = 24 * 60 * 60;

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

// start.gg tag, then their name in the server when it's different
function memberName({ tag, name }) {
  if (!tag) return escapeMarkdown(name ?? 'Unknown');
  if (!name || name.toLowerCase() === tag.toLowerCase()) return escapeMarkdown(tag);
  return `${escapeMarkdown(tag)} (${escapeMarkdown(name)})`;
}

// /registered. members are the participants who are in this server, entries say what they're in.
// names, not mentions, so nobody looks called out
export function registered(tournament, members, total, linked) {
  const events = Map.groupBy(tournament.entries ?? [], (entry) => entry.userId);
  const lines = [`**Time:** ${timeText(tournament.startAt)}`, `**Location:** ${locationText(tournament)}`, ''];
  for (const member of members.toSorted((a, b) => (a.tag ?? '').localeCompare(b.tag ?? ''))) {
    const entered = events.get(member.userId)?.map((entry) => entry.event);
    lines.push(`${memberName(member)}${entered ? `: ${entered.join(', ')}` : ''}`);
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

  const games = gameCount(results);
  const lines = [];
  if (games.won + games.lost) {
    lines.push(`-# Games ${games.won}-${games.lost} (${percent(games.won, games.won + games.lost)} won)`);
  }
  if (wins !== losses) {
    const leader = wins > losses ? a : b;
    lines.push(`**${escapeMarkdown(leader.tag)} leads ${Math.max(wins, losses)}-${Math.min(wins, losses)}**`);
  }
  if (verbose) lines.push(...rivalry(a, b, results));
  if (lines.length) lines.push('');

  const shown = verbose ? results : results.slice(0, 10);
  lines.push(...shown.map(meetingLine));
  if (shown.length < results.length) lines.push(`-# ${count(results.length - shown.length, 'older set')} not shown, \`verbose:True\` lists them all`);
  return withLines(embed, lines);
}

// /h2h verbose, from a's side like the title
function rivalry(a, b, results) {
  const tagA = escapeMarkdown(a.tag);
  const tagB = escapeMarkdown(b.tag);
  const lines = [];

  const byGame = Map.groupBy(results, ({ set }) => gameName(set.event));
  if (byGame.size > 1) lines.push(`**By game:** ${[...byGame].map(([game, list]) => `${escapeMarkdown(game)} ${recordOf(list)}`).join(' · ')}`);

  // who the bracket expected to win
  const seeded = results.filter(({ me, them }) => me.seed && them.seed && me.seed !== them.seed);
  const above = seeded.filter(({ me, them }) => me.seed < them.seed);
  if (above.length) lines.push(`**Seeded above ${tagB}:** ${tagA} ${recordOf(above)}`);
  const below = seeded.filter(({ me, them }) => me.seed > them.seed);
  if (below.length) lines.push(`**Seeded below ${tagB}:** ${tagA} ${recordOf(below)}`);

  const grands = results.filter(({ set }) => GRAND_FINALS.test(set.round ?? ''));
  if (grands.length) lines.push(`**Grand finals:** ${tagA} ${recordOf(grands)}`);

  const streak = results.findIndex((result) => result.won !== results[0].won);
  const run = streak === -1 ? results.length : streak;
  if (run > 1) lines.push(`**Streak:** ${escapeMarkdown((results[0].won ? a : b).tag)} has won the last ${run}`);

  const first = results.at(-1);
  lines.push(`**First played:** <t:${first.set.completedAt}:D> at ${setLink(first.set)}`);
  return lines;
}

const FACTORS = { h2h: 'Head-to-head', common: 'Common opponents', seeding: 'Seeding', form: 'Form' };

// a's odds as a whole percent. never 0 or 100, nothing's certain
function chancePercent(odds) {
  return Math.min(99, Math.max(1, Math.round(odds.chance * 100)));
}

// common opponents both played, the ones with the most sets between them first
function commonOpponentLines(odds, tagA, tagB) {
  const played = ({ a: x, b: y }) => x.total + y.total;
  return odds.common.opponents.toSorted((x, y) => played(y) - played(x)).slice(0, OPPONENTS_SHOWN)
    .map(({ name, a: x, b: y }) => `${escapeMarkdown(name)}: ${tagA} ${x.wins}-${x.total - x.wins} · ${tagB} ${y.wins}-${y.total - y.wins}`);
}

// verbose shows how much each part counted and what it says on its own, plus what's behind them
export function prediction(a, b, odds, verbose) {
  const chanceA = chancePercent(odds);
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
  section(lines, 'Common opponents', commonOpponentLines(odds, tagA, tagB));
  section(lines, 'Shared brackets', seeding.brackets.slice(0, OPPONENTS_SHOWN)
    .map(({ set, a: x, b: y }) => `[${escapeMarkdown(set.event.tournament.name)}](${startggUrl(set.event.slug)}) · ${tagA} seed ${x} · ${tagB} seed ${y}`));
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
      const game = gameName(set.event);
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

// a card per game, the last 30 days over the 30 before. periods are newest first, each { since, until, summary }.
// verbose goes further into both and lists every period as a trend. characterSets is null if it couldn't be fetched
export function progress(player, periods, { verbose = false, characterSets = null } = {}) {
  const [current, previous] = periods;
  const days = Math.round((current.until - current.since) / DAY);
  const title = `${escapeMarkdown(player.tag)}'s progress`;
  const inGame = (period, game) => period.summary.games.find((entry) => entry.game === game);
  const games = [...new Set(periods.flatMap((period) => period.summary.games.map(({ game }) => game)))];
  if (!games.length) {
    return [baseEmbed(colors.brand).setTitle(title).setDescription(`No singles results in the last ${days * periods.length} days.`)];
  }
  const range = ({ since, until }) => `<t:${since}:d> to <t:${until}:d>`;

  return games.flatMap((game) => {
    const recent = inGame(current, game);
    const before = inGame(previous, game);
    const characters = ({ since, until }) => verbose && characterSets
      && characterLine(characterSets.filter((set) => set.videogame.displayName === game && set.completedAt >= since && set.completedAt < until));
    const lines = [
      `**Last ${days} days** · ${range(current)}`, ...periodLines(recent, verbose, characters(current)),
      '',
      `**Previous ${days} days** · ${range(previous)}`, ...periodLines(before, verbose, characters(previous)),
    ];
    const winRate = pointsLine('Win rate', setRate(recent), setRate(before));
    if (verbose) {
      section(lines, 'What changed', [winRate, ...changeLines(recent, before)].filter(Boolean));
      section(lines, `Every ${days} days, newest first`, periods.map((period) => `${range(period)} · ${trendText(inGame(period, game))}`));
      lines.push(`-# Singles only, DQs left out. Events count toward the ${days} days they started in. Seeds go by placement tier, `
        + 'close sets are ones that went to the last game, and characters only show up if the TO reported them');
    } else {
      if (winRate) lines.push('', winRate);
      lines.push(`-# Singles only, DQs left out. Events count toward the ${days} days they started in, and vs seed goes by placement tier`);
    }
    return withLines(baseEmbed(colors.brand, `Sama-tracker · ${game}`).setTitle(title).setURL(startggUrl(player.slug)), lines);
  });
}

// one game in one period of /progress. verbose adds games, close sets, seeds, upsets and characters
function periodLines(data, verbose = false, characters = null) {
  if (!data) return ['No sets or finished events.'];
  const lines = [`Sets: ${winLoss(data.wins, data.losses)}`];
  if (verbose) {
    const games = gameCount(data.played);
    if (games.won + games.lost) lines.push(`Games: ${winLoss(games.won, games.lost)}`);
    lines.push(closeLine(data.played), seedLine(data.played));
  }

  const sized = data.events.filter(({ event }) => event.numEntrants > 0);
  if (sized.length) {
    lines.push(`Placements: ${count(data.events.length, 'event')} · average ${topText(averageFinish(sized))}`);
    lines.push(`Best: ${placementLine(sized.toSorted(byFinish)[0])}`);
  } else if (data.events.length) {
    lines.push(`Placements: ${count(data.events.length, 'event')}, no bracket sizes reported`);
  } else {
    lines.push('Placements: no finished events');
  }

  const seeded = data.events.filter(({ seed }) => seed > 0);
  if (seeded.length) {
    const better = seeded.filter(({ placement, seed }) => step(placement) < step(seed)).length;
    const worse = seeded.filter(({ placement, seed }) => step(placement) > step(seed)).length;
    lines.push(`Vs seed: ${better} better · ${seeded.length - better - worse} on seed · ${worse} worse`);
  } else {
    lines.push('Vs seed: no seeded finishes reported');
  }

  if (verbose) {
    const { win, loss } = biggestUpsets(data.played);
    if (win) lines.push(`Best win: ${upsetLine(win)}`);
    if (loss) lines.push(`Worst loss: ${upsetLine(loss)}`);
    lines.push(characters);
  }
  return lines.filter(Boolean);
}

// share of sets or games won, null with nothing played
const setRate = (data) => (data?.wins + data?.losses ? data.wins / (data.wins + data.losses) : null);
function gameRate(data) {
  const { won, lost } = gameCount(data?.played ?? []);
  return won + lost ? won / (won + lost) : null;
}

// Win rate up 4.0 points. null unless both rates exist
function pointsLine(label, now, before) {
  if (now === null || before === null) return null;
  const points = 100 * (now - before);
  return `${label} ${points >= 0 ? 'up' : 'down'} ${Math.abs(points).toFixed(1)} points`;
}

// verbose /progress, the last period against the one before
function changeLines(recent, before) {
  const lines = [pointsLine('Games won', gameRate(recent), gameRate(before))];
  const [now, then] = [recent, before].map((data) => averageFinish(data?.events ?? []));
  if (now !== null && then !== null) lines.push(`Average finish ${topText(then)} → ${topText(now)}`);
  lines.push(rematchLine(recent?.played ?? [], before?.played ?? []));
  return lines;
}

// opponents from both periods and how each went, the most sets first
function rematchLine(recent, before) {
  const byOpponent = (played) => Map.groupBy(played, ({ them }) => them.playerIds[0] ?? them.name);
  const now = byOpponent(recent);
  const then = byOpponent(before);
  const sets = ([id, list]) => list.length + then.get(id).length;
  const both = [...now].filter(([id]) => then.has(id))
    .sort((x, y) => sets(y) - sets(x))
    .slice(0, REMATCHES_SHOWN)
    .map(([id, list]) => `${escapeMarkdown(list[0].them.name)} ${shortRecord(then.get(id))} → ${shortRecord(list)}`);
  return both.length ? `Rematches, before → now: ${both.join(' · ')}` : null;
}

// one period of the verbose /progress trend
function trendText(data) {
  if (!data) return 'no sets or events';
  const parts = [];
  if (data.played.length) parts.push(`sets ${winLoss(data.wins, data.losses)}`);
  const average = averageFinish(data.events);
  if (data.events.length) parts.push(`${count(data.events.length, 'event')}${average === null ? '' : `, average ${topText(average)}`}`);
  return parts.join(' · ');
}

// verbose /progress, game record on each character they reported
function characterLine(sets) {
  const usage = characterUsage(sets);
  if (!usage.reported) return null;
  const shown = usage.characters.slice(0, LEANS_SHOWN).map(({ name, wins, games }) => `${escapeMarkdown(name)} ${winLoss(wins, games - wins)}`);
  return `Game record by character: ${shown.join(' · ')}`;
}

// their record over their last 20 sets in each game, the game they played last first.
// verbose adds the last 90 days, which says more for someone who doesn't play much
function formLines(played, verbose = false) {
  const since = Math.floor(Date.now() / 1000) - 90 * DAY;
  return [...Map.groupBy(played, ({ set }) => gameName(set.event))].slice(0, GAMES_SHOWN).map(([game, list]) => {
    const recent = list.slice(0, RECENT_SETS);
    const line = `${escapeMarkdown(game)}: ${recordOf(recent)} · last ${count(recent.length, 'set')}`;
    if (!verbose) return line;
    const lately = list.filter(({ set }) => set.completedAt >= since);
    return `${line} · ${lately.length ? recordOf(lately) : 'none'} in the last 90 days`;
  });
}

// W 2-1 vs Foo · Tournament · date, with the round for verbose
function latestSetLine({ set, me, them, won }, round = false) {
  return `${won ? 'W' : 'L'} ${scoreText(me, them)} vs ${escapeMarkdown(them.name)}${round ? ` · ${set.round}` : ''} · ${setLink(set)} · <t:${set.completedAt}:d>`;
}

// sets between the two from player's side, newest first. both histories since either can get cut off
function meetingsOf(player, opponent, mine, theirs) {
  const sets = [...new Map([...mine, ...theirs].map((set) => [set.id, set])).values()];
  return singles(sets, player)
    .filter(({ them }) => them.playerIds.includes(opponent.playerId))
    .sort((x, y) => y.set.completedAt - x.set.completedAt);
}

export function scout(player, opponent, mine, theirs, characterSets) {
  const played = singles(theirs, opponent);
  const meetings = meetingsOf(player, opponent, mine, theirs);
  const lines = ['**Recent form**', ...formLines(played)];
  if (!played.length) lines.push('No recent singles sets.');
  section(lines, 'Latest sets', played.slice(0, LATEST_SETS).map((result) => latestSetLine(result)));
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
  for (const [game, list] of [...Map.groupBy(meetings, ({ set }) => gameName(set.event))].slice(0, GAMES_SHOWN)) {
    lines.push(`${escapeMarkdown(game)}: ${recordOf(list)}`);
  }
  if (!meetings.length) lines.push('You haven\'t played each other in singles, as far back as this checks.');
  lines.push('-# From up to 600 singles sets each, and 400 for characters. Characters only show up if the TO reported them. `verbose:True` for the full report');
  return withLines(baseEmbed(colors.brand).setTitle(`Scouting ${opponent.tag}`).setURL(startggUrl(opponent.slug)), lines);
}

// /scout verbose. their lifetime cards, then how they play, their characters and stages, and how you match up.
// odds is from predict and null when you've never played the same game. players is everyone tracked
export function scoutReport(player, opponent, { mine, theirs, characterSets, events, odds, players }) {
  const cards = lifetimeStats(opponent, events, theirs, players, 'Scouting');
  const played = singles(theirs, opponent);
  const meetings = meetingsOf(player, opponent, mine, theirs);
  if (!played.length) return [...cards, ...matchup(player, opponent, meetings, odds)];

  // the game you'd play them in, or their most played if you don't share one
  const focus = odds?.game ?? [...Map.groupBy(played, ({ set }) => gameName(set.event))].sort(([, x], [, y]) => y.length - x.length)[0][0];
  return [...cards, ...tendencies(played, focus), ...scoutCharacters(characterSets, focus), ...matchup(player, opponent, meetings, odds)];
}

// /scout verbose, form in every game and how they play the one that matters
function tendencies(played, focus) {
  const lines = ['**Recent form**', ...formLines(played, true)];
  section(lines, `Habits · ${escapeMarkdown(focus)}`, habitLines(played.filter(({ set }) => gameName(set.event) === focus)));
  section(lines, 'Latest sets', played.slice(0, SCOUT_LATEST_SETS).map((result) => latestSetLine(result, true)));
  return withLines(baseEmbed(colors.brand).setTitle('Form and tendencies'), lines);
}

// close sets, seeds, which side of the bracket and how often sets are one-sided
function habitLines(played) {
  const lines = [closeLine(played), seedLine(played)];
  const sides = [['winners side', /winners/i], ['losers side', /losers/i], ['grand finals', GRAND_FINALS]]
    .map(([name, pattern]) => [name, played.filter(({ set }) => pattern.test(set.round ?? ''))])
    .filter(([, list]) => list.length);
  if (sides.length) lines.push(`Bracket: ${sides.map(([name, list]) => `${name} ${recordOf(list)}`).join(' · ')}`);

  const scored = played.filter(({ me, them }) => me.score !== null && them.score !== null);
  const wins = scored.filter(({ won }) => won);
  const losses = scored.filter(({ won }) => !won);
  const sweeps = [];
  if (wins.length) sweeps.push(`won ${wins.filter(({ them }) => them.score === 0).length} of ${wins.length} without dropping a game`);
  if (losses.length) sweeps.push(`lost ${losses.filter(({ me }) => me.score === 0).length} of ${losses.length} without taking one`);
  if (sweeps.length) lines.push(`Sweeps: ${sweeps.join(' · ')}`);
  return lines.filter(Boolean);
}

// /scout verbose, each game's characters with the matchups and stages they win and lose. focus game first
function scoutCharacters(characterSets, focus) {
  const embed = baseEmbed(colors.brand).setTitle('Characters and stages');
  const games = [...new Map(characterSets.map((set) => [set.videogame.id, set.videogame])).values()]
    .map((game) => ({ game, usage: characterUsage(characterSets.filter((set) => set.videogame.id === game.id)) }))
    .filter(({ usage }) => usage.reported)
    .sort((a, b) => (b.game.displayName === focus) - (a.game.displayName === focus) || b.usage.games - a.usage.games);
  if (!games.length) {
    return [embed.setDescription(`No characters reported in their last ${count(characterSets.length, 'singles set')}. Lots of tournaments don't bother.`)];
  }

  const lines = [];
  for (const { game, usage } of games.slice(0, SCOUT_CHARACTER_GAMES)) {
    const more = usage.characters.length - CHARACTERS_SHOWN;
    section(lines, escapeMarkdown(game.displayName), [
      ...usage.characters.slice(0, CHARACTERS_SHOWN).map((character, i) => `${characterRank(usage, character, i)} · last <t:${character.last}:R>`),
      more > 0 && `-# and ${more} more`,
      ...leanLines(usage.against, 'Struggles against', 'Strong against'),
      ...leanLines(usage.stages, 'Worst stages', 'Best stages'),
      `-# Reported in ${usage.reported} of their last ${count(usage.scanned, `${game.displayName} set`)}`,
    ].filter(Boolean));
  }
  return withLines(embed, lines);
}

// the ones they lose most then win most, with enough games to go on. losing first since that's what to pick
function leanLines(records, badLabel, goodLabel) {
  const { good, bad } = leans(records);
  const list = (each) => each.slice(0, LEANS_SHOWN).map(({ name, wins, games }) => `${escapeMarkdown(name)} ${winLoss(wins, games - wins)}`).join(' · ');
  return [bad.length && `${badLabel}: ${list(bad)}`, good.length && `${goodLabel}: ${list(good)}`].filter(Boolean);
}

// /scout verbose, the caller against them
function matchup(player, opponent, meetings, odds) {
  const tagA = escapeMarkdown(player.tag);
  const tagB = escapeMarkdown(opponent.tag);
  const lines = [];
  if (odds) {
    const chance = chancePercent(odds);
    lines.push(`**Odds:** ${tagA} ${chance}% · ${100 - chance}% ${tagB} in ${escapeMarkdown(odds.game)}`);
  }
  if (meetings.length) {
    const byGame = [...Map.groupBy(meetings, ({ set }) => gameName(set.event))];
    lines.push(`**Head-to-head:** ${byGame.map(([game, list]) => `${escapeMarkdown(game)} ${recordOf(list)}`).join(' · ')}`);
    lines.push(...meetings.slice(0, MEETINGS_SHOWN).map(meetingLine));
    if (meetings.length > MEETINGS_SHOWN) lines.push(`-# and ${count(meetings.length - MEETINGS_SHOWN, 'older set')}`);
  } else {
    lines.push('**Head-to-head:** you haven\'t played each other in singles, as far back as this checks');
  }
  if (odds?.common.total) section(lines, `Common opponents · ${odds.common.total} in ${escapeMarkdown(odds.game)}`, commonOpponentLines(odds, tagA, tagB));
  lines.push('-# From up to 3000 of their singles sets, 1600 for characters and stages, every event they placed in and up to 600 of yours. '
    + `${odds ? 'Odds work like /predict, and characters' : 'Characters'} and stages only show up if the TO reported them`);
  return withLines(baseEmbed(colors.clash).setTitle(`${tagA} vs ${tagB}`), lines);
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

// their biggest upset win and the biggest upset they lost to. ties go to the newest
function biggestUpsets(played) {
  const upsets = played.filter((result) => upsetSize(result) > 0).sort((x, y) => upsetSize(y) - upsetSize(x));
  return { win: upsets.find(({ won }) => won), loss: upsets.find(({ won }) => !won) };
}

function winLoss(wins, losses) {
  return `${wins}-${losses}${wins + losses ? ` (${percent(wins, wins + losses)})` : ''}`;
}

// for a list of results from fromSide
function recordOf(list) {
  const wins = list.filter(({ won }) => won).length;
  return winLoss(wins, list.length - wins);
}

// 2-1, without the percent
function shortRecord(list) {
  const wins = list.filter(({ won }) => won).length;
  return `${wins}-${list.length - wins}`;
}

// singles results from the player's side, DQs left out
function singles(sets, player) {
  return sets.map((set) => fromSide(set, player.playerId)).filter((result) => result && !result.dq);
}

function gameName(event) {
  return event.videogame?.displayName ?? 'Other';
}

const GRAND_FINALS = /grand final/i;

// some sets only have a winner reported, no score
function gameCount(played) {
  const scored = played.filter(({ me, them }) => me.score !== null && them.score !== null);
  return { won: scored.reduce((sum, { me }) => sum + me.score, 0), lost: scored.reduce((sum, { them }) => sum + them.score, 0) };
}

// went to the last game, like 2-1 or 3-2
const isClose = ({ me, them }) => me.score > 0 && them.score > 0 && Math.abs(me.score - them.score) === 1;

function closeLine(played) {
  const close = played.filter(isClose);
  return close.length ? `Close sets: ${recordOf(close)}` : null;
}

// against people seeded a placement tier above them in that bracket, then below
function seedLine(played) {
  const seeded = played.filter(({ me, them }) => me.seed && them.seed);
  const higher = seeded.filter(({ me, them }) => step(them.seed) < step(me.seed));
  const lower = seeded.filter(({ me, them }) => step(them.seed) > step(me.seed));
  const parts = [higher.length && `higher seeds ${recordOf(higher)}`, lower.length && `lower seeds ${recordOf(lower)}`].filter(Boolean);
  return parts.length ? `Against ${parts.join(' · ')}` : null;
}

// W 2-1 · Winners Final · Tournament · date
function meetingLine({ set, me, them, won }) {
  return `${won ? 'W' : 'L'} ${scoreText(me, them)} · ${set.round} · ${setLink(set)} · <t:${set.completedAt}:d>`;
}

// relative to bracket size, so 4th of 84 beats 3rd of 20
const finish = (entry) => entry.placement / entry.event.numEntrants;
const byFinish = (x, y) => finish(x) - finish(y) || y.event.numEntrants - x.event.numEntrants;

// mean of finish, null with no bracket sizes to go on
function averageFinish(events) {
  const sized = events.filter(({ event }) => event.numEntrants > 0);
  return sized.length ? sized.reduce((total, entry) => total + finish(entry), 0) / sized.length : null;
}

const topText = (share) => `top ${Math.ceil(share * 100)}%`;

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

// two cards: the lifetime numbers, then the results behind them. /scout verbose labels them its own way
export function lifetimeStats(player, events, sets, players, label = 'Lifetime stats') {
  const overview = baseEmbed(colors.brand)
    .setAuthor({ name: label })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (player.image) overview.setThumbnail(player.image);

  const entered = events.filter((entry) => !entry.dq);
  const played = singles(sets, player);
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
  const games = gameCount(played);
  if (games.won + games.lost) stat('Games', winLoss(games.won, games.lost));

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

  const byGame = breakdown(entered, played, gameName, (set) => gameName(set.event))
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

// 1. Fox · 70% of games · won 40 of 60 (67%), the main in bold
function characterRank(usage, character, i) {
  const share = usage.characters.length > 1 ? ` · ${percent(character.games, usage.games)} of games` : '';
  const won = `won ${character.wins} of ${character.games} (${percent(character.wins, character.games)})`;
  const name = i === 0 ? `**${character.name}**` : character.name;
  // escaped so discord shows "1." as typed instead of making it a list
  return `${i + 1}\\. ${name}${share} · ${won}`;
}

// file is the uploaded art of their main. no game means it covers every game. note goes at the bottom.
// searched is how many sets got looked through across every game
export function characters(player, usage, { game, file, note, searched = 0 } = {}) {
  const embed = baseEmbed(colors.brand, game ? `Sama-tracker · ${game}` : undefined)
    .setAuthor({ name: 'Characters' })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (file) embed.setThumbnail(`attachment://${file}`);

  const sets = game ? `${game} singles set` : 'singles set';
  const from = `their last ${count(usage.scanned, sets)}`;
  let nothing;
  // only a few hundred get looked at, so they could have older ones
  if (!usage.scanned) nothing = searched ? `No ${sets}s in their last ${count(searched, 'singles set')}.` : `No ${sets}s on start.gg yet.`;
  else if (!usage.reported) nothing = `No characters reported in ${from}. Lots of tournaments don't bother.`;
  if (nothing) return embed.setDescription(note ? `${nothing}\n-# ${note}` : nothing);

  const lines = [];
  for (const [i, character] of usage.characters.slice(0, CHARACTERS_SHOWN).entries()) {
    lines.push(characterRank(usage, character, i));
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

// the commands where a blank player falls back to whoever ran it
const LOOKUP_COMMANDS = ['/stats', '/recent', '/upcoming', '/run', '/progress', '/characters', '/h2h', '/predict'];

// /link worked. says what a blank player does now, and what linking doesn't do
export function linked(player, previous) {
  const lines = [
    'Leave the player blank in these and they look you up:',
    LOOKUP_COMMANDS.map((name) => `\`${name}\``).join(' '),
    '',
    'Try `/stats` with nothing filled in. Typing your name won\'t find you, since only tracked players can be picked.',
    '',
    '**Not tracked:** nothing about you gets posted, and you won\'t be in `/track list`.',
  ];
  if (previous) lines.push(`-# Replaced your link to ${escapeMarkdown(previous.tag)}`);
  lines.push('-# `/unlink` to undo');
  const embed = baseEmbed(colors.brand)
    .setTitle(`Linked to ${escapeMarkdown(player.tag)}`)
    .setURL(startggUrl(player.slug))
    .setDescription(lines.join('\n'));
  if (player.image) embed.setThumbnail(player.image);
  return embed;
}

// /profile. who they are here on top, their start.gg under it
export function profile(account, member) {
  const url = startggUrl(account.slug);
  const embed = baseEmbed(colors.brand)
    .setAuthor({ name: member.name, iconURL: member.avatar })
    .setTitle(escapeMarkdown(account.tag))
    .setURL(url)
    .setDescription(`[${url.replace('https://www.', '')}](${url})\n-# Discord connected on start.gg`);
  if (account.image) embed.setThumbnail(account.image);
  return embed;
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
    '`/profile` someone\'s start.gg profile, if their start.gg has their Discord connected',
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
    '-# Tracked players with Discord connected on start.gg don\'t need to link, and /link tells them so',
    '',
    '**Player stats**',
    '`/h2h` record against someone. `verbose:True` for every set, splits and streaks',
    '`/stats` set record, placements and best upset. `verbose:True` for a lifetime report',
    '`/characters` characters someone has reported and how they do on each. `game:` Ultimate or Melee, left out it\'s whichever has more reported. `verbose:True` adds every other game, picked one first',
    '`/predict` odds of beating someone. `verbose:True` shows how each part counts',
    '`/scout profile:<link or ID>` scout any opponent. Only for tracked players with Discord connected on start.gg. `verbose:True` adds their whole history, habits, matchups, stages and your odds',
    '`/progress` last 30 days vs the previous 30, by game. `verbose:True` adds games, close sets, seeds, upsets, rematches and a 6 month trend',
    '',
    '**Registration**',
    '`/set_reg_reminder` ping everyone with reg pings on as a tournament\'s registration deadline gets close',
    '`/delete_reg_reminder` cancel one',
    '`/reg_admin` TOs whose start.gg tournaments get reg reminders automatically',
    '`/reg_role` reg reminder pings on or off, skipped once you\'re registered if your Discord is connected on start.gg',
    '`/bracket` bracket links for reg reminder tournaments that are live or start within 30 min',
    '`/registered` who in this server is registered for a tournament, by name so nobody gets pinged',
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
