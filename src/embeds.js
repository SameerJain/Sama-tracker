import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { startggUrl } from './startgg.js';

const colors = {
  brand: 0x5b21b6,
  win: 0x22c55e,
  loss: 0xef4444,
  clash: 0xf59e0b,
  results: 0xfacc15,
  stream: 0x9146ff,
};

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
    .setDescription(`**${set.round}** · ${set.event.name}\n[${escapeMarkdown(tournament.name)}](${startggUrl(tournament.slug)})`);

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
    .setURL(twitch ?? startggUrl(`${set.event.slug}/set/${set.id}`))
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
  let color = won ? colors.win : colors.loss;
  if (clash) {
    label = 'Crew clash';
    color = colors.clash;
  }

  const embed = setEmbed(set, color, player)
    .setTitle(`${label} · ${escapeMarkdown(me.name)} ${scoreText(me, them)} ${escapeMarkdown(them.name)}`)
    .setURL(startggUrl(`${set.event.slug}/set/${set.id}`))
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
export function upcoming(tournaments, players, who) {
  if (!tournaments.length) {
    return [baseEmbed(colors.brand).setTitle(`Upcoming · ${who}`).setDescription('Nobody is registered for anything yet.')];
  }

  let label = `Upcoming · ${who}`;
  if (tournaments.length > 10) label += ` · next 10 of ${tournaments.length}`;
  return tournaments.slice(0, 10).map((tournament) => upcomingCard(tournament, players, label));
}

function upcomingCard(tournament, players, label) {
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

  return tournamentEmbed(colors.brand, label, tournament).setDescription(lines.join('\n'));
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
  const embed = baseEmbed(colors.brand).setDescription(`Now tracking ${playerLink(player)}`);
  if (player.image) embed.setThumbnail(player.image);
  return embed;
}

export function help() {
  const lines = [
    '`/df track add` track a start.gg player by profile link or ID',
    '`/df track remove` stop tracking someone',
    '`/df track list` everyone being tracked',
    '`/df upcoming` tournaments a player (or `all`) is registered for',
    '`/df recent` latest sets for a player (or `all`)',
    '`/df stream` turn on-stream alerts on or off for a player (or `all`)',
    '',
    'Posted to this channel automatically:',
    '• every set a tracked player finishes',
    '• when a tracked player\'s set is called on stream',
    '• who is entered, an hour before a tournament with 3+ of the crew starts',
    '• where the crew placed once their events are done',
  ];
  return baseEmbed(colors.brand).setTitle('Dark Fundies').setDescription(lines.join('\n'));
}
