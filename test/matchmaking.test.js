import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection, MessageFlags, PermissionFlagsBits } from 'discord.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-matchmaking-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const { commands, handleCommand } = await import('../src/commands/index.js');
const { checkMatchmakingExpiry, expiryKey } = await import('../src/commands/matchmaking.js');
after(() => rmSync(directory, { recursive: true, force: true }));

beforeEach(() => {
  state.matchmaking = {};
  state.matchmakingExpiry = {};
  state.matchmakingThreads = [];
});

// a server with these roles. made is what the bot asked discord to create.
// members is discord id to member, for the background expiry check
function server(roles = [], members = new Map()) {
  const made = [];
  const cache = new Collection(roles.map((role) => [role.id, role]));
  const create = async (options) => {
    made.push(options);
    const role = { id: `made-${made.length}`, ...options };
    cache.set(role.id, role);
    return role;
  };
  return {
    made, roles: { cache, create },
    members: { fetch: async ({ user: ids }) => new Map(ids.filter((id) => members.has(id)).map((id) => [id, members.get(id)])) },
  };
}

// a member holding the role ids in held. fail is what discord throws when the bot changes their roles
function person(held = [], fail = null) {
  const roles = new Set(held);
  const change = (apply) => async (role) => {
    if (fail) throw fail;
    apply(role.id);
  };
  return {
    held: roles,
    displayAvatarURL: () => 'https://cdn.example/me.png',
    roles: { cache: { has: (id) => roles.has(id) }, add: change((id) => roles.add(id)), remove: change((id) => roles.delete(id)) },
  };
}

async function run(commandName, { guild = server(), member = person(), values = {}, appPermissions, user, threadFail = null } = {}) {
  const calls = [];
  const threads = [];
  const interaction = {
    commandName, guild, member, appPermissions,
    user: user ?? { id: 'me-discord', username: 'Me' },
    options: {
      getSubcommandGroup: () => null, getSubcommand: () => null,
      getString: (name) => values[name] ?? null, getBoolean: (name) => values[name] ?? null,
      getInteger: (name) => values[name] ?? null,
    },
    deferReply: async (options) => {
      calls.push(['defer', options]);
      interaction.deferred = true;
    },
    reply: async (result) => {
      calls.push(['reply', result]);
      interaction.replied = true;
    },
    editReply: async (result) => calls.push(['edit', result]),
    fetchReply: async () => ({
      startThread: async (options) => {
        if (threadFail) throw threadFail;
        threads.push(options);
        return { id: `match-thread-${threads.length}` };
      },
    }),
    followUp: async (result) => {
      calls.push(['followUp', result]);
    },
  };
  await handleCommand(interaction);
  calls.threads = threads;
  return calls;
}

const lastText = (calls) => {
  const [, result] = calls.at(-1);
  return typeof result === 'string' ? result : result.content;
};

test('the toggle takes a required game first, with an optional duration in minutes', () => {
  const toggle = commands.find((command) => command.name === 'matchmaking_role');
  const ping = commands.find((command) => command.name === 'matchmaking_search');
  for (const command of [toggle, ping]) {
    assert.equal(command.options[0].name, 'game');
    assert.equal(command.options[0].required, true);
    assert.deepEqual(command.options[0].choices, [{ name: 'Ultimate', value: 'ult' }, { name: 'Melee', value: 'melee' }]);
  }
  assert.deepEqual(toggle.options.map((option) => option.name), ['game', 'duration']);
  const duration = toggle.options.find((option) => option.name === 'duration');
  assert.equal(duration.type, 4);
  assert.equal(duration.required ?? false, false);
  assert.equal(duration.min_value, 1);
  assert.equal(duration.max_value, 1440);
  assert.ok(duration.description.length <= 100);
  assert.deepEqual(ping.options.map((option) => [option.name, option.required ?? false]), [['game', true], ['message', false], ['thread', false]]);
  assert.equal(ping.options.find((option) => option.name === 'thread').type, 5);
});

