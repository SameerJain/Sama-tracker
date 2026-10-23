import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockApi as answerWith } from './fixtures.js';

const directory = mkdtempSync(join(tmpdir(), 'sama-dm-'));
process.env.STATE_DIR = directory;
// the fun posts would call Claude on import
delete process.env.ANTHROPIC_API_KEY;
const { state } = await import('../src/store.js');
const tracker = await import('../src/tracker.js');
const embeds = await import('../src/embeds/index.js');
const startgg = await import('../src/startgg.js');
startgg.setRequestGap(0);
const { forgetMisses } = startgg;
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });

function mockApi(respond) {
  forgetMisses();
  answerWith(respond);
}

// a fake post channel whose client DMs into sent instead of discord. inServer lists the discord ids in the
// server, read each time the bot asks, so a test can change it partway. left out it's everyone, and null is
// a channel with no server at all. fetchFails makes the membership check fail
function dmChannel(sent, inServer = 'everyone', fetchFails = false) {
  const channel = {
    client: {
      users: {
        fetch: async (id) => ({
          send: async (payload) => {
            sent.push({ to: id, ...payload });
            return {};
          },
        }),
      },
    },
    send: async () => ({}),
  };
  if (inServer === null) return channel;
  const member = (id) => inServer === 'everyone' || inServer.includes(id);
  channel.guild = {
    members: {
      fetch: async ({ user: ids }) => {
        if (fetchFails) throw new Error('discord down');
        return new Map(ids.filter(member).map((id) => [id, {}]));
      },
    },
  };
  return channel;
}

const tracked = { by: 'manual', at: 0, sets: true, stream: true, top8: true, reminders: true };
const images = [
  { type: 'banner', url: 'https://images.example/banner.png' },
  { type: 'profile', url: 'https://images.example/logo.png' },
];

function reset() {
  state.tournaments = {};
  state.regDmPings = [];
  state.startDmPings = [];
  state.messages = {};
  state.accounts = {};
}

test('startReminder has the tournament image, link, time and location', () => {
  const now = Math.floor(Date.now() / 1000);
  const tournament = {
    id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 3600, endAt: now + 7200,
    city: 'Buffalo', addrState: 'NY', isOnline: false, images, numAttendees: 12,
  };
  const card = embeds.startReminder(tournament).data;
  assert.match(card.title, /Starts soon · Local/);
  assert.match(card.description, new RegExp(`Starts.*<t:${tournament.startAt}:R>`));
  assert.match(card.description, /Buffalo, NY/);
  assert.match(card.description, /start\.gg\/tournament\/local\/register/);
  assert.match(card.description, /Tournament page on start\.gg/);
  assert.equal(card.image.url, 'https://images.example/banner.png');
  assert.equal(card.thumbnail.url, 'https://images.example/logo.png');
});

test('reg DMs go 1 hour before close with the image, skipping registered users', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.regDmPings = ['fan', 'registered-fan'];
  state.tournaments = {
    1: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: { deadline: now + 1800, next: 4 },
    },
  };
  mockApi(({ query }) => {
    if (query.includes('registrationClosesAt')) {
      return {
        tournament: {
          id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000,
          registrationClosesAt: now + 1800, isRegistrationOpen: true, images, numAttendees: 5, events: [],
          city: 'Buffalo', addrState: 'NY', isOnline: false,
        },
      };
    }
    if (query.includes('participants(')) {
      return {
        tournament: {
          participants: {
            pageInfo: { totalPages: 1 },
            nodes: [{ gamerTag: 'Registered', user: { id: 2, slug: 'user/registered', authorizations: [{ externalId: 'registered-fan' }] } }],
          },
        },
      };
    }
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'fan');
  const card = sent[0].embeds[0].data;
  assert.match(card.title, /Registration reminder · Local/);
  assert.match(card.description, /Buffalo, NY/);
  assert.match(card.description, /start\.gg\/tournament\/local\/register/);
  assert.equal(card.image.url, 'https://images.example/banner.png');
  assert.equal(state.tournaments[1].dmRegSentFor, now + 1800);

  // a second run sends nothing again
  const again = [];
  await tracker.postDmReminders(dmChannel(again));
  assert.equal(again.length, 0);
});

