import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// every command once against a fake start.gg, so a handler that throws shows up here
const directory = mkdtempSync(join(tmpdir(), 'sama-commands-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
// the jokes would call claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleCommand } = await import('../src/commands.js');
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
const live = { id: 5, name: 'Local', slug: 'tournament/local', startAt: now - 3600, endAt: now + 3600, city: 'Buffalo', addrState: 'NY', isOnline: false, images: [] };
const soon = { ...live, id: 6, name: 'Soon', slug: 'tournament/soon', startAt: now + 86400, endAt: now + 90000 };

function respond(query, variables) {
  const aliases = [...query.matchAll(/\b([pu])(\d+): /g)].map(([, kind, id]) => `${kind}${id}`);
  const each = (value) => Object.fromEntries(aliases.map((alias) => [alias, value]));
  if (query.includes('currentUser')) return { currentUser: { id: 1 } };
  if (query.includes('user(slug:')) {
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
  if (query.includes('authorizations')) return each({ images: [], player: { gamerTag: 'Crew' }, authorizations: [{ externalId: 'crew-discord' }] });
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
    member: { roles: { add: discord('discord role add'), remove: discord('discord role remove') } },
    memberPermissions: { has: () => true },
    client: { user: { displayAvatarURL: () => 'https://cdn.example/avatar.png' } },
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => values[name] ?? null,
      getBoolean: (name) => values[name] ?? null,
      getInteger: (name) => values[name] ?? null,
      getUser: () => values.user ?? null,
      getMember: () => (values.user ? { displayName: values.user.displayName } : null),
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
  ['help', {}, /Looking yourself up/], ['status', {}, /Status/], ['messages', {}, /Set results: off/], ['socials', {}, /Nothing yet/],
  ['socials_edit', { subcommand: 'add', values: { name: '716 Esports', link: 'twitch.tv/716esports' } }, /Added https:\/\/twitch\.tv\/716esports under 716 Esports/],
  ['socials_edit', { subcommand: 'remove', values: { link: 'https://twitch.tv/716esports' } }, /Removed/],
  ['track', { subcommand: 'add', values: { profile: 'start.gg/user/opponent' } }, /Now tracking \[Opponent\]/],
  ['track', { subcommand: 'list' }, /Tracking 3/],
  ['track', { subcommand: 'remove', values: { player: '3' } }, /Stopped tracking Opponent/],
  ['link', { values: { profile: 'start.gg/user/opponent' }, user: 'opponent-discord' }, /Linked to Opponent/],
  ['unlink', { user: 'opponent-discord' }, /Unlinked from Opponent/],
  ['upcoming', {}, /Live · Crew/], ['upcoming', { values: { player: 'all' } }, /Live · everyone/],
  ['recent', {}, /W · Crew 2-1 Rival/], ['recent', { values: { player: 'all' } }, /Crew 2-1 Rival/],
  ['run', {}, /Crew's run/], ['progress', {}, /Crew's progress/], ['progress', { values: { verbose: true } }, /Every 30 days, newest first/],
  ['scout', { values: { profile: 'start.gg/user/opponent' } }, /Scouting Opponent/],
  ['scout', { values: { profile: 'start.gg/user/opponent', verbose: true } }, /Crew vs Opponent/],
  ['h2h', { values: { opponent: '2' } }, /Crew 2-0 Rival/], ['h2h', { values: { opponent: '2', verbose: true } }, /First played/],
  ['stats', {}, /Recent sets/], ['stats', { values: { verbose: true } }, /Lifetime stats/],
  ['characters', {}, /Fox/], ['characters', { values: { verbose: true } }, /Fox/],
  ['predict', { values: { opponent: '2' } }, /Crew \d+% · \d+% Rival/], ['predict', { values: { opponent: '2', verbose: true } }, /How it adds up/],
  ['stream', { values: { player: 'all', alerts: 'off' } }, /Stream alerts off for everyone/],
  ['set_reg_reminder', { values: { tournament: 'start.gg/tournament/soon' } }, /gets pinged 12 hours before registration for Soon ends/],
  ['delete_reg_reminder', { values: { tournament: 'soon' } }, /Deleted the reminder for Soon/],
  ['reg_admin', { subcommand: 'add', values: { profile: 'start.gg/user/opponent' } }, /Opponent is an admin of/],
  ['reg_admin', { subcommand: 'list' }, /Reg admins · 1/],
  ['reg_admin', { subcommand: 'remove', values: { admin: '3' } }, /No more automatic reminders/],
  ['bracket', {}, /No tournaments set as active/],
  ['reg_role', { values: { ping: 'on' } }, /pinged for reg reminders/],
  ['registered', { values: { tournament: 'start.gg/tournament/soon' } }, /Registered from this server · 1/],
  ['reg_warn', { values: { tournament: 'start.gg/tournament/soon', user: { id: 'someone', bot: false, displayName: 'Someone' } } }, /"content":"<@someone>"/],
  ['sm4sh'], ['melee'], ['ult'], ['64'], ['brawl'], ['pplus'], ['pfp', {}, /pfp\.png/],
];

test('every command and subcommand answers without throwing', async () => {
  state.players = {
    1: { userId: 1, playerId: 10, tag: 'Crew', slug: 'user/crew', discordId: 'crew-discord', lastCheck: now, streamAlerts: true },
    2: { userId: 2, playerId: 20, tag: 'Rival', slug: 'user/rival', lastCheck: now, streamAlerts: true },
  };
  state.tournaments = { 5: { ...live, entries: [{ userId: 1, event: event.name, eventSlug: event.slug, eventId: 50, started: true }], userIds: [1] } };
  state.links = {};
  state.socials = [];
  // checks that commands kick off run in the background, and shouldn't try to post here
  state.messages = Object.fromEntries(['sets', 'streams', 'rollcall', 'results', 'registration', 'recap'].map((type) => [type, false]));

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
