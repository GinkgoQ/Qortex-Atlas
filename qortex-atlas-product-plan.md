# Qortex Atlas — UI Product Plan

> Scope note: This document is a plan for the **Qortex Atlas user interface only**.
> Atlas UI renders and orchestrates capabilities that already exist (or are planned) in the Qortex Python engine.
> It computes nothing scientific itself. Every number, score, and evidence state shown in the UI is produced by
> the engine (`qortex.*` modules) and surfaced with its provenance intact.
>
> Grounding: engine capabilities referenced here were verified against the Qortex source tree
> (`DatasetFitness`, `CanTrainReport`, `DatasetCard`, `CompatibilityEngine`, `CompatibilityReport`,
> `CohortBuilder`, `ContentStatusReport`, `ReadinessReport`-family checkers, `DownloadPlan`/`SelectionReason`,
> `LogicalRecording`/`CompanionSet`/`FileRecord`/`BIDSEntities`, and the `harmonize`, `qc`, `eda`, `visualize`,
> `train`, `export`, `lake`, `neuroai` packages). Items not yet in the engine are marked **Needs validation**
> or **Engine dependency**.

---

## 1. Product Definition

### Product name
**Qortex Atlas** (working UI name: "Atlas Workbench")

### One-line description
A local-first, evidence-first workbench UI for deciding whether OpenNeuro/BIDS datasets can support a research
or ML goal — before, during, and after download.

### Core value proposition
Atlas turns the Qortex engine's decision outputs (readiness, labels, download plans, compatibility, cohorts)
into an interactive surface where users can **see the evidence, understand the uncertainty, and act** — without
writing glue code, and without downloading 300 GB to find out a dataset is unusable.

The differentiating UI mechanic is the **evidence state system**: every fact on screen is visibly tagged
`confirmed` / `inferred` / `unknown` / `blocked`, and every score decomposes into its dimensions on click.
No other tool in this space renders uncertainty as a first-class UI primitive.

### What it is
- A local web application launched by the engine (`qortex atlas ui`), served against the local Atlas store
  and the OpenNeuro API through the engine — the UI never calls OpenNeuro directly.
- A **decision workbench**: goal → candidates → evidence → plan → action → artifact.
- A rendering layer for engine reports: readiness, can-train, labels, compatibility, QC, diffs, cohorts.
- A job console for long-running engine operations (refresh, download, conversion) with live progress.

### What it is not
- Not a replacement for OpenNeuro's website, the BIDS Validator, or DataLad.
- Not a generic BI dashboard, a static docs site, or a plain file browser.
- Not a neuroimaging viewer competing with napari/FSLeyes — visualization is limited to what the engine
  already produces (thumbnails, QC summaries, coverage matrices, signal plots).
- Not a cloud service, account system, or multi-tenant platform (in MVP–V1).
- Not an analysis environment — it plans and verifies; it does not run statistics or train models
  (it can *launch* engine smoke-training and show the result).

### Primary users
1. Medical AI / ML researchers selecting training data (primary)
2. Neuroscience researchers evaluating datasets for reuse (primary)
3. ML engineers / data scientists building pipelines (primary)
4. Dataset curators and BIDS power users (secondary)
5. Students exploring neurodata (secondary)

### Primary use cases
1. "Can I use this dataset for my goal?" — evidence-backed go/no-go before download.
2. "What is the smallest useful download?" — minimum download planning with per-file reasons.
3. "Does it actually have labels?" — label intelligence with candidate vs confirmed states.
4. "Which of these 5 datasets is best?" — side-by-side comparison against a goal.
5. "Can these datasets be combined?" — cohort/benchmark composition with harmonization plan.
6. "Which datasets can run with this model?" — NeuroAI contract compatibility.
7. "What is running, what failed, and can I resume?" — job console for refresh/download/convert.
8. "Can I reproduce this later?" — recipe/lockfile export from any completed plan.

---

## 2. Product Positioning

### Competitive and analogous landscape

| Product | Core contribution | IA / UX pattern worth learning | Limitation Atlas addresses |
|---|---|---|---|
| **OpenNeuro** | Canonical archive + versioned snapshots | Dataset page = README + file tree + metadata sidebar | Search is filter-only; no readiness, no labels, no download planning; file tree is flat, not semantic |
| **BIDS Validator** | Compliance checking | Severity-grouped issue list with file counts | Validity ≠ loadability ≠ ML-readiness; no goal context; all-or-nothing validation |
| **PyBIDS** | Programmatic BIDS querying (entities, inheritance) | Entity-based query model | Library only; no decision layer; local files required |
| **MNE-BIDS / NiBabel / Nilearn** | Domain loading & analysis | Gallery-driven docs (Nilearn examples are the gold standard for "show, don't tell") | Assume data is already local and chosen |
| **MONAI / TorchIO / ANTsPy / SimpleITK** | Medical imaging ML transforms/pipelines | Transform-chain composition as a mental model | No dataset discovery/selection; user must already have data |
| **DataLad** | Versioned, partial retrieval | `get` only what you need | CLI-expert tool; pointer files confuse users; no readiness semantics |
| **DVC** | Data versioning + pipeline DAGs | Lockfiles as reproducibility contract | Generic; no domain semantics |
| **Hugging Face Datasets** | Dataset hub UX benchmark | Dataset card + instant preview + "use this dataset" code snippet + size/split table | No BIDS semantics, no evidence states, previews assume tabular/text |
| **Kaggle Datasets** | Discoverability + community signal | Usability score on every dataset (single 0–10 number) | Score is opaque; no decomposition; wrong domain |
| **Weights & Biases** | Run/experiment tracking | Run table + compare view + live job logs; artifact lineage graphs | Post-hoc tracking; nothing pre-download |
| **napari** | N-D image viewing | Layer model, plugin surface | Viewer, not decision tool; local data only |
| **scikit-learn docs** | Teaching through