test('start DMs go 1 hour before the start to everyone opted in', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.startDmPings = ['fan', 'other'];
  state.tournaments = {
    1: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: {},
    },
  };
  mockApi(({ query }) => {
    if (query.includes('registrationClosesAt')) {
      return {
        tournament: {
          id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
          registrationClosesAt: now + 1800, isRegistrationOpen: true, images, numAttendees: 5, events: [],
          city: 'Buffalo', addrState: 'NY', isOnline: false,
        },
      };
    }
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent));
  // reg and start share the deadline here, so only the start DM goes out, to both
  assert.deepEqual(sent.map((each) => each.to).sort(), ['fan', 'other']);
  assert.match(sent[0].embeds[0].data.title, /Starts soon · Local/);
  assert.equal(state.tournaments[1].dmStartSentFor, now + 1800);
  assert.equal(state.tournaments[1].dmRegSentFor, undefined);
});

test('separate reg and start windows send two DMs', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.regDmPings = ['fan'];
  state.startDmPings = ['fan'];
  const deadline = now + 1800;
  const startAt = now + 86400;
  state.tournaments = {
    1: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt, endAt: startAt + 3600,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: { deadline, next: 4 },
    },
  };
  mockApi(({ query }) => {
    if (query.includes('registrationClosesAt')) {
      return {
        tournament: {
          id: 1, name: 'Local', slug: 'tournament/local', startAt, endAt: startAt + 3600,
          registrationClosesAt: deadline, isRegistrationOpen: true, images, numAttendees: 5, events: [],
          city: 'Buffalo', addrState: 'NY', isOnline: false,
        },
      };
    }
    if (query.includes('participants(')) {
      return { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    }
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent));
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].data.title, /Registration reminder/);

  // move to an hour before the start: the start DM goes out too
  mockApi(({ query }) => {
    if (query.includes('registrationClosesAt')) {
      return {
        tournament: {
          id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
          registrationClosesAt: deadline, isRegistrationOpen: true, images, numAttendees: 5, events: [],
          city: 'Buffalo', addrState: 'NY', isOnline: false,
        },
      };
    }
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  // pretend the start moved up, with the reg DM already sent for its deadline
  state.tournaments[1].startAt = now + 1800;
  const later = [];
  await tracker.postDmReminders(dmChannel(later));
  assert.equal(later.length, 1);
  assert.match(later[0].embeds[0].data.title, /Starts soon/);
});

test('only /notify and the tournament reminders switch decide, not /settings', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.regDmPings = ['fan'];
  state.startDmPings = ['fan'];
  const latest = {
    tournament: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
      registrationClosesAt: now + 1800, isRegistrationOpen: true, images, numAttendees: 0, events: [],
      city: 'Buffalo', addrState: 'NY', isOnline: false,
    },
  };
  // tournament reminders off: nothing asked, nothing sent
  state.tournaments = {
    1: { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, entries: [], userIds: [], tracked: { ...tracked, reminders: false }, reminder: {} },
  };
  let asked = 0;
  mockApi(() => { asked++; return latest; });
  const off = [];
  await tracker.postDmReminders(dmChannel(off));
  assert.equal(asked, 0);
  assert.equal(off.length, 0);

  // the server's registration and roll call posts being off doesn't stop anyone's own DMs
  state.tournaments[1].tracked.reminders = true;
  state.messages = { registration: false, rollcall: false };
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent));
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].data.title, /Starts soon/);
});

test('a tournament with no DM due soon costs no request', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.regDmPings = ['fan'];
  state.startDmPings = ['fan'];
  state.tournaments = {
    1: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 7 * 86400, endAt: now + 7 * 86400 + 3600,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: { deadline: now + 3 * 86400, next: 1 },
    },
    // both already went out for these times, and it's still going
    2: {
      id: 2, name: 'Done', slug: 'tournament/done', startAt: now + 1800, endAt: now + 5400,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: { deadline: now + 1800 }, dmRegSentFor: now + 1800, dmStartSentFor: now + 1800,
    },
  };
  let asked = 0;
  mockApi(() => { asked++; return {}; });
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent));
  assert.equal(asked, 0);
  assert.equal(sent.length, 0);
});

test('the start DM drops the register link once registration is closed', () => {
  const now = Math.floor(Date.now() / 1000);
  const tournament = { id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 3600, city: 'Buffalo', addrState: 'NY', images };
  assert.match(embeds.startReminder({ ...tournament, isRegistrationOpen: true }).data.description, /Register on start\.gg/);
  const closed = embeds.startReminder({ ...tournament, isRegistrationOpen: false }).data.description;
  assert.doesNotMatch(closed, /Register on start\.gg/);
  assert.match(closed, /Tournament page on start\.gg/);
});

