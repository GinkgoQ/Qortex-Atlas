/* Qortex Atlas v2 — application. Views: home, datasets, dataset workspace
   (overview / bids / viewer / quality / cohort / graph / files), jobs, settings.
   All imagery is engine-preview style: procedural, deterministic, honest captions. */

import { DATASETS, TREE, FILE_META, KG, EEG_CHANNELS, PILLARS } from './data.js';

/* ================= tiny dom ================= */
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
const fmt = (n) => n.toLocaleString('en-US');
function announce(msg) { const r = $('#live'); r.textContent = ''; requestAnimationFrame(() => r.textContent = msg); }
function toast(msg) { const t = el('div', { class: 'toast', role: 'status' }, msg); $('#toasts').append(t); setTimeout(() => t.remove(), 4200); }
function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ================= charts ================= */
function donut({ size = 128, thick = 13, segs, centerVal, centerLab }) {
  const r = (size - thick) / 2, C = 2 * Math.PI * r, total = segs.reduce((a, s) => a + s.v, 0);
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

function histogram({ values, bins, w = 420, h = 130, color = 'var(--green-deep)' }) {
  const max = Math.max(...values), pad = { l: 6, r: 6, t: 8, b: 18 };
  const bw = (w - pad.l - pad.r) / values.length;
  const svg = sv('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img',
    'aria-label': `Histogram, ${values.length} bins, max ${fmt(max)}` });
  svg.append(sv('line', { x1: pad.l, y1: h - pad.b, x2: w - pad.r, y2: h - pad.b, class: 'axis' }));
  values.forEach((v, i) => {
    const bh = (v / max) * (h - pad.t - pad.b);
    const rect = sv('rect', { x: pad.l + i * bw + 1.5, y: h - pad.b - bh, width: bw - 3, height: bh, rx: 2, class: 'bar' });
    rect.append(sv('title', {})); rect.querySelector('title').textContent = `${bins?.[i] ?? i}: ${fmt(v)}`;
    svg.append(rect);
  });
  if (bins) [0, Math.floor(bins.length / 2), bins.length - 1].forEach(i => {
    const t = sv('text', { x: pad.l + i * bw + bw / 2, y: h - 5, 'text-anchor': 'middle', class: 'axis-t' });
    t.textContent = bins[i]; svg.append(t);
  });
  return svg;
}

