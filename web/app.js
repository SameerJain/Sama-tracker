// samatracker reads the bundle web/build.mjs makes, so it needs no discord or start.gg token. slippi
// lookups go from the browser straight to slippi.gg, which needs no login. the bundle math is in
// stats.js, loaded first
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// same cutoffs as the bot (src/slippi.js, slippi.gg's own numbers). a daily
// leaderboard placement is what makes a master rating grandmaster
const TIERS = [
  ['Bronze 1', -Infinity], ['Bronze 2', 765.43], ['Bronze 3', 913.72],
  ['Silver 1', 1054.87], ['Silver 2', 1188.88], ['Silver 3', 1315.75],
  ['Gold 1', 1435.48], ['Gold 2', 1548.07], ['Gold 3', 1653.52],
  ['Platinum 1', 1751.83], ['Platinum 2', 1843], ['Platinum 3', 1927.03],
  ['Diamond 1', 2003.92], ['Diamond 2', 2073.67], ['Diamond 3', 2136.28],
  ['Master 1', 2191.75], ['Master 2', 2275], ['Master 3', 2350],
];
const rankOf = ({ rating, updates, global, regional }) => {
  if (!updates) return 'Unranked';
  if (updates < 5) return 'Pending';
  if (rating >= 2191.75 && (global || regional)) return 'Grandmaster';
  return TIERS.filter(([, min]) => rating >= min).at(-1)[0];
};
// ABCD#123, abcd-123 or a slippi.gg/user/abcd-123 link, as ABCD#123
const readCode = (input) => {
  const m = String(input).trim().match(/(?:^|[^a-z0-9])([a-z0-9]{1,8})[#-](\d{1,7})\/?$/i);
  return m ? `${m[1].toUpperCase()}#${m[2]}` : null;
};
// FOX is Fox. these are the ones that aren't one word
const CHARACTERS = {
  CAPTAIN_FALCON: 'Captain Falcon', DONKEY_KONG: 'Donkey Kong', GAME_AND_WATCH: 'Mr. Game & Watch', ICE_CLIMBERS: 'Ice Climbers',
  YOUNG_LINK: 'Young Link', DR_MARIO: 'Dr. Mario',
};
const charName = (id) => CHARACTERS[id] ?? id.charAt(0) + id.slice(1).toLowerCase();

let BUNDLE = null;
const byId = (id) => BUNDLE?.players.find((p) => p.id === id) ?? null;

// /link and /track, kept in this browser only: who you are, who you follow
const meKey = 'samatracker-me', followKey = 'samatracker-followed';
const readMe = () => { try { return localStorage.getItem(meKey); } catch { return null; } };
const readFollowed = () => { try { return JSON.parse(localStorage.getItem(followKey)) ?? []; } catch { return []; } };
const writeFollowed = (ids) => localStorage.setItem(followKey, JSON.stringify(ids));

async function load() {
  try {
    const res = await fetch('data/buffalo.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    BUNDLE = await res.json();
  } catch {
    $('series-summary').textContent = 'No cached bundle yet. Run node web/build.mjs, then redeploy this page.';
    return;
  }
  $('built').textContent = ` (built ${BUNDLE.built})`;
  $('series-summary').textContent = BUNDLE.series.map((s) => `${s.name}: ${s.tournaments} tournaments${s.distinctPlayers ? `, ${s.distinctPlayers} players` : ''}`).join(' · ');
  renderStatus();
  renderBoth();
  renderLeaders();
  renderRecent();
  renderFollowed();
  renderWatch();
  // head-to-head starts with you when you've said who you are
  if (readMe() && byId(readMe())) { h2hA = readMe(); renderH2HPicks(); renderH2H(); }
}

function renderStatus() {
  const tournaments = BUNDLE.series.reduce((s, x) => s + x.tournaments, 0);
  const counts = `${tournaments} tournaments · ${BUNDLE.players.length} players · ${BUNDLE.events.length} finals recorded`;
  $('status-line').innerHTML = `<small>Cached ${esc(BUNDLE.built)} · ${counts}. New tournaments join the next scrape; everything else on this page is instant.</small>`;
}

function renderBoth() {
  const rows = BUNDLE.bothSeries.slice(0, 20).map((r, i) =>
    `<tr><td>${i + 1}</td><td>${esc(r.tag)}</td><td>${r.totalEvents}</td><td>${r.totalWins}</td></tr>`).join('');
  $('both-tbl').innerHTML = '<tr><th>#</th><th>Player</th><th>Combined events</th><th>Combined wins</th></tr>' + rows;
}

function renderLeaders() {
  $('leaders-tbls').innerHTML = BUNDLE.series.map((s) =>
    `<h3>${esc(s.name)}</h3><div class="scroll"><table><tr><th>#</th><th>Player</th><th>1st</th><th>Top 4s</th></tr>${
      s.topWinners.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.tag)}</td><td>${w.wins}</td><td>${w.podiums}</td></tr>`).join('')
    }</table></div>`).join('');
}

function renderRecent() {
  const all = BUNDLE.series.flatMap((s) => s.recent.map((t) => ({ ...t, series: s.short })));
  all.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $('recent-tbl').innerHTML = '<tr><th>Date</th><th>Tournament</th><th>Att.</th><th>Winner</th></tr>' + all.slice(0, 10).map((t) =>
    `<tr><td>${esc(t.date)}</td><td><a href="${esc(t.url)}">${esc(t.name)}</a></td><td>${t.attendees}</td><td>${t.winner ? esc(t.winner) : '<i>unknown</i>'}</td></tr>`).join('');
}

const tlink = (tid) => {
  const t = BUNDLE.tmap[tid];
  return t ? `${t.d} <a href="${esc(t.u)}">${esc(t.n)}</a>` : 'unknown tournament';
};

// player lookup: the cached read-only stand-in for /stats and /characters.
// a hit opens the full card, which is where follow, me and H2H live
$('q').addEventListener('input', () => {
  const out = $('player');
  $('hits').innerHTML = '';
  if (!BUNDLE) return;
  const hits = SamaStats.searchPlayers(BUNDLE.players, $('q').value);
  if (!hits.length) {
    if ($('q').value.trim()) out.innerHTML = `<p>No cached player matches “${esc($('q').value.trim())}”. Tags come from start.gg player ids, merged across aliases.</p>`;
    return;
  }
  if (hits.length === 1 && hits[0].tag.toLowerCase() === $('q').value.trim().toLowerCase()) { renderPlayer(hits[0].id); return; }
  $('hits').innerHTML = hits.map((p) => `<button type="button" class="hitbtn" data-id="${esc(p.id)}">${esc(p.tag)}</button>`).join('');
  $('hits').querySelectorAll('button').forEach((b) => { b.onclick = () => renderPlayer(b.dataset.id); });
});

let selectedId = null;
function renderPlayer(id) {
  const p = byId(id);
  if (!p) return;
  selectedId = String(id);
  const me = readMe() === p.id;
  const following = readFollowed().includes(p.id);
  const per = BUNDLE.series.map((s) => {
    const r = p.per[s.slug];
    return r ? `<span class="pill ${s.slug === BUNDLE.series[0].slug ? 'u' : 's'}">${esc(s.short)}</span> ${r.events} events, ${r.wins} wins` : null;
  }).filter(Boolean).join(' · ');
  const chars = p.topChars.length ? p.topChars.map((c) => `${esc(c.n)} (${c.g})`).join(' · ') : 'no reported characters';
  const aka = (p.aliases ?? []).filter((a) => a !== p.tag).slice(0, 3);
  const titles = SamaStats.recentTitles(p.id, BUNDLE.events, 5).map((e) => `<div>${tlink(e.t)}</div>`).join('');
  $('player').innerHTML = `<p><b>${esc(p.tag)}</b>${me ? ' <span class="pill u">you</span>' : ''}${aka.length ? `<br><small>aka ${aka.map(esc).join(' · ')}</small>` : ''}</p>`
    + `<p>${per}<br><small>Combined: ${p.totalEvents} events, ${p.totalWins} wins, ${p.totalPodiums} top 4s (1st ${p.totalWins} · 2nd ${p.seconds} · 3rd ${p.thirds} · 4th ${p.fourths}). Cached, not live.</small></p>`
    + `<p><small>Characters: ${chars}<br>First: ${esc(p.first ?? '—')} · Last: ${esc(p.last ?? '—')}</small></p>`
    + (titles ? `<p><small>Latest titles:</small>${titles}</p>` : '')
    + `<p><button type="button" id="sel-follow">${following ? 'Unfollow' : 'Follow'}</button>`
    + ` <button type="button" id="sel-me">${me ? 'Not me' : 'This is me'}</button>`
    + ' <button type="button" id="sel-h2h">Head-to-head</button></p>';
  $('sel-follow').onclick = () => {
    const ids = readFollowed().filter((x) => x !== p.id);
    if (!following) ids.unshift(p.id);
    writeFollowed(ids.slice(0, 100));
    renderPlayer(p.id);
    renderFollowed();
  };
  $('sel-me').onclick = () => {
    try {
      if (me) localStorage.removeItem(meKey);
      else localStorage.setItem(meKey, p.id);
    } catch {}
    renderPlayer(p.id);
    if (!me && !h2hA) { h2hA = p.id; renderH2HPicks(); renderH2H(); }
  };
  $('sel-h2h').onclick = () => {
    h2hB = p.id;
    const mine = readMe();
    if (!h2hA && mine && mine !== p.id && byId(mine)) h2hA = mine;
    renderH2HPicks();
    renderH2H();
    $('h2h').scrollIntoView();
  };
}

function renderFollowed() {
  const ids = readFollowed().map(String).filter((id) => byId(id));
  $('followed-list').innerHTML = ids.length
    ? ids.sort((a, b) => byId(b).totalEvents - byId(a).totalEvents).map((id) => {
      const p = byId(id);
      const wins = BUNDLE.series.map((s) => (p.per[s.slug] ? `${s.short} ${p.per[s.slug].wins}` : null)).filter(Boolean).join(' · ');
      return `<div class="watch-row"><span><b>${esc(p.tag)}</b> · ${p.totalEvents} events, ${p.totalWins} wins <small>${esc(wins)}</small></span>`
        + `<span><button type="button" data-open="${esc(id)}">Open</button> <button type="button" data-i="${esc(id)}">Remove</button></span></div>`;
    }).join('')
    : '<p><small>Nobody yet. Follow players from their cards.</small></p>';
  $('followed-list').querySelectorAll('button[data-i]').forEach((b) => {
    b.onclick = () => {
      writeFollowed(readFollowed().filter((x) => String(x) !== b.dataset.i));
      renderFollowed();
      if (selectedId === b.dataset.i) renderPlayer(selectedId);
    };
  });
  $('followed-list').querySelectorAll('button[data-open]').forEach((b) => {
    b.onclick = () => { renderPlayer(b.dataset.open); $('search').scrollIntoView(); };
  });
}
// head-to-head: shared tournaments and cached finals. odds need live sets,
// so this card stops where /predict in Discord starts
let h2hA = null, h2hB = null;
for (const [box, side] of [[$('h2h-a'), 'a'], [$('h2h-b'), 'b']]) {
  box.addEventListener('input', () => {
    if (!BUNDLE) return;
    const hits = SamaStats.searchPlayers(BUNDLE.players, box.value, 5);
    renderH2HPicks(hits, side);
  });
}
function renderH2HPicks(hits = null, side = null) {
  const a = h2hA ? byId(h2hA) : null, b = h2hB ? byId(h2hB) : null;
  let html = '';
  if (a) html += `<span class="pill u">${esc(a.tag)}</span> <button type="button" data-clear="a">×</button> `;
  if (b) html += `<span class="pill s">${esc(b.tag)}</span> <button type="button" data-clear="b">×</button>`;
  if (hits?.length && side) html += '<br>' + hits.map((p) => `<button type="button" class="hitbtn" data-pick="${side}" data-id="${esc(p.id)}">${esc(p.tag)}</button>`).join('');
  $('h2h-picks').innerHTML = html || '<small>First side defaults to you once set.</small>';
  $('h2h-picks').querySelectorAll('button[data-clear]').forEach((btn) => {
    btn.onclick = () => { if (btn.dataset.clear === 'a') h2hA = null; else h2hB = null; renderH2HPicks(); renderH2H(); };
  });
  $('h2h-picks').querySelectorAll('button[data-pick]').forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.pick === 'a') h2hA = btn.dataset.id; else h2hB = btn.dataset.id;
      $('h2h-a').value = ''; $('h2h-b').value = '';
      renderH2HPicks(); renderH2H();
    };
  });
}
function renderH2H() {
  const out = $('h2h-out');
  const a = h2hA ? byId(h2hA) : null, b = h2hB ? byId(h2hB) : null;
  if (!a || !b) { out.innerHTML = '<p><small>Pick two tags to compare.</small></p>'; return; }
  if (a.id === b.id) { out.innerHTML = '<p>Pick two different players.</p>'; return; }
  const shared = SamaStats.sharedEvents(a.tids, b.tids, BUNDLE.tmap);
  const finals = SamaStats.finalsBetween(a.id, b.id, BUNDLE.events);
  const aTitles = SamaStats.recentTitles(a.id, BUNDLE.events, 5), bTitles = SamaStats.recentTitles(b.id, BUNDLE.events, 5);
  const titleDates = (titles) => (titles.length ? titles.map((e) => BUNDLE.tmap[e.t]?.d ?? '').join(', ') : 'none cached');
  // every ultimate singles set they played at either series, not only the ones with characters reported
  const rec = SamaStats.setRecord(a.id, b.id, BUNDLE.h2h);
  const record = rec
    ? `<p>Sets <b>${rec.aSets}–${rec.bSets}</b>${rec.scored ? ` · games <b>${rec.aGames}–${rec.bGames}</b>` : ''}</p>`
      + `<p><small>Every Ultimate Singles set they've played at these series, ${rec.sets} in all${rec.last ? `, last on ${esc(rec.last)}` : ''}. DQs don't count. Games come from the ${rec.scored} set${rec.scored === 1 ? '' : 's'} with a score reported.</small></p>`
    : '<p><small>No Ultimate Singles sets against each other at these series.</small></p>';
  out.innerHTML = `<p><b>${esc(a.tag)}</b> vs <b>${esc(b.tag)}</b> · ${shared.length} shared event${shared.length === 1 ? '' : 's'}, ${finals.length} final${finals.length === 1 ? '' : 's'} together</p>`
    + record
    + (finals.length
      ? `<h3>Finals (${finals.length})</h3>` + finals.map((e) => {
        const w = e.w === a.id ? a.tag : b.tag;
        return `<div>${tlink(e.t)} · <b>${esc(w)}</b></div>`;
      }).join('')
      : '<p><small>No finals together in the cached standings.</small></p>')
    + (shared.length ? `<h3>Latest shared events</h3>` + shared.slice(0, 5).map((t) => `<div>${tlink(t)}</div>`).join('') : '')
    + `<h3>Latest titles</h3><p><small>${esc(a.tag)}: ${titleDates(aTitles)}<br>${esc(b.tag)}: ${titleDates(bTitles)}</small></p>`
    + `<p><small>Odds need live set histories, so /predict in Discord has those.</small></p>`;
}

async function slippiLookup(code) {
  const res = await fetch('https://internal.slippi.gg/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'query($code:String){getUser(connectCode:$code){displayName connectCode{code} rankedNetplayProfile{id ratingOrdinal ratingUpdateCount wins losses dailyGlobalPlacement dailyRegionalPlacement characters{character gameCount}}}}',
      variables: { code },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => null);
  const u = body?.data?.getUser;
  if (!u) return null;
  const r = u.rankedNetplayProfile ?? {};
  return {
    name: u.displayName || code,
    code: u.connectCode?.code ?? code,
    rating: r.ratingOrdinal ?? null,
    updates: r.ratingUpdateCount ?? 0,
    wins: r.wins ?? 0,
    losses: r.losses ?? 0,
    rank: rankOf({ rating: r.ratingOrdinal ?? 0, updates: r.ratingUpdateCount ?? 0, global: r.dailyGlobalPlacement, regional: r.dailyRegionalPlacement }),
    characters: (r.characters ?? []).filter((c) => c.gameCount > 0).map((c) => `${charName(c.character)} (${c.gameCount})`).sort().slice(0, 3),
  };
}

$('lookup').onclick = async () => {
  const out = $('slippi-out');
  const code = readCode($('code').value);
  if (!code) { out.innerHTML = '<p>That isn’t a connect code. Try ABCD#123.</p>'; return; }
  out.innerHTML = '<p><small>Asking slippi.gg…</small></p>';
  let p;
  try {
    p = await slippiLookup(code);
  } catch {
    p = null;
  }
  if (!p) {
    out.innerHTML = `<p>No Slippi profile answered for ${esc(code)}. This browser may block the request, or Slippi may be down. You can <a href="https://slippi.gg/user/${esc(code.replace('#', '-'))}">try slippi.gg directly</a>.</p>`;
    return;
  }
  const record = `${p.wins}–${p.losses} this season`;
  out.innerHTML = `<p><span class="rank">${esc(p.rank)}</span> <b>${esc(p.name)}</b> (${esc(p.code)})`
    + (p.rating != null ? ` · ${Math.round(p.rating)} rating, ${esc(record)}` : ` · ${esc(record)}, unrated so far`)
    + (p.characters.length ? `<br><small>${esc(p.characters.join(' · '))}</small>` : '')
    + `<br><button id="addwatch" type="button">Add to watchlist</button></p>`;
  $('addwatch').onclick = () => addWatch(p);
};

const watchKey = 'samatracker-slippi-watch';
const readWatch = () => { try { return JSON.parse(localStorage.getItem(watchKey)) ?? []; } catch { return []; } };
const writeWatch = (w) => localStorage.setItem(watchKey, JSON.stringify(w));

function addWatch(p) {
  const w = readWatch().filter((e) => e.code !== p.code);
  w.unshift({ code: p.code, name: p.name, rank: p.rank, rating: p.rating, at: new Date().toISOString().slice(0, 10) });
  writeWatch(w.slice(0, 50));
  renderWatch();
}

function renderWatch() {
  const w = readWatch().sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  $('watch').innerHTML = w.length
    ? w.map((e) => {
      const rating = e.rating != null ? ` · ${Math.round(e.rating)}` : '';
      return `<div class="watch-row"><span><span class="rank">${esc(e.rank)}</span> <b>${esc(e.name)}</b> (${esc(e.code)})${rating} <small>added ${esc(e.at)}</small></span>`
        + `<button type="button" data-i="${esc(e.code)}">Remove</button></div>`;
    }).join('')
    : '<p><small>Nothing yet. Look someone up, then add them.</small></p>';
  $('watch').querySelectorAll('button[data-i]').forEach((b) => {
    b.onclick = () => { writeWatch(readWatch().filter((e) => e.code !== b.dataset.i)); renderWatch(); };
  });
}

// dark mode, same as the series pages
const darkBtn = $('darkbtn');
function setDark(on) {
  document.body.classList.toggle('dark', on);
  darkBtn.textContent = on ? '☀️ light' : '🌙 dark';
  try { localStorage.setItem('dark', on ? '1' : '0'); } catch {}
}
try { if (localStorage.getItem('dark') === '1') setDark(true); } catch {}
darkBtn.onclick = () => setDark(!document.body.classList.contains('dark'));

load();
