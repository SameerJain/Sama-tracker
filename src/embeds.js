import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { url } from './startgg.js';

const color = { brand: 0x5b21b6, win: 0x22c55e, loss: 0xef4444, clash: 0xf59e0b, results: 0xfacc15 };

const embed = (c) => new EmbedBuilder().setColor(c).setFooter({ text: 'Dark Fundies' });
const link = (p) => `[${escapeMarkdown(p.tag)}](${url(p.slug)})`;
const when = (ts) => `<t:${ts}:F> (<t:${ts}:R>)`;
const where = (t) => (t.isOnline ? 'Online' : [t.city, t.addrState].filter(Boolean).join(', ') || 'Location TBA');
const eventName = (e) => (e.entrants ? `${e.event} · ${e.entrants} entrants` : e.event);
const medal = (n) => ({ 1: '🥇', 2: '🥈', 3: '🥉' })[n] ?? (n <= 8 ? '🔥' : '▫️');

function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return n + (teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}

function tournamentEmbed(c, label, t) {
  const e = embed(c).setAuthor({ name: label }).setTitle(t.name).setURL(url(t.slug));
  return t.images?.[0] ? e.setThumbnail(t.images[0].url) : e;
}

// Tracked entries grouped by event.
function byEvent(t, players) {
  const groups = {};
  for (const entry of t.entries) {
    const p = players[entry.userId];
    if (p) (groups[entry.eventSlug] ??= []).push({ ...entry, p });
  }
  return Object.values(groups);
}

export function set(s, players) {
  const owner = (side) => players.find((p) => side.playerIds.includes(p.playerId));
  const clash = s.sides.every(owner);
  // Tracked player goes first. If both players are tracked, the winner goes first.
  const first = (side) => (clash ? side.id === s.winnerId : Boolean(owner(side)));
  const [me, them] = [...s.sides].sort((a, b) => first(b) - first(a));
  const won = me.id === s.winnerId;
  const dq = me.score === -1 || them.score === -1;
  const score = dq ? 'DQ' : me.score === null || them.score === null ? 'vs' : `${me.score}-${them.score}`;

  const e = embed(clash ? color.clash : won ? color.win : color.loss)
    .setTitle(`${clash ? 'Crew clash' : won ? 'W' : 'L'} · ${escapeMarkdown(me.name)} ${score} ${escapeMarkdown(them.name)}`)
    .setURL(url(`${s.event.slug}/set/${s.id}`))
    .setDescription(`**${s.round}** · ${s.event.name}\n[${escapeMarkdown(s.event.tournament.name)}](${url(s.event.tournament.slug)})`)
    .setTimestamp(s.completedAt * 1000);

  const p = owner(me);
  if (p) e.setAuthor({ name: p.tag, iconURL: p.image, url: url(p.slug) });
  const chars = [me, them].filter((side) => side.characters.length);
  if (chars.length) e.addFields({ name: 'Characters', value: chars.map((side) => `${escapeMarkdown(side.name)}: ${side.characters.join(', ')}`).join('\n') });
  if (s.event.tournament.images?.[0]) e.setThumbnail(s.event.tournament.images[0].url);
  if (s.event.videogame) e.setFooter({ text: `Dark Fundies · ${s.event.videogame.displayName}` });
  return e;
}

export function rollCall(t, players) {
  return tournamentEmbed(color.brand, 'Roll call', t)
    .setDescription(`Starts ${when(t.startAt)}\n${where(t)}`)
    .addFields(byEvent(t, players).map((g) => ({ name: eventName(g[0]), value: g.map((x) => link(x.p)).join('\n') })));
}

export function results(t, players) {
  return tournamentEmbed(color.results, 'Results', t)
    .addFields(byEvent(t, players).map((g) => ({
      name: eventName(g[0]),
      value: g
        .sort((a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity))
        .map((x) => (x.placement ? `${medal(x.placement)} ${ordinal(x.placement)} ${link(x.p)}${x.dq ? ' (DQ)' : ''}` : `${link(x.p)} (no placement yet)`))
        .join('\n'),
    })));
}

export function upcoming(tournaments, players, who) {
  const e = embed(color.brand).setTitle(`Upcoming · ${who}`);
  if (!tournaments.length) return e.setDescription('Nobody is registered for anything yet.');
  if (tournaments.length > 10) e.setDescription(`Showing the next 10 of ${tournaments.length}.`);
  return e.addFields(tournaments.slice(0, 10).map((t) => {
    const events = {};
    for (const x of t.entries) (events[x.userId] ??= []).push(x.event);
    const lines = Object.entries(events).map(([id, names]) => `${link(players[id])}: ${names.join(', ')}`);
    return { name: t.name, value: [when(t.startAt), `${where(t)} · [start.gg](${url(t.slug)})`, ...lines].join('\n').slice(0, 1024) };
  }));
}

export function list(players) {
  const all = Object.values(players);
  return embed(color.brand)
    .setTitle(`Tracking ${all.length}`)
    .setDescription(all.map(link).join('\n') || 'Nobody yet. Add someone with `/df track add`.');
}

export function added(p) {
  const e = embed(color.brand).setDescription(`Now tracking ${link(p)}`);
  return p.image ? e.setThumbnail(p.image) : e;
}

export function help() {
  return embed(color.brand).setTitle('Dark Fundies').setDescription([
    '`/df track add` track a start.gg player by profile link or ID',
    '`/df track remove` stop tracking someone',
    '`/df track list` everyone being tracked',
    '`/df upcoming` tournaments a player (or `all`) is registered for',
    '`/df recent` latest sets for a player (or `all`)',
    '',
    'Posted to this channel automatically:',
    '• every set a tracked player finishes',
    '• who is entered, 6 hours before a tournament starts',
    '• placements once everyone\'s events are done',
  ].join('\n'));
}
