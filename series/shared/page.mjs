// Shared page shell for series viewers: CSS, layout, cards, tables, client JS.
// One code path for every series so a feature added once ships everywhere.
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const dstr = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
export const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
export const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;

export const CSS = `:root{--bg:#fff;--fg:#222;--line:#ddd;--head:#f2f2f2;--headhov:#e2e2e2;--card:#fff}body.dark{--bg:#16181d;--fg:#e6e6e8;--line:#3a3f47;--head:#22262e;--headhov:#2c313a;--card:#1b1f26}body{font-family:system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px;color:var(--fg);background:var(--bg)}table{border-collapse:collapse;width:100%;font-size:13px;white-space:nowrap}th,td{border:1px solid var(--line);padding:4px 8px;text-align:left}th{background:var(--head)}th:hover{background:var(--headhov)}img{max-width:none;display:block}body.dark .scroll svg,body.dark .scroll img{filter:invert(0.88) hue-rotate(180deg)}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:16px 0;overflow:hidden}small{color:#888}.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}.toggles{font-size:13px;margin:6px 0}.toggles label{margin-right:12px;white-space:nowrap}nav{font-size:14px;margin:8px 0;display:flex;flex-wrap:wrap;column-gap:12px}nav a{margin-right:12px}.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;color:#fff;white-space:nowrap}.pill.u{background:#4c78a8}.pill.m{background:#2ca02a}.pill.r{background:#8c564b}.pill.s{background:#9467bd}#toolbar{position:fixed;top:10px;left:10px;z-index:70;display:flex;gap:6px}#toolbar button{font-size:13px;padding:4px 10px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--fg);cursor:pointer}body.nav-hidden nav{display:none}rect.clickable:hover{opacity:.7}circle.dot:hover{r:6;fill:#e45756}#attended.hide-few tr[data-events="1"],#attended.hide-few tr[data-events="2"]{display:none!important}@media(min-width:1000px){nav.side{flex-direction:column;position:fixed;left:max(8px,calc(50% - 660px));top:110px;width:150px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}nav.side a{display:block;margin:0 0 8px}}@media(max-width:640px){body{padding:44px 8px 8px}h1{font-size:22px}table{font-size:12px}th,td{padding:3px 6px}.card{padding:8px;margin:12px 0}}`;

export function card(id, title, bodyHtml, accent) {
  return `<div class="card"${id ? ` id="${id}"` : ''}${accent ? ` style="border-top:4px solid ${accent}"` : ''}>${title ? `<h2>${title}</h2>` : ''}${bodyHtml}</div>`;
}
export function scrollTable(headersHtml, rowsHtml, full) {
  return `<div class="scroll"><table${full ? ' data-full="1"' : ''}><tr>${headersHtml}</tr>${rowsHtml}</table></div>`;
}

export const MODAL_HTML = `<div id="winmodal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50"><div style="background:var(--card);color:var(--fg);width:min(520px,92vw);margin:8vh auto;padding:16px;border-radius:10px;max-height:76vh;overflow:auto"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 id="winmodal-title" style="margin:0"></h3><button id="winmodal-x" aria-label="close" style="font-size:16px;padding:2px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);cursor:pointer">✕</button></div><div id="winmodal-list" style="margin-top:8px"></div></div></div>`;

// winner-popup script for one page's WININFO map. Modal div must stay outside any script block.
export function clientModal(winInfo) {
  return `<script>const WININFO = ${JSON.stringify(winInfo).replace(/<\//g, '<\\/')};
document.querySelectorAll('rect.clickable').forEach((r) => { r.onclick = () => { const info = WININFO[r.dataset.k]; if (!info) return; document.getElementById('winmodal-title').textContent = info.title; document.getElementById('winmodal-list').innerHTML = info.links.map((l) => '<div style="padding:3px 0"><a href="' + l.u + '">' + l.n + '</a> <small>' + l.d + '</small></div>').join(''); document.getElementById('winmodal').style.display = 'block'; }; });
document.getElementById('winmodal-x').onclick = () => { document.getElementById('winmodal').style.display = 'none'; };
document.getElementById('winmodal').onclick = (e) => { if (e.target.id === 'winmodal') e.target.style.display = 'none'; };</script>`;
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
      const num = rows.every((r) => /^-?[0-9.,%]+$/.test(r.cells[i].textContent.trim()));
      rows.sort((a, b) => {
        const x = a.cells[i].textContent.trim(), y = b.cells[i].textContent.trim();
        return (num ? parseFloat(x.replace(/,/g, '')) - parseFloat(y.replace(/,/g, '')) : x.localeCompare(y)) * dir;
      });
      rows.forEach((r) => t.appendChild(r));
    };
  });
});`;

export const CLIENT_JS_UI = `
// chart layer toggles
document.querySelectorAll('.toggles input').forEach((cb) => {
  cb.onchange = () => document.querySelectorAll('.attchart .' + cb.dataset.t).forEach((el) => { el.style.display = cb.checked ? '' : 'none'; });
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
  btn.onclick = () => { collapsed = !collapsed; apply(); };
  bar.appendChild(btn);
  t.parentNode.insertBefore(bar, t);
  apply();
});`;