test('the first toggle makes a mentionable role that grants nothing, saves its id and hands it out', async () => {
  const guild = server();
  const member = person();
  const calls = await run('matchmaking_role', { guild, member, values: { game: 'melee' } });

  // making a role can take discord past 3 seconds, so the private reply comes first
  assert.deepEqual(calls[0], ['defer', { flags: MessageFlags.Ephemeral }]);
  assert.equal(guild.made.length, 1);
  assert.equal(guild.made[0].name, 'Melee Matchmaking');
  assert.equal(guild.made[0].mentionable, true);
  assert.deepEqual(guild.made[0].permissions, []);
  assert.equal(guild.made[0].colors, undefined);
  assert.ok(member.held.has('made-1'));
  assert.equal(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).matchmaking.melee, 'made-1');
  assert.match(lastText(calls), /You have the \*\*Melee Matchmaking\*\* role now.*`\/matchmaking_search game:Melee` pings it, and so does typing @Melee Matchmaking/);
});

test('running it again takes the role off without making another', async () => {
  const guild = server();
  const member = person();
  await run('matchmaking_role', { guild, member, values: { game: 'ult' } });
  const calls = await run('matchmaking_role', { guild, member, values: { game: 'ult' } });

  assert.equal(guild.made.length, 1);
  assert.equal(member.held.size, 0);
  assert.match(lastText(calls), /Took off your \*\*Ultimate Matchmaking\*\* role/);
});

test('each game has its own role', async () => {
  const guild = server();
  const member = person();
  await run('matchmaking_role', { guild, member, values: { game: 'ult' } });
  await run('matchmaking_role', { guild, member, values: { game: 'melee' } });

  assert.deepEqual(guild.made.map((role) => role.name), ['Ultimate Matchmaking', 'Melee Matchmaking']);
  assert.deepEqual(state.matchmaking, { ult: 'made-1', melee: 'made-2' });
  assert.equal(member.held.size, 2);
});

test('a role renamed in server settings is still the one it hands out and pings', async () => {
  state.matchmaking = { ult: 'ult-role' };
  const guild = server([{ id: 'ult-role', name: 'Ult LFG', mentionable: true }]);
  const member = person();
  const toggled = await run('matchmaking_role', { guild, member, values: { game: 'ult' } });

  assert.equal(guild.made.length, 0);
  assert.ok(member.held.has('ult-role'));
  assert.match(lastText(toggled), /You have the \*\*Ult LFG\*\* role now/);

  const pinged = await run('matchmaking_search', { guild, member, values: { game: 'ult' } });
  assert.equal(lastText(pinged), '<@&ult-role>');
});

test('a role someone made by hand with the right name gets used and remembered', async () => {
  const guild = server([{ id: 'by-hand', name: 'Melee Matchmaking', mentionable: true }]);
  await run('matchmaking_role', { guild, values: { game: 'melee' } });

  assert.equal(guild.made.length, 0);
  assert.equal(state.matchmaking.melee, 'by-hand');
});

test('pinging needs the role, whether or not anyone has made it yet', async () => {
  for (const guild of [server(), server([{ id: 'melee-role', name: 'Melee Matchmaking', mentionable: true }])]) {
    const calls = await run('matchmaking_search', { guild, values: { game: 'melee' } });
    assert.equal(calls.length, 1);
    const [kind, result] = calls[0];
    assert.equal(kind, 'reply');
    assert.equal(result.flags, MessageFlags.Ephemeral);
    assert.deepEqual(result.allowedMentions, { parse: [] });
    assert.match(result.content, /You need the \*\*Melee Matchmaking\*\* role to ping it\. `\/matchmaking_role game:Melee` gives it to you\./);
  }
});

test('a ping mentions only the role, with a card naming who asked and their message', async () => {
  state.matchmaking = { melee: 'melee-role' };
  const guild = server([{ id: 'melee-role', name: 'Melee Matchmaking', mentionable: true }]);
  const calls = await run('matchmaking_search', { guild, member: person(['melee-role']), values: { game: 'melee', message: '  @everyone netplay? FOXY#420  ' } });

  assert.equal(calls.length, 1);
  const [kind, result] = calls[0];
  assert.equal(kind, 'reply');
  assert.equal(result.flags, undefined);
  assert.equal(result.content, '<@&melee-role>');
  // nothing but the role, so @everyone in the message does nothing
  assert.deepEqual(result.allowedMentions, { roles: ['melee-role'] });
  const card = result.embeds[0].data;
  assert.equal(card.title, 'Melee matchmaking');
  assert.equal(card.thumbnail.url, 'https://cdn.example/me.png');
  assert.equal(card.description, '<@me-discord> is looking for Melee games.\n> @everyone netplay? FOXY#420\n-# `/matchmaking_role game:Melee` gets you these pings, or stops them');
});

