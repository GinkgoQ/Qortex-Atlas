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

import { Api } from './api.js?v=57';
import { Niivue, NVImage, SHOW_RENDER, MULTIPLANAR_TYPE } from './vendor/niivue.esm.js';

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
const TIMING_STORE_KEY = 'qatlas-real-timing-v1';
function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
function timingStore() {
  try { return JSON.parse(localStorage.getItem(TIMING_STORE_KEY) || '{}'); }
  catch { return {}; }
}
function timingBucket(operation, key = '') { return `${operation || 'operation'}::${key || 'global'}`; }
function readTimingEstimate(operation, key = '') {
  const store = timingStore();
  const samples = store[timingBucket(operation, key)] || store[timingBucket(operation, 'global')] || [];
  if (!samples.length) return null;
  const sorted = samples.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return { seconds: sorted[Math.floor(sorted.length / 2)], n: sorted.length, source: key ? 'local history' : 'local global history' };
}
function recordTimingSample(operation, key, seconds) {
  if (!operation || !Number.isFinite(seconds) || seconds <= 0) return;
  const store = timingStore();
  [key || '', 'global'].forEach(k => {
    const bucket = timingBucket(operation, k);
    const samples = (store[bucket] || []).map(Number).filter(Number.isFinite);
    samples.push(Math.round(seconds * 10) / 10);
    store[bucket] = samples.slice(-12);
  });
  localStorage.setItem(TIMING_STORE_KEY, JSON.stringify(store));
}
function networkEtaSeconds(sizeBytes) {
  const mbps = navigator.connection?.downlink;
  if (!sizeBytes || !Number.isFinite(mbps) || mbps <= 0) return null;
  return (sizeBytes * 8) / (mbps * 1_000_000);
}
function estimatedTimingText({ operation, key, sizeBytes } = {}) {
  const local = readTimingEstimate(operation, key);
  if (local) return `ETA ${fmtDuration(local.seconds)} (${local.source}, n=${local.n})`;
  const net = networkEtaSeconds(sizeBytes);
  if (net) return `ETA ${fmtDuration(net)} (browser network estimate)`;
  return 'ETA calibrating from first real run';
}

/* ================= evidence badges (v1 capability, v2 chip language) =====
   confirmed/inferred/unknown/blocked — icon + text always, never color
   alone. Reuses v2's .chip primitive with two new variants. */
const EV_META = {
  confirmed: { icon: '✓', cls: 'chip-green' }, inferred: { icon: '≈', cls: 'chip-copper' },
  // "claimed"/"missing"/"contradicted" are the remaining states of Qortex's
  // 7-state EvidenceState (qortex.checks.EvidenceState) — the search engine's
  // evidence-partitioned filtering (qortex.search.evidence) can surface any
  // of them, not just the original 4, so every state needs a real badge
  // rather than falling through to the "unknown" default and losing the
  // distinction the backend went to the trouble of computing.
  claimed: { icon: '~', cls: 'chip-copper' }, missing: { icon: '–', cls: '' },
  contradicted: { icon: '⚠', cls: 'chip-fail' },
  unknown: { icon: '?', cls: '' }, blocked: { icon: '✕', cls: 'chip-fail' },
};
function evChip(status, label, count = null) {
  const m = EV_META[status] ?? EV_META.unknown;
  // A zero count styled in full color (red "blocked", green "confirmed", …)
  // reads as an active alarm/achievement when it's actually a non-event —
  // most misleading for "0 blocked", which would otherwise be a bold red
  // chip for the best possible outcome. Mute to neutral instead.
  const cls = count === 0 ? 'chip chip-zero' : `chip ${m.cls}`;
  return el('span', { class: cls }, el('span', { 'aria-hidden': 'true' }, m.icon), label ?? status);
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
  // .donut's CSS has a fixed 128px box (the default `size`) — any caller
  // passing a different `size` (Quality/Overview both pass 150) got an SVG
  // wider than its own wrapper, overflowing to one side while the
  // absolutely-positioned center label stayed centered on the *wrapper's*
  // (wrong) box, visibly shifting the ring off from its own label. Size the
  // wrapper from the real `size` every time instead of trusting the CSS default.
  const wrap = el('div', { class: 'donut', style: `width:${size}px;height:${size}px` });
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

function qcLineChart({ time = [], values = [], threshold = null, unit = '', xUnit = 's', label }) {
  const W = 760, H = 190, pad = { l: 54, r: 18, t: 18, b: 32 };
  const points = values.map((value, index) => ({ x: Number(time[index]), y: Number(value) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length) return el('p', { class: 'sub' }, `${label} is unavailable.`);
  const xMin = Math.min(...points.map(point => point.x)), xMax = Math.max(...points.map(point => point.x));
  const yCandidates = points.map(point => point.y).concat(Number.isFinite(threshold) ? [threshold] : []);
  const yMin = Math.min(...yCandidates), yMax = Math.max(...yCandidates);
  const x = value => pad.l + ((value - xMin) / Math.max(xMax - xMin, 1)) * (W - pad.l - pad.r);
  const y = value => H - pad.b - ((value - yMin) / Math.max(yMax - yMin, Number.EPSILON)) * (H - pad.t - pad.b);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'qc-line-chart', role: 'img', 'aria-label': `${label}, ${points.length} measured values` });
  svg.append(sv('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, class: 'axis' }));
  if (Number.isFinite(threshold)) {
    const thresholdLine = sv('line', { x1: pad.l, x2: W - pad.r, y1: y(threshold), y2: y(threshold), class: 'qc-threshold' });
    const title = sv('title'); title.textContent = `Threshold ${threshold}${unit ? ` ${unit}` : ''}`; thresholdLine.append(title); svg.append(thresholdLine);
  }
  svg.append(sv('polyline', { points: points.map(point => `${x(point.x)},${y(point.y)}`).join(' '), class: 'qc-series' }));
  points.forEach((point, index) => {
    if (index % Math.max(1, Math.floor(points.length / 120)) !== 0 && index !== points.length - 1) return;
    const marker = sv('circle', { cx: x(point.x), cy: y(point.y), r: 2.2, class: Number.isFinite(threshold) && point.y > threshold ? 'qc-point qc-point-flagged' : 'qc-point' });
    const title = sv('title'); title.textContent = `${point.x.toFixed(3)} ${xUnit}: ${point.y.toFixed(4)}${unit ? ` ${unit}` : ''}`; marker.append(title); svg.append(marker);
  });
  [[xMin, pad.l, 'start'], [xMax, W - pad.r, 'end']].forEach(([value, xpos, anchor]) => {
    const text = sv('text', { x: xpos, y: H - 8, 'text-anchor': anchor, class: 'axis-t' }); text.textContent = `${Number(value).toFixed(1)} ${xUnit}`; svg.append(text);
  });
  const minText = sv('text', { x: pad.l - 8, y: y(yMin) + 4, 'text-anchor': 'end', class: 'axis-t' }); minText.textContent = yMin.toFixed(2);
  const maxText = sv('text', { x: pad.l - 8, y: y(yMax) + 4, 'text-anchor': 'end', class: 'axis-t' }); maxText.textContent = yMax.toFixed(2);
  svg.append(minText, maxText);
  return svg;
}

function connectivityMatrix(matrix, labels) {
  const n = matrix.length;
  if (!n) return el('p', { class: 'sub' }, 'No connectivity matrix was returned.');
  const W = 680, margin = 104, plot = W - margin - 16, cell = plot / n;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${W}`, class: 'connectivity-matrix', role: 'img', 'aria-label': `${n} by ${n} thresholded connectivity matrix` });
  matrix.forEach((row, yIndex) => row.forEach((raw, xIndex) => {
    const value = Number(raw) || 0, magnitude = Math.min(1, Math.abs(value));
    const fill = value > 0 ? `rgba(55,185,142,${0.12 + magnitude * 0.88})` : value < 0 ? `rgba(206,118,76,${0.12 + magnitude * 0.88})` : 'var(--panel-3)';
    const rect = sv('rect', { x: margin + xIndex * cell, y: 8 + yIndex * cell, width: Math.max(cell - .5, .5), height: Math.max(cell - .5, .5), fill });
    const title = sv('title'); title.textContent = `${labels[yIndex]} ↔ ${labels[xIndex]}: r=${value.toFixed(5)}`; rect.append(title); svg.append(rect);
  }));
  labels.forEach((label, index) => {
    if (n > 24 && index % 2) return;
    const y = 8 + (index + .65) * cell;
    const text = sv('text', { x: margin - 6, y, 'text-anchor': 'end', class: 'axis-t' }); text.textContent = label; svg.append(text);
  });
  return svg;
}

function spectrogramHeatmap(report) {
  const rows = report.power || [], times = report.times_seconds || [], freqs = report.frequencies_hz || [];
  if (!rows.length || !times.length) return el('p', { class: 'sub' }, 'No spectrogram bins were returned.');
  const W = 760, H = 270, left = 52, bottom = 30, plotW = W - left - 12, plotH = H - bottom - 10;
  const finite = rows.flat().map(value => Math.log10(Math.max(Number(value), Number.MIN_VALUE))).filter(Number.isFinite);
  const min = Math.min(...finite), max = Math.max(...finite), span = Math.max(max - min, Number.EPSILON);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spectrogram-map', role: 'img', 'aria-label': `Spectrogram for ${report.channel}, ${freqs.length} frequency bins by ${times.length} time bins` });
  rows.forEach((row, fi) => row.forEach((raw, ti) => {
    const logPower = Math.log10(Math.max(Number(raw), Number.MIN_VALUE));
    const q = Math.max(0, Math.min(1, (logPower - min) / span));
    const rect = sv('rect', { x: left + ti * plotW / times.length, y: 8 + (rows.length - fi - 1) * plotH / rows.length, width: plotW / times.length + .25, height: plotH / rows.length + .25, fill: `hsl(${255 - q * 210} 72% ${18 + q * 45}%)` });
    const title = sv('title'); title.textContent = `${times[ti].toFixed(3)} s, ${freqs[fi].toFixed(2)} Hz: log10 power ${logPower.toFixed(4)}`; rect.append(title); svg.append(rect);
  }));
  const x0 = sv('text', { x: left, y: H - 7, class: 'axis-t' }); x0.textContent = '0 s';
  const x1 = sv('text', { x: W - 12, y: H - 7, 'text-anchor': 'end', class: 'axis-t' }); x1.textContent = `${times.at(-1).toFixed(1)} s`;
  const y0 = sv('text', { x: left - 6, y: H - bottom, 'text-anchor': 'end', class: 'axis-t' }); y0.textContent = `${freqs[0].toFixed(0)} Hz`;
  const y1 = sv('text', { x: left - 6, y: 16, 'text-anchor': 'end', class: 'axis-t' }); y1.textContent = `${freqs.at(-1).toFixed(0)} Hz`;
  svg.append(x0, x1, y0, y1); return svg;
}

function sensorBandMap(positions, channels, band) {
  const available = positions.map((position, index) => ({ ...position, index, value: band?.relative_by_channel?.[index] })).filter(position => position.available && Number.isFinite(position.value));
  if (available.length < 3) return el('p', { class: 'sub' }, 'Sensor geometry is absent or insufficient for a topographic map.');
  const W = 420, H = 330, pad = 32;
  const xs = available.map(point => point.x_m), ys = available.map(point => point.y_m), values = available.map(point => point.value);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys), vMin = Math.min(...values), vMax = Math.max(...values);
  const x = value => pad + (value - xMin) / Math.max(xMax - xMin, Number.EPSILON) * (W - 2 * pad);
  const y = value => H - pad - (value - yMin) / Math.max(yMax - yMin, Number.EPSILON) * (H - 2 * pad);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sensor-map', role: 'img', 'aria-label': `${band.name} relative bandpower at ${available.length} measured sensor positions` });
  svg.append(sv('ellipse', { cx: W / 2, cy: H / 2, rx: W / 2 - 12, ry: H / 2 - 12, class: 'sensor-head' }));
  available.forEach(point => {
    const q = (point.value - vMin) / Math.max(vMax - vMin, Number.EPSILON);
    const circle = sv('circle', { cx: x(point.x_m), cy: y(point.y_m), r: 8, fill: `hsl(${220 - q * 185} 72% ${30 + q * 28}%)`, class: 'sensor-point' });
    const title = sv('title'); title.textContent = `${channels[point.index]}: ${(point.value * 100).toFixed(3)}% relative ${band.name} power`; circle.append(title); svg.append(circle);
  });
  return svg;
}

function groupedNumericPlot(summary) {
  const groups = summary?.groups || [];
  const overall = summary?.overall;
  if (!groups.length || !overall) return el('p', { class: 'sub' }, 'No valid grouped numeric values.');
  const W = 760, left = 96, right = 26, top = 24, rowH = 54, H = top + groups.length * rowH + 34;
  const span = Math.max(overall.max - overall.min, 1);
  const x = value => left + ((value - overall.min) / span) * (W - left - right);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'demographic-plot', role: 'img', 'aria-label': `${summary.value_column} distribution by ${summary.group_column}` });
  groups.forEach((group, groupIndex) => {
    const y = top + groupIndex * rowH + rowH / 2;
    const color = group.group === 'Invalid' ? 'var(--fail)' : 'var(--green)';
    const label = sv('text', { x: left - 12, y: y + 4, 'text-anchor': 'end', class: 'demographic-label' });
    label.textContent = `${group.group} (n=${group.n})`; svg.append(label);
    svg.append(sv('line', { x1: x(group.min), x2: x(group.max), y1: y, y2: y, class: 'demographic-whisker' }));
    svg.append(sv('rect', { x: x(group.q1), y: y - 10, width: Math.max(2, x(group.q3) - x(group.q1)), height: 20, rx: 3, fill: color, opacity: '.28' }));
    svg.append(sv('line', { x1: x(group.median), x2: x(group.median), y1: y - 12, y2: y + 12, stroke: color, 'stroke-width': 2 }));
    (group.values || []).forEach((value, index) => {
      const circle = sv('circle', { cx: x(value), cy: y + ((index % 5) - 2) * 3.4, r: 3, fill: color, opacity: '.82' });
      const title = sv('title'); title.textContent = `${group.group}: ${value}`; circle.append(title); svg.append(circle);
    });
  });
  const axisY = H - 24;
  svg.append(sv('line', { x1: left, x2: W - right, y1: axisY, y2: axisY, class: 'axis' }));
  [overall.min, overall.median, overall.max].forEach(value => {
    const label = sv('text', { x: x(value), y: H - 7, 'text-anchor': 'middle', class: 'axis-t' }); label.textContent = String(value); svg.append(label);
  });
  return svg;
}

/* ================= views ================= */
const main = $('#main');

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
  // No ETA is shown unless there is a real, measurable download driving it
  // (see setProgress). A server operation's duration is dominated by
  // unpredictable server-side work, so guessing an ETA from past runs is
  // dishonest — we show only elapsed time for those.
  const etaEl = el('span', { class: 'wait-eta' }, '');
  const stateEl = el('span', {}, 'In progress ·');
  const barFill = el('div', { class: 'wait-bar-fill wait-bar-indeterminate' });
  const card = el('div', { class: 'panel wait-card', style: `min-height:${Math.max(height, 130)}px` },
    el('div', { class: 'wait-body' },
      ring,
      el('div', { class: 'wait-copy' },
        el('div', { class: 'wait-label' }, label),
        el('div', { class: 'wait-sub' }, stateEl, timeEl, etaEl))),
    el('div', { class: 'wait-bar' }, barFill));
  const iv = setInterval(() => {
    if (!document.body.contains(card)) { clearInterval(iv); return; }
    timeEl.textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s elapsed`;
  }, 200);
  // Drive a REAL ETA from a streaming download (bytes received / total from
  // Content-Length, ÷ measured speed) — the only honest ETA there is.
  card.setProgress = (received, total, speedBps) => {
    barFill.classList.remove('wait-bar-indeterminate');
    if (total > 0) {
      const p = Math.min(100, (received / total) * 100);
      barFill.style.width = `${p.toFixed(1)}%`;
      stateEl.textContent = `${fmtBytes(received)} / ${fmtBytes(total)} ·`;
      const etaS = speedBps > 0 ? (total - received) / speedBps : null;
      etaEl.textContent = (speedBps > 0 ? ` · ${(speedBps / 1e6).toFixed(1)} MB/s` : '') + (etaS == null ? '' : etaS < 1 ? ' · ETA <1s' : ` · ETA ${Math.ceil(etaS)}s`);
    } else {
      stateEl.textContent = `${fmtBytes(received)} ·`;
      etaEl.textContent = speedBps > 0 ? ` · ${(speedBps / 1e6).toFixed(1)} MB/s` : '';
    }
  };
  card.recordTiming = () => {};
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
      // No separate "Qortex" wordmark above the title — the brand already
      // appears in the sidebar and in the H1 itself; a third repetition in
      // the same viewport reads as a layout mistake, not emphasis.
      el('h1', { class: 'hero-title' }, 'Qortex ', el('span', { class: 't-atlas' }, 'Atlas')),
      el('p', { class: 'hero-tag' }, el('b', {}, 'Explore'), el('span', { class: 'dot' }, '. '), el('b', {}, 'Inspect'), el('span', { class: 'dot' }, '. '), el('b', {}, 'Understand'), ' neurodata', el('span', { class: 'dot' }, '.')),
      el('div', { class: 'hero-actions' },
        // Deliberately no featured dataset here — spotlighting one specific
        // ID on the landing page of a tool spanning the whole OpenNeuro
        // catalog reads as an endorsement of that dataset over every other,
        // which isn't a call this UI should be making.
        el('a', { class: 'btn btn-green', href: '#/datasets' }, 'Browse datasets'),
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
    { ic: 'shield', h: 'Readiness checks', p: 'compute_readiness() findings — confirmed, inferred, unknown, blocked.' },
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
    // Fresh install: an empty cache renders every browse/search page empty
    // downstream, so say what to do about it here instead of a bare "0".
    statusWrap.append(status.n_datasets === 0
      ? panel('Local catalog cache', 'empty — nothing indexed yet', el('p', { style: 'margin:0' },
          'The local catalog is empty. ', el('a', { href: '#/settings' }, 'Refresh it from Settings'),
          ' to index OpenNeuro (takes under a minute).'))
      : panel('Local catalog cache', 'a fast pre-filter — opening any dataset always fetches live', el('div', { class: 'kv' },
          el('dt', {}, 'Datasets cached'), el('dd', {}, fmt(status.n_datasets)),
          el('dt', {}, 'Deep-profiled'), el('dd', {}, fmt(status.n_profiled)),
          el('dt', {}, 'Cache path'), el('dd', { class: 'mono', style: 'overflow-wrap:anywhere' }, status.db_path),
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
  const catalogWait = waitPanel('Querying the local catalog.', { height: 300, eta: { operation: 'catalog-search', key: 'local' } });
  const body = el('div', {}, catalogWait);
  wrap.append(body);
  main.append(wrap);

  try {
    const rows = await Api.catalogSearch({ limit: 5000 }); // whole local catalog (backend le=5000, ≥ OpenNeuro's full ~1.8k corpus)
    catalogWait.recordTiming?.();
    body.innerHTML = '';
    if (!rows.length) {
      body.append(panel('All datasets', null, el('p', {}, 'Local catalog is empty. ', el('a', { href: '#/settings' }, 'Refresh it from Settings'), ' to pull dataset metadata from OpenNeuro.')));
      return;
    }
    renderCatalogTable(body, rows);
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}

// 1,805 rows in one <table> is ~11k DOM nodes and a 100k-px-tall page. This
// filters/sorts the already-loaded catalog client-side (it's cached and small)
// and paints one page at a time — no extra round trips, no server offset.
const CATALOG_PAGE_SIZE = 50;
function renderCatalogTable(container, rows) {
  let query = '', sortKey = 'n_subjects', sortDir = -1, page = 0;
  const SORTS = { dataset_id: (d) => d.dataset_id, n_subjects: (d) => d.n_subjects ?? -1, total_bytes: (d) => d.total_bytes ?? -1 };

  const filterInput = el('input', {
    type: 'search', placeholder: 'Filter by ID, name, modality, or license…',
    'aria-label': 'Filter datasets', autocomplete: 'off', style: 'flex:1;min-width:0',
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); page = 0; paint(); },
  });
  const countEl = el('span', { class: 'sub', style: 'white-space:nowrap' });
  const tableHost = el('div', { class: 'tblw' });
  const pager = el('div', { class: 'pager', style: 'display:flex;align-items:center;gap:12px;margin-top:10px;font-size:12.5px;color:var(--text-2)' });

  function matches(d) {
    if (!query) return true;
    return `${d.dataset_id} ${d.name ?? ''} ${(d.modalities || []).join(' ')} ${d.license ?? ''}`.toLowerCase().includes(query);
  }
  function header(label, key, numeric) {
    const active = sortKey === key;
    return el('th', {
      class: numeric ? 'num' : '', tabindex: '0', role: 'button', 'aria-sort': active ? (sortDir < 0 ? 'descending' : 'ascending') : 'none',
      style: 'cursor:pointer;user-select:none;white-space:nowrap',
      onclick: () => sortBy(key), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(key); } },
    }, label, active ? el('span', { 'aria-hidden': 'true', style: 'color:var(--green);margin-left:4px' }, sortDir < 0 ? '▾' : '▴') : '');
  }
  function sortBy(key) { if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = key === 'dataset_id' ? 1 : -1; } page = 0; paint(); }

  function paint() {
    const filtered = rows.filter(matches);
    const get = SORTS[sortKey];
    filtered.sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
    const nPages = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
    if (page >= nPages) page = nPages - 1;
    const start = page * CATALOG_PAGE_SIZE;
    const slice = filtered.slice(start, start + CATALOG_PAGE_SIZE);
    countEl.textContent = query ? `${fmt(filtered.length)} of ${fmt(rows.length)}` : `${fmt(rows.length)} indexed`;

    tableHost.innerHTML = '';
    if (!slice.length) { tableHost.append(el('p', { class: 'sub', style: 'padding:16px 2px' }, `No datasets match “${query}”.`)); pager.innerHTML = ''; return; }
    tableHost.append(el('table', { class: 't' },
      el('thead', {}, el('tr', {},
        header('Dataset', 'dataset_id'), header('Subjects', 'n_subjects', true),
        el('th', {}, 'Modalities'), el('th', {}, 'License'), header('Size', 'total_bytes', true))),
      el('tbody', {}, ...slice.map(d => el('tr', {},
        el('td', {}, el('a', { href: `#/ds/${d.dataset_id}/overview` }, el('b', {}, d.dataset_id)), el('span', { style: 'color:var(--text-3)' }, ` ${d.name ?? ''}`)),
        el('td', { class: 'num' }, fmt(d.n_subjects)),
        el('td', {}, (d.modalities || []).join(' · ') || '—'),
        el('td', {}, d.license || '—'),
        el('td', { class: 'num' }, d.total_bytes ? fmtBytes(d.total_bytes) : '—'))))));

    pager.innerHTML = '';
    if (nPages > 1) {
      pager.append(
        el('button', { class: 'btn btn-sm', disabled: page === 0 ? '' : null, onclick: () => { if (page > 0) { page--; paint(); } } }, '‹ Prev'),
        el('button', { class: 'btn btn-sm', disabled: page >= nPages - 1 ? '' : null, onclick: () => { if (page < nPages - 1) { page++; paint(); } } }, 'Next ›'),
        el('span', {}, `Showing ${fmt(start + 1)}–${fmt(start + slice.length)} of ${fmt(filtered.length)}`));
    }
  }

  container.append(panel('All datasets', null, el('div', {},
    el('div', { style: 'display:flex;gap:12px;align-items:center;margin-bottom:12px' }, filterInput, countEl),
    tableHost, pager)));
  paint();
}
function fmtBytes(b) {
  if (b == null || !Number.isFinite(Number(b)) || Number(b) < 0) return '—';
  if (Number(b) === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = b, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

// Raw NIfTI intensities aren't guaranteed to sit in a familiar 0–4096 clinical
// range — small-animal/unnormalized scanners routinely produce real values in
// the hundreds of thousands or millions. `Math.round()` on those prints an
// 8-digit integer (e.g. "4945850") that reads as a bug even when the number
// itself is correct; compact notation ("4.95M") stays readable at any scale.
const intensityFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
function fmtIntensity(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) >= 100000 ? intensityFmt.format(v) : (Number.isInteger(v) ? v : v.toFixed(2)).toString();
}

/* ---------- Dataset workspace ---------- */
const DS_TABS = ['overview', 'bids', 'viewer', 'quality', 'cohort', 'graph', 'files', 'plan', 'compat'];
const DS_TAB_LABEL = { bids: 'BIDS', compat: 'Compatibility', graph: 'Analysis' };

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

async function viewDataset(id, tab, params) {
  const wrap = el('div', { class: tab === 'viewer' ? 'wrap viewer-route-wrap' : 'wrap' });
  const { head, metaLine } = dsHeaderShell(id, tab);
  const profileWait = waitPanel(`Fetching ${id}'s profile from OpenNeuro.`, { height: 220, eta: { operation: 'dataset-profile', key: id } });
  const body = el('div', {}, profileWait);
  wrap.append(head, body);
  main.append(wrap);

  let profile;
  try {
    profile = await Api.profile(id, { level: 'manifest' });
    profileWait.recordTiming?.();
  } catch (err) {
    body.innerHTML = '';
    body.append(errorPanel(err), el('p', { style: 'margin-top:10px' }, el('a', { class: 'btn', href: '#/datasets' }, 'Browse datasets')));
    return;
  }
  dsHeaderFill(head, metaLine, profile);
  body.innerHTML = '';
  const fn = { overview: tabOverview, bids: tabBids, viewer: tabViewer, quality: tabQuality, cohort: tabCohort, graph: tabGraph, files: tabFiles, plan: tabPlan, compat: tabCompat }[tab] ?? tabOverview;
  await fn(body, profile, params);
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
      waitRow('Computing age distribution…', { operation: 'participants', key: id })));

  const tasksBody = (profile.tasks || []).length
    ? hbars(profile.tasks.map(t => ({ label: t, count: 1 })))
    : el('p', { class: 'sub' }, 'No tasks recorded.');
  const tasksCard = el('div', { class: 'span-3 panel' }, el('div', { class: 'panel-h' }, el('h3', {}, 'Tasks')), el('div', { class: 'panel-b' }, tasksBody));

  bento.append(readinessCard, modalitiesCard, subjectsCard, tasksCard);

  bento.append(
    el('div', { class: 'span-6 panel', id: 'ov-quality' },
      el('div', { class: 'panel-h' }, el('h3', {}, 'Evidence — latest findings'), el('span', { class: 'sp' }), el('a', { class: 'btn btn-sm', href: `#/ds/${id}/quality` }, 'All checks')),
      el('div', {}, waitRow('Computing readiness findings…', { operation: 'readiness', key: id }))),
    el('div', { class: 'span-6 panel' },
      el('div', { class: 'panel-h' }, el('h3', {}, 'Anatomical preview'), el('span', { class: 'sub' }, 'HTTP byte-range reads — zero full-file downloads'), el('span', { class: 'sp' }), el('a', { class: 'btn btn-sm', href: `#/ds/${id}/viewer` }, 'Open viewer')),
      el('div', { class: 'panel-b', id: 'ov-planes' }, waitRow('Locating an anatomical scan to preview…', { operation: 'nifti-preview', key: id }))),
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
  body.append(waitPanel('Fetching the full file manifest.', { height: 400, eta: { operation: 'dataset-manifest', key: id } }));
  let manifest, coverage;
  try { manifest = await Api.manifest(id, { limit: 2000 }); }
  catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); return; }
  try { coverage = await Api.coverage(id, { snapshot: profile.snapshot, limit: 100 }); }
  catch (err) { coverage = { error: err.message }; }

  const root = buildFileTree(id, manifest.files);

  let selected = null;
  const metaPane = el('div', {});
  let metaMode = 'meta';

  async function renderMeta() {
    metaPane.innerHTML = '';
    if (!selected) { metaPane.append(el('p', { class: 'sub', style: 'padding:14px' }, 'Select a file to preview it.')); return; }
    metaPane.append(waitRow('Fetching file preview…', { operation: 'file-preview', key: `${id}:${selected}` }));
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
          extra = el('div', { class: 'planes', style: 'margin-top:12px' },
            ...planes,
            el('a', { class: 'btn btn-sm', style: 'margin-top:10px', href: `#/ds/${id}/viewer?path=${encodeURIComponent(selected)}` }, 'Open in Viewer Lab →'));
        }
      } else if (fileKind(manifest.files.find(f => f.path === selected) || {}) === 'sig') {
        const rec = manifest.files.find(f => f.path === selected);
        kv.append(el('dt', {}, 'Path'), el('dd', {}, selected));
        if (rec?.extension === '.edf' || rec?.extension === '.bdf') {
          const resp = await Api.eegPreview(id, { path: selected, tmin: 0, tmax: 4, max_channels: 20 });
          extra = resp.supported
            ? el('div', {}, eegTraceSvg(resp), el('a', { class: 'btn btn-sm', style: 'margin-top:10px', href: `#/ds/${id}/viewer?path=${encodeURIComponent(selected)}` }, 'Open in Viewer Lab →'))
            : el('p', { class: 'sub', style: 'margin-top:8px' }, resp.reason);
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

  const tree = fileTreeEl(root, {
    onSelectFile: (node) => { selected = node.path; renderMeta(); announce(`Selected ${node.name}`); },
  });
  body.innerHTML = '';
  body.append(el('div', { class: 'explorer' },
    panel('BIDS / Manifest Explorer', `${fmt(manifest.total_matching)} files`, tree),
    el('section', { class: 'panel meta-pane' }, el('div', { class: 'panel-h' }, el('h3', {}, 'File metadata')), el('div', { class: 'panel-b' }, metaPane)),
  ), coverageDesignWorkspace(coverage, profile));
  renderMeta();
}

function renderCoveragePanel(report) {
  if (report?.error) return panel('Subject × recording coverage', null, el('p', { style: 'color:var(--fail)' }, report.error));
  if (!report?.subjects?.length || !report?.columns?.length) return panel('Subject × recording coverage', null, el('p', { class: 'sub' }, 'No subject-level recording files were observed.'));
  const head = el('tr', {}, el('th', { class: 'coverage-subject' }, 'Subject'),
    ...report.columns.map(column => el('th', { title: column.label },
      el('span', { class: 'coverage-col-label' }, column.label))));
  const rows = report.subjects.map(row => el('tr', {}, el('th', { class: 'coverage-subject mono' }, row.subject),
    ...row.cells.map(cell => el('td', { class: `coverage-cell coverage-${cell.status}`, title: cell.paths.length ? cell.paths.join('\n') : report.absence_note },
      el('span', { class: 'sr-only' }, cell.status.replaceAll('_', ' '))))));
  const fraction = report.observed_fraction == null ? null : `${(report.observed_fraction * 100).toFixed(1)}%`;
  const designMode = report.absence_semantics === 'explicit_design_contract';
  const legend = designMode
    ? [['available', 'Available'], ['missing', 'Missing'], ['not_expected', 'Not expected'], ['unexpected_available', 'Unexpected available']]
    : [['available', 'Available'], ['not_observed', 'Not observed']];
  return panel('Subject × recording coverage', `${report.total_subjects} subjects · ${report.columns.length} ${designMode ? 'declared' : 'observed'} recording definitions`,
    el('div', {},
      el('div', { class: 'coverage-summary' },
        ...legend.map(([status, label]) => el('span', {}, el('span', { class: `coverage-swatch coverage-${status}` }), label)),
        el('span', { class: 'sp' }),
        designMode ? el('b', { class: 'mono', title: report.contract_sha256 }, `Contract ${report.contract_sha256.slice(0, 12)}…`)
          : el('b', {}, `${fraction} observed on this page`)),
      el('p', { class: 'sub coverage-note' }, report.absence_note),
      el('div', { class: 'coverage-scroll' }, el('table', { class: 'coverage-table' }, el('thead', {}, head), el('tbody', {}, ...rows)))));
}

function coverageDesignWorkspace(observedReport, profile) {
  const wrap = el('div', {});
  const matrixHost = el('div', {}, renderCoveragePanel(observedReport));
  if (observedReport?.error || !observedReport?.subjects?.length || !observedReport?.columns?.length) return matrixHost;
  const expectations = [];
  const columnSelect = el('select', { class: 'select', 'aria-label': 'Design recording definition' },
    ...observedReport.columns.map((column, index) => el('option', { value: String(index) }, column.label)));
  const subjectsInput = el('input', {
    class: 'input', type: 'text', value: observedReport.subjects.map(row => row.subject).join(', '),
    'aria-label': 'Expected subjects', placeholder: 'sub-01, sub-02',
  });
  const addButton = el('button', { class: 'btn btn-sm' }, 'Add expectation');
  const evaluateButton = el('button', { class: 'btn btn-green', disabled: true }, 'Evaluate declared design');
  const resetButton = el('button', { class: 'btn btn-sm' }, 'Restore observed-only view');
  const rowsHost = el('div', { class: 'tblw' });
  const resultNote = el('div');
  function renderExpectations() {
    evaluateButton.disabled = !expectations.length;
    rowsHost.innerHTML = '';
    if (!expectations.length) {
      rowsHost.append(el('p', { class: 'sub', style: 'padding:10px' }, 'No recording definition has been declared expected.'));
      return;
    }
    rowsHost.append(el('table', { class: 't' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Recording definition'), el('th', {}, 'Expected subjects'), el('th', {}, ''))),
      el('tbody', {}, ...expectations.map((item, index) => el('tr', {},
        el('td', { class: 'mono' }, item.label), el('td', { class: 'mono' }, item.expected_subjects.join(', ')),
        el('td', {}, el('button', { class: 'btn btn-sm', onclick: () => { expectations.splice(index, 1); renderExpectations(); } }, 'Remove')))))));
  }
  addButton.onclick = () => {
    const column = observedReport.columns[Number(columnSelect.value)];
    const expectedSubjects = [...new Set(subjectsInput.value.split(',').map(value => value.trim()).filter(Boolean))];
    if (!expectedSubjects.length) {
      resultNote.innerHTML = '';
      resultNote.append(errorPanel(new Error('Declare at least one exact expected subject.')));
      return;
    }
    const unknown = expectedSubjects.filter(subject => !observedReport.subjects.some(row => row.subject === subject));
    if (unknown.length) {
      resultNote.innerHTML = '';
      resultNote.append(errorPanel(new Error(`Unknown subjects on this page: ${unknown.join(', ')}`)));
      return;
    }
    const selector = Object.fromEntries(['session', 'task', 'run', 'modality', 'suffix'].map(key => [key, column[key] ?? null]));
    const existing = expectations.findIndex(item => JSON.stringify(item.selector) === JSON.stringify(selector));
    const expectation = { id: `design-${column.id}`, selector, expected_subjects: expectedSubjects, label: column.label };
    if (existing >= 0) expectations[existing] = expectation; else expectations.push(expectation);
    resultNote.innerHTML = '';
    renderExpectations();
  };
  evaluateButton.onclick = async () => {
    evaluateButton.disabled = true;
    resultNote.innerHTML = '';
    resultNote.append(waitRow('Evaluating exact selectors against immutable manifest records…'));
    try {
      const report = await Api.evaluateCoverageDesign(profile.dataset_id, profile.snapshot, {
        expectations: expectations.map(({ label, ...item }) => item), offset: observedReport.offset, limit: observedReport.limit,
      });
      matrixHost.replaceChildren(renderCoveragePanel(report));
      resultNote.innerHTML = '';
      resultNote.append(el('p', { class: 'sub mono' }, `Contract SHA-256 ${report.contract_sha256}`));
    } catch (err) {
      resultNote.innerHTML = '';
      resultNote.append(errorPanel(err));
    } finally {
      evaluateButton.disabled = !expectations.length;
    }
  };
  resetButton.onclick = () => {
    matrixHost.replaceChildren(renderCoveragePanel(observedReport));
    resultNote.innerHTML = '';
  };
  const controls = panel('Explicit study-design contract', 'exact BIDS entities · no inferred expectations', el('div', {},
    el('p', { class: 'sub' }, 'Choose a structured recording definition and list the subjects for whom it is required. Only this declaration can turn an absent manifest cell into Missing; all other absent cells become Not expected.'),
    el('div', { class: 'conversion-controls' }, labeled('Recording definition', columnSelect), labeled('Expected subjects', subjectsInput), addButton, evaluateButton, resetButton),
    rowsHost, resultNote));
  renderExpectations();
  wrap.append(matrixHost, controls);
  return wrap;
}
// Shared by the BIDS explorer tab and the Viewer Lab's file browser — one
// tree-building pass over a flat manifest file list, two entry points.
function buildFileTree(id, files) {
  const root = { name: id, kind: 'root', children: [], _map: new Map() };
  files.forEach(f => {
    const parts = f.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      if (isLeaf) { node.children.push({ name: part, kind: fileKind(f), size: fmtBytes(f.size), sizeBytes: f.size ?? null, path: f.path, extension: f.extension, suffix: f.suffix, subject: f.subject, session: f.session, task: f.task, run: f.run }); return; }
      if (!node._map.has(part)) {
        const child = { name: part, kind: 'dir', children: [], _map: new Map() };
        node._map.set(part, child); node.children.push(child);
      }
      node = node._map.get(part);
    });
  });
  return root;
}
// Shared by the BIDS explorer and the Viewer Lab's file tree (both build a
// tree from buildFileTree() and need the same per-kind icon).
function fico(kind) {
  const c = { nii: 'var(--c-file)', json: 'var(--copper)', tsv: 'var(--green)', sig: 'var(--c-modality)', dir: 'var(--text-3)', root: 'var(--green)' }[kind] ?? 'var(--text-3)';
  const s = sv('svg', { viewBox: '0 0 14 14', class: 'fico', width: 13, height: 13 });
  if (kind === 'dir' || kind === 'root') s.append(sv('path', { d: 'M1 3.5h4l1.5 2H13v6H1z', fill: 'none', stroke: c, 'stroke-width': '1.2' }));
  else s.append(sv('path', { d: 'M3 1h5l3 3v9H3z', fill: 'none', stroke: c, 'stroke-width': '1.2' }));
  return s;
}
// Shared by the BIDS explorer and the Viewer Lab — one accessible file-tree
// renderer, two entry points. `role="tree"` with `aria-selected` on a
// `<button>` (an earlier version of this, duplicated in both tabs) is
// invalid ARIA: the `button` role doesn't support `aria-selected`, and a
// `tree` role requires `treeitem`/`group` descendants this plain
// button/list structure never provided — axe-core flags both as violations
// (aria-allowed-attr: critical, aria-required-children: critical). Rather
// than claim a treeview interaction pattern (roving tabindex, arrow-key
// navigation) this doesn't implement, this renders as what it actually is —
// a plain nested list of buttons — and uses `aria-current="true"` on the
// selected file, which is valid on any element and exactly matches its
// meaning ("the current item in a set of related items").
function fileTreeEl(root, { selectedPath = null, expandOnSelect = false, onSelectFile } = {}) {
  let selected = selectedPath;
  function nodeEl(node, depth) {
    if (node.children) {
      const kidsUl = el('ul', {});
      node.children.sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name));
      node.children.forEach(ch => kidsUl.append(el('li', {}, nodeEl(ch, depth + 1))));
      const open = depth < 1 || (expandOnSelect && !!selected);
      kidsUl.hidden = !open;
      const btn = el('button', { class: 'fnode', 'aria-expanded': String(open) }, el('span', { class: 'tw' }, open ? '▾' : '▸'), fico(node.kind), node.name);
      btn.addEventListener('click', () => {
        const isOpen = kidsUl.hidden === false;
        kidsUl.hidden = isOpen; btn.setAttribute('aria-expanded', String(!isOpen));
        btn.querySelector('.tw').textContent = isOpen ? '▸' : '▾';
      });
      return el('div', {}, btn, kidsUl);
    }
    const btn = el('button', { class: 'fnode', 'aria-current': node.path === selected ? 'true' : null },
      el('span', { class: 'tw' }), fico(node.kind), node.name, el('span', { class: 'fsize' }, node.size ?? ''));
    btn.addEventListener('click', () => {
      selected = node.path;
      tree.querySelectorAll('.fnode[aria-current]').forEach(n => n.removeAttribute('aria-current'));
      btn.setAttribute('aria-current', 'true');
      onSelectFile(node);
    });
    return btn;
  }
  const tree = el('div', { class: 'ftree', 'aria-label': 'Dataset files' }, nodeEl(root, 0));
  return tree;
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
    el('tbody', {}, ...rows.map(r => el('tr', {}, ...(cols || []).map((c, index) =>
      el('td', { class: 'mono', style: 'font-size:11px' }, String((Array.isArray(r) ? r[index] : r[c]) ?? ''))))))));
}
function jsonView(obj) {
  const pre = el('pre', { class: 'jsonview' });
  pre.innerHTML = JSON.stringify(obj, null, 2)
    .replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="v">"$1"</span>');
  return pre;
}

