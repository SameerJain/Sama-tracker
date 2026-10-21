// Shared page shell for series viewers: CSS, layout, cards, tables, client JS.
// One code path for every series so a feature added once ships everywhere.
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const dstr = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
export const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
export const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;

export const CSS = `:root{--bg:#fff;--fg:#222;--line:#ddd;--head:#f2f2f2;--headhov:#e2e2e2;--card:#fff}body.dark{--bg:#16181d;--fg:#e6e6e8;--line:#3a3f47;--head:#22262e;--headhov:#2c313a;--card:#1b1f26}body{font-family:system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px;color:var(--fg);background:var(--bg)}table{border-collapse:collapse;width:100%;font-size:13px;white-space:nowrap}th,td{border:1px solid var(--line);padding:4px 8px;text-align:left}th{background:var(--head)}th:hover{background:var(--headhov)}img{max-width:none;display:block}body.dark .scroll svg,body.dark .scroll img{filter:invert(0.88) hue-rotate(180deg)}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:16px 0;overflow:hidden}small{color:#888}.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}.toggles{font-size:13px;margin:6px 0}.toggles label{margin-right:12px;white-space:nowrap}.weektoggle{font-size:14px;margin:8px 0}.weektoggle a{margin-right:8px}nav{font-size:14px;margin:8px 0;display:flex;flex-wrap:wrap;column-gap:12px}nav a{margin-right:12px}.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;color:#fff;white-space:nowrap}.pill.u{background:#4c78a8}.pill.m{background:#2ca02a}.pill.r{background:#8c564b}.pill.s{background:#9467bd}#toolbar{position:fixed;top:10px;left:10px;z-index:70;display:flex;gap:6px}#toolbar button{font-size:13px;padding:4px 10px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--fg);cursor:pointer}body.nav-hidden nav{display:none}rect.clickable:hover{opacity:.7}circle.dot:hover{r:6;fill:#e45756}#attended.hide-few tr[data-events="1"],#attended.hide-few tr[data-events="2"]{display:none!important}.matrix table{font-size:11px}.matrix th,.matrix td{padding:2px 4px}.matrix table tr>th:first-child{position:sticky;left:0;z-index:2}.matrix table tr:first-child th{position:sticky;top:0;z-index:1}.matrix table tr:first-child th:first-child{z-index:3}#linetip{position:fixed;z-index:80;pointer-events:none;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:12px;line-height:1.5;display:none;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:pre-line}.matrix td{cursor:pointer}.matrix .hl-line{box-shadow:inset 0 0 0 100px rgba(255,196,0,.30)}.matrix td.hl-cell{box-shadow:inset 0 0 0 100px rgba(255,160,0,.55);outline:3px solid #e65100;outline-offset:-3px;font-weight:700}@media(min-width:641px){body{box-sizing:border-box;max-width:1308px;padding-left:208px}body.nav-hidden{padding-left:16px}#toolbar{left:max(10px,calc(50% - 646px))}nav.side{flex-direction:column;position:fixed;left:max(8px,calc(50% - 646px));top:110px;width:150px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}nav.side a{display:block;margin:0 0 8px}}@media(max-width:640px){body{padding:44px 8px 8px}h1{font-size:22px}table{font-size:12px}th,td{padding:3px 6px}.card{padding:8px;margin:12px 0}}`;

export function card(id, title, bodyHtml, accent) {
  return `<div class="card"${id ? ` id="${id}"` : ''}${accent ? ` style="border-top:4px solid ${accent}"` : ''}>${title ? `<h2>${title}</h2>` : ''}${bodyHtml}</div>`;
}
export function scrollTable(headersHtml, rowsHtml, full) {
  return `<div class="scroll"><table${full ? ' data-full="1"' : ''}><tr>${headersHtml}</tr>${rowsHtml}</table></div>`;
}

