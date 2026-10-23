// the svg charts on the series pages
import { esc } from './page.mjs';

const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// a wide invisible stroke over a thin line, so it's easy to hover and click
const HIT = 'stroke="rgba(0,0,0,0)" stroke-width="12" style="pointer-events:stroke;cursor:crosshair"';

// horizontal bars. every bar is clickable: data-x is its label, data-y its shown
// value, so a click can read both out. keyFn(item) -> WININFO key adds the list under it.
export function hbars(items, { width = 640, barH = 20, gap = 7, labelW = 170, valueFn, keyFn } = {}) {
  const H = items.length * (barH + gap) + 14;
  const max = Math.max(...items.map((it) => it.value));
  const bw = width - labelW - 70;
  // viewBox plus the .scroll svg CSS lets small screens scale the chart
  // down instead of scrolling sideways; the width/height stay for desktop
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" font-family="system-ui,sans-serif" font-size="12">`;
  items.forEach((it, i) => {
    const y = 8 + i * (barH + gap);
    const w = Math.max(2, (it.value / max) * bw);
    const key = keyFn ? keyFn(it) : null;
    const shown = valueFn ? valueFn(it) : String(it.value);
    s += `<g class="hbar" data-v="${it.value}"><text x="0" y="${y + barH - 5}">${esc(it.label)}</text>`;
    s += `<rect x="${labelW}" y="${y}" width="${w}" height="${barH}" rx="3" fill="${it.color || '#4c78a8'}"`
      + ` data-x="${esc(it.label)}" data-y="${esc(shown)}"${key ? ` data-k="${esc(key)}"` : ''} class="clickable" style="cursor:pointer">`
      + `<title>${esc(it.label)} — ${esc(shown)}</title></rect>`;
    s += `<text x="${labelW + w + 6}" y="${y + barH - 5}" fill="#222">${esc(shown)}</text></g>`;
  });
  return s + '</svg>';
}

// the bar chart the page shows: html rows, so a phone cuts a long label short instead of shrinking
// the whole chart. same click data as hbars, which still draws the images/ files. valueW is the room
// in em left for the value
export function barList(items, { labelW = 170, valueW = 4.5, valueFn, keyFn } = {}) {
  if (!items.length) return '';
  const max = Math.max(...items.map((it) => it.value)) || 1;
  const rows = items.map((it) => {
    const key = keyFn ? keyFn(it) : null;
    const shown = valueFn ? valueFn(it) : String(it.value);
    const frac = Math.max(0, it.value / max).toFixed(4);
    const fill = `<span class="bar-f clickable" style="width:calc((100% - ${valueW}em) * ${frac});background:${it.color || '#4c78a8'}"`
      + ` data-x="${esc(it.label)}" data-y="${esc(shown)}"${key ? ` data-k="${esc(key)}"` : ''} title="${esc(it.label)} — ${esc(shown)}"></span>`;
    return `<div class="bar"><span class="bar-l" title="${esc(it.label)}">${esc(it.label)}</span>`
      + `<span class="bar-t">${fill}<span class="bar-v">${esc(shown)}</span></span></div>`;
  }).join('');
  return `<div class="bars" style="--lw:${labelW}px">${rows}</div>`;
}

// academic year (Aug 1 to Jun 1) starting year for a timestamp; Jun/Jul counts as the year just ended
export function academicStartYear(ts) {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  return m >= 7 ? y : y - 1;
}

// least-squares line through the attendance, as attendees = a + b * (startAt - from). denom is 0 when every
// point is on the same day, which has no slope
function fit(points, from) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) { const dx = p.startAt - from; sx += dx; sy += p.attendees; sxx += dx * dx; sxy += dx * p.attendees; }
  const n = points.length;
  const denom = n * sxx - sx * sx;
  const b = (n * sxy - sx * sy) / denom;
  return { a: (sy - b * sx) / n, b, denom };
}