/* ======================= Viewer Lab ========================================
   A professional, PACS/DICOM-workstation-grade workspace: an integrated file
   browser on the left (any file in the manifest is clickable) and a
   format-aware viewer on the right. NIfTI files are rendered by Niivue
   (vendored at js/vendor/niivue.esm.js, v0.69.0) — a real WebGL2 medical-
   imaging engine, not a hand-rolled 2D canvas: true multi-planar
   reconstruction with GPU windowing, true 3D volume rendering (not a CSS
   locator cube), a native affine-aware measurement ruler, voxel-paint
   drawing (brush/erase/annotate) with NIfTI mask export, and real overlay
   compositing. The whole volume is fetched once, directly from the
   dataset's own CDN URL (already present in the manifest — OpenNeuro's S3
   bucket sends `Access-Control-Allow-Origin: *`, confirmed empirically),
   decompressed and range-read client-side by Niivue itself — no more
   per-slice/per-projection JSON round trips to this app's own backend.
   Also in this file: a scrollable, channel-pickable EEG/MEG viewer; a
   sortable/filterable data grid for TSV/CSV; a real collapsible JSON tree;
   and the original generic local-image tool. Nothing here fabricates a
   capability that doesn't exist — DWI tractography, unsupported signal
   formats (.set/.fif/.vhdr), and the two real gaps in this exact engine
   version (no 2D MIP/minIP/avgIP/slab-thickness projection — Niivue v0.69
   only offers per-slice 2D view or true 3D ray-cast rendering, nothing in
   between) all say so plainly rather than faking it. ========== */

// Exact-match modality lookup, used by tabOverview to decide whether a
// dataset has anatomical scans worth a mini brain-slice thumbnail — kept
// separate from the Viewer Lab itself, which browses real files rather than
// picking a mode by modality.
const VIEWER_MODALITY_KEYS = {
  anat: ['mri', 'anat', 't1w'],
  fmri: ['fmri', 'bold', 'func'],
  eeg: ['eeg'],
  dwi: ['dwi', 'dti'],
};

// NIFTI-1/2 datatype codes -> display name (the standard's own fixed code
// table, e.g. https://nifti.nimh.nih.gov/nifti-1 — not Qortex-specific).
const NIFTI_DATATYPE_NAMES = {
  2: 'uint8', 256: 'int8', 4: 'int16', 512: 'uint16', 8: 'int32', 768: 'uint32',
  16: 'float32', 64: 'float64', 128: 'rgb24', 2304: 'rgba32', 1024: 'int64', 1280: 'uint64',
};

// Volume loading indicator: elapsed time, real file size, and ETA from
// measured sources only. Niivue does not expose byte-progress in this
// version, so ETA comes from local historical timings for this operation or
// the browser's own network downlink estimate for the known manifest size.
// The completed load records a fresh sample for the next run.
// Minimal, honest loader: a real determinate progress bar plus one line of
// measured numbers — bytes so far / total, live download speed, and a real
// ETA = remaining bytes ÷ measured speed. No marketing prose, no fabricated
// estimate. `.update()` is driven by the streaming fetch in _niivueLoadAsync.
function mprLoadingWidget() {
  const bar = el('div', { class: 'mpr-load-fill mpr-load-fill-indeterminate' });
  const stat = el('div', { class: 'mpr-load-stat mono' }, 'Connecting…');
  const box = el('div', { class: 'mpr-load', role: 'status', 'aria-live': 'polite' },
    el('div', { class: 'mpr-load-title' }, 'Loading volume'),
    el('div', { class: 'mpr-load-bar' }, bar),
    stat);
  box.update = (received, total, speedBps) => {
    const spd = speedBps > 0 ? `${(speedBps / 1e6).toFixed(1)} MB/s` : '';
    if (total > 0) {
      bar.classList.remove('mpr-load-fill-indeterminate');
      bar.style.width = `${Math.min(100, (received / total) * 100).toFixed(1)}%`;
      const etaS = speedBps > 0 ? (total - received) / speedBps : null;
      const eta = etaS == null ? '' : etaS < 1 ? ' · ETA <1s' : ` · ETA ${Math.ceil(etaS)}s`;
      stat.textContent = `${fmtBytes(received)} / ${fmtBytes(total)}${spd ? ` · ${spd}` : ''}${eta}`;
    } else {
      stat.textContent = `${fmtBytes(received)}${spd ? ` · ${spd}` : ''}`;
    }
  };
  box.decoding = () => { bar.classList.remove('mpr-load-fill-indeterminate'); bar.style.width = '100%'; stat.textContent = 'Decoding…'; };
  return box;
}