export const MODAL_HTML = `<div id="winmodal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50"><div style="background:var(--card);color:var(--fg);width:min(520px,92vw);margin:8vh auto;padding:16px;border-radius:10px;max-height:76vh;overflow:auto"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 id="winmodal-title" style="margin:0"></h3><button id="winmodal-x" aria-label="close" style="font-size:16px;padding:2px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);cursor:pointer">✕</button></div><div id="winmodal-list" style="margin-top:8px"></div></div></div>`;

// click-popup script for one page's WININFO map. clicking a bar or dot reads out
// its X and Y values first, then the WININFO list when the point has one: links
// for tournaments, or plain items for names with nowhere to link to.
// Modal div must stay outside any script block.
export function clientModal(winInfo) {
  return `<script>const WININFO = ${JSON.stringify(winInfo).replace(/<\//g, '<\\/')};
document.querySelectorAll('rect.clickable, circle.dot').forEach((r) => { r.onclick = () => { const info = WININFO[r.dataset.k]; const x = r.dataset.x, y = r.dataset.y; if (!info && x === undefined && y === undefined) return; document.getElementById('winmodal-title').textContent = info ? info.title : (r.dataset.name || x || ''); const list = document.getElementById('winmodal-list'); list.innerHTML = ''; if (x !== undefined || y !== undefined) { const xy = document.createElement('div'); xy.style.padding = '3px 0'; xy.textContent = 'X: ' + (x ?? '') + ' \\u00b7 Y: ' + (y ?? ''); list.appendChild(xy); } if (r.dataset.name && (x !== undefined || y !== undefined) && !info) { const nm = document.createElement('div'); nm.style.padding = '3px 0'; nm.textContent = r.dataset.name; list.appendChild(nm); } if (info && info.links) list.insertAdjacentHTML('beforeend', info.links.map((l) => '<div style="padding:3px 0"><a href="' + l.u + '">' + l.n + '</a> <small>' + l.d + '</small></div>').join('')); if (info && info.items) list.insertAdjacentHTML('beforeend', info.items.map((t) => '<div style="padding:3px 0">' + t + '</div>').join('')); document.getElementById('winmodal').style.display = 'block'; document.body.style.overflow = 'hidden'; }; });
document.getElementById('winmodal-x').onclick = () => { document.getElementById('winmodal').style.display = 'none'; document.body.style.overflow = ''; };
document.getElementById('winmodal').onclick = (e) => { if (e.target.id === 'winmodal') { e.target.style.display = 'none'; document.body.style.overflow = ''; } };</script>`;
}

// client JS, shared by every page: sortable tables, chart toggles, dark mode,
// sidebar toggle, show all/less, win popups. No backticks inside (emitted into a template literal).
export const CLIENT_JS_SORT = `
document.querySelectorAll('table').forEach((t) => {
  if (!t.rows.length) return;
  const head = t.rows[0];
  [...head.cells].forEach((th, i) => {
    th.style.cursor = 'pointer';
    th.title = 'click to sort';
    th.onclick = () => {
      const dir = th.dataset.dir === '1' ? -1 : 1;
      head.parentNode.querySelectorAll('th').forEach((h) => delete h.dataset.dir);
      th.dataset.dir = String(dir);
      const rows = [...t.rows].slice(1);
      const num = rows.every((r) => { const v = r.cells[i].textContent.trim(); return v === '' || /^-?[0-9.,%]+$/.test(v); });
      rows.sort((a, b) => {
        const x = a.cells[i].textContent.trim(), y = b.cells[i].textContent.trim();
        if (!num) return x.localeCompare(y) * dir;
        const nx = x === '' ? -Infinity : parseFloat(x.replace(/,/g, ''));
        const ny = y === '' ? -Infinity : parseFloat(y.replace(/,/g, ''));
        return (nx - ny) * dir;
      });
      rows.forEach((r) => t.appendChild(r));
      if (t._apply) t._apply();
    };
  });
});`;

