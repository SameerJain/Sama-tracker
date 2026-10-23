import { escapeMarkdown } from 'discord.js';
import { startggUrl } from '../startgg.js';
import { isMultiGuild } from '../store.js';
import { HUB } from '../../series/configs.mjs';
import { colors, FOOTER, baseEmbed, shortSchedule, withLines, withSections, playerLink, count } from './shared.js';

// /t-o tournament posts switches a tracked tournament can have off, named for the list.
// a custom reminder schedule shows with it, so TOs can see which tournaments don't use the default
const TOURNAMENT_POSTS = { sets: 'sets off', stream: 'stream alerts off', calls: 'match calls off', top8: 'top 8s off', reminders: 'reg reminders off' };

// tracked players, then tracked tournaments that aren't over. linked is how many people linked their own start.gg without being tracked
export function trackedList(players, linked = 0, tournaments = {}) {
  const all = Object.values(players).sort((a, b) => a.tag.localeCompare(b.tag));
  const embed = baseEmbed(colors.brand).setTitle(`Tracking ${all.length}`);
  // only what differs from a new player, who has set results and stream alerts off. no field means on
  const lines = all.map((player) => {
    const notes = [player.setResults !== false && 'set results on', player.streamAlerts !== false && 'stream alerts on'].filter(Boolean);
    return notes.length ? `${playerLink(player)} · ${notes.join(' · ')}` : playerLink(player);
  });
  if (!all.length) lines.push('Nobody yet. `/track add` tracks you.');
  lines.push('', '-# Their placements get posted here, plus their sets and streams once `/track posts` turns them on. Anyone can track or untrack themselves, and TOs can do it for anyone. Players with no reported sets in 6 months come off the list on their own, and `/t-o cleanup` untracks anyone whose start.gg Discord isn\'t in this server. `/link` your own start.gg instead to use the lookups without being posted');
  if (linked) lines.push(`-# ${count(linked, 'more person', 'more people')} linked, for lookups only`);

  // only what's off, since everything starts on
  const tracked = Object.values(tournaments).filter((tournament) => tournament.tracked && !tournament.resultsPosted)
    .sort((a, b) => (a.startAt ?? Infinity) - (b.startAt ?? Infinity));
  const tournamentLines = tracked.map((tournament) => {
    // match calls start off, so a tournament tracked before they existed reads as off too
    const off = (name) => (name === 'calls' ? tournament.tracked.calls !== true : tournament.tracked[name] === false);
    const notes = Object.entries(TOURNAMENT_POSTS).filter(([name]) => off(name)).map(([, note]) => note);
    if (tournament.tracked.reminders !== false && Array.isArray(tournament.tracked.schedule)) {
      notes.push(`reminders ${shortSchedule(tournament.tracked.schedule)}`);
    }
    const when = tournament.startAt ? ` · <t:${tournament.startAt}:d>` : '';
    return `[${escapeMarkdown(tournament.name)}](${startggUrl(tournament.slug)})${when}${notes.map((note) => ` · ${note}`).join('')}`;
  });
  if (!tracked.length) tournamentLines.push('None yet. A TO can track one with `/t-o tournament add`.');
  tournamentLines.push('', '-# Every set, stream alert and top 8 from these posts in its own thread, plus reg reminders and match calls with `calls:on`. TOs change that with `/t-o tournament posts`');
  return [...withLines(embed, lines), ...withLines(baseEmbed(colors.brand).setTitle(`Tracked tournaments · ${tracked.length}`), tournamentLines)];
}

