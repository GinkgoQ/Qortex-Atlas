/* Qortex Atlas — application.
   Layout, charts (donut/histogram/hbars), tabs, viewer chrome, and the
   knowledge-graph renderer are v2's (kept close to verbatim — same DOM
   helpers, same panel/bento structure). Every data source is real: no
   fixtures. All calls go through api.js to the live Qortex FastAPI service,
   which itself calls genuine Qortex library code against the live OpenNeuro
   GraphQL/CDN endpoints. Where v2 used procedural canvas art as a stand-in
   for imaging (explicitly captioned "engine preview — schematic, not
   diagnostic"), this build uses the real thing: a brain slice is a real
   PNG streamed via HTTP byte-range reads (zero-download), an EEG trace is
   real physical-unit samples decoded from an EDF/BDF byte range. Where no
   real remote-preview capability exists (DWI tractography), the UI says so
   plainly instead of fabricating one — evidence-first, never a guess. */

import { Api } from './api.js';

/* ================= tiny dom (v2, unchanged) ================= */
const $ = (s, r = document) => r.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
const svgNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs = {}) { const n = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; }
const fmt = (n) => (n ?? 0).toLocaleString('en-US');
function announce(msg) { const r = $('#live'); r.textContent = ''; requestAnimationFrame(() => r.textContent = msg); }
function toast(msg, kind = '') { const t = el('div', { class: `toast${kind ? ' toast-' + kind : ''}`, role: 'status' }, msg); $('#toasts').append(t); setTimeout(() => t.remove(), 4200); }
function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/* ================= evidence badges (v1 capability, v2 chip language) =====
   confirmed/inferred/unknown/blocked — icon + text always, never color
   alone. Reuses v2's .chip primitive with two new variants. */
const EV_META = {
  confirmed: { icon: '✓', cls: 'chip-green' }, inferred: { icon: '≈', cls: 'chip-copper' },
  unknown: { icon: '?', cls: '' }, blocked: { icon: '✕', cls: 'chip-fail' },
};
function evChip(status, label) {
  const m = EV_META[status] ?? EV_META.unknown;
  return el('span', { class: `chip ${m.cls}` }, el('span', { 'aria-hidden': 'true' }, m.icon), label ?? status);
}

/* ================= charts (v2, unchanged) ================= */
function donut({ size = 128, thick = 13, segs, centerVal, centerLab }) {
  const r = (size - thick) / 2, C = 2 * Math.PI * r, total = segs.reduce((a, s) => a + s.v, 0) || 1;
  const svg = sv('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img',
    'aria-label': `${centerLab}: ${centerVal}. ${segs.map(s => `${s.label} ${fmt(s.v)}`).join(', ')}` });
  svg.append(sv('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--panel-3)', 'stroke-width': thick }));
  let off = 0;
  segs.forEach(s => {
    const len = (s.v / total) * C;
    svg.append(sv('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: s.color,
      'stroke-width': thick, 'stroke-linecap': 'butt',
      'stroke-dasharray': `${Math.max(len - 2, 0)} ${C - len + 2}`, 'stroke-dashoffset': -off }));
    off += len;
  });
  const wrap = el('div', { class: 'donut' });
  wrap.append(svg, el('div', { class: 'donut-center' },
    el('div', {}, el('div', { class: 'dc-val' }, centerVal), el('div', { class: 'dc-lab' }, centerLab))));
  return wrap;
}

function histogram({ values, bins, w = 420, h = 130 }) {
  const max = Math.max(...values, 1), pad = { l: 6, r: 6, t: 8, b: 18 };
  const bw = (w - pad.l - pad.r) / values.length;
  const svg = sv('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img',
    'aria-label': `Histogram, ${values.length} bins, max ${fmt(max)}` });
  svg.append(sv('line', { x1: pad.l, y1: h - pad.b, x2: w - pad.r, y2: h - pad.b, class: 'axis' }));
  values.forEach((v, i) => {
    const bh = (v / max) * (h - pad.t - pad.b);
    const rect = sv('rect', { x: pad.l + i * bw + 1.5, y: h - pad.b - bh, width: bw - 3, height: bh, rx: 2, class: 'bar' });
    const title = sv('title', {}); title.textContent = `${bins?.[i] ?? i}: ${fmt(v)}`; rect.append(title);
    svg.append(rect);
  });
  if (bins) [0, Math.floor(bins.length / 2), bins.length - 1].forEach(i => {
    const t = sv('text', { x: pad.l + i * bw + bw / 2, y: h - 5, 'text-anchor': 'middle', class: 'axis-t' });
    t.textContent = bins[i]; svg.append(t);
  });
  return svg;
}

function hbars(rows) {
  const max = Math.max(...rows.map(r => r.count), 1);
  const grid = el('div', { class: 'hbars', role: 'img', 'aria-label': rows.map(r => `${r.label ?? r.key} ${fmt(r.count)}`).join(', ') });
  rows.forEach(r => {
    grid.append(
      el('span', { class: 'hb-label' }, r.label ?? r.key),
      el('div', { class: 'hb-track' }, el('div', { class: 'hb-fill', style: `width:${(r.count / max) * 100}%` })),
      el('span', { class: 'hb-val' }, fmt(r.count)),
    );
  });
  return grid;
}

/* ================= views ================= */
const main = $('#main');
let lastDatasetId = 'ds000117'; // powers the sidebar's contextual dataset shortcuts

