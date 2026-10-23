import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';

// every command once against a fake start.gg, so a handler that throws shows up here
const directory = mkdtempSync(join(tmpdir(), 'sama-commands-'));
process.env.STATE_DIR = directory;
// multi-server on here so /setup is covered too. the fakes carry no guildId,
// so every command still runs on the root exactly like single-server mode
process.env.MULTI_GUILD = 'true';
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleButton, handleCommand } = await import('../src/commands/index.js');
const { buttonRow, fullReport } = await import('../src/commands/shared.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const slippi = await import('../src/slippi.js');
slippi.setRequestGap(0);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
const event = {
  name: 'Ultimate Singles', slug: 'tournament/local/event/singles', startAt: now - 3600, numEntrants: 32,
  videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'Local', slug: 'tournament/local', isOnline: false, images: [] },
};
// crew (player 10, entrant 1) against rival (player 20, entrant 2)
const setNode = (id, completedAt, setState = 3) => ({
  id, state: setState, completedAt, updatedAt: completedAt ?? now, fullRoundText: 'Winners Final',
  winnerId: setState === 3 ? 1 : null, stream: null, event,
  slots: [[1, 10, 'Crew'], [2, 20, 'Rival']].map(([entrantId, playerId, name], i) => ({
    entrant: { id: entrantId, name, initialSeedNum: i + 1, participants: [{ player: { id: playerId } }] },
    standing: { stats: { score: { value: setState === 3 ? 2 - i : null } } },
  })),
  games: [{ winnerId: 1, selections: [{ entrant: { id: 1 }, character: { name: 'Fox' } }, { entrant: { id: 2 }, character: { name: 'Falco' } }] }],
});
const sets = [setNode('s1', now - 600), setNode('s2', now - 7200)];
// crew and partner (players 10 and 11, entrant 3) against rival and ally (players 20 and 21, entrant 4)
const doublesEvent = { ...event, id: 60, name: 'Ultimate Doubles', slug: 'tournament/local/event/doubles' };
const doublesNode = (id, completedAt) => ({
  id, completedAt, fullRoundText: 'Winners Final', winnerId: 3, event: doublesEvent,
  slots: [[3, [[10, 'Crew'], [11, 'Partner']], 'Crew / Partner'], [4, [[20, 'Rival'], [21, 'Ally']], 'Rival / Ally']].map(([entrantId, players, name], i) => ({
    entrant: { id: entrantId, name, initialSeedNum: i + 1, participants: players.map(([playerId, gamerTag]) => ({ player: { id: playerId, gamerTag } })) },
    standing: { stats: { score: { value: 2 - i } } },
  })),
});
// crew's slippi account. any other code or id has nobody
const slippiUser = {
  fbUid: 'crew-uid', displayName: 'Crew', connectCode: { code: 'CREW#1' },
  rankedNetplayProfile: {
    id: 'RANKED_SINGLES-crew-uid-season-5', ratingOrdinal: 1600, ratingUpdateCount: 20, wins: 12, losses: 8,
    dailyGlobalPlacement: null, dailyRegionalPlacement: null, continent: 'NORTH_AMERICA', characters: [{ character: 'FOX', gameCount: 30 }],
  },
  rankedNetplayProfileHistory: [{ ratingOrdinal: 1500, wins: 30, losses: 20, season: { name: 'Season 4', status: 'COMPLETED', endedAt: '2026-04-20T17:07:46.817Z' } }],
};
const live = { id: 5, name: 'Local', slug: 'tournament/local', startAt: now - 3600, endAt: now + 3600, city: 'Buffalo', addrState: 'NY', isOnline: false, images: [] };
const soon = { ...live, id: 6, name: 'Soon', slug: 'tournament/soon', startAt: now + 86400, endAt: now + 90000 };