test('a ping without a message leaves out the quote', async () => {
  state.matchmaking = { ult: 'ult-role' };
  const guild = server([{ id: 'ult-role', name: 'Ultimate Matchmaking', mentionable: true }]);
  const calls = await run('matchmaking_search', { guild, member: person(['ult-role']), values: { game: 'ult', message: '   ' } });

  assert.equal(calls[0][1].embeds[0].data.description, '<@me-discord> is looking for Ultimate games.\n-# `/matchmaking_role game:Ultimate` gets you these pings, or stops them');
});

test('a role with mentions turned off only gets pinged when the bot has Mention Everyone', async () => {
  state.matchmaking = { melee: 'melee-role' };
  const guild = server([{ id: 'melee-role', name: 'Melee Matchmaking', mentionable: false }]);
  const member = person(['melee-role']);

  const refused = await run('matchmaking_search', { guild, member, values: { game: 'melee' } });
  assert.equal(refused[0][1].flags, MessageFlags.Ephemeral);
  assert.match(refused[0][1].content, /\*\*Melee Matchmaking\*\* can't be pinged right now.*Allow anyone to @mention this role/);

  const appPermissions = { has: (permission) => permission === PermissionFlagsBits.MentionEveryone };
  const sent = await run('matchmaking_search', { guild, member, values: { game: 'melee' }, appPermissions });
  assert.equal(sent[0][1].content, '<@&melee-role>');
});

test('missing Manage Roles, or a role above the bot\'s, gets a reply saying so', async () => {
  const fail = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  const calls = await run('matchmaking_role', { member: person([], fail), values: { game: 'ult' } });

  assert.match(lastText(calls), /I couldn't change your \*\*Ultimate Matchmaking\*\* role\. That needs Manage Roles, with my role above Ultimate Matchmaking\./);
});

test('any other discord failure says to try again instead of blaming start.gg', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const fail = Object.assign(new Error('Service Unavailable'), { status: 503 });
  const calls = await run('matchmaking_role', { member: person([], fail), values: { game: 'melee' } });

  assert.match(lastText(calls), /Discord didn't let me change your \*\*Melee Matchmaking\*\* role just now\. Try again in a minute\./);
  assert.equal(logged.mock.callCount(), 1);
});

test('thread:True starts a thread on the ping, left out it sends none', async () => {
  state.matchmaking = { melee: 'melee-role' };
  const guild = server([{ id: 'melee-role', name: 'Melee Matchmaking', mentionable: true }]);
  const member = { ...person(['melee-role']), displayName: 'Sam' };

  const before = Math.floor(Date.now() / 1000);
  const withThread = await run('matchmaking_search', { guild, member, values: { game: 'melee', thread: true }, user: { id: 'me-discord', username: 'Sam' } });
  assert.equal(withThread[0][1].content, '<@&melee-role>');
  assert.equal(withThread.threads.length, 1);
  assert.equal(withThread.threads[0].name, 'Melee games with Sam');
  assert.equal(state.matchmakingThreads.length, 1);
  assert.equal(state.matchmakingThreads[0].id, 'match-thread-1');
  assert.ok(state.matchmakingThreads[0].at >= before);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).matchmakingThreads, state.matchmakingThreads);

  const withoutThread = await run('matchmaking_search', { guild, member, values: { game: 'melee' } });
  assert.equal(withoutThread[0][1].content, '<@&melee-role>');
  assert.equal(withoutThread.threads.length, 0);
});

test('a thread that cannot start still posts the ping and says so privately', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  state.matchmaking = { ult: 'ult-role' };
  const guild = server([{ id: 'ult-role', name: 'Ultimate Matchmaking', mentionable: true }]);
  const member = { ...person(['ult-role']), displayName: 'Sam' };
  const calls = await run('matchmaking_search', {
    guild, member, values: { game: 'ult', thread: true },
    user: { id: 'me-discord', username: 'Sam' }, threadFail: new Error('Missing Permissions'),
  });

  assert.equal(calls[0][1].content, '<@&ult-role>');
  assert.equal(calls.threads.length, 0);
  assert.equal(calls[1][0], 'followUp');
  assert.equal(calls[1][1].flags, MessageFlags.Ephemeral);
  assert.match(calls[1][1].content, /couldn't start a thread/);
  assert.equal(logged.mock.callCount(), 1);
});