function hbars(rows, { labelW = null } = {}) {
  const max = Math.max(...rows.map(r => r.count));
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

/* ================= procedural MRI (engine-preview style) ================= */
/* Draw a plausible brain slice per plane. Deterministic; labeled schematic. */
function drawSlice(canvas, { plane, slice, bright = 1, contrast = 1, overlay = null }) {
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const depth = Math.sin(Math.PI * Math.min(Math.max(slice, 0.04), 0.96)); // feature scale by slice
  const rnd = seeded(Math.floor(slice * 977) + plane.length * 131);

  ctx.save();
  ctx.translate(cx, cy);

  const rx = (plane === 'sagittal' ? 0.40 : 0.34) * W * (0.55 + 0.45 * depth);
  const ry = (plane === 'axial' ? 0.40 : 0.42) * H * (0.55 + 0.45 * depth);

  // skull
  ctx.beginPath(); ctx.ellipse(0, 0, rx * 1.09, ry * 1.09, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(190,190,188)'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, 0, rx * 1.03, ry * 1.03, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(24,24,24)'; ctx.fill();

  // brain body — cortical GM base
  const grad = ctx.createRadialGradient(0, 0, rx * 0.1, 0, 0, Math.max(rx, ry));
  grad.addColorStop(0, 'rgb(148,148,146)');
  grad.addColorStop(0.72, 'rgb(120,120,118)');
  grad.addColorStop(1, 'rgb(88,88,86)');
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
  ctx.clip(); // everything below stays inside the brain

  // white matter lobes
  ctx.fillStyle = 'rgb(176,176,172)';
  const lobes = plane === 'sagittal' ? 1 : 2;
  for (let s = 0; s < lobes; s++) {
    const sx = lobes === 2 ? (s === 0 ? -0.42 : 0.42) * rx : 0;
    ctx.beginPath(); ctx.ellipse(sx, -ry * 0.06, rx * (lobes === 2 ? 0.5 : 0.8), ry * 0.72, 0, 0, Math.PI * 2); ctx.fill();
  }

  // gyri: wavy darker bands
  ctx.strokeStyle = 'rgba(70,70,68,.55)'; ctx.lineWidth = Math.max(2, W * 0.012);
  for (let g = 0; g < 9; g++) {
    ctx.beginPath();
    const a0 = rnd() * Math.PI * 2, rr = (0.35 + rnd() * 0.6);
    for (let t = 0; t <= 1; t += 0.1) {
      const a = a0 + t * (1.1 + rnd() * 0.5);
      const wob = 1 + Math.sin(t * 14 + g) * 0.06;
      const x = Math.cos(a) * rx * rr * wob, y = Math.sin(a) * ry * rr * wob;
      t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // midline
  if (plane !== 'sagittal') {
    ctx.strokeStyle = 'rgba(40,40,40,.8)'; ctx.lineWidth = Math.max(2, W * 0.008);
    ctx.beginPath(); ctx.moveTo(0, -ry); ctx.lineTo(0, ry * (plane === 'axial' ? 0.2 : 1)); ctx.stroke();
  }

  // ventricles
  ctx.fillStyle = 'rgb(16,16,16)';
  if (plane === 'axial') {
    ctx.save(); ctx.scale(1, 1.4);
    ctx.beginPath(); ctx.ellipse(-rx * 0.16, -ry * 0.06, rx * 0.10 * depth, ry * 0.16 * depth, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(rx * 0.16, -ry * 0.06, rx * 0.10 * depth, ry * 0.16 * depth, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else if (plane === 'coronal') {
    ctx.beginPath(); ctx.ellipse(-rx * 0.18, -ry * 0.05, rx * 0.07 * depth, ry * 0.18 * depth, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(rx * 0.18, -ry * 0.05, rx * 0.07 * depth, ry * 0.18 * depth, -0.25, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.ellipse(rx * 0.05, -ry * 0.02, rx * 0.16 * depth, ry * 0.10 * depth, -0.3, 0, Math.PI * 2); ctx.fill();
    // cerebellum + brainstem hints
    ctx.fillStyle = 'rgb(105,105,103)';
    ctx.beginPath(); ctx.ellipse(-rx * 0.52, ry * 0.48, rx * 0.30, ry * 0.26, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgb(130,130,128)';
    ctx.beginPath(); ctx.ellipse(-rx * 0.18, ry * 0.62, rx * 0.10, ry * 0.30, 0.15, 0, Math.PI * 2); ctx.fill();
  }

  // fMRI activation overlay
  if (overlay === 'activation') {
    const blobs = [[-0.45, -0.15, 0.16], [0.4, -0.3, 0.2], [0.15, 0.35, 0.13], [-0.2, 0.15, 0.1]];
    blobs.forEach(([bx, by, br], i) => {
      const g2 = ctx.createRadialGradient(bx * rx, by * ry, 0, bx * rx, by * ry, br * rx * (0.7 + depth * 0.6));
      g2.addColorStop(0, 'rgba(244,201,93,.95)');
      g2.addColorStop(0.45, 'rgba(224,122,46,.8)');
      g2.addColorStop(1, 'rgba(163,58,18,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.ellipse(bx * rx, by * ry, br * rx * 1.6, br * ry * 1.6, 0, 0, Math.PI * 2); ctx.fill();
    });
  }
  ctx.restore();

  // film grain
  const noise = ctx.getImageData(0, 0, W, H), px = noise.data, nr = seeded(7 + Math.floor(slice * 100));
  for (let i = 0; i < px.length; i += 4) {
    const n = (nr() - 0.5) * 14;
    px[i] += n; px[i + 1] += n; px[i + 2] += n;
  }
  ctx.putImageData(noise, 0, 0);

  // brightness / contrast pass
  if (bright !== 1 || contrast !== 1) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = `brightness(${bright}) contrast(${contrast})`;
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
  }
}

function crosshair(canvas, fx, fy) {
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(134,194,154,.65)'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  ctx.beginPath(); ctx.moveTo(fx * canvas.width, 0); ctx.lineTo(fx * canvas.width, canvas.height); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, fy * canvas.height); ctx.lineTo(canvas.width, fy * canvas.height); ctx.stroke();
  ctx.setLineDash([]);
}

/* ================= views ================= */
const main = $('#main');

function panel(title, sub, body, headExtra) {
  return el('section', { class: 'panel' },
    el('div', { class: 'panel-h' }, el('h3', {}, title), sub ? el('span', { class: 'sub' }, sub) : null, el('span', { class: 'sp' }), headExtra ?? null),
    el('div', { class: 'panel-b' }, body));
}

/* ---------- Home ---------- */
function viewHome() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(
    el('div', { class: 'hero' },
      el('span', { class: 'qmark', 'aria-hidden': 'true', html: $('.side-brand .qmark').innerHTML }),
      el('div', { class: 'hero-brand' }, 'Qortex'),
      el('h1', { class: 'hero-title' }, 'Qortex ', el('span', { class: 't-atlas' }, 'Atlas')),
      el('p', { class: 'hero-tag' }, el('b', {}, 'Explore'), el('span', { class: 'dot' }, '. '), el('b', {}, 'Inspect'), el('span', { class: 'dot' }, '. '), el('b', {}, 'Understand'), ' neurodata', el('span', { class: 'dot' }, '.')),
      el('div', { class: 'hero-actions' },
        el('a', { class: 'btn btn-green', href: '#/ds/ds000117/overview' }, 'Open ds000117 · Cam-CAN'),
        el('a', { class: 'btn', href: '#/datasets' }, 'Browse datasets')),
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
  wrap.append(el('div', { class: 'pillars' }, ...PILLARS.map(p =>
    el('div', { class: 'pillar' },
      (() => { const s = sv('svg', { viewBox: '0 0 34 34', class: 'pic' }); s.classList.add('pic');
        s.append(sv('path', { d: pillarIcs[p.ic] ?? pillarIcs.cube, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })); return s; })(),
      el('h3', {}, p.h), el('p', {}, p.p)))));
  main.append(wrap);
}

/* ---------- Datasets list ---------- */
function viewDatasets() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' },
    el('div', { class: 'eyebrow' }, 'Local store'),
    el('h1', {}, 'Datasets'),
    el('p', { class: 'ds-meta' }, `${DATASETS.length} datasets indexed from `, el('b', {}, 'OpenNeuro'), ' · refreshed 41 min ago')));
  wrap.append(panel('All datasets', null, el('div', { class: 'tblw' },
    el('table', { class: 't' },
      el('thead', {}, el('tr', {}, ...['Dataset', 'Subjects', 'Modalities', 'Tasks', 'Size', 'Readiness', ''].map(h => el('th', {}, h)))),
      el('tbody', {}, ...DATASETS.map(d => el('tr', {},
        el('td', {}, el('a', { href: `#/ds/${d.id}/overview` }, el('b', {}, d.id)), el('span', { style: 'color:var(--text-3)' }, ` ${d.name}`)),
        el('td', { class: 'num' }, fmt(d.subjects)),
        el('td', {}, d.modalities.map(m => m.key).join(' · ')),
        el('td', {}, (d.tasks ?? []).slice(0, 3).map(t => t.key).join(' · ')),
        el('td', { class: 'num' }, d.sizeTB >= 1 ? `${d.sizeTB} TB` : `${Math.round(d.sizeTB * 1000)} GB`),
        el('td', {}, el('span', { class: 'chip-green chip' }, `${d.readiness.pct}% ready`)),
        el('td', {}, el('a', { class: 'btn btn-sm', href: `#/ds/${d.id}/overview` }, 'Open')),
      )))))));
  main.append(wrap);
}

/* ---------- Dataset workspace ---------- */
const DS_TABS = ['overview', 'bids', 'viewer', 'quality', 'cohort', 'graph', 'files'];

function dsHeader(d, tab) {
  const head = el('div', { class: 'ds-head' },
    el('div', { class: 'eyebrow' }, 'Dataset'),
    el('div', { class: 'ds-title-row' },
      el('h1', { class: 'mono' }, d.id), el('span', { class: 'ds-name' }, d.name),
      el('span', { class: 'ds-badge' }, 'Dataset')),
    el('p', { class: 'ds-meta' }, `${d.source} · `, el('b', {}, `${fmt(d.subjects)} subjects`), ` · ${d.modalities.length} modalities · ${d.visibility}`),
    el('nav', { class: 'tabs', 'aria-label': 'Dataset sections' },
      ...DS_TABS.map(t => el('a', {
        href: `#/ds/${d.id}/${t}`, 'aria-current': t === tab ? 'page' : null,
      }, t === 'bids' ? 'BIDS' : t[0].toUpperCase() + t.slice(1)))),
  );
  return head;
}

function viewDataset(id, tab) {
  const d = DATASETS.find(x => x.id === id) ?? DATASETS[0];
  const wrap = el('div', { class: 'wrap' });
  wrap.append(dsHeader(d, tab));
  const body = el('div', {});
  wrap.append(body);
  main.append(wrap);
  ({ overview: tabOverview, bids: tabBids, viewer: tabViewer, quality: tabQuality, cohort: tabCohort, graph: tabGraph, files: tabFiles }[tab] ?? tabOverview)(body, d);
}

/* --- overview (bento) --- */
function tabOverview(body, d) {
  const bento = el('div', { class: 'bento' });
  const r = d.readiness;
  bento.append(
    el('div', { class: 'span-3 panel' }, el('div', { class: 'panel-h' }, el('h3', {}, 'Readiness')), el('div', { class: 'panel-b' },
      el('div', { class: 'donut-wrap' },
        donut({ segs: [
          { label: 'Passed', v: r.passed, color: 'var(--good)' },
          { label: 'Warnings', v: r.warnings, color: 'var(--warn)' },
          { label: 'Failed', v: r.failed, color: 'var(--fail)' }],
          centerVal: `${r.pct}%`, centerLab: 'Ready' }),
        el('ul', { class: 'legend' },
          el('li', {}, el('span', { class: 'dot', style: 'background:var(--good)' }), el('span', { class: 'll' }, 'Passed'), el('span', { class: 'lv' }, fmt(r.passed))),
          el('li', {}, el('span', { class: 'dot', style: 'background:var(--warn)' }), el('span', { class: 'll' }, 'Warnings'), el('span', { class: 'lv' }, fmt(r.warnings))),
          el('li', {}, el('span', { class: 'dot', style: 'background:var(--fail)' }), el('span', { class: 'll' }, 'Failed'), el('span', { class: 'lv' }, fmt(r.failed))))))),
    el('div', { class: 'span-3 panel' }, el('div', { class: 'panel-h' }, el('h3', {}, 'Modalities')), el('div', { class: 'panel-b' },
      el('div', { class: 'mod-grid' }, ...d.modalities.map(m => el('div', { class: 'mod-tile' },
        el('span', { class: 'mod-ic', html: modIcon(m.key) }),
        el('div', {}, el('div', { class: 'mod-name' }, m.key), el('div', { class: 'mod-count' }, fmt(m.count)))))))),
    el('div', { class: 'span-3 panel' }, el('div', { class: 'panel-h' }, el('h3', {}, 'Subjects')), el('div', { class: 'panel-b' },
      el('div', { class: 'stat-big' }, fmt(d.subjects)),
      el('div', { class: 'stat-note' }, `Age ${d.ageRange} (Mean ${d.ageMean})`),
      d.ageHist ? histogram({ values: d.ageHist, bins: d.ageBins, w: 300, h: 110 }) : null)),
    el('div', { class: 'span-3 panel' }, el('div', { class: 'panel-h' }, el('h3', {}, 'Tasks')), el('div', { class: 'panel-b' },
      hbars((d.tasks ?? []).slice(0, 6)))),
  );
  // second row: quick BIDS + viewer teasers
  bento.append(
    el('div', { class: 'span-6 panel' },
      el('div', { class: 'panel-h' }, el('h3', {}, 'Quality — latest findings'), el('span', { class: 'sp' }), el('a', { class: 'btn btn-sm', href: `#/ds/${d.id}/quality` }, 'All checks')),
      el('div', {}, ...(d.quality ?? []).slice(0, 4).map(q => qrow(q)))),
    el('div', { class: 'span-6 panel' },
      el('div', { class: 'panel-h' }, el('h3', {}, 'Anatomical preview'), el('span', { class: 'sub' }, 'engine preview — schematic, not diagnostic'), el('span', { class: 'sp' }), el('a', { class: 'btn btn-sm', href: `#/ds/${d.id}/viewer` }, 'Open viewer')),
      el('div', { class: 'panel-b' }, miniPlanes())),
  );
  body.append(bento);
}
function qrow(q) {
  return el('div', { class: 'qrow' },
    el('span', { class: `qmark-s q-${q.level}` }),
    el('div', {}, el('div', {}, q.msg), el('div', { class: 'qfile' }, q.files)));
}
function modIcon(key) {
  const paths = {
    T1w: 'M8 15c0-5 4-8 7-8s7 3 7 8-3 8-7 8-7-3-7-8z', fMRI: 'M8 15c0-5 4-8 7-8s7 3 7 8-3 8-7 8-7-3-7-8zM11 12l3 3-3 3M19 12l-3 3 3 3',
    dMRI: 'M7 20c4-8 12-8 16 0M9 15c3-5 9-5 12 0M12 11c2-2 4-2 6 0', EEG: 'M6 15h3l2-5 3 10 2-6 2 3h6',
    MEG: 'M15 6a9 9 0 019 9M15 10a5 5 0 015 5M15 14a1.5 1.5 0 011.5 1.5', More: 'M9 15h.01M15 15h.01M21 15h.01',
  };
  return `<svg viewBox="0 0 30 30" width="17" height="17"><path d="${paths[key] ?? paths.More}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function miniPlanes() {
  const row = el('div', { class: 'planes' });
  ['sagittal', 'coronal', 'axial'].forEach(p => {
    const c = el('canvas', { width: 240, height: 190 });
    drawSlice(c, { plane: p, slice: 0.5 });
    row.append(el('div', { class: 'plane' }, c, el('span', { class: 'pl-tag' }, p[0].toUpperCase() + p.slice(1, 3))));
  });
  return row;
}

/* --- BIDS explorer --- */
function tabBids(body, d) {
  let selected = 'sub-01_task-rest_bold.nii.gz';
  const metaPane = el('div', {});
  let metaMode = 'meta';

  function renderMeta() {
    const m = FILE_META[selected] ?? { ...FILE_META.default, Name: selected };
    metaPane.innerHTML = '';
    if (metaMode === 'meta') {
      const kv = el('dl', { class: 'kv' });
      Object.entries(m).forEach(([k, v]) => kv.append(el('dt', {}, k), el('dd', {}, v)));
      metaPane.append(kv, el('div', { style: 'padding:12px 14px' },
        el('button', { class: 'btn btn-sm', onclick: () => { metaMode = 'json'; syncTabs(); renderMeta(); } }, 'View full JSON')));
    } else {
      const pre = el('pre', { class: 'jsonview' });
      pre.innerHTML = JSON.stringify(m, null, 2)
        .replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')
        .replace(/: "([^"]*)"/g, ': <span class="v">"$1"</span>');
      metaPane.append(pre);
    }
  }
  const tabsBar = el('div', { class: 'meta-tabs' },
    el('button', { 'aria-pressed': 'true', onclick: (e) => { metaMode = 'meta'; syncTabs(); renderMeta(); } }, 'Metadata'),
    el('button', { 'aria-pressed': 'false', onclick: (e) => { metaMode = 'json'; syncTabs(); renderMeta(); } }, 'JSON'));
  function syncTabs() { [...tabsBar.children].forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (metaMode === 'meta')))); }

  function nodeEl(node, depth = 0) {
    if (node.children) {
      const kidsUl = el('ul', {});
      node.children.forEach(ch => kidsUl.append(el('li', {}, nodeEl(ch, depth + 1))));
      const open = depth < 2 || (depth === 2 && node.name === 'func');
      kidsUl.hidden = !open;
      const btn = el('button', { class: 'fnode', 'aria-expanded': String(open) },
        el('span', { class: 'tw' }, open ? '▾' : '▸'), fico(node.kind), node.name);
      btn.addEventListener('click', () => {
        const isOpen = kidsUl.hidden === false;
        kidsUl.hidden = isOpen; btn.setAttribute('aria-expanded', String(!isOpen));
        btn.querySelector('.tw').textContent = isOpen ? '▸' : '▾';
      });
      return el('div', {}, btn, kidsUl);
    }
    const btn = el('button', { class: 'fnode', 'aria-selected': String(node.name === selected) },
      el('span', { class: 'tw' }), fico(node.kind), node.name, el('span', { class: 'fsize' }, node.size ?? ''));
    btn.addEventListener('click', () => {
      selected = node.name;
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

  const tree = el('div', { class: 'ftree', role: 'tree', 'aria-label': 'BIDS file tree' }, nodeEl(TREE));
  body.append(el('div', { class: 'explorer' },
    panel('BIDS / Manifest Explorer', `${fmt(d.subjects)} subjects`, tree),
    el('section', { class: 'panel meta-pane' },
      el('div', { class: 'panel-h' }, el('h3', {}, 'File metadata'), el('span', { class: 'sp' }), tabsBar),
      el('div', { class: 'panel-b' }, metaPane)),
  ));
  renderMeta();
}

/* --- Viewer --- */
function tabViewer(body, d) {
  const modes = [
    ['anat', 'Anatomical · T1w'], ['fmri', 'fMRI activation · n-back'], ['eeg', 'EEG · resting (19 ch)'],
    ['dwi', 'DWI · tractography'], ['image', 'Open any image…'],
  ];
  let mode = 'anat';
  const modeBar = el('div', { class: 'vmodes', role: 'group', 'aria-label': 'Viewer mode' });
  const stage = el('div', {});
  modes.forEach(([key, label]) => modeBar.append(el('button', {
    class: 'vmode', 'aria-pressed': String(key === mode),
    onclick: (e) => { mode = key; [...modeBar.children].forEach(b => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); render(); },
  }, label)));
  body.append(modeBar, stage);

  function render() {
    stage.innerHTML = '';
    if (mode === 'anat') stage.append(mriViewer({ overlay: null, title: 'MRI Viewer — Anatomical (T1w)' }));
    else if (mode === 'fmri') stage.append(mriViewer({ overlay: 'activation', title: 'fMRI Activation — Task: n-back', colorbar: true }));
    else if (mode === 'eeg') stage.append(eegViewer());
    else if (mode === 'dwi') stage.append(dwiViewer());
    else stage.append(imageViewer());
  }
  render();
}

function mriViewer({ overlay, title, colorbar }) {
  const state = { slice: 0.5, zoom: 1, bright: 1, contrast: 1, fx: 0.5, fy: 0.46 };
  const planes = ['sagittal', 'coronal', 'axial'];
  const canvases = planes.map(() => el('canvas', { width: 420, height: 330 }));

  function paintAll() {
    planes.forEach((p, i) => {
      const c = canvases[i];
      const ctx = c.getContext('2d');
      ctx.save();
      const z = state.zoom;
      ctx.setTransform(z, 0, 0, z, (1 - z) * c.width / 2, (1 - z) * c.height / 2);
      drawSlice(c, { plane: p, slice: state.slice, bright: state.bright, contrast: state.contrast, overlay });
      ctx.restore();
      crosshair(c, state.fx, state.fy);
    });
    sliceVal.textContent = `${Math.round(state.slice * 176)}/176`;
    zoomVal.textContent = `${state.zoom.toFixed(1)}×`;
  }

  const planeEls = planes.map((p, i) => {
    const holder = el('div', { class: 'plane' }, canvases[i],
      el('span', { class: 'pl-tag' }, p),
      el('span', { class: 'pl-or', style: 'left:8px;top:50%' }, p === 'sagittal' ? 'A' : 'R'),
      el('span', { class: 'pl-or', style: 'right:8px;top:50%' }, p === 'sagittal' ? 'P' : 'L'),
      el('span', { class: 'pl-or', style: 'top:22px;left:50%' }, 'S'));
    canvases[i].addEventListener('click', (e) => {
      const r = canvases[i].getBoundingClientRect();
      state.fx = (e.clientX - r.left) / r.width; state.fy = (e.clientY - r.top) / r.height;
      paintAll();
    });
    canvases[i].setAttribute('role', 'img');
    canvases[i].setAttribute('aria-label', `${p} slice, engine schematic preview. Click to move crosshair.`);
    return holder;
  });

  const sliceVal = el('span', { class: 'vv' }), zoomVal = el('span', { class: 'vv' });
  const bar = el('div', { class: 'viewer-bar' },
    slider('Slice', 4, 172, 88, (v) => { state.slice = v / 176; paintAll(); }, sliceVal),
    slider('Zoom', 10, 24, 10, (v) => { state.zoom = v / 10; paintAll(); }, zoomVal),
    slider('Bright', 5, 18, 10, (v) => { state.bright = v / 10; paintAll(); }),
    slider('Contrast', 5, 18, 10, (v) => { state.contrast = v / 10; paintAll(); }),
    colorbar ? el('span', { class: 'cbar' }, 'z 2.3', el('span', { class: 'ramp' }), '6.0') : null,
    el('span', { class: 'sp', style: 'flex:1' }),
    el('span', { class: 'sub', style: 'font-size:11px;color:var(--text-3)' }, 'engine schematic preview — not diagnostic imagery'),
  );

  paintAll();
  return panelWrap(title, el('div', {}, el('div', { class: 'planes' }, ...planeEls), bar));
}
function slider(label, min, max, val, oninput, valEl) {
  const inp = el('input', { type: 'range', min, max, value: val, 'aria-label': label });
  inp.addEventListener('input', () => oninput(+inp.value));
  return el('label', { class: 'vslider' }, label, inp, valEl ?? null);
}
function panelWrap(title, content) {
  return el('section', { class: 'panel' },
    el('div', { class: 'panel-h' }, el('h3', {}, title)),
    el('div', { class: 'panel-b' }, content));
}

function eegViewer() {
  const W = 1040, rowH = 26, secs = 20, H = EEG_CHANNELS.length * rowH + 42;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'eeg-svg', role: 'img',
    'aria-label': `EEG preview, ${EEG_CHANNELS.length} channels, ${secs} seconds` });
  for (let s = 0; s <= secs; s += 5) {
    const x = 52 + (s / secs) * (W - 70);
    svg.append(sv('line', { x1: x, y1: 8, x2: x, y2: H - 28, class: 'eeg-grid' }));
    const t = sv('text', { x, y: H - 12, 'text-anchor': 'middle', class: 'eeg-scale' }); t.textContent = `${s}s`; svg.append(t);
  }
  EEG_CHANNELS.forEach((ch, ci) => {
    const y0 = ci * rowH + rowH / 2 + 10;
    const lbl = sv('text', { x: 46, y: y0 + 3, 'text-anchor': 'end', class: 'eeg-ch' }); lbl.textContent = ch; svg.append(lbl);
    const r = seeded(ci * 991 + 17);
    let v = 0; const pts = [];
    const n = 900;
    for (let i = 0; i < n; i++) {
      v = v * 0.93 + (r() - 0.5) * 7;
      const alpha = Math.sin(i * 0.35 + ci) * 2.6 * (0.4 + Math.abs(Math.sin(i / 120 + ci)));
      const blink = ci < 2 && i % 260 < 8 ? Math.sin((i % 260) / 8 * Math.PI) * 14 : 0;
      const x = 52 + (i / (n - 1)) * (W - 70), y = y0 - (v + alpha + blink) * 0.55;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    svg.append(sv('polyline', { points: pts.join(' '), class: 'eeg-tr' }));
  });
  const scale = sv('g', {});
  scale.append(sv('line', { x1: W - 14, y1: H - 70, x2: W - 14, y2: H - 45, stroke: 'var(--text-3)', 'stroke-width': 1.2 }));
  const st = sv('text', { x: W - 18, y: H - 55, 'text-anchor': 'end', class: 'eeg-scale' }); st.textContent = '100 µV';
  scale.append(st); svg.append(scale);
  return panelWrap('EEG — Resting State (19 ch)', el('div', { class: 'eeg-wrap' }, svg));
}

function dwiViewer() {
  const c = el('canvas', { width: 1040, height: 480, role: 'img', 'aria-label': 'DWI tractography preview, direction-colored streamlines (schematic)' });
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, c.width, c.height);
  const rnd = seeded(20260703);
  const cx = c.width / 2, cy = c.height / 2 + 15;
  for (let i = 0; i < 420; i++) {
    const bundle = Math.floor(rnd() * 4);
    const t0 = rnd() * Math.PI;
    let x = cx + Math.cos(t0) * (150 + rnd() * 130) * (bundle === 1 ? 0.6 : 1);
    let y = cy + Math.sin(t0) * (60 + rnd() * 90) - (bundle === 2 ? 70 : 0);
    let ang = rnd() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    let dx = 0, dy = 0;
    for (let s = 0; s < 46; s++) {
      // steer along bundle-ish fields
      const toC = Math.atan2(cy - y, cx - x);
      const arc = bundle === 0 ? toC + Math.PI / 2 : bundle === 1 ? -Math.PI / 2 + Math.sin(x / 90) * 0.7 : bundle === 2 ? 0 + Math.sin(y / 60) * 0.5 : toC;
      ang += (arc - ang) * 0.16 + (rnd() - 0.5) * 0.35;
      dx = Math.cos(ang) * 9; dy = Math.sin(ang) * 6;
      x += dx; y += dy;
      ctx.lineTo(x, y);
    }
    const rr = Math.min(255, Math.abs(dx) * 26 + 40), gg = Math.min(255, Math.abs(dy) * 34 + 40), bb = 255 - Math.min(210, (Math.abs(dx) + Math.abs(dy)) * 16);
    ctx.strokeStyle = `rgba(${rr | 0},${gg | 0},${bb | 0},.55)`;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  // orientation cube
  ctx.strokeStyle = 'rgba(233,238,234,.5)'; ctx.lineWidth = 1;
  ctx.strokeRect(c.width - 66, c.height - 62, 34, 34);
  ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(233,238,234,.6)';
  ctx.fillText('R', c.width - 80, c.height - 42); ctx.fillText('A', c.width - 46, c.height - 68); ctx.fillText('S', c.width - 46, c.height - 20);
  return panelWrap('DWI — Tractography (FOD)', el('div', { class: 'dwi-stage' }, c));
}

/* universal image viewer — renders anything the browser can decode */
function imageViewer() {
  const state = { zoom: 1, bright: 1, contrast: 1 };
  const img = el('img', { alt: 'Opened image preview', hidden: true });
  const meta = el('div', { class: 'img-meta' }, 'No image opened yet.');
  const stageBox = el('div', { class: 'imgstage', hidden: true }, img);

  function apply() {
    img.style.transform = `scale(${state.zoom})`;
    img.style.filter = `brightness(${state.bright}) contrast(${state.contrast})`;
  }
  function open(file) {
    const ok = /^image\//.test(file.type) || /\.(svg|png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(file.name);
    if (!ok) {
      if (/\.(nii(\.gz)?|dcm|mgz)$/i.test(file.name)) {
        meta.textContent = `${file.name} — volumetric format detected: the Qortex engine extracts slice previews server-side. Showing schematic preview.`;
        stageBox.hidden = true; img.hidden = true;
        volFallback.hidden = false;
        return;
      }
      toast(`"${file.name}" is not a displayable image format.`);
      return;
    }
    volFallback.hidden = true;
    const url = URL.createObjectURL(file);
    img.src = url; img.hidden = false; stageBox.hidden = false;
    img.onload = () => {
      meta.textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight}px · ${(file.size / 1024).toFixed(1)} KB · ${file.type || 'image'}`;
      URL.revokeObjectURL(url);
    };
    apply();
    announce(`Opened image ${file.name}`);
  }

  const input = el('input', { type: 'file', accept: 'image/*,.svg,.nii,.gz,.dcm,.mgz', class: 'visually-hidden', id: 'imgfile' });
  input.addEventListener('change', () => input.files[0] && open(input.files[0]));
  const dz = el('div', { class: 'dropzone' },
    el('div', {}, el('b', {}, 'Drop any image here'), ' — PNG, JPEG, SVG, WebP, GIF, AVIF, BMP…'),
    el('div', { class: 'dz-hint' }, 'NIfTI / DICOM volumes are sliced by the engine — drop one to see the flow.'),
    el('div', { style: 'margin-top:12px' }, el('label', { class: 'btn', for: 'imgfile', style: 'cursor:pointer' }, 'Choose file…'), input));
  ;['dragover', 'dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.toggle('dragover', ev === 'dragover');
    if (ev === 'drop' && e.dataTransfer.files[0]) open(e.dataTransfer.files[0]);
  }));

  const volFallback = el('div', { hidden: true, style: 'margin-top:12px' }, miniPlanes());

  const bar = el('div', { class: 'viewer-bar' },
    slider('Zoom', 5, 40, 10, v => { state.zoom = v / 10; apply(); }),
    slider('Bright', 4, 20, 10, v => { state.bright = v / 10; apply(); }),
    slider('Contrast', 4, 20, 10, v => { state.contrast = v / 10; apply(); }),
    el('button', { class: 'btn btn-sm', onclick: () => { state.zoom = state.bright = state.contrast = 1; apply(); } }, 'Reset'),
  );
  return panelWrap('Image Viewer — any format the browser or engine can render',
    el('div', {}, dz, stageBox, volFallback, bar, meta));
}

/* --- Quality --- */
function tabQuality(body, d) {
  const r = d.readiness;
  const groups = [['fail', 'Failed'], ['warn', 'Warnings'], ['pass', 'Passed']];
  body.append(el('div', { class: 'bento' },
    el('div', { class: 'span-4 panel' }, el('div', { class: 'panel-b', style: 'display:flex;justify-content:center' },
      donut({ size: 150, thick: 15, segs: [
        { label: 'Passed', v: r.passed, color: 'var(--good)' },
        { label: 'Warnings', v: r.warnings, color: 'var(--warn)' },
        { label: 'Failed', v: r.failed, color: 'var(--fail)' }],
        centerVal: `${r.pct}%`, centerLab: 'Ready' }))),
    el('div', { class: 'span-8 panel' },
      el('div', { class: 'panel-h' }, el('h3', {}, 'Checks'), el('span', { class: 'sub' }, `${fmt(r.passed + r.warnings + r.failed)} total`)),
      el('div', {}, ...groups.flatMap(([lv]) => (d.quality ?? []).filter(q => q.level === lv).map(q => qrow(q))))),
  ));
}

/* --- Cohort --- */
function tabCohort(body, d) {
  body.append(el('div', { class: 'cohort-grid' },
    panel('Age', `N = ${fmt(d.subjects)}`, d.ageHist ? histogram({ values: d.ageHist, bins: d.ageBins, w: 520, h: 150 }) : el('p', { class: 'sub' }, 'No distribution at this ingestion level.')),
    panel('Sex', null, el('div', { class: 'donut-wrap' },
      donut({ size: 120, thick: 13, segs: (d.sex ?? []).map((s, i) => ({ label: s.label, v: s.count, color: ['var(--green)', 'var(--green-deep)', 'var(--copper)'][i] })), centerVal: fmt(d.subjects), centerLab: 'Total' }),
      el('ul', { class: 'legend' }, ...(d.sex ?? []).map((s, i) =>
        el('li', {}, el('span', { class: 'dot', style: `background:${['var(--green)', 'var(--green-deep)', 'var(--copper)'][i]}` }), el('span', { class: 'll' }, s.label), el('span', { class: 'lv' }, fmt(s.count))))))),
    panel('Scanner (Top 5)', null, d.scanners ? hbars(d.scanners) : el('p', { class: 'sub' }, '—')),
    panel('Site (Top 5)', null, d.sites ? hbars(d.sites) : el('p', { class: 'sub' }, '—')),
  ));
}

/* --- Knowledge graph --- */
function tabGraph(body, d) {
  const W = 1160, H = 470;
  const cols = [
    { key: 'dataset', title: 'Dataset', items: [KG.dataset], x: 90, color: 'var(--c-dataset)', r: 22 },
    { key: 'modality', title: 'Modalities', items: KG.modalities, x: 340, color: 'var(--c-modality)', r: 9 },
    { key: 'task', title: 'Tasks', items: KG.tasks, x: 590, color: 'var(--c-task)', r: 9 },
    { key: 'participant', title: 'Participants', items: KG.participants, x: 830, color: 'var(--c-participant)', r: 8 },
    { key: 'file', title: 'Files', items: KG.files, x: 1080, color: 'var(--c-file)', r: 8 },
  ];
  const pos = {};
  cols.forEach(c => c.items.forEach((it, i) => {
    pos[`${c.key}:${it}`] = { x: c.x, y: 70 + (i + 0.5) * ((H - 90) / c.items.length) };
  }));
  pos[`dataset:${KG.dataset}`] = { x: 90, y: H / 2 };

  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'kg-svg', role: 'img',
    'aria-label': 'Knowledge graph linking dataset, modalities, tasks, participants and files' });

  cols.forEach(c => { const t = sv('text', { x: c.x, y: 30, 'text-anchor': 'middle', class: 'kg-col-t' }); t.textContent = c.title; svg.append(t); });

  const edges = [];
  function edge(aKey, bKey) {
    const a = pos[aKey], b = pos[bKey];
    if (!a || !b) return;
    const p = sv('path', { class: 'kg-edge', d: `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}` });
    p.dataset.a = aKey; p.dataset.b = bKey;
    svg.append(p); edges.push(p);
  }
  KG.modalities.forEach(m => edge(`dataset:${KG.dataset}`, `modality:${m}`));
  KG.edges.mt.forEach(([m, t]) => edge(`modality:${m}`, `task:${t}`));
  KG.edges.tp.forEach(([t, p]) => edge(`task:${t}`, `participant:${p}`));
  KG.edges.pf.forEach(([p, f]) => edge(`participant:${p}`, `file:${f}`));

  cols.forEach(c => c.items.forEach(it => {
    const key = `${c.key}:${it}`, { x, y } = pos[key];
    const g = sv('g', { class: 'kg-node', tabindex: '0', role: 'button' });
    g.setAttribute('aria-label', `${c.title}: ${it}`);
    g.append(sv('circle', { cx: x, cy: y, r: c.r, fill: c.color }));
    const t = sv('text', { x: c.key === 'file' ? x - c.r - 6 : x + c.r + 7, y: y + 4, 'text-anchor': c.key === 'file' ? 'end' : 'start' });
    t.textContent = it.length > 26 ? it.slice(0, 24) + '…' : it;
    g.append(t);
    const hot = (on) => {
      g.classList.toggle('hot', on);
      edges.forEach(e => e.classList.toggle('hot', on && (e.dataset.a === key || e.dataset.b === key)));
    };
    g.addEventListener('mouseenter', () => hot(true));
    g.addEventListener('mouseleave', () => hot(false));
    g.addEventListener('focus', () => hot(true));
    g.addEventListener('blur', () => hot(false));
    svg.append(g);
  }));

  body.append(el('section', { class: 'panel' },
    el('div', { class: 'panel-h' }, el('h3', {}, 'Knowledge Graph — Datasets, Modalities, Tasks, Participants, Files')),
    el('div', { class: 'kg-legend' }, ...cols.map(c => el('span', {}, el('span', { class: 'dot', style: `background:${c.color}` }), c.title))),
    el('div', { class: 'panel-b' }, svg)));
}

/* --- Files table --- */
function tabFiles(body, d) {
  const rows = [];
  (function walk(node, path) {
    const p = path ? `${path}/${node.name}` : node.name;
    if (node.children) node.children.forEach(ch => walk(ch, node.kind === 'root' ? '' : p));
    else rows.push({ path: p, kind: node.kind, size: node.size });
  })(TREE, '');
  body.append(panel('Files', `${rows.length} shown of ${fmt(482000)}`, el('div', { class: 'tblw' },
    el('table', { class: 't' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Path'), el('th', {}, 'Kind'), el('th', { class: 'num' }, 'Size'), el('th', {}, ''))),
      el('tbody', {}, ...rows.map(rw => el('tr', {},
        el('td', { class: 'mono', style: 'font-size:12px' }, rw.path),
        el('td', {}, el('span', { class: 'chip' }, { nii: 'NIfTI', json: 'JSON', tsv: 'TSV', sig: 'Signal' }[rw.kind] ?? rw.kind)),
        el('td', { class: 'num mono', style: 'font-size:12px' }, rw.size ?? '—'),
        el('td', {}, el('a', { class: 'btn btn-sm', href: `#/ds/${d.id}/viewer` }, 'View')),
      )))))));
}

/* --- Jobs / Settings (light) --- */
function viewJobs() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' }, el('div', { class: 'eyebrow' }, 'Runtime'), el('h1', {}, 'Jobs')));
  wrap.append(panel('Recent activity', null, el('div', {},
    ...[
      ['Readiness scan — ds000117', 'completed 41 min ago', 'pass'],
      ['Manifest refresh — OpenNeuro catalog', 'completed 41 min ago', 'pass'],
      ['Sidecar digest — ds004130', 'completed 2 h ago', 'warn'],
    ].map(([m, f, lv]) => qrow({ level: lv, msg: m, files: f })))));
  main.append(wrap);
}
function viewSettings() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' }, el('div', { class: 'eyebrow' }, 'Configuration'), el('h1', {}, 'Settings')));
  wrap.append(panel('Appearance', null, el('div', {},
    el('button', { class: 'btn', onclick: toggleTheme }, 'Toggle light / dark'),
    el('p', { class: 'sub', style: 'margin-top:10px;color:var(--text-3);font-size:12px' }, 'Local Atlas store: ~/.cache/qortex/atlas · engine: mock v2 (fixtures)'))));
  main.append(wrap);
}

/* ================= router / chrome ================= */
function route() {
  const h = location.hash.replace(/^#\//, '');
  const [top, a, b] = h.split('/');
  main.innerHTML = ''; main.focus();
  document.querySelectorAll('.side a[data-nav]').forEach(n => n.removeAttribute('aria-current'));
  const mark = (k) => document.querySelector(`.side a[data-nav="${k}"]`)?.setAttribute('aria-current', 'page');

  if (!top) { viewHome(); mark('atlas'); }
  else if (top === 'datasets') { viewDatasets(); mark('datasets'); }
  else if (top === 'ds') {
    const tab = DS_TABS.includes(b) ? b : 'overview';
    viewDataset(a, tab);
    mark({ bids: 'bids', quality: 'quality', viewer: 'viewer', cohort: 'cohorts', graph: 'graph' }[tab] ?? 'datasets');
  }
  else if (top === 'jobs') { viewJobs(); mark('jobs'); }
  else if (top === 'settings') { viewSettings(); mark('settings'); }
  else { viewHome(); mark('atlas'); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* theme */
function toggleTheme() {
  const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur;
  localStorage.setItem('qatlas2-theme', cur);
  announce(`Theme: ${cur}`);
  route(); // repaint canvases against new surfaces
}
$('#theme-btn').addEventListener('click', toggleTheme);
document.documentElement.dataset.theme = localStorage.getItem('qatlas2-theme') ?? 'dark';

/* command palette */
const veil = $('#cmdk'), cin = $('#cmdk-in'), cout = $('#cmdk-out');
let citems = [], csel = -1;
function openCmdk() { veil.hidden = false; cin.value = ''; renderCmdk(''); requestAnimationFrame(() => cin.focus()); }
function closeCmdk() { veil.hidden = true; $('#search-btn').focus(); }
function renderCmdk(q) {
  const ql = q.toLowerCase();
  citems = [];
  DATASETS.forEach(d => { if (!ql || d.id.includes(ql) || d.name.toLowerCase().includes(ql)) citems.push({ label: `${d.id} — ${d.name}`, k: 'dataset', href: `#/ds/${d.id}/overview` }); });
  [['Viewer', `#/ds/ds000117/viewer`], ['Knowledge graph', `#/ds/ds000117/graph`], ['Quality', `#/ds/ds000117/quality`], ['Cohort', `#/ds/ds000117/cohort`], ['Datasets', '#/datasets']].forEach(([l, href]) => {
    if (!ql || l.toLowerCase().includes(ql)) citems.push({ label: l, k: 'page', href });
  });
  cout.innerHTML = '';
  citems.slice(0, 12).forEach((it, i) => {
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
$('#bell-btn').addEventListener('click', () => toast('Readiness scan for ds000117 completed — 92% ready.'));

route();