function respond(query, variables) {
  const aliases = [...query.matchAll(/\b([pu])(\d+): /g)].map(([, kind, id]) => `${kind}${id}`);
  const each = (value) => Object.fromEntries(aliases.map((alias) => [alias, value]));
  if (query.includes('currentUser')) return { currentUser: { id: 1 } };
  // /stream_link: the streams on each tournament's page. registration lookups carry streams too now
  if (query.includes('streams { streamName') && !query.includes('registrationClosesAt')) return Object.fromEntries([...query.matchAll(/\bt(\d+): tournament/g)].map(([, id]) => [`t${id}`, { streams: [{ streamName: 'localstream', streamSource: 'TWITCH' }] }]));
  // /doubles: 2v2 sets, then the events they were in with crew's team
  if (query.includes('entrantSize: [2]')) return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: [doublesNode('d1', now - 900), doublesNode('d2', now - 8000)] } } };
  if (/\be\d+: event\(id: \d+\)/.test(query) && query.includes('userEntrant')) {
    const participants = [{ player: { id: 10, gamerTag: 'Crew' } }, { player: { id: 11, gamerTag: 'Partner' } }];
    return Object.fromEntries([...query.matchAll(/\be(\d+): event/g)].map(([, id]) => [`e${id}`, {
      ...doublesEvent, state: 'COMPLETED', userEntrant: { initialSeedNum: 3, isDisqualified: false, standing: { placement: 1 }, participants },
    }]));
  }
  if (query.includes('user(slug:')) {
    // the matchup commands pair() something typed that isn't tracked or linked, so one slug resolves to nobody
    if (variables.slug?.includes('nobody')) return { user: null };
    return { user: { id: 3, slug: 'user/opponent', images: [], player: { id: 30, gamerTag: 'Opponent' }, authorizations: [{ externalId: 'opponent-discord' }] } };
  }
  if (query.includes('registrationClosesAt')) {
    const tournament = variables.slug === 'soon' ? soon : live;
    return { tournament: { ...tournament, registrationClosesAt: tournament.startAt - 1800, isRegistrationOpen: true, numAttendees: 2, events: [{ name: event.name, slug: event.slug }] } };
  }
  if (query.includes('participants(')) {
    return { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [{ gamerTag: 'Crew', user: { id: 1, authorizations: [{ externalId: 'crew-discord' }] } }] } } };
  }
  if (query.includes('streamQueue')) return { tournament: { streamQueue: [] } };
  if (query.includes('recentStandings')) {
    return { player: { recentStandings: [{ placement: 2, isFinal: true, entrant: { initialSeedNum: 4, isDisqualified: false, event: { ...event, tournament: event.tournament } } }], sets: { nodes: sets } } };
  }
  if (query.includes('events(query:')) {
    return { user: { events: { pageInfo: { totalPages: 1 }, nodes: [{ ...event, state: 'COMPLETED', userEntrant: { initialSeedNum: 4, isDisqualified: false, standing: { placement: 2 } } }] } } };
  }
  if (query.includes('videogame(id:')) return { videogame: { characters: [{ name: 'Fox', images: [{ url: 'https://images.example/fox.png' }] }] } };
  if (query.includes('event(id:')) return { event: { sets: { pageInfo: { totalPages: 1 }, nodes: [setNode('r1', now - 900), setNode('r2', null, 6)] } } };
  if (query.includes('tournament(id: $id)')) {
    const entrant = { id: 9, isDisqualified: false, standing: { placement: 3, isFinal: false } };
    const tournament = String(variables.id) === String(soon.id) ? soon : live;
    return { tournament: { ...tournament, events: [{ id: 50, name: event.name, slug: event.slug, state: 'ACTIVE', numEntrants: 32, ...each(entrant) }] } };
  }
  if (query.includes('tournamentView')) return each({ tournaments: { nodes: [] } });
  if (query.includes('tournaments(query:')) return each({ tournaments: { nodes: [live] } });
  // a button about someone only known from a set. 31 played without a start.gg account
  if (query.includes('player(id: $id)') && query.includes('user { id slug')) {
    return { player: { id: variables.id, gamerTag: 'Opponent', user: variables.id === '31' ? null : { id: 3, slug: 'user/opponent', images: [], authorizations: [] } } };
  }
  if (query.includes('authorizations')) return each({ slug: 'user/crew', images: [], player: { gamerTag: 'Crew' }, authorizations: [{ externalId: 'crew-discord' }] });
  // the connect code on crew's netplay registrations
  if (query.includes('isEventOnline')) {
    return each({ sets: { nodes: [{ slots: [{ entrant: { participants: [{ player: { id: 10 }, connectedAccounts: { slippi: { value: 'crew#1' } } }] } }] }] } });
  }
  if (aliases.length) return each({ sets: { nodes: sets } });
  if (query.includes('player(id: $id)')) return { player: { sets: { pageInfo: { totalPages: 1 }, nodes: sets } } };
  throw new Error(`no fake for ${query.slice(0, 80)}`);
}

// the command a request came from. background checks a command kicked off still count as that
// command, but by then it has answered
const runningCommand = new AsyncLocalStorage();
// discord gives up on a command that doesn't answer or defer within 3 seconds, and start.gg
// requests wait their turn 800ms apart, so nothing should go out before that
function beforeAnswer(run, what) {
  if (run && !run.replied && !run.deferred) run.waitedOn.push(what);
}