// /t-o role list. tos are discord ids, shown as mentions, which never ping from a card. role is the role's name in
// the server, null when it hasn't been made yet
export function toList(tos, role) {
  const embed = baseEmbed(colors.brand).setTitle(`TOs · ${tos.length}`);
  const lines = role
    ? (tos.length ? tos.map((id) => `<@${id}>`) : ['Nobody the bot has seen yet.'])
    : ['There\'s no TO role yet, so anyone with Manage Server counts as a TO. `/t-o role add` makes the role, or `/t-o role set` uses one already in the server.'];
  lines.push('', '-# TOs can control automatic messages, track, untrack, change posts and set pings for anyone, take anyone off the Slippi watchlist, and use `/t-o tournament` and `/t-o cleanup`. TOs add and remove each other with `/t-o role add` and `/t-o role remove`');
  if (role) lines.push(`-# Someone handed the ${escapeMarkdown(role)} role in server settings shows up here once they use a command`);
  return embed.setDescription(lines.join('\n'));
}

const SITES = {
  'x.com': 'X', 'twitter.com': 'X', 'twitch.tv': 'Twitch', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
  'instagram.com': 'Instagram', 'tiktok.com': 'TikTok', 'bsky.app': 'Bluesky', 'kick.com': 'Kick',
  'facebook.com': 'Facebook', 'threads.net': 'Threads', 'discord.gg': 'Discord', 'discord.com': 'Discord',
};

// other sites show the whole link. try/catch so one bad saved link can't break /socials
function socialLink(url) {
  let site;
  try {
    site = SITES[new URL(url).hostname.replace(/^(www|m|mobile)\./, '')];
  } catch {
    return String(url);
  }
  return site ? `[${site}](${url})` : url;
}

// /data: the series data pages on Vercel, plus the web hub once it's deployed (HUB.url in series/configs.mjs)
export function dataPages() {
  const lines = [
    ...(HUB.url ? [`**Samatracker** · [Player lookup, recent results and Slippi ranks](${HUB.url})`] : []),
    '**Monday Night SmashBall** · [Data analysis](https://monday-night-smashball.vercel.app)',
    '**UB Smash Royale** · [Data analysis](https://ub-smash-royale.vercel.app)',
    '',
    '-# Every tournament in each series: attendance over time, biggest crowds, winners, most events entered and characters reported on start.gg',
  ];
  return [baseEmbed(colors.brand).setTitle('Data pages').setDescription(lines.join('\n'))];
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
  if (info.deployMessage) lines.push(escapeMarkdown(info.deployMessage));
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
  if (info.startggDownSince) lines.push(`**start.gg:** not answering since <t:${info.startggDownSince}:R>. Commands that need it say so right away until it's back`);
  if (info.downSince) lines.push(`-# Was down from <t:${info.downSince}:f> until it started`);
  if (info.skippedBefore) lines.push(`-# Sets from then until <t:${info.skippedBefore}:f> didn't get posted`);
  lines.push('-# [GitHub](https://github.com/SameerJain/Sama-tracker)');

  return baseEmbed(colors.system).setTitle('Status').setThumbnail(info.avatar).setDescription(lines.join('\n'));
}

// how long the bot was off, in words
function downFor(seconds) {
  if (seconds < 90 * 60) return `about ${count(Math.max(1, Math.round(seconds / 60)), 'minute')}`;
  if (seconds < 48 * 60 * 60) return `about ${count(Math.round(seconds / 3600), 'hour')}`;
  return `about ${count(Math.round(seconds / 86400), 'day')}`;
}

// what people need to know after an outage: when, that their commands never got through, and what catches up.
// outage is { from, to } in unix seconds, catchUpHours how far back missed set results still post
function outageLines({ from, to }, catchUpHours) {
  return [
    `**Down:** <t:${from}:f> to <t:${to}:f>, ${downFor(to - from)}`,
    'Commands sent then got Discord\'s "The application did not respond" and never reached the bot, so send them again.',
    to - from <= catchUpHours * 60 * 60
      ? 'Set results from while it was down are posting now.'
      : `Set results from the last ${count(catchUpHours, 'hour')} are posting now, and older ones are skipped.`,
  ];
}

