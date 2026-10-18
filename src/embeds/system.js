import { escapeMarkdown } from 'discord.js';
import { colors, FOOTER, baseEmbed, withLines, playerLink, count } from './shared.js';

// linked is how many people linked their own start.gg without being tracked
export function trackedList(players, linked = 0) {
  const all = Object.values(players).sort((a, b) => a.tag.localeCompare(b.tag));
  const embed = baseEmbed(colors.brand).setTitle(`Tracking ${all.length}`);
  // only what differs from a new player, who has set results and stream alerts off. no field means on
  const lines = all.map((player) => {
    const notes = [player.setResults !== false && 'set results on', player.streamAlerts !== false && 'stream alerts on'].filter(Boolean);
    return notes.length ? `${playerLink(player)} · ${notes.join(' · ')}` : playerLink(player);
  });
  if (!all.length) lines.push('Nobody yet. Add someone with `/track add`.');
  lines.push('', '-# Their placements get posted here, plus their sets and streams once `/sets` and `/stream` turn them on. Anyone can `/link` their own start.gg instead, to use the lookups without being posted');
  if (linked) lines.push(`-# ${count(linked, 'more person', 'more people')} linked, for lookups only`);
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

export function fun(name, title, { text, screenshot, image }) {
  return baseEmbed(colors[name], `${FOOTER} · ${screenshot.name}`)
    .setTitle(title)
    .setURL(screenshot.page)
    .setDescription(text.slice(0, 4096))
    .setImage(`attachment://${image.name}`);
}

export function funImage(title, image, page, name) {
  return baseEmbed(colors.bills, `${FOOTER} · ${name} · Wikimedia Commons`)
    .setTitle(title)
    .setURL(page)
    .setImage(image);
}

export function help() {
  const lines = [
    '**General**',
    '`/help` show the commands',
    '`/status` uptime and the last start.gg checks',
    '`/profile` someone\'s start.gg profile, if the bot has seen their account. `player:` a tracked or linked player, `user:` a server member',
    '`/socials` saved streams and social links',
    '`/socials_edit` add or remove those links. Manage Server by default',
    '`/messages` automatic post switches and the recap schedule. Needs Manage Server',
    '',
    '**Player tracking**',
    '`/track add` track someone by start.gg link or ID',
    '`/track remove` stop tracking someone',
    '`/track list` everyone tracked',
    '`/upcoming` live and upcoming tournaments',
    '`/recent` latest sets',
    '`/run` current run and next opponent in every bracket, whichever needs you soonest first',
    '`/stream` stream alerts on or off',
    '`/sets` automatic set results on or off',
    '-# New players start with both off. upcoming, recent, sets and stream also take `all`, everyone tracked',
    '',
    '**Linking yourself**',
    '`/link` tie your Discord to your own start.gg. Leave out the link and it finds yours. Then a blank player means you, `/scout` works, `/profile` finds you and others can pick you. Nothing gets posted',
    '`/unlink` undo that',
    '-# Tracking posts someone\'s results here. Linking only tells commands who you are, and tracked players with Discord on start.gg don\'t need it',
    '',
    '**Player stats**',
    '`/h2h` record against someone plus one-line odds, `/predict` for why. Either player also takes a start.gg link or ID. `verbose:True` every set, splits and streaks. `melee:True` Melee sets and odds only',
    '`/stats` set record, placements and best upset. `verbose:True` a lifetime report. `melee:True` Melee sets and placements only',
    '`/characters` reported characters, by game. `game:` Ultimate or Melee, left out it\'s whichever has more reported. `verbose:True` every game with characters reported',
    '`/predict` odds of beating someone. Either player also takes a start.gg link or ID. `verbose:True` shows how each part counts. `melee:True` Melee odds even when they play another game more',
    '`/scout` any opponent by player or start.gg link, with toughest opponents and worst matchups. Needs you tracked or linked. `verbose:True` more history, habits, stages and your odds. `melee:True` just their Melee',
    '`/progress` last 30 days vs the previous 30, by game. `verbose:True` streaks, close sets, seeds, upsets, rematches and a 6 month trend. `melee:True` Melee only',
    '-# Short reports have a Full report button, same as `verbose:True`',
    '',
    '**Registration**',
    '`/set_reg_reminder` set a registration reminder and track everyone registered',
    '`/delete_reg_reminder` cancel one',
    '`/reg_admin` TOs whose start.gg tournaments get reg reminders automatically',
    '`/reg_role` reg reminder pings on or off. Skipped once you\'re registered, if start.gg has your Discord',
    '`/bracket` bracket links for reg reminder tournaments that are live or start within 30 min',
    '`/registered` who in this server is registered for a tournament, by name so nobody gets pinged. `by_event:True` groups it by event',
    '`/reg_warn` warn someone who isn\'t registered yet. If they are, it just says so',
    '-# `tournament:` takes a link or one the bot knows',
    '',
    '**Fun**',
    '`/sm4sh` a love letter to Smash 4',
    '`/melee` a Melee purist with a take',
    '`/ult` an Ultimate player who hates Ultimate',
    '`/64` a 64 old head who says 64 did it first',
    '`/brawl` the last person still defending Brawl',
    '`/pplus` a Project+ player who wants you on netplay',
    '`/bills` Bills Mafia, one big photo and one rally cry',
    '-# Claude Haiku writes the Smash posts from the game\'s talking points, a random SmashWiki article and a YouTube video',
    '`/view_pfp` my profile picture, full size',
    '',
    '**Posted here automatically**',
    '• finished sets of players with `/sets` on, and their first DQ in an event',
    '• sets on stream or up next in the stream queue, for players with `/stream` on',
    '• a roll call an hour before a tournament with 3+ of the crew',
    '• registration reminders a week, 3 days and a day out, then a last call 12 hours before',
    '• where everyone placed, 12 hours after it ends, or 24 if the TO is late reporting',
    '• weekly crew recap of players with a non-DQ singles set that week. Sunday 9 pm ET unless `/messages` changes it',
  ];
  // close to discord's 4096. anything past it carries on in a second card, but the test keeps it to one
  return withLines(baseEmbed(colors.brand).setTitle('Sama-tracker'), lines);
}