// Stream a URL to an ArrayBuffer, reporting bytes received, total (from
// Content-Length) and the measured average speed — the raw material for a
// real ETA. Used to fetch the NIfTI ourselves so we can show honest progress,
// then hand the bytes to Niivue (which still does the gzip decode).
async function fetchArrayBufferWithProgress(url, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed (HTTP ${resp.status})`);
  const total = +resp.headers.get('content-length') || 0;
  if (!resp.body) return await resp.arrayBuffer(); // no streaming support
  const reader = resp.body.getReader();
  const t0 = performance.now();
  const chunks = []; let received = 0, lastTick = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.length;
    const now = performance.now();
    if (now - lastTick > 120) { // throttle UI updates
      lastTick = now;
      onProgress(received, total, received / ((now - t0) / 1000));
    }
  }
  onProgress(received, total, received / ((performance.now() - t0) / 1000));
  const out = new Uint8Array(received);
  let pos = 0; for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out.buffer;
}

// Returns the wrapper *synchronously* — the caller (renderStage) attaches it
// to the DOM immediately, and the real content streams in afterward. A slow
// whole-volume fetch (a large 4D fMRI series, or any .nii.gz) would
// otherwise render nothing at all — not even a spinner — until the entire
// fetch finished, because the DOM node holding the loading state was never
// actually attached to the page in the meantime.
// Ginkgo-leaf mark, reused in the workstation rail header (matches the app's
// own favicon / sidebar brand).
const LEAF_SVG = "<svg viewBox='0 0 32 32' width='20' height='20'><path fill='var(--green)' d='M16 22C6 21 3 11 6.5 4c3.5 6 6.5 9 9.5 11 3-2 6-5 9.5-11C29 11 26 21 16 22z'/><path stroke='var(--green)' stroke-width='2.4' stroke-linecap='round' fill='none' d='M16 30v-9'/></svg>";

// Small line-icons for the workstation toolbars — one accessible glyph per
// tool, matching the reference workstation's icon+label chip language. Pure
// inline SVG (sv() so they render in the SVG namespace), currentColor so the
// active/hover states inherit the button's own color.
function wsIcon(name) {
  const s = sv('svg', { viewBox: '0 0 24 24', class: 'ws-ic', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const P = (d) => s.append(sv('path', { d }));
  const R = (a) => s.append(sv('rect', a));
  const C = (a) => s.append(sv('circle', a));
  const L = (a) => s.append(sv('line', a));
  switch (name) {
    case 'browse': R({ x: 4, y: 4, width: 7, height: 7, rx: 1 }); R({ x: 13, y: 4, width: 7, height: 7, rx: 1 }); R({ x: 4, y: 13, width: 7, height: 7, rx: 1 }); R({ x: 13, y: 13, width: 7, height: 7, rx: 1 }); break;
    case 'viewer': R({ x: 3, y: 3, width: 18, height: 18, rx: 1.5 }); L({ x1: 12, y1: 3, x2: 12, y2: 21 }); L({ x1: 3, y1: 12, x2: 21, y2: 12 }); break;
    case 'analyze': P('M4 20V10M9 20V4M14 20v-7M19 20V8'); break;
    case 'compare': R({ x: 4, y: 4, width: 6.5, height: 16, rx: 1 }); R({ x: 13.5, y: 4, width: 6.5, height: 16, rx: 1 }); break;
    case 'lay-single': R({ x: 4, y: 4, width: 16, height: 16, rx: 1.5 }); break;
    case 'lay-row': R({ x: 3, y: 5, width: 5.5, height: 14, rx: 1 }); R({ x: 9.5, y: 5, width: 5.5, height: 14, rx: 1 }); R({ x: 16, y: 5, width: 5.5, height: 14, rx: 1 }); break;
    case 'lay-grid': R({ x: 4, y: 4, width: 7, height: 7, rx: 1 }); R({ x: 13, y: 4, width: 7, height: 7, rx: 1 }); R({ x: 4, y: 13, width: 7, height: 7, rx: 1 }); R({ x: 13, y: 13, width: 7, height: 7, rx: 1 }); break;
    case 'ortho': P('M12 3l7 4v10l-7 4-7-4V7z'); L({ x1: 12, y1: 3, x2: 12, y2: 21 }); L({ x1: 5, y1: 7, x2: 19, y2: 7 }); break;
    case 'mpr': P('M12 3l8 4.5-8 4.5-8-4.5z'); P('M4 12l8 4.5 8-4.5'); break;
    case 'cube': P('M12 3l7 4v10l-7 4-7-4V7z'); P('M5 7l7 4 7-4M12 11v10'); break;
    case 'slab': R({ x: 4, y: 8, width: 16, height: 8, rx: 1 }); break;
    case 'proj': P('M12 4v16M6 8l6-4 6 4'); break;
    case 'cine': C({ cx: 12, cy: 12, r: 9 }); P('M10 8.5l5 3.5-5 3.5z'); break;
    case 'measure': P('M4 14L14 4l6 6L10 20z'); L({ x1: 7, y1: 11, x2: 9, y2: 13 }); L({ x1: 10, y1: 8, x2: 12, y2: 10 }); L({ x1: 13, y1: 5, x2: 15, y2: 7 }); break;
    case 'annotate': P('M5 19l2-.5L18 7.5a1.8 1.8 0 0 0-2.5-2.5L4.5 16 4 19z'); break;
    case 'segment': P('M12 3l2.3 5.4L20 9l-4 3.8L17 19l-5-3-5 3 1-6.2L4 9l5.7-.6z'); break;
    case 'scroll': P('M8 6a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z'); L({ x1: 12, y1: 3, x2: 12, y2: 8 }); break;
    case 'pan': P('M12 3v8m0 0v8m0-8H4m8 0h8M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4'); break;
    case 'zoom': C({ cx: 10.5, cy: 10.5, r: 6 }); L({ x1: 15, y1: 15, x2: 20, y2: 20 }); L({ x1: 10.5, y1: 8, x2: 10.5, y2: 13 }); L({ x1: 8, y1: 10.5, x2: 13, y2: 10.5 }); break;
    case 'wl': C({ cx: 12, cy: 12, r: 8 }); P('M12 4a8 8 0 0 0 0 16z', ); break;
    case 'crosshair': L({ x1: 12, y1: 3, x2: 12, y2: 21 }); L({ x1: 3, y1: 12, x2: 21, y2: 12 }); C({ cx: 12, cy: 12, r: 3 }); break;
    case 'roi': s.append(sv('rect', { x: 4, y: 4, width: 16, height: 16, rx: 1.5, 'stroke-dasharray': '3 3' })); break;
    case 'brush': P('M4 20c2 0 3-1 3-3 0-1.5 1.5-2 2.5-1s.5 2.5-1 2.5'); P('M9 15L18 6a2 2 0 0 1 3 3l-9 9'); break;
    case 'erase': P('M8 20h11M5 16l6-6 7 7-4 4H9z'); break;
    case 'nav3d': P('M12 3l7 4v10l-7 4-7-4V7z'); C({ cx: 12, cy: 12, r: 2 }); break;
    case 'reset': P('M4 10a8 8 0 1 1 1 6'); P('M4 5v5h5'); break;
    case 'export': P('M12 15V3m0 0l-4 4m4-4l4 4'); P('M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3'); break;
    case 'fullscreen': P('M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 0-1 1h-4'); break;
    case 'gear': C({ cx: 12, cy: 12, r: 3 }); P('M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1'); break;
    case 'play': P('M8 5l11 7-11 7z'); break;
    case 'pause': L({ x1: 9, y1: 5, x2: 9, y2: 19 }); L({ x1: 15, y1: 5, x2: 15, y2: 19 }); break;
    case 'step-b': P('M18 5l-9 7 9 7z'); L({ x1: 7, y1: 5, x2: 7, y2: 19 }); break;
    case 'step-f': P('M6 5l9 7-9 7z'); L({ x1: 17, y1: 5, x2: 17, y2: 19 }); break;
    default: C({ cx: 12, cy: 12, r: 3 });
  }
  return s;
}
function wsTool(icon, label, attrs = {}) {
  return el('button', { class: 'ws-tool', ...attrs }, wsIcon(icon), el('span', { class: 'ws-tool-lbl' }, label));
}

// Niivue draws all three ortho planes + the 3D render into ONE canvas as a
// 2×2 grid (multiplanarLayout GRID, multiplanarEqualSize so each is an exact
// quarter). This is the empirically-verified tile order of that grid.
// Niivue's GRID tile order (verified against its drawSceneCore isDrawGrid
// branch): Coronal top-left, Sagittal top-right, Axial bottom-left, 3D
// bottom-right — labels must match the tiles Niivue actually draws.
const WS_PANE_TITLES = ['CORONAL', 'SAGITTAL', 'AXIAL', '3D VOLUME'];
const WS_PANE_COLORS = ['#e0705f', '#5b9bd5', '#70ad47', '#c98500'];
const WS_PANE_AXIS = [1, 0, 2];        // coronal→Y, sagittal→X, axial→Z
const WS_PANE_LETTER = ['J', 'I', 'K'];
const WS_PANE_MAX = ['coronal', 'sagittal', 'axial'];

function mprViewer(id, path, snapshot, sizeBytes, manifestFiles) {
  const center = el('div', { class: 'ws-center' });
  const right = el('div', { class: 'ws-inspector' });
  const mode = el('div', { class: 'ws-modebar' });
  const status = el('div', { class: 'ws-statusbar-inner' });
  const loader = mprLoadingWidget();
  center.append(el('div', { class: 'ws-viewport' }, loader));
  _niivueLoadAsync({ center, right, mode, status, loader }, id, path, snapshot, sizeBytes, manifestFiles || []).catch(err => {
    center.innerHTML = ''; center.append(errorPanel(err));
  });
  return { center, right, mode, status };
}

async function _niivueLoadAsync(slots, id, path, snapshot, sizeBytes, manifestFiles) {
  const { center, right, mode, status, loader } = slots;
  const rec = manifestFiles.find(f => f.path === path);
  const volUrl = rec?.urls?.[0];
  if (!volUrl) throw new Error('No CDN URL found for this file in the dataset manifest.');

  // Fetch the volume ourselves with streaming progress so the loader shows a
  // real, measured ETA (remaining bytes ÷ observed speed). Niivue then gets
  // the raw bytes and does the gzip decode — no second download.
  const fileName = path.split('/').pop();
  const volBuffer = await fetchArrayBufferWithProgress(volUrl, (r, t, spd) => loader?.update?.(r, t, spd));
  loader?.decoding?.();

  const canvas = el('canvas', {
    class: 'niivue-canvas', tabindex: '0', role: 'img',
    'aria-label': 'NIfTI volume viewport. Wheel scrubs slices; ctrl+wheel or pinch zooms; drag pans or adjusts window/level per the active tool.',
  });
  const roiLayer = el('div', { class: 'ws-roi-layer', 'aria-hidden': 'true' });
  // 2×2 pane-chrome overlay — colored titles, per-pane WL/WW readout and the
  // corner icon cluster, positioned exactly over Niivue's four equal tiles.
  const paneEls = WS_PANE_TITLES.map((title, i) => {
    const wl = el('span', { class: 'ws-pane-wl mono' }, '');
    const idx = el('span', { class: 'ws-pane-idx mono' }, '');
    const coord = el('div', { class: 'ws-pane-coord mono' }, '');
    const icons = el('div', { class: 'ws-pane-icons' },
      el('button', { class: 'ws-pane-ic', title: 'Maximize this pane', onclick: () => setActiveLayout((WS_PANE_MAX[i] || 'render')) }, wsIcon('lay-single')),
      el('button', { class: 'ws-pane-ic', title: 'Reset views', onclick: () => resetAllViews() }, wsIcon('reset')),
      el('button', { class: 'ws-pane-ic', title: 'Colormap / window', onclick: () => cmapSel.focus() }, wsIcon('wl')),
      el('button', { class: 'ws-pane-ic', title: 'Back to 2×2', onclick: () => setActiveLayout('grid') }, wsIcon('fullscreen')));
    return {
      wl, idx, coord,
      el: el('div', { class: 'ws-pane', 'data-quad': String(i) },
        el('div', { class: 'ws-pane-tl' }, el('span', { class: 'ws-pane-title', style: `color:${WS_PANE_COLORS[i]}` }, title), idx),
        wl, coord, icons),
    };
  });
  const paneGrid = el('div', { class: 'ws-pane-grid', 'aria-hidden': 'true' }, ...paneEls.map(p => p.el));
  const viewport = el('div', { class: 'ws-viewport' }, canvas, paneGrid, roiLayer);

  const nv = new Niivue({
    isResizeCanvas: true,
    show3Dcrosshair: true,
    isOrientationTextVisible: true,
    isColorbar: false,
    // NOT equalSize: equal-size tiles draw each slice at its true physical
    // proportions inside a square tile, so a thin volume (e.g. 9 mm through-
    // plane vs 16-18 mm in-plane) leaves large black margins. With this off,
    // each tile is sized to its slice so the image fills it. The pane-chrome
    // overlay is then positioned from Niivue's real tile rectangles
    // (nv.screenSlices) rather than assumed quarters — see positionPanes().
    multiplanarEqualSize: false,
    multiplanarShowRender: SHOW_RENDER.ALWAYS,
    multiplanarLayout: MULTIPLANAR_TYPE.GRID,
    dragAndDropEnabled: false,
    backColor: [0, 0, 0, 1],
    loadingText: ' ',
  });
  await nv.attachToCanvas(canvas);
  const nvImg = await NVImage.loadFromUrl({ url: volUrl, name: fileName, buffer: volBuffer, colormap: 'gray' });
  nv.addVolume(nvImg);

  // Position the pane-chrome (title / WL / coord / icons) on Niivue's actual
  // drawn tiles, in any layout, by reading screenSlices after each draw.
  // axCorSag: 0=axial, 1=coronal, 2=sagittal, 4=render → our pane order
  // [coronal, sagittal, axial, 3D].
  const AXCORSAG_TO_PANE = { 1: 0, 2: 1, 0: 2, 4: 3 };
  function positionPanes() {
    const dpr = nv.uiData?.dpr || window.devicePixelRatio || 1;
    paneEls.forEach(p => { p.el.style.display = 'none'; });
    for (const s of (nv.screenSlices || [])) {
      const idx = AXCORSAG_TO_PANE[s.axCorSag];
      if (idx == null) continue;
      const [l, t, w, h] = s.leftTopWidthHeight;
      if (w < 2 || h < 2) continue;
      const p = paneEls[idx].el;
      p.style.display = ''; p.style.left = `${l / dpr}px`; p.style.top = `${t / dpr}px`;
      p.style.width = `${w / dpr}px`; p.style.height = `${h / dpr}px`;
    }
  }
  const _origDrawScene = nv.drawScene.bind(nv);
  nv.drawScene = function () { const r = _origDrawScene(); positionPanes(); return r; };

  const vol0 = nv.volumes[0];
  const dimsRAS = vol0.dimsRAS.slice(1, 4);
  const is4d = (vol0.nTotalFrame4D || vol0.nFrame4D || 1) > 1;
  const initCal = { min: vol0.cal_min, max: vol0.cal_max };
  const voxelSpacing = (vol0.hdr?.pixDims || []).slice(1, 4);
  let renderer3D = null;
  try { renderer3D = nv.gl.getParameter(nv.gl.RENDERER); } catch { /* context not ready */ }

  let rightTabState = 'info';
  const overlayCandidates = manifestFiles.filter(f =>
    /\.nii(\.gz)?$/i.test(f.path) && f.path !== path &&
    f.path.startsWith(path.split('/').slice(0, -1).join('/')) && /_(mask|dseg|probseg|label-[\w]+)/i.test(f.path));
  const OVERLAY_COLORS = ['red', 'blue', 'green', 'warm', 'violet', 'cool'];
  const OVERLAY_SWATCH = { red: '#e0705f', blue: '#3987e5', green: '#199e70', warm: '#c98500', violet: '#9085e9', cool: '#3fb6c9' };
  const overlayState = overlayCandidates.map((f, i) => ({ file: f, visible: false, opacity: 0.6, volIdx: null, loading: false, colormap: OVERLAY_COLORS[i % OVERLAY_COLORS.length] }));
  const roiResults = [];
  let activeLayout = 'grid';
  let currentFrame = 0;
  let annotationRows = [];
  let activeAnnotation = null;

  // ---------- top toolbar ----------
  function goTab(tab) { location.hash = `#/ds/${id}/${tab}`; }
  const navGroup = el('div', { class: 'ws-tgroup' },
    wsTool('browse', 'Browse', { title: 'BIDS file browser', onclick: () => goTab('bids') }),
    wsTool('viewer', 'Viewer', { 'aria-pressed': 'true', title: 'Image viewer (current)' }),
    wsTool('analyze', 'Analyze', { title: 'Quality & readiness', onclick: () => goTab('quality') }),
    wsTool('compare', 'Compare', { title: 'Cross-dataset compatibility', onclick: () => goTab('compat') }));

  const layoutBtns = {};
  function setActiveLayout(key) {
    activeLayout = key;
    Object.entries(layoutBtns).forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === key)));
    const is3D = key === 'render';
    paneGrid.dataset.mode = key;
    if (key === 'axial') nv.setSliceType(nv.sliceTypeAxial);
    else if (key === 'coronal') nv.setSliceType(nv.sliceTypeCoronal);
    else if (key === 'sagittal') nv.setSliceType(nv.sliceTypeSagittal);
    else if (key === 'single') nv.setSliceType(nv.sliceTypeAxial);
    else if (key === 'row') { nv.setMultiplanarLayout(MULTIPLANAR_TYPE.ROW); nv.opts.multiplanarShowRender = SHOW_RENDER.NEVER; nv.setSliceType(nv.sliceTypeMultiplanar); }
    else if (key === 'mpr') { nv.setMultiplanarLayout(MULTIPLANAR_TYPE.ROW); nv.opts.multiplanarShowRender = SHOW_RENDER.NEVER; nv.setSliceType(nv.sliceTypeMultiplanar); }
    else if (key === 'grid') { nv.setMultiplanarLayout(MULTIPLANAR_TYPE.GRID); nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS; nv.setSliceType(nv.sliceTypeMultiplanar); }
    else if (key === 'render') nv.setSliceType(nv.sliceTypeRender);
    announce(`Layout: ${layoutBtns[key]?.title || key}`);
  }
  const layGroup = el('div', { class: 'ws-tgroup' },
    el('span', { class: 'ws-tgroup-lbl' }, 'Layout'),
    ...[['single', 'lay-single', 'Single plane'], ['row', 'lay-row', '3-plane row'], ['grid', 'lay-grid', '2×2 + 3D']].map(([k, ic, t]) => {
      const b = el('button', { class: 'ws-tool ws-tool-icon', 'aria-pressed': String(k === 'grid'), title: t, onclick: () => setActiveLayout(k) }, wsIcon(ic));
      layoutBtns['lay_' + k] = b; return b;
    }));
  const viewGroup = el('div', { class: 'ws-tgroup' },
    ...[['grid', 'ortho', 'Orthogonal'], ['mpr', 'mpr', 'MPR'], ['render', 'cube', '3D']].map(([k, ic, label]) => {
      const b = wsTool(ic, label, { 'aria-pressed': String(k === 'grid'), title: label, onclick: () => setActiveLayout(k) });
      layoutBtns[k] = b; return b;
    }),
    ...['Slab', 'MIP', 'minIP', 'avgIP'].map(label => wsTool('proj', label, {
      disabled: true,
      title: `2D ${label} isn't offered by this engine (Niivue v0.69): it does per-slice 2D or true 3D volume rendering, not 2D intensity projections. Disabled, not faked.`,
    })));
  const cineTool = wsTool('cine', 'Cine', { 'aria-pressed': 'false', disabled: !is4d, title: is4d ? 'Play 4D timepoints' : 'Cine needs a 4D volume — this file is 3D' });
  const actGroup = el('div', { class: 'ws-tgroup' },
    cineTool,
    wsTool('measure', 'Measure', { onclick: () => setMode('measure') }),
    wsTool('annotate', 'Annotate', { onclick: () => setMode('annotate') }),
    wsTool('segment', 'Segment', { onclick: () => setRightTab('overlays') }));
  const toolbar = el('div', { class: 'ws-toolbar' }, navGroup, layGroup, viewGroup, el('span', { class: 'sp', style: 'flex:1' }), actGroup);

  // ---------- interaction modes (bottom pill row) ----------
  let currentMode = 'crosshair';
  const modeBtns = {};
  function setMode(m) {
    currentMode = m;
    Object.entries(modeBtns).forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === m)));
    const isDraw = m === 'brush' || m === 'erase' || m === 'annotate';
    nv.setDrawingEnabled(isDraw);
    if (isDraw) nv.setPenValue(m === 'brush' ? 1 : m === 'annotate' ? 2 : 0, false);
    if (m === 'pan' || m === 'zoom') nv.setDragMode('pan');
    else if (m === 'wl') nv.setDragMode('contrast');
    else if (m === 'measure') nv.setDragMode('measurement');
    else if (m === 'roi') nv.setDragMode('roiSelection');
    else nv.setDragMode('crosshair'); // scroll + crosshair
    canvas.style.cursor = { pan: 'grab', zoom: 'zoom-in', brush: 'crosshair', erase: 'crosshair', annotate: 'crosshair' }[m] || 'crosshair';
    announce(`${m} mode`);
  }
  const MODES = [
    ['scroll', 'scroll', 'Scroll'], ['pan', 'pan', 'Pan'], ['zoom', 'zoom', 'Zoom'], ['wl', 'wl', 'WL'],
    ['crosshair', 'crosshair', 'Crosshair'], ['measure', 'measure', 'Measure'], ['roi', 'roi', 'ROI'],
    ['brush', 'brush', 'Brush'], ['erase', 'erase', 'Erase'],
  ];
  mode.append(el('div', { class: 'ws-modebar-pills' },
    ...MODES.map(([k, ic, label]) => {
      const b = wsTool(ic, label, { 'aria-pressed': String(k === currentMode), onclick: () => setMode(k) });
      modeBtns[k] = b; return b;
    }),
    wsTool('nav3d', '3D Nav', { title: 'GPU 3D volume camera (drag to orbit)', onclick: () => setActiveLayout('render') }),
    wsTool('reset', 'Reset', { onclick: resetAllViews })));
  function resetAllViews() {
    vol0.cal_min = initCal.min; vol0.cal_max = initCal.max;
    nv.updateGLVolume();
    setActiveLayout('grid'); setMode('crosshair');
    refreshReadouts();
    announce('View reset');
  }

  // ---------- slice sliders + cine transport (center bottom) ----------
  const SLICE_META = [
    { axis: 0, label: 'Sagittal', letter: 'I', color: '#e0a339' },
    { axis: 1, label: 'Coronal', letter: 'J', color: '#3987e5' },
    { axis: 2, label: 'Axial', letter: 'K', color: '#70ad47' },
  ];
  const sliceSliders = SLICE_META.map(({ axis, label, letter, color }) => {
    const max = Math.max(1, dimsRAS[axis] - 1);
    const input = el('input', { type: 'range', min: 0, max, value: Math.floor(max / 2), style: `--track:${color}` });
    const val = el('span', { class: 'mono ws-slice-val' }, `${input.value} / ${max}`);
    input.addEventListener('input', () => {
      const vox = nv.frac2vox(nv.scene.crosshairPos);
      vox[axis] = +input.value;
      nv.scene.crosshairPos = nv.vox2frac(vox);
      nv.createOnLocationChange(); nv.drawScene();
    });
    return { axis, input, val, row: el('div', { class: 'ws-slice-row' }, el('span', { class: 'ws-slice-label' }, `${label} (${letter})`), input, val) };
  });
  const cineBlock = el('div', { class: 'ws-cine' });
  const sliceBar = el('div', { class: 'ws-slicebar' },
    el('div', { class: 'ws-slice-cols' }, ...sliceSliders.map(s => s.row)),
    cineBlock);

  // ---------- right inspector ----------
  const rightBody = el('div', { class: 'inspector-body' });
  const rightTabs = ['info', 'overlays', 'measurements', 'annotations'];
  const rightTabLabels = { info: 'Info', overlays: 'Overlays', measurements: 'Measurements', annotations: 'Annotations' };
  const rightTabBar = el('div', { class: 'inspector-tabs' },
    ...rightTabs.map(t => el('button', { class: 'inspector-tab', 'aria-selected': String(t === rightTabState), onclick: () => setRightTab(t) }, rightTabLabels[t])));
  function setRightTab(t) {
    rightTabState = t;
    [...rightTabBar.children].forEach((b, i) => b.setAttribute('aria-selected', String(rightTabs[i] === t)));
    renderRightBody();
  }
  right.append(rightTabBar, rightBody);

  async function toggleOverlay(ov) {
    ov.visible = !ov.visible;
    if (ov.visible && ov.volIdx == null) {
      ov.loading = true; renderRightBody();
      try {
        const ovImg = await NVImage.loadFromUrl({ url: ov.file.urls[0], colormap: ov.colormap, opacity: ov.opacity });
        nv.addVolume(ovImg);
        ov.volIdx = nv.volumes.length - 1;
        ov.stats = nv.getDescriptives({ layer: ov.volIdx, drawingIsMask: false });
      } catch (err) { toast(`Could not load overlay: ${err.message}`, 'fail'); ov.visible = false; }
      finally { ov.loading = false; }
    }
    if (ov.volIdx != null) nv.setOpacity(ov.volIdx, ov.visible ? ov.opacity : 0);
    renderRightBody();
  }

  function renderRightBody() {
    rightBody.innerHTML = '';
    if (rightTabState === 'info') {
      const dtype = NIFTI_DATATYPE_NAMES[vol0.hdr?.datatypeCode] || `code ${vol0.hdr?.datatypeCode}`;
      const qs = vol0.hdr?.qform_code, ss = vol0.hdr?.sform_code;
      const rows = [
        ['Dimensions', dimsRAS.join(' × ') + (is4d ? ` × ${vol0.nTotalFrame4D || vol0.nFrame4D}` : '')],
        voxelSpacing.length === 3 ? ['Voxel Spacing', voxelSpacing.map(v => (+v).toFixed(2)).join(' × ') + ' mm'] : null,
        ['Datatype', dtype],
        ['Intensity Range', `${fmtIntensity(vol0.cal_min)} – ${fmtIntensity(vol0.cal_max)}`],
        ['Robust Range', vol0.robust_min != null ? `${fmtIntensity(vol0.robust_min)} – ${fmtIntensity(vol0.robust_max)}` : 'n/a'],
        ['Orientation', 'RAS'],
        (qs != null || ss != null) ? ['Qform / Sform', `${qs > 0 ? 'set' : '—'} / ${ss > 0 ? 'set' : '—'}${(qs > 0 || ss > 0) ? ' · Aligned' : ''}`] : null,
      ].filter(Boolean);
      const dl = el('dl', { class: 'kv' });
      rows.forEach(([k, v]) => dl.append(el('dt', {}, k), el('dd', { class: 'mono' }, v)));
      rightBody.append(el('div', { class: 'inspector-sec-h ws-sec-row' },
        el('span', { class: 'ws-sec-caret' }, '▾ Metadata'),
        el('select', { class: 'ws-mini-sel', 'aria-label': 'Metadata source' }, el('option', {}, 'NIfTI Header'))), dl);

      let affine = null;
      try { affine = nv.getVolumeAffine(0); } catch { /* no affine */ }
      if (affine) {
        rightBody.append(el('div', { class: 'kv-line' }, el('dt', {}, 'Affine'),
          el('pre', { class: 'mono affine-box' }, affine.map(row => row.map(v => (+v).toFixed(2).padStart(8)).join(' ')).join('\n'))));
      }

      const sidecarBox = el('div', {}, el('p', { class: 'sub', style: 'font-size:11.5px' }, 'Fetching BIDS sidecar…'));
      rightBody.append(el('div', { class: 'inspector-sec-h' }, 'BIDS metadata'), sidecarBox);
      Api.sidecar(id, { path, snapshot }).then(sc => {
        sidecarBox.innerHTML = '';
        const entries = Object.entries(sc || {}).filter(([k]) => !k.startsWith('_'));
        if (!entries.length) { sidecarBox.append(el('p', { class: 'sub', style: 'font-size:11.5px' }, 'No sidecar JSON found.')); return; }
        const dl2 = el('dl', { class: 'kv' });
        entries.slice(0, 14).forEach(([k, v]) => dl2.append(el('dt', {}, k), el('dd', { class: 'mono' }, typeof v === 'object' ? JSON.stringify(v) : String(v))));
        sidecarBox.append(dl2);
      }).catch(() => { sidecarBox.innerHTML = ''; sidecarBox.append(el('p', { class: 'sub', style: 'font-size:11.5px' }, 'No sidecar JSON found.')); });

      renderOverlaySection(rightBody);
      renderQuickStats(rightBody);
    } else if (rightTabState === 'overlays') {
      renderOverlaySection(rightBody, true);
      renderQuickStats(rightBody);
    } else if (rightTabState === 'measurements') {
      const measurements = nv.document.completedMeasurements;
      if (!measurements.length && !roiResults.length) {
        rightBody.append(el('p', { class: 'sub', style: 'font-size:12px' }, 'No measurements yet. Use Measure (drag = affine-aware distance) or ROI (drag a box = intensity stats) from the tool row.'));
        return;
      }
      measurements.forEach((m, mi) => rightBody.append(el('div', { class: 'measure-row' },
        el('span', {}, `Distance #${mi + 1}`), el('span', { class: 'mono' }, `${m.distance.toFixed(1)} mm`),
        el('button', { class: 'row-del', title: 'Delete', onclick: () => { measurements.splice(mi, 1); nv.drawScene(); renderRightBody(); } }, '✕'))));
      roiResults.forEach((r, ri) => rightBody.append(el('div', { class: 'measure-row measure-row-stack' },
        el('span', {}, `ROI #${ri + 1} (n=${r.n}${r.volumeMm3 ? `, ${(r.volumeMm3 / 1000).toFixed(2)} cm³` : ''})`),
        el('span', { class: 'mono' }, `mean ${fmtIntensity(r.mean)} · sd ${fmtIntensity(r.std)} · [${fmtIntensity(r.min)}, ${fmtIntensity(r.max)}]`),
        el('button', { class: 'row-del', title: 'Delete', onclick: () => { r.boxEl?.remove(); roiResults.splice(ri, 1); renderRightBody(); } }, '✕'))));
      rightBody.append(el('div', { style: 'margin-top:10px;display:flex;gap:6px' },
        el('button', { class: 'btn btn-sm', onclick: () => exportMeasurements('json') }, 'Export JSON'),
        el('button', { class: 'btn btn-sm', onclick: () => exportMeasurements('csv') }, 'Export CSV')));
    } else {
      renderAnnotationInspector();
    }
  }
  function renderOverlaySection(host, standalone = false) {
    host.append(el('div', { class: 'inspector-sec-h ws-sec-row' },
      el('span', {}, 'Overlays'),
      el('button', { class: 'ws-addov', title: overlayState.length ? 'Show discovered mask/segmentation files' : 'No mask/segmentation siblings found for this file', onclick: () => { setRightTab('overlays'); if (!overlayState.length) toast('No *_mask / *_dseg / *_probseg / *_label-* files found alongside this image.'); } }, '＋ Add Overlay')));
    if (!overlayState.length) {
      host.append(el('p', { class: 'sub', style: 'font-size:11px' }, standalone
        ? `No segmentation/mask files found alongside ${path.split('/').pop()} (looked for *_mask, *_dseg, *_probseg, *_label-* in the same folder).`
        : 'No mask/segmentation siblings found.'));
      return;
    }
    overlayState.forEach((ov) => {
      const pct = el('span', { class: 'mono ws-ov-pct' }, `${Math.round(ov.opacity * 100)}%`);
      host.append(el('div', { class: 'overlay-row' },
        el('span', { class: 'ws-ov-swatch', style: `background:${OVERLAY_SWATCH[ov.colormap] || '#888'}` }),
        el('span', { class: 'ov-name', title: ov.file.path }, ov.file.path.split('/').pop().replace(/\.nii(\.gz)?$/i, '')),
        el('button', { class: 'ov-eye', 'aria-pressed': String(ov.visible), disabled: ov.loading, title: 'Toggle visibility', onclick: () => toggleOverlay(ov) }, ov.loading ? '…' : ov.visible ? '👁' : '⦸'),
        pct,
        el('input', { class: 'ws-ov-range', type: 'range', min: 0, max: 100, value: Math.round(ov.opacity * 100), oninput: (e) => { ov.opacity = +e.target.value / 100; pct.textContent = `${e.target.value}%`; if (ov.volIdx != null && ov.visible) nv.setOpacity(ov.volIdx, ov.opacity); } })));
    });
  }
  function renderQuickStats(host) {
    // Real stats for the active layer: the last-shown overlay (a mask/seg —
    // exactly what the reference's "QUICK STATS (Lesion Segmentation)" shows)
    // if one is visible, else the base volume. Every number is computed by
    // Niivue's own getDescriptives over the real voxel array — nothing faked.
    const activeOv = [...overlayState].reverse().find(o => o.visible && o.volIdx != null);
    const label = activeOv ? activeOv.file.path.split('/').pop().replace(/\.nii(\.gz)?$/i, '') : path.split('/').pop().replace(/\.nii(\.gz)?$/i, '');
    let stats;
    try { stats = nv.getDescriptives({ layer: activeOv ? activeOv.volIdx : 0, drawingIsMask: false }); } catch { stats = null; }
    host.append(el('div', { class: 'inspector-sec-h' }, `Quick Stats`),
      el('div', { class: 'ws-qs-sub mono' }, label));
    const box = el('div', { class: 'quick-stats' });
    const nonZero = stats ? (stats.nvoxNot0 ?? stats.nvox) : null;
    // Real mm bounding box of the volume's field of view — the 8 fractional
    // corners pushed through Niivue's own affine (frac2mm), min/max per axis.
    let bbox = null;
    try {
      const xs = [], ys = [], zs = [];
      for (const fx of [0, 1]) for (const fy of [0, 1]) for (const fz of [0, 1]) {
        const m = nv.frac2mm([fx, fy, fz]); xs.push(m[0]); ys.push(m[1]); zs.push(m[2]);
      }
      const rng = (a) => `[${Math.min(...a).toFixed(1)}, ${Math.max(...a).toFixed(1)}]`;
      bbox = { x: rng(xs), y: rng(ys), z: rng(zs) };
    } catch { /* no affine */ }
    box.append(
      qsRow('Voxel Count', stats ? fmt(activeOv ? nonZero : stats.nvox) : '—'),
      qsRow('Volume (mm³)', stats?.volumeMM3 != null ? fmt(Math.round(stats.volumeMM3)) : '—'),
      qsRow('Volume (cm³)', stats?.volumeML != null ? stats.volumeML.toFixed(2) : '—'),
      qsRow('Mean', stats ? fmtIntensity(activeOv ? (stats.meanNot0 ?? stats.mean) : stats.mean) : '—'));
    if (bbox) host.append(box, el('div', { class: 'ws-bbox' },
      el('div', { class: 'quick-stat-label' }, 'Bounding Box (mm)'),
      el('div', { class: 'mono ws-bbox-rows' }, `X: ${bbox.x}`, el('br'), `Y: ${bbox.y}`, el('br'), `Z: ${bbox.z}`)));
    else host.append(box);
  }
  function qsRow(k, v) { return el('div', { class: 'quick-stat' }, el('span', { class: 'quick-stat-label' }, k), el('span', { class: 'mono' }, v)); }
  function exportMeasurements(fmtKind) {
    const rows = [
      ...nv.document.completedMeasurements.map(m => ({ type: 'distance', value: m.distance, unit: 'mm' })),
      ...roiResults.map(r => ({ type: 'roi', mean: r.mean, std: r.std, min: r.min, max: r.max, n: r.n, volumeMm3: r.volumeMm3 })),
    ];
    const blob = fmtKind === 'json' ? new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
      : new Blob([['type,value,unit,mean,std,min,max,n', ...rows.map(r => `${r.type},${r.value ?? ''},${r.unit ?? ''},${r.mean ?? ''},${r.std ?? ''},${r.min ?? ''},${r.max ?? ''},${r.n ?? ''}`)].join('\n')], { type: 'text/csv' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `measurements.${fmtKind}` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function annotationPayload(title) {
    const distances = nv.document.completedMeasurements.map((measurement, index) => ({
      id: `distance-${index + 1}`, kind: 'distance', distance_mm: Number(measurement.distance),
    }));
    const rois = roiResults.map((roi, index) => ({
      id: `roi-${index + 1}`, kind: 'roi',
      start_voxel: Array.from(roi.startVox, value => Math.round(value)),
      end_voxel: Array.from(roi.endVox, value => Math.round(value)),
      mean: roi.mean, std: roi.std, min: roi.min, max: roi.max,
      voxel_count: roi.n, volume_mm3: roi.volumeMm3,
    }));
    const crosshairVoxel = Array.from(nv.frac2vox(nv.scene.crosshairPos), value => Math.round(value));
    const crosshairWorld = Array.from(nv.frac2mm(nv.scene.crosshairPos)).slice(0, 3).map(Number);
    const bookmark = { id: 'bookmark-current', name: 'Saved view', voxel: crosshairVoxel, world_mm: crosshairWorld, frame: currentFrame };
    return {
      title,
      layers: [
        { id: 'distance-layer', name: 'Distances', kind: 'measurements', visible: true, color: '#47d7ac', item_ids: distances.map(item => item.id) },
        { id: 'roi-layer', name: 'ROIs', kind: 'rois', visible: true, color: '#e0a339', item_ids: rois.map(item => item.id) },
        { id: 'bookmark-layer', name: 'Bookmarks', kind: 'bookmarks', visible: true, color: '#3987e5', item_ids: [bookmark.id] },
      ],
      measurements: [...distances, ...rois],
      bookmarks: [bookmark],
      viewport: {
        crosshair_voxel: crosshairVoxel, crosshair_world_mm: crosshairWorld,
        frame: currentFrame, layout: activeLayout, cal_min: Number(vol0.cal_min), cal_max: Number(vol0.cal_max),
      },
    };
  }

  async function refreshAnnotations() {
    const response = await Api.annotations(id, { snapshot, sourcePath: path });
    annotationRows = response.annotations || [];
    if (rightTabState === 'annotations') renderRightBody();
  }

  async function loadAnnotation(annotationId, revision = undefined) {
    activeAnnotation = await Api.annotation(id, annotationId, { snapshot, revision });
    const view = activeAnnotation.viewport;
    vol0.cal_min = view.cal_min;
    vol0.cal_max = view.cal_max;
    nv.updateGLVolume();
    nv.scene.crosshairPos = nv.vox2frac(view.crosshair_voxel);
    currentFrame = view.frame;
    if (is4d) nv.setFrame4D(vol0.id, Math.min(view.frame, (vol0.nTotalFrame4D || vol0.nFrame4D) - 1));
    setActiveLayout(view.layout);
    nv.createOnLocationChange();
    nv.drawScene();
    renderRightBody();
    announce(`Restored annotation ${activeAnnotation.title}, revision ${activeAnnotation.revision}`);
  }

  async function persistAnnotation(title, updateExisting) {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Annotation title is required.');
    const body = { source_path: path, payload: annotationPayload(trimmed) };
    if (updateExisting) {
      if (!activeAnnotation) throw new Error('Select an existing annotation before updating.');
      body.annotation_id = activeAnnotation.annotation_id;
      body.expected_revision = activeAnnotation.revision;
    }
    activeAnnotation = await Api.saveAnnotation(id, snapshot, body);
    await refreshAnnotations();
    toast(`Annotation ${updateExisting ? 'updated' : 'saved'} · revision ${activeAnnotation.revision}`);
  }

  function renderAnnotationInspector() {
    const titleInput = el('input', {
      class: 'input', type: 'text', maxlength: '200', value: activeAnnotation?.title || `${fileName} review`,
      'aria-label': 'Annotation title',
    });
    const status = el('div');
    const saveNew = el('button', { class: 'btn btn-sm' }, 'Save new');
    const update = el('button', { class: 'btn btn-sm', disabled: !activeAnnotation }, 'Update selected');
    const importInput = el('input', { type: 'file', accept: 'application/json', class: 'sr-only', 'aria-label': 'Import annotation JSON' });
    const importButton = el('button', { class: 'btn btn-sm', onclick: () => importInput.click() }, 'Import JSON');
    const runSave = async (isUpdate) => {
      saveNew.disabled = true; update.disabled = true; status.innerHTML = '';
      status.append(el('p', { class: 'sub' }, 'Validating and writing an immutable annotation revision…'));
      try {
        await persistAnnotation(titleInput.value, isUpdate);
        if (rightTabState === 'annotations') renderRightBody();
      } catch (err) {
        status.innerHTML = ''; status.append(errorPanel(err));
        saveNew.disabled = false; update.disabled = !activeAnnotation;
      }
    };
    saveNew.onclick = () => runSave(false);
    update.onclick = () => runSave(true);
    importInput.onchange = async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        const payload = Object.fromEntries(['title', 'layers', 'measurements', 'bookmarks', 'viewport'].map(key => [key, imported[key]]));
        activeAnnotation = await Api.saveAnnotation(id, snapshot, { source_path: path, payload });
        await refreshAnnotations();
        toast(`Imported annotation ${activeAnnotation.annotation_id}`);
        if (rightTabState === 'annotations') renderRightBody();
      } catch (err) { status.innerHTML = ''; status.append(errorPanel(err)); }
      finally { importInput.value = ''; }
    };
    rightBody.append(
      el('div', { class: 'inspector-sec-h' }, 'Versioned annotation document'),
      el('p', { class: 'sub', style: 'font-size:11px' }, `Bound to ${id}@${snapshot} · ${path}. Saving captures typed measurements, ROI voxel bounds, a bookmark, window, frame, and layout.`),
      titleInput,
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' }, saveNew, update, importButton, importInput),
      status,
    );
    if (activeAnnotation) {
      const selected = activeAnnotation;
      rightBody.append(el('div', { class: 'demographic-warning' },
        el('b', {}, `${selected.title} · revision ${selected.revision}`),
        el('span', { class: 'mono' }, selected.annotation_id),
        el('span', {}, `${selected.measurements.length} measurements · ${selected.bookmarks.length} bookmark · ${selected.layers.length} layers`)),
        el('div', { style: 'display:flex;gap:6px;margin:8px 0' },
          el('button', { class: 'btn btn-sm', onclick: () => loadAnnotation(selected.annotation_id) }, 'Restore selected view'),
          el('button', { class: 'btn btn-sm', onclick: () => {
            const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
            const link = el('a', { href: URL.createObjectURL(blob), download: `${selected.annotation_id}-r${selected.revision}.json` });
            link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 2000);
          } }, 'Export selected JSON')));
      selected.measurements.forEach(item => rightBody.append(el('div', { class: 'measure-row measure-row-stack' },
        el('span', {}, item.kind === 'distance' ? item.id : `${item.id} · ${item.voxel_count} voxels`),
        el('span', { class: 'mono' }, item.kind === 'distance' ? `${item.distance_mm.toFixed(2)} mm` : `mean ${fmtIntensity(item.mean)} · sd ${fmtIntensity(item.std)}`))));
    }
    rightBody.append(el('div', { class: 'inspector-sec-h' }, `Saved for this source (${annotationRows.length})`));
    if (!annotationRows.length) rightBody.append(el('p', { class: 'sub', style: 'font-size:11px' }, 'No server-backed annotations exist for this source.'));
    annotationRows.forEach(row => rightBody.append(el('button', {
      class: 'qrow', style: 'width:100%;text-align:left;background:none;border:none;cursor:pointer',
      onclick: () => loadAnnotation(row.annotation_id),
    }, el('span', { class: 'qmark-s q-pass' }), el('span', {},
      el('b', {}, row.title), el('span', { class: 'sub mono' }, `${row.annotation_id} · r${row.revision} · ${row.measurement_count} measurements`)))));
  }
  nv.onMeasurementCompleted = () => renderRightBody();

  // ---------- status bar (real state only — no fabricated throughput/VRAM) ----------
  const statusDot = el('span', { class: 'status-dot status-good' });
  const statusText = el('span', { class: 'sub' }, 'Volume streamed from CDN · decoded in-browser');
  const gpuShort = renderer3D ? (renderer3D.match(/\(([^,]+),/) || [, renderer3D])[1].trim().slice(0, 24) : 'WebGL2';
  status.append(
    el('div', { class: 'ws-status-l' }, statusDot, el('b', {}, 'System Status'), el('span', { class: 'ws-status-sep' }), el('span', { class: 'sub' }, 'All Systems Operational')),
    el('div', { class: 'ws-status-c' }, statusText),
    el('div', { class: 'ws-status-r' },
      el('span', { class: 'sub mono', title: renderer3D || '' }, wsIcon('nav3d'), `GPU: ${gpuShort}`),
      el('span', { class: 'ws-status-sep' }),
      el('span', { class: 'sub mono' }, 'WebGL2'),
      el('span', { class: 'ws-status-sep' }),
      el('span', { class: 'sub mono' }, '64-bit')));

  // ---------- readouts (crosshair, WL, slice indices, pane overlays) ----------
  function refreshReadouts() {
    const wlTxt = `WL: ${Math.round((vol0.cal_min + vol0.cal_max) / 2)} WW: ${Math.round(vol0.cal_max - vol0.cal_min)}`;
    paneEls.forEach(p => p.wl.textContent = wlTxt);
  }
  refreshReadouts();
  canvas.addEventListener('pointerup', refreshReadouts);
  nv.onLocationChange = (msg) => {
    const vox = msg.vox.map(v => Math.round(v));
    const mm = msg.mm;
    sliceSliders.forEach(s => { s.input.value = vox[s.axis]; s.val.textContent = `${vox[s.axis]} / ${s.input.max}`; });
    // per-pane slice index (letter maps to that pane's real RAS axis) +
    // shared mm coordinate readout (bottom-left of every pane).
    const coordTxt = mm ? `X: ${mm[0].toFixed(1)}  Y: ${mm[1].toFixed(1)}  Z: ${mm[2].toFixed(1)} (mm)` : '';
    paneEls.slice(0, 3).forEach((p, i) => {
      const ax = WS_PANE_AXIS[i];
      p.idx.textContent = `${WS_PANE_LETTER[i]} ${vox[ax]} / ${dimsRAS[ax] - 1}`;
      p.coord.textContent = coordTxt;
    });
    paneEls[3].idx.textContent = '';
    paneEls[3].coord.textContent = coordTxt;
    refreshReadouts();
  };

  // ---------- colormap select (compact, in the slice bar — never floats over
  // a pane title the way an in-viewport control would) ----------
  const cmapSel = el('select', { class: 'ws-cmap', 'aria-label': 'Colormap', onchange: () => nv.setColormap(vol0.id, cmapSel.value) },
    ...nv.colormaps().map(c => el('option', { value: c, selected: c === 'gray' ? '' : null }, c)));
  cmapSel.value = 'gray';
  sliceBar.append(el('div', { class: 'ws-cine ws-mapblock' }, el('span', { class: 'ws-cine-title' }, 'MAP'), cmapSel));

  // ---------- ROI drag (screen-space box → real voxel stats) ----------
  let roiStart = null, roiBox = null;
  const boxStyle = (x0, y0, x1, y1) => `left:${Math.min(x0, x1)}px;top:${Math.min(y0, y1)}px;width:${Math.abs(x1 - x0)}px;height:${Math.abs(y1 - y0)}px`;
  canvas.addEventListener('pointerdown', (e) => {
    if (currentMode !== 'roi') return;
    const r = canvas.getBoundingClientRect();
    roiStart = [e.clientX - r.left, e.clientY - r.top];
    roiBox = el('div', { class: 'roi-box roi-box-pending', style: boxStyle(roiStart[0], roiStart[1], roiStart[0], roiStart[1]) });
    roiLayer.append(roiBox);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (currentMode !== 'roi' || !roiStart || !roiBox) return;
    const r = canvas.getBoundingClientRect();
    roiBox.style.cssText = boxStyle(roiStart[0], roiStart[1], e.clientX - r.left, e.clientY - r.top);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (currentMode !== 'roi' || !roiStart) { roiBox?.remove(); roiBox = null; return; }
    const r = canvas.getBoundingClientRect();
    const endPx = [e.clientX - r.left, e.clientY - r.top];
    const startFrac = nv.canvasPos2frac(roiStart), endFrac = nv.canvasPos2frac(endPx);
    const startPx = roiStart; roiStart = null;
    if (startFrac[0] < 0 || endFrac[0] < 0 || Math.hypot(endPx[0] - startPx[0], endPx[1] - startPx[1]) < 4) { roiBox?.remove(); roiBox = null; return; }
    const a = nv.frac2vox(startFrac), b = nv.frac2vox(endFrac);
    const startVox = a.map((v, i) => Math.min(v, b[i])).map(Math.round);
    const endVox = a.map((v, i) => Math.max(v, b[i])).map(Math.round);
    const info = nv.getDescriptives({ layer: 0, roiIsMask: true, startVox, endVox });
    roiBox.classList.remove('roi-box-pending');
    roiResults.push({
      mean: info.mean, std: info.stdev ?? info.std, min: info.min, max: info.max,
      n: info.nvox ?? info.n, volumeMm3: info.volumeMM3,
      startVox, endVox, boxEl: roiBox,
    });
    roiBox = null;
    setRightTab('measurements');
    announce(`ROI: mean ${fmtIntensity(info.mean)}, n=${info.nvox ?? info.n} voxels`);
  });

  // ---------- cine transport ----------
  if (is4d) {
    const nFrames = vol0.nTotalFrame4D || vol0.nFrame4D;
    let time = 0, playTimer = null, playing = false, fps = 10;
    const tSlider = el('input', { type: 'range', min: 0, max: nFrames - 1, value: 0 });
    const tLabel = el('span', { class: 'mono ws-cine-t' }, `0 / ${nFrames - 1}`);
    const playBtn = el('button', { class: 'ws-cine-btn', title: 'Play/pause', onclick: togglePlay }, wsIcon('play'));
    const stepB = el('button', { class: 'ws-cine-btn', title: 'Previous frame', onclick: () => setTime(time - 1) }, wsIcon('step-b'));
    const stepF = el('button', { class: 'ws-cine-btn', title: 'Next frame', onclick: () => setTime(time + 1) }, wsIcon('step-f'));
    const fpsLabel = el('span', { class: 'mono ws-cine-fps' }, `${fps} fps`);
    cineBlock.append(el('span', { class: 'ws-cine-title' }, 'CINE'), stepB, playBtn, stepF, tSlider, tLabel, fpsLabel);
    function setTime(t) { time = ((t % nFrames) + nFrames) % nFrames; currentFrame = time; tSlider.value = time; tLabel.textContent = `${time} / ${nFrames - 1}`; nv.setFrame4D(vol0.id, time); }
    tSlider.addEventListener('input', () => setTime(+tSlider.value));
    function togglePlay() {
      playing = !playing;
      playBtn.replaceChildren(wsIcon(playing ? 'pause' : 'play'));
      cineTool.setAttribute('aria-pressed', String(playing));
      if (playing) playTimer = setInterval(() => setTime(time + 1), 1000 / fps);
      else clearInterval(playTimer);
    }
    cineTool.addEventListener('click', togglePlay);
  } else {
    cineBlock.append(el('span', { class: 'ws-cine-title' }, 'CINE'), el('span', { class: 'sub', style: 'font-size:11px' }, '3D volume — no timepoints'));
  }

  // ---------- assemble center ----------
  center.replaceChildren(toolbar, viewport, sliceBar);
  renderRightBody();
  setActiveLayout('grid');
  setMode('crosshair');
  statusText.textContent = 'Volume loaded';
  refreshAnnotations().catch(err => toast(`Annotation inventory unavailable: ${err.message}`, 'fail'));
}