let lastFetch = Date.now();
globalThis.fetch = async (url, options) => {
  beforeAnswer(runningCommand.getStore(), 'start.gg');
  lastFetch = Date.now();
  if (String(url).includes('commons.wikimedia.org')) return {
    ok: true,
    json: async () => ({ query: { pages: [{
      title: 'File:Bills Mafia.jpg',
      imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://images.example/bills.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Bills_Mafia.jpg' }],
    }] } }),
  };
  if (String(url).includes('internal.slippi.gg')) {
    const { variables } = JSON.parse(options.body);
    const data = Object.fromEntries(Object.entries(variables).map(([name, value]) => [name.replace('v', 'u'), ['CREW#1', 'crew-uid'].includes(value) ? slippiUser : null]));
    return { ok: true, json: async () => ({ data }) };
  }
  // character art
  if (!String(url).includes('api.start.gg')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  const { query, variables } = JSON.parse(options.body);
  return { ok: true, json: async () => ({ data: respond(query, variables) }) };
};

// target is the member an Apps menu command was used on
function interaction(commandName, { group = null, subcommand = null, values = {}, user = 'crew-discord', target = null } = {}) {
  const calls = [];
  const discord = (what, result) => async () => { beforeAnswer(run, what); return result; };
  const run = {
    commandName, calls, waitedOn: [],
    user: { id: user, bot: false, displayName: 'Crew' },
    targetUser: target, targetMember: target && { displayName: target.displayName },
    channelId: 'channel-1',
    guild: {
      id: 'guild-1',
      members: { fetch: async ({ user: ids }) => { beforeAnswer(run, 'discord members'); return new Map(ids.map((id) => [id, {}])); } },
      roles: { cache: { get: () => undefined, find: () => undefined }, create: discord('discord role create', { id: 'role-1', mentionable: true }) },
      channels: {
        fetch: async (id) => {
          beforeAnswer(run, 'discord channels');
          return { id, isTextBased: () => true, permissionsFor: () => ({ has: () => true }) };
        },
      },
      scheduledEvents: {
        fetch: async () => { beforeAnswer(run, 'discord events'); return new Map(); },
        create: async (options) => { beforeAnswer(run, 'discord events'); return { id: 'event-1', url: 'https://discord.com/events/guild-1/event-1', ...options }; },
      },
    },
    member: { displayName: 'Crew', displayAvatarURL: () => 'https://cdn.example/crew.png', roles: { cache: { has: () => false }, add: discord('discord role add'), remove: discord('discord role remove') } },
    memberPermissions: { has: () => true },
    client: { user: { displayAvatarURL: () => 'https://cdn.example/avatar.png' } },
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => subcommand,
      getString: (name) => values[name] ?? null,
      getBoolean: (name) => values[name] ?? null,
      getInteger: (name) => values[name] ?? null,
      getNumber: (name) => values[name] ?? null,
      getChannel: (name) => values[name] ?? null,
      getRole: (name) => values[name] ?? null,
      getUser: () => values.user ?? null,
      getMember: () => (values.user ? {
        displayName: values.user.displayName, displayAvatarURL: () => 'https://cdn.example/member.png',
        roles: { cache: { has: () => false }, add: discord('discord role add'), remove: discord('discord role remove') },
      } : null),
    },
    reply: async (result) => { calls.push(['reply', result]); run.replied = true; },
    deferReply: async () => { calls.push(['defer']); run.deferred = true; },
    editReply: async (result) => calls.push(['edit', result]),
    deleteReply: async () => calls.push(['delete']),
    fetchReply: async () => ({ startThread: async () => ({}) }),
    followUp: async (result) => calls.push(['followUp', result]),
    channel: { send: async (result) => { calls.push(['send', result]); return {}; } },
  };
  return run;
}