test('DMs only go to current server members, keeping leavers opted in', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.regDmPings = ['in-server', 'left-server'];
  state.startDmPings = ['in-server', 'left-server'];
  state.tournaments = {
    1: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: { deadline: now + 1800, next: 4 },
    },
  };
  mockApi(({ query }) => {
    if (query.includes('registrationClosesAt')) {
      return {
        tournament: {
          id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 86400, endAt: now + 90000,
          registrationClosesAt: now + 1800, isRegistrationOpen: true, images, numAttendees: 5, events: [],
          city: 'Buffalo', addrState: 'NY', isOnline: false,
        },
      };
    }
    if (query.includes('participants(')) {
      return { tournament: { participants: { pageInfo: { totalPages: 1 }, nodes: [] } } };
    }
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent, ['in-server']));
  assert.deepEqual(sent.map((each) => each.to), ['in-server']);
  assert.deepEqual(state.regDmPings.toSorted(), ['in-server', 'left-server']);
  assert.deepEqual(state.startDmPings.toSorted(), ['in-server', 'left-server']);
  assert.equal(state.tournaments[1].dmRegSentFor, now + 1800);
});

test('start DMs only go to current server members', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.startDmPings = ['in-server', 'left-server'];
  state.tournaments = {
    1: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: {},
    },
  };
  mockApi(({ query }) => {
    if (query.includes('registrationClosesAt')) {
      return {
        tournament: {
          id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
          registrationClosesAt: now + 1800, isRegistrationOpen: true, images, numAttendees: 5, events: [],
          city: 'Buffalo', addrState: 'NY', isOnline: false,
        },
      };
    }
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent, ['in-server']));
  assert.deepEqual(sent.map((each) => each.to), ['in-server']);
  assert.deepEqual(state.startDmPings.toSorted(), ['in-server', 'left-server']);
  assert.equal(state.tournaments[1].dmStartSentFor, now + 1800);
});

test('a failed membership check sends no DMs and leaves them unsent', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.startDmPings = ['fan'];
  state.tournaments = {
    1: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: {},
    },
  };
  mockApi(({ query }) => {
    if (query.includes('registrationClosesAt')) {
      return {
        tournament: {
          id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
          registrationClosesAt: now + 1800, isRegistrationOpen: true, images, numAttendees: 5, events: [],
          city: 'Buffalo', addrState: 'NY', isOnline: false,
        },
      };
    }
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent, [], true));
  assert.equal(sent.length, 0);
  assert.equal(state.tournaments[1].dmStartSentFor, undefined);
});

test('no DMs go out without a server to check membership against', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.startDmPings = ['fan'];
  state.tournaments = {
    1: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: {},
    },
  };
  let asked = 0;
  mockApi(() => {
    asked++;
    return {
      tournament: {
        id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
        registrationClosesAt: now + 1800, isRegistrationOpen: true, images, numAttendees: 5, events: [],
        city: 'Buffalo', addrState: 'NY', isOnline: false,
      },
    };
  });
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent, null));
  assert.equal(sent.length, 0);
  assert.equal(asked, 0);
  assert.equal(state.tournaments[1].dmStartSentFor, undefined);
});

test('someone who leaves while start.gg answers gets no DM', async () => {
  reset();
  const now = Math.floor(Date.now() / 1000);
  state.startDmPings = ['stays', 'leaves'];
  state.tournaments = {
    1: {
      id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
      entries: [], userIds: [], tracked: { ...tracked }, reminder: {},
    },
  };
  const inServer = ['stays', 'leaves'];
  mockApi(({ query }) => {
    if (query.includes('registrationClosesAt')) {
      // they leave in the time start.gg takes to answer
      inServer.splice(inServer.indexOf('leaves'), 1);
      return {
        tournament: {
          id: 1, name: 'Local', slug: 'tournament/local', startAt: now + 1800, endAt: now + 5400,
          registrationClosesAt: now + 1800, isRegistrationOpen: true, images, numAttendees: 5, events: [],
          city: 'Buffalo', addrState: 'NY', isOnline: false,
        },
      };
    }
    throw new Error(`no fake for ${query.slice(0, 60)}`);
  });
  const sent = [];
  await tracker.postDmReminders(dmChannel(sent, inServer));
  assert.deepEqual(sent.map((each) => each.to), ['stays']);
  assert.equal(state.tournaments[1].dmStartSentFor, now + 1800);
});