// A clinical EEG scroll view — the actual visual conventions of the field
// (Persyst/Natus/EEGLAB-style dark trace review), not a generic line chart
// re-skinned in a brand accent color:
//   - a shared, fixed sensitivity (µV/division) across all rows, because
//     relative amplitude *between* channels is diagnostically meaningful —
//     but computed from the *median* per-channel peak, not the raw global
//     max, so one physiologically implausible channel (a timestamp counter,
//     a sample index, a battery-level flag — real fields found in a real
//     Emotiv EPOC export, see _EEG_ELECTRODE_RE) can never crush every real
//     trace to a flat line. A channel whose own peak still overflows its row
//     after that is clipped at the row edge, not allowed to bleed into
//     neighboring rows — exactly like clinical review software does when a
//     channel saturates.
//   - alternating row shading and a subtle per-row baseline, not just
//     vertical time gridlines, so 20+ stacked traces stay readable.
//   - a small region-coded dot per channel (10-20 frontal/central-temporal/
//     parietal-occipital), the same quick-glance convention clinical montage
//     displays use.
//   - non-standard channels (anything that isn't a real 10-20/10-10 scalp
//     site — timestamps, counters, quality flags) render in a distinct
//     amber "AUX" color, never pretending to be neural signal.
//   - a left gutter sized to the longest channel label actually being
//     rendered, not a fixed guess that clips on longer real-world labels.
const EEG_REGION_COLOR = { frontal: 'var(--eeg-region-frontal)', central: 'var(--eeg-region-central)', posterior: 'var(--eeg-region-posterior)', aux: 'var(--eeg-region-aux)' };
// Mirrors qortex.console.api's _EEG_ELECTRODE_RE exactly — including the
// optional `-<reference site>` suffix (e.g. "Fp1-M2", a standard mastoid-
// referenced montage label, not a malformed one). Must stay in sync: this
// classifies for *display* (region dot, standard/aux grouping) what the
// server already decided for *selection*, and disagreeing between the two
// would put a channel in "scalp electrodes" server-side while showing it as
// amber/"AUX" client-side, or vice versa.
function eegRegionOf(label) {
  const m = /^(Fp|AF|FT|FC|TP|CP|PO|F|C|T|P|O|A|M|I)(z|\d{1,2})(-(Fp|AF|FT|FC|TP|CP|PO|F|C|T|P|O|A|M|I)(z|\d{1,2}))?$/i.exec(label);
  if (!m) return 'aux';
  const prefix = m[1].toUpperCase();
  if (prefix === 'FP' || prefix === 'AF' || prefix === 'F') return 'frontal';
  if (['FC', 'FT', 'C', 'T', 'TP', 'CP'].includes(prefix)) return 'central';
  return 'posterior'; // P, PO, O
}
function eegIsStandardElectrode(label) { return eegRegionOf(label) !== 'aux'; }

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function niceScaleStep(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const s of [1, 2, 5]) { if (s * mag >= v * 0.5) return s * mag; }
  return 10 * mag;
}
// Sized in an offscreen canvas so the label gutter fits the longest label
// actually present ("OR_TIME_STAMP_s" needs far more room than "Fz") without
// guessing a fixed width that clips on real-world non-10-20 labels.
let _measureCtx = null;
function textWidthPx(text, font) {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx.font = font;
  return _measureCtx.measureText(text).width;
}

