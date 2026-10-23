import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { predict } from '../src/predict.js';
import { singles } from '../src/startgg.js';

// replays /predict on sets the tracked players already played against each other, each one with only what
// happened before it, and says how well the odds held up. run it after changing a constant in predict.js:
//
//   node --env-file=.env scripts/backtest.js --save data/backtest.json   fetch once from start.gg, then score
//   node scripts/backtest.js --load data/backtest.json                    score again, no requests
//
// fetching uses the bot's start.gg token and queue, so it shares the 80 a minute with a deployed copy. save
// once and load after. the october 2026 run behind predict.js's priors was 368 sets, with a script that
// wasn't kept. this is a rebuild, so its numbers won't match that run exactly

// the same 600 sets per player /predict reads, 40 a page
const PAGES = 15;
// how sure the favourite was, for the calibration table
const BUCKETS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

// every singles set between two of these players once, oldest first, with the odds predict gave side 0
// from the sets each of them had finished before it. histories is playerId => { player, sets, events },
// sets newest first the way getSetHistory pages come, events from getEventHistory or null
export function backtest(histories) {
  const pool = new Map([...histories].map(([id, each]) => [String(id), each]));
  const seen = new Set();
  const between = [];
  for (const { player, sets } of pool.values()) {
    for (const { set, them } of singles(sets, player)) {
      const other = pool.get(String(them.playerIds[0]));
      if (!other || seen.has(set.id) || !set.completedAt) continue;
      seen.add(set.id);
      between.push(set);
    }
  }
  between.sort((x, y) => x.completedAt - y.completedAt);

  const results = [];
  for (const set of between) {
    const [a, b] = set.sides.map((side) => pool.get(String(side.playerIds[0])));
    // a second before it finished, so neither the set nor its result counts toward its own odds
    const now = set.completedAt - 1;
    const before = (list) => list.filter((each) => each.completedAt && each.completedAt <= now);
    const started = (events) => events?.filter(({ event }) => event.startAt <= now) ?? undefined;
    const odds = predict(a.player, b.player, before(a.sets), before(b.sets), {
      game: set.event.videogame?.displayName, now, eventsA: started(a.events), eventsB: started(b.events),
    });
    if (!odds) continue;
    results.push({ setId: set.id, at: set.completedAt, a: a.player.tag, b: b.player.tag, chance: odds.chance, won: set.winnerId === set.sides[0].id, game: odds.game });
  }
  return results;
}

// log loss and brier score against a coin flip, how often the favourite won, and the calibration by how
// sure the favourite was. log loss under 0.693 beats always saying 50%
export function score(results) {
  const n = results.length;
  if (!n) return { n, logLoss: null, brier: null, favouriteWon: null, buckets: [] };
  // clamped so one 0% that loses can't make it infinite
  const p = (result) => Math.min(1 - 1e-9, Math.max(1e-9, result.won ? result.chance : 1 - result.chance));
  const logLoss = -results.reduce((sum, result) => sum + Math.log(p(result)), 0) / n;
  const brier = results.reduce((sum, result) => sum + ((result.won ? 1 : 0) - result.chance) ** 2, 0) / n;
  // from whoever the odds favoured, so 30% for a set the other player won counts as 70% and right
  const favourite = results.map((result) => ({
    chance: Math.max(result.chance, 1 - result.chance),
    won: result.chance >= 0.5 ? result.won : !result.won,
  }));
  const buckets = BUCKETS.slice(0, -1).map((low, i) => {
    const high = BUCKETS[i + 1];
    const inside = favourite.filter(({ chance }) => chance >= low && (chance < high || (high === 1 && chance <= 1)));
    return {
      low, high, n: inside.length,
      said: inside.length ? inside.reduce((sum, each) => sum + each.chance, 0) / inside.length : null,
      won: inside.length ? inside.filter((each) => each.won).length / inside.length : null,
    };
  });
  return { n, logLoss, brier, favouriteWon: favourite.filter((each) => each.won).length / n, buckets };
}

const pct = (value) => (value == null ? '-' : `${(value * 100).toFixed(1)}%`);

export function report({ n, logLoss, brier, favouriteWon, buckets }) {
  if (!n) return 'No sets between two of these players had anything to predict with.';
  const lines = [
    `${n} sets`,
    `log loss ${logLoss.toFixed(4)} (coin flip 0.6931)`,
    `brier ${brier.toFixed(4)} (coin flip 0.2500)`,
    `favourite won ${pct(favouriteWon)}`,
    '',
    'favourite said   sets   said   won',
    ...buckets.map((bucket) => {
      const range = `${pct(bucket.low).padStart(6)}-${pct(bucket.high).padEnd(7)}`;
      return `${range} ${String(bucket.n).padStart(5)}  ${pct(bucket.said).padStart(6)} ${pct(bucket.won).padStart(6)}`;
    }),
  ];
  return lines.join('\n');
}

// tracked players from a state file, every server's in a multi-server one, once each
function trackedPlayers(file) {
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const lists = [saved.players ?? {}, ...Object.values(saved.guilds ?? {}).map((guild) => guild.players ?? {})];
  const players = new Map();
  for (const list of lists) {
    for (const player of Object.values(list)) {
      if (player.playerId) players.set(String(player.playerId), player);
    }
  }
  return [...players.values()];
}

async function fetchHistories(players) {
  const startgg = await import('../src/startgg.js');
  const histories = new Map();
  for (const player of players) {
    const sets = [];
    for (let page = 1; page <= PAGES; page++) {
      const { sets: found, totalPages } = await startgg.getSetHistory(player.playerId, page);
      sets.push(...found);
      if (page >= totalPages) break;
    }
    const events = player.userId ? await startgg.getEventHistory(player.userId).catch(() => null) : null;
    const { playerId, userId, tag, slug } = player;
    histories.set(String(playerId), { player: { playerId, userId, tag, slug }, sets, events });
    console.error(`${player.tag}: ${sets.length} sets`);
  }
  return histories;
}

async function main(args) {
  const option = (name) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? null : args[at + 1];
  };
  let histories;
  if (option('load')) {
    histories = new Map(Object.entries(JSON.parse(readFileSync(option('load'), 'utf8'))));
  } else {
    if (!process.env.STARTGG_TOKEN) throw new Error('STARTGG_TOKEN isn\'t set. run it with --env-file=.env, or --load a saved file');
    const stateFile = option('state') ?? `${process.env.STATE_DIR ?? 'data'}/state.json`;
    const players = trackedPlayers(stateFile);
    console.error(`fetching ${players.length} tracked players from ${stateFile}`);
    histories = await fetchHistories(players);
    if (option('save')) writeFileSync(option('save'), JSON.stringify(Object.fromEntries(histories)));
  }
  console.log(report(score(backtest(histories))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