// [command, options, what the answer should have in it]. players left out mean whoever ran it, which is Crew
const runs = [
  ['help', {}, /\/help verbose:True/], ['help', { values: { verbose: true } }, /Linking yourself/],
  ['status', {}, /Status/], ['setup', {}, /No posts channel set yet/],
  ['setup', { values: { channel: { id: 'channel-9', isTextBased: () => true } } }, /Automatic posts go in <#channel-9>/],
  ['messages', {}, /Set results:\*\* off/],
  ['messages', { values: { events: true } }, /Discord events for tracked tournaments:\*\* on/],
  ['messages', { values: { events: false } }, /Discord events for tracked tournaments:\*\* off/], ['socials', {}, /Nothing yet/],
  ['data', {}, /Monday Night SmashBall.*monday-night-smashball\.vercel\.app.*UB Smash Royale.*ub-smash-royale\.vercel\.app/],
  ['socials_edit', { subcommand: 'add', values: { name: '716 Esports', link: 'twitch.tv/716esports' } }, /Added https:\/\/twitch\.tv\/716esports under 716 Esports/],
  ['socials_edit', { subcommand: 'remove', values: { link: 'https://twitch.tv/716esports' } }, /Removed/],
  ['track', { subcommand: 'add', values: { profile: 'start.gg/user/opponent' } }, /Now tracking \[Opponent\].*Set results and stream alerts start off/],
  ['track', { subcommand: 'list' }, /Tracking 3.*Tracked tournaments · 0/],
  // press answers the Are you sure the command asked
  ['track', { subcommand: 'remove', values: { player: '3' }, press: 'Stop tracking' }, /Stop tracking Opponent\?.*"update",\{"content":"Stopped tracking Opponent\.".*"label":"Undo"/],
  ['link', { values: { profile: 'start.gg/user/opponent' }, user: 'opponent-discord' }, /Linked to Opponent/],
  // left out, it searches the accounts the bot has seen, and nobody has this discord
  ['link', { user: 'stranger-discord' }, /Couldn't find a start\.gg with this Discord connected/],
  ['unlink', { user: 'opponent-discord' }, /Unlinked from Opponent.*"label":"Undo"/],
  ['profile', {}, /"title":"Crew","url":"https:\/\/www\.start\.gg\/user\/crew"/],
  ['profile', { values: { player: '2' } }, /"title":"Rival","url":"https:\/\/www\.start\.gg\/user\/rival"/],
  ['profile', { values: { user: { id: 'stranger', bot: false, displayName: 'Stranger' } } }, /Couldn't find a start\.gg with Stranger's Discord connected/],
  ['upcoming', {}, /Crew has no upcoming tournament with 3 or more/], ['upcoming', { values: { player: 'all' } }, /No upcoming tournament has 3 or more/],
  ['recent', {}, /W · Crew 2-1 Rival/], ['recent', { values: { player: 'all' } }, /Crew 2-1 Rival/],
  ['run', {}, /Crew's run/], ['progress', {}, /Crew's progress/], ['progress', { values: { verbose: true } }, /Every 30 days, newest first/],
  // crew is on the slippi watchlist, rival and opponent aren't, so only crew shows up
  ['progress', { values: { melee: true } }, /No Melee singles results in the last 60 days.*Slippi ranked.*CREW#1.*Gold 2\*\* · 1600\.0 · 12-8 this season.*Since Season 4:\*\* 1500\.0 to 1600\.0 \(\+100\.0\)/],
  ['progress', { values: { verbose: true, melee: true } }, /No Melee singles results in the last 180 days/],
  ['scout', { values: { profile: 'start.gg/user/opponent' } }, /Scouting Opponent/],
  ['scout', { values: { profile: '2' } }, /Scouting Rival/],
  ['scout', { values: { profile: 'start.gg/user/opponent', verbose: true } }, /Crew vs Opponent/],
  ['scout', { values: { profile: 'start.gg/user/opponent', melee: true } }, /No recent Melee singles sets\..*"name":"Slippi ranked","value":"\*\*Crew\*\*: \[CREW#1\][^"\\]*\\n-# Netplay ranked/],
  ['scout', { values: { profile: 'start.gg/user/opponent', verbose: true, melee: true } }, /No Melee sets or events on start\.gg yet\./],
  // the fake tournaments are all offline, so online leaves rival with no recent sets
  ['scout', { values: { profile: '2', venue: 'online' } }, /No recent singles sets\./],
  ['scout', { values: { profile: '2', since: '2026-01-01', venue: 'offline' } }, /Scouting Rival.*Offline only/],
  ['h2h', { values: { opponent: '2' } }, /Crew 2-0 Rival.*Predicted.*Ultimate/], ['h2h', { values: { opponent: '2', verbose: true } }, /Predicted.*Ultimate.*First played/],
  // the fake sets are all ultimate
  ['h2h', { values: { opponent: '2', melee: true } }, /in Melee singles on start\.gg yet\..*2 sets in other games left out.*Slippi ranked.*\*\*Crew\*\*: \[CREW#1\]/],
  // ultimate, so no slippi
  ['h2h', { values: { opponent: '2' } }, /^(?!.*Slippi ranked)/],
  ['h2h', { values: { opponent: '2', verbose: true, melee: true } }, /haven't played each other in Melee singles on start\.gg yet/],
  // the fake sets are recent and offline, so both filters keep the 2-0 record and name themselves
  ['h2h', { values: { opponent: '2', since: '2026-01-01', venue: 'offline' } }, /Crew 2-0 Rival.*Offline only/],
  ['h2h', { values: { opponent: '2', since: 'someday' } }, /Couldn't read `someday` as a date/],
  // either player can be a start.gg link or ID instead of a tracked or linked pick
  ['h2h', { values: { opponent: 'start.gg/user/opponent' } }, /Crew vs Opponent.*haven't played each other in singles on start\.gg yet/],
  ['h2h', { values: { player: 'start.gg/user/opponent', opponent: '2' } }, /Opponent vs Rival.*haven't played each other in singles on start\.gg yet/],
  ['h2h', { values: { opponent: 'start.gg/user/nobody' } }, /Couldn't find a start\.gg player for `start\.gg\/user\/nobody`/],
  // long-press a member, then Apps. rival has this discord connected on start.gg
  ['H2H with me', { target: { id: 'rival-discord', bot: false, displayName: 'Rival' } }, /Crew 2-0 Rival.*Predicted/],
  ['Scout them', { target: { id: 'rival-discord', bot: false, displayName: 'Rival' } }, /Scouting Rival/],
  ['H2H with me', { target: { id: 'stranger-discord', bot: false, displayName: 'Stranger' } }, /Couldn't find a start\.gg with Stranger's Discord connected/],
  ['Scout them', { target: { id: 'crew-discord', bot: false, displayName: 'Crew' } }, /Pick someone else/],
  ['H2H with me', { target: { id: 'a-bot', bot: true, displayName: 'Bot' } }, /Bots don't have start\.gg accounts/],
  ['stats', {}, /Recent sets/], ['stats', { values: { verbose: true } }, /Lifetime stats/],
  // a netplay player can have a rank with nothing on start.gg
  ['stats', { values: { melee: true } }, /No Melee sets or events on start\.gg yet\..*Slippi ranked.*CREW#1.*Gold 2.*Characters:\*\* Fox 30 games/],
  ['stats', { values: { verbose: true, melee: true } }, /No Melee sets or events on start\.gg yet\..*Slippi ranked/],
  ['stats', { values: { since: '2026-01-01', venue: 'offline' } }, /Recent sets.*Offline only/],
  ['stats', { values: { venue: 'online' } }, /Nothing on start\.gg yet matching those filters/],
  ['doubles', {}, /Doubles stats.*Ultimate 2-0 \(100%\).*Best finish:\*\* 🥇 \*\*1st\*\* of 32.*with \*\*Partner\*\*.*### Partners\\n\*\*Partner\*\* · 2-0 \(100%\) · 1 event.*From their last 2 doubles sets and 1 event/],
  ['doubles', { values: { verbose: true } }, /Full doubles stats.*"name":"Partners","value":"1".*best 1st of 32.*Most played teams","value":"\*\*Rival \/ Ally\*\* 2-0/],
  // the fake doubles sets are all ultimate, and slippi ranked is singles, so no slippi either
  ['doubles', { values: { melee: true } }, /^(?!.*Slippi ranked).*No Melee doubles sets on start\.gg yet\./],
  ['characters', {}, /Fox/], ['characters', { values: { verbose: true } }, /Fox/],
  ['characters', { values: { game: 1 } }, /Slippi ranked.*Fox\*\* · 30 games.*CREW#1/],
  ['predict', { values: { opponent: '2' } }, /Crew \d+% · \d+% Rival/], ['predict', { values: { opponent: '2', verbose: true } }, /^(?!.*Slippi ranked).*How it adds up/],
  ['predict', { values: { opponent: '2', melee: true } }, /Neither Crew nor Rival has played Melee singles on start\.gg\..*Leave out `melee` for Ultimate odds.*"name":"Slippi ranked","value":"\*\*Crew\*\*: \[CREW#1\][^"\\]*\\n-# Netplay ranked/],
  ['predict', { values: { opponent: '2', verbose: true, melee: true } }, /Neither Crew nor Rival has played Melee singles/],
  ['predict', { values: { opponent: '2', verbose: true, since: '2026-01-01', venue: 'offline' } }, /How it adds up.*Offline only/],
  ['predict', { values: { opponent: 'start.gg/user/opponent' } }, /Crew and Opponent haven't played singles in the same game/],
  ['predict_explained', { values: { opponent: '2' } }, /^(?!.*Slippi ranked).*Crew \d+% · \d+% Rival.*How it adds up.*How sure it is/],
  ['predict_explained', { values: { opponent: '2', melee: true } }, /Neither Crew nor Rival has played Melee singles/],
  ['predict_explained', { values: { opponent: '2', since: '2026-01-01', venue: 'offline' } }, /give or take.*Offline only/],
  ['predict_explained', { values: { opponent: 'start.gg/user/opponent' } }, /Crew and Opponent haven't played singles in the same game/],
  ['predict_explained', { values: { opponent: '2', since: 'someday' } }, /Couldn't read `someday` as a date/],
  ['predict_explained', { values: { opponent: 'start.gg/user/nobody' } }, /Couldn't find a start\.gg player for `start\.gg\/user\/nobody`/],
  // crew has no set results field, which counts as on
  ['track', { subcommand: 'posts', values: { player: '1' } }, /Crew: set results on, stream alerts on\./],
  ['track', { subcommand: 'posts', values: { player: 'all', stream: 'off' } }, /Stream alerts off for everyone\./],
  ['track', { subcommand: 'posts', values: { player: 'all', sets: 'off' }, press: 'Turn off' }, /Turn set results off for all 2 tracked players\?.*"update",\{"content":"Set results off for everyone\."/],
  // everyone tracked has their discord in the fake server
  ['t-o', { subcommand: 'cleanup' }, /Everyone tracked has their start\.gg Discord in this server/],
  ['notify', {}, /Your pings.*Match calls:\*\* off.*Registration DMs:\*\* off.*Start DMs:\*\* off/],
  ['notify', { values: { calls: 'on' } }, /pinged when your match is called.*Match calls are off for the whole server/],
  ['notify', { values: { all: 'on' } }, /pinged when your match is called.*pinged when your set is on stream.*Reg Reminders role and its pings.*DM 1 hour before registration closes.*DM 1 hour before the tournament starts/],
  ['notify', { values: { dm_registration: 'on', dm_start: 'on' } }, /DM 1 hour before registration closes.*DM 1 hour before the tournament starts/],
  ['matchmaking_role', { values: { game: 'melee' } }, /You have the \*\*Melee Matchmaking\*\* role now/],
  ['matchmaking_role', { values: { game: 'melee', duration: 0.5 } }, /for 30 minutes.*comes off on its own/],
  ['matchmaking_search', { values: { game: 'ult' } }, /You need the \*\*Ultimate Matchmaking\*\* role to ping it\. `\/matchmaking_role game:Ultimate`/],
  ['matchmaking_channel', { values: { game: 'melee' } }, /searches post wherever the command runs/],
  ['matchmaking_channel', { values: { game: 'melee', channel: { id: 'lfg-1' } } }, /searches will post in <#lfg-1>/],
  ['matchmaking_channel', { values: { game: 'melee' } }, /searches post in <#lfg-1>/],
  ['slippi', { subcommand: 'leaderboard' }, /Slippi leaderboard · 1","thumbnail":\{"url":"attachment:\/\/rank-gold-2\.png"\}/],
  // left out, it's the code on crew's start.gg netplay registrations
  ['slippi', { subcommand: 'add' }, /Crew is already on the Slippi watchlist.*Crew · CREW#1.*Gold 2/],
  ['slippi', { subcommand: 'add', values: { code: 'not a code' } }, /isn't a connect code/],
  ['slippi', { subcommand: 'rank' }, /"thumbnail":\{"url":"attachment:\/\/rank-gold-2\.png"\}.*"author":\{"name":"Fox","icon_url":"attachment:\/\/character-1\.png"\}.*Crew · CREW#1.*Gold 2\*\* · 1600\.0.*Fox 30 games.*start\.gg:.*Crew.*Past seasons.*Season 4 · 1500\.0 · 30-20/],
  ['slippi', { subcommand: 'rank', values: { player: 'gone-1' } }, /Slippi has nobody with the code GONE#1/],
  ['slippi', { subcommand: 'leaderboard' }, /Slippi leaderboard · 1.*Crew.*Gold 2\*\* · 1600\.0 · 12-8 · Fox/],
  ['slippi', { subcommand: 'remove', values: { player: 'crew-uid' } }, /Took Crew \(CREW#1\) off the Slippi watchlist/],
  ['slippi', { subcommand: 'leaderboard' }, /"thumbnail":\{"url":"attachment:\/\/slippi\.png"\}.*Nobody on the watchlist yet.*"files":\[\{"attachment":"[^"]+slippi\.png","name":"slippi\.png"\}\]/],
  ['slippi', { subcommand: 'add', values: { code: 'crew-1' } }, /Added Crew to the Slippi watchlist/],
  ['t-o', { group: 'tournament', subcommand: 'add', values: { tournament: 'start.gg/tournament/soon' } }, /Tracking Soon\..*gets pinged 6 hours before registration ends/],
  ['t-o', { group: 'tournament', subcommand: 'posts', values: { tournament: 'tournament/soon' } }, /Soon.*Every set:\*\* on/],
  ['t-o', { group: 'tournament', subcommand: 'posts', values: { tournament: 'tournament/soon', top8: 'off' } }, /Top 8s:\*\* off/],
  ['t-o', { group: 'tournament', subcommand: 'posts', values: { tournament: 'tournament/soon', calls: 'on' } }, /Match calls:\*\* on/],
  ['t-o', { group: 'tournament', subcommand: 'posts', values: { tournament: 'tournament/soon' } }, /Match calls:\*\* on/],
  ['t-o', { group: 'tournament', subcommand: 'posts', values: { tournament: 'tournament/soon', schedule: '2d,6h' } }, /Reg reminders:\*\* on \(2d, 6h\).*Reg reminders go out 2 days and 6 hours/],
  ['t-o', { group: 'tournament', subcommand: 'posts', values: { tournament: 'tournament/soon', schedule: 'soon' } }, /Couldn't read `soon` as a reminder time/],
  ['t-o', { group: 'tournament', subcommand: 'event', values: { tournament: 'start.gg/tournament/soon' } }, /"content":"Made a Discord event for Soon/],
  ['t-o', { group: 'tournament', subcommand: 'add', values: { tournament: 'start.gg/tournament/soon', add_event: 'on' } }, /Already tracking Soon.*Made a Discord event for Soon/],
  ['track', { subcommand: 'list' }, /Tracked tournaments · 1.*Soon.*top 8s off/],
  ['bracket', {}, /No tracked tournaments going on right now/],
  ['t-o', { group: 'tournament', subcommand: 'remove', values: { tournament: 'soon' }, press: 'Stop tracking' }, /Stop tracking Soon\?.*"update",\{"content":"Stopped tracking Soon\."/],
  // no TO role yet, so Manage Server counts as one, and /t-o role add makes the role
  ['t-o', { group: 'role', subcommand: 'list' }, /There's no TO role yet/],
  ['t-o', { group: 'role', subcommand: 'set', values: { role: { id: 'role-existing', name: 'TO Buffalo' } } }, /TO Buffalo is the TO role now/],
  ['t-o', { group: 'role', subcommand: 'add', values: { user: { id: 'someone', bot: false, displayName: 'Someone' } } }, /Someone is a TO now/],
  ['t-o', { group: 'role', subcommand: 'remove', values: { user: { id: 'someone', bot: false, displayName: 'Someone' } } }, /Someone isn't a TO/],
  ['stream_link', {}, /twitch\.tv\/localstream/],
  ['registered', { values: { tournament: 'start.gg/tournament/soon' } }, /Registered from this server · 1/],
  ['reg_warn', { values: { tournament: 'start.gg/tournament/soon', user: { id: 'someone', bot: false, displayName: 'Someone' } } }, /"content":"<@someone>"/],
  ['sm4sh'], ['melee'], ['ult'], ['64'], ['brawl'], ['pplus'], ['bills', {}, /Wikimedia Commons|Imgflip|GIPHY/], ['view_pfp', {}, /pfp\.png/],
];

test('every command and subcommand answers without throwing', async () => {
  state.players = {
    1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', discordId: 'crew-discord', lastCheck: now, streamAlerts: true },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', discordId: 'rival-discord', lastCheck: now, streamAlerts: true },
  };
  state.tournaments = { 5: { ...live, entries: [{ userId: 1, event: event.name, eventSlug: event.slug, eventId: 50, started: true }], userIds: [1] } };
  state.links = {};
  state.socials = [];
  state.slippi = {
    'crew-uid': {
      uid: 'crew-uid', code: 'CREW#1', name: 'Crew', userId: 1, rank: 'Gold 2', rating: 1600, updates: 20, wins: 12, losses: 8,
      characters: [{ name: 'Fox', games: 30 }], season: 'RANKED_SINGLES-crew-uid-season-5',
    },
  };
  state.slippiSkipped = [];
  // checks that commands kick off run in the background, and shouldn't try to post here
  state.messages = Object.fromEntries(['sets', 'streams', 'calls', 'rollcall', 'results', 'top8', 'registration', 'slippi', 'recap'].map((type) => [type, false]));

  const covered = new Set();
  for (const [name, options = {}, expected] of runs) {
    const key = [name, options.group, options.subcommand].filter(Boolean).join(' ');
    const label = `/${key}`;
    const run = interaction(name, options);
    await runningCommand.run(run, () => handleCommand(run));
    if (options.press) {
      // a command that looked something up first asks in its deferred reply
      const asked = run.calls.find(([kind, result]) => ['reply', 'edit'].includes(kind) && result?.components?.length)?.[1];
      const button = asked?.components?.flatMap((row) => row.toJSON().components).find((each) => each.label === options.press);
      assert.ok(button, `${label} has no ${options.press} button`);
      await handleButton({ customId: button.custom_id, user: run.user, update: async (result) => run.calls.push(['update', result]), editReply: async () => {} });
    }
    covered.add(key);
    assert.deepEqual(run.waitedOn, [], `${label} waits on ${run.waitedOn.join(', ')} before answering, so discord can give up on it`);
    const answers = run.calls.filter(([kind]) => kind !== 'defer');
    assert.ok(answers.length, `${label} never answered`);
    if (expected) assert.match(JSON.stringify(answers), expected, label);
  }

  // user commands run from the Apps menu, not chat, so the runs table only covers slash commands.
  // a subcommand group's subcommands count one by one, like /t-o tournament add
  const every = commands.flatMap((command) => {
    const nested = (command.options ?? []).flatMap((option) => {
      if (option.type === 1) return [`${command.name} ${option.name}`];
      if (option.type === 2) return option.options.map((sub) => `${command.name} ${option.name} ${sub.name}`);
      return [];
    });
    return nested.length ? nested : [command.name];
  });
  assert.deepEqual(every.filter((name) => !covered.has(name)), []);

  // let the background checks finish while the fake is still in place
  while (startgg.queueLength() || Date.now() - lastFetch < 2000) await new Promise((resolve) => setTimeout(resolve, 200));
});

test('command replies naming a player never ping, even for a tag like @everyone', async () => {
  state.players = { 9: { userId: 9, playerId: 90, tag: '@everyone', slug: 'user/evil' } };
  state.links = {};
  const remove = interaction('track', { subcommand: 'remove', values: { player: '9' } });
  await runningCommand.run(remove, () => handleCommand(remove));
  const said = remove.calls.find(([kind]) => kind === 'reply')?.[1];
  assert.match(said.content, /Stop tracking @everyone\?/);
  assert.deepEqual(said.allowedMentions, { parse: [] });

  state.players = { 9: { userId: 9, playerId: 90, tag: '@everyone', slug: 'user/evil' } };
  const toggled = interaction('track', { subcommand: 'posts', values: { player: '9', sets: 'off' } });
  await runningCommand.run(toggled, () => handleCommand(toggled));
  const switched = toggled.calls.find(([kind]) => kind === 'reply')?.[1];
  assert.match(switched.content, /Set results off/);
  assert.deepEqual(switched.allowedMentions, { parse: [] });

  state.players = {};
  state.links = { 'evil-discord': { userId: 9, playerId: 90, tag: '@everyone', slug: 'user/evil' } };
  const unlinked = interaction('unlink', { user: 'evil-discord' });
  await runningCommand.run(unlinked, () => handleCommand(unlinked));
  const told = unlinked.calls.find(([kind]) => kind === 'reply')?.[1];
  assert.match(told.content, /Unlinked/);
  assert.deepEqual(told.allowedMentions, { parse: [] });
});

// a press of a button on the message a command answered with
function press(message, label) {
  const button = message.components.flatMap((row) => row.toJSON().components).find((each) => each.label === label);
  assert.ok(button, `no ${label} button`);
  const calls = [];
  const run = {
    customId: button.custom_id, calls, waitedOn: [], user: { id: 'crew-discord' },
    message: { content: '', embeds: message.embeds, components: message.components, flags: { has: () => false } },
    isButton: () => true,
    deferUpdate: async () => { calls.push(['update']); run.deferred = true; },
    deferReply: async (options) => { calls.push(['defer', options]); run.deferred = true; },
    editReply: async (result) => calls.push(['edit', result]),
    deleteReply: async () => calls.push(['delete']),
    followUp: async (result) => calls.push(['followUp', result]),
  };
  return run;
}

// [command, options, button, what pressing it should show]
const presses = [
  ['stats', {}, 'Full report', /Lifetime stats/],
  ['doubles', {}, 'Full report', /Full doubles stats/],
  ['characters', {}, 'Full report', /Fox/],
  ['scout', { values: { profile: '2' } }, 'Full report', /Crew vs Rival/],
  ['h2h', { values: { opponent: '2' } }, 'Full report', /First played/],
  ['predict', { values: { opponent: '2' } }, 'Full report', /How it adds up/],
  // whoever's next, by the player id in the set. a shortcut for short /h2h, so no second press
  ['run', {}, 'H2H vs Rival', /Crew 2-0 Rival/],
];

test('every report button answers the way its command would, and the full reports have no Full report button', async () => {
  state.players = {
    1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', discordId: 'crew-discord', lastCheck: now },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastCheck: now },
  };
  state.links = {};

  for (const [name, options, label, expected] of presses) {
    const what = `/${name} ${label}`;
    const command = interaction(name, options);
    await runningCommand.run(command, () => handleCommand(command));
    const message = command.calls.findLast(([kind, result]) => kind === 'edit' && result.components?.length)?.[1];
    assert.ok(message, `/${name} has no buttons`);
    // short /h2h is one Full report button since the odds moved to /predict
    if (name === 'h2h' && label === 'Full report') {
      assert.deepEqual(message.components.flatMap((row) => row.toJSON().components).map((button) => button.label), ['Full report'], what);
    }

    const run = press(message, label);
    await runningCommand.run(run, () => handleButton(run));
    assert.deepEqual(run.waitedOn, [], `${what} waits on ${run.waitedOn.join(', ')} before answering, so discord can give up on it`);
    const [, answer] = run.calls.findLast(([kind]) => kind === 'edit');
    assert.match(JSON.stringify(answer), expected, what);
    const buttons = JSON.stringify(answer.components);
    if (label === 'Full report') {
      // greyed out before anything else, so nobody presses it twice
      assert.deepEqual(run.calls.slice(0, 2).map(([kind]) => kind), ['update', 'edit'], what);
      assert.ok(run.calls[1][1].components.every((row) => row.components.every((button) => button.disabled)), what);
      assert.doesNotMatch(buttons, /Full report/, what);
    } else {
      // a new message for the head-to-head, the short report with nothing more to show
      assert.equal(run.calls[0][0], 'defer', what);
      assert.doesNotMatch(buttons, /Full report/, what);
      assert.doesNotMatch(JSON.stringify(answer), /First played/, what);
    }
  }
  // short /progress has no Full report button, but one on a message from before still swaps in the full report
  const progress = interaction('progress', {});
  await runningCommand.run(progress, () => handleCommand(progress));
  const short = progress.calls.findLast(([kind, result]) => kind === 'edit' && result.embeds?.length)?.[1];
  assert.match(JSON.stringify(short.embeds), /Last 30 days/);
  assert.deepEqual(short.components, []);
  const old = press({ embeds: [], components: buttonRow(fullReport('progress', { player: state.players[1] })) }, 'Full report');
  await runningCommand.run(old, () => handleButton(old));
  assert.match(JSON.stringify(old.calls.findLast(([kind]) => kind === 'edit')[1]), /Every 30 days, newest first/);
  // /recent sets are over, so they get no head to head buttons
  const recent = interaction('recent', {});
  await runningCommand.run(recent, () => handleCommand(recent));
  const sent = recent.calls.filter(([kind]) => kind === 'edit' || kind === 'followUp').map(([, result]) => result);
  assert.ok(sent.some((result) => result.embeds?.length), '/recent never answers');
  assert.ok(sent.every((result) => !result.components?.length), '/recent has buttons');
  // verbose is the full report, so it never offers another one. explained is always the full one
  const verboseRuns = [
    ['stats', {}], ['doubles', {}], ['progress', {}], ['characters', {}],
    ['scout', { values: { profile: '2' } }], ['h2h', { values: { opponent: '2' } }], ['predict', { values: { opponent: '2' } }],
    ['predict_explained', { values: { opponent: '2' } }],
  ];
  for (const [name, options] of verboseRuns) {
    const what = `/${name} verbose`;
    const verbose = interaction(name, { ...options, values: { ...options.values, verbose: true } });
    await runningCommand.run(verbose, () => handleCommand(verbose));
    const answer = verbose.calls.findLast(([kind, result]) => kind === 'edit' && 'components' in result)?.[1];
    assert.ok(answer, `${what} never answers`);
    assert.doesNotMatch(JSON.stringify(answer.components), /Full report/, what);
    if (name === 'h2h') assert.deepEqual(JSON.parse(JSON.stringify(answer.components)), [], what);
  }
});

test('a button about someone only known from a set finds their start.gg by player id, and private ones answer just the presser', async () => {
  state.players = { 1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', discordId: 'crew-discord', lastCheck: now } };
  state.links = {};
  const pressed = async (customId) => {
    const message = { embeds: [], components: [{ toJSON: () => ({ components: [{ label: 'Head to head', custom_id: customId }] }) }] };
    const run = press(message, 'Head to head');
    await runningCommand.run(run, () => handleButton(run));
    assert.deepEqual(run.waitedOn, [], customId);
    return run.calls;
  };
  const calls = await pressed('private:h2h:crew:#30::::');
  assert.deepEqual(calls[0], ['defer', { flags: MessageFlags.Ephemeral }]);
  assert.match(JSON.stringify(calls.findLast(([kind]) => kind === 'edit')[1]), /Crew vs Opponent/);
  // a TO can add someone without an account, and there's nobody to look up then
  const missing = await pressed('new:h2h:crew:#31::::');
  assert.match(JSON.stringify(missing.at(-1)), /Couldn't find a start\.gg account for that player/);
});