function panel(title, sub, body, headExtra) {
  return el('section', { class: 'panel' },
    el('div', { class: 'panel-h' }, el('h3', {}, title), sub ? el('span', { class: 'sub' }, sub) : null, el('span', { class: 'sp' }), headExtra ?? null),
    el('div', { class: 'panel-b' }, body));
}
function panelWrap(title, content) {
  return el('section', { class: 'panel' }, el('div', { class: 'panel-h' }, el('h3', {}, title)), el('div', { class: 'panel-b' }, content));
}
function skeletonPanel(h = 160) { return el('div', { class: 'skel', style: `height:${h}px` }); }
// Adaptive "what's happening" card for the handful of real endpoints that
// are genuinely slow (manifest-heavy computation, live OpenNeuro round-
// trips): a real animated progress ring, a live elapsed-time counter, and
// the real reason it's slow (named per call site, never a generic
// "loading…"), all inside one self-contained panel — not a flat skeleton
// rectangle with a caption floating below it. Never fabricates a
// percentage we don't have: the bottom bar is an honest *indeterminate*
// sweep unless a caller passes a real `pct` (a tracked job's actual
// progress), in which case it renders that as a determinate fill instead.
// `eta: { operation, key }` opts into a real ETA: a fire-and-forget lookup
// against /timing/estimate, which reports back a median/p90 built from this
// machine's own history of that exact operation (scoped to this dataset
// once it has ≥2 samples, else the operation's overall history) — never a
// fabricated percentage or a literal network-speed probe.
function waitPanel(label, { height = 160, pct = null, eta = null } = {}) {
  const t0 = performance.now();
  const ring = sv('svg', { viewBox: '0 0 44 44', width: 40, height: 40, class: 'wait-ring', 'aria-hidden': 'true' });
  ring.append(
    sv('circle', { cx: 22, cy: 22, r: 18, class: 'wait-ring-track' }),
    sv('circle', { cx: 22, cy: 22, r: 18, class: 'wait-ring-arc' }),
  );
  const timeEl = el('span', { class: 'wait-time' }, '0.0s elapsed');
  const etaEl = el('span', { class: 'wait-eta' }, '');
  const barFill = pct != null
    ? el('div', { class: 'wait-bar-fill', style: `width:${pct}%` })
    : el('div', { class: 'wait-bar-fill wait-bar-indeterminate' });
  const card = el('div', { class: 'panel wait-card', style: `min-height:${Math.max(height, 130)}px` },
    el('div', { class: 'wait-body' },
      ring,
      el('div', { class: 'wait-copy' },
        el('div', { class: 'wait-label' }, label),
        el('div', { class: 'wait-sub' }, el('span', {}, pct != null ? `${pct}% complete ·` : 'In progress ·'), timeEl, etaEl))),
    el('div', { class: 'wait-bar' }, barFill));
  const iv = setInterval(() => {
    if (!document.body.contains(card)) { clearInterval(iv); return; }
    timeEl.textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s elapsed`;
  }, 200);
  if (eta) {
    Api.timingEstimate(eta.operation, eta.key).then(est => {
      if (!est.has_estimate || !document.body.contains(card)) return;
      const scope = est.scope === 'dataset' ? 'this dataset' : `${est.n_samples_used} recent run${est.n_samples_used === 1 ? '' : 's'}`;
      etaEl.textContent = ` · ~${est.median_s}s typical (${scope})`;
    }).catch(() => {});
  }
  return card;
}
// Compact inline sibling of waitPanel for a small nested region (part of a
// bento tile, not a whole tab body) where a full card would overwhelm the
// available space — same "spinner + honest label" idea, no separate card.
function waitRow(label) {
  return el('div', { class: 'wait-row', style: 'display:flex;align-items:center;gap:8px;padding:14px;color:var(--text-3);font-size:12.5px' },
    el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', {}, label));
}
function errorPanel(err) {
  return panel('Could not load', null, el('p', { style: 'color:var(--fail)' }, err.message ?? String(err)));
}

/* ---------- Home ---------- */
async function viewHome() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(
    el('div', { class: 'hero' },
      el('span', { class: 'qmark', 'aria-hidden': 'true', html: $('.side-brand .qmark').innerHTML }),
      el('div', { class: 'hero-brand' }, 'Qortex'),
      el('h1', { class: 'hero-title' }, 'Qortex ', el('span', { class: 't-atlas' }, 'Atlas')),
      el('p', { class: 'hero-tag' }, el('b', {}, 'Explore'), el('span', { class: 'dot' }, '. '), el('b', {}, 'Inspect'), el('span', { class: 'dot' }, '. '), el('b', {}, 'Understand'), ' neurodata', el('span', { class: 'dot' }, '.')),
      el('div', { class: 'hero-actions' },
        el('a', { class: 'btn btn-green', href: '#/ds/ds000117/overview' }, 'Open ds000117'),
        el('a', { class: 'btn', href: '#/explore' }, 'Explore with a goal')),
    ),
  );
  const pillarIcs = {
    manifest: 'M7 2h14l6 6v22H7zM21 2v6h6M12 14h12M12 19h12M12 24h8',
    shield: 'M17 3l11 4v8c0 7-4.6 11.6-11 14C10.6 26.6 6 22 6 15V7zM12 16l4 4 7-7',
    download: 'M17 4v16m0 0l-6-6m6 6l6-6M6 26h22M6 30h22',
    eye: 'M3 17s5-9 14-9 14 9 14 9-5 9-14 9S3 17 3 17zM17 21a4 4 0 100-8 4 4 0 000 8z',
    convert: 'M9 12a8 8 0 0114-3l3 3m0-6v6h-6M25 22a8 8 0 01-14 3l-3-3m0 6v-6h6',
    cube: 'M17 3l12 6v16l-12 6-12-6V9zM5 9l12 6 12-6M17 15v16',
  };
  const PILLARS = [
    { ic: 'manifest', h: 'Semantic manifest', p: 'BIDS structure and metadata, fetched live from OpenNeuro.' },
    { ic: 'shield', h: 'Readiness checks', p: 'compute_readiness() findings — confirmed/inferred/unknown/blocked.' },
    { ic: 'download', h: 'Selective download', p: 'A DownloadPlan, dry run, with per-file reasons before any bytes move.' },
    { ic: 'eye', h: 'Visual audit', p: 'Streamed brain slices and EEG waveforms — byte-range reads, zero full downloads.' },
    { ic: 'convert', h: 'Compatibility', p: 'CompatibilityEngine checks against model contracts.' },
    { ic: 'cube', h: 'Cohorts', p: 'Cross-dataset CohortBuilder — subject-level filters, harmonization checks.' },
  ];
  wrap.append(el('div', { class: 'pillars' }, ...PILLARS.map(p =>
    el('div', { class: 'pillar' },
      (() => { const s = sv('svg', { viewBox: '0 0 34 34', class: 'pic' });
        s.append(sv('path', { d: pillarIcs[p.ic] ?? pillarIcs.cube, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })); return s; })(),
      el('h3', {}, p.h), el('p', {}, p.p)))));

  const statusWrap = el('div', { style: 'margin-top:28px' }, skeletonPanel(90));
  wrap.append(statusWrap);
  main.append(wrap);

  try {
    const status = await Api.storeStatus();
    statusWrap.innerHTML = '';
    statusWrap.append(panel('Local catalog cache', 'a fast pre-filter — opening any dataset always fetches live', el('div', { class: 'kv' },
      el('dt', {}, 'Datasets cached'), el('dd', {}, String(status.n_datasets)),
      el('dt', {}, 'Deep-profiled'), el('dd', {}, String(status.n_profiled)),
      el('dt', {}, 'Cache path'), el('dd', {}, status.db_path),
    )));
  } catch (err) {
    statusWrap.innerHTML = ''; statusWrap.append(errorPanel(err));
  }
}

/* ---------- Datasets list ---------- */
async function viewDatasets() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' },
    el('div', { class: 'eyebrow' }, 'Local store'),
    el('h1', {}, 'Datasets'),
    el('p', { class: 'ds-meta' }, 'Cached from ', el('b', {}, 'OpenNeuro'), ' via the local DuckDB catalog — refresh it from Settings.')));
  const body = el('div', {}, waitPanel('Querying the local catalog.', { height: 300 }));
  wrap.append(body);
  main.append(wrap);

  try {
    const rows = await Api.catalogSearch({ limit: 200 }); // backend caps at 200 (Query(..., le=200))
    body.innerHTML = '';
    if (!rows.length) {
      body.append(panel('All datasets', null, el('p', {}, 'Local catalog is empty. ', el('a', { href: '#/settings' }, 'Refresh it from Settings'), ' to pull dataset metadata from OpenNeuro.')));
      return;
    }
    body.append(panel(`All datasets`, `${rows.length} indexed`, el('div', { class: 'tblw' },
      el('table', { class: 't' },
        el('thead', {}, el('tr', {}, ...['Dataset', 'Subjects', 'Modalities', 'License', 'Size', ''].map(h => el('th', {}, h)))),
        el('tbody', {}, ...rows.map(d => el('tr', {},
          el('td', {}, el('a', { href: `#/ds/${d.dataset_id}/overview` }, el('b', {}, d.dataset_id)), el('span', { style: 'color:var(--text-3)' }, ` ${d.name ?? ''}`)),
          el('td', { class: 'num' }, fmt(d.n_subjects)),
          el('td', {}, (d.modalities || []).join(' · ')),
          el('td', {}, d.license || '—'),
          el('td', { class: 'num' }, d.total_bytes ? fmtBytes(d.total_bytes) : '—'),
          el('td', {}, el('a', { class: 'btn btn-sm', href: `#/ds/${d.dataset_id}/overview` }, 'Open')),
        ))),
      ))));
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}
function fmtBytes(b) {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = b, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/* ---------- Dataset workspace ---------- */
const DS_TABS = ['overview', 'bids', 'viewer', 'quality', 'cohort', 'graph', 'files', 'plan', 'compat'];
const DS_TAB_LABEL = { bids: 'BIDS', compat: 'Compatibility' };

// Split in two so the tab strip is clickable the instant the page opens —
// it only needs `id`/`tab`, not the profile fetch. Rendering the full
// header (including the tab strip) only *after* the profile round-trip
// resolved meant a user had no way to switch tabs or see dataset context
// for the whole load — same information, just gated behind a fetch it
// doesn't actually depend on.
function dsHeaderShell(id, tab) {
  const metaLine = el('p', { class: 'ds-meta' }, 'OpenNeuro · ', el('span', { class: 'sub' }, 'loading…'));
  const head = el('div', { class: 'ds-head' },
    el('div', { class: 'eyebrow' }, 'Dataset'),
    el('div', { class: 'ds-title-row' }, el('h1', { class: 'mono' }, id)),
    metaLine,
    el('nav', { class: 'tabs', 'aria-label': 'Dataset sections' },
      ...DS_TABS.map(t => el('a', { href: `#/ds/${id}/${t}`, 'aria-current': t === tab ? 'page' : null },
        DS_TAB_LABEL[t] ?? (t[0].toUpperCase() + t.slice(1))))),
  );
  return { head, metaLine };
}
function dsHeaderFill(head, metaLine, profile) {
  head.querySelector('.ds-title-row').append(
    el('span', { class: 'ds-name' }, profile.name || ''),
    el('span', { class: 'ds-badge' }, profile.snapshot ? `⎇ ${profile.snapshot}` : 'Dataset'));
  metaLine.innerHTML = '';
  metaLine.append('OpenNeuro · ', el('b', {}, `${fmt(profile.n_subjects)} subjects`),
    ` · ${Object.keys(profile.modality_breakdown || {}).length} modalities · ${profile.license || 'unknown license'}`);
}

async function viewDataset(id, tab) {
  lastDatasetId = id;
  const wrap = el('div', { class: 'wrap' });
  const { head, metaLine } = dsHeaderShell(id, tab);
  const body = el('div', {}, waitPanel(`Fetching ${id}'s profile from OpenNeuro.`, { height: 220 }));
  wrap.append(head, body);
  main.append(wrap);

  let profile;
  try {
    profile = await Api.profile(id, { level: 'manifest' });
  } catch (err) {
    body.innerHTML = '';
    body.append(errorPanel(err), el('p', { style: 'margin-top:10px' }, el('a', { class: 'btn', href: '#/datasets' }, 'Browse datasets')));
    return;
  }
  dsHeaderFill(head, metaLine, profile);
  body.innerHTML = '';
  const fn = { overview: tabOverview, bids: tabBids, viewer: tabViewer, quality: tabQuality, cohort: tabCohort, graph: tabGraph, files: tabFiles, plan: tabPlan, compat: tabCompat }[tab] ?? tabOverview;
  await fn(body, profile);
}

/* --- overview (bento) — real MLReadinessScore + modality_breakdown + real participants age histogram + real mini brain-slice previews --- */
async function tabOverview(body, profile) {
  const id = profile.dataset_id;
  const ml = profile.ml_readiness || {};
  const dims = profile.readiness_dims || [];
  const bento = el('div', { class: 'bento' });

  const dimColors = ['var(--good)', 'var(--c-modality)', 'var(--copper)', 'var(--c-participant)', 'var(--green-deep)', 'var(--c-dataset)'];

  const readinessDonut = donut({
    segs: dims.map((d, i) => ({ label: d.label, v: Math.max(d.value, 1), color: dimColors[i % dimColors.length] })),
    centerVal: `${Math.round(ml.total ?? 0)}`, centerLab: 'ML score',
  });
  const readinessLegend = el('ul', { class: 'legend' }, ...dims.map((d, i) => el('li', {},
    el('span', { class: 'dot', style: `background:${dimColors[i % dimColors.length]}` }),
    el('span', { class: 'll' }, d.label), el('span', { class: 'lv' }, d.value))));
  const readinessCard = el('div', { class: 'span-3 panel' },
    el('div', { class: 'panel-h' }, el('h3', {}, 'Readiness'), el('span', { class: 'sub' }, `Grade ${ml.grade ?? '—'}`)),
    el('div', { class: 'panel-b' }, el('div', { class: 'donut-wrap' }, readinessDonut, readinessLegend)));

  const modTiles = Object.entries(profile.modality_breakdown || {}).map(([key, m]) => el('div', { class: 'mod-tile' },
    el('span', { class: 'mod-ic', html: modIcon(key) }),
    el('div', {}, el('div', { class: 'mod-name' }, key),
      el('div', { class: 'mod-count' }, fmt(m.n_files), el('span', { style: 'font-weight:400;color:var(--text-3);font-size:11px' }, ' files')))));
  const modalitiesCard = el('div', { class: 'span-3 panel' },
    el('div', { class: 'panel-h' }, el('h3', {}, 'Modalities')),
    el('div', { class: 'panel-b' }, el('div', { class: 'mod-grid' }, ...modTiles)));

  const subjectsCard = el('div', { class: 'span-3 panel', id: 'ov-subjects' },
    el('div', { class: 'panel-h' }, el('h3', {}, 'Subjects')),
    el('div', { class: 'panel-b' },
      el('div', { class: 'stat-big' }, fmt(profile.n_subjects)),
      el('div', { class: 'stat-note' }, `${profile.n_sessions ?? 0} sessions`),
      waitRow('Computing age distribution…')));

  const tasksBody = (profile.tasks || []).length
    ? hbars(profile.tasks.map(t => ({ label: t, count: 1 })))
    : el('p', { class: 'sub' }, 'No tasks recorded.');
  const tasksCard = el('div', { class: 'span-3 panel' }, el('div', { class: 'panel-h' }, el('h3', {}, 'Tasks')), el('div', { class: 'panel-b' }, tasksBody));

  bento.append(readinessCard, modalitiesCard, subjectsCard, tasksCard);

  bento.append(
    el('div', { class: 'span-6 panel', id: 'ov-quality' },
      el('div', { class: 'panel-h' }, el('h3', {}, 'Evidence — latest findings'), el('span', { class: 'sp' }), el('a', { class: 'btn btn-sm', href: `#/ds/${id}/quality` }, 'All checks')),
      el('div', {}, waitRow('Computing readiness findings…'))),
    el('div', { class: 'span-6 panel' },
      el('div', { class: 'panel-h' }, el('h3', {}, 'Anatomical preview'), el('span', { class: 'sub' }, 'HTTP byte-range reads — zero full-file downloads'), el('span', { class: 'sp' }), el('a', { class: 'btn btn-sm', href: `#/ds/${id}/viewer` }, 'Open viewer')),
      el('div', { class: 'panel-b', id: 'ov-planes' }, waitRow('Locating an anatomical scan to preview…'))),
  );
  body.append(bento);

  // age histogram from participants.tsv (falls back to an honest empty
  // state) — guarded: this fetch can resolve after the user has navigated
  // to a different tab, at which point #ov-subjects no longer exists in the DOM
  Api.participants(id).then(({ columns, rows }) => {
    const box = $('#ov-subjects .panel-b');
    if (!box) return; // navigated away before this resolved
    box.querySelector('.wait-row')?.remove();
    const ageCol = columns.find(c => /^age$/i.test(c));
    if (!ageCol || !rows.length) { box.append(el('p', { class: 'stat-note' }, 'No age column in participants.tsv for this dataset.')); return; }
    const ages = rows.map(r => parseFloat(r[ageCol])).filter(Number.isFinite);
    if (!ages.length) { box.append(el('p', { class: 'stat-note' }, 'participants.tsv has no usable age values.')); return; }
    const lo = Math.floor(Math.min(...ages) / 5) * 5, hi = Math.ceil(Math.max(...ages) / 5) * 5;
    const nb = Math.max(1, Math.round((hi - lo) / 5));
    const bins = Array(nb).fill(0), labels = [];
    for (let i = 0; i < nb; i++) labels.push(String(lo + i * 5));
    ages.forEach(a => { const i = Math.min(nb - 1, Math.max(0, Math.floor((a - lo) / 5))); bins[i]++; });
    box.append(el('div', { class: 'stat-note' }, `Age ${lo}–${hi} · N=${ages.length}`), histogram({ values: bins, bins: labels, w: 300, h: 100 }));
  }).catch(() => { const box = $('#ov-subjects .panel-b'); if (box) box.querySelector('.wait-row')?.remove(); });

  // real evidence findings (readiness + can_train) — same navigate-away guard
  Api.readiness(id).then(r => {
    const box = $('#ov-quality > div:last-child');
    if (!box) return; // navigated away before this resolved
    box.innerHTML = '';
    const blocked = r.evidence.groups.blocked, unknown = r.evidence.groups.unknown, confirmed = r.evidence.groups.confirmed;
    [...blocked.map(c => ({ level: 'fail', ...c })), ...unknown.slice(0, 2).map(c => ({ level: 'warn', ...c })), ...confirmed.slice(0, 2).map(c => ({ level: 'pass', ...c }))]
      .slice(0, 5).forEach(c => box.append(qrow({ level: c.level, msg: c.text, files: c.source })));
    if (!blocked.length && !unknown.length && !confirmed.length) box.append(el('p', { class: 'sub' }, 'No evidence computed yet.'));
  }).catch(err => { const box = $('#ov-quality > div:last-child'); if (!box) return; box.innerHTML = ''; box.append(el('p', { style: 'color:var(--fail)' }, err.message)); });

  // mini brain-slice previews (first subject, T1w if available)
  const planesBox = $('#ov-planes');
  const anatPresent = VIEWER_MODALITY_KEYS.anat.some(k => Object.keys(profile.modality_breakdown || {}).map(m => m.toLowerCase()).includes(k));
  if (anatPresent && profile.subjects?.length) {
    const sub = profile.subjects[0];
    planesBox.innerHTML = '';
    const row = el('div', { class: 'planes' });
    [0, 1, 2].forEach(axis => {
      const img = el('img', {
        src: Api.niftiSliceUrl(id, { subject: sub, modality: 'T1w', axis }),
        style: 'width:100%;display:block;background:#000',
        onerror: (e) => { e.target.closest('.plane').innerHTML = '<span class="pl-tag">unavailable</span>'; },
      });
      row.append(el('div', { class: 'plane' }, img, el('span', { class: 'pl-tag' }, ['Sagittal', 'Coronal', 'Axial'][axis])));
    });
    planesBox.append(row);
  } else {
    planesBox.innerHTML = '';
    planesBox.append(el('p', { class: 'sub' }, 'No anatomical (T1w) modality in this dataset.'));
  }
}
function qrow(q) {
  return el('div', { class: 'qrow' }, el('span', { class: `qmark-s q-${q.level}` }),
    el('div', {}, el('div', {}, q.msg), el('div', { class: 'qfile' }, q.files)));
}
function modIcon(key) {
  const paths = {
    T1w: 'M8 15c0-5 4-8 7-8s7 3 7 8-3 8-7 8-7-3-7-8z', mri: 'M8 15c0-5 4-8 7-8s7 3 7 8-3 8-7 8-7-3-7-8z',
    fmri: 'M8 15c0-5 4-8 7-8s7 3 7 8-3 8-7 8-7-3-7-8zM11 12l3 3-3 3M19 12l-3 3 3 3',
    dwi: 'M7 20c4-8 12-8 16 0M9 15c3-5 9-5 12 0M12 11c2-2 4-2 6 0', eeg: 'M6 15h3l2-5 3 10 2-6 2 3h6',
    meg: 'M15 6a9 9 0 019 9M15 10a5 5 0 015 5M15 14a1.5 1.5 0 011.5 1.5',
  };
  const p = paths[key] || paths[key?.toLowerCase()] || 'M9 15h.01M15 15h.01M21 15h.01';
  return `<svg viewBox="0 0 30 30" width="17" height="17"><path d="${p}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* --- BIDS explorer — real manifest tree + real file preview --- */
async function tabBids(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = '';
  body.append(waitPanel('Fetching the full file manifest.', { height: 400 }));
  let manifest;
  try { manifest = await Api.manifest(id, { limit: 2000 }); }
  catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); return; }

  // group flat file list into a tree by path segment
  const root = { name: id, kind: 'root', children: [], _map: new Map() };
  manifest.files.forEach(f => {
    const parts = f.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      if (isLeaf) { node.children.push({ name: part, kind: fileKind(f), size: fmtBytes(f.size), path: f.path }); return; }
      if (!node._map.has(part)) {
        const child = { name: part, kind: 'dir', children: [], _map: new Map() };
        node._map.set(part, child); node.children.push(child);
      }
      node = node._map.get(part);
    });
  });

  let selected = null;
  const metaPane = el('div', {});
  let metaMode = 'meta';

  async function renderMeta() {
    metaPane.innerHTML = '';
    if (!selected) { metaPane.append(el('p', { class: 'sub', style: 'padding:14px' }, 'Select a file to preview it.')); return; }
    metaPane.append(waitRow('Fetching file preview…'));
    try {
      const kv = el('dl', { class: 'kv' });
      let extra = null;
      if (/\.(tsv|csv)$/i.test(selected)) {
        const p = await Api.preview(id, { path: selected });
        kv.append(el('dt', {}, 'Path'), el('dd', {}, selected), el('dt', {}, 'Columns'), el('dd', {}, (p.columns || []).join(', ')));
        if (p.rows?.length) extra = tinyTable(p.columns, p.rows.slice(0, 8));
      } else if (/\.json$/i.test(selected)) {
        const p = await Api.preview(id, { path: selected });
        kv.append(el('dt', {}, 'Path'), el('dd', {}, selected));
        extra = jsonView(p.data ?? p);
      } else if (/\.nii(\.gz)?$/i.test(selected)) {
        const info = await Api.niftiInfo(id, { path: selected });
        Object.entries(info).forEach(([k, v]) => kv.append(el('dt', {}, k), el('dd', {}, Array.isArray(v) ? v.join(' × ') : String(v))));
        // Clicking a NIfTI file should show the actual image, not just its
        // header dimensions — the same three-plane slice stream the Viewer
        // tab uses, driven by this exact file's own subject/session/run/
        // suffix (already in the manifest record — no guessing).
        const rec = manifest.files.find(f => f.path === selected);
        if (rec) {
          const planes = ['sagittal', 'coronal', 'axial'].map((label, axis) => el('div', { class: 'plane' },
            el('img', {
              src: Api.niftiSliceUrl(id, { subject: rec.subject, modality: rec.suffix, session: rec.session, run: rec.run, axis }),
              style: 'width:100%;display:block;background:#000',
              onerror: (e) => { e.target.replaceWith(el('p', { class: 'sub', style: 'padding:14px' }, 'Slice streaming unavailable for this file.')); },
            }),
            el('span', { class: 'pl-tag' }, label)));
          extra = el('div', { class: 'planes', style: 'margin-top:12px' }, ...planes);
        }
      } else if (fileKind(manifest.files.find(f => f.path === selected) || {}) === 'sig') {
        const rec = manifest.files.find(f => f.path === selected);
        kv.append(el('dt', {}, 'Path'), el('dd', {}, selected));
        if (rec?.extension === '.edf' || rec?.extension === '.bdf') {
          const resp = await Api.eegPreview(id, { subject: rec.subject, session: rec.session, task: rec.task, run: rec.run, tmin: 0, tmax: 4, max_channels: 20 });
          extra = resp.supported ? eegTraceSvg(resp) : el('p', { class: 'sub', style: 'margin-top:8px' }, resp.reason);
        } else {
          extra = el('p', { class: 'sub', style: 'margin-top:8px' }, 'This signal format (.set/.fif/.vhdr) has no remote-streamable reader — open it in the Viewer tab after downloading, or check the Plan tab for the smallest download that includes it.');
        }
      } else {
        kv.append(el('dt', {}, 'Path'), el('dd', {}, selected), el('dt', {}, 'Preview'), el('dd', {}, 'No structured preview for this format.'));
      }
      metaPane.innerHTML = '';
      metaPane.append(el('div', { class: 'meta-tabs' },
        el('button', { 'aria-pressed': String(metaMode === 'meta'), onclick: () => { metaMode = 'meta'; renderMeta(); } }, 'Metadata'),
        el('button', { 'aria-pressed': String(metaMode === 'json'), onclick: () => { metaMode = 'json'; renderMeta(); } }, 'Raw')),
        metaMode === 'meta' ? el('div', {}, kv, extra) : jsonView({ path: selected }));
    } catch (err) {
      metaPane.innerHTML = ''; metaPane.append(el('p', { style: 'color:var(--fail);padding:14px' }, err.message));
    }
  }

  function nodeEl(node, depth = 0) {
    if (node.children) {
      const kidsUl = el('ul', {});
      node.children.sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name));
      node.children.forEach(ch => kidsUl.append(el('li', {}, nodeEl(ch, depth + 1))));
      const open = depth < 1;
      kidsUl.hidden = !open;
      const btn = el('button', { class: 'fnode', 'aria-expanded': String(open) }, el('span', { class: 'tw' }, open ? '▾' : '▸'), fico(node.kind), node.name);
      btn.addEventListener('click', () => {
        const isOpen = kidsUl.hidden === false;
        kidsUl.hidden = isOpen; btn.setAttribute('aria-expanded', String(!isOpen));
        btn.querySelector('.tw').textContent = isOpen ? '▸' : '▾';
      });
      return el('div', {}, btn, kidsUl);
    }
    const btn = el('button', { class: 'fnode', 'aria-selected': String(node.path === selected) },
      el('span', { class: 'tw' }), fico(node.kind), node.name, el('span', { class: 'fsize' }, node.size ?? ''));
    btn.addEventListener('click', () => {
      selected = node.path;
      tree.querySelectorAll('.fnode[aria-selected]').forEach(n => n.setAttribute('aria-selected', 'false'));
      btn.setAttribute('aria-selected', 'true');
      renderMeta();
      announce(`Selected ${node.name}`);
    });
    return btn;
  }
  function fico(kind) {
    const c = { nii: 'var(--c-file)', json: 'var(--copper)', tsv: 'var(--green)', sig: 'var(--c-modality)', dir: 'var(--text-3)', root: 'var(--green)' }[kind] ?? 'var(--text-3)';
    const s = sv('svg', { viewBox: '0 0 14 14', class: 'fico', width: 13, height: 13 });
    if (kind === 'dir' || kind === 'root') s.append(sv('path', { d: 'M1 3.5h4l1.5 2H13v6H1z', fill: 'none', stroke: c, 'stroke-width': '1.2' }));
    else s.append(sv('path', { d: 'M3 1h5l3 3v9H3z', fill: 'none', stroke: c, 'stroke-width': '1.2' }));
    return s;
  }

  const tree = el('div', { class: 'ftree', role: 'tree', 'aria-label': 'BIDS file tree' }, nodeEl(root));
  body.innerHTML = '';
  body.append(el('div', { class: 'explorer' },
    panel('BIDS / Manifest Explorer', `${fmt(manifest.total_matching)} files`, tree),
    el('section', { class: 'panel meta-pane' }, el('div', { class: 'panel-h' }, el('h3', {}, 'File metadata')), el('div', { class: 'panel-b' }, metaPane)),
  ));
  renderMeta();
}
function fileKind(f) {
  if (f.extension === '.json') return 'json';
  if (f.extension === '.tsv') return 'tsv';
  if (/\.nii(\.gz)?$/.test(f.extension || '')) return 'nii';
  if (['.set', '.fif', '.edf', '.bdf', '.vhdr'].includes(f.extension)) return 'sig';
  return 'file';
}
function tinyTable(cols, rows) {
  return el('div', { class: 'tblw', style: 'margin-top:8px' }, el('table', { class: 't' },
    el('thead', {}, el('tr', {}, ...(cols || []).map(c => el('th', {}, c)))),
    el('tbody', {}, ...rows.map(r => el('tr', {}, ...(cols || []).map(c => el('td', { class: 'mono', style: 'font-size:11px' }, String(r[c] ?? ''))))))));
}
function jsonView(obj) {
  const pre = el('pre', { class: 'jsonview' });
  pre.innerHTML = JSON.stringify(obj, null, 2)
    .replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="v">"$1"</span>');
  return pre;
}

/* --- Viewer — real anat/fMRI slices (byte-range PNG), real EEG (byte-range EDF/BDF), real DWI gradient table, universal image drop --- */
// Exact-match modality lookup — the substring version this replaced
// (`/mri|anat/i.test(m)`) matched "fmri" too, since "fmri" contains "mri",
// so a functional-only dataset could wrongly appear to have anatomical
// scans. Modality keys in profile.modality_breakdown are canonical single
// tokens ("mri", "fmri", "eeg", "dwi", ...), so exact set membership is both
// correct and simpler than a regex.
const VIEWER_MODALITY_KEYS = {
  anat: ['mri', 'anat', 't1w'],
  fmri: ['fmri', 'bold', 'func'],
  eeg: ['eeg'],
  dwi: ['dwi', 'dti'],
};

async function tabViewer(body, profile) {
  const id = profile.dataset_id;
  const present = new Set(Object.keys(profile.modality_breakdown || {}).map(m => m.toLowerCase()));
  const hasModality = (key) => VIEWER_MODALITY_KEYS[key].some(k => present.has(k));
  // Adaptive: only offer modes this dataset can actually show something
  // for — a mode button that always dead-ends in "no recordings found" is
  // worse than not offering it. "Open image" is a generic local-file tool,
  // not dataset-dependent, so it's always available.
  const allModes = [['anat', 'Anatomical'], ['fmri', 'fMRI'], ['eeg', 'EEG'], ['dwi', 'DWI']];
  const modes = [...allModes.filter(([key]) => hasModality(key)), ['image', 'Open image']];
  let mode = modes[0][0];
  const modeBar = el('div', { class: 'vmodes', role: 'group', 'aria-label': 'Viewer mode' });
  const stage = el('div', {});
  modes.forEach(([key, label]) => modeBar.append(el('button', {
    class: 'vmode', 'aria-pressed': String(key === mode),
    onclick: (e) => { mode = key; [...modeBar.children].forEach(b => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); render(); },
  }, label)));
  body.innerHTML = ''; body.append(modeBar, stage);

  async function render() {
    stage.innerHTML = ''; stage.append(waitPanel(`Streaming ${mode === 'eeg' ? 'signal samples' : mode === 'image' ? 'the image' : 'byte-range slices'} — nothing is fully downloaded.`, { height: 300 }));
    try {
      if (mode === 'anat') stage.replaceChildren(await mriViewer(id, profile, 'T1w', 'Anatomical'));
      else if (mode === 'fmri') stage.replaceChildren(await mriViewer(id, profile, 'bold', 'fMRI — BOLD'));
      else if (mode === 'eeg') stage.replaceChildren(await realEegViewer(id, profile));
      else if (mode === 'dwi') stage.replaceChildren(await realDwiViewer(id, profile));
      else stage.replaceChildren(imageViewer());
    } catch (err) {
      stage.innerHTML = ''; stage.append(errorPanel(err));
    }
  }
  render();
}

async function mriViewer(id, profile, suffix, title) {
  const sub = profile.subjects?.[0];
  if (!sub) return panelWrap(title, el('p', { class: 'sub' }, 'No subjects in manifest.'));
  const planes = ['sagittal', 'coronal', 'axial'];
  const planeEls = planes.map((p, axis) => {
    const img = el('img', {
      src: Api.niftiSliceUrl(id, { subject: sub, modality: suffix, axis }),
      style: 'width:100%;display:block;background:#000',
      onerror: (e) => { e.target.replaceWith(el('p', { class: 'sub', style: 'padding:14px' }, `Slice streaming unavailable for this file.`)); },
    });
    return el('div', { class: 'plane' }, img, el('span', { class: 'pl-tag' }, p));
  });
  const bar = el('div', { class: 'viewer-bar' },
    el('span', {}, `Subject ${sub}`), el('span', { class: 'sp', style: 'flex:1' }),
    el('span', { class: 'sub', style: 'font-size:11px;color:var(--text-3)' }, 'streamed via HTTP range reads — full volume never downloaded'));
  return panelWrap(title, el('div', {}, el('div', { class: 'planes' }, ...planeEls), bar));
}

// A clinical-EEG-style scroll view: banded channel rows, gridlines, and a
// calibration bar showing what a deflection actually means in µV — the
// baseline any EEG reader (clinician or researcher) expects, not a plain
// line chart. Amplitude auto-scales to the epoch's own peak rather than a
// fixed guess, since a hardcoded scale looks wrong the moment the dataset's
// voltage range differs (clipped on high-amplitude artifact-heavy data,
// invisible on a low-amplitude clean recording).
function niceScaleStep(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const s of [1, 2, 5]) { if (s * mag >= v * 0.5) return s * mag; }
  return 10 * mag;
}

// Shared by the Viewer tab's EEG mode and the BIDS explorer's inline
// preview for a clicked .edf/.bdf file — same real waveform, two entry
// points into it.
function eegTraceSvg(resp) {
  const W = 1040, rowH = 32, padL = 66, padR = 20, padT = 14, padB = 34;
  const H = resp.channels.length * rowH + padT + padB;
  const secs = resp.tmax - resp.tmin;

  let peak = 0;
  resp.series.forEach(row => row.forEach(v => { const a = Math.abs(v); if (a > peak) peak = a; }));
  const scaleUv = niceScaleStep(peak || 1);
  const scaleY = (rowH * 0.42) / (scaleUv * 1.15);

  const svg = sv('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'eeg-svg', role: 'img',
    'aria-label': `EEG, ${resp.channels.length} channels, ${secs.toFixed(1)}s at ${resp.sfreq} Hz`,
  });

  for (let s = 0; s <= secs; s += 1) {
    const x = padL + (s / secs) * (W - padL - padR);
    svg.append(sv('line', { x1: x, y1: padT, x2: x, y2: H - padB + 6, class: 'eeg-grid' }));
    const t = sv('text', { x, y: H - padB + 20, 'text-anchor': 'middle', class: 'eeg-scale' }); t.textContent = `${s.toFixed(0)}s`; svg.append(t);
  }
  resp.channels.forEach((ch, ci) => {
    const y0 = padT + ci * rowH + rowH / 2;
    const lbl = sv('text', { x: padL - 12, y: y0 + 4, 'text-anchor': 'end', class: 'eeg-ch' }); lbl.textContent = ch; svg.append(lbl);
    const series = resp.series[ci] || [];
    const pts = series.map((v, i) => `${(padL + (i / Math.max(series.length - 1, 1)) * (W - padL - padR)).toFixed(1)},${(y0 - v * scaleY).toFixed(1)}`).join(' ');
    svg.append(sv('polyline', { points: pts, class: 'eeg-tr' }));
  });

  // Calibration bar — the one thing every clinical EEG scroll view has and
  // a plain line chart doesn't: what does a deflection of this height mean.
  const barX = 24, barYc = H - padB / 2, barPx = scaleUv * scaleY;
  svg.append(sv('line', { x1: barX, y1: barYc - barPx / 2, x2: barX, y2: barYc + barPx / 2, class: 'eeg-scalebar' }));
  const st = sv('text', { x: barX + 8, y: barYc + 3, class: 'eeg-scale' }); st.textContent = `${scaleUv} µV`; svg.append(st);

  const excluded = resp.n_channels_excluded || 0;
  const meta = el('div', { class: 'sub', style: 'font-size:11px;color:var(--text-3);margin-top:8px' },
    `${resp.channels.length} EEG channels${excluded ? ` shown · ${excluded} non-EEG channels excluded (timestamps, counters, quality/battery flags)` : ''} · streamed via HTTP range reads`);
  return el('div', {}, el('div', { class: 'eeg-wrap' }, svg), meta);
}

async function realEegViewer(id, profile) {
  const sub = profile.subjects?.[0];
  if (!sub) return panelWrap('EEG', el('p', { class: 'sub' }, 'No subjects in manifest.'));
  const resp = await Api.eegPreview(id, { subject: sub, tmin: 0, tmax: 4, max_channels: 20 });
  if (!resp.supported) return panelWrap('EEG', el('p', { class: 'sub' }, resp.reason));
  if (!resp.channels.length) return panelWrap('EEG', el('p', { class: 'sub' }, 'No EEG electrode channels were identified in this recording.'));
  return panelWrap(`EEG — sub-${sub} · ${resp.sfreq} Hz`, eegTraceSvg(resp));
}

async function realDwiViewer(id, profile) {
  const present = new Set(Object.keys(profile.modality_breakdown || {}).map(m => m.toLowerCase()));
  if (!VIEWER_MODALITY_KEYS.dwi.some(k => present.has(k))) {
    return panelWrap('DWI — Gradient Table', el('p', { class: 'sub' }, 'No DWI modality found in this dataset.'));
  }
  return panelWrap('DWI — Gradient Table',
    el('p', { class: 'sub' }, 'Tractography streamline preview isn’t available — Qortex doesn’t fabricate one. b-value/gradient info requires downloading the .bval/.bvec companions; see the Plan tab for the smallest download that includes them.'));
}

function imageViewer() {
  const state = { zoom: 1, bright: 1, contrast: 1 };
  const img = el('img', { alt: 'Opened image preview', hidden: true });
  const meta = el('div', { class: 'img-meta' }, 'No image opened yet.');
  const stageBox = el('div', { class: 'imgstage', hidden: true }, img);
  function apply() { img.style.transform = `scale(${state.zoom})`; img.style.filter = `brightness(${state.bright}) contrast(${state.contrast})`; }
  function open(file) {
    const ok = /^image\//.test(file.type) || /\.(svg|png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(file.name);
    if (!ok) { toast(`"${file.name}" is not a displayable image format.`); return; }
    const url = URL.createObjectURL(file);
    img.src = url; img.hidden = false; stageBox.hidden = false;
    img.onload = () => { meta.textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight}px · ${(file.size / 1024).toFixed(1)} KB`; URL.revokeObjectURL(url); };
    apply(); announce(`Opened image ${file.name}`);
  }
  const input = el('input', { type: 'file', accept: 'image/*,.svg', class: 'visually-hidden', id: 'imgfile' });
  input.addEventListener('change', () => input.files[0] && open(input.files[0]));
  const dz = el('div', { class: 'dropzone' },
    el('div', {}, el('b', {}, 'Drop any image here'), ' — PNG, JPEG, SVG, WebP, GIF, AVIF, BMP…'),
    el('div', { class: 'dz-hint' }, 'For NIfTI slices from a dataset, use the Anatomical / fMRI modes above.'),
    el('div', { style: 'margin-top:12px' }, el('label', { class: 'btn', for: 'imgfile', style: 'cursor:pointer' }, 'Choose file…'), input));
  ;['dragover', 'dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.toggle('dragover', ev === 'dragover');
    if (ev === 'drop' && e.dataTransfer.files[0]) open(e.dataTransfer.files[0]);
  }));
  const bar = el('div', { class: 'viewer-bar' },
    slider('Zoom', 5, 40, 10, v => { state.zoom = v / 10; apply(); }),
    slider('Bright', 4, 20, 10, v => { state.bright = v / 10; apply(); }),
    slider('Contrast', 4, 20, 10, v => { state.contrast = v / 10; apply(); }),
    el('button', { class: 'btn btn-sm', onclick: () => { state.zoom = state.bright = state.contrast = 1; apply(); } }, 'Reset'));
  return panelWrap('Image Viewer — any format the browser can render', el('div', {}, dz, stageBox, bar, meta));
}
function slider(label, min, max, val, oninput) {
  const inp = el('input', { type: 'range', min, max, value: val, 'aria-label': label });
  inp.addEventListener('input', () => oninput(+inp.value));
  return el('label', { class: 'vslider' }, label, inp);
}