// a new railway deployment going live, with when it deployed and the commit message. no commit id.
// one that came after an outage says so too, instead of a second card
export function deployUpdate(deploy, outage = null, catchUpHours = 3) {
  const lines = [`**Latest version deployed:** <t:${deploy.at}:R>`];
  if (deploy.message) lines.push(escapeMarkdown(deploy.message));
  if (outage) lines.push('', ...outageLines(outage, catchUpHours));
  return baseEmbed(colors.system).setTitle('Bot updated').setDescription(lines.join('\n'));
}

// the bot starting again after being off long enough that people noticed, with no new version to explain it
export function backOnline(outage, catchUpHours = 3) {
  return baseEmbed(colors.system).setTitle('Back online').setDescription(outageLines(outage, catchUpHours).join('\n'));
}

// a /matchmaking_search ping. a mention in a card never pings, so this one is just a name to click
export function matchmaking({ label, color, discordId, avatar, message }) {
  const lines = [`<@${discordId}> is looking for ${label} games.`];
  if (message) lines.push(`> ${message}`);
  lines.push(`-# \`/matchmaking_role game:${label}\` gets you these pings, or stops them`);
  return baseEmbed(color).setTitle(`${label} matchmaking`).setThumbnail(avatar).setDescription(lines.join('\n'));
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

// the short card /help sends by default. one card, since it fits, with verbose:True for the full list
function shortHelp() {
  const lines = [
    '**Start here**',
    '`/link` tie your Discord to your start.gg, nothing gets posted. Leaving `player` out looks you up',
    '`/track add` post your placements here. TOs can add anyone',
    ...(isMultiGuild() ? ['`/setup channel:#channel` pick where automatic posts go (Manage Server or TOs). Then `/messages` controls what posts'] : []),
    '`/notify` pings for match calls, streams, reg reminders and 1-hour DMs',
    '`/help verbose:True` the full list with the details',
    '',
    '**Look up stats**',
    '`/stats` record and placements · `/recent` latest sets · `/run` current run and next opponent',
    '`/h2h opponent:` record and one-line odds · `/predict opponent:` odds and why',
    '`/scout profile:` form and habits · `/progress` last 30 days vs the 30 before',
    '`/characters` reported characters · `/doubles` 2v2 record · `/upcoming` tournaments',
    '',
    '**TOs**',
    '`/t-o role add user:` hand out the TO role · `/t-o role set role:` use an existing role',
    '`/t-o tournament event tournament:` make a Discord event · `/track posts` results and alerts on or off',
    '-# TOs can control `/messages`, track, untrack, change posts and set pings for anyone. Until the server has a TO role, Manage Server counts as one',
    '',
    '**Tournaments**',
    '`/registered tournament:` who\'s here · `/reg_warn tournament: user:` nudge the unregistered',
    '`/bracket` bracket links · `/stream_link` stream links · `/slippi leaderboard` netplay ranks',
    '`/data` Samatracker and both series data pages',
    '`/messages` automatic posts and threads, for TOs or Manage Server · `/status` uptime and last checks',
    '`/matchmaking_role game:` get game pings · `/matchmaking_search game:` find games · `/matchmaking_channel` where searches go',
    '-# `/socials` saved links · `/profile` start.gg profiles · `/view_pfp` my picture · `/64` `/melee` `/brawl` `/sm4sh` `/ult` `/pplus` `/bills` for fun',
  ];
  return [baseEmbed(colors.brand).setTitle('Sama-tracker').setDescription(lines.join('\n'))];
}

// two of these, top and bottom: '-# Page 99/99\n' is 15, so a card packed to this still fits both
const PAGE_RESERVED = 32;

export function help(verbose = false) {
  if (!verbose) return shortHelp();
  const sections = [
    [
      '**General**',
      '`/help` this list',
      '`/status` uptime, when the latest version was deployed, the last start.gg and Slippi checks, and whether start.gg is down',
      ...(isMultiGuild() ? ['`/setup` show or set the channel automatic posts go in for this server. Anyone can look, Manage Server or TOs change it, and it checks the bot can post there'] : []),
      '`/profile` someone\'s start.gg profile, if the bot has seen their account. `player:` a tracked or linked player, `user:` a server member',
      '`/data` links to Samatracker and both series data pages: every tournament\'s attendance, winners, most events entered and characters',
      '`/socials` saved streams and social links',
      '`/socials_edit` add or remove those links. Manage Server by default',
      '`/messages` automatic posts on or off, threads, event length, set result colors and the recap schedule. TOs or Manage Server',
    ],
    [
      '**Tracking players**',
      '`/track add` track yourself, found by the Discord on your start.gg. TOs can add anyone by start.gg link or ID. Their placements post here',
      '`/track remove` stop tracking yourself, or anyone if you\'re a TO. Asks first, then Undo puts them back with their settings for a minute',
      '`/track list` everyone tracked, and the tracked tournaments',
      '`/track posts` your set results and stream alerts on or off. TOs can change anyone\'s, or everyone\'s with `player:all`, which asks first. Anyone can look',
      '`/t-o cleanup` untrack everyone whose start.gg Discord isn\'t in this server. Asks first. TOs only',
      '`/upcoming` tracked tournaments, and any other with 3 or more of the crew. `player:` checks one person, live from start.gg when linked but not tracked',
      '`/recent` latest sets',
      '`/run` your run and next opponent in each bracket, soonest first, with the station and scheduled time when the TO sets them',
      '-# New players start with set results and stream alerts off. `player:all` works with posts, upcoming and recent. Leaving `player` out means you',
      '-# Players with no reported sets in 6 months come off the track list on their own',
    ],
    [
      '**TOs**',
      '`/t-o role add` give someone the TO role. TOs only',
      '`/t-o role set` use an existing server role for TO privileges. Needs Manage Server',
      '`/t-o role remove` take the TO role off someone. Refuses to remove the last known TO. TOs only',
      '`/t-o role list` who the TOs are',
      '-# TOs can control automatic messages, track, untrack, change posts and set pings for anyone, take anyone off the Slippi watchlist, and use `/t-o tournament` and `/t-o cleanup`. Everyone else only changes their own. Until the server has a TO role, Manage Server counts as one',
    ],
    [
      '**Your pings**',
      '`/notify` your pings, or anyone\'s for a TO with `user:` or `player:`. `calls` covers match calls, `streams` covers stream sets, `registration` covers reg reminders, and `dm_registration` and `dm_start` cover 1-hour DMs. `all` changes all five. `player:all` changes everyone tracked and asks first. Leave them out to see yours',
      '-# Only TOs can see or change someone else\'s with `user:` or `player:`, and only `user:` or `player:`, not both. `calls` and `streams` need whoever it\'s for linked, or tracked with Discord on start.gg. `registration` pings the Reg Reminders role. Registration DMs skip registered players when start.gg has their Discord. DMs only go to current server members',
    ],
    [
      '**Matchmaking**',
      '`/matchmaking_role` get the Ultimate or Melee Matchmaking role with `game:`, or take it off if you have it. `duration:` keeps it for that many hours, like 2 or 0.5 for 30 minutes, then it comes off on its own',
      '`/matchmaking_search` ping that role to find games. `message:` says what you want, like your connect code. `thread:True` starts a thread to arrange them, named like `Melee:Sam (10/21)`. Only people with the role can',
      '`/matchmaking_channel` where a game\'s searches post with `game:` and `channel:`. TOs only to change it, anyone can look. Left out means wherever the command runs. `clear:True` goes back to that',
      '-# Anyone can @ the roles without the commands too. The bot makes each one the first time someone asks for it',
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
      '`/predict_explained` full breakdown of the odds, with shares, model numbers and bars',
      '`/scout` an opponent\'s form, toughest opponents and worst matchups. Needs you tracked or linked, with Discord connected on start.gg',
      '`/progress` last 30 days vs the 30 before, by game',
      '`/characters` reported characters. `game:` Ultimate or Melee, left out it\'s whichever has more',
      '-# `verbose:True` shows more, same as the Full report button on short reports other than `/progress`. `melee:True` sticks to Melee and adds Slippi ranks for players on the watchlist, which all-Melee reports show anyway. Melee cards say Melee at the top, other games show nothing there since Ultimate is the default. Melee `/predict`, `/h2h` and `/scout` odds count them when both players are ranked, even with no Melee sets to go on. `/characters game:Melee` adds Slippi ranked picks. Slippi ranked is singles, so `/doubles` leaves it out',
      '-# `since:2026-01-01` counts only sets since that date, and `venue:` only offline or online tournaments, on `/stats`, `/h2h`, `/scout` and `/predict`. Full report buttons keep them',
      '-# `/h2h`, `/predict` and `/scout` also take a start.gg link or ID, for players nobody tracks',
      '-# Your commands take start.gg turns one at a time. One sent while another loads says Queued and starts after it, up to 3 waiting. When start.gg is backed up for everyone, new commands ask you to try again in a minute. A public report done over a minute after you asked comes in a new message that pings you',
      '-# No typing: long-press someone, then Apps, then **H2H with me** or **Scout them**. `/run`, match calls and stream alerts have head-to-head buttons for the set coming up, which run the short report and come off when it ends',
      '-# Player lists start with whoever you picked last, and a name matches with any spacing, case or punctuation. A name that matches nobody gets the closest one suggested',
      '-# An event named for Melee but tagged on start.gg as Ultimate counts as Melee, and the other way around',
    ],
    [
      '**Slippi ranked**',
      '`/slippi add` add your connect code to the watchlist, or leave it out to find yours on your start.gg. TOs can add anyone\'s',
      '`/slippi remove` take yourself off the watchlist, or anyone if you\'re a TO',
      '`/slippi rank` rank, rating, record, characters and past seasons. Takes any connect code',
      '`/slippi leaderboard` everyone on the watchlist, best rank first',
      '-# Cards show the rank badge and their most played character. Tracked players get added on their own once their code turns up in a start.gg netplay registration. Ranks come from slippi.gg, which has no public API, so this can break if Slippi changes it',
    ],
    [
      '**Tournaments**',
      '`/t-o tournament add` track a tournament: every set, stream alerts and top 8s in its thread, plus reg reminders. `schedule:` sets custom reminder times, `add_event:on` also makes a Discord event',
      '`/t-o tournament remove` stop tracking one. Asks first, then Undo puts it back for a minute',
      '`/t-o tournament posts` a tracked tournament\'s sets, stream alerts, match calls, top 8s and reg reminders on or off. `schedule:` changes the reminder times, `default` goes back to the usual four',
      '`/registered` who here is registered, by name so nobody gets pinged. `by_event:True` groups it by event',
      '`/reg_warn` warn someone who isn\'t registered yet. If they are, it just says so. Once per person per tournament in 12 hours',
      '`/bracket` bracket links for tracked tournaments, 30 min before the start to 6 hours after the end',
      '`/stream_link` stream links for tournaments that are tracked or have tracked players, live or starting within 30 min',
      '`/t-o tournament event` make a Discord event from a start.gg link, without tracking it. Its streams go in the description',
      '-# `/t-o tournament` is TOs only. `tournament:` takes a link or one the bot knows. Discord events follow start.gg\'s time, end time, cover photo, place and streams, checked hourly, and get cancelled if the tournament is deleted there. Cards and DMs show the venue\'s address when the TO put it on start.gg, linked to a map',
    ],
    [
      '**Fun**',
      '`/64` a 64 old head who says 64 did it first',
      '`/melee` a Melee purist with a take',
      '`/brawl` the last person still defending Brawl',
      '`/sm4sh` a love letter to Smash 4',
      '`/ult` an Ultimate player who hates Ultimate',
      '`/pplus` a Project+ player who wants you on netplay',
      '`/bills` Live pro-Bills photos and official Bills GIFs. Never sends the same image twice in a row',
      '`/view_pfp` my profile picture, full size',
      '-# `/messages bills:True` posts Bills final scores here after each game, green for a win and red for a loss',
    ],
    [
      '**Posted here automatically**',
      '**Set results.** Every finished set at a tracked tournament, and anywhere else the sets of tracked players with set results on, plus a tracked player\'s first DQ in an event. For an hour after, a winner or score the TO fixes gets edited in, and a reset set gets marked. `/messages set_colors` colors them green for a win, red for a loss, gold for crew vs crew and blue when nobody tracked played',
      '**Stream alerts.** Sets on stream or up next in the stream queue for 30 seconds, at tracked tournaments and for tracked players with stream alerts on, pinging whoever is playing with `/notify streams` on',
      '**Match call pings.** Called sets, pinging whoever has `/notify calls` on with You\'re up and the station when start.gg has one, all four in one message for doubles. A tracked tournament with `calls:on` posts every called set even with nobody to ping. A call the TO takes back gets crossed out, and calling it again pings again',
      '**Tournament roll calls.** An hour before a tournament with 3+ of the crew, with the streams from its start.gg page. At a tracked tournament that counts tracked players and anyone registered whose start.gg Discord is in this server',
      '**Tournament placements.** Where the crew placed, with the top 8 when every event finishes at a tracked tournament, even if top 8 posts are off. Otherwise 12 hours after it ends. Projected placements get edited once start.gg has them final',
      '**Top 8s.** The full top 8 of each event at a tracked tournament, as soon as the bracket is finished',
      '**Registration reminders.** Tracked tournaments 7 days, 3 days and a day out, then a last call 6 hours before, pinging the Reg Reminders role, unless a TO sets custom times with `schedule:`. `dm_registration` DMs you 1 hour before registration closes, skipped once you\'re registered, and `dm_start` DMs you 1 hour before the start, both only while you\'re in this server. When registration closes within an hour of the start there\'s one DM, the start one',
      '**Discord events.** Each upcoming tracked tournament gets a Discord event with start.gg\'s cover photo and streams in the description, once. Off unless `/messages events` turns it on',
      '**Slippi rank changes.** Watchlist changes, checked every 30 minutes. Tracked players can be discovered from connect codes entered on start.gg. When a season ends, a wrap-up with the final ranks, biggest climbers and most played characters',
      '**Bills final results.** The final score with the other team\'s logo, green for a win and red for a loss, checked daily and every 15 minutes on game day. Off unless `/messages bills` turns it on',
      '**Weekly crew recap.** Tracked players with a non-DQ singles set that week. Sunday 9 pm ET unless `/messages` changes it',
      '**Bot updates.** A new version going live on Railway, with when it deployed and the commit message',
      '**Back online.** After the bot was off 10 minutes or more, for how long and that commands sent then need sending again. While start.gg is down, commands say so right away and the bot\'s status shows it',
      '-# Tracked tournaments post their set results and stream alerts in a thread. `/messages threads` picks off, one thread per tournament or one per event for everything, and one per event applies to tracked tournaments too. Each thread pins its channel card until the tournament or event ends. If a thread can\'t be used, they post here',
    ],
  ];
  // the same page number goes on top and bottom of every card, with room left so none passes 4096
  const cards = withSections(baseEmbed(colors.brand).setTitle('Sama-tracker'), sections, 4096 - PAGE_RESERVED);
  return cards.map((card, i) => {
    const page = `-# Page ${i + 1}/${cards.length}`;
    return card.setDescription(`${page}\n${card.data.description}\n${page}`);
  });
}