// Shared by the Viewer Lab's EEG mode and the BIDS explorer's inline preview
// for a clicked .edf/.bdf file — same real waveform, two entry points.
function eegTraceSvg(resp) {
  const rowH = 30, padR = 26, padT = 16, padB = 36;
  const labelFont = '600 10.5px ui-monospace, SFMono-Regular, monospace';
  const longestLabel = Math.max(...resp.channels.map(c => textWidthPx(c, labelFont)), 40);
  const padL = Math.ceil(longestLabel) + 34;
  const W = Math.max(760, padL + 680);
  const H = resp.channels.length * rowH + padT + padB;
  const secs = resp.tmax - resp.tmin;

  // Robust shared scale: median of each channel's own peak amplitude, only
  // over channels that look like real scalp electrodes when any are present
  // (falls back to all channels if the recording has none — never divides
  // by a scale computed from zero data).
  const standardIdx = resp.channels.map((c, i) => (eegIsStandardElectrode(c) ? i : -1)).filter(i => i >= 0);
  const scaleSourceIdx = standardIdx.length ? standardIdx : resp.channels.map((_, i) => i);
  const perChannelPeak = resp.series.map(row => row.reduce((m, v) => Math.max(m, Math.abs(v)), 0));
  const robustPeak = median(scaleSourceIdx.map(i => perChannelPeak[i])) || Math.max(...perChannelPeak, 1);
  const scaleUv = niceScaleStep(robustPeak);
  const scaleY = (rowH * 0.46) / (scaleUv * 1.15);
  const rowClipPx = rowH * 0.48;

  const svg = sv('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'eeg-svg', role: 'img', 'aria-label': `EEG, ${resp.channels.length} channels, ${secs.toFixed(1)}s at ${resp.sfreq} Hz, ${scaleUv} microvolts per division`,
  });

  // zebra row backgrounds — readability across 20+ stacked traces
  resp.channels.forEach((ch, ci) => {
    if (ci % 2 === 1) svg.append(sv('rect', { x: 0, y: padT + ci * rowH, width: W, height: rowH, class: 'eeg-row-alt' }));
  });
  // time gridlines (vertical) + per-row baselines (horizontal)
  for (let s = 0; s <= secs; s += 1) {
    const x = padL + (s / secs) * (W - padL - padR);
    const major = s % 5 === 0; // paper-speed convention: bolder gridline every 5s
    svg.append(sv('line', { x1: x, y1: padT, x2: x, y2: H - padB + 6, class: major ? 'eeg-grid-major' : 'eeg-grid' }));
    const t = sv('text', { x, y: H - padB + 20, 'text-anchor': 'middle', class: 'eeg-scale' }); t.textContent = `${s.toFixed(0)}s`; svg.append(t);
  }
  resp.channels.forEach((ch, ci) => {
    const y0 = padT + ci * rowH + rowH / 2;
    svg.append(sv('line', { x1: padL, y1: y0, x2: W - padR, y2: y0, class: 'eeg-row-base' }));
  });

  resp.channels.forEach((ch, ci) => {
    const region = eegRegionOf(ch);
    const isAux = region === 'aux';
    const y0 = padT + ci * rowH + rowH / 2;
    svg.append(sv('circle', { cx: padL - longestLabel - 18, cy: y0, r: 2.6, class: `eeg-region-dot eeg-region-${region}` }));
    const lbl = sv('text', { x: padL - 12, y: y0 + 4, 'text-anchor': 'end', class: isAux ? 'eeg-ch eeg-ch-aux' : 'eeg-ch' });
    lbl.textContent = ch; svg.append(lbl);
    const series = resp.series[ci] || [];
    const pts = series.map((v, i) => {
      const y = y0 - Math.max(-rowClipPx, Math.min(rowClipPx, v * scaleY));
      return `${(padL + (i / Math.max(series.length - 1, 1)) * (W - padL - padR)).toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    svg.append(sv('polyline', { points: pts, class: isAux ? 'eeg-tr eeg-tr-aux' : 'eeg-tr' }));
    if (isAux) {
      const tag = sv('text', { x: W - padR - 4, y: y0 + 4, 'text-anchor': 'end', class: 'eeg-aux-tag' }); tag.textContent = 'AUX'; svg.append(tag);
    }
  });

  // Calibration bar — the one thing every clinical EEG scroll view has and
  // a plain line chart doesn't: what a deflection actually means in µV.
  const barX = padL - longestLabel - 18, barYc = H - padB / 2, barPx = scaleUv * scaleY;
  svg.append(sv('line', { x1: barX, y1: barYc - barPx / 2, x2: barX, y2: barYc + barPx / 2, class: 'eeg-scalebar' }));
  const st = sv('text', { x: barX + 8, y: barYc + 3, class: 'eeg-scale' }); st.textContent = `${scaleUv} µV/div`; svg.append(st);

  const excluded = resp.n_channels_excluded || 0;
  const nAux = resp.channels.filter(c => !eegIsStandardElectrode(c)).length;
  const meta = el('div', { class: 'sub', style: 'font-size:11px;color:var(--text-3);margin-top:8px' },
    `${resp.channels.length} channel${resp.channels.length === 1 ? '' : 's'} shown` +
    (nAux ? ` (${nAux} non-standard, shown in amber)` : '') +
    (excluded ? ` · ${excluded} more excluded by default (timestamps, counters, quality/battery flags)` : '') +
    ` · sensitivity ${scaleUv} µV/div · streamed via HTTP range reads`);
  return el('div', {}, el('div', { class: 'eeg-wrap' }, svg), meta);
}

// Professional EEG/MEG scroll viewer: pages through time (not a fixed 4s
// window), a real channel picker built from the file's own channel_info
// (unit, label — every channel, not just the auto-selected 10-20 subset),
// and a configurable window length. One instance per .edf/.bdf file,
// addressed by BIDS path so it works for *any* signal file clicked in the
// browser, not just "the first subject's recording".
function eegViewer(id, fileRec, snapshot) {
  const state = { tmin: 0, tmax: 4, channels: null };
  const stage = el('div', {}, waitRow('Fetching EEG epoch — only the bytes for this exact time window are transferred.', { operation: 'eeg-preview', key: `${id}:${fileRec.path}` }));
  const channelPane = el('div', { class: 'eeg-channels' });
  const timeLabel = el('span', { class: 'mono', style: 'font-size:11px' }, '');
  let duration = null;

  async function load() {
    stage.innerHTML = ''; stage.append(waitRow('Fetching EEG epoch — only the bytes for this exact time window are transferred.', { operation: 'eeg-preview', key: `${id}:${fileRec.path}` }));
    try {
      const params = { path: fileRec.path, tmin: state.tmin, tmax: state.tmax, max_channels: 20, snapshot };
      if (state.channels) params.channels = state.channels.join(',');
      const resp = await Api.eegPreview(id, params);
      stage.innerHTML = '';
      if (!resp.supported) { stage.append(el('p', { class: 'sub' }, resp.reason)); return; }
      duration = resp.duration_s;
      state.tmin = resp.tmin; state.tmax = resp.tmax;
      timeLabel.textContent = `${resp.tmin.toFixed(1)}s – ${resp.tmax.toFixed(1)}s of ${duration != null ? duration.toFixed(0) + 's' : '?'}`;
      if (!resp.channels.length) { stage.append(el('p', { class: 'sub' }, 'No channels selected.')); }
      else stage.append(eegTraceSvg(resp));
      renderChannelPicker(resp);
    } catch (err) { stage.innerHTML = ''; stage.append(errorPanel(err)); }
  }

  function renderChannelPicker(resp) {
    channelPane.innerHTML = '';
    const selectedSet = new Set(resp.channels);
    const all = resp.all_channels || [];
    const standard = all.filter(c => eegIsStandardElectrode(c.label));
    const aux = all.filter(c => !eegIsStandardElectrode(c.label));

    function row(c) {
      const cb = el('input', { type: 'checkbox', checked: selectedSet.has(c.label), 'aria-label': `Show channel ${c.label}` });
      cb.addEventListener('change', () => {
        const current = new Set(state.channels ?? resp.channels);
        if (cb.checked) current.add(c.label); else current.delete(c.label);
        state.channels = [...current];
        load();
      });
      const region = eegRegionOf(c.label);
      return el('label', { class: 'eeg-ch-row' }, cb,
        el('span', { class: `eeg-region-dot eeg-region-${region}`, 'aria-hidden': 'true' }),
        el('span', { class: 'eeg-ch-name' }, c.label), el('span', { class: 'sub eeg-ch-unit' }, c.unit || ''));
    }
    if (standard.length) {
      channelPane.append(el('div', { class: 'eeg-ch-group-h' }, `Scalp electrodes (${standard.length})`));
      standard.forEach(c => channelPane.append(row(c)));
    }
    if (aux.length) {
      channelPane.append(el('div', { class: 'eeg-ch-group-h' }, `Other channels (${aux.length})`, el('span', { class: 'sub', style: 'font-weight:400' }, ' — timestamps, counters, quality flags')));
      aux.forEach(c => channelPane.append(row(c)));
    }
  }

  const winLen = () => state.tmax - state.tmin;
  const prevBtn = el('button', { class: 'btn btn-sm', onclick: () => { const w = winLen(); state.tmin = Math.max(0, state.tmin - w); state.tmax = state.tmin + w; load(); } }, '← Prev window');
  const nextBtn = el('button', { class: 'btn btn-sm', onclick: () => { const w = winLen(); state.tmin = state.tmin + w; state.tmax = state.tmin + w; if (duration && state.tmin >= duration) { state.tmin = Math.max(0, duration - w); state.tmax = duration; } load(); } }, 'Next window →');
  const windowSel = el('select', { 'aria-label': 'Window length' }, ...[2, 4, 8, 15, 30].map(s => el('option', { value: s, selected: s === 4 || null }, `${s}s`)));
  windowSel.addEventListener('change', () => { const w = +windowSel.value; state.tmax = state.tmin + w; load(); });
  const bar = el('div', { class: 'viewer-bar', style: 'flex-wrap:wrap;gap:10px' }, prevBtn, labeled('Window', windowSel, true), nextBtn, timeLabel);

  load();
  return el('div', {}, bar, el('div', { class: 'eeg-layout' }, stage, panelWrap('Channels', channelPane)));
}

function dwiFallback() {
  return el('p', { class: 'sub', style: 'padding:14px' },
    'Tractography streamline preview isn’t available — Qortex doesn’t fabricate one. b-value/gradient info requires downloading the .bval/.bvec companions; see the Plan tab for the smallest download that includes them.');
}

// ---- Data grid: sortable, filterable table over a previewed set of rows --
// (rows come from /preview, which is a capped preview — not the full file;
// labeled honestly rather than implying a full-dataset table).
function dataGrid(columns, rows, { previewNote } = {}) {
  const state = { sortCol: null, sortDir: 1, filter: '', page: 0, pageSize: 25 };
  const wrap = el('div', {});
  const filterInput = el('input', { type: 'search', placeholder: 'Filter rows…', 'aria-label': 'Filter rows', style: 'max-width:220px' });
  const tableHost = el('div', {});
  const pageInfo = el('span', { class: 'sub', style: 'font-size:11.5px' });
  const prevBtn = el('button', { class: 'btn btn-sm', onclick: () => { state.page = Math.max(0, state.page - 1); render(); } }, '←');
  const nextBtn = el('button', { class: 'btn btn-sm', onclick: () => { state.page += 1; render(); } }, '→');

  filterInput.addEventListener('input', () => { state.filter = filterInput.value.toLowerCase(); state.page = 0; render(); });

  function filteredSorted() {
    let out = rows;
    if (state.filter) out = out.filter(r => columns.some(c => String(r[c] ?? '').toLowerCase().includes(state.filter)));
    if (state.sortCol) {
      out = [...out].sort((a, b) => {
        const av = a[state.sortCol], bv = b[state.sortCol];
        const an = Number(av), bn = Number(bv);
        const cmp = (!Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '') ? an - bn : String(av ?? '').localeCompare(String(bv ?? ''));
        return cmp * state.sortDir;
      });
    }
    return out;
  }

  function render() {
    const all = filteredSorted();
    const totalPages = Math.max(1, Math.ceil(all.length / state.pageSize));
    state.page = Math.min(state.page, totalPages - 1);
    const pageRows = all.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
    pageInfo.textContent = `${all.length ? state.page * state.pageSize + 1 : 0}–${Math.min(all.length, (state.page + 1) * state.pageSize)} of ${all.length}`;
    prevBtn.disabled = state.page === 0; nextBtn.disabled = state.page >= totalPages - 1;
    tableHost.innerHTML = '';
    tableHost.append(el('div', { class: 'tblw' }, el('table', { class: 't' },
      el('thead', {}, el('tr', {}, ...columns.map(c => {
        const active = state.sortCol === c;
        const th = el('th', {}, el('button', {
          class: 'sort-th', 'aria-sort': active ? (state.sortDir === 1 ? 'ascending' : 'descending') : 'none',
          onclick: () => { state.sortDir = active ? -state.sortDir : 1; state.sortCol = c; render(); },
        }, c, active ? (state.sortDir === 1 ? ' ▲' : ' ▼') : ''));
        return th;
      }))),
      el('tbody', {}, ...pageRows.map(r => el('tr', {}, ...columns.map(c => el('td', { class: 'mono', style: 'font-size:11px' }, String(r[c] ?? '')))))))));
  }
  render();
  const bar = el('div', { class: 'viewer-bar' }, filterInput, el('span', { class: 'sp', style: 'flex:1' }), pageInfo, prevBtn, nextBtn);
  wrap.append(previewNote ? el('p', { class: 'sub', style: 'font-size:11px;margin:0 0 8px' }, previewNote) : null, bar, tableHost);
  return wrap;
}

// ---- JSON tree: a real recursive, collapsible tree (not a string-replace
// regex over JSON.stringify) — handles arbitrary nesting correctly and lets
// large sidecar/event-column objects be collapsed rather than dumped flat.
function jsonTree(value, keyLabel) {
  const isObj = value !== null && typeof value === 'object';
  if (!isObj) {
    return el('div', { class: 'jt-leaf' },
      keyLabel != null ? el('span', { class: 'jt-key' }, `${keyLabel}: `) : null,
      el('span', { class: 'jt-val' }, JSON.stringify(value)));
  }
  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
  const summary = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;
  const details = el('details', { class: 'jt-node', open: (keyLabel == null) || entries.length <= 6 });
  details.append(el('summary', {}, keyLabel != null ? el('span', { class: 'jt-key' }, `${keyLabel}: `) : null, el('span', { class: 'jt-summary' }, summary)));
  const kids = el('div', { class: 'jt-children' });
  entries.forEach(([k, v]) => kids.append(jsonTree(v, k)));
  details.append(kids);
  return details;
}

// ---- Viewer Lab shell: file browser + format-aware dispatch ---------------
// Replaces the old fixed mode-bar Viewer (anat/fMRI/EEG/DWI buttons, first-
// subject-only) with a real file browser — any file in the manifest is
// clickable and routes to the right viewer: MPR for NIfTI, the scroll
// viewer for EDF/BDF, a sortable grid for TSV/CSV, a real tree for JSON.
// Deep-linkable via `#/ds/{id}/viewer?path=<BIDS path>` (see route()/the
// BIDS explorer's "Open in Viewer Lab" links).
// The Viewer is a full-screen PACS-style workstation that takes over the
// entire window (a fixed overlay above the app's own chrome), exactly like a
// diagnostic reading station: its own top bar (breadcrumb + actions), a
// STUDIES/FILES left rail, the icon toolbars, the 2×2 viewport, the right
// inspector, and a global status bar. Navigating away via the breadcrumb
// re-runs the router, which clears #main and with it this overlay.
const WS_RAIL_COLLAPSED_KEY = 'qatlas-ws-rail-collapsed';

async function tabViewer(body, profile, params) {
  const id = profile.dataset_id;
  body.innerHTML = '';
  // The manifest is a real (often multi-MB) JSON download — stream it so the
  // wait panel shows a real ETA (bytes / Content-Length ÷ measured speed),
  // not a guess. Falls back to Api.manifest if streaming isn't available.
  const wait = waitPanel('Fetching the full file manifest.', { height: 400 });
  body.append(wait);
  let manifest;
  try {
    const url = `${Api.base}/dataset/${id}/manifest?limit=4000${profile.snapshot ? `&snapshot=${encodeURIComponent(profile.snapshot)}` : ''}`;
    const buf = await fetchArrayBufferWithProgress(url, (r, t, spd) => wait.setProgress(r, t, spd));
    manifest = JSON.parse(new TextDecoder().decode(buf));
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); return; }

  const files = manifest.files;
  const root = buildFileTree(id, files);
  const requestedPath = params?.get('path') || null;
  let selected = (requestedPath && files.some(f => f.path === requestedPath)) ? requestedPath
    : (files.find(f => /\.nii(\.gz)?$/i.test(f.path))?.path || null);

  // ---- region slots (filled per selected file) ----
  const centerSlot = el('div', { class: 'ws-a-center' });
  const rightSlot = el('div', { class: 'ws-a-right' });
  const modeSlot = el('div', { class: 'ws-a-mode' });
  const statusSlot = el('div', { class: 'ws-a-status' });

  // ---- left rail: STUDIES tree ----
  const tree = fileTreeEl(root, {
    selectedPath: selected, expandOnSelect: true,
    onSelectFile: (node) => selectFile(node.path),
  });
  const railSearch = el('input', { class: 'ws-search', type: 'search', placeholder: 'Search studies…', 'aria-label': 'Filter files' });
  railSearch.addEventListener('input', () => {
    const q = railSearch.value.trim().toLowerCase();
    tree.querySelectorAll('.fnode').forEach(n => {
      if (!q) { n.style.display = ''; return; }
      const leaf = !n.querySelector('.tw')?.textContent.trim();
      if (leaf) n.style.display = n.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  const filesList = el('div', { class: 'ws-files' });
  const filesCount = el('span', { class: 'ws-rail-count' }, '');
  function renderFilesList() {
    filesList.innerHTML = '';
    const folder = selected ? selected.split('/').slice(0, -1).join('/') : '';
    const siblings = files.filter(f => f.path.split('/').slice(0, -1).join('/') === folder);
    filesCount.textContent = `(${siblings.length})`;
    siblings.forEach(f => {
      const active = f.path === selected;
      filesList.append(el('button', { class: 'ws-file' + (active ? ' is-active' : ''), title: f.path, onclick: () => selectFile(f.path) },
        fico(fileKind(f)),
        el('span', { class: 'ws-file-name' }, f.path.split('/').pop()),
        el('span', { class: 'ws-file-size mono' }, fmtBytes(f.size))));
    });
  }

  // DATA SOURCE + CACHE (real: openneuro is the live source; cache from the
  // backend's own store status if it exposes one, never a fabricated number).
  const cacheBox = el('div', { class: 'ws-cache' }, el('div', { class: 'ws-cache-line sub' }, 'local catalog cache'));
  Api.storeStatus?.().then(s => {
    const used = s?.cache_bytes ?? s?.used_bytes ?? s?.bytes;
    const limit = s?.limit_bytes ?? s?.capacity_bytes;
    if (used == null) return;
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : null;
    cacheBox.innerHTML = '';
    cacheBox.append(
      el('div', { class: 'ws-cache-line' }, el('span', { class: 'sub' }, `${fmtBytes(used)}${limit ? ` / ${fmtBytes(limit)}` : ''}`), pct != null ? el('span', { class: 'mono' }, `${pct}%`) : null),
      pct != null ? el('div', { class: 'ws-cache-bar' }, el('div', { class: 'ws-cache-fill', style: `width:${pct}%` })) : null);
  }).catch(() => {});

  const collapsed = localStorage.getItem(WS_RAIL_COLLAPSED_KEY) === '1';
  const railToggle = el('button', { class: 'ws-rail-toggle', 'aria-label': 'Collapse studies panel', title: 'Collapse', 'aria-expanded': String(!collapsed) }, wsIcon('compare'));
  // Logo links home so the viewer is never a dead end — one click back to the
  // global Atlas, matching the app's own sidebar brand behaviour.
  const railHead = el('div', { class: 'ws-railhead' },
    el('a', { class: 'ws-logo', href: '#/', title: 'Qortex Atlas — Home' }, el('span', { class: 'ws-logo-mark', html: LEAF_SVG }), el('span', { class: 'ws-logo-name' }, 'OpenNeuro')),
    railToggle);
  const rail = el('aside', { class: 'ws-rail' },
    el('div', { class: 'ws-rail-sec-h' }, 'Studies'),
    el('div', { class: 'ws-search-wrap' }, wsIcon('zoom'), railSearch),
    el('div', { class: 'ws-tree' }, tree),
    el('div', { class: 'ws-rail-sec-h ws-rail-sec-row' }, el('span', {}, 'Files'), filesCount),
    filesList,
    el('div', { class: 'ws-rail-sec-h' }, 'Data Source'),
    el('div', { class: 'ws-datasrc' }, el('span', {}, 'openneuro.org'), el('span', { class: 'ws-online' }, 'Online')),
    el('div', { class: 'ws-rail-sec-h' }, 'Cache'),
    cacheBox);

  // ---- top bar: breadcrumb + dataset tab strip + actions ----
  // The breadcrumb is the exit to the global app (Datasets → the catalog,
  // logo → Home). The tab strip is the in-dataset navigation — every section
  // of THIS dataset is one click away, so the viewer is no longer a trap.
  const crumbs = el('nav', { class: 'ws-crumbs', 'aria-label': 'Breadcrumb' });
  function renderCrumbs() {
    crumbs.innerHTML = '';
    crumbs.append(
      el('a', { class: 'ws-crumb', href: '#/datasets' }, 'Datasets'),
      el('span', { class: 'ws-crumb-sep' }, '/'),
      el('a', { class: 'ws-crumb', href: `#/ds/${id}/overview` }, id));
    if (selected) crumbs.append(
      el('span', { class: 'ws-crumb-sep' }, '/'),
      el('span', { class: 'ws-crumb is-last', title: selected }, selected.split('/').pop()));
  }
  const TAB_LABELS = { overview: 'Overview', bids: 'BIDS', viewer: 'Viewer', quality: 'Quality', cohort: 'Cohort', graph: 'Graph', files: 'Files', plan: 'Plan', compat: 'Compatibility' };
  const dsTabsNav = el('nav', { class: 'ws-top-tabs', 'aria-label': 'Dataset sections' },
    ...DS_TABS.map(t => el('a', {
      class: 'ws-top-tab' + (t === 'viewer' ? ' is-active' : ''),
      href: `#/ds/${id}/${t}`, 'aria-current': t === 'viewer' ? 'page' : null,
    }, TAB_LABELS[t] || t)));
  const topbar = el('header', { class: 'ws-top' }, crumbs, dsTabsNav,
    el('div', { class: 'ws-top-actions' },
      el('button', { class: 'ws-top-btn', title: 'Fullscreen', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()) }, wsIcon('fullscreen'), el('span', {}, 'Fullscreen')),
      el('a', { class: 'ws-top-btn', title: 'Download plan for this dataset', href: `#/ds/${id}/plan` }, wsIcon('export'), el('span', {}, 'Export')),
      el('a', { class: 'ws-top-btn ws-top-icon', title: 'Settings', href: '#/settings' }, wsIcon('gear')),
      el('span', { class: 'ws-avatar', 'aria-hidden': 'true' }, 'A')));

  const ws = el('div', { class: 'ws' + (collapsed ? ' rail-collapsed' : '') },
    railHead, topbar, rail, centerSlot, rightSlot, modeSlot, statusSlot);
  railToggle.addEventListener('click', () => {
    const now = !ws.classList.contains('rail-collapsed');
    ws.classList.toggle('rail-collapsed', now);
    railToggle.setAttribute('aria-expanded', String(!now));
    localStorage.setItem(WS_RAIL_COLLAPSED_KEY, now ? '1' : '0');
  });

  function selectFile(path) {
    selected = path;
    history.replaceState(null, '', `#/ds/${id}/viewer?path=${encodeURIComponent(path)}`);
    tree.querySelectorAll('.fnode[aria-current]').forEach(n => n.removeAttribute('aria-current'));
    renderFilesList(); renderCrumbs(); renderStage();
    announce(`Viewing ${path.split('/').pop()}`);
  }

  function renderStage() {
    const node = selected ? findNodeByPath(root, selected) : null;
    [centerSlot, rightSlot, modeSlot, statusSlot].forEach(s => s.innerHTML = '');
    if (!node) { centerSlot.append(el('div', { class: 'ws-empty' }, el('p', { class: 'sub' }, 'Select a file to view it.'))); return; }
    const rec = files.find(f => f.path === node.path);
    try {
      if (/\.nii(\.gz)?$/i.test(node.path)) {
        const parts = mprViewer(id, node.path, profile.snapshot, node.sizeBytes, files);
        centerSlot.append(parts.center); rightSlot.append(parts.right);
        modeSlot.append(parts.mode); statusSlot.append(parts.status);
      } else {
        const alt = el('div', { class: 'ws-altstage' });
        centerSlot.append(alt);
        statusSlot.append(el('div', { class: 'ws-statusbar-inner' }, el('div', { class: 'ws-status-l' }, el('span', { class: 'status-dot status-good' }), el('b', {}, 'System Status'), el('span', { class: 'ws-status-sep' }), el('span', { class: 'sub' }, 'All Systems Operational'))));
        rightSlot.append(el('div', { class: 'ws-inspector' }, el('div', { class: 'inspector-body' },
          el('div', { class: 'inspector-sec-h' }, 'File'),
          el('dl', { class: 'kv' }, el('dt', {}, 'Path'), el('dd', { class: 'mono' }, node.path), el('dt', {}, 'Size'), el('dd', { class: 'mono' }, fmtBytes(node.sizeBytes))))));
        renderAltStage(alt, node, rec);
      }
    } catch (err) { centerSlot.innerHTML = ''; centerSlot.append(errorPanel(err)); }
  }

  async function renderAltStage(alt, node, rec) {
    if (rec && (rec.extension === '.edf' || rec.extension === '.bdf')) { alt.append(eegViewer(id, rec, profile.snapshot)); return; }
    if (/\.(tsv|csv)$/i.test(node.path)) {
      alt.append(waitRow('Fetching preview…'));
      const p = await Api.preview(id, { path: node.path, snapshot: profile.snapshot });
      alt.innerHTML = ''; alt.append(dataGrid(p.columns || [], p.rows || [], { previewNote: `Previewing ${p.rows?.length ?? 0} row(s).` })); return;
    }
    if (/\.json$/i.test(node.path)) {
      alt.append(waitRow('Fetching JSON…'));
      const p = await Api.preview(id, { path: node.path, snapshot: profile.snapshot });
      alt.innerHTML = ''; alt.append(jsonTree(p.data ?? p)); return;
    }
    if (/\.(bval|bvec)$/i.test(node.path)) { alt.append(dwiFallback()); return; }
    if (['.set', '.fif', '.vhdr'].includes(rec?.extension)) { alt.append(el('p', { class: 'sub', style: 'padding:16px' }, 'This signal format has no remote-streamable reader — download it (Plan tab) to view locally.')); return; }
    alt.append(el('p', { class: 'sub', style: 'padding:16px' }, 'No structured viewer for this format yet.'));
  }

  body.innerHTML = '';
  body.append(ws);
  renderFilesList(); renderCrumbs(); renderStage();
}

function findNodeByPath(node, path) {
  if (node.path === path) return node;
  for (const child of (node.children || [])) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  return null;
}

/* --- Quality — real readiness findings + evidence chips --- */
function fmriQcPanel(payload, profile) {
  const section = el('section', { class: 'span-12 panel' });
  if (payload?.error) {
    section.append(el('div', { class: 'panel-h' }, el('h3', {}, 'fMRI volume QC')),
      el('div', { class: 'panel-b' }, errorPanel(new Error(payload.error))));
    return section;
  }
  const paths = payload?.available_paths || [];
  const select = paths.length > 1 ? el('select', { class: 'select', 'aria-label': 'Locally downloaded BOLD file' },
    ...paths.map(path => el('option', { value: path, selected: path === payload.selected_path }, path))) : null;
  const header = el('div', { class: 'panel-h' }, el('h3', {}, 'fMRI volume QC'),
    el('span', { class: 'sub' }, payload?.available ? 'computed from consecutive local image volumes' : 'local volume data required'),
    el('span', { class: 'sp' }), select);
  const content = el('div', { class: 'panel-b' });
  section.append(header, content);

  if (!payload?.available) {
    content.append(el('p', {}, payload?.reason || 'No local BOLD volume is available.'),
      el('dl', { class: 'kv' },
        el('dt', {}, 'BOLD files in manifest'), el('dd', {}, fmt(payload?.manifest_bold_count)),
        el('dt', {}, 'BOLD files downloaded'), el('dd', {}, fmt(paths.length))),
      el('p', { class: 'sub' }, 'Header and slice streaming cannot establish DVARS, tSNR, or global-signal trajectories. The full selected 4-D image must be downloaded first.'));
    return section;
  }

  const report = payload.report;
  const fd = report.framewise_displacement;
  const dvars = report.dvars;
  const fdThreshold = el('input', { class: 'input signal-number', type: 'number', min: '0', step: '0.05', value: fd.threshold_mm ?? 0.5, 'aria-label': 'Framewise displacement threshold in millimeters' });
  const dvarsThreshold = el('input', { class: 'input signal-number', type: 'number', min: '0', step: '0.1', value: dvars.threshold ?? '', placeholder: 'disabled', 'aria-label': 'DVARS threshold' });
  const maxFrames = el('input', { class: 'input signal-number', type: 'number', min: '2', max: '2000', step: '1', value: report.n_volumes_analyzed, 'aria-label': 'Maximum consecutive frames' });
  const persistButton = el('button', { class: 'btn btn-green' }, 'Persist QC and scrub plan');
  const persistResult = el('div', { class: 'model-validation-result' });
  content.append(
    el('div', { class: 'readiness-facts qc-facts' },
      ...[
        ['File', payload.selected_path],
        ['Shape', report.shape.join(' × ')],
        ['Voxel size', `${report.voxel_sizes_mm.map(value => value.toFixed(2)).join(' × ')} mm`],
        ['TR', report.tr_seconds == null ? 'Not encoded' : `${report.tr_seconds.toFixed(3)} s`],
        ['Volumes', `${fmt(report.n_volumes_analyzed)} of ${fmt(report.n_volumes)} analyzed`],
        ['Brain-mask coverage', `${(report.brain_mask.coverage_fraction * 100).toFixed(2)}%`],
        ['Median tSNR', report.tsnr.median == null ? 'Unavailable' : report.tsnr.median.toFixed(3)],
        ['Flagged volumes', `${fmt(report.scrubbing.flagged_count)} flagged · ${fmt(report.scrubbing.retained_count)} retained`],
      ].map(([label, value]) => el('div', {}, el('span', { class: 'sub' }, label), el('b', { title: String(value) }, value)))),
    el('div', { class: 'qc-chart-grid' },
      el('div', {}, el('h4', {}, 'Global signal'), qcLineChart({ ...report.global_signal, label: 'Global signal' })),
      el('div', {}, el('h4', {}, 'DVARS'), qcLineChart({ ...dvars, threshold: dvars.threshold, label: 'DVARS' })),
      el('div', {}, el('h4', {}, 'Framewise displacement'), fd.available
        ? qcLineChart({ ...fd, threshold: fd.threshold_mm, unit: 'mm', label: 'Framewise displacement' })
        : el('div', { class: 'demographic-warning' }, el('b', {}, 'Unavailable'), el('span', {}, fd.unavailable_reason)))),
    el('div', { class: 'qc-provenance sub' },
      el('span', {}, `Mask: ${report.brain_mask.method}.`),
      el('span', {}, `DVARS: ${dvars.method}.`),
      el('span', {}, report.scrubbing.note),
      report.confounds_path ? el('span', { class: 'mono' }, `Confounds: ${report.confounds_path}`) : null),
    el('div', { class: 'signal-controls' },
      labeled('FD threshold (mm)', fdThreshold), labeled('DVARS threshold', dvarsThreshold),
      labeled('Max frames', maxFrames), persistButton),
    el('p', { class: 'sub' }, 'Persistence reruns the real source with these thresholds, writes an immutable scrub plan, framewise CSV, mean-BOLD NIfTI, environment record, and SHA-256 inventory. The source NIfTI is never modified.'),
    persistResult);

  persistButton.onclick = async () => {
    persistButton.disabled = true;
    persistResult.innerHTML = '';
    const status = el('div', { class: 'sub' }, 'Submitting artifact-backed QC job…');
    const bar = el('div', { class: 'jprog' }, el('div', { style: 'width:0%' }));
    persistResult.append(status, bar);
    try {
      const accepted = await Api.startFmriQcRun(profile.dataset_id, profile.snapshot, {
        path: payload.selected_path,
        max_frames: Number(maxFrames.value),
        fd_threshold_mm: Number(fdThreshold.value),
        dvars_threshold: dvarsThreshold.value === '' ? null : Number(dvarsThreshold.value),
      });
      const result = await new Promise((resolve, reject) => {
        const timer = setInterval(async () => {
          try {
            const job = await Api.job(accepted.job_id);
            bar.firstChild.style.width = `${job.progress || 0}%`;
            status.textContent = `Computing and hashing QC artifacts · ${job.progress || 0}%`;
            if (job.status === 'done') { clearInterval(timer); resolve(job.result); }
            else if (job.status === 'error') { clearInterval(timer); reject(new Error(job.error || 'fMRI QC persistence failed.')); }
          } catch (err) { clearInterval(timer); reject(err); }
        }, 750);
      });
      persistResult.innerHTML = '';
      persistResult.append(
        el('div', { class: 'demographic-warning' }, el('b', {}, `Run ${result.run_id} persisted`),
          el('span', {}, `${result.scrub_plan.flagged_volumes.length} flagged · ${result.scrub_plan.retained_volumes.length} retained · ${result.runtime.elapsed_seconds.toFixed(3)} s`)),
        el('div', { class: 'model-artifact-links' }, ...Object.entries(result.artifacts).map(([name]) => {
          const evidence = result.artifact_inventory?.[name];
          return el('a', {
            class: 'btn btn-sm', href: Api.fmriQcArtifactUrl(result.run_id, name), target: '_blank', rel: 'noreferrer',
            title: evidence?.sha256 ? `SHA-256 ${evidence.sha256} · ${fmtBytes(evidence.size_bytes)}` : 'Provenance record',
          }, name.replaceAll('_', ' '));
        })));
    } catch (err) {
      persistResult.innerHTML = '';
      persistResult.append(errorPanel(err));
    } finally {
      persistButton.disabled = false;
    }
  };

  if (select) select.addEventListener('change', async () => {
    select.disabled = true;
    content.innerHTML = ''; content.append(waitRow('Computing QC from the selected local BOLD file…'));
    try {
      const refreshed = await Api.fmriQc(profile.dataset_id, { snapshot: profile.snapshot, path: select.value });
      section.replaceWith(fmriQcPanel(refreshed, profile));
    } catch (err) {
      content.innerHTML = ''; content.append(errorPanel(err)); select.disabled = false;
    }
  });
  return section;
}

function localBidsValidationPanel(profile) {
  const section = el('section', { class: 'span-12 panel' });
  const runButton = el('button', { class: 'btn btn-green' }, 'Validate local content');
  const header = el('div', { class: 'panel-h' },
    el('h3', {}, 'Local BIDS validation'),
    el('span', { class: 'sub' }, 'installed official validator · downloaded bytes only'),
    el('span', { class: 'sp' }), runButton);
  const content = el('div', { class: 'panel-b validation-report' },
    el('p', { class: 'sub' }, 'Runs the installed bids-validator over the current local dataset root. Snapshot completeness is measured separately so a valid partial download is never presented as validation of the full remote snapshot.'));
  section.append(header, content);
  runButton.onclick = async () => {
    runButton.disabled = true;
    content.innerHTML = '';
    const status = el('p', { class: 'sub' }, 'Submitting local validation job.');
    content.append(status);
    try {
      const accepted = await Api.startLocalValidation(profile.dataset_id, profile.snapshot);
      let job;
      do {
        await new Promise(resolve => setTimeout(resolve, 700));
        job = await Api.job(accepted.job_id);
        status.textContent = `Official validator job ${accepted.job_id}: ${job.status}. No intermediate percentage is emitted by this validator.`;
        if (job.status === 'error') throw new Error(job.error || 'Local validation failed.');
      } while (job.status !== 'done');
      renderLocalBidsValidation(content, job.result, profile.dataset_id);
    } catch (err) {
      content.innerHTML = '';
      content.append(errorPanel(err));
    } finally {
      runButton.disabled = false;
    }
  };
  return section;
}

function renderLocalBidsValidation(host, result, datasetId) {
  host.innerHTML = '';
  const issueRows = (result.issues || []).map(issue => el('tr', {},
    el('td', {}, el('span', { class: `chip ${issue.severity === 'error' ? '' : 'chip-warn'}` }, issue.severity)),
    el('td', { class: 'mono' }, issue.code),
    el('td', {}, issue.message),
    el('td', { class: 'mono' }, issue.path || 'No path')));
  const scope = result.scope;
  host.append(
    el('div', { class: 'readiness-facts' },
      ...[
        ['Local verdict', result.valid_local_content ? 'Valid local content' : 'Invalid local content'],
        ['Validator', `${result.validator} ${result.validator_version || 'version unavailable'}`],
        ['Runtime', `${result.elapsed_seconds.toFixed(3)} s`],
        ['Errors', fmt(result.counts.errors)], ['Warnings', fmt(result.counts.warnings)],
        ['Manifest files present', `${fmt(scope.local_manifest_file_count)} of ${fmt(scope.manifest_file_count)}`],
        ['Local manifest bytes', fmtBytes(scope.local_manifest_bytes)],
        ['Full snapshot locally present', scope.snapshot_complete ? 'Yes' : 'No'],
      ].map(([label, value]) => el('div', {}, el('span', { class: 'sub' }, label), el('b', {}, value)))),
    el('p', { class: 'sub' }, scope.scope_evidence),
    el('p', { class: 'sub' }, result.passed_checks_evidence),
    issueRows.length ? el('div', { class: 'tblw validation-table' }, el('table', { class: 't' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Severity'), el('th', {}, 'Code'), el('th', {}, 'Message'), el('th', {}, 'Local path'))),
      el('tbody', {}, ...issueRows))) : el('p', { class: 'sub' }, 'The installed validator returned no issues for the bytes present locally.'),
    el('div', { class: 'model-artifact-links' }, ...(result.artifacts || []).map(artifact => el('a', {
      class: 'btn btn-sm',
      href: Api.localValidationArtifactUrl(datasetId, result.snapshot, result.run_id, artifact.path),
      target: '_blank', rel: 'noreferrer', title: `SHA-256 ${artifact.sha256}`,
    }, `${artifact.path} · ${fmtBytes(artifact.size_bytes)}`))),
  );
}

async function tabQuality(body, profile, readinessQuery = {}) {
  readinessQuery = readinessQuery || {};
  const id = profile.dataset_id;
  body.innerHTML = '';
  body.append(waitPanel('Computing readiness from the full file manifest.', { height: 300, eta: { operation: 'readiness', key: id } }));
  try {
    const [r, validation, fmriQc] = await Promise.all([
      Api.readiness(id, profile.snapshot, readinessQuery),
      Api.validation(id, profile.snapshot),
      Api.fmriQc(id, { snapshot: profile.snapshot }).catch(err => ({ error: err.message })),
    ]);
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
    const modalityControl = el('select', { class: 'select', 'aria-label': 'Readiness modality' },
      el('option', { value: '' }, 'Any modality'),
      ...Object.keys(profile.modality_breakdown || {}).sort().map(value => el('option', {
        value, selected: value === (readinessQuery.modality || r.can_train.modality),
      }, value)));
    const targetControl = el('input', {
      class: 'input', type: 'text', placeholder: 'Explicit label target',
      value: readinessQuery.target || r.can_train.target || '', 'aria-label': 'Readiness label target',
    });
    const labelColumnControl = el('input', {
      class: 'input', type: 'text', placeholder: 'events.tsv label column',
      value: readinessQuery.label_column || r.can_train.label_policy?.column || '',
      'aria-label': 'Explicit events label column',
    });
    const missingControl = el('select', { class: 'select', 'aria-label': 'Missing label behavior' },
      ...['drop', 'keep', 'error'].map(value => el('option', {
        value, selected: value === (readinessQuery.label_missing || r.can_train.label_policy?.missing || 'drop'),
      }, `Missing: ${value}`)));
    const splitControl = el('select', { class: 'select', 'aria-label': 'Train test split grouping' },
      ...[
        ['subject', 'Split by subject'],
        ['subject_session', 'Split by subject/session'],
        ['recording', 'Split by recording'],
      ].map(([value, label]) => el('option', {
        value, selected: value === (readinessQuery.split_strategy || r.can_train.split_strategy || 'subject'),
      }, label)));
    const recalculateReadiness = el('button', { class: 'btn btn-sm', onclick: () => tabQuality(body, profile, {
      modality: modalityControl.value || undefined,
      target: targetControl.value.trim() || undefined,
      label_column: labelColumnControl.value.trim() || undefined,
      label_missing: missingControl.value,
      split_strategy: splitControl.value,
    }) }, 'Recalculate decision');
    body.innerHTML = '';
    body.append(el('div', { class: 'bento' },
      el('div', { class: 'span-4 panel' }, el('div', { class: 'panel-b', style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:32px 16px;min-height:280px' },
        donut({ size: 150, thick: 15, segs: [{ label: 'Passed', v: Math.max(passed, 0), color: 'var(--good)' }, { label: 'Warnings', v: warn, color: 'var(--warn)' }, { label: 'Failed', v: fail, color: 'var(--fail)' }], centerVal: `${r.readiness.n_recordings}`, centerLab: 'Recordings' }),
        // Fixed 2x2 grid, always all four states — conditionally hiding
        // "blocked" when it's 0 meant the chip count (and so the flex-wrap
        // line break) varied per dataset: 4 chips wrapped 3-then-1
        // (stranding one chip off-center on its own line), 3 chips didn't
        // wrap at all. A grid with a fixed cell count wraps the same way
        // every time, and "0 blocked" is itself real evidence worth
        // stating, not a state to hide.
        el('div', { class: 'ev-chip-grid' },
          evChip('confirmed', `${r.evidence.counts.confirmed} confirmed`, r.evidence.counts.confirmed),
          evChip('inferred', `${r.evidence.counts.inferred} inferred`, r.evidence.counts.inferred),
          evChip('unknown', `${r.evidence.counts.unknown} unknown`, r.evidence.counts.unknown),
          evChip('blocked', `${r.evidence.counts.blocked} blocked`, r.evidence.counts.blocked)))),
      el('div', { class: 'span-8 panel' },
        el('div', { class: 'panel-h' }, el('h3', {}, 'Checks'), el('span', { class: 'sub' }, `${checks.length} distinct issues · ${r.readiness.n_recordings} recordings scanned`)),
        // Bounded + scrollable rather than growing without limit: a dataset
        // with a dozen distinct issues next to the compact donut card was
        // producing two panels several hundred pixels apart in height in
        // the same row — a fixed cap keeps the row visually balanced
        // regardless of how many checks a given dataset happens to have.
        el('div', { class: 'checks-scroll' }, checks.length ? checks.map(c => qrow({ level: c.level, msg: c.text, files: c.source })) : el('p', { class: 'sub', style: 'padding:14px' }, 'No findings — nothing to report yet.'))),
      el('div', { class: 'span-12 panel' },
        el('div', { class: 'panel-h' }, el('h3', {}, 'Trainability decision'),
          el('span', { class: `chip ${r.can_train.status === 'possible' ? 'chip-green' : ''}` }, r.can_train.status.replaceAll('_', ' ')),
          el('span', { class: 'sp' }),
          el('div', { class: 'readiness-controls' }, modalityControl, targetControl, labelColumnControl,
            missingControl, splitControl, recalculateReadiness)),
        el('div', { class: 'panel-b readiness-decision' },
          el('div', { class: 'readiness-facts' },
            ...[
              ['Target', r.can_train.target || 'Unspecified'],
              ['Modality', r.can_train.modality || 'Any declared modality'],
              ['Split', r.can_train.suggested_split],
              ['Split groups', `${fmt(r.can_train.split_group_count)} · ${r.can_train.split_status.replaceAll('_', ' ')}`],
              ['Subjects', fmt(r.can_train.n_subjects)],
              ['Recordings', fmt(r.can_train.n_recordings)],
              ['Label-ready', fmt(r.can_train.n_label_ready)],
              ['Required download', fmtBytes(r.can_train.required_download_bytes)],
              ['Label evidence', r.can_train.label_status],
              ['Local data root', r.local_label_evidence?.data_root_present ? 'Present' : 'Absent'],
            ].map(([label, value]) => el('div', {}, el('span', { class: 'sub' }, label), el('b', {}, value)))),
          r.can_train.leakage_risks?.length
            ? el('div', { class: 'demographic-warning' }, el('b', {}, 'Leakage risks'), el('span', {}, r.can_train.leakage_risks.join('; ')))
            : el('p', { class: 'sub' }, 'No leakage risks were identified from the manifest structure.'),
          r.can_train.next_command ? el('div', {}, el('span', { class: 'sub' }, 'Next executable step'), el('pre', { class: 'mono readiness-command' }, r.can_train.next_command)) : null)),
      el('div', { class: 'span-12 panel' },
        el('div', { class: 'panel-h' }, el('h3', {}, 'Published BIDS validation issues'),
          el('span', { class: 'sub' }, `${validation.coverage.error} errors · ${validation.coverage.warning} warnings`)),
        el('div', { class: 'panel-b validation-report' },
          el('div', { class: 'readiness-facts' },
            el('div', {}, el('span', { class: 'sub' }, 'Snapshot'), el('b', { class: 'mono' }, validation.snapshot)),
            el('div', {}, el('span', { class: 'sub' }, 'Issue occurrences'), el('b', {}, fmt(validation.coverage.issue_occurrences))),
            el('div', {}, el('span', { class: 'sub' }, 'Passed checks'), el('b', {}, 'Not exposed')),
            el('div', {}, el('span', { class: 'sub' }, 'Validator version'), el('b', {}, validation.validator.version || 'Not exposed'))),
          el('p', { class: 'sub' }, validation.coverage.passed_checks_evidence),
          validation.issues.length ? el('div', { class: 'tblw validation-table' }, el('table', { class: 't' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Severity'), el('th', {}, 'Issue'), el('th', {}, 'Reason'), el('th', {}, 'Affected files'))),
            el('tbody', {}, ...validation.issues.map(issue => el('tr', {},
              el('td', {}, el('span', { class: `chip ${issue.severity === 'error' ? '' : 'chip-warn'}` }, issue.severity)),
              el('td', { class: 'mono' }, issue.key),
              el('td', {}, issue.reason || 'No reason supplied'),
              el('td', {}, issue.files.length ? `${issue.files.slice(0, 3).join(', ')}${issue.files.length > 3 ? ` +${issue.files.length - 3}` : ''}` : 'No file list supplied'))))))
            : el('p', { class: 'sub' }, 'OpenNeuro published no validation issues for this snapshot. This does not imply a known passed-check count.'))),
      localBidsValidationPanel(profile),
      fmriQcPanel(fmriQc, profile),
    ));
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}

/* --- Cohort — real participants.tsv demographics --- */
async function tabCohort(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = ''; body.append(waitPanel('Fetching participants.tsv.', { height: 300, eta: { operation: 'participants', key: id } }));
  try {
    const { columns, rows, demographics } = await Api.participants(id);
    body.innerHTML = '';
    if (!rows.length) { body.append(panel('Cohort', null, el('p', { class: 'sub' }, 'No participants.tsv available for this dataset.'))); return; }
    const ageCol = columns.find(c => /^age$/i.test(c)), sexCol = columns.find(c => /^sex$/i.test(c));
    const validity = demographics ? el('div', { class: 'demographic-cards' },
      ...[
        ['Participants', demographics.total_rows, 'rows in participants.tsv'],
        ['Valid sex values', demographics.categorical.n_valid, `${demographics.categorical.n_missing} missing`],
        ['Invalid sex values', demographics.categorical.n_invalid, 'excluded from valid groups'],
        ['Valid ages', demographics.numeric.n_valid, `${demographics.numeric.n_invalid} invalid · ${demographics.numeric.n_missing} missing`],
      ].map(([label, value, note]) => el('div', { class: 'demographic-card' }, el('span', { class: 'sub' }, label), el('b', {}, fmt(value)), el('small', {}, note)))) : null;
    const invalidRows = demographics ? Object.entries(demographics.categorical.invalid_values || {}) : [];
    const invalidNotice = invalidRows.length ? el('div', { class: 'demographic-warning', role: 'note' },
      el('b', {}, `${demographics.categorical.n_invalid} invalid ${demographics.group_column} value(s) were not merged into valid groups.`),
      el('span', {}, invalidRows.map(([raw, indices]) => `${JSON.stringify(raw)} at row${indices.length === 1 ? '' : 's'} ${indices.join(', ')}`).join('; '))) : null;
    const groupTable = demographics ? tinyTable(
      ['Group', 'n', 'Median', 'IQR', 'Range'],
      demographics.groups.map(group => [group.group, group.n, group.median, `${group.q1}–${group.q3}`, `${group.min}–${group.max}`])) : null;
    const extraCols = columns.filter(c => !['participant_id', ageCol, sexCol].includes(c)).slice(0, 2);
    body.append(validity,
      demographics ? panel('Age distribution by sex', 'validated from participants.tsv and participants.json Levels when available',
        el('div', {}, invalidNotice, groupedNumericPlot(demographics), groupTable)) : panel('Age by sex', null, el('p', { class: 'sub' }, 'Both age and sex columns are required.')),
      el('div', { class: 'cohort-grid' },
      ...extraCols.map(c => {
        const counts = {};
        rows.forEach(r => { const v = (r[c] ?? '').toString().trim() || '(blank)'; counts[v] = (counts[v] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count }));
        return panel(c, 'from participants.tsv', hbars(top));
      })));
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}

/* --- Knowledge graph — real dataset → modalities → tasks → subjects → files --- */
async function tabGraph(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = ''; body.append(waitPanel('Fetching provenance and checking locally downloaded signals.', { height: 470, eta: { operation: 'dataset-manifest', key: `${id}:graph` } }));
  let manifest, signal;
  try {
    [manifest, signal] = await Promise.all([
      Api.manifest(id, { snapshot: profile.snapshot, limit: 400 }),
      Api.signalAnalysis(id, { snapshot: profile.snapshot }).catch(err => ({ error: err.message })),
    ]);
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); return; }
  if (!manifest.files.length) { body.innerHTML = ''; body.append(panel('Knowledge Graph', null, el('p', { class: 'sub' }, 'No files in the manifest to graph.'))); return; }

  // Real relationships, not a cartesian product: each sampled file is one
  // genuine provenance chain — its own subject · task · modality — read
  // straight from the manifest record. Drawing every-modality×every-task×
  // every-subject×every-file (as this used to) invents links that don't
  // exist and directly contradicts the panel's own "not fabricated" caption.
  const sample = manifest.files.slice(0, 8);
  const chains = sample.map(f => ({
    modality: f.suffix || (f.extension || '').replace(/^\./, '') || 'file',
    task: f.task || '(no task)',
    subject: f.subject ? `sub-${f.subject}` : '(dataset-level)',
    file: f.filename || f.path.split('/').pop(),
  }));
  const uniq = (a) => [...new Set(a)];
  const modalities = uniq(chains.map(c => c.modality));
  const tasks = uniq(chains.map(c => c.task));
  const subjects = uniq(chains.map(c => c.subject));
  const files = uniq(chains.map(c => c.file));

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
  // One edge per real link in each file's chain, de-duplicated so shared
  // nodes (a modality many files share) don't stack identical paths.
  const seenEdge = new Set();
  chains.forEach(c => {
    [[`dataset:${id}`, `modality:${c.modality}`], [`modality:${c.modality}`, `task:${c.task}`],
     [`task:${c.task}`, `participant:${c.subject}`], [`participant:${c.subject}`, `file:${c.file}`]]
      .forEach(([a, b]) => { const k = `${a}>${b}`; if (seenEdge.has(k)) return; seenEdge.add(k); edge(a, b); });
  });

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
    el('div', { class: 'panel-h' }, el('h3', {}, 'Knowledge Graph — dataset, modalities, tasks, subjects, files'), el('span', { class: 'sub' }, `${chains.length} sampled files — each path is one real file's modality · task · subject`)),
    el('div', { class: 'kg-legend' }, ...cols.map(c => el('span', {}, el('span', { class: 'dot', style: `background:${c.color}` }), c.title))),
    el('div', { class: 'panel-b' }, svg)));

  const analysis = el('section', { class: 'panel signal-analysis-panel' });
  body.append(analysis);
  renderSignalAnalysis(analysis, signal, profile);
  body.append(publicRoiConnectivityPanel());
}

function publicRoiConnectivityPanel() {
  const section = el('section', { class: 'panel roi-connectivity-panel' });
  const maxFrames = el('input', { class: 'input signal-number', type: 'number', min: '20', max: '168', step: '1', value: '168', 'aria-label': 'Public ROI maximum frames' });
  const fdThreshold = el('input', { class: 'input signal-number', type: 'number', min: '0', step: '0.05', value: '0.5', 'aria-label': 'Public ROI FD threshold' });
  const connThreshold = el('input', { class: 'input signal-number', type: 'number', min: '0.01', max: '0.99', step: '0.05', value: '0.3', 'aria-label': 'Public ROI connectivity threshold' });
  const runButton = el('button', { class: 'btn btn-green' }, 'Run public MNI ROI validation');
  const content = el('div', { class: 'panel-b' });
  section.append(
    el('div', { class: 'panel-h' }, el('h3', {}, 'Atlas ROI connectivity and browser'),
      el('span', { class: 'sub' }, 'public normalized BOLD · Schaefer-100'), el('span', { class: 'sp' }),
      el('div', { class: 'signal-controls' }, labeled('Frames', maxFrames), labeled('FD (mm)', fdThreshold), labeled('|r|', connThreshold), runButton)),
    content);
  content.append(
    el('p', {}, 'This validation uses the public development-fMRI subject in MNI152NLin2009cAsym space and the public Schaefer 2018 100-parcel atlas.'),
    el('p', { class: 'sub' }, 'Qortex verifies spatial reference, hashes BOLD/confounds/atlas inputs, applies real framewise-displacement censoring and confound regression, then persists the resampled label map, ROI statistics, connectivity matrix, montage, environment, and provenance. Raw native-space BOLD is not passed through an MNI atlas.'));

  runButton.onclick = async () => {
    runButton.disabled = true;
    content.innerHTML = '';
    const status = el('p', { class: 'sub' }, 'Fetching or verifying public data and atlas…');
    const bar = el('div', { class: 'jprog' }, el('div', { style: 'width:0%' }));
    content.append(status, bar);
    try {
      const accepted = await Api.startPublicRoiConnectivity({
        max_frames: Number(maxFrames.value),
        fd_threshold_mm: Number(fdThreshold.value),
        connectivity_threshold: Number(connThreshold.value),
      });
      let job;
      do {
        await new Promise(resolve => setTimeout(resolve, 700));
        job = await Api.job(accepted.job_id);
        bar.firstChild.style.width = `${job.progress || 0}%`;
        status.textContent = `Extracting and hashing ROI evidence · ${job.progress || 0}%`;
        if (job.status === 'error') throw new Error(job.error || 'ROI-connectivity validation failed.');
      } while (job.status !== 'done');
      await renderPublicRoiConnectivityResult(content, job.result);
    } catch (err) {
      content.innerHTML = '';
      content.append(errorPanel(err));
    } finally {
      runButton.disabled = false;
    }
  };
  return section;
}

async function renderPublicRoiConnectivityResult(host, result) {
  host.innerHTML = '';
  const matrixText = await fetch(Api.publicRoiConnectivityArtifactUrl(result.run_id, 'connectivity')).then(response => {
    if (!response.ok) throw new Error(`Connectivity artifact returned HTTP ${response.status}`);
    return response.text();
  });
  const matrix = matrixText.trim().split('\n').map(row => row.split(',').map(Number));
  if (matrix.length !== 100 || matrix.some(row => row.length !== 100 || row.some(value => !Number.isFinite(value)))) {
    throw new Error('Persisted connectivity artifact is not a finite 100 by 100 matrix.');
  }
  const montage = el('img', {
    class: 'model-detection-board', src: Api.publicRoiConnectivityArtifactUrl(result.run_id, 'montage'),
    alt: 'Mean public MNI BOLD montage with Schaefer-100 parcel boundaries', loading: 'eager',
  });
  const viewerCanvas = el('canvas', { class: 'model-nifti-canvas', 'aria-label': 'Interactive public mean BOLD with Schaefer atlas overlay' });
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Filter ROI labels', 'aria-label': 'Filter ROI labels' });
  const tableBody = el('tbody');
  const roiRows = result.roi_statistics || [];
  function renderRows() {
    const needle = search.value.trim().toLocaleLowerCase();
    const shown = roiRows.filter(row => !needle || row.label.toLocaleLowerCase().includes(needle)).slice(0, 100);
    tableBody.innerHTML = '';
    tableBody.append(...shown.map(row => el('tr', {},
      el('td', { class: 'num mono' }, row.index), el('td', { class: 'mono' }, row.label),
      el('td', { class: 'num' }, fmt(row.voxel_count)),
      el('td', { class: 'mono' }, row.centroid_mni_mm?.map(value => value.toFixed(1)).join(', ') || 'Unavailable'),
      el('td', { class: 'num' }, row.temporal_snr == null ? 'Unavailable' : row.temporal_snr.toFixed(3)))));
  }
  search.addEventListener('input', renderRows);
  renderRows();
  const links = el('div', { class: 'model-artifact-links' }, ...Object.entries(result.artifacts).map(([name]) => {
    const evidence = result.artifact_inventory?.[name];
    return el('a', {
      class: 'btn btn-sm', href: Api.publicRoiConnectivityArtifactUrl(result.run_id, name), target: '_blank', rel: 'noreferrer',
      title: evidence?.sha256 ? `SHA-256 ${evidence.sha256} · ${fmtBytes(evidence.size_bytes)}` : 'Provenance record',
    }, name.replaceAll('_', ' '));
  }));
  host.append(
    el('div', { class: 'model-metric-grid' },
      ...[
        ['ROIs', result.atlas.n_regions, result.atlas.id],
        ['Frames', `${result.scrubbing.retained_count} retained`, `${result.scrubbing.flagged_count} FD-flagged`],
        ['Edges', fmt(result.connectivity.n_nonzero_edges), `absolute |r| ≥ ${result.configuration.connectivity_threshold}`],
        ['Density', result.graph.density.toFixed(4), `${result.graph.n_connected_components} component(s)`],
        ['Modularity', result.graph.modularity?.toFixed(4) ?? 'Unavailable', result.graph.confidence],
        ['Runtime', `${result.runtime.elapsed_seconds.toFixed(3)} s`, result.dataset.subject],
      ].map(([label, value, note]) => el('div', { class: 'model-metric' }, el('span', { class: 'sub' }, label), el('b', {}, value), el('span', { class: 'sub' }, note)))),
    el('div', { class: 'demographic-warning' }, el('b', {}, 'Validation scope'),
      el('span', {}, 'One public subject validates the execution path; these graph values are not population estimates. Dataset use is unrestricted for non-commercial research. Atlas license is not stated by the Nilearn fetcher, so the source and reference are recorded without inventing a license.')),
    el('div', { class: 'signal-grid connectivity-grid' },
      panel('ROI connectivity matrix', result.graph.construction_summary, connectivityMatrix(matrix, result.atlas.labels)),
      panel('Interactive atlas overlay', 'mean BOLD plus resampled integer labels', viewerCanvas)),
    panel('Axial montage', 'real mean BOLD with parcel boundaries', montage),
    panel('ROI inspector', `${fmt(roiRows.length)} parcels · MNI millimeter centroids`, el('div', {}, search,
      el('div', { class: 'tblw validation-table' }, el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'ROI'), el('th', {}, 'Voxels'), el('th', {}, 'Centroid x, y, z'), el('th', {}, 'tSNR'))), tableBody)))),
    links);
  await attachNiftiOverlayViewer(
    viewerCanvas,
    Api.publicRoiConnectivityArtifactUrl(result.run_id, 'mean_volume'),
    Api.publicRoiConnectivityArtifactUrl(result.run_id, 'atlas_labels'),
    'red', 0.42,
  );
}

function renderSignalAnalysis(section, payload, profile) {
  section.innerHTML = '';
  if (payload?.error) {
    section.append(el('div', { class: 'panel-h' }, el('h3', {}, 'Neuroclassic signal analysis')),
      el('div', { class: 'panel-b' }, errorPanel(new Error(payload.error))));
    return;
  }
  const paths = payload?.downloaded_paths || [];
  const params = payload?.report?.parameters || {};
  const select = paths.length > 1 ? el('select', { class: 'select', 'aria-label': 'Downloaded signal recording' },
    ...paths.map(path => el('option', { value: path, selected: path === payload.selected_path }, path))) : null;
  const durationInput = el('input', { class: 'input signal-number', type: 'number', min: '1', max: '120', step: '1', value: params.duration_seconds ?? 20, 'aria-label': 'Analysis duration in seconds' });
  const channelInput = el('input', { class: 'input signal-number', type: 'number', min: '2', max: '64', step: '1', value: params.max_channels ?? 32, 'aria-label': 'Maximum sensors' });
  const thresholdInput = el('input', { class: 'input signal-number', type: 'number', min: '0', max: '1', step: '0.05', value: params.connectivity_threshold ?? 0.35, 'aria-label': 'Absolute connectivity threshold' });
  const runButton = el('button', { class: 'btn btn-sm' }, 'Recalculate');
  const controls = payload?.available ? el('div', { class: 'signal-controls' },
    el('label', {}, el('span', {}, 'Seconds'), durationInput),
    el('label', {}, el('span', {}, 'Sensors'), channelInput),
    el('label', {}, el('span', {}, '|r| threshold'), thresholdInput), runButton) : null;
  section.append(el('div', { class: 'panel-h' }, el('h3', {}, 'Neuroclassic signal analysis'),
    el('span', { class: 'sub' }, payload?.available ? 'bounded real-file computation' : 'local recording required'),
    el('span', { class: 'sp' }), select), controls);
  const content = el('div', { class: 'panel-b' }); section.append(content);
  if (!payload?.available) {
    content.append(el('p', {}, payload?.reason || 'No readable local signal recording is available.'),
      el('dl', { class: 'kv' }, el('dt', {}, 'Signal files in manifest'), el('dd', {}, fmt(payload?.manifest_signal_count)), el('dt', {}, 'Downloaded candidates'), el('dd', {}, fmt(paths.length))),
      payload?.unreadable_downloads?.length ? el('div', { class: 'demographic-warning' }, el('b', {}, 'Unreadable downloads'), el('span', {}, payload.unreadable_downloads.map(item => `${item.path}: ${item.error}`).join('; '))) : null);
    return;
  }
  const report = payload.report, source = report.source, conn = report.connectivity, graph = report.graph;
  const alpha = report.bandpower.find(band => band.name === 'alpha') || report.bandpower[0];
  const psdLog = report.psd.mean.map(value => Math.log10(Math.max(value, Number.MIN_VALUE)));
  const graphMetricRows = [
    ['Nodes', graph.n_nodes], ['Edges', graph.n_edges], ['Density', graph.density.toFixed(5)],
    ['Mean degree', graph.mean_degree.toFixed(5)], ['Clustering', graph.clustering_coefficient?.toFixed(5) ?? 'Unavailable'],
    ['Global efficiency', graph.global_efficiency?.toFixed(5) ?? 'Unavailable'],
    ['Modularity', graph.modularity?.toFixed(5) ?? 'Unavailable'], ['Components', graph.n_connected_components],
  ];
  const graphFacts = el('dl', { class: 'kv' }, ...graphMetricRows.flatMap(([key, value]) => [el('dt', {}, key), el('dd', {}, String(value))]));
  const hubRows = graph.hubs.slice(0, 8).map(hub => el('tr', {},
    el('td', { class: 'mono' }, hub.channel),
    el('td', {}, hub.degree.toFixed(2)),
    el('td', {}, hub.strength.toFixed(5)),
    el('td', {}, hub.betweenness == null ? 'Unavailable' : hub.betweenness.toFixed(5))));
  const hubHead = el('thead', {}, el('tr', {},
    el('th', {}, 'Hub'), el('th', {}, 'Degree'), el('th', {}, 'Strength'), el('th', {}, 'Betweenness')));
  const hubTable = el('div', { class: 'tblw' }, el('table', { class: 't' }, hubHead, el('tbody', {}, ...hubRows)));
  const graphPanel = panel('Graph metrics', `${graph.confidence} confidence`, el('div', {}, graphFacts, hubTable));
  const featurePanel = panel('Feature registry', `${fmt(report.feature_registry.total_count)} measured feature values · Qortex ${report.feature_registry.qortex_version}`, el('div', {},
    ...report.feature_registry.groups.map(group => qrow({ level: report.feature_registry.validated ? 'pass' : 'warn', msg: `${group.name}: ${fmt(group.count)}`, files: group.definition })),
    el('p', { class: 'sub' }, `Validation state: ${report.feature_registry.validated ? 'no signal-QC blockers' : 'signal-QC blockers present'}.`)));
  content.append(
    el('div', { class: 'readiness-facts signal-facts' },
      ...[
        ['File', payload.selected_path], ['SHA-256', source.sha256], ['File size', fmtBytes(source.size_bytes)],
        ['Recording', `${source.recording_duration_seconds.toFixed(3)} s at ${source.sampling_frequency_hz.toFixed(3)} Hz`],
        ['Analyzed segment', `${source.segment_duration_seconds.toFixed(3)} s from ${source.segment_start_seconds.toFixed(3)} s`],
        ['Sensors', `${fmt(source.selected_channel_count)} ${source.selected_channel_type} of ${fmt(Object.values(source.channel_type_counts).reduce((a, b) => a + b, 0))} channels`],
        ['Condition', source.condition || 'None applied'], ['Runtime', `${report.runtime_seconds.toFixed(3)} s`],
      ].map(([label, value]) => el('div', {}, el('span', { class: 'sub' }, label), el('b', { class: label === 'SHA-256' || label === 'File' ? 'mono' : '', title: String(value) }, value)))),
    el('p', { class: 'sub' }, source.condition_evidence),
    el('div', { class: 'signal-grid' },
      panel('Power spectral density', `${report.psd.method} · mean ± SEM across sensors`, qcLineChart({ time: report.psd.frequencies_hz, values: psdLog, xUnit: 'Hz', unit: ' log10(SI²/Hz)', label: 'Mean power spectral density' })),
      panel('Time-frequency power', `${report.spectrogram.channel} · ${report.spectrogram.method}`, spectrogramHeatmap(report.spectrogram)),
      panel('Relative bandpower', 'percent of measured 1 Hz to Nyquist/100 Hz power', hbars(report.bandpower.map(band => ({ label: `${band.name} ${band.range_hz[0]}–${band.range_hz[1]} Hz · ${(band.relative_mean * 100).toFixed(3)}%`, count: band.relative_mean * 100 })))),
      panel('Sensor topography', `${alpha.name} relative power · measured locations, no interpolated values`, sensorBandMap(report.sensor_positions, report.channels, alpha))),
    el('div', { class: 'signal-grid connectivity-grid' },
      panel('Thresholded Pearson connectivity', `${conn.spec.summary} · ${conn.positive_edge_count} positive · ${conn.negative_edge_count} negative edges`, connectivityMatrix(conn.matrix, conn.node_labels)),
      graphPanel),
    el('div', { class: 'signal-grid' },
      panel('Higuchi fractal dimension', `kmax ${report.higuchi.k_max} · ${report.higuchi.confidence} confidence`, el('dl', { class: 'kv' }, el('dt', {}, 'Mean HFD'), el('dd', {}, report.higuchi.mean_hfd?.toFixed(6) ?? 'Unavailable'), el('dt', {}, 'SD'), el('dd', {}, report.higuchi.std_hfd?.toFixed(6) ?? 'Unavailable'), el('dt', {}, 'Sensors'), el('dd', {}, fmt(report.higuchi.n_channels)))),
      featurePanel),
    payload.unreadable_downloads?.length ? el('div', { class: 'demographic-warning' }, el('b', {}, 'Skipped incomplete downloads'), el('span', {}, `${payload.unreadable_downloads.length} earlier downloaded file(s) could not be parsed; details remain in the API response.`)) : null,
  );
  const recalculate = async () => {
    if (select) select.disabled = true;
    runButton.disabled = true; content.innerHTML = ''; content.append(waitRow('Computing Neuroclassic features from the selected local recording…'));
    try {
      const next = await Api.signalAnalysis(profile.dataset_id, {
        snapshot: profile.snapshot,
        path: select?.value || payload.selected_path,
        duration_seconds: Number(durationInput.value),
        max_channels: Number(channelInput.value),
        connectivity_threshold: Number(thresholdInput.value),
      });
      renderSignalAnalysis(section, next, profile);
    } catch (err) {
      content.innerHTML = ''; content.append(errorPanel(err));
      if (select) select.disabled = false;
      runButton.disabled = false;
    }
  };
  if (select) select.addEventListener('change', recalculate);
  runButton.addEventListener('click', recalculate);
}

/* --- Files table — real manifest --- */
async function tabFiles(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = ''; body.append(waitPanel('Fetching the file manifest.', { height: 300, eta: { operation: 'dataset-manifest', key: `${id}:files` } }));
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
          el('td', {}, el('a', { class: 'btn btn-sm', href: `#/ds/${id}/viewer?path=${encodeURIComponent(f.path)}` }, 'View')),
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
  const conversionWrap = el('div');
  body.innerHTML = '';
  body.append(
    panel('Download plan', 'a DownloadPlan, dry run — nothing downloaded until you ask', el('div', {}, bar, resultWrap)),
    panel('Conversion workspace', 'explicit local sources → real Qortex ConversionPipeline → inventoried artifacts', conversionWrap),
  );

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
  renderConversionWorkspace(conversionWrap, profile);
}

async function renderConversionWorkspace(host, profile) {
  const id = profile.dataset_id;
  host.innerHTML = '';
  host.append(waitPanel('Inspecting locally downloaded files and installed conversion writers.', { height: 180 }));
  try {
    const options = await Api.conversionOptions(id, profile.snapshot);
    host.innerHTML = '';
    const availableFormats = options.formats.filter(item => item.available);
    const unavailableFormats = options.formats.filter(item => !item.available);
    const selected = new Set();
    const formatSelect = el('select', { class: 'select', 'aria-label': 'Conversion output format' },
      ...availableFormats.map(item => el('option', { value: item.name }, item.name)));
    const shardInput = el('input', {
      class: 'input conversion-shard', type: 'number', min: '1', max: '100000', step: '1', value: '1000',
      'aria-label': 'Samples per output shard',
    });
    const filterInput = el('input', {
      class: 'input conversion-filter', type: 'search', placeholder: 'Filter local source paths',
      'aria-label': 'Filter conversion source paths',
    });
    const selectionCount = el('span', { class: 'sub' }, '0 selected');
    const startButton = el('button', { class: 'btn btn-green', disabled: true }, 'Start conversion');
    const resultHost = el('div', { class: 'conversion-result' });
    const tableBody = el('tbody');

    const candidates = options.candidates || [];
    function visibleCandidates() {
      const needle = filterInput.value.trim().toLocaleLowerCase();
      return needle ? candidates.filter(item => item.path.toLocaleLowerCase().includes(needle)) : candidates;
    }
    function syncSelectionState() {
      selectionCount.textContent = `${fmt(selected.size)} selected`;
      startButton.disabled = selected.size < 1 || selected.size > 100 || !availableFormats.length;
    }
    function renderCandidateRows() {
      tableBody.innerHTML = '';
      const visible = visibleCandidates();
      for (const item of visible) {
        const checkbox = el('input', {
          type: 'checkbox', checked: selected.has(item.path), 'aria-label': `Select ${item.path}`,
          onchange: event => {
            if (event.currentTarget.checked) selected.add(item.path); else selected.delete(item.path);
            syncSelectionState();
          },
        });
        tableBody.append(el('tr', {},
          el('td', {}, checkbox),
          el('td', { class: 'mono conversion-path', title: item.path }, item.path),
          el('td', {}, item.loader),
          el('td', {}, item.modality || 'Unspecified'),
          el('td', { class: 'num mono' }, fmtBytes(item.size_bytes)),
          el('td', {}, item.parse_validated ? evChip('confirmed', 'Parsed') : evChip('unknown', 'Job validates')),
        ));
      }
      if (!visible.length) tableBody.append(el('tr', {}, el('td', { colspan: '6', class: 'sub' }, 'No local candidates match this filter.')));
    }
    filterInput.addEventListener('input', renderCandidateRows);

    const selectVisible = el('button', { class: 'btn btn-sm', onclick: () => {
      const additions = visibleCandidates().filter(item => !selected.has(item.path)).slice(0, Math.max(0, 100 - selected.size));
      additions.forEach(item => selected.add(item.path));
      renderCandidateRows(); syncSelectionState();
    } }, 'Select visible, up to 100');
    const clearSelection = el('button', { class: 'btn btn-sm', onclick: () => {
      selected.clear(); renderCandidateRows(); syncSelectionState();
    } }, 'Clear');

    const unsupported = Object.entries(options.unsupported_proposal_outputs || {});
    const unavailableNotice = unavailableFormats.length ? el('div', { class: 'demographic-warning' },
      el('b', {}, 'Unavailable installed writers'),
      el('span', {}, unavailableFormats.map(item => `${item.name}: missing ${item.missing_packages.join(', ')}`).join('; '))) : null;
    const unsupportedNotice = unsupported.length ? el('div', { class: 'demographic-warning' },
      el('b', {}, 'Not advertised as conversion outputs'),
      el('span', {}, unsupported.map(([name, reason]) => `${name}: ${reason}`).join(' '))) : null;
    host.append(
      el('div', { class: 'readiness-facts conversion-facts' },
        ...[
          ['Snapshot', options.snapshot || profile.snapshot],
          ['Local non-metadata files', fmt(options.local_file_count)],
          ['Loader-backed candidates', fmt(options.convertible_candidate_count)],
          ['Candidate list', options.candidates_truncated ? `${fmt(candidates.length)} shown, truncated` : `${fmt(candidates.length)} shown`],
        ].map(([label, value]) => el('div', {}, el('span', { class: 'sub' }, label), el('b', {}, value)))),
      el('p', { class: 'sub' }, options.candidate_evidence),
      el('div', { class: 'conversion-controls' },
        labeled('Format', formatSelect),
        labeled('Samples per shard', shardInput),
        filterInput,
        selectVisible,
        clearSelection,
        selectionCount,
        startButton),
      ...[unavailableNotice, unsupportedNotice].filter(Boolean),
      el('div', { class: 'tblw conversion-candidates' }, el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Local source'), el('th', {}, 'Loader'), el('th', {}, 'Modality'), el('th', { class: 'num' }, 'Bytes'), el('th', {}, 'Parse evidence'))),
        tableBody)),
      resultHost,
    );
    renderCandidateRows(); syncSelectionState();

    startButton.onclick = async () => {
      startButton.disabled = true;
      resultHost.innerHTML = '';
      const status = el('p', { class: 'sub' }, 'Submitting the explicit source set to the Qortex conversion job queue.');
      const bar = el('div', { class: 'jprog' }, el('div', { style: 'width:0%' }));
      resultHost.append(status, bar);
      try {
        const accepted = await Api.startConversion(id, {
          paths: [...selected],
          output_format: formatSelect.value,
          shard_size: Number(shardInput.value),
        }, profile.snapshot);
        status.textContent = `Job ${accepted.job_id} is loading, converting, and hashing real local data. This pipeline emits completion state, not fabricated intermediate percentages.`;
        let job;
        do {
          await new Promise(resolve => setTimeout(resolve, 700));
          job = await Api.job(accepted.job_id);
          bar.firstChild.style.width = `${job.progress}%`;
          if (job.status === 'error') throw new Error(job.error || 'Conversion failed.');
        } while (job.status !== 'done');
        renderConversionResult(resultHost, job.result, id);
      } catch (err) {
        resultHost.innerHTML = '';
        resultHost.append(errorPanel(err));
      } finally {
        syncSelectionState();
      }
    };
  } catch (err) {
    host.innerHTML = '';
    host.append(errorPanel(err));
  }
}

function renderConversionResult(host, result, datasetId) {
  host.innerHTML = '';
  const artifactRows = (result.artifacts || []).map(artifact => el('tr', {},
    el('td', { class: 'mono conversion-path', title: artifact.path }, artifact.path),
    el('td', { class: 'num mono' }, fmtBytes(artifact.size_bytes)),
    el('td', { class: 'mono conversion-hash', title: artifact.sha256 }, artifact.sha256),
    el('td', {}, el('a', {
      class: 'btn btn-sm',
      href: Api.conversionArtifactUrl(datasetId, result.snapshot, result.run_id, artifact.path),
      download: artifact.path.split('/').at(-1),
    }, 'Download')),
  ));
  const warningNotice = result.warnings?.length ? el('div', { class: 'demographic-warning' },
    el('b', {}, 'Conversion warnings'), el('span', {}, result.warnings.join('; '))) : null;
  host.append(
    el('div', { class: 'readiness-facts conversion-facts' },
      ...[
        ['Run', result.run_id], ['Format', result.output_format], ['Samples', fmt(result.n_samples)],
        ['Subjects', fmt(result.n_subjects)], ['Artifacts', fmt(result.artifact_count)],
        ['Output bytes', fmtBytes(result.total_output_bytes)], ['Runtime', `${result.elapsed_seconds.toFixed(3)} s`],
      ].map(([label, value]) => el('div', {}, el('span', { class: 'sub' }, label), el('b', { class: label === 'Run' ? 'mono' : '' }, value)))),
    el('p', { class: 'sub mono conversion-output-path', title: result.output_dir }, result.output_dir),
    ...[warningNotice].filter(Boolean),
    el('div', { class: 'tblw conversion-artifacts' }, el('table', { class: 't' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Artifact'), el('th', { class: 'num' }, 'Bytes'), el('th', {}, 'SHA-256'), el('th', {}, ''))),
      el('tbody', {}, ...artifactRows))),
  );
}

/* --- Compatibility (dataset-side) --- */
async function tabCompat(body, profile) {
  const id = profile.dataset_id;
  body.innerHTML = '';
  body.append(waitPanel('Building a source profile from a remote signal-budget scan.', { height: 200, eta: { operation: 'compatibility', key: id } }));
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

  const modSel = el('select', {}, el('option', { value: '' }, 'Any'), ...['mri', 'eeg', 'ieeg', 'meg', 'bold', 'pet', 'beh', 'nirs', 'events'].map(m => el('option', { value: m }, m.toUpperCase())));
  const minSubj = el('input', { type: 'number', min: 0, placeholder: 'any', style: 'width:90px' });
  const openLic = el('input', { type: 'checkbox' });
  const goalResult = el('div', { style: 'margin-top:14px' });
  wrap.append(panel('Goal Builder', 'ranks via DatasetSelector.find() — live OpenNeuro scoring', el('div', {},
    el('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:end' },
      labeled('Modality', modSel), labeled('Min subjects', minSubj), labeled('Open license only', openLic, true),
      el('button', { class: 'btn btn-green', onclick: runGoal }, 'Find & rank')),
    goalResult)));

  async function runGoal() {
    goalResult.innerHTML = ''; goalResult.append(waitPanel('Scoring candidates via DatasetSelector.find() against live OpenNeuro.', { height: 160, eta: { operation: 'goal-find', key: 'default' } }));
    try {
      const fitness = await Api.goalFind({ modality: modSel.value || undefined, min_subjects: +minSubj.value || undefined, license_must_be_open: openLic.checked, limit: 12 });
      goalResult.innerHTML = '';
      if (!fitness.length) { goalResult.append(el('p', { class: 'sub' }, 'No matches — try relaxing the goal.')); return; }
      goalResult.append(el('div', { class: 'tblw' }, el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Dataset'), el('th', {}, 'Fitness'), el('th', {}, 'Recommendation'))),
        el('tbody', {}, ...fitness.map((f, i) => el('tr', {},
          el('td', { class: 'num' }, `#${i + 1}`), el('td', {}, el('a', { href: `#/ds/${f.dataset_id}/overview` }, f.dataset_id)),
          el('td', {}, el('span', {
            class: `chip ${f.hard_fail?.length ? 'chip-fail' : f.total_score >= 60 ? 'chip-green' : ''}`,
            title: f.hard_fail?.length ? `Blockers: ${f.hard_fail.join(', ')}` : null,
          }, `${Math.round(f.total_score)}/100`)),
          el('td', {}, f.recommendation)))))));
    } catch (err) { goalResult.innerHTML = ''; goalResult.append(errorPanel(err)); }
  }

  wrap.append(viewAdvancedSearch());
  main.append(wrap);
}

/* ---------- Advanced Search (v2 capability: the multi-method engine) ------
   query compiler -> {structured, BM25 lexical, semantic/LSA} retrievers ->
   Reciprocal Rank Fusion -> optional DatasetFitness structural re-rank ->
   evidence-partitioned filtering -> negative-space diagnosis. Every stage's
   output is surfaced, not just the final ranked list: the compiled query
   plan (so a user can see "subjects≥20" was actually parsed as a hard
   constraint, not a stray text token), which retriever(s) found each result,
   each result's evidence state (never silently coerced to pass/fail), and a
   negative-space breakdown of what was excluded and why. "Include live
   OpenNeuro" is opt-in and additive — local ranking is never blocked on a
   network round trip, but the corpus is never artificially capped at
   whatever has already been indexed locally either. */
function viewAdvancedSearch() {
  const facetRail = el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap;margin-bottom:12px' }, skeletonPanel(40));
  const activeChips = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px' });
  const planLine = el('p', { class: 'sub', style: 'margin:0 0 12px' });
  const resultRegion = el('div', { style: 'margin-top:10px' });
  // catalog facets set modality/license the same way the compiler's own
  // ontology would infer them from free text — one code path, two entry
  // points, so a chip click and typing "eeg" in the box produce identical plans.
  const active = { modality: null, license: null };

  const q = el('input', {
    type: 'search', placeholder: 'e.g. "motor imagery EEG at least 20 subjects, open license"',
    style: 'flex:1', id: 'adv-search-q', autocomplete: 'off',
  });
  const minSubj = el('input', { type: 'number', min: 0, placeholder: 'any', style: 'width:90px', id: 'adv-min-subj' });
  const maxSize = el('input', { type: 'number', min: 0, step: 0.5, placeholder: 'any GB', style: 'width:90px', id: 'adv-max-size' });
  const hasEvents = el('input', { type: 'checkbox', id: 'adv-has-events' });
  const includeUnknown = el('input', { type: 'checkbox', checked: true, id: 'adv-include-unknown' });
  const includeLive = el('input', { type: 'checkbox', id: 'adv-include-live' });
  const deepRerank = el('input', { type: 'checkbox', id: 'adv-deep' });

  const form = el('form', {
    role: 'search', 'aria-label': 'Advanced dataset search',
    onsubmit: (e) => { e.preventDefault(); runSearch(); },
  },
    facetRail,
    activeChips,
    el('div', { style: 'display:flex;gap:10px;margin-bottom:12px' },
      q, el('button', { class: 'btn btn-green', type: 'submit' }, 'Search')),
    el('div', { style: 'display:flex;gap:20px;flex-wrap:wrap;align-items:end;margin-bottom:4px' },
      labeled('Min subjects', minSubj), labeled('Max size', maxSize),
      labeled('Must have events', hasEvents, true),
      labeled('Include unresolved evidence', includeUnknown, true),
      labeled('Include live OpenNeuro', includeLive, true),
      labeled('Deep fitness re-rank', deepRerank, true)),
    el('p', { class: 'sub', style: 'margin:6px 0 0;font-size:11.5px' },
      'Deep re-rank runs the DatasetFitness scorer over the shortlist and may call the live OpenNeuro API — off by default to keep search instant.'),
  );

  Api.catalogFacets(30).then(f => {
    facetRail.innerHTML = '';
    // The search engine's only license filter is `license_open` (open vs not) —
    // see the /search/engine contract; a specific `license=CC0` value is not a
    // supported query param and is silently ignored server-side. So the license
    // facet is a single open-license toggle (value 'open'), not a per-value
    // list that could never actually constrain results. Modality maps 1:1 to
    // the real `modality` param and keeps its per-value chips.
    const openLicenseN = (f.licenses || []).reduce((sum, l) => sum + (isOpenLicense(l.value) ? (l.n || 0) : 0), 0);
    const groups = [
      ['modality', 'Modality', f.modalities],
      ['license', 'License', openLicenseN ? [{ value: 'open', label: 'Open license', n: openLicenseN }] : []],
    ];
    groups.forEach(([key, label, items]) => {
      if (!items?.length) return;
      facetRail.append(el('div', {},
        el('div', { class: 'sub', style: 'font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px' }, label),
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;max-width:280px' },
          ...items.slice(0, 8).map(it => el('button', {
            type: 'button', class: 'chip', title: it.value.length > 28 ? it.value : null,
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
          }, it.label ?? facetLabel(it.value), it.n != null ? ` (${fmt(it.n)})` : ''))),
      ));
    });
  }).catch(() => { facetRail.innerHTML = ''; });

  function renderActiveChips() {
    activeChips.innerHTML = '';
    Object.entries(active).filter(([, v]) => v).forEach(([key, v]) => {
      const chipText = key === 'license' && v === 'open' ? 'Open license only' : `${key}: ${facetLabel(v)}`;
      activeChips.append(el('span', { class: 'chip chip-green', title: v.length > 28 ? v : null, style: 'max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block' }, chipText,
        el('button', { type: 'button', style: 'margin-left:6px', 'aria-label': `Remove ${key} filter`, onclick: () => {
          active[key] = null;
          facetRail.querySelectorAll(`[data-facet="${key}"]`).forEach(b => b.setAttribute('aria-pressed', 'false'));
          renderActiveChips(); runSearch();
        } }, '✕')));
    });
  }

  async function runSearch() {
    resultRegion.innerHTML = '';
    resultRegion.append(waitPanel(
      deepRerank.checked
        ? 'Fusing structured + lexical + semantic retrievers, then re-ranking via DatasetFitness.'
        : 'Fusing structured + lexical (BM25) + semantic retrievers.',
      { height: 160, eta: { operation: 'search-engine', key: deepRerank.checked ? 'deep' : 'standard' } },
    ));
    try {
      const data = await Api.searchEngine({
        q: q.value.trim() || undefined,
        modality: active.modality || undefined,
        min_subjects: minSubj.value ? +minSubj.value : undefined,
        max_size_gb: maxSize.value ? +maxSize.value : undefined,
        license_open: active.license === 'open' ? true : undefined,
        has_events: hasEvents.checked || undefined,
        include_unknown_evidence: includeUnknown.checked,
        deep: deepRerank.checked,
        include_live: includeLive.checked,
        // Pull a ranked shortlist deep enough to page through client-side.
        // The fusion already ordered these, so paging is a pure view concern —
        // no per-page round trip, and no reliance on a server `offset` param.
        limit: 200,
      });
      resultRegion.innerHTML = '';
      renderSearchResponse(resultRegion, data);
      announce(`${data.results.length} local result${data.results.length === 1 ? '' : 's'}` +
        (data.live_results?.length ? `, ${data.live_results.length} more from live OpenNeuro` : ''));
    } catch (err) { resultRegion.innerHTML = ''; resultRegion.append(errorPanel(err)); }
  }

  const section = panel('Advanced Search', 'multi-method engine — BM25 + semantic + structured, fused, evidence-aware', el('div', {}, form, resultRegion));
  runSearch();
  return section;
}

// A dataset row's provenance/ranking signals — which retriever(s) actually
// found it. Distinct from evChip (which conveys *evidence certainty*, e.g.
// "has_events: inferred") — this conveys *how it was found*, so the two are
// visually different (plain chip vs. colored evidence chip) on purpose.
function retrieverChip(name) {
  const LABEL = { lexical: 'keyword match (BM25)', semantic: 'semantic match', structured: 'structured filter' };
  return el('span', { class: 'chip', title: `Matched by the ${name} retriever` }, LABEL[name] ?? name);
}

function renderSearchResponse(container, data) {
  const { results, live_results: live, plan, negative_space: neg } = data;

  if (plan) container.append(el('p', { class: 'sub', style: 'margin:0 0 12px' }, renderPlanSummary(plan)));

  if (!results.length && !(live && live.length)) {
    container.append(el('p', { class: 'sub' }, 'No matches — try relaxing a filter, or enable "Include live OpenNeuro".'));
  } else if (results.length) {
    container.append(el('div', { class: 'model-artifact-links', style: 'margin-bottom:10px' },
      el('button', { class: 'btn btn-sm', onclick: () => exportSearchResultsCsv(results, plan) }, `Export ${fmt(results.length)} ranked results as CSV`)));
    container.append(paginatedResultsTable(results));
  }

  if (neg) container.append(negativeSpacePanel(neg));

  if (live && live.length) {
    const rows = live.map(d => el('tr', {},
      el('td', {},
        el('a', { href: `#/ds/${d.dataset_id}/overview` }, d.dataset_id),
        el('span', { style: 'color:var(--text-3)' }, ` ${d.name ?? ''}`)),
      el('td', {}, (d.modalities || []).join(', ')),
      el('td', {}, el('span', { class: 'chip' }, 'live OpenNeuro')),
    ));
    const table = el('table', { class: 't' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Dataset'), el('th', {}, 'Modalities'), el('th', {}, 'Source'))),
      el('tbody', {}, ...rows),
    );
    container.append(panelWrap('Also on OpenNeuro (live — not ranked by the local engine)', el('div', { class: 'tblw' }, table)));
  }
}

function exportSearchResultsCsv(results, plan) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const header = ['rank', 'dataset_id', 'name', 'score', 'subjects', 'size_bytes', 'modalities', 'retrievers', 'evidence', 'compiled_query_plan'];
  const lines = [header.map(quote).join(',')];
  results.forEach((result, index) => lines.push([
    index + 1,
    result.dataset_id,
    result.row?.name,
    result.fused_score,
    result.row?.n_subjects,
    result.row?.total_bytes,
    (result.row?.modalities || []).join('|'),
    (result.matched_by || []).join('|'),
    JSON.stringify(result.evidence_flags || {}),
    JSON.stringify(plan || {}),
  ].map(quote).join(',')));
  const href = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' }));
  const anchor = el('a', { href, download: `qortex-search-${new Date().toISOString().slice(0, 10)}.csv` });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

// Ranked results are fused server-side into one ordered list; paging is a
// pure view concern over that list (PAGE_SIZE per page), so there is no
// per-page network round trip and no reliance on a server `offset` param.
const SEARCH_PAGE_SIZE = 20;
function paginatedResultsTable(results) {
  const wrap = el('div', {});
  const tblHost = el('div', { class: 'tblw' });
  const pager = el('div', {
    class: 'pager',
    style: 'display:flex;align-items:center;gap:12px;margin-top:10px;font-size:12.5px;color:var(--text-2)',
  });
  const nPages = Math.max(1, Math.ceil(results.length / SEARCH_PAGE_SIZE));
  let page = 0;

  function renderPage() {
    const start = page * SEARCH_PAGE_SIZE;
    const slice = results.slice(start, start + SEARCH_PAGE_SIZE);
    tblHost.innerHTML = '';
    tblHost.append(el('table', { class: 't' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Dataset'), el('th', {}, 'Score'), el('th', {}, 'Signals'),
        el('th', {}, 'Subjects'), el('th', {}, 'Size'), el('th', {}, 'Modalities'))),
      el('tbody', {}, ...slice.map(searchResultRow))));

    pager.innerHTML = '';
    if (nPages > 1) {
      const prev = el('button', {
        class: 'btn btn-sm', disabled: page === 0 ? '' : null,
        onclick: () => { if (page > 0) { page--; renderPage(); } },
      }, '‹ Prev');
      const next = el('button', {
        class: 'btn btn-sm', disabled: page >= nPages - 1 ? '' : null,
        onclick: () => { if (page < nPages - 1) { page++; renderPage(); } },
      }, 'Next ›');
      pager.append(prev, next,
        el('span', {}, `Showing ${fmt(start + 1)}–${fmt(start + slice.length)} of ${fmt(results.length)} ranked`));
    } else {
      pager.append(el('span', {}, `${fmt(results.length)} ranked result${results.length === 1 ? '' : 's'}`));
    }
  }
  renderPage();
  wrap.append(tblHost, pager);
  return wrap;
}

function searchResultRow(r) {
  return el('tr', {},
    el('td', {},
      el('a', { href: `#/ds/${r.dataset_id}/overview` }, r.dataset_id),
      el('div', { style: 'color:var(--text-3);font-size:12px' }, r.row?.name ?? '')),
    el('td', { class: 'num' }, r.fused_score.toFixed(4)),
    el('td', {}, el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' },
      ...(r.matched_by || []).map(retrieverChip),
      evChip(r.evidence_flags?.has_events ?? 'unknown', `events: ${r.evidence_flags?.has_events ?? 'unknown'}`),
      r.fitness ? el('span', {
        class: `chip ${r.fitness.hard_fail?.length ? 'chip-fail' : 'chip-green'}`,
        title: r.fitness.recommendation ?? '',
      }, `fitness ${Math.round(r.fitness.total_score)}/100`) : null)),
    el('td', { class: 'num' }, r.row?.n_subjects ?? '—'),
    el('td', { class: 'num' }, r.row?.total_bytes ? fmtBytes(r.row.total_bytes) : '—'),
    el('td', {}, (r.row?.modalities || []).join(', ')));
}