/* --- Quality — real readiness findings + evidence chips --- */
async function tabQuality(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = '';
  body.append(waitPanel('Computing readiness from the full file manifest.', { height: 300, eta: { operation: 'readiness', key: id } }));
  try {
    const r = await Api.readiness(id);
    const findings = r.readiness.findings || [];
    const passed = findings.filter(f => f.severity === 'info').length || (r.readiness.n_recordings - findings.length);
    const warn = findings.filter(f => f.severity === 'warning').length;
    const fail = findings.filter(f => f.severity === 'error').length;
    // r.evidence.groups is already grouped by finding code server-side (see
    // atlas_evidence.build_evidence) — a 19-subject dataset can otherwise
    // repeat the same finding ~900+ times, one per recording, which both
    // floods this list with near-duplicates and blows this panel's height
    // far past the donut column next to it. Render the grouped rows instead.
    const checks = [
      ...r.evidence.groups.blocked.map(c => ({ level: 'fail', ...c })),
      ...r.evidence.groups.unknown.map(c => ({ level: 'warn', ...c })),
      ...r.evidence.groups.inferred.map(c => ({ level: 'warn', ...c })),
      ...r.evidence.groups.confirmed.map(c => ({ level: 'pass', ...c })),
    ];
    body.innerHTML = '';
    body.append(el('div', { class: 'bento' },
      el('div', { class: 'span-4 panel' }, el('div', { class: 'panel-b', style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:32px 16px;min-height:280px' },
        donut({ size: 150, thick: 15, segs: [{ label: 'Passed', v: Math.max(passed, 0), color: 'var(--good)' }, { label: 'Warnings', v: warn, color: 'var(--warn)' }, { label: 'Failed', v: fail, color: 'var(--fail)' }], centerVal: `${r.readiness.n_recordings}`, centerLab: 'Recordings' }),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center' },
          evChip('confirmed', `${r.evidence.counts.confirmed} confirmed`), evChip('inferred', `${r.evidence.counts.inferred} inferred`),
          evChip('unknown', `${r.evidence.counts.unknown} unknown`), r.evidence.counts.blocked ? evChip('blocked', `${r.evidence.counts.blocked} blocked`) : null))),
      el('div', { class: 'span-8 panel' },
        el('div', { class: 'panel-h' }, el('h3', {}, 'Checks'), el('span', { class: 'sub' }, `${checks.length} distinct issues · ${r.readiness.n_recordings} recordings scanned`)),
        // Bounded + scrollable rather than growing without limit: a dataset
        // with a dozen distinct issues next to the compact donut card was
        // producing two panels several hundred pixels apart in height in
        // the same row — a fixed cap keeps the row visually balanced
        // regardless of how many checks a given dataset happens to have.
        el('div', { class: 'checks-scroll' }, checks.length ? checks.map(c => qrow({ level: c.level, msg: c.text, files: c.source })) : el('p', { class: 'sub', style: 'padding:14px' }, 'No findings — nothing to report yet.'))),
    ));
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}

/* --- Cohort — real participants.tsv demographics --- */
async function tabCohort(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = ''; body.append(waitPanel('Fetching participants.tsv.', { height: 300 }));
  try {
    const { columns, rows } = await Api.participants(id);
    body.innerHTML = '';
    if (!rows.length) { body.append(panel('Cohort', null, el('p', { class: 'sub' }, 'No participants.tsv available for this dataset.'))); return; }
    const ageCol = columns.find(c => /^age$/i.test(c)), sexCol = columns.find(c => /^sex$/i.test(c));
    const ages = ageCol ? rows.map(r => parseFloat(r[ageCol])).filter(Number.isFinite) : [];
    let ageChart = el('p', { class: 'sub' }, 'No age column in participants.tsv.');
    if (ages.length) {
      const lo = Math.floor(Math.min(...ages) / 5) * 5, hi = Math.ceil(Math.max(...ages) / 5) * 5, nb = Math.max(1, Math.round((hi - lo) / 5));
      const bins = Array(nb).fill(0), labels = Array.from({ length: nb }, (_, i) => String(lo + i * 5));
      ages.forEach(a => bins[Math.min(nb - 1, Math.max(0, Math.floor((a - lo) / 5)))]++);
      ageChart = histogram({ values: bins, bins: labels, w: 520, h: 150 });
    }
    let sexChart = el('p', { class: 'sub' }, 'No sex column in participants.tsv.');
    if (sexCol) {
      const counts = {};
      rows.forEach(r => { const v = (r[sexCol] || 'unknown').trim() || 'unknown'; counts[v] = (counts[v] || 0) + 1; });
      const entries = Object.entries(counts);
      const colors = ['var(--c-dataset)', 'var(--c-modality)', 'var(--copper)', 'var(--c-participant)'];
      sexChart = el('div', { class: 'donut-wrap' },
        donut({ size: 120, thick: 13, segs: entries.map(([label, v], i) => ({ label, v, color: colors[i % colors.length] })), centerVal: fmt(rows.length), centerLab: 'Total' }),
        el('ul', { class: 'legend' }, ...entries.map(([label, v], i) => el('li', {}, el('span', { class: 'dot', style: `background:${colors[i % colors.length]}` }), el('span', { class: 'll' }, label), el('span', { class: 'lv' }, fmt(v))))));
    }
    const extraCols = columns.filter(c => !['participant_id', ageCol, sexCol].includes(c)).slice(0, 2);
    body.append(el('div', { class: 'cohort-grid' },
      panel('Age', `N = ${fmt(rows.length)} · participants.tsv`, ageChart),
      panel('Sex', null, sexChart),
      ...extraCols.map(c => {
        const counts = {};
        rows.forEach(r => { const v = (r[c] ?? '').toString().trim() || '(blank)'; counts[v] = (counts[v] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count }));
        return panel(c, 'from participants.tsv', hbars(top));
      }),
    ));
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}

/* --- Knowledge graph — real dataset → modalities → tasks → subjects → files --- */
async function tabGraph(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = ''; body.append(waitPanel('Fetching the file manifest to build the graph.', { height: 470 }));
  let manifest;
  try { manifest = await Api.manifest(id, { limit: 400 }); } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); return; }

  const modalities = Object.keys(profile.modality_breakdown || {}).slice(0, 6);
  const tasks = (profile.tasks || []).slice(0, 6);
  const subjects = (profile.subjects || []).slice(0, 6).map(s => `sub-${s}`);
  const files = manifest.files.slice(0, 6).map(f => f.filename);

  const W = 1160, H = 470;
  const cols = [
    { key: 'dataset', title: 'Dataset', items: [id], x: 90, color: 'var(--c-dataset)', r: 22 },
    { key: 'modality', title: 'Modalities', items: modalities, x: 340, color: 'var(--c-modality)', r: 9 },
    { key: 'task', title: 'Tasks', items: tasks.length ? tasks : ['(none recorded)'], x: 590, color: 'var(--c-task)', r: 9 },
    { key: 'participant', title: 'Subjects (sample)', items: subjects, x: 830, color: 'var(--c-participant)', r: 8 },
    { key: 'file', title: 'Files (sample)', items: files, x: 1080, color: 'var(--c-file)', r: 8 },
  ];
  const pos = {};
  cols.forEach(c => c.items.forEach((it, i) => { pos[`${c.key}:${it}`] = { x: c.x, y: 70 + (i + 0.5) * ((H - 90) / Math.max(c.items.length, 1)) }; }));

  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'kg-svg', role: 'img', 'aria-label': 'Knowledge graph: dataset, modalities, tasks, subjects, files' });
  cols.forEach(c => { const t = sv('text', { x: c.x, y: 30, 'text-anchor': 'middle', class: 'kg-col-t' }); t.textContent = c.title; svg.append(t); });

  const edges = [];
  function edge(aKey, bKey) {
    const a = pos[aKey], b = pos[bKey]; if (!a || !b) return;
    const p = sv('path', { class: 'kg-edge', d: `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}` });
    p.dataset.a = aKey; p.dataset.b = bKey; svg.append(p); edges.push(p);
  }
  modalities.forEach(m => edge(`dataset:${id}`, `modality:${m}`));
  modalities.forEach(m => tasks.forEach(t => edge(`modality:${m}`, `task:${t}`)));
  tasks.forEach(t => subjects.forEach(s => edge(`task:${t}`, `participant:${s}`)));
  subjects.forEach(s => files.forEach(f => edge(`participant:${s}`, `file:${f}`)));

  cols.forEach(c => c.items.forEach(it => {
    const key = `${c.key}:${it}`, { x, y } = pos[key];
    const g = sv('g', { class: 'kg-node', tabindex: '0', role: 'button' });
    g.setAttribute('aria-label', `${c.title}: ${it}`);
    g.append(sv('circle', { cx: x, cy: y, r: c.r, fill: c.color }));
    const t = sv('text', { x: c.key === 'file' ? x - c.r - 6 : x + c.r + 7, y: y + 4, 'text-anchor': c.key === 'file' ? 'end' : 'start' });
    t.textContent = it.length > 26 ? it.slice(0, 24) + '…' : it;
    g.append(t);
    const hot = (on) => { g.classList.toggle('hot', on); edges.forEach(e => e.classList.toggle('hot', on && (e.dataset.a === key || e.dataset.b === key))); };
    g.addEventListener('mouseenter', () => hot(true)); g.addEventListener('mouseleave', () => hot(false));
    g.addEventListener('focus', () => hot(true)); g.addEventListener('blur', () => hot(false));
    svg.append(g);
  }));

  body.innerHTML = '';
  body.append(el('section', { class: 'panel' },
    el('div', { class: 'panel-h' }, el('h3', {}, 'Knowledge Graph — dataset, modalities, tasks, subjects, files'), el('span', { class: 'sub' }, 'sampled, not fabricated relationships')),
    el('div', { class: 'kg-legend' }, ...cols.map(c => el('span', {}, el('span', { class: 'dot', style: `background:${c.color}` }), c.title))),
    el('div', { class: 'panel-b' }, svg)));
}

