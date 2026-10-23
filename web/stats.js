// bundle math with no dom, for app.js and the tests. it sets a global instead of exporting, so it
// loads as a plain script, even from file://, and as an import
(function () {
  // tournament ids both entered, newest first (tmap gives each id its date)
  function sharedEvents(a, b, tmap) {
    const inB = new Set(b);
    return a.filter((t) => inB.has(t)).sort((x, y) => String(tmap[y]?.d ?? '').localeCompare(String(tmap[x]?.d ?? '')));
  }
  // ultimate finals where the two met. event rows are { t, w, r } (ids, null
  // when unreported), bundled oldest first
  function finalsBetween(aId, bId, events) {
    return events.filter((e) => (e.w === aId && e.r === bId) || (e.w === bId && e.r === aId));
  }
  // latest titles for one player, newest first, capped
  function recentTitles(id, events, n = 5) {
    return events.filter((e) => e.w === id).slice(-n).reverse();
  }
  // tag search over unified players, exact then starts-with then contains
  function searchPlayers(players, q, limit = 8) {
    const needle = String(q ?? '').trim().toLowerCase();
    if (!needle) return [];
    const starts = [], contains = [];
    for (const p of players) {
      const tag = p.tag.toLowerCase();
      if (tag === needle) return [p];
      if (tag.startsWith(needle)) starts.push(p);
      else if (tag.includes(needle)) contains.push(p);
    }
    return [...starts, ...contains].slice(0, limit);
  }
  // every ultimate singles set the two played, from a's side. the bundle keys each pair by both ids, lower
  // first, and games only come from sets with a score. null when they never played
  function setRecord(aId, bId, h2h) {
    const flip = String(bId) < String(aId);
    const row = h2h?.[flip ? `${bId}|${aId}` : `${aId}|${bId}`];
    if (!row) return null;
    const [loSets, hiSets, loGames, hiGames, scored, last] = row;
    return flip
      ? { sets: loSets + hiSets, aSets: hiSets, bSets: loSets, aGames: hiGames, bGames: loGames, scored, last }
      : { sets: loSets + hiSets, aSets: loSets, bSets: hiSets, aGames: loGames, bGames: hiGames, scored, last };
  }
  globalThis.SamaStats = { sharedEvents, finalsBetween, recentTitles, searchPlayers, setRecord };
})();
