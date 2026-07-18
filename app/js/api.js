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
  cacheInventory: () => req('/cache/inventory'),
  streamTelemetry: (limit = 100) => req(`/stream/telemetry${qs({ limit })}`),
  timingEstimate: (operation, key) => req(`/timing/estimate${qs({ operation, key })}`),

  catalogSearch: (params) => req(`/catalog/search${qs(params)}`),
  catalogFacets: (limit) => req(`/catalog/facets${qs({ limit })}`),
  catalogGet: (id) => req(`/catalog/${id}`),
  // { total: datasets on OpenNeuro, cached: datasets in the local catalog }
  catalogCount: () => req('/catalog/count'),
  catalogRefresh: (maxPages) => req(`/catalog/refresh${qs({ max_pages: maxPages })}`, { method: 'POST' }),
  // Count-first background sweep: returns { job_id, total }; poll Api.job(id).
  catalogRefreshStart: (maxPages) => req(`/catalog/refresh/start${qs({ max_pages: maxPages })}`, { method: 'POST' }),
  catalogRefreshDataset: (id, deep = true) => req(`/catalog/refresh/${id}${qs({ deep })}`, { method: 'POST' }),

  searchHybrid: (params) => req(`/search/hybrid${qs(params)}`),
  // The real multi-method engine: query compiler -> {structured, BM25 lexical,
  // semantic/LSA} retrievers -> Reciprocal Rank Fusion -> optional
  // DatasetFitness structural re-rank -> evidence-partitioned filtering ->
  // negative-space diagnosis. `include_live: true` additionally appends live
  // OpenNeuro results not yet in the local catalog (tagged `_source:'live'`,
  // never blended into the local engine's ranked `results`) — see
  // `_fetch_live_supplement` server-side.
  searchEngine: (params) => req(`/search/engine${qs(params)}`),
  searchEngineRefresh: () => req('/search/engine/refresh', { method: 'POST' }),

  goalFind: (body) => req('/goal/find', { method: 'POST', body: JSON.stringify(body) }),

  profile: (id, { snapshot, level = 'summary' } = {}) => req(`/dataset/${id}/profile${qs({ snapshot, level })}`),
  manifest: (id, { snapshot, subject, modality, task, limit, offset } = {}) =>
    req(`/dataset/${id}/manifest${qs({ snapshot, subject, modality, task, limit, offset })}`),
  readiness: (id, snapshot, params = {}) => req(`/dataset/${id}/readiness${qs({ snapshot, ...params })}`),
  doctor: (id, snapshot) => req(`/dataset/${id}/doctor${qs({ snapshot })}`),
  validation: (id, snapshot) => req(`/dataset/${id}/validation${qs({ snapshot })}`),
  startLocalValidation: (id, snapshot) => req(`/dataset/${id}/validation/local/start${qs({ snapshot })}`, { method: 'POST' }),
  localValidationArtifactUrl: (id, snapshot, runId, artifact) =>
    `${BASE}/dataset/${encodeURIComponent(id)}/validation/local/runs/${encodeURIComponent(snapshot)}/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact)}`,
  labelLandscape: (id, { snapshot, maxEventsFiles } = {}) =>
    req(`/dataset/${id}/label-landscape${qs({ snapshot, max_events_files: maxEventsFiles })}`),
  signalBudget: (id, snapshot) => req(`/dataset/${id}/signal-budget${qs({ snapshot })}`),
  participants: (id, snapshot) => req(`/dataset/${id}/participants${qs({ snapshot })}`),
  coverage: (id, { snapshot, offset, limit } = {}) => req(`/dataset/${id}/coverage${qs({ snapshot, offset, limit })}`),
  fmriQc: (id, params = {}) => req(`/dataset/${id}/fmri-qc${qs(params)}`),
  signalAnalysis: (id, params = {}) => req(`/dataset/${id}/signal-analysis${qs(params)}`),
  events: (id, params) => req(`/dataset/${id}/events${qs(params)}`),
  preview: (id, { path, snapshot }) => req(`/dataset/${id}/preview${qs({ path, snapshot })}`),
  sidecar: (id, { path, snapshot }) => req(`/dataset/${id}/sidecar${qs({ path, snapshot })}`),
  niftiInfo: (id, { path, snapshot }) => req(`/dataset/${id}/nifti-info${qs({ path, snapshot })}`),
  niftiSliceUrl: (id, params) => `${BASE}/dataset/${id}/nifti-slice.png${qs(params)}`,
  // Raw calibrated float32 slice + auto-window + every applicable clinical
  // preset, base64-encoded — for the Viewer Lab's client-side windowing
  // (drag-to-adjust contrast with zero network round trips per adjustment).
  niftiSliceData: (id, params) => req(`/dataset/${id}/nifti-slice-data${qs(params)}`),
  // A real MIP/MinIP/mean projection through the whole volume along one
  // axis — same response shape as niftiSliceData, always the slow (whole-
  // volume) path server-side.
  niftiProjectionData: (id, params) => req(`/dataset/${id}/nifti-projection-data${qs(params)}`),
  // (256,3) uint8 LUTs for gray/hot/plasma/RdBu_r, fetched once and cached —
  // see js/app.js's getLuts().
  colormaps: () => req('/colormaps'),
  eegPreview: (id, params) => req(`/dataset/${id}/eeg-preview${qs(params)}`),

  plan: (id, body, snapshot) => req(`/dataset/${id}/plan${qs({ snapshot })}`, { method: 'POST', body: JSON.stringify(body) }),
  download: (id, body, snapshot) => req(`/dataset/${id}/download${qs({ snapshot })}`, { method: 'POST', body: JSON.stringify(body) }),
  conversionOptions: (id, snapshot) => req(`/dataset/${id}/conversion/options${qs({ snapshot })}`),
  startConversion: (id, body, snapshot) => req(`/dataset/${id}/conversion/start${qs({ snapshot })}`, { method: 'POST', body: JSON.stringify(body) }),
  conversionArtifactUrl: (id, snapshot, runId, artifactPath) => {
    const encodedPath = String(artifactPath).split('/').map(encodeURIComponent).join('/');
    return `${BASE}/dataset/${encodeURIComponent(id)}/conversion/runs/${encodeURIComponent(snapshot)}/${encodeURIComponent(runId)}/artifacts/${encodedPath}`;
  },
  contentStatus: (id, params) => req(`/dataset/${id}/content-status${qs(params)}`),
  compatibility: (id, params) => req(`/dataset/${id}/compatibility${qs(params)}`),
  compare: (idA, idB, params) => req(`/dataset/${idA}/compare/${idB}${qs(params)}`),

  models: () => req('/models'),
  modelStatus: () => req('/models/status'),
  modelExecutionProfiles: () => req('/models/execution-profiles'),
  executeModelProfile: (profileId, parameters = {}) => req('/models/execute-public', {
    method: 'POST', body: JSON.stringify({ profile_id: profileId, parameters }),
  }),
  modelCacheInventory: () => req('/models/cache'),
  removeModelCache: (id, confirmationSha256) => req(`/models/cache/${encodeURIComponent(id)}`, {
    method: 'DELETE', body: JSON.stringify({ confirmation_sha256: confirmationSha256 }),
  }),
  validatePublicBrats: (body = {}) => req('/models/brats/validate-public', { method: 'POST', body: JSON.stringify(body) }),
  publicBratsRun: (id) => req(`/models/brats/runs/${encodeURIComponent(id)}`),
  publicBratsArtifactUrl: (id, artifact) => `${BASE}/models/brats/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact)}`,
  validatePublicDetection: (body = {}) => req('/models/detection/validate-public', { method: 'POST', body: JSON.stringify(body) }),
  publicDetectionRun: (id) => req(`/models/detection/runs/${encodeURIComponent(id)}`),
  publicDetectionArtifactUrl: (id, artifact) => `${BASE}/models/detection/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact)}`,
  cohortCompose: (body) => req('/cohort/compose', { method: 'POST', body: JSON.stringify(body) }),
  cohortCompareParticipants: (body) => req('/cohort/compare-participants', { method: 'POST', body: JSON.stringify(body) }),

  persistentRuns: (limit = 100) => req(`/runs/persistent${qs({ limit })}`),
  jobs: () => req('/jobs'),
  job: (id) => req(`/jobs/${id}`),
};