/* --- Files table — real manifest --- */
async function tabFiles(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = ''; body.append(waitPanel('Fetching the file manifest.', { height: 300 }));
  try {
    const manifest = await Api.manifest(id, { limit: 500 });
    body.innerHTML = '';
    body.append(panel('Files', `${fmt(manifest.files.length)} shown of ${fmt(manifest.total_matching)}`, el('div', { class: 'tblw' },
      el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Path'), el('th', {}, 'Kind'), el('th', { class: 'num' }, 'Size'), el('th', {}, ''))),
        el('tbody', {}, ...manifest.files.map(f => el('tr', {},
          el('td', { class: 'mono', style: 'font-size:12px' }, f.path),
          el('td', {}, el('span', { class: 'chip' }, fileKind(f).toUpperCase())),
          el('td', { class: 'num mono', style: 'font-size:12px' }, fmtBytes(f.size)),
          el('td', {}, el('a', { class: 'btn btn-sm', href: `#/ds/${id}/bids` }, 'View')),
        ))),
      ))));
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}

/* --- Plan — real DownloadPlan (v1 capability, v2 visual language) --- */
async function tabPlan(body, profile) {
  const id = profile.dataset_id;
  const presets = [['validate', 'Validate', 'Metadata + structure only'], ['label-check', 'Label check', 'Events + companions'], ['smoke-train', 'Smoke train', 'One loadable recording'], ['full-train', 'Full train', 'Everything']];
  let active = 'label-check';
  const bar = el('div', { class: 'vmodes' });
  const resultWrap = el('div', { style: 'margin-top:14px' });
  presets.forEach(([key, label, desc]) => bar.append(el('button', {
    class: 'vmode', 'aria-pressed': String(key === active), title: desc,
    onclick: (e) => { active = key; [...bar.children].forEach(b => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); run(); },
  }, label)));
  body.innerHTML = ''; body.append(panel('Download plan', 'a DownloadPlan, dry run — nothing downloaded until you ask', el('div', {}, bar, resultWrap)));

  async function run() {
    resultWrap.innerHTML = '';
    resultWrap.append(waitPanel('Resolving the DownloadPlan against the full manifest.', { height: 200, eta: { operation: 'plan', key: id } }));
    try {
      const plan = await Api.plan(id, { preset: active });
      resultWrap.innerHTML = '';
      const actionBox = el('div', { style: 'margin-top:14px' });
      resultWrap.append(
        el('div', { class: 'stat-big' }, fmtBytes(plan.estimated_bytes)),
        el('div', { class: 'stat-note' }, `${(plan.files || []).length} files — goal "${plan.selection?.metadata_only ? 'metadata-only' : active}"`),
        el('div', { class: 'tblw', style: 'margin-top:12px' }, el('table', { class: 't' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Path'), el('th', {}, 'Size'))),
          el('tbody', {}, ...(plan.files || []).slice(0, 30).map(f => el('tr', {}, el('td', { class: 'mono', style: 'font-size:12px' }, f.path), el('td', { class: 'num mono', style: 'font-size:12px' }, fmtBytes(f.size))))))),
        el('div', { style: 'margin-top:12px;display:flex;gap:8px;align-items:center' },
          el('code', { style: 'background:var(--panel-3);padding:6px 10px;border-radius:8px;font-size:12px' }, plan.command),
          el('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(plan.command); toast('Command copied'); } }, 'Copy')),
        actionBox,
      );
      renderAction(actionBox, plan);
    } catch (err) { resultWrap.innerHTML = ''; resultWrap.append(errorPanel(err)); }
  }

  // The dry-run plan above answers "what would this download?" — this is
  // the missing "act on it" step the product is framed around (goal →
  // evidence → plan → action → artifact). full-train genuinely transfers
  // the whole dataset (100+ GB for datasets like ds000117), so per the
  // backend's own contract (`/dataset/{id}/download` docstring) the UI
  // must get an explicit confirmation before submitting that one preset —
  // the other three are metadata/small-subset capped by design server-side.
  function renderAction(box, plan) {
    box.innerHTML = '';
    const startBtn = el('button', { class: 'btn btn-green', onclick: onStart }, `Start download (${fmtBytes(plan.estimated_bytes)})`);
    box.append(startBtn);

    function onStart() {
      if (active === 'full-train') {
        box.innerHTML = '';
        box.append(
          el('p', { style: 'color:var(--warn);font-size:13px;margin-bottom:8px' },
            `This transfers the entire dataset — ${fmtBytes(plan.estimated_bytes)} across ${(plan.files || []).length} files — for real, to this machine. Confirm before continuing.`),
          el('div', { style: 'display:flex;gap:8px' },
            el('button', { class: 'btn btn-green', onclick: submit }, 'Confirm — start full download'),
            el('button', { class: 'btn btn-sm', onclick: () => renderAction(box, plan) }, 'Cancel')),
        );
      } else {
        submit();
      }
    }

    async function submit() {
      box.innerHTML = '';
      box.append(skeletonPanel(60), el('p', { class: 'sub', style: 'margin-top:8px' }, 'Submitting to the job queue…'));
      try {
        const job = await Api.download(id, { preset: active });
        box.innerHTML = '';
        box.append(
          el('p', {}, `Download job started: `, el('code', {}, job.id)),
          el('p', { class: 'sub' }, 'Bytes are moving now, in the background. Track progress and the final per-file result in Plans & Jobs.'),
          el('a', { class: 'btn btn-sm', href: '#/plans', style: 'margin-top:8px' }, 'Open Plans & Jobs'),
        );
        toast(`Download started — job ${job.id}`);
      } catch (err) { box.innerHTML = ''; box.append(errorPanel(err)); }
    }
  }
  run();
}

/* --- Compatibility (dataset-side) --- */
async function tabCompat(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = '';
  body.append(waitPanel('Building a source profile from a remote signal-budget scan.', { height: 200 }));
  try {
    const resp = await Api.compatibility(id);
    body.innerHTML = '';
    body.append(panel('Compatibility', 'contract-compatible only — never a performance claim', el('div', { class: 'tblw' },
      el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Model'), el('th', {}, 'Verdict'), el('th', {}, 'Required transforms'))),
        el('tbody', {}, ...resp.reports.map(r => el('tr', {},
          el('td', {}, r.model_id),
          el('td', {}, verdictChip(r.status)),
          el('td', {}, (r.required_transforms || []).map(t => t.kind).join(', ') || '—'),
        ))),
      ))));
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}
function verdictChip(status) {
  const map = { compatible: 'confirmed', compatible_with_transforms: 'inferred', uncertain: 'unknown', incompatible: 'blocked' };
  return evChip(map[status] ?? 'unknown', status);
}

/* ---------- Explore (v1 capability: goal builder + hybrid search) ---------- */
async function viewExplore() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' }, el('div', { class: 'eyebrow' }, 'Discovery'), el('h1', {}, 'Explore'),
    el('p', { class: 'ds-meta' }, 'Rank datasets against a goal via Qortex’s DatasetSelector, or search the local cache + live OpenNeuro together.')));

  const modSel = el('select', {}, el('option', { value: '' }, 'Any'), ...['eeg', 'meg', 'ieeg', 'bold', 'mri'].map(m => el('option', { value: m }, m.toUpperCase())));
  const minSubj = el('input', { type: 'number', min: 0, placeholder: 'any', style: 'width:90px' });
  const openLic = el('input', { type: 'checkbox' });
  const goalResult = el('div', { style: 'margin-top:14px' });
  wrap.append(panel('Goal Builder', 'ranks via DatasetSelector.find() — live OpenNeuro scoring', el('div', {},
    el('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:end' },
      labeled('Modality', modSel), labeled('Min subjects', minSubj), labeled('Open license only', openLic, true),
      el('button', { class: 'btn btn-green', onclick: runGoal }, 'Find & rank')),
    goalResult)));

  async function runGoal() {
    goalResult.innerHTML = ''; goalResult.append(waitPanel('Scoring candidates via DatasetSelector.find() against live OpenNeuro.', { height: 160 }));
    try {
      const fitness = await Api.goalFind({ modality: modSel.value || undefined, min_subjects: +minSubj.value || undefined, license_must_be_open: openLic.checked, limit: 8 });
      goalResult.innerHTML = '';
      if (!fitness.length) { goalResult.append(el('p', { class: 'sub' }, 'No matches — try relaxing the goal.')); return; }
      goalResult.append(el('div', { class: 'tblw' }, el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Dataset'), el('th', {}, 'Score'), el('th', {}, 'Recommendation'))),
        el('tbody', {}, ...fitness.map((f, i) => el('tr', {},
          el('td', {}, `#${i + 1}`), el('td', {}, el('a', { href: `#/ds/${f.dataset_id}/overview` }, f.dataset_id)),
          el('td', { class: 'num' }, `${Math.round(f.total_score)}/100`), el('td', {}, f.recommendation)))))));
    } catch (err) { goalResult.innerHTML = ''; goalResult.append(errorPanel(err)); }
  }

  let searchInput;
  const searchResult = el('div', { style: 'margin-top:14px' });
  const facetRail = el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap;margin-bottom:12px' }, skeletonPanel(40));
  const activeChips = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px' });
  // active facet selections — a real single value per dimension, matching
  // what /search/hybrid actually accepts server-side (one modality/task/
  // license per query, not an arbitrary OR-set), so this never promises
  // filtering the backend can't perform.
  const active = { modality: null, task: null, license: null };

  wrap.append(panel('Search', 'local cache + live OpenNeuro, filtered by catalog facets', el('div', {},
    facetRail,
    activeChips,
    el('div', { style: 'display:flex;gap:10px' },
      (() => { const i = el('input', { type: 'text', placeholder: 'Search datasets…', style: 'flex:1' });
        i.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); }); searchInput = i; return i; })(),
      el('button', { class: 'btn', onclick: () => runSearch() }, 'Search')),
    searchResult)));

  Api.catalogFacets(30).then(f => {
    facetRail.innerHTML = '';
    const groups = [['modality', 'Modality', f.modalities], ['task', 'Task', f.tasks], ['license', 'License', f.licenses]];
    groups.forEach(([key, label, items]) => {
      if (!items?.length) return;
      facetRail.append(el('div', {},
        el('div', { class: 'sub', style: 'font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px' }, label),
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;max-width:280px' },
          ...items.slice(0, 8).map(it => el('button', {
            class: 'chip', title: it.value.length > 28 ? it.value : null,
            style: 'cursor:pointer;border:1px solid var(--line);background:var(--panel-2);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block',
            'aria-pressed': 'false',
            onclick: (e) => {
              const was = active[key] === it.value;
              active[key] = was ? null : it.value;
              facetRail.querySelectorAll(`[data-facet="${key}"]`).forEach(b => b.setAttribute('aria-pressed', 'false'));
              if (!was) e.currentTarget.setAttribute('aria-pressed', 'true');
              renderActiveChips(); runSearch();
            },
            'data-facet': key,
          }, facetLabel(it.value), ` (${it.n})`))),
      ));
    });
  }).catch(() => { facetRail.innerHTML = ''; });

  function renderActiveChips() {
    activeChips.innerHTML = '';
    Object.entries(active).filter(([, v]) => v).forEach(([key, v]) => {
      activeChips.append(el('span', { class: 'chip chip-green', title: v.length > 28 ? v : null, style: 'max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block' }, `${key}: ${facetLabel(v)}`,
        el('button', { style: 'margin-left:6px', 'aria-label': `Remove ${key} filter`, onclick: () => {
          active[key] = null;
          facetRail.querySelectorAll(`[data-facet="${key}"]`).forEach(b => b.setAttribute('aria-pressed', 'false'));
          renderActiveChips(); runSearch();
        } }, '✕')));
    });
  }

  async function runSearch() {
    const q = searchInput?.value ?? '';
    searchResult.innerHTML = ''; searchResult.append(waitPanel('Querying the local catalog and live OpenNeuro together.', { height: 160 }));
    try {
      const data = await Api.searchHybrid({ q, modality: active.modality, task: active.task, license: active.license, limit: 20 });
      const all = [...data.local, ...data.live];
      searchResult.innerHTML = '';
      if (!all.length) { searchResult.append(el('p', { class: 'sub' }, 'No matches — try removing a filter.')); return; }
      searchResult.append(el('div', { class: 'tblw' }, el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Dataset'), el('th', {}, 'Modalities'), el('th', {}, 'Source'))),
        el('tbody', {}, ...all.map(d => el('tr', {},
          el('td', {}, el('a', { href: `#/ds/${d.dataset_id}/overview` }, d.dataset_id), el('span', { style: 'color:var(--text-3)' }, ` ${d.name ?? ''}`)),
          el('td', {}, (d.modalities || []).join(', ')),
          el('td', {}, el('span', { class: 'chip' }, d._source === 'live' ? 'live OpenNeuro' : 'local cache'))))))));
    } catch (err) { searchResult.innerHTML = ''; searchResult.append(errorPanel(err)); }
  }
  main.append(wrap);
  runSearch();
}
function facetLabel(v) {
  // A handful of OpenNeuro datasets store the full license *text* (a whole
  // paragraph) in the license field instead of a short code like "CC0" —
  // real data, not a bug in the source, but rendering it unruncated blows
  // out any fixed-width chip/menu. Truncate for display only; filtering
  // still matches the exact untruncated value.
  return v.length > 28 ? v.slice(0, 26) + '…' : v;
}
function labeled(label, control, inline = false) {
  return el('label', { style: `display:flex;${inline ? 'flex-direction:row;align-items:center;gap:8px' : 'flex-direction:column;gap:4px'};font-size:12.5px;color:var(--text-2)` }, inline ? [control, label] : [label, control]);
}

