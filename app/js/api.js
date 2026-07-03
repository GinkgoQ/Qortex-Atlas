/* api.js — thin fetch client for the real Qortex Atlas backend
   (src/qortex/console/api.py, a FastAPI service wrapping the live Qortex
   library and the live OpenNeuro GraphQL/CDN endpoints). No mock data lives
   behind this module — every call here is a real network round trip to
   either the local Qortex process or, transitively, OpenNeuro itself. */

const BASE = window.QORTEX_API_BASE || 'http://127.0.0.1:8420';

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; this.name = 'ApiError'; }
}

async function req(path, opts = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opts,
    });
  } catch (err) {
    throw new ApiError(`Cannot reach Qortex Atlas backend at ${BASE} — is it running? (${err.message})`, 0);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
    throw new ApiError(detail, res.status);
  }
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? res.json() : res;
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const Api = {
  base: BASE,
  ApiError,

  health: () => req('/health'),
  storeStatus: () => req('/store/status'),
  timingEstimate: (operation, key) => req(`/timing/estimate${qs({ operation, key })}`),

  catalogSearch: (params) => req(`/catalog/search${qs(params)}`),
  catalogFacets: (limit) => req(`/catalog/facets${qs({ limit })}`),
  catalogGet: (id) => req(`/catalog/${id}`),
  catalogRefresh: (maxPages) => req(`/catalog/refresh${qs({ max_pages: maxPages })}`, { method: 'POST' }),
  catalogRefreshDataset: (id, deep = true) => req(`/catalog/refresh/${id}${qs({ deep })}`, { method: 'POST' }),

  searchHybrid: (params) => req(`/search/hybrid${qs(params)}`),

  goalFind: (body) => req('/goal/find', { method: 'POST', body: JSON.stringify(body) }),

  profile: (id, { snapshot, level = 'summary' } = {}) => req(`/dataset/${id}/profile${qs({ snapshot, level })}`),
  manifest: (id, { snapshot, subject, modality, task, limit, offset } = {}) =>
    req(`/dataset/${id}/manifest${qs({ snapshot, subject, modality, task, limit, offset })}`),
  readiness: (id, snapshot) => req(`/dataset/${id}/readiness${qs({ snapshot })}`),
  doctor: (id, snapshot) => req(`/dataset/${id}/doctor${qs({ snapshot })}`),
  labelLandscape: (id, { snapshot, maxEventsFiles } = {}) =>
    req(`/dataset/${id}/label-landscape${qs({ snapshot, max_events_files: maxEventsFiles })}`),
  signalBudget: (id, snapshot) => req(`/dataset/${id}/signal-budget${qs({ snapshot })}`),
  participants: (id, snapshot) => req(`/dataset/${id}/participants${qs({ snapshot })}`),
  events: (id, params) => req(`/dataset/${id}/events${qs(params)}`),
  preview: (id, { path, snapshot }) => req(`/dataset/${id}/preview${qs({ path, snapshot })}`),
  sidecar: (id, { path, snapshot }) => req(`/dataset/${id}/sidecar${qs({ path, snapshot })}`),
  niftiInfo: (id, { path, snapshot }) => req(`/dataset/${id}/nifti-info${qs({ path, snapshot })}`),
  niftiSliceUrl: (id, params) => `${BASE}/dataset/${id}/nifti-slice.png${qs(params)}`,
  eegPreview: (id, params) => req(`/dataset/${id}/eeg-preview${qs(params)}`),

  plan: (id, body, snapshot) => req(`/dataset/${id}/plan${qs({ snapshot })}`, { method: 'POST', body: JSON.stringify(body) }),
  download: (id, body, snapshot) => req(`/dataset/${id}/download${qs({ snapshot })}`, { method: 'POST', body: JSON.stringify(body) }),
  contentStatus: (id, params) => req(`/dataset/${id}/content-status${qs(params)}`),
  compatibility: (id, params) => req(`/dataset/${id}/compatibility${qs(params)}`),
  compare: (idA, idB, params) => req(`/dataset/${idA}/compare/${idB}${qs(params)}`),

  models: () => req('/models'),
  cohortCompose: (body) => req('/cohort/compose', { method: 'POST', body: JSON.stringify(body) }),

  jobs: () => req('/jobs'),
  job: (id) => req(`/jobs/${id}`),
};
