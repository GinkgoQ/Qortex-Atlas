# Qortex Atlas — UI

An evidence-first decision workbench for OpenNeuro/BIDS datasets. **This build
is fully real.** There is no mock data anywhere: the frontend calls a FastAPI
service (`src/qortex/console/api.py` in the Qortex repo) that wraps genuine,
unmodified Qortex library calls against the live OpenNeuro GraphQL API and CDN.
Search results, readiness scores, class-balance charts, brain-slice images,
and EEG waveforms are all computed from live network calls at request time.

## Run

Two processes, no build step.

```bash
# 1. Backend — real Qortex + OpenNeuro, from the Qortex repo root
pip install -e ".[dashboard]"
uvicorn qortex.console.api:app --port 8420

# 2. Frontend — plain static files, from this directory
python3 -m http.server 8317
# open http://localhost:8317
```

The frontend defaults to `http://127.0.0.1:8420` for the API (override via
`window.QORTEX_API_BASE` before `js/main.js` loads).

First time: open **Settings** and click "Refresh catalog" to seed the local
DuckDB cache with real OpenNeuro metadata — Explore's facet search and Atlas
Map read from this cache. Opening any dataset workspace by ID always works
even before refreshing, since it fetches live from OpenNeuro directly.

## What's inside

| Area | What it does |
|---|---|
| **Home** | Real local-catalog cache stats, recent jobs, first-run orientation |
| **Explore** | Facet search over local cache + live OpenNeuro (`/search/hybrid`, tagged by source) and a **Goal Builder** that ranks real candidates via Qortex's `DatasetSelector` (live OpenNeuro API scoring, `j`/`k`/`p` keyboard triage) |
| **Atlas Map** | Real cached datasets clustered by modality; node size = real subject counts. No relationship-graph edges — Qortex doesn't compute dataset similarity yet, and faking one would violate the evidence-first principle |
| **Dataset Workspace** | 7 tabs, all backed by real Qortex calls |
| ↳ Overview | Real `MLReadinessScore` decomposition (events/subjects/license/modality/structure/companion), evidence-completeness meter from a real readiness+can-train pass, "Copy methods rationale" |
| ↳ Evidence | Claims normalized from real `ReadinessReport.findings` + `CanTrainReport.label_status` into one confirmed/inferred/unknown/blocked vocabulary (`atlas_evidence.py` bridges Qortex's three separate evidence enums) |
| ↳ Files & Metadata | Real file manifest; click any file for a **real** format-aware preview — TSV/JSON via `Dataset.preview()`, NIfTI header + an actual streamed axial slice image (byte-range only, zero full-file downloads), EEG/MEG epochs decoded from EDF/BDF via HTTP range requests |
| ↳ QC & Summaries | Real class-balance chart from `Dataset.label_landscape()` (remote events scan) and real signal-hours budget from `Dataset.signal_budget()` |
| ↳ Plan | Real `DownloadPlan` (dry-run) with genuine per-file `SelectionReason`s and the exact `qortex download` command |
| ↳ Compatibility | Real `CompatibilityEngine.check()` against a curated model-contract catalog, `SourceProfile` built from a remote signal-budget scan |
| **Compare** | Real profiles fetched live per pinned dataset |
| **Compose** | Real `CohortBuilder` — subject-level filters, harmonization check, live manifests |
| **Plans & Runs** | Real background jobs (downloads run via a thread-pool job registry, pollable) |

## Design system

GinkgoQ brand (`~/project/design_system.md`): ginkgo green `#79863c` as the
only accent, green `Q` wordmark, Inter + IBM Plex Mono, the exact GinkgoQ
light/dark surface stacks, 2px solid green focus rings. Chart palettes
re-validated against these surfaces with the dataviz six-checks validator —
categorical series pass both modes; a brand-green ordinal ramp for magnitude
bars, validated light (`#a6b566→#55612a`) and dark (`#515c25→#b8c778`).
Evidence badges are icon + text everywhere, never color alone.

## Real bugs found and fixed in Qortex itself while building this

1. **`DatasetInspector.inspect(level="summary")`** constructed `SnapshotRef`
   without `dataset_id`, raising a Pydantic validation error on every call
   (`src/qortex/inspect/dataset.py`).
2. **`NiftiStreamer` never applied `scl_slope`/`scl_inter`** — any NIfTI file
   using scanner intensity calibration (common) streamed meaningless raw
   integers instead of calibrated values. Added header parsing + application
   in `get_volume`/`get_slice`/`prefetch_slabs` (`src/qortex/stream/nifti.py`).
   Verified against nibabel ground truth (exact match, <1e-4 diff).
3. **`NiftiStreamer` reshaped voxel data in C order**, but NIfTI stores data
   Fortran-order — every streamed slice/volume was transposed/scrambled.
   Fixed all three decode sites to `reshape(..., order="F")`.
4. **`DatasetSelector.find()`'s `catalog_limit=200` default** made
   interactive goal-ranking take minutes (one live API call per candidate);
   Atlas defaults it to 20 for interactive use.
5. **`live_search()`'s `limit` bounds nodes scanned, not matches returned** —
   documented and worked around in `/search/hybrid` with a wider scan pool
   when a modality/task filter is active.
6. **`Dataset._resolve_modality_url()` didn't filter out sidecar extensions**
   (`.json`/`.tsv`/`.bval`/`.bvec`) — since a `.json` sidecar shares its data
   file's BIDS suffix, `stream_slice()`/`stream_header()` could silently
   resolve to the *metadata* file instead of the image, feeding garbage bytes
   into the NIfTI parser (`src/qortex/__init__.py`).
7. **`NiftiStreamer`'s NIfTI-1 magic-number check used `or` instead of
   `and`** (`is_nifti1 or len(raw) >= _NIFTI1_HDR_SIZE`) — any ≥348-byte
   buffer was accepted as a valid NIfTI-1 header regardless of whether the
   magic bytes actually matched, compounding bug #6 into a confident-looking
   but completely fabricated header (`src/qortex/stream/nifti.py`).
8. **`ModalityBreakdown` dataclass had no defaults for `n_files`/`total_bytes`**
   while the accumulator that builds it does `mb.n_files += 1` immediately
   after construction — `DatasetInspector.inspect(level="manifest"|"deep")`
   raised `TypeError` on every real dataset (`src/qortex/inspect/dataset.py`).
9. **`SidecarResolver` only reasoned about sub/ses/task/run** — any other BIDS
   entity (`acq-`, `dir-`, `echo-`, `part-`, `ce-`, `rec-` — extremely common
   for anatomical scans) meant `sidecar()` silently returned `{}` even when a
   matching JSON sidecar existed right next to the data file. Added entity-
   derived candidates from the data file's own filename (`src/qortex/manifest/sidecar.py`).
10. **`CohortBuilder._check_modality_requirements` passed `sub-`-prefixed
    subject IDs into `Manifest.filter(subjects=...)`**, which matches bare
    IDs — every subject failed every modality check, so `Compose` silently
    returned **zero subjects** for every real dataset whenever a modality
    filter was set. The outer loop then *discarded* the real per-subject
    exclusion reason and replaced it with a generic, misleading
    `"below_min_subjects"` (`src/qortex/cohort/builder.py`, two bugs).
11. **`CatalogIndex.upsert()` committed after every single row**, and
    **`CatalogIndex.search()` fetched `file_summaries` (a separate SQL query)
    for every candidate row before scoring/sorting**, not just the returned
    page — a classic N+1 pattern. A 25-result live search took ~12–23s; an
    unfiltered 200-row local search took **~24 seconds**. Batched commits in
    `upsert_many` and deferred `file_summaries` to only the final paginated
    rows (`src/qortex/catalog/index.py`) — **~24s → ~0.46s** on the local
    search path, confirmed by direct timing before/after.

Frontend: the shared chart-tooltip singleton lived outside the router's
`#main` container and was never hidden on navigation, so a tooltip from one
page (e.g. a hovered class-balance bar) could persist, stale, into an
unrelated page. Fixed by hiding it on every route change (`js/main.js`).

Backend also adds two short-TTL in-process caches (manifest + profile) since
the workspace re-requests the same dataset's file tree on every tab
navigation — repeat visits to a large dataset went from ~30s to ~2s. The
`/search/hybrid` endpoint also stopped syncing live results into the local
catalog on every keystroke (`sync_local=False`) — that sync is now purely
the deliberate, explicit "Refresh catalog" action in Settings.

## Verified

Driven end-to-end with Playwright against the real backend and live OpenNeuro
API: search, goal ranking, all 7 workspace tabs on real datasets (ds000117,
ds000001, ds002718), real file previews including a genuine streamed brain
slice and decoded EEG waveform, Compose, Compatibility, Atlas Map — zero
console errors on the final run.