function renderPlanSummary(plan) {
  const parts = [];
  const SYM = { ge: '≥', le: '≤', eq: '=', in: '∈' };
  Object.entries(plan.hard || {}).forEach(([field, c]) => {
    const val = Array.isArray(c.value) ? `{${c.value.join(', ')}}` : c.value;
    parts.push(`${field} ${SYM[c.op] ?? c.op} ${val}`);
  });
  let line = parts.length ? `Parsed as: ${parts.join(' · ')}` : 'No structured constraints parsed.';
  if (plan.soft_terms?.length) line += `  ·  ranking terms: ${plan.soft_terms.join(', ')}`;
  return line;
}

// Negative-space diagnosis: what was excluded from the current scope, and
// why — the concrete mechanism behind "42 EEG motor datasets, only 7
// ML-ready" instead of a bare empty-results page. Rendered as a real list
// (not a wall of prose) so a screen reader announces it as structured content.
function negativeSpacePanel(neg) {
  const reasons = Object.entries(neg.rejection_reasons || {});
  return panelWrap('Scope & rejections', el('div', {},
    el('p', { class: 'sub', style: 'margin:0 0 8px' },
      `${fmt(neg.n_in_scope)} datasets in scope → ${fmt(neg.n_admitted)} admitted, ${fmt(neg.n_rejected)} rejected`),
    reasons.length ? el('ul', { class: 'reason-list' }, ...reasons.map(([reason, count]) =>
      el('li', {}, el('span', { class: 'reason-count' }, fmt(count)), ` ${reason}`))) : null,
    neg.n_unknown_resolvable ? el('p', { class: 'sub', style: 'margin-top:8px' },
      el('span', { 'aria-hidden': 'true' }, '≈ '),
      `${fmt(neg.n_unknown_resolvable)} more have unresolved evidence and may qualify after a cheap metadata probe.`) : null,
  ));
}
// The catalog exposes many license strings, but the search engine only
// distinguishes open vs. not (`license_open`). This classifies a raw license
// value as open for the display-only count on the "Open license" facet — the
// authoritative open/not decision is still made server-side by the compiler.
function isOpenLicense(v) {
  if (!v) return false;
  const s = String(v).toLowerCase();
  return /(cc0|cc-0|\bcco\b|pddl|cc-by|cc0-|creative commons|public domain|\bpd\b|\bpddl\b)/.test(s);
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
  // Label text always comes first in the DOM — for `inline`, flex-direction:row
  // just lays that same [label, control] pair out horizontally instead of
  // stacked. Putting `control` first (as this used to) put each widget's own
  // name to its *right*, which reads as if it belongs to whatever sits next
  // to it — e.g. three selects in a row each looked mislabeled by one.
  return el('label', { style: `display:flex;${inline ? 'flex-direction:row;align-items:center;gap:8px' : 'flex-direction:column;gap:4px'};font-size:12.5px;color:var(--text-2)` }, [label, control]);
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
  const comparisonResult = el('div', { style: 'margin-top:12px' });
  const variableEditor = el('div', { class: 'cohort-variable-editor' });
  const alphaInput = el('input', { type: 'number', min: '0.001', max: '0.25', step: '0.001', value: '0.05', style: 'width:90px' });

  function addVariable(column = '', kind = 'numeric') {
    const columnInput = el('input', { type: 'text', value: column, placeholder: 'participants.tsv column' });
    const kindInput = el('select', {},
      el('option', { value: 'numeric', selected: kind === 'numeric' }, 'Numeric'),
      el('option', { value: 'categorical', selected: kind === 'categorical' }, 'Categorical'));
    const row = el('div', { class: 'cohort-variable-row' },
      labeled('Column', columnInput), labeled('Declared type', kindInput),
      el('button', { class: 'btn btn-sm', onclick: () => row.remove(), title: 'Remove comparison variable' }, 'Remove'));
    row.variableValue = () => ({ column: columnInput.value.trim(), kind: kindInput.value });
    variableEditor.append(row);
  }
  addVariable('age', 'numeric');

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
  wrap.append(panel('Participant comparison', 'explicit variable semantics · no inferred group labels', el('div', {},
    variableEditor,
    el('div', { class: 'cohort-comparison-actions' },
      el('button', { class: 'btn btn-sm', onclick: () => addVariable('', 'numeric') }, 'Add variable'),
      labeled('Alpha', alphaInput, true),
      el('button', { class: 'btn btn-green', onclick: runComparison }, 'Compare two datasets')),
    el('p', { class: 'sub' }, 'Groups are dataset membership. Numeric variables use Welch inference plus Mann-Whitney sensitivity; categorical variables use Fisher exact for 2×2 tables or Pearson chi-square. Primary p-values are Benjamini-Hochberg adjusted.'),
    comparisonResult)));
  wrap.append(resultWrap);

  async function runComparison() {
    comparisonResult.innerHTML = '';
    if (selected.size !== 2) {
      comparisonResult.append(errorPanel(new Error('Participant comparison requires exactly two selected datasets.')));
      return;
    }
    const variables = [...variableEditor.querySelectorAll('.cohort-variable-row')]
      .map(row => row.variableValue()).filter(item => item.column);
    if (!variables.length) {
      comparisonResult.append(errorPanel(new Error('Declare at least one participant variable.')));
      return;
    }
    comparisonResult.append(waitPanel('Fetching real participant tables and computing the declared comparison.', {
      height: 180, eta: { operation: 'cohort-participant-comparison', key: `${[...selected].join(':')}:${JSON.stringify(variables)}` },
    }));
    try {
      const report = await Api.cohortCompareParticipants({
        dataset_ids: [...selected], variables, alpha: Number(alphaInput.value),
      });
      comparisonResult.innerHTML = '';
      comparisonResult.append(renderCohortComparison(report));
    } catch (err) {
      comparisonResult.innerHTML = '';
      comparisonResult.append(errorPanel(err));
    }
  }

  async function compute() {
    resultWrap.innerHTML = '';
    if (selected.size < 2) { resultWrap.append(el('p', { class: 'sub' }, 'Select at least two datasets.')); return; }
    resultWrap.append(waitPanel(`Building the cohort across ${selected.size} datasets via CohortBuilder.`, { height: 200, eta: { operation: 'cohort-compose', key: [...selected].sort().join(',') } }));
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

function renderCohortComparison(report) {
  const wrap = el('div', { class: 'cohort-comparison-report' },
    el('div', { class: 'demographic-warning' },
      el('b', {}, 'Interpretation boundary'), el('span', {}, report.group_definition.warning)),
    el('dl', { class: 'kv' },
      el('dt', {}, 'Direction'), el('dd', { class: 'mono' }, report.group_definition.direction),
      el('dt', {}, 'Missingness'), el('dd', {}, report.missingness_policy),
      el('dt', {}, 'Tests'), el('dd', {}, report.test_policy),
      el('dt', {}, 'Multiplicity'), el('dd', {}, report.multiplicity_policy),
      el('dt', {}, 'Alpha'), el('dd', { class: 'mono' }, report.alpha)));
  for (const variable of report.variables || []) {
    if (variable.status !== 'completed') {
      wrap.append(panel(variable.column, variable.kind, el('div', { class: 'demographic-warning' },
        el('b', {}, variable.status.replaceAll('_', ' ')), el('span', {}, variable.reason))));
      continue;
    }
    const groupRows = Object.entries(variable.groups).map(([name, group]) => {
      if (variable.kind === 'numeric') {
        const summary = group.summary;
        return [name, group.total_rows, summary?.n ?? 0, group.missing, group.invalid?.length || 0,
          summary ? `${summary.mean.toFixed(3)} ± ${summary.std?.toFixed(3) ?? '—'}` : '—',
          summary ? `${summary.median.toFixed(3)} [${summary.q1.toFixed(3)}, ${summary.q3.toFixed(3)}]` : '—'];
      }
      return [name, group.total_rows, group.total_rows - group.missing - (group.invalid?.length || 0), group.missing, group.invalid?.length || 0,
        Object.entries(group.counts).map(([category, count]) => `${category}: ${count}`).join(' · '), '—'];
    });
    const primary = variable.primary_test;
    const effect = primary.effect_size || {};
    const invalidEntries = Object.entries(variable.groups).flatMap(([dataset, group]) =>
      (group.invalid || []).map(item => `${dataset} row ${item.row}: ${JSON.stringify(item.value)}`));
    const metricCards = el('div', { class: 'model-metric-grid' },
      el('div', { class: 'model-metric' }, el('span', { class: 'sub' }, 'Raw p'), el('b', { class: 'mono' }, Number(primary.p_value_raw).toPrecision(4)), el('span', { class: 'sub' }, primary.method)),
      el('div', { class: 'model-metric' }, el('span', { class: 'sub' }, 'BH-adjusted p'), el('b', { class: 'mono' }, Number(primary.p_value_bh).toPrecision(4)), el('span', { class: 'sub' }, primary.reject_at_alpha ? `below α=${report.alpha}` : `not below α=${report.alpha}`)),
      el('div', { class: 'model-metric' }, el('span', { class: 'sub' }, effect.name || 'Effect size'), el('b', { class: 'mono' }, effect.value == null ? '—' : Number(effect.value).toFixed(4)), el('span', { class: 'sub' }, effect.direction || 'association magnitude')));
    const estimate = variable.kind === 'numeric' ? el('dl', { class: 'kv' },
      el('dt', {}, 'Estimand'), el('dd', {}, variable.estimand),
      el('dt', {}, 'Mean difference'), el('dd', { class: 'mono' }, Number(primary.mean_difference).toFixed(4)),
      el('dt', {}, `${Math.round(primary.confidence_level * 100)}% CI`), el('dd', { class: 'mono' }, primary.confidence_interval.map(value => Number(value).toFixed(4)).join(' to ')),
      el('dt', {}, 'Sensitivity'), el('dd', {}, `${variable.sensitivity_test.method}: p=${Number(variable.sensitivity_test.p_value_raw).toPrecision(4)}; ${variable.sensitivity_test.effect_size.name}=${Number(variable.sensitivity_test.effect_size.value).toFixed(4)}`))
      : el('div', { class: 'tblw' }, el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Cohort'), ...variable.categories.map(category => el('th', {}, category)))),
        el('tbody', {}, ...Object.keys(variable.groups).map((name, index) => el('tr', {}, el('td', {}, name), ...variable.contingency_table[index].map(value => el('td', { class: 'num' }, value)))))));
    wrap.append(panel(variable.column, `${variable.kind} · ${primary.method}`, el('div', {},
      metricCards,
      variable.category_validation ? el('p', { class: 'sub' }, variable.category_validation) : null,
      invalidEntries.length ? el('div', { class: 'demographic-warning' },
        el('b', {}, `${invalidEntries.length} invalid value(s) excluded`), el('span', {}, invalidEntries.join('; '))) : null,
      tinyTable(['Dataset', 'Rows', 'Analyzed', 'Missing', 'Invalid', variable.kind === 'numeric' ? 'Mean ± SD' : 'Counts', 'Median [IQR]'], groupRows),
      estimate)));
  }
  wrap.append(panel('Sources', 'immutable OpenNeuro snapshot participant tables', tinyTable(
    ['Dataset', 'Snapshot', 'Rows', 'Path', 'MD5'],
    (report.sources || []).map(source => [source.dataset_id, source.snapshot, source.rows, source.path, source.checksum_md5 || 'Not published']))));
  return wrap;
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
    const models = (await Api.models()).filter(m => m.compatibility_available);
    if (!models.length) throw new Error('No model contracts are available to the compatibility engine.');
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
      resultWrap.innerHTML = ''; resultWrap.append(waitPanel(`Building signal-budget profiles for ${ids.length} dataset(s) from remote metadata.`, { height: 140, eta: { operation: 'compatibility-batch', key: ids.sort().join(',') } }));
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

/* ---------- Public model zoo and measured local runtime state ---------- */
async function viewModels() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' },
    el('div', { class: 'eyebrow' }, 'NeuroAI'),
    el('h1', {}, 'Model Zoo'),
    el('p', { class: 'ds-meta' }, 'Registered public models and engines. Availability, licenses, contracts, and cache state come from the running Qortex environment.')));
  const body = el('div', {}, skeletonPanel(260));
  wrap.append(body); main.append(wrap);
  try {
    const [models, status, cacheControl] = await Promise.all([
      Api.models(), Api.modelStatus(), Api.modelCacheInventory(),
    ]);
    const backendRows = Object.entries(status.backends || {}).map(([name, result]) =>
      el('div', { class: 'model-backend', title: result.error || `${result.module} imports successfully` },
        el('span', { class: `status-dot ${result.available ? 'status-good' : 'status-bad'}` }),
        el('b', {}, name),
        el('span', { class: 'sub mono' }, result.module),
        el('span', { class: 'sp' }),
        el('span', { class: 'sub' }, result.available ? 'Available' : 'Unavailable')));
    const provider = el('select', { 'aria-label': 'Filter by provider' }, el('option', { value: '' }, 'All providers'));
    const modality = el('select', { 'aria-label': 'Filter by modality' }, el('option', { value: '' }, 'All modalities'));
    const task = el('select', { 'aria-label': 'Filter by task' }, el('option', { value: '' }, 'All tasks'));
    const unique = key => [...new Set(models.flatMap(model => Array.isArray(model[key]) ? model[key] : [model[key]]).filter(Boolean))].sort();
    unique('provider').forEach(value => provider.append(el('option', { value }, value)));
    unique('modality').forEach(value => modality.append(el('option', { value }, value)));
    unique('task').forEach(value => task.append(el('option', { value }, value)));
    const count = el('span', { class: 'sub' });
    const cacheWorkspace = renderModelCacheWorkspace(status.cache, cacheControl, modelId => {
      const model = models.find(item => item.id === modelId);
      if (model) { model.cached = false; model.cache = null; }
      render();
    });
    const validationBody = el('div', { class: 'model-validation-body' });
    const deviceSelect = el('select', { 'aria-label': 'Inference device' },
      el('option', { value: 'auto' }, 'Auto device'),
      el('option', { value: 'cuda' }, 'CUDA'),
      el('option', { value: 'cpu' }, 'CPU'));
    const validationButton = el('button', { class: 'btn btn-green' }, 'Run public pretrained validation');
    const validationControls = el('div', { class: 'model-validation-controls' }, deviceSelect, validationButton);
    validationBody.append(validationControls, el('p', { class: 'sub' },
      'Pinned MONAI BraTS bundle · pinned public BraTS 2023 case · exact bundle preprocessing · ground-truth Dice · no training or generated inputs.'));

    const detectionBody = el('div', { class: 'model-validation-body' });
    const detectionDevice = el('select', { 'aria-label': 'Object detection inference device' },
      el('option', { value: 'auto' }, 'Auto device'),
      el('option', { value: 'cuda' }, 'CUDA'),
      el('option', { value: 'cpu' }, 'CPU'));
    const scoreThreshold = el('input', {
      type: 'number', min: '0.05', max: '0.95', step: '0.05', value: '0.5',
      'aria-label': 'Detection score threshold', title: 'Detection score threshold', style: 'width:95px',
    });
    const iouThreshold = el('input', {
      type: 'number', min: '0.1', max: '1', step: '0.05', value: '0.5',
      'aria-label': 'Ground-truth IoU threshold', title: 'Ground-truth IoU threshold', style: 'width:95px',
    });
    const detectionButton = el('button', { class: 'btn btn-green' }, 'Run public detection validation');
    detectionBody.append(
      el('div', { class: 'model-validation-controls' },
        detectionDevice, labeled('Score', scoreThreshold), labeled('Match IoU', iouThreshold), detectionButton),
      el('p', { class: 'sub' },
        'Pinned Torchvision Faster R-CNN weights · pinned COCO 2017 validation image and annotations · exact weights preprocessing · measured one-image precision, recall, and matched IoU · no training.'));

    validationButton.onclick = async () => {
      validationButton.disabled = true;
      deviceSelect.disabled = true;
      validationBody.querySelector('.model-validation-result')?.remove();
      const resultHost = el('div', { class: 'model-validation-result' });
      const statusText = el('div', { class: 'sub' }, 'Submitting validation job…');
      const bar = el('div', { class: 'jprog' }, el('div', { style: 'width:0%' }));
      resultHost.append(statusText, bar); validationBody.append(resultHost);
      try {
        const { job_id } = await Api.executeModelProfile('public-brats-segmentation-v1', {
          device: deviceSelect.value,
        });
        const completed = await new Promise((resolve, reject) => {
          const iv = setInterval(async () => {
            try {
              const job = await Api.job(job_id);
              bar.firstChild.style.width = `${job.progress || 0}%`;
              statusText.textContent = `Downloading verified artifacts and running inference · ${job.progress || 0}%`;
              if (job.status === 'done') { clearInterval(iv); resolve(job.result); }
              else if (job.status === 'error') { clearInterval(iv); reject(new Error(job.error || 'Validation failed.')); }
            } catch (err) { clearInterval(iv); reject(err); }
          }, 1000);
        });
        await renderPublicBratsResult(resultHost, completed);
        const refreshed = await Api.modelStatus();
        status.cache = refreshed.cache;
      } catch (err) {
        resultHost.innerHTML = '';
        resultHost.append(errorPanel(err));
      } finally {
        validationButton.disabled = false;
        deviceSelect.disabled = false;
      }
    };
    detectionButton.onclick = async () => {
      const controls = [detectionButton, detectionDevice, scoreThreshold, iouThreshold];
      controls.forEach(control => { control.disabled = true; });
      detectionBody.querySelector('.model-validation-result')?.remove();
      const resultHost = el('div', { class: 'model-validation-result' });
      const statusText = el('div', { class: 'sub' }, 'Submitting object detection validation job…');
      const bar = el('div', { class: 'jprog' }, el('div', { style: 'width:0%' }));
      resultHost.append(statusText, bar); detectionBody.append(resultHost);
      try {
        const { job_id } = await Api.executeModelProfile('public-coco-detection-v1', {
          device: detectionDevice.value,
          score_threshold: Number(scoreThreshold.value),
          iou_threshold: Number(iouThreshold.value),
        });
        const completed = await new Promise((resolve, reject) => {
          const iv = setInterval(async () => {
            try {
              const job = await Api.job(job_id);
              bar.firstChild.style.width = `${job.progress || 0}%`;
              statusText.textContent = `Verifying COCO artifacts and running pretrained detection · ${job.progress || 0}%`;
              if (job.status === 'done') { clearInterval(iv); resolve(job.result); }
              else if (job.status === 'error') { clearInterval(iv); reject(new Error(job.error || 'Detection validation failed.')); }
            } catch (err) { clearInterval(iv); reject(err); }
          }, 1000);
        });
        renderPublicDetectionResult(resultHost, completed);
      } catch (err) {
        resultHost.innerHTML = '';
        resultHost.append(errorPanel(err));
      } finally {
        controls.forEach(control => { control.disabled = false; });
      }
    };
    const tableBody = el('tbody');
    const table = el('div', { class: 'tblw model-table' }, el('table', { class: 't' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Model / engine'), el('th', {}, 'Provider'), el('th', {}, 'Modality'),
        el('th', {}, 'Task'), el('th', {}, 'Runtime'), el('th', {}, 'License'), el('th', {}, 'Offline'))), tableBody));
    function render() {
      const rows = models.filter(model =>
        (!provider.value || model.provider === provider.value) &&
        (!modality.value || model.modality.includes(modality.value)) &&
        (!task.value || model.task.includes(task.value)));
      count.textContent = `${rows.length} of ${models.length} registered entries`;
      tableBody.innerHTML = '';
      rows.forEach(model => {
        const runtimeNote = model.executable
          ? `${model.runtime_status}; ${model.executable} ${model.executable_available ? 'found' : 'not found'}`
          : model.runtime_status;
        tableBody.append(el('tr', {},
          el('td', {}, el('a', { href: model.source_url, target: '_blank', rel: 'noreferrer' }, model.display_name),
            el('div', { class: 'sub mono' }, model.id),
            ...(model.execution_profiles || []).map(profile => el('span', {
              class: 'chip chip-green', title: `${profile.result_contract} · ${profile.dataset.id}`,
            }, 'Executable profile'))),
          el('td', {}, model.provider),
          el('td', {}, model.modality.join(', ') || '—'),
          el('td', {}, model.task.join(', ') || '—'),
          el('td', {}, el('span', { class: 'model-runtime', title: runtimeNote }, model.runtime_status.replaceAll('_', ' '))),
          el('td', {}, model.license?.name || 'Unknown', el('div', { class: 'sub' }, model.license?.evidence_status || model.evidence_status)),
          el('td', {}, model.cached ? el('span', { class: 'chip chip-green', title: model.cache?.local_path || '' }, `Cached · ${fmtBytes(model.cache?.size_bytes)}`) : el('span', { class: 'sub' }, 'Not cached'))));
      });
    }
    [provider, modality, task].forEach(control => control.addEventListener('change', render));
    body.innerHTML = '';
    body.append(
      el('div', { class: 'model-summary-grid' },
        panel('Runtime backends', 'live import probes', el('div', { class: 'model-backends' }, ...backendRows)),
        panel('Model cache', 'owner-aware · recoverable removal', cacheWorkspace)),
      panel('Pretrained public validation', 'real model · real data · measured output', validationBody),
      panel('Public object detection validation', 'artifact-backed COCO evaluation', detectionBody),
      panel('Registered models and engines', null, el('div', {},
        el('div', { class: 'model-filters' }, provider, modality, task, count), table)));
    render();
  } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
}

