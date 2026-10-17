import { escapeMarkdown } from 'discord.js';
import { colors, FOOTER, baseEmbed, withLines, playerLink, count } from './shared.js';

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
  return baseEmbed(colors[name], `${FOOTER} · ${screenshot.name}`)
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
    '`/run` current tournament run and next opponent in every bracket, the one that needs you soonest first',
    '`/stream` stream alerts on or off',
    '-# Only tracked players can be picked as the player. upcoming, recent and stream also take `all`',
    '',
    '**Looking yourself up**',
    '`/link` link your start.gg, then leave the player out of a command to get yourself. It doesn\'t track you',
    '`/unlink` undo that',
    '-# Tracked players with Discord connected on start.gg don\'t need to link, and /link tells them so',
    '',
    '**Player stats**',
    '`/h2h` record against someone. `verbose:True` for every set, splits and streaks. `melee:True` for Melee sets only',
    '`/stats` set record, placements and best upset. `verbose:True` for a lifetime report',
    '`/characters` characters someone has reported and how they do on each. `game:` Ultimate or Melee, left out it\'s whichever has more reported. `verbose:True` adds every other game, picked one first',
    '`/predict` odds of beating someone. `verbose:True` shows how each part counts',
    '`/scout profile:<link or ID>` scout any opponent. Only for tracked players with Discord connected on start.gg. `verbose:True` adds much more of their history, habits, matchups, stages and your odds',
    '`/progress` last 30 days vs the previous 30, by game. `verbose:True` adds games, close sets, seeds, upsets, rematches and a 6 month trend',
    '',
    '**Registration**',
    '`/set_reg_reminder` ping everyone with reg pings on as a tournament\'s registration deadline gets close',
    '`/delete_reg_reminder` cancel one',
    '`/reg_admin` TOs whose start.gg tournaments get reg reminders automatically',
    '`/reg_role` reg reminder pings on or off, skipped once you\'re registered if your Discord is connected on start.gg',
    '`/bracket` bracket links for reg reminder tournaments that are live or start within 30 min',
    '`/registered` who in this server is registered for a tournament, by name so nobody gets pinged. `by_event:True` lists it by event',
    '`/reg_warn` warn someone who isn\'t registered yet. If they are, it just says so',
    '',
    '**Fun**',
    '`/sm4sh` a love letter to Smash 4',
    '`/melee` a Melee purist with a take',
    '`/ult` an Ultimate player who hates Ultimate',
    '`/64` a 64 old head who says 64 did it first',
    '`/brawl` the last person still defending Brawl',
    '`/pplus` a Project+ player who wants you on netplay',
    '-# Claude Haiku writes those from real facts: the game\'s talking points, a random SmashWiki article and a YouTube video',
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
