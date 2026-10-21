// Shared SVG chart helpers for series viewers. No dependencies.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// horizontal bars. keyFn(item) -> WININFO key makes the bar clickable.
export function hbars(items, { width = 640, barH = 20, gap = 7, labelW = 170, valueFn, keyFn } = {}) {
  const H = items.length * (barH + gap) + 14;
  const max = Math.max(...items.map((it) => it.value));
  const bw = width - labelW - 70;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" font-family="system-ui,sans-serif" font-size="12">`;
  items.forEach((it, i) => {
    const y = 8 + i * (barH + gap);
    const w = Math.max(2, (it.value / max) * bw);
    const key = keyFn ? keyFn(it) : null;
    s += `<g class="hbar" data-v="${it.value}"><text x="0" y="${y + barH - 5}">${esc(it.label)}</text>`;
    s += `<rect x="${labelW}" y="${y}" width="${w}" height="${barH}" rx="3" fill="${it.color || '#4c78a8'}"${key ? ` data-k="${esc(key)}" class="clickable" style="cursor:pointer"` : ''}/>`;
    s += `<text x="${labelW + w + 6}" y="${y + barH - 5}" fill="#222">${esc(valueFn ? valueFn(it) : String(it.value))}</text></g>`;
  });
  return s + '</svg>';
}

// academic year (Aug 1 to Jun 1) starting year for a timestamp; Jun/Jul counts as the year just ended
export function academicStartYear(ts) {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  return m >= 7 ? y : y - 1;
}