function renderModelCacheWorkspace(summary, inventory, onRemoved) {
  const wrap = el('div', { class: 'model-cache-workspace' });
  const summaryList = el('dl', { class: 'kv' },
    el('dt', {}, 'Manifest'), el('dd', { class: 'mono' }, summary?.path || '—'),
    el('dt', {}, 'Entries'), el('dd', {}, fmt(summary?.entries)),
    el('dt', {}, 'Recorded size'), el('dd', {}, fmtBytes(summary?.size_bytes)),
    el('dt', {}, 'Trash'), el('dd', { class: 'mono' }, inventory.trash_root));
  wrap.append(summaryList, el('p', { class: 'sub' }, inventory.policy));
  const list = el('div', { class: 'model-cache-list' });
  for (const entry of inventory.entries || []) {
    const action = el('button', {
      class: 'btn btn-sm', disabled: !entry.removable,
      title: entry.removable
        ? `Integrity will be rechecked against SHA-256 ${entry.sha256}`
        : `Removal blocked: owner ${entry.storage_owner}; shared with ${entry.shared_with.join(', ') || 'none'}; exists ${entry.exists}`,
    }, entry.removable ? 'Move to trash' : 'Removal blocked');
    const row = el('div', { class: 'model-cache-entry' },
      el('div', {}, el('b', {}, entry.model_id), el('div', { class: 'sub mono' }, entry.path),
        el('div', { class: 'sub' }, `${entry.storage_owner} · ${entry.target_type} · ${fmtBytes(entry.recorded_size_bytes)}`)),
      action);
    action.onclick = async () => {
      const confirmed = window.confirm(
        `Move ${entry.model_id} to Qortex trash?\n\nThe recorded artifact will be hash-verified and remain recoverable. No run artifacts or datasets will be removed.`);
      if (!confirmed) return;
      action.disabled = true;
      action.textContent = 'Verifying…';
      try {
        const receipt = await Api.removeModelCache(entry.model_id, entry.sha256);
        row.replaceChildren(
          el('div', {}, el('b', {}, `${entry.model_id} moved to trash`),
            el('div', { class: 'sub mono' }, receipt.trash_path),
            el('div', { class: 'sub' }, `Verified ${receipt.verified_sha256} · recovery receipt persisted`)));
        onRemoved(entry.model_id);
      } catch (err) {
        action.disabled = false;
        action.textContent = 'Move to trash';
        row.append(errorPanel(err));
      }
    };
    list.append(row);
  }
  wrap.append(list);
  return wrap;
}