test('duration hands out the role and saves when it comes off', async () => {
  const guild = server();
  const member = person();
  const before = Math.floor(Date.now() / 1000);
  const calls = await run('matchmaking_role', { guild, member, values: { game: 'melee', duration: 30 } });

  assert.ok(member.held.has('made-1'));
  const key = expiryKey('me-discord', 'melee');
  assert.ok(state.matchmakingExpiry[key] >= before + 30 * 60);
  assert.ok(state.matchmakingExpiry[key] <= Math.floor(Date.now() / 1000) + 30 * 60);
  assert.match(lastText(calls), /You have the \*\*Melee Matchmaking\*\* role now for 30 minutes.*It comes off on its own after that/);
  // saved, so a restart doesn't cancel it
  assert.equal(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).matchmakingExpiry[key], state.matchmakingExpiry[key]);
});

test('duration on someone who has the role keeps it and moves the timer', async () => {
  const guild = server();
  const member = person();
  await run('matchmaking_role', { guild, member, values: { game: 'ult' } });
  assert.ok(member.held.has('made-1'));
  assert.equal(state.matchmakingExpiry[expiryKey('me-discord', 'ult')], undefined);

  const kept = await run('matchmaking_role', { guild, member, values: { game: 'ult', duration: 60 } });
  assert.ok(member.held.has('made-1'));
  assert.equal(guild.made.length, 1);
  assert.ok(state.matchmakingExpiry[expiryKey('me-discord', 'ult')] > Math.floor(Date.now() / 1000));
  assert.match(lastText(kept), /Keeping your \*\*Ultimate Matchmaking\*\* role for 1 hour, then it comes off on its own/);

  const off = await run('matchmaking_role', { guild, member, values: { game: 'ult' } });
  assert.equal(member.held.size, 0);
  assert.equal(state.matchmakingExpiry[expiryKey('me-discord', 'ult')], undefined);
  assert.match(lastText(off), /Took off your \*\*Ultimate Matchmaking\*\* role/);
});

test('a bad duration says so and changes nothing', async () => {
  const guild = server();
  const member = person();
  for (const duration of [0, 1441]) {
    const calls = await run('matchmaking_role', { guild, member, values: { game: 'melee', duration } });
    assert.match(lastText(calls), /Duration is minutes to keep the role, 1-1440/);
  }
  assert.equal(guild.made.length, 0);
  assert.equal(member.held.size, 0);
  assert.deepEqual(state.matchmakingExpiry, {});
});

test('expired timers take the role off, live ones stay', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.matchmaking = { melee: 'melee-role' };
  const expired = person(['melee-role']);
  const live = person(['melee-role']);
  const guild = server(
    [{ id: 'melee-role', name: 'Melee Matchmaking', mentionable: true }],
    new Map([['gone-discord', expired], ['staying-discord', live]]),
  );
  state.matchmakingExpiry = { [expiryKey('gone-discord', 'melee')]: now - 10, [expiryKey('staying-discord', 'melee')]: now + 3600 };

  const removed = await checkMatchmakingExpiry(guild, now);
  assert.deepEqual(removed, [{ discordId: 'gone-discord', game: 'melee', roleId: 'melee-role' }]);
  assert.ok(!expired.held.has('melee-role'));
  assert.ok(live.held.has('melee-role'));
  assert.equal(state.matchmakingExpiry[expiryKey('gone-discord', 'melee')], undefined);
  assert.equal(state.matchmakingExpiry[expiryKey('staying-discord', 'melee')], now + 3600);
});

test('someone who left or took it off by hand just clears the timer', async () => {
  const now = Math.floor(Date.now() / 1000);
  state.matchmaking = { ult: 'ult-role' };
  const bare = person();
  const guild = server(
    [{ id: 'ult-role', name: 'Ultimate Matchmaking', mentionable: true }],
    new Map([['bare-discord', bare]]),
  );
  state.matchmakingExpiry = {
    [expiryKey('left-discord', 'ult')]: now - 5,
    [expiryKey('bare-discord', 'ult')]: now - 5,
  };

  const removed = await checkMatchmakingExpiry(guild, now);
  assert.deepEqual(removed, []);
  assert.deepEqual(state.matchmakingExpiry, {});
});