export const CLIENT_JS_UI = `
// chart layer toggles
document.querySelectorAll('.toggles input').forEach((cb) => {
  cb.onchange = () => document.querySelectorAll('.attchart .' + cb.dataset.t).forEach((el) => { el.style.display = cb.checked ? '' : 'none'; });
});
// matchup matrix: click a cell to highlight its whole row and column, with
// the clicked cell picked out stronger. clicking it again clears it. one
// delegated listener, so the generated full-roster matrix is covered too
document.addEventListener('click', (e) => {
  const td = e.target.closest ? e.target.closest('.matrix td') : null;
  if (!td) return;
  const table = td.closest('table');
  const wasCell = td.classList.contains('hl-cell');
  table.querySelectorAll('.hl-line, .hl-cell').forEach((c) => c.classList.remove('hl-line', 'hl-cell'));
  if (wasCell) return;
  const col = td.cellIndex;
  for (const row of table.rows) { if (row.cells[col]) row.cells[col].classList.add('hl-line'); }
  for (const c of td.parentNode.cells) c.classList.add('hl-line');
  td.classList.add('hl-cell');
});
// line hover: the tooltip snaps onto the line. it only appears when the
// mouse is right on a line, a marker lands on the nearest point of that
// line, and the box beside it reads out that point's X (date) and Y (the
// line's own value there), not the mouse's. the svg carries its own axis
// scale, so a pixel goes back to data values for any of the chart lines
const SNAP_PX = 6;
const lineTip = document.createElement('div');
lineTip.id = 'linetip';
document.body.appendChild(lineTip);
const hideSnap = (svg) => {
  lineTip.style.display = 'none';
  const dot = svg && svg.querySelector('.snapdot');
  if (dot) dot.style.display = 'none';
};
// the points a line is drawn through, whichever shape draws it
const geoPoints = (el) => {
  const tag = el.tagName.toLowerCase();
  if (tag === 'polyline') return el.getAttribute('points').trim().split(/\\s+/).map((pair) => { const a = pair.split(','); return { x: +a[0], y: +a[1] }; });
  if (tag === 'line') return [{ x: +el.getAttribute('x1'), y: +el.getAttribute('y1') }, { x: +el.getAttribute('x2'), y: +el.getAttribute('y2') }];
  if (tag === 'path') {
    const tokens = el.getAttribute('d').match(/[MHVL]|-?\\d+\\.?\\d*/g) || [];
    const pts = [];
    let cmd = '', x = 0, y = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (/[MHVL]/.test(tokens[i])) { cmd = tokens[i]; continue; }
      if (cmd === 'M') { x = +tokens[i]; y = +tokens[++i]; }
      else if (cmd === 'H') x = +tokens[i];
      else if (cmd === 'V') y = +tokens[i];
      else continue;
      pts.push({ x, y });
    }
    return pts;
  }
  return [];
};
// nearest point on the drawn line to p, and how far away it is
const closestOnLine = (p, pts) => {
  let best = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || dist < best.dist) best = { ...q, dist };
  }
  return best;
};
document.querySelectorAll('svg .hit').forEach((el) => {
  el.addEventListener('mousemove', (e) => {
    const svg = el.closest('svg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    if (!el._pts) el._pts = geoPoints(el);
    const snap = closestOnLine(p, el._pts);
    // only when the mouse is on the line itself, not merely near it
    if (!snap || snap.dist > SNAP_PX) { hideSnap(svg); return; }
    const d = svg.dataset;
    const w = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width : svg.width.baseVal.value;
    const h = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.height ? svg.viewBox.baseVal.height : svg.height.baseVal.value;
    const px = (snap.x - +d.padl) / Math.max(1, w - +d.padl - +d.padr);
    const py = 1 - (snap.y - +d.padt) / Math.max(1, h - +d.padt - +d.padb);
    const xVal = +d.x0 + px * (+d.x1 - +d.x0);
    const yVal = Math.max(0, py * +d.ymax);
    const xDate = new Date(xVal * 1000).toISOString().slice(0, 10);
    // the marker, snapped onto the line at that point
    let dot = svg.querySelector('.snapdot');
    if (!dot) {
      dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'snapdot');
      dot.setAttribute('r', '4.5');
      dot.setAttribute('fill', '#fff');
      dot.setAttribute('stroke', '#222');
      dot.setAttribute('stroke-width', '2');
      dot.style.pointerEvents = 'none';
      svg.appendChild(dot);
    }
    dot.setAttribute('cx', snap.x.toFixed(1));
    dot.setAttribute('cy', snap.y.toFixed(1));
    dot.style.display = '';
    lineTip.textContent = (el.dataset.series || 'line') + '\\nX: ' + xDate + '\\nY: ' + yVal.toFixed(1);
    lineTip.style.display = 'block';
    // the box sits beside the snapped point, flipping at the right/bottom edge
    const at = svg.createSVGPoint();
    at.x = snap.x; at.y = snap.y;
    const c = at.matrixTransform(svg.getScreenCTM());
    const tw = lineTip.offsetWidth, th = lineTip.offsetHeight;
    let lx = c.x + 16, ly = c.y + 16;
    if (lx + tw > window.innerWidth - 8) lx = c.x - tw - 16;
    if (ly + th > window.innerHeight - 8) ly = c.y - th - 16;
    lineTip.style.left = lx + 'px';
    lineTip.style.top = ly + 'px';
  });
  el.addEventListener('mouseleave', (e) => hideSnap(el.closest('svg')));
});
// dark mode
const darkBtn = document.getElementById('darkbtn');
const setDark = (on) => { document.body.classList.toggle('dark', on); darkBtn.textContent = on ? '☀️ light' : '🌙 dark'; try { localStorage.setItem('dark', on ? '1' : '0'); } catch (e) {} };
try { if (localStorage.getItem('dark') === '1') setDark(true); } catch (e) {}
darkBtn.onclick = () => setDark(!document.body.classList.contains('dark'));
// sidebar show/hide
const navToggle = document.getElementById('navtoggle');
const setNav = (hidden) => { document.body.classList.toggle('nav-hidden', hidden); navToggle.textContent = hidden ? '☰ menu' : '✕ menu'; try { localStorage.setItem('navhidden', hidden ? '1' : '0'); } catch (e) {} };
try { if (localStorage.getItem('navhidden') === '1') setNav(true); } catch (e) {}
navToggle.onclick = () => setNav(!document.body.classList.contains('nav-hidden'));
// calendar vs academic year view (only on pages with the yearview radios)
document.querySelectorAll('input[name="yearview"]').forEach((r) => {
  r.onchange = () => {
    document.querySelectorAll('[data-yearview]').forEach((el) => { el.style.display = el.dataset.yearview === r.value ? '' : 'none'; });
  };
});
// attended card: hide players with only 1-2 events (swap to the shorter 3+ chart, hide table rows)
const fewToggle = document.getElementById('fewtoggle');
if (fewToggle) {
  fewToggle.onchange = () => {
    document.getElementById('attended').classList.toggle('hide-few', fewToggle.checked);
    const all = document.getElementById('attp-all');
    const reg = document.getElementById('attp-regular');
    if (all) all.style.display = fewToggle.checked ? 'none' : '';
    if (reg) reg.style.display = fewToggle.checked ? '' : 'none';
  };
}
// table tools: show all/less toggle on long tables (click any header to sort)
document.querySelectorAll('.scroll > table').forEach((t) => {
  const n = t.rows.length - 1, LIMIT = 15;
  if (n <= 30 || t.hasAttribute('data-full')) return;
  let collapsed = true;
  const bar = document.createElement('div');
  const btn = document.createElement('button');
  btn.style.margin = '0 0 6px';
  btn.textContent = 'show all ' + n + ' rows';
  const apply = () => {
    btn.textContent = collapsed ? 'show all ' + n + ' rows' : 'show less';
    [...t.rows].slice(1).forEach((r, i) => { r.style.display = (!collapsed || i < LIMIT) ? '' : 'none'; });
  };
  t._apply = apply;
  btn.onclick = () => { collapsed = !collapsed; apply(); };
  bar.appendChild(btn);
  t.parentNode.insertBefore(bar, t);
  apply();
});`;