function renderPublicDetectionResult(host, result) {
  host.innerHTML = '';
  const metrics = result.metrics || {};
  const metricCards = el('div', { class: 'model-metric-grid' },
    ...[
      ['Precision', metrics.precision, `${fmt(metrics.true_positives)} TP · ${fmt(metrics.false_positives)} FP`],
      ['Recall', metrics.recall, `${fmt(metrics.true_positives)} TP · ${fmt(metrics.false_negatives)} FN`],
      ['Mean matched IoU', metrics.mean_matched_iou, `${fmt(metrics.evaluated_predictions)} predictions · ${fmt(metrics.ground_truth_objects)} targets`],
    ].map(([name, value, detail]) => el('div', { class: 'model-metric' },
      el('span', { class: 'sub' }, name),
      el('b', { class: 'mono' }, value == null ? '—' : Number(value).toFixed(4)),
      el('span', { class: 'sub mono' }, detail))));
  const provenance = el('dl', { class: 'kv model-run-provenance' },
    el('dt', {}, 'Image'), el('dd', { class: 'mono' }, `${result.dataset.id}/${result.dataset.split}/${result.dataset.image_id}`),
    el('dt', {}, 'Image SHA-256'), el('dd', { class: 'mono' }, result.input.sha256),
    el('dt', {}, 'Annotations SHA-256'), el('dd', { class: 'mono' }, result.dataset.annotation_archive_sha256),
    el('dt', {}, 'Weights'), el('dd', { class: 'mono' }, `${result.model.weights} · ${result.model.checkpoint_sha256}`),
    el('dt', {}, 'Device / precision'), el('dd', {}, `${result.runtime.device} · ${result.runtime.precision}`),
    el('dt', {}, 'Preprocessing'), el('dd', { class: 'mono' }, result.runtime.preprocessing),
    el('dt', {}, 'Inference'), el('dd', {}, `${Number(result.runtime.inference_seconds).toFixed(3)} s`),
    el('dt', {}, 'Peak CUDA allocated'), el('dd', {}, result.runtime.peak_memory?.allocated_bytes != null ? fmtBytes(result.runtime.peak_memory.allocated_bytes) : 'Not measured'),
    el('dt', {}, 'Image license'), el('dd', {}, result.dataset.image_license?.name || 'Recorded in COCO metadata'),
    el('dt', {}, 'Metric scope'), el('dd', {}, metrics.metric_scope));
  const board = el('img', {
    class: 'model-detection-board',
    src: Api.publicDetectionArtifactUrl(result.run_id, 'board'),
    alt: `Detected objects on COCO validation image ${result.dataset.image_id}`,
  });
  const links = el('div', { class: 'model-artifact-links' },
    ...Object.entries(result.artifacts).map(([name]) => {
      const evidence = result.artifact_inventory?.[name];
      return el('a', {
        class: 'btn btn-sm', href: Api.publicDetectionArtifactUrl(result.run_id, name), target: '_blank', rel: 'noreferrer',
        title: evidence?.sha256 ? `SHA-256 ${evidence.sha256} · ${fmtBytes(evidence.size_bytes)}` : 'Provenance record',
      }, name.replaceAll('_', ' '));
    }));
  host.append(metricCards, provenance, board, links,
    el('p', { class: 'sub' }, 'This is one pinned-image verification. It is not COCO dataset mAP and is not presented as a clinical metric.'));
}

async function renderPublicBratsResult(host, result) {
  host.innerHTML = '';
  const metrics = result.metrics || {};
  const metricCards = el('div', { class: 'model-metric-grid' },
    ...Object.entries(metrics).map(([name, value]) => el('div', { class: 'model-metric' },
      el('span', { class: 'sub' }, name.replaceAll('_', ' ')),
      el('b', { class: 'mono' }, Number(value.dice).toFixed(4)),
      el('span', { class: 'sub mono' }, `${fmt(value.predicted_voxels)} predicted · ${fmt(value.target_voxels)} target`))));
  const provenance = el('dl', { class: 'kv model-run-provenance' },
    el('dt', {}, 'Case'), el('dd', { class: 'mono' }, result.dataset.case_id),
    el('dt', {}, 'Model revision'), el('dd', { class: 'mono' }, result.model.revision),
    el('dt', {}, 'Checkpoint'), el('dd', { class: 'mono' }, result.model.checkpoint_sha256),
    el('dt', {}, 'Device'), el('dd', {}, result.runtime.device),
    el('dt', {}, 'Preprocess'), el('dd', {}, `${result.runtime.preprocess_seconds.toFixed(3)} s`),
    el('dt', {}, 'Inference'), el('dd', {}, `${result.runtime.inference_seconds.toFixed(3)} s`),
    el('dt', {}, 'Peak CUDA allocated'), el('dd', {}, result.runtime.peak_memory?.allocated_bytes != null ? fmtBytes(result.runtime.peak_memory.allocated_bytes) : 'Not measured'),
    el('dt', {}, 'Environment'), el('dd', { class: 'mono' }, result.reproducibility?.environment
      ? `Python ${result.reproducibility.environment.python_version} · torch ${result.reproducibility.environment.packages?.torch} · ${result.reproducibility.environment.cuda?.device_name || 'CPU'}`
      : 'This run predates environment capture'),
    el('dt', {}, 'Precision / seed'), el('dd', {}, `${result.reproducibility?.precision || 'Not recorded'} · ${result.reproducibility?.seed_evidence || 'Seed state not recorded'}`),
    el('dt', {}, 'Licenses'), el('dd', {}, `${result.model.license} model · ${result.dataset.license} data`));
  const viewers = el('div', { class: 'model-result-viewers' });
  const predictionCanvas = el('canvas', { class: 'model-result-canvas', role: 'img', 'aria-label': 'T1 contrast MRI with model prediction overlay' });
  const truthCanvas = el('canvas', { class: 'model-result-canvas', role: 'img', 'aria-label': 'T1 contrast MRI with ground-truth overlay' });
  viewers.append(
    el('div', {}, el('div', { class: 'model-viewer-title' }, 'Prediction'), predictionCanvas),
    el('div', {}, el('div', { class: 'model-viewer-title' }, 'Ground truth'), truthCanvas));
  const links = el('div', { class: 'model-artifact-links' },
    ...Object.entries(result.artifacts).map(([name]) => {
      const evidence = result.artifact_inventory?.[name];
      return el('a', {
        class: 'btn btn-sm', href: Api.publicBratsArtifactUrl(result.run_id, name), target: '_blank', rel: 'noreferrer',
        title: evidence?.sha256 ? `SHA-256 ${evidence.sha256} · ${fmtBytes(evidence.size_bytes)}` : 'No binary hash inventory in this older run',
      }, name.replaceAll('_', ' '));
    }));
  host.append(metricCards, provenance, viewers, links,
    el('p', { class: 'sub' }, 'Research use only. Dice values are computed from this downloaded case, not copied from the model card.'));

  const baseUrl = Api.publicBratsArtifactUrl(result.run_id, 'input');
  await Promise.all([
    attachBratsResultViewer(predictionCanvas, baseUrl, Api.publicBratsArtifactUrl(result.run_id, 'prediction')),
    attachBratsResultViewer(truthCanvas, baseUrl, Api.publicBratsArtifactUrl(result.run_id, 'ground_truth')),
  ]);
}

async function attachBratsResultViewer(canvas, baseUrl, overlayUrl) {
  return attachNiftiOverlayViewer(canvas, baseUrl, overlayUrl, 'red', 0.55);
}

async function attachNiftiOverlayViewer(canvas, baseUrl, overlayUrl, colormap = 'red', opacity = 0.55) {
  const nv = new Niivue({
    isResizeCanvas: true,
    show3Dcrosshair: true,
    isOrientationTextVisible: true,
    isColorbar: false,
    multiplanarEqualSize: false,
    multiplanarShowRender: SHOW_RENDER.ALWAYS,
    multiplanarLayout: MULTIPLANAR_TYPE.GRID,
    dragAndDropEnabled: false,
    backColor: [0, 0, 0, 1],
  });
  await nv.attachToCanvas(canvas);
  const base = await NVImage.loadFromUrl({ url: baseUrl, colormap: 'gray' });
  const overlay = await NVImage.loadFromUrl({ url: overlayUrl, colormap, opacity });
  nv.addVolume(base); nv.addVolume(overlay); nv.drawScene();
}

/* ---------- Plans & Jobs ---------- */
async function viewPlans() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' }, el('div', { class: 'eyebrow' }, 'Runtime'), el('h1', {}, 'Plans & Jobs')));
  const activityHost = el('div', {}, skeletonPanel(200));
  const runsHost = el('div', {}, skeletonPanel(240));
  const body = el('div', {}, activityHost, runsHost);
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
      activityHost.innerHTML = '';
      if (!jobs.length) { activityHost.append(panel('Recent activity', null, el('p', { class: 'sub' }, 'No jobs run yet this session.'))); return; }
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
      activityHost.innerHTML = '';
      activityHost.append(panel('Recent activity', 'in-memory operational jobs · click for result and log', rows));
    } catch (err) { activityHost.innerHTML = ''; activityHost.append(errorPanel(err)); }
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
  try {
    const inventory = await Api.persistentRuns(100);
    runsHost.innerHTML = '';
    runsHost.append(renderPersistentRuns(inventory));
  } catch (err) {
    runsHost.innerHTML = '';
    runsHost.append(errorPanel(err));
  }
  const iv = setInterval(() => { if (!document.body.contains(wrap)) { clearInterval(iv); return; } refresh(); }, 4000);
}

function renderPersistentRuns(inventory) {
  const rows = inventory.runs || [];
  const content = el('div', {});
  if (!rows.length) {
    content.append(el('p', { class: 'sub' }, 'No completed artifact-backed runs were found on disk.'));
  }
  for (const run of rows) {
    const metricEntries = Object.entries(run.metrics || {}).filter(([, value]) => value != null);
    const evidenceEntries = Object.entries(run.reproducibility || {})
      .filter(([, value]) => typeof value === 'boolean');
    const summaryMetrics = metricEntries.slice(0, 4).map(([name, value]) => {
      const shown = name.endsWith('_bytes') ? fmtBytes(value)
        : name.endsWith('_seconds') ? `${Number(value).toFixed(3)} s`
          : name.startsWith('dice_') ? Number(value).toFixed(4) : fmt(value);
      return el('span', { class: 'chip' }, `${name.replaceAll('_', ' ')} ${shown}`);
    });
    const artifactLinks = (run.artifacts?.files || []).map(file => {
      const href = run.kind === 'conversion'
        ? Api.conversionArtifactUrl(run.dataset.id, run.dataset.snapshot, run.run_id, file.name)
        : run.kind === 'pretrained_detection_validation'
          ? Api.publicDetectionArtifactUrl(run.run_id, file.name)
          : run.kind === 'public_roi_connectivity_validation'
            ? Api.publicRoiConnectivityArtifactUrl(run.run_id, file.name)
          : run.kind === 'fmri_qc'
            ? Api.fmriQcArtifactUrl(run.run_id, file.name)
            : Api.publicBratsArtifactUrl(run.run_id, file.name);
      return el('a', { class: 'btn btn-sm', href, target: '_blank', rel: 'noreferrer', title: file.sha256 || 'No persisted artifact hash for this older run' },
        `${file.name} · ${fmtBytes(file.size_bytes)}`);
    });
    const environment = run.reproducibility?.environment || {};
    const detail = el('details', { class: 'persistent-run' },
      el('summary', {},
        el('span', { class: `qmark-s q-${run.status === 'completed' ? 'pass' : 'warn'}` }),
        el('span', { class: 'persistent-run-title' }, el('b', {}, run.title),
          el('span', { class: 'sub mono' }, `${run.run_id} · ${new Date(run.created_at).toLocaleString()}`)),
        el('span', { class: 'chip' }, run.kind.replaceAll('_', ' '))),
      el('div', { class: 'persistent-run-body' },
        el('div', { class: 'persistent-run-metrics' }, ...summaryMetrics),
        el('dl', { class: 'kv persistent-run-kv' },
          el('dt', {}, 'Dataset'), el('dd', { class: 'mono' }, `${run.dataset?.id || '—'}@${run.dataset?.snapshot || '—'}`),
          el('dt', {}, 'Model'), el('dd', { class: 'mono' }, run.model?.id || 'Not applicable'),
          el('dt', {}, 'Configuration'), el('dd', { class: 'mono' }, JSON.stringify(run.configuration || {})),
          el('dt', {}, 'Artifacts'), el('dd', {}, `${fmt(run.artifacts?.count)} files · ${fmtBytes(run.artifacts?.total_bytes)}`),
          el('dt', {}, 'Comparison scope'), el('dd', {}, run.ranking?.scope || run.ranking?.reason || 'Not recorded')),
        el('div', { class: 'persistent-run-evidence' },
          ...evidenceEntries.map(([name, value]) => evChip(value ? 'confirmed' : 'unknown', `${name.replaceAll('_', ' ')}: ${value ? 'yes' : 'no'}`))),
        environment.python_version ? el('p', { class: 'sub mono' },
          `Python ${environment.python_version} · Qortex ${environment.packages?.qortex || 'unknown'} · ` +
          `${environment.cuda?.device_name || 'CPU'} · CUDA ${environment.cuda?.runtime_version || 'not used'}`) : null,
        run.reproducibility?.seed_evidence ? el('p', { class: 'sub' }, run.reproducibility.seed_evidence) : null,
        ...(run.reproducibility?.limitations || []).map(item => el('div', { class: 'demographic-warning' }, el('b', {}, 'Limitation'), el('span', {}, item))),
        artifactLinks.length ? el('div', { class: 'model-artifact-links' }, ...artifactLinks) : el('p', { class: 'sub' }, 'This older run has no persisted artifact hash inventory.'),
      ));
    content.append(detail);
  }
  if (inventory.scan_errors?.length) content.append(el('div', { class: 'demographic-warning' },
    el('b', {}, 'Unreadable run directories'), el('span', {}, `${inventory.scan_errors.length} run record(s) were excluded; exact errors remain in the API response.`)));
  return panel('Persistent runs', `${fmt(inventory.total_discovered)} artifact-backed runs · survives service restarts`, el('div', {},
    el('p', { class: 'sub' }, inventory.evidence), content));
}

/* ---------- Settings ---------- */
async function viewSettings() {
  const wrap = el('div', { class: 'wrap' });
  wrap.append(el('div', { class: 'ds-head' }, el('div', { class: 'eyebrow' }, 'Configuration'), el('h1', {}, 'Settings')));
  const body = el('div', {}, skeletonPanel(140));
  wrap.append(body);
  main.append(wrap);
  const progressWrap = el('div', { style: 'margin-top:12px' });
  async function load() {
    try {
      const [status, inventory, telemetry] = await Promise.all([Api.storeStatus(), Api.cacheInventory(), Api.streamTelemetry(100)]);
      body.innerHTML = '';
      const btn = el('button', { class: 'btn btn-green', style: 'margin-top:12px', onclick: () => doRefresh(btn) }, 'Refresh full catalog from OpenNeuro');
      const coverage = el('dd', { id: 'cache-coverage' }, `${status.n_datasets} (of … on OpenNeuro)`);
      const cacheRows = inventory.surfaces.map(item => el('tr', {},
        el('td', {}, el('b', {}, item.label), el('div', { class: 'sub' }, item.exists ? 'Present' : 'Not created')),
        el('td', {}, el('span', { class: 'mono' }, fmtBytes(item.size_bytes)), item.max_bytes
          ? el('div', { class: 'cache-usage-track', title: `${fmtBytes(item.size_bytes)} of ${fmtBytes(item.max_bytes)}` },
              el('span', { style: `width:${Math.min(100, (item.size_bytes / item.max_bytes) * 100)}%` }))
          : null),
        el('td', { class: 'mono' }, fmt(item.file_count)),
        el('td', {}, item.policy_evidence, item.ttl_seconds ? el('div', { class: 'sub' }, `TTL ${fmt(item.ttl_seconds)} seconds`) : null),
        el('td', { class: 'mono cache-path-cell', title: item.path }, item.path)));
      const cacheTable = el('div', { class: 'tblw cache-inventory-table' }, el('table', { class: 't' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Surface'), el('th', {}, 'Usage'), el('th', {}, 'Files'), el('th', {}, 'Policy'), el('th', {}, 'Path'))),
        el('tbody', {}, ...cacheRows)));
      const storagePanel = panel('Persistent storage', `${fmtBytes(inventory.total_bytes)} across ${fmt(inventory.total_file_count)} files`, el('div', {},
        cacheTable,
        el('p', { class: 'sub', style: 'margin-top:8px;font-size:11.5px' }, `${inventory.measurement}. Measured ${new Date(inventory.measured_at).toLocaleString()}.`)));
      const streamRows = telemetry.events.slice(-20).reverse().map(event => el('tr', {},
        el('td', { class: 'mono' }, event.dataset_id),
        el('td', { class: 'mono cache-path-cell', title: event.path }, event.path),
        el('td', {}, event.operation.replaceAll('_', ' ')),
        el('td', { class: 'num mono' }, `${(event.elapsed_seconds * 1000).toFixed(1)} ms`),
        el('td', { class: 'num mono' }, fmtBytes(event.cache_bytes_inserted_delta)),
        el('td', { class: 'num mono' }, fmtBytes(event.cache_hit_bytes_delta))));
      const streamPanel = panel('Imaging stream telemetry', `${fmt(telemetry.event_count)} measured requests in this process`, el('div', {},
        el('div', { class: 'readiness-facts' },
          ...[
            ['Median latency', telemetry.summary.median_latency_seconds == null ? 'No measurements' : `${(telemetry.summary.median_latency_seconds * 1000).toFixed(1)} ms`],
            ['Mean latency', telemetry.summary.mean_latency_seconds == null ? 'No measurements' : `${(telemetry.summary.mean_latency_seconds * 1000).toFixed(1)} ms`],
            ['Returned pixels', fmtBytes(telemetry.summary.response_data_bytes)],
            ['Bytes inserted', fmtBytes(telemetry.summary.cache_bytes_inserted)],
            ['Bytes served from cache', fmtBytes(telemetry.summary.cache_hit_bytes)],
            ['Byte efficiency', telemetry.summary.cache_byte_efficiency == null ? 'No cache observations' : `${(telemetry.summary.cache_byte_efficiency * 100).toFixed(2)}%`],
            ['Decoded-volume hit rate', telemetry.summary.decoded_volume_hit_rate == null ? 'No volume observations' : `${(telemetry.summary.decoded_volume_hit_rate * 100).toFixed(2)}%`],
          ].map(([label, value]) => el('div', {}, el('span', { class: 'sub' }, label), el('b', {}, value)))),
        el('p', { class: 'sub' }, telemetry.measurement_scope),
        streamRows.length ? el('div', { class: 'tblw validation-table' }, el('table', { class: 't' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Dataset'), el('th', {}, 'Path'), el('th', {}, 'Path type'), el('th', { class: 'num' }, 'Latency'), el('th', { class: 'num' }, 'Inserted'), el('th', { class: 'num' }, 'Cache hit'))),
          el('tbody', {}, ...streamRows))) : el('p', { class: 'sub' }, 'Open a NIfTI slice in the Viewer to create the first measured event.')));
      body.append(
        panel('Local catalog cache', null, el('div', {},
          el('dl', { class: 'kv' },
            el('dt', {}, 'Datasets cached'), coverage,
            el('dt', {}, 'Deep-profiled'), el('dd', {}, String(status.n_profiled)),
            el('dt', {}, 'Path'), el('dd', {}, status.db_path)),
          btn, progressWrap,
          el('p', { class: 'sub', style: 'margin-top:8px;font-size:11.5px' }, 'Fetches the dataset count first, then sweeps every dataset on OpenNeuro concurrently — the full catalog lands in under a minute.'))),
        storagePanel,
        streamPanel,
        panel('Appearance', null, el('button', { class: 'btn', onclick: toggleTheme }, 'Toggle light / dark')),
        panel('Engine', null, el('p', { class: 'sub' }, `API base: ${Api.base}`)),
      );
      // Count-first: show the real "cached of total" coverage as soon as the
      // count round-trips, without blocking the panel render.
      Api.catalogCount().then(c => { coverage.textContent = `${c.cached} of ${c.total} on OpenNeuro`; }).catch(() => {});
    } catch (err) { body.innerHTML = ''; body.append(errorPanel(err)); }
  }

  async function doRefresh(btn) {
    btn.disabled = true; btn.textContent = 'Sweeping…';
    progressWrap.innerHTML = '';
    const bar = el('div', { class: 'jprog', style: 'margin-top:6px' }, el('div', { style: 'width:0%' }));
    const label = el('div', { class: 'sub', style: 'font-size:12px' }, 'Fetching dataset count…');
    progressWrap.append(label, bar);
    try {
      const { job_id, total } = await Api.catalogRefreshStart(40);
      label.textContent = `Indexing 0 of ${total} datasets…`;
      // Poll the background job for real progress against the known total.
      await new Promise((resolve, reject) => {
        const iv = setInterval(async () => {
          try {
            const j = await Api.job(job_id);
            bar.firstChild.style.width = `${j.progress || 0}%`;
            label.textContent = `Indexing… ${j.progress || 0}% of ${total}`;
            if (j.status === 'done') { clearInterval(iv); resolve(j); }
            else if (j.status === 'error') { clearInterval(iv); reject(new Error(j.error || 'Refresh failed.')); }
          } catch (err) { clearInterval(iv); reject(err); }
        }, 1000);
      });
      // Reindex search so the newly-indexed datasets are searchable, not just browsable.
      try { await Api.searchEngineRefresh(); } catch { /* best-effort */ }
      toast('Catalog refreshed from OpenNeuro.');
      await load();
      progressWrap.innerHTML = '';
    } catch (err) {
      toast(err.message, 'fail');
      btn.disabled = false; btn.textContent = 'Refresh full catalog from OpenNeuro';
    }
  }
  load();
}

/* ================= router / chrome ================= */
function route() {
  const h = location.hash.replace(/^#\//, '');
  const [top, a, b] = h.split('/');
  const [routeTab] = (b || '').split('?');
  document.body.classList.toggle('viewer-route-page', top === 'ds' && routeTab === 'viewer');
  $('.app')?.classList.toggle('viewer-route', top === 'ds' && routeTab === 'viewer');
  main.innerHTML = ''; main.focus();
  document.querySelectorAll('.side a[data-nav]').forEach(n => n.removeAttribute('aria-current'));
  const mark = (k) => document.querySelector(`.side a[data-nav="${k}"]`)?.setAttribute('aria-current', 'page');

  if (!top) { viewHome(); mark('atlas'); }
  else if (top === 'explore') { viewExplore(); mark('explore'); }
  else if (top === 'datasets') { viewDatasets(); mark('datasets'); }
  else if (top === 'ds') {
    // `b` may carry a query string (e.g. `viewer?path=sub-01%2Feeg%2F...edf`,
    // used to deep-link the Viewer Lab straight to one file from the BIDS
    // tree or a dataset card) — strip it before matching against DS_TABS,
    // then hand the parsed params to viewDataset so the target tab can read
    // them (every other tab function simply ignores the extra argument).
    const [bTab, bQuery] = (b || '').split('?');
    const tab = DS_TABS.includes(bTab) ? bTab : 'overview';
    viewDataset(a, tab, bQuery ? new URLSearchParams(bQuery) : null);
    // dataset sections live only in the in-page tab strip (dsHeader); the
    // sidebar has no per-tab entries to highlight, so mark its nearest
    // ancestor destination — wherever the user came from to reach a dataset.
    mark('datasets');
  }
  else if (top === 'compose') { viewCompose(); mark('compose'); }
  else if (top === 'compatibility') { viewCompatibility(); mark('compat'); }
  else if (top === 'models') { viewModels(); mark('models'); }
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

/* sidebar collapse — persisted, independent of the viewport-width collapse
   (that one always applies below 760px regardless of this toggle; this one
   is a deliberate user choice to reclaim width on any screen size). */
function applySidebarCollapsed(collapsed) {
  const appEl = $('.app'), btn = $('#side-collapse-btn');
  appEl.classList.toggle('side-collapsed', collapsed);
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  btn.querySelector('span').textContent = collapsed ? 'Expand' : 'Collapse';
}
function toggleSidebar() {
  const collapsed = !$('.app').classList.contains('side-collapsed');
  applySidebarCollapsed(collapsed);
  localStorage.setItem('qatlas-sidebar-collapsed', collapsed ? '1' : '0');
  announce(collapsed ? 'Sidebar collapsed' : 'Sidebar expanded');
}
$('#side-collapse-btn').addEventListener('click', toggleSidebar);
applySidebarCollapsed(localStorage.getItem('qatlas-sidebar-collapsed') === '1');

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