/* ---------- Compose (v1 capability: cross-dataset CohortBuilder) ---------- */
async function viewCompose() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' }, el('div', { class: 'eyebrow' }, 'Cohorts & benchmarks'), el('h1', {}, 'Compose'),
    el('p', { class: 'ds-meta' }, 'Combine datasets into a cohort via Qortex’s CohortBuilder — subject-level filters, harmonization checks, live manifests.')));

  const selected = new Set();
  const chips = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
  const addInput = el('input', { type: 'text', placeholder: 'Add dataset ID (e.g. ds000117)', style: 'flex:1' });
  const modInput = el('input', { type: 'text', placeholder: 'e.g. eeg (optional)' });
  const resultWrap = el('div', { style: 'margin-top:14px' });

  function renderChips() {
    chips.innerHTML = '';
    if (!selected.size) { chips.append(el('p', { class: 'sub' }, 'No datasets selected.')); return; }
    [...selected].forEach(id => chips.append(el('span', { class: 'chip' }, id, el('button', { style: 'margin-left:4px', onclick: () => { selected.delete(id); renderChips(); compute(); } }, '✕'))));
  }
  renderChips();

  wrap.append(panel('Selected datasets', null, el('div', {}, chips,
    el('div', { style: 'display:flex;gap:8px;margin-top:10px' }, addInput,
      el('button', { class: 'btn btn-sm', onclick: () => { const v = addInput.value.trim(); if (v) { selected.add(v); addInput.value = ''; renderChips(); compute(); } } }, 'Add')))));
  wrap.append(panel('Requirements', null, labeled('Require modality', modInput)));
  wrap.append(resultWrap);

  async function compute() {
    resultWrap.innerHTML = '';
    if (selected.size < 2) { resultWrap.append(el('p', { class: 'sub' }, 'Select at least two datasets.')); return; }
    resultWrap.append(waitPanel(`Building the cohort across ${selected.size} datasets via CohortBuilder.`, { height: 200 }));
    try {
      const res = await Api.cohortCompose({ dataset_ids: [...selected], require_modality: modInput.value.trim() || null, run_harmonization: true });
      const entries = res.dataset_entries || [], subjects = res.subjects || [];
      resultWrap.innerHTML = '';
      resultWrap.append(panel('Composition', `${fmt(subjects.length)} qualifying subjects across ${entries.length} datasets`, el('div', { class: 'tblw' },
        el('table', { class: 't' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Dataset'), el('th', {}, 'Selected'), el('th', {}, 'Excluded'), el('th', {}, 'Reasons'))),
          el('tbody', {}, ...entries.map(d => el('tr', {},
            el('td', {}, d.dataset_id), el('td', { class: 'num' }, `${d.n_subjects_selected}/${d.n_subjects_total}`),
            el('td', { class: 'num' }, d.n_subjects_excluded),
            el('td', { class: 'sub' }, Object.entries(d.exclusion_reasons || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'),
          ))),
        ))));
    } catch (err) { resultWrap.innerHTML = ''; resultWrap.append(errorPanel(err)); }
  }
  main.append(wrap);
  modInput.addEventListener('change', compute);
}

/* ---------- Compatibility (v1 capability, global model×dataset) ---------- */
async function viewCompatibility() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' }, el('div', { class: 'eyebrow' }, 'Models × data'), el('h1', {}, 'Compatibility'),
    el('p', { class: 'ds-meta' }, 'CompatibilityEngine checks against a curated model-contract catalog.')));
  const body = el('div', { style: 'margin-top:14px' }, skeletonPanel(160));
  wrap.append(body);
  main.append(wrap);
  try {
    const models = await Api.models();
    const sel = el('select', {}, ...models.map(m => el('option', { value: m.id }, `${m.id} (${m.provider})`)));
    const dsInput = el('input', { type: 'text', placeholder: 'ds000117, ds000001, …', style: 'flex:1' });
    const resultWrap = el('div', { style: 'margin-top:14px' });
    body.innerHTML = '';
    body.append(panel('Model contract', null, el('div', {},
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, labeled('Model', sel), labeled('Datasets', dsInput),
        el('button', { class: 'btn btn-green', onclick: run }, 'Check')),
      resultWrap)));
    async function run() {
      const ids = dsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      if (!ids.length) return;
      resultWrap.innerHTML = ''; resultWrap.append(waitPanel(`Building signal-budget profiles for ${ids.length} dataset(s) from remote metadata.`, { height: 140 }));
      const rows = await Promise.all(ids.map(async id => {
        try { const r = await Api.compatibility(id, { model_id: sel.value }); return { id, report: r.reports[0] }; }
        catch (err) { return { id, error: err.message }; }
      }));
      resultWrap.innerHTML = '';
      resultWrap.append(el('div', { class: 'tblw' }, el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Dataset'), el('th', {}, 'Verdict'), el('th', {}, 'Transforms'))),
        el('tbody', {}, ...rows.map(r => el('tr', {},
          el('td', {}, el('a', { href: `#/ds/${r.id}/overview` }, r.id)),
          el('td', {}, r.error ? el('span', { class: 'sub' }, r.error) : verdictChip(r.report.status)),
          el('td', {}, r.report ? (r.report.required_transforms || []).map(t => t.kind).join(', ') || '—' : '—'),
        ))))));
    }
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}

