import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { fromSide, startggUrl } from './startgg.js';
import { FORM_SETS } from './predict.js';

const colors = {
  brand: 0x5b21b6,
  win: 0x22c55e,
  loss: 0xef4444,
  // Two tracked players against each other.
  clash: 0xf59e0b,
  results: 0xfacc15,
  stream: 0x9146ff,
  live: 0xe11d48,
  sm4sh: 0x00a2e8,
};

// Where each seed is expected to finish in double elimination: 1st, 2nd, 3rd, 4th, 5th, 7th, 9th, 13th...
const PLACEMENTS = [1, 2];
for (let n = 2; n <= 4096; n *= 2) PLACEMENTS.push(n + 1, n * 1.5 + 1);

// How many placements down the list a seed or placement is. Seed 9 and 9th place are both 6.
const step = (n) => PLACEMENTS.findLastIndex((place) => place <= n);

// A win over a seed expected to finish this many placements higher is a major upset. Seed 9 over seed 2 is 5.
const MAJOR_UPSET = 5;

// /df stats lists this many of the latest events.
const RECENT_EVENTS = 4;

function baseEmbed(color, footer = 'Dark Fundies') {
  return new EmbedBuilder().setColor(color).setFooter({ text: footer });
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

// The tournament name, linking to the set itself.
function setLink(set) {
  return `[${escapeMarkdown(set.event.tournament.name)}](${setUrl(set)})`;
}

function percent(part, whole) {
  return `${Math.round((part / whole) * 100)}%`;
}

// Discord shows this in each reader's own timezone, plus a countdown like "in 3 hours".
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
  // start.gg reports a DQ as a score of -1.
  if (me.score === -1 || them.score === -1) return 'DQ';
  if (me.score === null || them.score === null) return 'vs';
  return `${me.score}-${them.score}`;
}

// Upset factor: how many placements apart the two seeds were expected to finish.
function upsetFactor(winner, loser) {
  if (!winner.seed || !loser.seed) return 0;
  return step(winner.seed) - step(loser.seed);
}

// The tracked player on this side of a set, if there is one.
function findTracked(side, players) {
  return Object.values(players).find((player) => side.playerIds.includes(player.playerId));
}

// Tracked players' entries, grouped by event.
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

// Round, event and tournament, shared by set results and stream alerts.
function setEmbed(set, color, player) {
  const game = set.event.videogame?.displayName;
  const tournament = set.event.tournament;

  const embed = baseEmbed(color, game ? `Dark Fundies · ${game}` : undefined)
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

  // Only Twitch has a link format we can count on. Other sources just show the stream name.
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

  // The tracked player goes first. If both are tracked, the winner goes first.
  const bFirst = clash ? b.id === set.winnerId : !trackedA;
  const me = bFirst ? b : a;
  const them = bFirst ? a : b;
  const player = bFirst ? trackedB : trackedA;
  const won = me.id === set.winnerId;

  let label = won ? 'W' : 'L';
  // Only when the tracked player is the one pulling it off. A DQ win doesn't count.
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
  const embed = tournamentEmbed(colors.brand, 'Roll call', tournament)
    .setDescription(`Starts ${timeText(tournament.startAt)}\n${locationText(tournament)}`);

  for (const entries of groupByEvent(tournament, players)) {
    const names = entries.map((entry) => playerLink(entry.player));
    embed.addFields({ name: eventTitle(entries[0]), value: names.join('\n') });
  }
  return embed;
}

// One embed per event the crew entered: where each of them placed, best first.
export function results(tournament, players) {
  return groupByEvent(tournament, players).map((entries) => {
    entries.sort((a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity));
    return tournamentEmbed(colors.results, `Results · ${eventTitle(entries[0])}`, tournament)
      .setDescription(entries.map(placementText).join('\n'));
  });
}

