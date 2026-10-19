import { escapeMarkdown } from 'discord.js';
import { colors, FOOTER, baseEmbed, withLines, withSections, playerLink, count } from './shared.js';

// linked is how many people linked their own start.gg without being tracked
export function trackedList(players, linked = 0) {
  const all = Object.values(players).sort((a, b) => a.tag.localeCompare(b.tag));
  const embed = baseEmbed(colors.brand).setTitle(`Tracking ${all.length}`);
  // only what differs from a new player, who has set results, stream alerts and match call pings off. no field means on for the first two
  const lines = all.map((player) => {
    const notes = [player.setResults !== false && 'set results on', player.streamAlerts !== false && 'stream alerts on', player.callPings === true && 'match call pings on'].filter(Boolean);
    return notes.length ? `${playerLink(player)} · ${notes.join(' · ')}` : playerLink(player);
  });
  if (!all.length) lines.push('Nobody yet. Add someone with `/track add`.');
  lines.push('', '-# Their placements get posted here, plus their sets, streams and match calls once `/sets`, `/stream` and `/calls` turn them on. Anyone can `/link` their own start.gg instead, to use the lookups without being posted');
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

  const lines = [`**Started:** ${ago(info.startedAt)}${info.host ? ` on ${escapeMarkdown(info.host)}` : ''}`];
  if (info.deployedAt) lines.push(`**Latest version deployed:** <t:${info.deployedAt}:R>`);
  lines.push(
    `**Last set check:** ${setCheck}`,
    `**Signups and placements updated:** ${ago(info.tournamentCheck)}`,
    `**Tracking:** ${count(info.players, 'player')} · ${count(info.tournaments, 'tournament')}`,
  );
  if (info.slippi) {
    let slippiCheck = ago(info.slippiCheck);
    if (info.slippiError) slippiCheck += `, last try failed (${escapeMarkdown(info.slippiError)})`;
    lines.push(`**Slippi ranks checked:** ${slippiCheck} · ${count(info.slippi, 'player')} on the watchlist`);
  }
  if (info.threadError) lines.push(`**Threads:** last post went in the channel (${escapeMarkdown(info.threadError)})`);
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

export function funImage(title, image, page, name, source = 'Wikimedia Commons') {
  return baseEmbed(colors.bills, `${FOOTER} · ${name} · ${source}`)
    .setTitle(title)
    .setURL(page)
    .setImage(image);
}

export function help() {
  const sections = [
    [
      '**General**',
      '`/help` this list',
      '`/status` uptime, when the latest version was deployed, and the last start.gg and Slippi checks',
      '`/profile` someone\'s start.gg profile, if the bot has seen their account. `player:` a tracked or linked player, `user:` a server member',
      '`/socials` saved streams and social links',
      '`/socials_edit` add or remove those links. Manage Server by default',
      '`/messages` automatic posts on or off, threads and the recap schedule. Needs Manage Server',
    ],
    [
      '**Tracking players**',
      '`/track add` track someone by start.gg link or ID',
      '`/track remove` stop tracking someone. Asks first, then Undo puts them back with their settings for a minute',
      '`/track list` everyone tracked',
      '`/sets` automatic set results on or off. Off for everyone asks first',
      '`/stream` stream alerts on or off',
      '`/stream_pings` get pinged for every stream alert, on or off. Just for you, no tracking needed',
      '`/calls` match call pings on or off',
      '`/upcoming` live and upcoming tournaments',
      '`/recent` latest sets',
      '`/run` your run and next opponent in each bracket, soonest first, with the station and scheduled time when the TO sets them',
      '-# New players start with set results, stream alerts and match call pings off. `player:all` works with sets, stream, calls, upcoming and recent',
    ],
    [
      '**Linking yourself**',
      '`/link` tie your Discord to your start.gg. Leave out the link and it finds yours',
      '`/unlink` undo that, with an Undo button for a minute',
      '-# Tracking posts someone\'s results here. Linking posts nothing, it just tells commands who you are: a blank player means you, `/scout` works and others can pick you. Tracked players with Discord on start.gg don\'t need it',
    ],
    [
      '**Player stats**',
      '`/stats` set record, placements and best upset',
      '`/doubles` one player\'s 2v2 record, partners and placements',
      '`/h2h` record against someone, with one-line odds',
      '`/predict` odds of beating someone, and why',
      '`/scout` an opponent\'s form, toughest opponents and worst matchups. Needs you tracked or linked',
      '`/progress` last 30 days vs the 30 before, by game',
      '`/characters` reported characters. `game:` Ultimate or Melee, left out it\'s whichever has more',
      '-# `verbose:True` shows more, same as the Full report button on short reports. `melee:True` sticks to Melee and adds Slippi ranks for players on the watchlist, which all-Melee reports show anyway. Melee cards say Melee at the top, other games show nothing there since Ultimate is the default. Melee `/predict`, `/h2h` and `/scout` odds count them when both players are ranked, even with no Melee sets to go on. `/characters game:Melee` adds Slippi ranked picks. Slippi ranked is singles, so `/doubles` leaves it out',
      '-# `since:2026-01-01` counts only sets since that date, and `venue:` only offline or online tournaments, on `/stats`, `/h2h`, `/scout` and `/predict`. Full report buttons keep them',
      '-# `/h2h`, `/predict` and `/scout` also take a start.gg link or ID, for players nobody tracks',
      '-# Your commands take start.gg turns one at a time. One sent while another loads says Queued and starts after it, up to 3 waiting. A public report done over a minute after you asked comes in a new message that pings you',
      '-# No typing: long-press someone, then Apps, then **H2H with me** or **Scout them**. `/run`, match calls and stream alerts have head-to-head buttons for the set coming up, which come off when it ends',
      '-# Player lists start with whoever you picked last, and a name matches with any spacing, case or punctuation. A name that matches nobody gets the closest one suggested',
      '-# An event named for Melee but tagged on start.gg as Ultimate counts as Melee, and the other way around',
    ],
    [
      '**Slippi ranked**',
      '`/slippi add` add a connect code to the watchlist. Leave it out to find yours on your start.gg',
      '`/slippi remove` take someone off the watchlist',
      '`/slippi rank` rank, rating, record, characters and past seasons. Takes any connect code',
      '`/slippi leaderboard` everyone on the watchlist, best rank first',
      '-# Cards show the rank badge and their most played character. Tracked and linked players get added on their own once their code turns up in a start.gg netplay registration. Ranks come from slippi.gg, which has no public API, so this can break if Slippi changes it',
    ],
    [
      '**Registration**',
      '`/set_reg_reminder` remind people to register, and track everyone registered',
      '`/delete_reg_reminder` cancel one. Asks first',
      '`/reg_admin` TOs whose start.gg tournaments get reminders automatically',
      '`/reg_role` reminder pings on or off. Skipped once you\'re registered, if start.gg has your Discord',
      '`/registered` who here is registered, by name so nobody gets pinged. `by_event:True` groups it by event',
      '`/reg_warn` warn someone who isn\'t registered yet. If they are, it just says so. Once per person per tournament in 12 hours',
      '`/bracket` bracket links for reminder tournaments that are live or start within 30 min',
      '`/stream_link` stream links for tracked and reminder tournaments that are live or start within 30 min',
      '-# `tournament:` takes a link or one the bot knows',
    ],
    [
      '**Fun**',
      '`/64` a 64 old head who says 64 did it first',
      '`/melee` a Melee purist with a take',
      '`/brawl` the last person still defending Brawl',
      '`/sm4sh` a love letter to Smash 4',
      '`/ult` an Ultimate player who hates Ultimate',
      '`/pplus` a Project+ player who wants you on netplay',
      '`/bills` Bills photos, memes and GIFs with a rally cry. Uses each image in a pool before repeating',
      '`/view_pfp` my profile picture, full size',
    ],
    [
      '**Posted here automatically**',
      '• finished sets of players with `/sets` on, and their first DQ in an event. For an hour after, a winner or score the TO fixes gets edited in, and a reset set gets marked',
      '• sets on stream or up next in the stream queue for 30 seconds, for players with `/stream` on, pinging everyone with `/stream_pings` on',
      '• called sets, pinging players with `/calls` on whose Discord is on start.gg, all four in one message for doubles. A call the TO takes back gets crossed out, and one not started 5 minutes in pings them again',
      '• a roll call an hour before a tournament with 3+ of the crew',
      '• registration reminders a week, 3 days and a day out, then a last call 12 hours before',
      '• where everyone placed, 12 hours after it ends, or 24 if the TO is late reporting. Projected placements get edited once start.gg has them final',
      '• with `/messages top8` on, the full top 8 of each event the crew played in, at the same time',
      '• Slippi rank changes for the watchlist, checked every 30 minutes',
      '• a weekly recap of players with a non-DQ singles set that week. Sunday 9 pm ET unless `/messages` changes it',
      '-# `/messages threads` has three modes for set results and stream alerts: off, one thread per tournament, or one thread per event. If a thread can\'t be used, they post here',
    ],
  ];
  return withSections(baseEmbed(colors.brand).setTitle('Sama-tracker'), sections);
}