/* ---------- Plans & Jobs ---------- */
async function viewPlans() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' }, el('div', { class: 'eyebrow' }, 'Runtime'), el('h1', {}, 'Plans & Jobs')));
  const body = el('div', {}, skeletonPanel(200));
  wrap.append(body);
  main.append(wrap);
  let expanded = null; // job id currently showing its real result/log
  // The list polls every 4s to catch running→done transitions, but a job's
  // own detail panel (once done/error) is finished changing and may hold
  // interactive state a user triggered inside it (e.g. a content-status
  // check result) — cache the actual rendered node per finished job id and
  // re-append the same element on each poll instead of rebuilding it, or
  // that state is silently wiped out every 4 seconds.
  const finishedDetailCache = new Map();

  async function refresh() {
    try {
      const jobs = await Api.jobs();
      body.innerHTML = '';
      if (!jobs.length) { body.append(panel('Recent activity', null, el('p', { class: 'sub' }, 'No jobs run yet this session.'))); return; }
      const rows = el('div', {});
      jobs.forEach(j => {
        const row = el('button', {
          class: 'qrow', style: 'width:100%;text-align:left;background:none;border:none;cursor:pointer;font:inherit',
          'aria-expanded': String(expanded === j.id),
          onclick: () => { expanded = expanded === j.id ? null : j.id; refresh(); },
        },
          el('span', { class: `qmark-s q-${j.status === 'done' ? 'pass' : j.status === 'error' ? 'fail' : 'warn'}` }),
          el('div', { style: 'flex:1' }, el('div', {}, j.label),
            el('div', { class: 'qfile' }, `${j.status} · started ${new Date(j.started_at * 1000).toLocaleTimeString()}${j.status === 'running' && j.progress ? ` · ${j.progress}%` : ''}`),
            // Job.progress is real (updated per file as it completes — see
            // atlas_jobs.submit(report_progress=True)), not a fake ticker;
            // only shown while genuinely in flight and non-zero.
            j.status === 'running' && j.progress > 0
              ? el('div', { class: 'jprog' }, el('div', { style: `width:${j.progress}%` }))
              : null));
        rows.append(row);
        if (expanded === j.id) {
          let node = finishedDetailCache.get(j.id);
          if (!node) {
            node = jobDetail(j);
            if (j.status !== 'running') finishedDetailCache.set(j.id, node);
          }
          rows.append(node);
        }
      });
      body.innerHTML = '';
      body.append(panel('Recent activity', 'click a job for its result and log', rows));
    } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
  }

  function jobDetail(j) {
    const box = el('div', { style: 'padding:14px 16px;border-bottom:1px solid var(--line);background:var(--panel-2)' }, skeletonPanel(60));
    Api.job(j.id).then(full => {
      box.innerHTML = '';
      if (full.status === 'error') { box.append(el('p', { style: 'color:var(--fail);font-size:13px' }, full.error || 'Job failed.')); }
      else if (full.status === 'running') { box.append(el('p', { class: 'sub' }, 'Still running — this panel refreshes automatically.')); }
      else {
        const r = full.result;
        // A real DownloadResult (see qortex.core.entities) exposes exactly
        // these five names once `to_jsonable` includes computed properties;
        // other job kinds (catalog refresh, deep inspect) have a different
        // shape, so fall back to a plain key/value dump rather than assume.
        if (r && typeof r.n_downloaded === 'number') {
          box.append(el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap;font-size:13px' },
            el('span', {}, el('b', {}, String(r.n_downloaded)), ' downloaded'),
            el('span', {}, el('b', {}, String(r.n_skipped)), ' skipped (cache hit)'),
            el('span', { style: r.n_failed ? 'color:var(--fail)' : '' }, el('b', {}, String(r.n_failed)), ' failed'),
            el('span', {}, el('b', {}, fmtBytes(r.bytes_downloaded)), ' transferred'),
            el('span', {}, el('b', {}, `${(r.elapsed ?? 0).toFixed(1)}s`), ' elapsed')));
          if (r.failed?.length) box.append(el('div', { class: 'sub', style: 'margin-top:8px;color:var(--fail)' },
            `Failed: ${r.failed.map(f => f.path || f.recording_id || JSON.stringify(f)).slice(0, 5).join(', ')}`));
          if (r.plan?.target_dir) {
            const dsId = r.plan.dataset_id;
            const statusBox = el('div', { style: 'margin-top:10px' });
            statusBox.append(el('button', {
              class: 'btn btn-sm',
              onclick: async () => {
                statusBox.innerHTML = ''; statusBox.append(skeletonPanel(50));
                try {
                  // Answers a real DataLad/git-annex-era pain point: is what
                  // landed on disk actual file bytes, or pointer/placeholder
                  // files that only look downloaded? Checks the exact
                  // directory this job just wrote to — never a guessed path.
                  const cs = await Api.contentStatus(dsId, { local_path: r.plan.target_dir });
                  statusBox.innerHTML = '';
                  statusBox.append(el('div', { style: 'font-size:12.5px' },
                    el('div', {}, el('b', {}, cs.status), ` — ${cs.n_files} files on disk at `, el('code', {}, cs.path)),
                    el('div', { class: 'sub', style: 'margin-top:4px' },
                      `${cs.n_zero_byte} zero-byte · ${cs.n_annex_pointer_like} pointer-like · ${cs.n_missing_remote} missing · ${cs.n_extra_local} extra · ${cs.n_size_mismatches} size mismatches`),
                    ...(cs.findings || []).map(f => el('div', { style: `margin-top:4px;color:${f.severity === 'error' ? 'var(--fail)' : 'var(--warn)'}` }, f.message))));
                } catch (err) { statusBox.innerHTML = ''; statusBox.append(errorPanel(err)); }
              },
            }, 'Check local content status'));
            box.append(statusBox);
          }
        } else if (r) {
          box.append(el('pre', { class: 'mono', style: 'font-size:11.5px;white-space:pre-wrap;margin:0' }, JSON.stringify(r, null, 2).slice(0, 2000)));
        } else {
          box.append(el('p', { class: 'sub' }, 'No result payload for this job.'));
        }
      }
      if (full.log?.length) box.append(el('pre', { class: 'mono', style: 'font-size:11px;color:var(--text-3);margin-top:8px;white-space:pre-wrap' }, full.log.join('\n')));
    }).catch(err => { box.innerHTML = ''; box.append(errorPanel(err)); });
    return box;
  }

  await refresh();
  const iv = setInterval(() => { if (!document.body.contains(wrap)) { clearInterval(iv); return; } refresh(); }, 4000);
}