function placementText(entry) {
  let name = playerLink(entry.player);
  if (entry.dq) name += ' (DQ)';
  if (!entry.placement) return `${name} (no placement yet)`;
  return `${medal(entry.placement)}${ordinal(entry.placement)} ${name}`;
}

// One card per tournament so each one shows its own image. Discord allows 10 per message.
// Sorted by start time, so tournaments already underway come first, marked Live.
export function upcoming(tournaments, players, who) {
  if (!tournaments.length) {
    return [baseEmbed(colors.brand).setTitle(`Upcoming · ${who}`).setDescription('Nobody is registered for anything yet.')];
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

  return tournamentEmbed(color, label, tournament).setDescription(lines.join('\n'));
}

// Record from a's side, then the last 10 sets between them.
export function headToHead(a, b, sets) {
  const results = sets.map((set) => fromSide(set, a.playerId));
  const wins = results.filter((result) => result.won).length;
  const losses = results.length - wins;

  // a's picture top left as the author icon, the opponent's top right as the thumbnail.
  const embed = baseEmbed(colors.clash).setAuthor({ name: a.tag, iconURL: a.image, url: startggUrl(a.slug) });
  if (b.image) embed.setThumbnail(b.image);

  // A 0-0 title would read like a record, so say so plainly instead.
  if (!results.length) {
    return embed
      .setTitle(`${escapeMarkdown(a.tag)} vs ${escapeMarkdown(b.tag)}`)
      .setDescription('They haven\'t played each other in singles on start.gg yet.');
  }

  embed.setTitle(`${escapeMarkdown(a.tag)} ${wins}-${losses} ${escapeMarkdown(b.tag)}`);

  // Games from a's side, like the title. Some sets only have a winner reported, so those are left out.
  const scored = results.filter(({ me, them }) => me.score !== null && them.score !== null);
  const gamesWon = scored.reduce((sum, { me }) => sum + me.score, 0);
  const gamesLost = scored.reduce((sum, { them }) => sum + them.score, 0);

  const lines = [];
  if (gamesWon + gamesLost) {
    lines.push(`-# Games ${gamesWon}-${gamesLost} (${percent(gamesWon, gamesWon + gamesLost)} won)`);
  }
  // Call out whoever is ahead. A tie gets nothing.
  if (wins !== losses) {
    const leader = wins > losses ? a : b;
    lines.push(`**${escapeMarkdown(leader.tag)} leads ${Math.max(wins, losses)}-${Math.min(wins, losses)}**`);
  }
  if (lines.length) lines.push('');

  for (const { set, me, them, won } of results.slice(0, 10)) {
    lines.push(`${won ? 'W' : 'L'} ${scoreText(me, them)} · ${set.round} · ${setLink(set)} · <t:${set.completedAt}:d>`);
  }
  return embed.setDescription(lines.join('\n'));
}

// The odds, then the stats behind them. Every line names who it favors.
export function prediction(a, b, odds) {
  // Never a sure thing either way.
  const chanceA = Math.min(99, Math.max(1, Math.round(odds.chance * 100)));
  const embed = baseEmbed(colors.clash, `Dark Fundies · ${odds.game}`)
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
  const record = ({ wins, total }) => `${wins}-${total - wins}${total ? ` (${percent(wins, total)})` : ''}`;
  lines.push(`**Form:** ${tagA} ${record(form.a)} · ${tagB} ${record(form.b)}, last ${FORM_SETS} sets each`);

  return embed.setDescription(lines.join('\n'));
}

// A snapshot of the player: set record per game, best finish, biggest upset, then their latest few events.
export function stats(player, standings, sets) {
  const embed = baseEmbed(colors.brand)
    .setAuthor({ name: 'Stats' })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (player.image) embed.setThumbnail(player.image);

  // DQs don't count, same as h2h.
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

  // Best by how far up the bracket they finished, so 4th of 84 beats 3rd of 20. Ties go to the most recent.
  const best = standings
    .filter(({ event }) => event.numEntrants)
    .sort((x, y) => x.placement / x.event.numEntrants - y.placement / y.event.numEntrants)[0];
  if (best) lines.push(`**Best finish:** ${placementLine(best)}`);

  // Ties go to the most recent, since sets come newest first.
  const upset = played
    .filter(({ me, them, won }) => won && upsetFactor(me, them) > 0)
    .sort((x, y) => upsetFactor(y.me, y.them) - upsetFactor(x.me, x.them))[0];
  if (upset) {
    const { set, me, them } = upset;
    const score = scoreText(me, them) === 'vs' ? '' : ` ${scoreText(me, them)}`;
    lines.push(`**Biggest upset:** beat ${escapeMarkdown(them.name)} (seed ${them.seed})${score} as seed ${me.seed} at ${setLink(set)}`);
  }

  if (standings.length) {
    lines.push('', '**Latest events**', ...standings.slice(0, RECENT_EVENTS).map(placementLine));
  }

  const from = [];
  if (played.length) from.push(played.length === 1 ? '1 singles set' : `${played.length} singles sets`);
  if (standings.length) from.push(standings.length === 1 ? '1 event' : `${standings.length} events`);
  lines.push(`-# From their last ${from.join(' and ')} on start.gg`);

  return embed.setDescription(lines.join('\n'));
}

// 🥉 3rd of 20 (seed 2) · Ultimate Singles · Tournament · date
function placementLine({ placement, seed, dq, event }) {
  let text = `${medal(placement)}**${ordinal(placement)}**`;
  if (event.numEntrants) text += ` of ${event.numEntrants}`;
  const notes = [seed && `seed ${seed}`, dq && 'DQ'].filter(Boolean);
  if (notes.length) text += ` (${notes.join(', ')})`;
  const link = `[${escapeMarkdown(event.tournament.name)}](${startggUrl(event.slug)})`;
  return `${text} · ${escapeMarkdown(event.name)} · ${link} · <t:${event.startAt}:d>`;
}

export function trackedList(players) {
  const all = Object.values(players);
  const embed = baseEmbed(colors.brand).setTitle(`Tracking ${all.length}`);
  if (!all.length) return embed.setDescription('Nobody yet. Add someone with `/df track add`.');
  const lines = all.map((player) => {
    if (player.streamAlerts === false) return `${playerLink(player)} · stream alerts off`;
    return playerLink(player);
  });
  return embed.setDescription(lines.join('\n'));
}

export function added(player) {
  const embed = baseEmbed(colors.brand)
    .setDescription(`Now tracking ${playerLink(player)}.`);
  if (player.image) embed.setThumbnail(player.image);
  return embed;
}

// The image is attached to the message as `file`.
export function sm4sh(title, text, screenshot, file) {
  return baseEmbed(colors.sm4sh, `Dark Fundies · ${screenshot.name}`)
    .setTitle(title)
    .setURL(screenshot.page)
    .setDescription(text.slice(0, 4096))
    .setImage(`attachment://${file}`);
}

export function help() {
  const lines = [
    '`/df track add` track someone by start.gg link or ID',
    '`/df track remove` stop tracking someone',
    '`/df track list` everyone tracked',
    '`/df upcoming` live and upcoming tournaments',
    '`/df recent` latest sets',
    '`/df h2h` record between two players',
    '`/df stats` set record, placements and best upset',
    '`/df predict` odds of one player beating another',
    '`/df stream` stream alerts on or off',
    '`/df sm4sh` a love letter to Smash 4',
    '-# upcoming, recent and stream also take `all` as the player',
    '',
    'Posted here automatically:',
    '• finished sets, and a player\'s first DQ in an event',
    '• sets on stream or up next in the stream queue',
    '• a roll call an hour before a tournament with 3+ of the crew',
    '• where everyone placed once it\'s over',
  ];
  return baseEmbed(colors.brand).setTitle('Dark Fundies').setDescription(lines.join('\n'));
}