// attendance over time. data = [{ startAt, attendees, name, date }] sorted by startAt.
// layers carry s-raw / s-avg / s-whole / s-year classes for the page toggles.
// period 'academic': yearly segments fit Aug 1 to Jun 1 windows instead of calendar years.
export function line(data, { width = 900, height = 260, period = 'calendar' } = {}) {
  const padL = 44, padB = 26, padT = 56, padR = 10;
  const xs = data.map((d) => d.startAt), ys = data.map((d) => d.attendees);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys);
  const X = (x) => padL + ((x - x0) / Math.max(1, x1 - x0)) * (width - padL - padR);
  const Y = (y) => padT + (1 - y / y1) * (height - padT - padB);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="system-ui,sans-serif" font-size="11">`;
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
      if (q === 0) s += `<line x1="${X(ts)}" y1="${padT}" x2="${X(ts)}" y2="${height - padB}" stroke="#bbb" stroke-dasharray="3,3"/><text x="${X(ts) + 3}" y="${height - 10}" fill="#666">${y}</text>`;
      else if (q === 2) s += `<line x1="${X(ts)}" y1="${padT}" x2="${X(ts)}" y2="${height - padB}" stroke="#ccc" stroke-dasharray="3,3"/>`;
      else s += `<line x1="${X(ts)}" y1="${padT}" x2="${X(ts)}" y2="${height - padB}" stroke="#e3e3e3" stroke-dasharray="1,3"/>`;
    }
  }
  // raw attendance + max marker, grouped for toggling
  const rawPts = data.map((d) => `${X(d.startAt).toFixed(1)},${Y(d.attendees).toFixed(1)}`).join(' ');
  const m = data.reduce((a, b) => (b.attendees > a.attendees ? b : a));
  const mx = X(m.startAt), my = Y(m.attendees);
  const label = `max ${m.attendees} — ${trunc(m.name, 40)} (${m.date})`;
  const anchorRight = mx > width - 320;
  s += `<g class="s-raw"><polyline fill="none" stroke="#4c78a8" stroke-width="1.6" points="${rawPts}"/>`;
  for (const d of data) s += `<circle class="dot" cx="${X(d.startAt).toFixed(1)}" cy="${Y(d.attendees).toFixed(1)}" r="3" fill="#4c78a8"><title>${esc(`${d.attendees} attendees — ${d.name} (${d.date})`)}</title></circle>`;
  s += `<circle cx="${mx}" cy="${my}" r="4" fill="#e45756"/>`;
  s += `<text x="${anchorRight ? mx - 8 : mx + 8}" y="${Math.max(12, my - 8)}" fill="#e45756" text-anchor="${anchorRight ? 'end' : 'start'}">${esc(label)}</text></g>`;
  // rolling-average trend over the whole series
  const W = data.length > 100 ? 10 : 5;
  const tpts = data.map((d, i) => {
    const win = data.slice(Math.max(0, i - W + 1), i + 1);
    return `${X(d.startAt).toFixed(1)},${Y(win.reduce((a, t) => a + t.attendees, 0) / win.length).toFixed(1)}`;
  }).join(' ');
  s += `<polyline class="s-avg" fill="none" stroke="#f28e2b" stroke-width="2" stroke-dasharray="6,3" points="${tpts}"/>`;
  // straight least-squares line over the whole period
  const rN = data.length;
  let rSx = 0, rSy = 0, rSxx = 0, rSxy = 0;
  for (const d of data) { const dx = d.startAt - x0; rSx += dx; rSy += d.attendees; rSxx += dx * dx; rSxy += dx * d.attendees; }
  const rB = (rN * rSxy - rSx * rSy) / (rN * rSxx - rSx * rSx);
  const rA = (rSy - rB * rSx) / rN;
  const clampY = (v) => Math.max(0, Math.min(y1, v));
  s += `<line class="s-whole" x1="${X(x0)}" y1="${Y(clampY(rA))}" x2="${X(x1)}" y2="${Y(clampY(rA + rB * (x1 - x0)))}" stroke="#9467bd" stroke-width="2"/>`;
  // per-year straight segments: same least-squares fit as the whole line, one per
  // year, drawn across the year's span with a triangle at each end
  s += '<g class="s-year">';
  const byYear = {};
  for (const d of data) { const y = period === 'academic' ? academicStartYear(d.startAt) : new Date(d.startAt * 1000).getUTCFullYear(); (byYear[y] ??= []).push(d); }
  for (const [yr, pts] of Object.entries(byYear)) {
    pts.sort((a, b) => a.startAt - b.startAt);
    if (pts.length < 2) continue;
    const xa = pts[0].startAt;
    let qSx = 0, qSy = 0, qSxx = 0, qSxy = 0;
    for (const d of pts) { const dx = d.startAt - xa; qSx += dx; qSy += d.attendees; qSxx += dx * dx; qSxy += dx * d.attendees; }
    const denom = pts.length * qSxx - qSx * qSx;
    if (!denom) continue;
    const qB = (pts.length * qSxy - qSx * qSy) / denom;
    const qA = (qSy - qB * qSx) / pts.length;
    const spanStart = period === 'academic' ? Date.UTC(Number(yr), 7, 1) / 1000 : Date.UTC(Number(yr), 0, 1) / 1000;
    const spanEnd = period === 'academic' ? Date.UTC(Number(yr) + 1, 5, 1) / 1000 : Date.UTC(Number(yr), 11, 31) / 1000;
    const sx = Math.max(x0, spanStart), ex = Math.min(x1, spanEnd);
    if (ex <= sx) continue;
    const ya = Y(clampY(qA + qB * (sx - xa))), yb = Y(clampY(qA + qB * (ex - xa)));
    const X1 = X(sx).toFixed(1), X2 = X(ex).toFixed(1), Y1 = ya.toFixed(1), Y2 = yb.toFixed(1);
    s += `<line x1="${X1}" y1="${Y1}" x2="${X2}" y2="${Y2}" stroke="#2ca02a" stroke-width="2"/>`;
    s += `<polygon points="${X1},${(ya - 6).toFixed(1)} ${(X(sx) - 5).toFixed(1)},${(ya + 4).toFixed(1)} ${(X(sx) + 5).toFixed(1)},${(ya + 4).toFixed(1)}" fill="#2ca02a"/>`;
    s += `<polygon points="${X2},${(yb - 6).toFixed(1)} ${(X(ex) - 5).toFixed(1)},${(yb + 4).toFixed(1)} ${(X(ex) + 5).toFixed(1)},${(yb + 4).toFixed(1)}" fill="#2ca02a"/>`;
  }
  s += '</g>';
  s += `<text x="${padL}" y="14" fill="#4c78a8">— attendance</text><text x="${padL + 105}" y="14" fill="#f28e2b">- - ${W}-tournament average</text>`;
  s += `<text x="${padL}" y="32" fill="#9467bd">— straight-line trend (whole)</text><text x="${padL + 200}" y="32" fill="#2ca02a">▲ straight-line trend (each year) ▲</text>`;
  return { svg: s + '</svg>', slopePerYear: (rB * 365.25 * 24 * 3600) || 0 };
}
