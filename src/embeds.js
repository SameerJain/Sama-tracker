import { EmbedBuilder, embedLength, escapeMarkdown } from 'discord.js';
import { fromSide, startggUrl } from './startgg.js';
import { FORM_SETS } from './predict.js';

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

function baseEmbed(color, footer = 'Dark Fundies') {
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

// one embed per event, best placement first
export function results(tournament, players) {
  return groupByEvent(tournament, players).flatMap((entries) => {
    entries.sort((a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity));
    return withLines(tournamentEmbed(colors.results, `Results · ${eventTitle(entries[0])}`, tournament), entries.map(placementText));
  });
}

function placementText(entry) {
  let name = playerLink(entry.player);
  if (entry.dq) name += ' (DQ)';
  if (!entry.placement) return `${name} (no placement yet)`;
  return `${medal(entry.placement)}${ordinal(entry.placement)} ${name}`;
}

// a card per tournament so each one gets its own image
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

  // a card per tournament, so a big one gets cut off instead of carrying on
  const [shown, ...rest] = split(lines, 4000);
  const hidden = rest.flat().length;
  if (hidden) shown.push(`-# and ${hidden} more`);
  return tournamentEmbed(color, label, tournament).setDescription(shown.join('\n'));
}

export function headToHead(a, b, sets) {
  const results = sets.map((set) => fromSide(set, a.playerId));
  const wins = results.filter((result) => result.won).length;
  const losses = results.length - wins;

  const embed = baseEmbed(colors.clash).setAuthor({ name: a.tag, iconURL: a.image, url: startggUrl(a.slug) });
  if (b.image) embed.setThumbnail(b.image);

  if (!results.length) {
    return embed
      .setTitle(`${escapeMarkdown(a.tag)} vs ${escapeMarkdown(b.tag)}`)
      .setDescription('They haven\'t played each other in singles on start.gg yet.');
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
  if (lines.length) lines.push('');

  for (const { set, me, them, won } of results.slice(0, 10)) {
    lines.push(`${won ? 'W' : 'L'} ${scoreText(me, them)} · ${set.round} · ${setLink(set)} · <t:${set.completedAt}:d>`);
  }
  return embed.setDescription(lines.join('\n'));
}

export function prediction(a, b, odds) {
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

// file is the uploaded render of their main
export function characters(player, usage, file) {
  const embed = baseEmbed(colors.brand, 'Dark Fundies · Ultimate')
    .setAuthor({ name: 'Characters' })
    .setTitle(escapeMarkdown(player.tag))
    .setURL(startggUrl(player.slug));
  if (file) embed.setThumbnail(`attachment://${file}`);

  const from = `their last ${count(usage.scanned, 'Ultimate singles set')}`;
  if (!usage.scanned) return embed.setDescription('No Ultimate singles sets on start.gg yet.');
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
  if (!all.length) return [embed.setDescription('Nobody yet. Add someone with `/df track add`.')];
  const lines = all.map((player) => {
    if (player.streamAlerts === false) return `${playerLink(player)} · stream alerts off`;
    return playerLink(player);
  });
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
  return baseEmbed(colors[name], `Dark Fundies · ${screenshot.name}`)
    .setTitle(title)
    .setURL(screenshot.page)
    .setDescription(text.slice(0, 4096))
    .setImage(`attachment://${image.name}`);
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
    '`/df characters` Ultimate characters someone has reported and how they do on each',
    '`/df predict` odds of one player beating another',
    '`/df stream` stream alerts on or off',
    '`/df status` uptime and the last start.gg checks',
    '`/df set_reg_reminder` ping Reg Reminders as a tournament\'s registration deadline gets close',
    '`/df delete_reg_reminder` cancel one',
    '`/df reg_role` reg reminder pings on or off, skipped once you\'re registered if your Discord is linked on start.gg',
    '`/df sm4sh` a love letter to Smash 4',
    '`/df melee` a Melee purist with a take',
    '`/df ult` an Ultimate player who hates Ultimate',
    '`/df pfp` my profile picture, full size',
    '-# upcoming, recent and stream also take `all` as the player',
    '',
    'Posted here automatically:',
    '• finished sets, and a player\'s first DQ in an event',
    '• sets on stream or up next in the stream queue',
    '• a roll call an hour before a tournament with 3+ of the crew',
    '• registration reminders a week, 3 days and a day out, then a last call 12 hours before',
    '• where everyone placed once it\'s over',
  ];
  return baseEmbed(colors.brand).setTitle('Dark Fundies').setDescription(lines.join('\n'));
}