/* ---------- Settings ---------- */
async function viewSettings() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' }, el('div', { class: 'eyebrow' }, 'Configuration'), el('h1', {}, 'Settings')));
  const body = el('div', {}, skeletonPanel(140));
  wrap.append(body);
  main.append(wrap);
  async function load() {
    try {
      const status = await Api.storeStatus();
      body.innerHTML = '';
      body.append(
        panel('Local catalog cache', null, el('div', {},
          el('dl', { class: 'kv' }, el('dt', {}, 'Datasets cached'), el('dd', {}, String(status.n_datasets)), el('dt', {}, 'Deep-profiled'), el('dd', {}, String(status.n_profiled)), el('dt', {}, 'Path'), el('dd', {}, status.db_path)),
          el('button', { class: 'btn btn-green', style: 'margin-top:12px', onclick: doRefresh }, 'Refresh catalog (2 pages)'))),
        panel('Appearance', null, el('button', { class: 'btn', onclick: toggleTheme }, 'Toggle light / dark')),
        panel('Engine', null, el('p', { class: 'sub' }, `API base: ${Api.base}`)),
      );
    } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
  }
  async function doRefresh() {
    toast('Refreshing from OpenNeuro…');
    try { const r = await Api.catalogRefresh(2); toast(`Indexed ${r.datasets_indexed} datasets.`); await load(); }
    catch (err) { toast(err.message, 'fail'); }
  }
  load();
}