// attendance over time, data sorted by startAt. the layers carry s-raw, s-avg, s-whole and s-year
// classes for the page toggles, and 'academic' fits the yearly lines to Aug through May. compact is the
// phone version, with a bigger font and the legend stacked so nothing runs off the edge
export function line(data, { width = 900, height = 260, period = 'calendar', compact = false } = {}) {
  const padL = compact ? 34 : 44, padB = 26, padT = compact ? 62 : 56, padR = 10;
  const xs = data.map((d) => d.startAt), ys = data.map((d) => d.attendees);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys);
  const X = (x) => padL + ((x - x0) / Math.max(1, x1 - x0)) * (width - padL - padR);
  const Y = (y) => padT + (1 - y / y1) * (height - padT - padB);
  // the axis scale rides on the svg so the page can turn a hover position
  // back into an X (date) and Y (value) for its line tooltip
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="system-ui,sans-serif" font-size="${compact ? 12 : 11}"`
    + ` data-x0="${x0}" data-x1="${x1}" data-ymax="${y1}" data-padl="${padL}" data-padr="${padR}" data-padt="${padT}" data-padb="${padB}"`
    + ` viewBox="0 0 ${width} ${height}">`;
  for (let g = 0; g <= 4; g++) {
    const v = Math.round((y1 * g) / 4);
    s += `<line x1="${padL}" y1="${Y(v)}" x2="${width - padR}" y2="${Y(v)}" stroke="#ddd"/><text x="4" y="${Y(v) + 4}" fill="#666">${v}</text>`;
  }
  // quarterly grid: years labelled, Jul dashed, other quarters dotted
  const y0 = new Date(x0 * 1000).getUTCFullYear(), y1y = new Date(x1 * 1000).getUTCFullYear();
  for (let y = y0; y <= y1y; y++) {
    for (let q = 0; q < 4; q++) {
      const ts = Date.UTC(y, q * 3, 1) / 1000;
      if (ts < x0 || ts > x1) continue;
      const grid = `<line x1="${X(ts)}" y1="${padT}" x2="${X(ts)}" y2="${height - padB}"`;
      if (q === 0) s += `${grid} stroke="#bbb" stroke-dasharray="3,3"/><text x="${X(ts) + 3}" y="${height - 10}" fill="#666">${y}</text>`;
      else if (q === 2) s += `${grid} stroke="#ccc" stroke-dasharray="3,3"/>`;
      else s += `${grid} stroke="#e3e3e3" stroke-dasharray="1,3"/>`;
    }
  }
  // raw attendance + max marker, grouped for toggling
  const rawPts = data.map((d) => `${X(d.startAt).toFixed(1)},${Y(d.attendees).toFixed(1)}`).join(' ');
  const m = data.reduce((a, b) => (b.attendees > a.attendees ? b : a));
  const mx = X(m.startAt), my = Y(m.attendees);
  const label = `max ${m.attendees} · ${trunc(m.name, compact ? 30 : 40)} (${m.date})`;
  const anchorRight = mx > width - 320;
  s += `<g class="s-raw"><polyline fill="none" stroke="#4c78a8" stroke-width="1.6" points="${rawPts}"/>`
    + `<polyline class="hit" data-series="attendance" fill="none" ${HIT} points="${rawPts}"/>`;
  for (const d of data) {
    s += `<circle class="dot" cx="${X(d.startAt).toFixed(1)}" cy="${Y(d.attendees).toFixed(1)}" r="3" fill="#4c78a8"`
      + ` data-x="${esc(d.date)}" data-y="${esc(d.attendees)}" data-name="${esc(d.name)}" style="cursor:pointer">`
      + `<title>${esc(`${d.attendees} attendees — ${d.name} (${d.date})`)}</title></circle>`;
  }
  s += `<circle cx="${mx}" cy="${my}" r="4" fill="#e45756"/>`;
  if (compact) s += `<text x="4" y="50" fill="#e45756">${esc(label)}</text></g>`;
  else s += `<text x="${anchorRight ? mx - 8 : mx + 8}" y="${Math.max(12, my - 8)}" fill="#e45756" text-anchor="${anchorRight ? 'end' : 'start'}">${esc(label)}</text></g>`;
  // rolling-average trend over the whole series
  const W = data.length > 100 ? 10 : 5;
  const tpts = data.map((d, i) => {
    const win = data.slice(Math.max(0, i - W + 1), i + 1);
    return `${X(d.startAt).toFixed(1)},${Y(win.reduce((a, t) => a + t.attendees, 0) / win.length).toFixed(1)}`;
  }).join(' ');
  s += `<polyline class="s-avg" fill="none" stroke="#f28e2b" stroke-width="2" stroke-dasharray="6,3" points="${tpts}"/>`
    + `<polyline class="hit s-avg" data-series="${W}-tournament average" fill="none" ${HIT} points="${tpts}"/>`;
  // straight least-squares line over the whole period
  const whole = fit(data, x0);
  const clampY = (v) => Math.max(0, Math.min(y1, v));
  const ends = `x1="${X(x0)}" y1="${Y(clampY(whole.a))}" x2="${X(x1)}" y2="${Y(clampY(whole.a + whole.b * (x1 - x0)))}"`;
  s += `<line class="s-whole" ${ends} stroke="#9467bd" stroke-width="2"/><line class="hit s-whole" data-series="straight-line trend (whole)" ${ends} ${HIT}/>`;
  // per-year straight segments: same least-squares fit as the whole line, one per
  // year, drawn across the year's span with a triangle at each end
  s += '<g class="s-year">';
  const byYear = {};
  for (const d of data) {
    const y = period === 'academic' ? academicStartYear(d.startAt) : new Date(d.startAt * 1000).getUTCFullYear();
    (byYear[y] ??= []).push(d);
  }
  for (const [yr, pts] of Object.entries(byYear)) {
    pts.sort((a, b) => a.startAt - b.startAt);
    if (pts.length < 2) continue;
    const xa = pts[0].startAt;
    const year = fit(pts, xa);
    if (!year.denom) continue;
    const spanStart = period === 'academic' ? Date.UTC(Number(yr), 7, 1) / 1000 : Date.UTC(Number(yr), 0, 1) / 1000;
    const spanEnd = period === 'academic' ? Date.UTC(Number(yr) + 1, 5, 1) / 1000 : Date.UTC(Number(yr), 11, 31) / 1000;
    const sx = Math.max(x0, spanStart), ex = Math.min(x1, spanEnd);
    if (ex <= sx) continue;
    const ya = Y(clampY(year.a + year.b * (sx - xa))), yb = Y(clampY(year.a + year.b * (ex - xa)));
    const X1 = X(sx).toFixed(1), X2 = X(ex).toFixed(1), Y1 = ya.toFixed(1), Y2 = yb.toFixed(1);
    const span = period === 'academic' ? `${yr}–${String(Number(yr) + 1).slice(2)}` : yr;
    s += `<line x1="${X1}" y1="${Y1}" x2="${X2}" y2="${Y2}" stroke="#2ca02a" stroke-width="2"/>`
      + `<line class="hit" data-series="straight-line trend (${span})" x1="${X1}" y1="${Y1}" x2="${X2}" y2="${Y2}" ${HIT}/>`;
    s += `<polygon points="${X1},${(ya - 6).toFixed(1)} ${(X(sx) - 5).toFixed(1)},${(ya + 4).toFixed(1)} ${(X(sx) + 5).toFixed(1)},${(ya + 4).toFixed(1)}" fill="#2ca02a"/>`;
    s += `<polygon points="${X2},${(yb - 6).toFixed(1)} ${(X(ex) - 5).toFixed(1)},${(yb + 4).toFixed(1)} ${(X(ex) + 5).toFixed(1)},${(yb + 4).toFixed(1)}" fill="#2ca02a"/>`;
  }
  s += '</g>';
  if (compact) {
    const mid = Math.round(width / 2);
    s += `<text x="4" y="14" fill="#4c78a8">— attendance</text><text x="${mid}" y="14" fill="#f28e2b">- - ${W}-tournament avg</text>`;
    s += `<text x="4" y="32" fill="#9467bd">— trend, whole run</text><text x="${mid}" y="32" fill="#2ca02a">▲ trend each year ▲</text>`;
  } else {
    s += `<text x="${padL}" y="14" fill="#4c78a8">— attendance</text><text x="${padL + 105}" y="14" fill="#f28e2b">- - ${W}-tournament average</text>`;
    s += `<text x="${padL}" y="32" fill="#9467bd">— straight-line trend (whole)</text><text x="${padL + 200}" y="32" fill="#2ca02a">▲ straight-line trend (each year) ▲</text>`;
  }
  return { svg: s + '</svg>', slopePerYear: (whole.b * 365.25 * 24 * 3600) || 0 };
}

// distinct players ever, as a step line since it only goes up at each edition. compact is the
// phone version, like line()
export function growthLine(points, { width = 900, height = 240, compact = false } = {}) {
  if (!points.length) return '';
  const padL = compact ? 34 : 44, padB = 26, padT = 30, padR = 10;
  const x0 = points[0].startAt, x1 = points[points.length - 1].startAt, y1 = Math.max(...points.map((p) => p.total));
  const X = (x) => padL + ((x - x0) / Math.max(1, x1 - x0)) * (width - padL - padR);
  const Y = (y) => padT + (1 - y / y1) * (height - padT - padB);
  // the axis scale rides on the svg so the page can turn a hover position
  // back into an X (date) and Y (value) for its line tooltip
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui,sans-serif"`
    + ` font-size="${compact ? 12 : 11}" data-x0="${x0}" data-x1="${x1}" data-ymax="${y1}" data-padl="${padL}" data-padr="${padR}" data-padt="${padT}" data-padb="${padB}">`;
  for (let g = 0; g <= 4; g++) {
    const v = Math.round((y1 * g) / 4);
    s += `<line x1="${padL}" y1="${Y(v)}" x2="${width - padR}" y2="${Y(v)}" stroke="#ddd"/><text x="4" y="${Y(v) + 4}" fill="#666">${v}</text>`;
  }
  const y0 = new Date(x0 * 1000).getUTCFullYear(), y1y = new Date(x1 * 1000).getUTCFullYear();
  for (let y = y0; y <= y1y; y++) {
    const ts = Date.UTC(y, 0, 1) / 1000;
    if (ts < x0 || ts > x1) continue;
    s += `<line x1="${X(ts)}" y1="${padT}" x2="${X(ts)}" y2="${height - padB}" stroke="#bbb" stroke-dasharray="3,3"/>`
      + `<text x="${X(ts) + 3}" y="${height - 10}" fill="#666">${y}</text>`;
  }
  let d = `M ${X(x0).toFixed(1)},${Y(points[0].total).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += ` H ${X(points[i].startAt).toFixed(1)} V ${Y(points[i].total).toFixed(1)}`;
  s += `<path d="${d}" fill="none" stroke="#9467bd" stroke-width="2"/><path class="hit" data-series="distinct players ever" d="${d}" fill="none" ${HIT}/>`;
  for (const p of points) {
    const title = `${p.total} distinct players ever (+${p.newPlayers} new) — ${p.name ?? ''} (${p.date ?? ''})`;
    s += `<circle class="dot" cx="${X(p.startAt).toFixed(1)}" cy="${Y(p.total).toFixed(1)}" r="3" fill="#9467bd"`
      + ` data-x="${esc(p.date ?? '')}" data-y="${esc(p.total)}" data-name="${esc(p.name ?? '')}" style="cursor:pointer"><title>${esc(title)}</title></circle>`;
  }
  const last = points[points.length - 1];
  s += `<text x="${padL}" y="14" fill="#9467bd">— distinct players ever (${last.total})</text>`;
  return s + '</svg>';
}
