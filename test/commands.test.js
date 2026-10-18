import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// every command once against a fake start.gg, so a handler that throws shows up here
const directory = mkdtempSync(join(tmpdir(), 'sama-commands-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleButton, handleCommand } = await import('../src/commands/index.js');
const startgg = await import('../src/startgg.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

const now = Math.floor(Date.now() / 1000);
const event = {
  name: 'Ultimate Singles', slug: 'tournament/local/event/singles', startAt: now - 3600, numEntrants: 32,
  videogame: { id: 1386, displayName: 'Ultimate' }, tournament: { name: 'Local', slug: 'tournament/local', images: [] },
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
    return { tournament: { ...live, events: [{ id: 50, name: event.name, slug: event.slug, state: 'ACTIVE', numEntrants: 32, ...each(entrant) }] } };
  }
  if (query.includes('tournamentView')) return each({ tournaments: { nodes: [] } });
  if (query.includes('tournaments(query:')) return each({ tournaments: { nodes: [live] } });
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

function interaction(commandName, { subcommand = null, values = {}, user = 'crew-discord' } = {}) {
  const calls = [];
  const discord = (what, result) => async () => { beforeAnswer(run, what); return result; };
  const run = {
    commandName, calls, waitedOn: [],
    user: { id: user, bot: false, displayName: 'Crew' },
    guild: {
      members: { fetch: async ({ user: ids }) => { beforeAnswer(run, 'discord members'); return new Map(ids.map((id) => [id, {}])); } },
      roles: { cache: { find: () => undefined }, create: discord('discord role create', {}) },
    },
    member: { displayName: 'Crew', displayAvatarURL: () => 'https://cdn.example/crew.png', roles: { add: discord('discord role add'), remove: discord('discord role remove') } },
    memberPermissions: { has: () => true },
    client: { user: { displayAvatarURL: () => 'https://cdn.example/avatar.png' } },
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => values[name] ?? null,
      getBoolean: (name) => values[name] ?? null,
      getInteger: (name) => values[name] ?? null,
      getUser: () => values.user ?? null,
      getMember: () => (values.user ? { displayName: values.user.displayName, displayAvatarURL: () => 'https://cdn.example/member.png' } : null),
    },
    reply: async (result) => { calls.push(['reply', result]); run.replied = true; },
    deferReply: async () => { calls.push(['defer']); run.deferred = true; },
    editReply: async (result) => calls.push(['edit', result]),
    deleteReply: async () => calls.push(['delete']),
    followUp: async (result) => calls.push(['followUp', result]),
    channel: { send: async (result) => { calls.push(['send', result]); return {}; } },
  };
  return run;
}

// [command, options, what the answer should have in it]. players left out mean whoever ran it, which is Crew
const runs = [
  ['help', {}, /Linking yourself/], ['status', {}, /Status/], ['messages', {}, /Set results:\*\* off/], ['socials', {}, /Nothing yet/],
  ['socials_edit', { subcommand: 'add', values: { name: '716 Esports', link: 'twitch.tv/716esports' } }, /Added https:\/\/twitch\.tv\/716esports under 716 Esports/],
  ['socials_edit', { subcommand: 'remove', values: { link: 'https://twitch.tv/716esports' } }, /Removed/],
  ['track', { subcommand: 'add', values: { profile: 'start.gg/user/opponent' } }, /Now tracking \[Opponent\].*Set results, stream alerts and match call pings start off/],
  ['track', { subcommand: 'list' }, /Tracking 3/],
  ['track', { subcommand: 'remove', values: { player: '3' } }, /Stopped tracking Opponent/],
  ['link', { values: { profile: 'start.gg/user/opponent' }, user: 'opponent-discord' }, /Linked to Opponent/],
  // left out, it searches the accounts the bot has seen, and nobody has this discord
  ['link', { user: 'stranger-discord' }, /Couldn't find a start\.gg with this Discord connected/],
  ['unlink', { user: 'opponent-discord' }, /Unlinked from Opponent/],
  ['profile', {}, /"title":"Crew","url":"https:\/\/www\.start\.gg\/user\/crew"/],
  ['profile', { values: { player: '2' } }, /"title":"Rival","url":"https:\/\/www\.start\.gg\/user\/rival"/],
  ['profile', { values: { user: { id: 'stranger', bot: false, displayName: 'Stranger' } } }, /Couldn't find a start\.gg with Stranger's Discord connected/],
  ['upcoming', {}, /Live · Crew/], ['upcoming', { values: { player: 'all' } }, /Live · everyone/],
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
  ['h2h', { values: { opponent: '2' } }, /Crew 2-0 Rival.*Predicted.*Ultimate/], ['h2h', { values: { opponent: '2', verbose: true } }, /Predicted.*Ultimate.*First played/],
  // the fake sets are all ultimate
  ['h2h', { values: { opponent: '2', melee: true } }, /in Melee singles on start\.gg yet\..*2 sets in other games left out.*Slippi ranked.*\*\*Crew\*\*: \[CREW#1\]/],
  // ultimate, so no slippi
  ['h2h', { values: { opponent: '2' } }, /^(?!.*Slippi ranked)/],
  ['h2h', { values: { opponent: '2', verbose: true, melee: true } }, /haven't played each other in Melee singles on start\.gg yet/],
  // either player can be a start.gg link or ID instead of a tracked or linked pick
  ['h2h', { values: { opponent: 'start.gg/user/opponent' } }, /Crew vs Opponent.*haven't played each other in singles on start\.gg yet/],
  ['h2h', { values: { player: 'start.gg/user/opponent', opponent: '2' } }, /Opponent vs Rival.*haven't played each other in singles on start\.gg yet/],
  ['h2h', { values: { opponent: 'start.gg/user/nobody' } }, /Couldn't find a start\.gg player for `start\.gg\/user\/nobody`/],
  ['stats', {}, /Recent sets/], ['stats', { values: { verbose: true } }, /Lifetime stats/],
  // a netplay player can have a rank with nothing on start.gg
  ['stats', { values: { melee: true } }, /No Melee sets or events on start\.gg yet\..*Slippi ranked.*CREW#1.*Gold 2.*Characters:\*\* Fox 30 games/],
  ['stats', { values: { verbose: true, melee: true } }, /No Melee sets or events on start\.gg yet\..*Slippi ranked/],
  ['doubles', {}, /Doubles stats.*Ultimate 2-0 \(100%\).*Best finish:\*\* 🥇 \*\*1st\*\* of 32.*with \*\*Partner\*\*.*### Partners\\n\*\*Partner\*\* · 2-0 \(100%\) · 1 event.*From their last 2 doubles sets and 1 event/],
  ['doubles', { values: { verbose: true } }, /Full doubles stats.*"name":"Partners","value":"1".*best 1st of 32.*Most played teams","value":"\*\*Rival \/ Ally\*\* 2-0/],
  // the fake doubles sets are all ultimate, and slippi ranked is singles, so no slippi either
  ['doubles', { values: { melee: true } }, /^(?!.*Slippi ranked).*No Melee doubles sets on start\.gg yet\./],
  ['characters', {}, /Fox/], ['characters', { values: { verbose: true } }, /Fox/],
  ['characters', { values: { game: 1 } }, /Slippi ranked.*Fox\*\* · 30 games.*CREW#1/],
  ['predict', { values: { opponent: '2' } }, /Crew \d+% · \d+% Rival/], ['predict', { values: { opponent: '2', verbose: true } }, /How it adds up/],
  ['predict', { values: { opponent: '2', melee: true } }, /Neither Crew nor Rival has played Melee singles on start\.gg\..*Leave out `melee` for Ultimate odds.*"name":"Slippi ranked","value":"\*\*Crew\*\*: \[CREW#1\][^"\\]*\\n-# Netplay ranked/],
  ['predict', { values: { opponent: '2', verbose: true, melee: true } }, /Neither Crew nor Rival has played Melee singles/],
  ['predict', { values: { opponent: 'start.gg/user/opponent' } }, /Crew and Opponent haven't played singles in the same game/],
  ['stream', { values: { player: 'all', alerts: 'off' } }, /Stream alerts off for everyone/],
  ['stream_pings', { values: { ping: 'on' } }, /pinged for every stream alert/],
  ['sets', { values: { player: 'all', results: 'off' } }, /Set results off for everyone/],
  ['calls', { values: { player: 'all', pings: 'off' } }, /Match call pings off for everyone/],
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
  ['set_reg_reminder', { values: { tournament: 'start.gg/tournament/soon' } }, /gets pinged 12 hours before registration for Soon ends/],
  ['delete_reg_reminder', { values: { tournament: 'soon' } }, /Deleted the reminder for Soon/],
  ['reg_admin', { subcommand: 'add', values: { profile: 'start.gg/user/opponent' } }, /Opponent is an admin of/],
  ['reg_admin', { subcommand: 'list' }, /Reg admins · 1/],
  ['reg_admin', { subcommand: 'remove', values: { admin: '3' } }, /No more automatic reminders/],
  ['bracket', {}, /No tournaments set as active/],
  ['reg_role', { values: { ping: 'on' } }, /pinged for reg reminders/],
  ['registered', { values: { tournament: 'start.gg/tournament/soon' } }, /Registered from this server · 1/],
  ['reg_warn', { values: { tournament: 'start.gg/tournament/soon', user: { id: 'someone', bot: false, displayName: 'Someone' } } }, /"content":"<@someone>"/],
  ['sm4sh'], ['melee'], ['ult'], ['64'], ['brawl'], ['pplus'], ['bills', {}, /Wikimedia Commons|Imgflip|GIPHY/], ['view_pfp', {}, /pfp\.png/],
];

test('every command and subcommand answers without throwing', async () => {
  state.players = {
    1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', discordId: 'crew-discord', lastCheck: now, streamAlerts: true },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastCheck: now, streamAlerts: true },
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
    const label = `/${name} ${options.subcommand ?? ''}`;
    const run = interaction(name, options);
    await runningCommand.run(run, () => handleCommand(run));
    covered.add(options.subcommand ? `${name} ${options.subcommand}` : name);
    assert.deepEqual(run.waitedOn, [], `${label} waits on ${run.waitedOn.join(', ')} before answering, so discord can give up on it`);
    const answers = run.calls.filter(([kind]) => kind !== 'defer');
    assert.ok(answers.length, `${label} never answered`);
    if (expected) assert.match(JSON.stringify(answers), expected, label);
  }

  const every = commands.flatMap((command) => {
    const subcommands = (command.options ?? []).filter((option) => option.type === 1);
    return subcommands.length ? subcommands.map((sub) => `${command.name} ${sub.name}`) : [command.name];
  });
  assert.deepEqual(every.filter((name) => !covered.has(name)), []);

  // let the background checks finish while the fake is still in place
  while (startgg.queueLength() || Date.now() - lastFetch < 2000) await new Promise((resolve) => setTimeout(resolve, 200));
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
    deferReply: async () => { calls.push(['defer']); run.deferred = true; },
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
  ['progress', {}, 'Full report', /Every 30 days, newest first/],
  ['characters', {}, 'Full report', /Fox/],
  ['scout', { values: { profile: '2' } }, 'Full report', /Crew vs Rival/],
  ['h2h', { values: { opponent: '2' } }, 'Full report', /First played/],
  ['h2h', { values: { opponent: '2' } }, 'Why these odds', /Crew \d+% · \d+% Rival/],
  ['predict', { values: { opponent: '2' } }, 'Full report', /How it adds up/],
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
      // a new message for /predict, with its own button
      assert.equal(run.calls[0][0], 'defer', what);
      assert.match(buttons, /Full report/, what);
    }
  }
  // the verbose /h2h still offers the odds
  const verbose = interaction('h2h', { values: { opponent: '2', verbose: true } });
  await runningCommand.run(verbose, () => handleCommand(verbose));
  assert.deepEqual(JSON.parse(JSON.stringify(verbose.calls.at(-1)[1].components))[0].components.map((button) => button.label), ['Why these odds']);
});
