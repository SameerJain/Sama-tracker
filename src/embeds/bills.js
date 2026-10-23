import { escapeMarkdown } from 'discord.js';
import { FOOTER, baseEmbed, colors } from './shared.js';

// middle length: the final, the records, quarters and yards, nothing more.
// green for a Bills win, red for a loss, with the other team's logo on the side
export function billsFinal(game, details = null) {
  const { opponent } = game;
  const color = game.won ? colors.win : colors.loss;
  const embed = baseEmbed(color, `${FOOTER} · ESPN`)
    .setTitle(`Bills final · Bills ${game.billsScore} – ${opponent.displayName} ${game.oppScore}`);
  // the other team's logo. without one the message falls back to the bot's avatar
  if (opponent.logo) embed.setThumbnail(opponent.logo);
  if (game.url) embed.setURL(game.url);
  const lines = [];
  const where = [game.week, game.venue].filter(Boolean).join(' · ');
  const winner = game.won ? 'Bills win' : `${escapeMarkdown(opponent.displayName)} win`;
  lines.push(`**${winner}**${where ? ` · ${escapeMarkdown(where)}` : ''} · <t:${game.date}:D>`);
  const withRecord = (team, record) => (record ? `${team} (${record})` : team);
  lines.push([withRecord('Bills', game.billsRecord), withRecord(opponent.displayName, opponent.record)].map(escapeMarkdown).join(' · '));
  const quarters = details?.lines;
  if (quarters && Object.values(quarters).some((each) => each.length)) {
    const line = (abbr, scores) => scores?.length ? `${abbr} ${scores.join('-')}` : null;
    const parts = [line('BUF', quarters.BUF), line(opponent.abbreviation, quarters[opponent.abbreviation])].filter(Boolean);
    if (parts.length) lines.push(`**By quarter:** ${parts.join(' · ')}`);
  }
  const ours = details?.stats?.BUF;
  const theirs = details?.stats?.[opponent.abbreviation];
  const snapshot = [statLine(ours, theirs, 'Yards', 'yards'), statLine(ours, theirs, 'Turnovers', 'turnovers')].filter(Boolean);
  if (snapshot.length) lines.push(snapshot.join(' · '));
  if (game.attendance) lines.push(`-# ${game.attendance.toLocaleString('en-US')} at ${escapeMarkdown(game.venue ?? 'the game')}`);
  return embed.setDescription(lines.join('\n'));
}

function statLine(bills, opp, label, key) {
  if (bills?.[key] == null && opp?.[key] == null) return null;
  return `**${label}:** BUF ${bills?.[key] ?? '-'} · ${opp?.[key] ?? '-'}`;
}