/* ================= router / chrome ================= */
function route() {
  const h = location.hash.replace(/^#\//, '');
  const [top, a, b] = h.split('/');
  main.innerHTML = ''; main.focus();
  document.querySelectorAll('.side a[data-nav]').forEach(n => n.removeAttribute('aria-current'));
  const mark = (k) => document.querySelector(`.side a[data-nav="${k}"]`)?.setAttribute('aria-current', 'page');

  if (!top) { viewHome(); mark('atlas'); }
  else if (top === 'explore') { viewExplore(); mark('explore'); }
  else if (top === 'datasets') { viewDatasets(); mark('datasets'); }
  else if (top === 'ds') {
    const tab = DS_TABS.includes(b) ? b : 'overview';
    viewDataset(a, tab);
    // dataset sections live only in the in-page tab strip (dsHeader); the
    // sidebar has no per-tab entries to highlight, so mark its nearest
    // ancestor destination — wherever the user came from to reach a dataset.
    mark('datasets');
  }
  else if (top === 'compose') { viewCompose(); mark('compose'); }
  else if (top === 'compatibility') { viewCompatibility(); mark('compat'); }
  else if (top === 'plans') { viewPlans(); mark('plans'); }
  else if (top === 'settings') { viewSettings(); mark('settings'); }
  else { viewHome(); mark('atlas'); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* theme */
function toggleTheme() {
  const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur;
  localStorage.setItem('qatlas-theme', cur);
  announce(`Theme: ${cur}`);
}
$('#theme-btn').addEventListener('click', toggleTheme);
document.documentElement.dataset.theme = localStorage.getItem('qatlas-theme') ?? 'dark';

/* store status dot (topbar) */
(async function pollStore() {
  try {
    const s = await Api.storeStatus();
    $('#store-dot').title = `Local catalog: ${s.n_datasets} datasets cached, ${s.n_profiled} deep-profiled.`;
  } catch { $('#store-dot').title = 'Backend unreachable.'; }
})();

/* command palette — real catalog search */
const veil = $('#cmdk'), cin = $('#cmdk-in'), cout = $('#cmdk-out');
let citems = [], csel = -1;
function openCmdk() { veil.hidden = false; cin.value = ''; renderCmdk(''); requestAnimationFrame(() => cin.focus()); }
function closeCmdk() { veil.hidden = true; $('#search-btn').focus(); }
async function renderCmdk(q) {
  const ql = q.trim();
  citems = [];
  if (/^ds\d{4,6}$/i.test(ql)) citems.push({ label: `Open ${ql} (live fetch)`, k: 'dataset', href: `#/ds/${ql.toLowerCase()}/overview` });
  try {
    const rows = await Api.catalogSearch({ q: ql || undefined, limit: 8 });
    rows.forEach(d => citems.push({ label: `${d.dataset_id} — ${d.name ?? ''}`, k: 'dataset', href: `#/ds/${d.dataset_id}/overview` }));
  } catch { /* local cache may be empty */ }
  [['Explore', '#/explore'], ['Datasets', '#/datasets'], ['Compose', '#/compose'], ['Compatibility', '#/compatibility'], ['Plans & Jobs', '#/plans'], ['Settings', '#/settings']].forEach(([l, href]) => {
    if (!ql || l.toLowerCase().includes(ql.toLowerCase())) citems.push({ label: l, k: 'page', href });
  });
  cout.innerHTML = '';
  citems.slice(0, 14).forEach((it, i) => {
    const li = el('li', { role: 'option', id: `co-${i}`, 'aria-selected': 'false', onclick: () => { closeCmdk(); location.hash = it.href; } }, it.label, el('span', { class: 'k' }, it.k));
    li.addEventListener('mouseenter', () => setSel(i));
    cout.append(li);
  });
  setSel(citems.length ? 0 : -1);
}
function setSel(i) {
  csel = i;
  [...cout.children].forEach((n, idx) => n.setAttribute('aria-selected', String(idx === i)));
  cin.setAttribute('aria-activedescendant', i >= 0 ? `co-${i}` : '');
  cout.children[i]?.scrollIntoView({ block: 'nearest' });
}
cin.addEventListener('input', () => renderCmdk(cin.value));
cin.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(csel + 1, cout.children.length - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(csel - 1, 0)); }
  else if (e.key === 'Enter' && csel >= 0) { cout.children[csel].click(); }
  else if (e.key === 'Escape') closeCmdk();
});
veil.addEventListener('click', (e) => { if (e.target === veil) closeCmdk(); });
$('#search-btn').addEventListener('click', openCmdk);
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); veil.hidden ? openCmdk() : closeCmdk(); }
  if (e.key === 'Escape' && !veil.hidden) closeCmdk();
});
$('#bell-btn').addEventListener('click', async () => {
  try { const jobs = await Api.jobs(); toast(jobs.length ? `${jobs.length} job(s) this session — see Plans & Jobs.` : 'No jobs run yet this session.'); }
  catch { toast('Backend unreachable.', 'fail'); }
});

route();
