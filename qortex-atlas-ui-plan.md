# Qortex Atlas — UI Product Plan

> Scope note (governing constraint): **This document specifies a user interface only.**
> Qortex Atlas performs no science. It does not compute readiness, parse BIDS, score fitness,
> process signals, or interpret data. All of that lives in the Qortex Python engine.
> Atlas is the presentation, navigation, and decision layer that renders engine outputs
> (reports, scores, plans, manifests, statuses) and dispatches engine commands.
> Wherever a neuroscience term appears below, it is **display data**, not work Atlas does.

Legend used throughout:
- **[Confirmed]** — backed by an existing Qortex engine class/module verified in the codebase
  (`ReadinessReport`, `DatasetCard`, `DatasetFitness`, `DownloadPlan`, `CompatibilityEngine`,
  `CanTrainReport`, `ContentStatusReport`, `CohortBuilder`, `harmonize`, `qc`, `eda`, `visualize`, `neuroai`).
- **[Assumption]** — reasonable but unverified about users or engine behavior.
- **[Needs validation]** — must be tested with users or against the engine before committing.

---

## 1. Product Definition

**Product name:** Qortex Atlas

**One-line description:**
A local-first decision workbench UI that turns Qortex engine reports into evidence-backed
answers to "can I use this dataset, what do I download, and what will fail?"

**Core value proposition:**
Every other tool in this space gives users *data about datasets*. Atlas gives users
*decisions with visible evidence*: ranked candidates, explained scores, minimum download
plans, and compatibility verdicts — each value labeled confirmed / inferred / unknown /
blocked, straight from the engine's evidence model. **[Confirmed]** (evidence states exist
in Qortex readiness reports).

**What it is:**
- A UI shell over the Qortex library: it calls engine APIs, renders their typed outputs,
  and composes them into task-oriented screens.
- A goal-driven workbench: the primary object is the user's *goal* (train, inspect,
  download, reproduce), not the file tree.
- An evidence display system: uncertainty is a first-class UI primitive, not a footnote.
- A plan composer: it assembles engine-produced plans (download, conversion, cohort,
  benchmark) and exports them as runnable artifacts (recipe YAML, lockfiles, CLI commands).
- Local-first: runs against the user's local Atlas store/cache; no account, no cloud
  dependency for core flows. **[Assumption — deployment model; needs validation]**

**What it is not:**
- Not a medical image / signal viewer (no napari/OHIF competitor; it shows engine-generated
  thumbnails and QC summaries only).
- Not a data archive or hosting platform (OpenNeuro owns that).
- Not a validator (BIDS Validator owns spec compliance; Atlas *displays* validation output).
- Not a pipeline orchestrator (no DAG editor; it exports plans that run via `qortex` CLI/Python).
- Not a documentation site, generic dashboard, or plain search box.
- Not an annotation/curation tool for editing datasets.

**Primary users:** ML engineers and researchers selecting public neurodata for training;
researchers vetting datasets before download; users building reproducible multi-dataset
cohorts. (Full personas in §3.)

**Primary use cases:**
1. "Find datasets that can support my goal, ranked, with reasons" (goal → ranked candidates).
2. "Should I download this? What's the minimum?" (dataset → readiness + minimum plan).
3. "Why did/would this fail?" (dataset → evidence panel, blocking issues, next check).
4. "Combine these datasets safely" (selection → cohort/benchmark composer → export).
5. "Can model X run on dataset Y?" (contract → compatibility report + required transforms).
6. "Reproduce what I did" (any plan → recipe/lockfile export, provenance view).

---

## 2. Product Positioning

### 2.1 Competitive / analogous analysis (UI lens only)

| Product | Core UI contribution | IA pattern | What Atlas learns | Gap Atlas fills |
|---|---|---|---|---|
| **OpenNeuro** | Archive browsing, dataset pages, file tree | Catalog → dataset detail → files | Clean dataset identity page; snapshot switcher | No decision support; search is filter-only; no readiness or cost info before download |
| **BIDS Validator (web)** | Paste/drop → issue list grouped by severity | Single-screen report | Severity grouping, issue → file drill-down | Binary valid/invalid; no "what does this mean for my goal"; no partial/subset context |
| **PyBIDS / MNE-BIDS / NiBabel / Nilearn / SimpleITK / ANTsPy** | API-first, no UI; docs + gallery | Reference docs + example gallery | scikit-learn-style gallery = strong onboarding pattern | No interactive surface at all; Atlas is the missing front-of-house |
| **MONAI / TorchIO** | ML framework docs, model zoo cards | Card grids + API docs | Model card layout for the Compatibility area | Data-side story absent; no dataset-model matching UI |
| **DataLad** | CLI + handbook | Task-oriented handbook chapters | "Explain what state your files are in" is a real user need | Pointer-vs-content confusion is a UI-solvable problem (Atlas: content status view) |
| **DVC (+ Studio)** | Pipeline/experiment tables, diffs | Repo-centric tables | Lockfile mental model; diff views | Neurodata-blind; no dataset intelligence |
| **Hugging Face Datasets** | Dataset cards + instant data preview widget | Card + viewer + code snippet | The "copy the loading code" affordance; dataset card structure | Preview implies usability — no readiness honesty, no cost/label evidence |
| **Kaggle Datasets** | Usability score, activity signals | Card + score badge | A single usability number drives attention | Score is opaque; Atlas must show decomposed, evidence-linked scores instead |
| **Weights & Biases** | Run tables, comparison, report composer | Workspace → runs → panels | Comparison tables, saved views, shareable reports | Experiment-side only; Atlas mirrors this for the *data* side |
| **napari** | Layered scientific viewer | Canvas + layer list | Out of scope reference: confirms Atlas should NOT build a viewer | — |
| **scikit-learn docs** | Task-first examples gallery | Task taxonomy → example → API | Task-first entry ("I want to classify…") maps to Atlas Goal Builder | Static; no live data behind examples |

### 2.2 Unique contribution
Atlas is the only surface where **evidence-state-aware dataset decisions** are the primary
UI object. Its differentiators are all presentation-layer:
1. Evidence badges (confirmed/inferred/unknown/blocked) on every displayed value.
2. Decomposed, explorable scores (never a bare number).
3. Plans as first-class UI artifacts with export (recipe, lockfile, CLI command).
4. Goal-first navigation (goal → candidates → evidence → plan), not archive-first.

### 2.3 Problems Atlas owns / does not own

**Owns (UI problems):**
- Making engine uncertainty legible and impossible to miss.
- Ranked comparison and side-by-side evaluation UX.
- Plan composition, review, and export UX.
- Progressive disclosure from one-line verdicts to raw evidence.
- Long-running job feedback (refresh/ingest/download progress).

**Does not own:**
- Any computation, scoring logic, parsing, validation, or data transfer (engine).
- Data hosting, archival, versioning of datasets (OpenNeuro/DataLad).
- Image/signal rendering beyond engine-generated static previews.
- Experiment tracking after training starts (W&B et al.).
- Editing or fixing datasets.

---

## 3. User Needs

### 3.1 Personas (UI-relevant traits only)

| Persona | UI-relevant traits | Primary Atlas surfaces |
|---|---|---|
| P1 ML engineer | Keyboard-heavy, wants code/CLI export, hates modal flows | Goal Builder, Compatibility, exports |
| P2 Medical-AI researcher | Needs defensible selection rationale for papers | Evidence panel, comparison, provenance |
| P3 Neuroscience researcher | Lower tolerance for jargon-dense tables; trusts sources over scores | Dataset workspace, readiness detail |
| P4 Data scientist | Facet-and-filter explorer, table power user | Explore, saved views |
| P5 Dataset curator / BIDS power user | Wants completeness matrices, issue lists, diffs | Files & metadata, snapshot diff |
| P6 Student / beginner | Needs guided paths, plain-language explanations | Home, guided goal templates, glossary popovers |
| P7 Reproducibility-focused advanced user | Wants lockfiles, hashes, audit trails | Plans & Runs, provenance, exports |

### 3.2 Jobs To Be Done (as UI jobs)
1. *When I have a research/ML goal*, help me see which datasets can support it and why,
   so I don't read 40 archive pages.
2. *When I'm considering a dataset*, show me what is confirmed vs unknown and what it
   costs (GB, time) to resolve the unknowns, so I don't waste a 300 GB download.
3. *When a dataset looks wrong*, show me exactly which evidence blocks my goal and the
   cheapest next check.
4. *When I combine datasets*, show me what harmonization the engine says is required and
   what the combined result looks like before I commit.
5. *When I finish deciding*, give me an artifact (recipe/lockfile/command) that reproduces
   the decision outside the UI.
6. *When I return later*, show me what changed (snapshots, local cache staleness) and what
   that invalidates.

### 3.3 Representative user stories
- As P1, I paste a model contract and see ranked compatible datasets with required
  transforms, and copy a `qortex` command to proceed. **[Confirmed engine support: CompatibilityEngine]**
- As P2, I open a dataset's evidence panel and export a rationale summary (score
  decomposition + evidence table) for my methods section.
- As P5, I view a companion-completeness matrix and filter to recordings missing required
  companions. **[Confirmed: CompanionSet, visual audit coverage matrix]**
- As P6, I pick a goal template ("classification on EEG-like data — treat as: pick a
  template, see candidates") and follow a stepped flow with plain-language captions.
- As P7, I open any past plan and see inputs, engine version, snapshot hashes, and re-export
  the lockfile. **[Confirmed: provenance records, ArtifactManifest]**

### 3.4 Pain points Atlas addresses (UI framing)
- Filter-only search forces manual cross-referencing → ranked, explained results.
- Scores without decomposition create false confidence → mandatory breakdown drawer.
- File trees hide semantic structure → recording-centric grouping (engine's LogicalRecording).
- "Is my local copy real or a pointer?" confusion → content-status view. **[Confirmed: ContentStatusReport]**
- No memory of past decisions → Plans & Runs history.

### 3.5 Success criteria **[Needs validation — baselines required]**
- Time from goal entry to a shortlist of ≤5 candidates: under 5 minutes.
- % of downloads preceded by a minimum-plan view in Atlas: >60% of Atlas-initiated downloads.
- Zero UI screens that display a score without an accessible decomposition.
- Every exported plan re-runs via CLI without edits (export fidelity = 100%).
- SUS ≥ 75 with P1/P2 testers; task success ≥ 90% on the 6 core JTBD flows.

---

## 4. Core Workflows (task flows, UI responsibilities only)

Each flow lists: trigger → UI steps → engine calls (opaque to Atlas) → outputs rendered.

1. **Dataset discovery**
   Goal Builder form or free-text goal → engine `DatasetSelector`/`DatasetQuery` →
   ranked result list with fitness score chips, evidence summary, size, license →
   select → Dataset Workspace. UI must render "why ranked here" per row.

2. **Dataset inspection**
   Dataset Workspace overview → engine `DatasetProfile`/`DatasetCard` →
   identity header, modality/subject/task facts (each with evidence badge), snapshot
   selector, readiness summary strip.

3. **Modality detection (display only)**
   Engine emits detected modalities per recording; UI renders a modality facet and a
   per-recording table column. No detection logic in UI.

4. **File and metadata exploration**
   Two synchronized views: *semantic view* (recordings grouped with companions) and
   *raw tree view*. Toggle, never both hidden. Metadata files open in a read-only
   inspector (JSON/TSV rendered as key-value / table).

5. **BIDS readiness check**
   "Run check" action → job progress → `CheckReport` rendered as severity-grouped issue
   list with file links; subset scope selector (paths) passed to engine.

6. **AI/ML readiness check**
   Readiness tab → `ReadinessReport` + `CanTrainReport` → score decomposition (BIDS /
   load / labels / convert / train), hard-fail list, "next cheapest check" callout with
   estimated download size.

7. **Visualization (render only)**
   QC/EDA tab → engine `qc`/`eda`/`visualize` outputs (thumbnails, coverage matrices,
   summary stats) rendered as static image cards + tables. Empty state explains which
   ingestion level unlocks it.

8. **Conversion planning**
   Convert tab → form bound to engine `ConversionContract` fields → engine returns plan
   preview (outputs, estimated sizes, provenance) → export recipe or run.

9. **Selective download planning**
   Plan tab → goal preset (validate / label-check / smoke / full) → `DownloadPlan` with
   per-file `SelectionReason` rendered as an explainable file list → total size, copyable
   command, "save plan".

10. **Reproducibility & audit trail**
    Plans & Runs area → list of saved plans/runs → detail: inputs, snapshot + hexsha,
    engine version, outputs, exports. Diff two runs.

11. **Workflow export**
    Every plan detail has an Export menu: recipe YAML, lockfile, CLI command, JSON.
    Copy and download variants; exports are engine-generated, UI only requests format.

12. **Model/data compatibility checking**
    Compatibility area → pick/paste model contract + pick datasets →
    `CompatibilityReport` matrix: runnable / needs-transforms / incompatible, with
    transform list per cell and per-check drill-down.

---

## 5. Information Architecture

### 5.1 Top-level navigation (6 areas + global search)
1. **Home** — status of local Atlas store, resume points, guided entries.
2. **Explore** — search, facets, ranked results, saved views.
3. **Datasets** — dataset workspaces (the hub object).
4. **Compose** — cohorts/benchmarks built from multiple datasets.
5. **Compatibility** — model contracts × datasets.
6. **Plans & Runs** — saved plans, job history, provenance, exports.
Plus: **Settings** (store location, ingestion defaults, engine info) and a global
**command palette / omnisearch**.

### 5.2 Page hierarchy & relationships
- Explore results → Dataset Workspace (hub). The workspace has tabs (Overview, Evidence,
  Files, Readiness, QC, Plan, Versions).
- Any dataset can be "pinned to comparison" (max 4) → Compare view (child of Explore).
- Any set of datasets → "Send to Compose" → Cohort Composer.
- Any plan produced anywhere lands in Plans & Runs.
- Compatibility links both ways: dataset → compatible models; model → compatible datasets.

### 5.3 Global vs contextual navigation
- Global: left sidebar (6 areas), top bar (omnisearch, jobs indicator, store status).
- Contextual: workspace tab bar; right-side evidence drawer available on every dataset
  screen; sticky action bar (Plan / Compare / Compose / Export) in dataset context.

### 5.4 Search / filter model
- Omnisearch (⌘K): matches datasets by ID/name, pages, actions ("run readiness check"),
  saved views, plans.
- Explore filters = engine facets only (modalities, tasks, subject count, size, license,
  evidence thresholds like "has confirmed labels"). Facets show counts; multi-select;
  active filters as removable chips; every filter state URL-encoded (shareable/restorable).
- Free-text goal input routes to engine goal parsing when available; UI shows the
  *decomposed structured interpretation* back to the user for confirmation before running
  (guards against silent misinterpretation). **[Confirmed: goal decomposition is an engine concept]**

### 5.5 Empty states (specified, not generic)
- Empty store: Home shows "Initialize Atlas" stepper (choose scope → ingestion level →
  run refresh) with size/time estimates per level.
- Dataset at ingestion level 0: deeper tabs show "This view needs manifest-level data.
  Fetch manifest for this dataset (~est. size)" with one-click scoped refresh.
- No results in Explore: show which filters eliminated everything (per-filter surviving
  counts) and one-click relaxation suggestions.
- QC tab without local data: "QC requires downloaded files. Minimum needed: X MB" +
  plan link.

### 5.6 Error states
- Engine/job errors render the engine's error verbatim in a details disclosure, with a
  plain-language one-liner above it. Never rewrite engine errors into vague messages.
- Network-dependent actions degrade to "stale data shown, refreshed <time>" banners.
- Partial job failure: per-item status table (succeeded/failed/skipped), retry-failed action.

### 5.7 Progressive disclosure strategy (three depths, consistent everywhere)
- **Depth 1 — Verdict:** one-line answer + evidence badge + score chip.
- **Depth 2 — Breakdown:** dimension table / issue list / plan summary (drawer or tab).
- **Depth 3 — Raw evidence:** the underlying engine report object, file references,
  provenance (JSON viewer + source file links).
Rule: Depth 1 is never shown without an affordance to reach Depth 2 in one interaction.

---

## 6. Full Page and Subpage List

Priorities: **M** must-have (MVP) / **S** should-have (V1) / **C** could-have (V2) / **L** later.

### 6.1 Home — **M**
- **Purpose:** Orient and resume; surface store health.
- **Users:** all; critical for P6.
- **Questions answered:** Is my Atlas store ready/stale? What was I doing? Where do I start?
- **Data:** store status (dataset counts per ingestion level, last refresh), recent
  datasets/plans, running jobs.
- **Components:** status strip, resume cards, guided-entry cards ("Start from a goal",
  "Inspect a dataset ID", "Check model compatibility"), jobs list.
- **Actions:** init/refresh store, jump to recents, open guided flows.
- **Visualizations:** none beyond simple counts (no vanity charts).
- **Accessibility:** landmark regions; cards are single tab stops with descriptive labels.
- **Risks:** becoming a dashboard — cap at status + resume + entry, nothing else.

### 6.2 Explore — **M**
- **Purpose:** Goal-driven and facet-driven discovery.
- Subpages: **6.2.1 Results** (M), **6.2.2 Goal Builder** (M), **6.2.3 Compare** (S),
  **6.2.4 Saved views** (S), **6.2.5 Gaps/opportunities** (L).
- **Questions:** Which datasets can support my goal? Why is #1 ranked first? What's the
  trade-off between candidates?
- **Data:** engine query results: fitness score + decomposition, evidence summary counts,
  size, license, subjects, modalities. **[Confirmed: DatasetFitness]**
- **Components:** goal form (structured fields + free-text with confirm-interpretation
  step), facet rail, result rows (verdict line, score chip, evidence dot summary
  ●confirmed ◐inferred ○unknown ✕blocked, size, license), pin-to-compare.
- **Actions:** run/refine query, save view, pin, open dataset, send set to Compose.
- **Visualizations:** none in results beyond chips/dots; Compare uses a shared-axis
  attribute table (datasets as columns, attributes as rows, per-cell evidence badges).
- **Accessibility:** results as a proper table/listbox with full keyboard ranking
  navigation; evidence dots always paired with text labels; filter chips reachable and
  removable by keyboard.
- **Risks:** free-text goal misparse → always echo structured interpretation for edit
  before executing; ranked list implying certainty → verdict line must state unknowns
  ("ranked 1st; label evidence unknown until events fetched").

### 6.3 Dataset Workspace (hub) — **M**
Tabs as subpages:

- **6.3.1 Overview — M.** Identity header (ID, name, snapshot selector, DOI, license),
  fact strip with per-fact evidence badges, readiness summary strip (5 sub-scores as
  labeled chips, never a lone total), top risks, primary actions (Plan download, Run
  checks, Pin to compare). Data: `DatasetCard`/`DatasetProfile`. Risk: header facts read
  as authoritative — badge every fact.
- **6.3.2 Evidence — M.** The signature screen. Table of claims (rows) × {status,
  source, cost-to-resolve, next action}. Grouped: Confirmed / Inferred / Unknown /
  Blocking. Each unknown row shows the engine's cheapest resolution ("fetch events,
  ~7 MB") as an action button. Data: readiness/evidence objects. Accessibility: status
  conveyed by icon + text + group heading, never color alone. Risk: overwhelming length —
  default collapse to Blocking + Unknown, expand others.
- **6.3.3 Files & Metadata — M.** Semantic view (recordings with companion completeness
  indicators) ⇄ raw tree toggle; read-only metadata inspector (JSON as key-value, TSV as
  virtualized table); content-status column (present / pointer-only / missing)
  **[Confirmed: ContentStatusReport]**. Risk: huge manifests — virtualized lists,
  server-side (engine-side) filtering, count-first summaries.
- **6.3.4 Readiness & Checks — M.** Run/re-run checks (with scope selector), severity-
  grouped issue list linking into Files tab, score decomposition with per-dimension
  drill-down, `CanTrainReport` verdict block ("Yes, with limitations" + limitation list).
- **6.3.5 QC & Summaries — S.** Engine-generated thumbnails/coverage matrices/EDA
  summary tables as static cards; each card cites its source recording and generation
  time; explicit empty state tied to ingestion level. Not interactive imaging.
- **6.3.6 Plan — M.** Goal preset selector → `DownloadPlan` as explainable file list
  (per-file `SelectionReason` in a reason column), total size, est. items, copyable CLI
  command, save/export. Risk: plan looks like a guarantee — show engine's stated
  unknowns above the file list.
- **6.3.7 Versions & Diff — C.** Snapshot list; semantic diff between two snapshots
  (added subjects/recordings/metadata changes, impact notes) as rendered by engine diff
  output. **[Assumption: engine diff output shape — needs validation]**
- **6.3.8 Compatibility (dataset-side) — S.** Which known model contracts can run here;
  per-model verdict chip + transforms list; link to Compatibility area.

### 6.4 Compose (Cohort / Benchmark Composer) — **S**
- **Purpose:** Review-and-confirm UI for multi-dataset assembly. **[Confirmed: CohortBuilder, harmonize]**
- **Questions:** Can these combine? What harmonization is required? What's the combined
  size/sample estimate? What are the risks?
- **Components:** selected-dataset tray; engine harmonization report rendered as a
  requirements checklist (label mapping table, common-channel note, resampling note —
  all engine-stated); combined summary panel; risk report panel; export block
  (benchmark manifest, lockfile, commands).
- **Actions:** add/remove datasets, accept/reject engine-proposed mappings where the
  engine offers alternatives, export.
- **Risks:** UI must not let users hand-edit mappings into invalid states — edits are
  choices among engine-validated options only.
- Subpages: 6.4.1 Composition list (S), 6.4.2 Composer detail (S), 6.4.3 Export review (S).

### 6.5 Compatibility — **S**
- **Purpose:** Two-way matching UI between model contracts and datasets. **[Confirmed: CompatibilityEngine/Report]**
- **Questions:** Can model X run on dataset Y? What transforms are required? Which
  datasets fit this contract?
- **Components:** contract input (pick registered / paste YAML with schema-validated
  form feedback), matrix view (datasets × models, cells = runnable / transforms-needed /
  incompatible / unknown), cell drill-down: per-check pass/fail table + required
  transform list + memory estimate.
- **Accessibility:** matrix cells: icon + text; full keyboard grid navigation
  (roving tabindex, arrow keys).
- **Risks:** "runnable" read as "will train well" — verdict copy must say "contract-
  compatible", with an explicit non-claim note.

### 6.6 Plans & Runs — **M**
- **Purpose:** History, provenance, reproducibility.
- **Questions:** What did I decide, with what inputs, and can I reproduce it?
- **Components:** plans table (type, dataset(s), created, status, size), run/job monitor
  (live progress, per-item status, logs disclosure), plan detail (inputs, snapshot +
  hexsha, engine version, outputs, export menu), run diff (C).
- **Data:** saved plans, job events, provenance records. **[Confirmed: provenance, ArtifactManifest]**
- **Risks:** silent staleness — plan detail shows a staleness banner when the dataset
  snapshot has changed since the plan was created.
- Subpages: 6.6.1 Plans (M), 6.6.2 Jobs (M), 6.6.3 Artifacts inspector (S — renders
  `ArtifactManifest`: samples, splits, shapes, source dataset@snapshot), 6.6.4 Run diff (C).

### 6.7 Settings — **M (minimal)**
Store path, ingestion defaults, concurrency limits (if engine exposes), engine version
info, cache size + compact action, telemetry opt-in (if any). No user accounts in MVP.

### 6.8 Atlas Map (graph view of dataset neighborhoods) — **L**
Goal-centered curated neighborhood graph (similar/complementary datasets). Deliberately
deferred: high build cost, unproven decision value vs. Compare table.
**[Needs validation before any investment]**

---

## 7. Recommended Navigation Model

- **Sidebar (left, collapsible to icons):** Home / Explore / Datasets / Compose /
  Compatibility / Plans & Runs; Settings pinned bottom. Active area highlighted;
  badge on Plans & Runs when jobs are running.
- **Top bar:** omnisearch (⌘K target), global job indicator (count + mini progress,
  click → Jobs), store status pill (fresh / stale / refreshing), help.
- **Breadcrumbs:** only within hierarchies deeper than the sidebar: e.g.
  `Datasets › ds004130 › Files › sub-01 › ses-01`. Breadcrumb segments are the
  subject/session/run drill path inside Files; workspace tabs are not breadcrumbed.
- **Dataset-level navigation:** persistent workspace tab bar; snapshot selector in the
  header applies to all tabs (switching snapshots reloads tab data and shows a "viewing
  non-latest snapshot" banner).
- **Subject/session/run navigation:** inside Files & Metadata, a drill list
  (subjects → sessions → recordings) with prev/next keyboard traversal at each level;
  URL reflects the full path.
- **Comparison views:** pin tray (bottom-left, max 4) visible across Explore and
  workspaces; "Compare (n)" opens the attribute table; column = dataset, sticky
  attribute column, per-cell evidence badges, "differences only" toggle.
- **Command palette (⌘K):** fuzzy across datasets, pages, actions, saved views, plans;
  actions are context-aware (inside a workspace, "Run readiness check" targets that
  dataset); recent items first; full keyboard operation.

---

## 8. UX/UI Design Requirements

- **Layout principles:** three-region canvas (nav rail / content / contextual drawer);
  content column max ~1200px for tables, full-bleed for matrices; sticky action bar in
  workspace contexts; density toggle (comfortable/compact) for tables.
- **Visual hierarchy:** verdict line > evidence badges > metrics > metadata. One primary
  action per screen region. Scores are chips with labels, never large hero numbers
  (anti-vanity rule).
- **Interaction patterns:** optimistic UI never used for engine truth (all verdicts wait
  for engine responses with skeletons); destructive/irreversible actions (cache delete,
  overwrite plan) require typed or two-step confirm; everything deep-linkable (URL state
  for filters, tabs, drill paths, compare sets).
- **Data-table behavior:** virtualized rows; column sort with persisted preferences;
  column show/hide; sticky header + first column; row-level expand for Depth-2 detail;
  bulk select with visible selection count; CSV/JSON export of any table; empty and
  error states specified per table (§5.5–5.6).
- **Filtering & faceting:** facet rail with counts; applied filters as chips; "why zero
  results" breakdown; saved views capture filters + sort + columns.
- **Visualization behavior (dataviz discipline):** engine-generated images shown at
  fixed aspect with caption (source file, generated-at, ingestion level); numeric
  summaries prefer tables over decorative charts; when charts exist (e.g., class-balance
  bars from engine label profiles) they include axis labels, exact values on
  hover/focus, and a data-table alternative view; categorical color usage follows a
  single palette with non-color redundancy.
- **Loading states:** skeletons for structure, progress bars with counts for jobs
  ("412/1,203 files"), never indeterminate spinners for >5s operations; long jobs
  continue in background with the global indicator.
- **Validation states:** forms validate on blur with inline messages; goal forms show
  the engine-parsed interpretation before execution; plan forms show live size estimates
  as fields change (engine round-trip, debounced).
- **Warning & uncertainty design (core system):** a single evidence-badge component used
  everywhere: `Confirmed` (solid, checked), `Inferred` (half, "from manifest"), `Unknown`
  (hollow, with resolve-cost), `Blocked` (x, with reason). Badges are icon + text.
  Unknown/Blocked are visually louder than Confirmed. A screen may never aggregate away
  Blocked items (they surface at Depth 1).
- **Accessibility (WCAG 2.2 AA):** full keyboard operability incl. matrix grids and pin
  tray; visible focus (2.4.7/2.4.11 focus not obscured); target size ≥24px (2.5.8);
  contrast 4.5:1 text / 3:1 UI; status changes announced via live regions (job progress,
  check completion); no color-only encoding anywhere (evidence, severity, diff);
  drag-to-reorder in Compose has button alternatives (2.5.7); consistent help location
  (3.2.6); tables with proper th/scope; reduced-motion respected.
- **Responsive behavior:** desktop-first (primary: ≥1280px). Down to tablet: drawer
  overlays content, matrices scroll with sticky headers. Phone: read-only monitoring
  (Home, Jobs, plan status) only — composing plans on phones is a non-goal.
  **[Assumption — needs validation with users]**

---

## 9. Feature Prioritization (MoSCoW mapped to releases)

**MVP (Must):**
- Home (status + resume), Settings (minimal).
- Explore: structured Goal Builder + facets + ranked results with evidence dots.
- Dataset Workspace: Overview, Evidence, Files & Metadata, Readiness & Checks, Plan.
- Plans & Runs: plans list, job monitor, plan detail with exports (recipe/lockfile/CLI).
- Evidence-badge system, command palette (basic: datasets + pages), URL state.

**V1 (Should):**
- Compare view + pin tray; saved views.
- QC & Summaries tab; dataset-side Compatibility tab + Compatibility area (matrix).
- Compose (cohort/benchmark composer + export review).
- Artifacts inspector; free-text goal input with interpretation confirmation.
- Content-status view; subset check scoping UI.

**V2 (Could):**
- Snapshot Versions & semantic diff tab; run diff.
- Gaps/opportunities view; density/report export for methods sections (evidence table →
  formatted summary).
- Phone read-only monitoring.

**Future research (Later / Needs validation):**
- Atlas Map graph view.
- Multi-user/shared stores; annotations on datasets.
- LLM-assisted explanations in UI (only if engine provides cited, evidence-linked text;
  UI renders citations as links to evidence rows — never uncited prose).

RICE note: MVP items were selected as highest Reach (every user passes through
discovery→inspection→plan) × Confidence (engine support **[Confirmed]**) with lowest
Effort (tables/forms/badges, no graph or matrix rendering).

---

## 10. Scientific and Technical Requirements (UI-side)

- **Data contracts:** Atlas consumes only typed engine outputs (Pydantic models /
  JSON-schema equivalents): `DatasetCard`, `DatasetProfile`, `DatasetFitness`,
  `ReadinessReport`, `CheckReport`, `CanTrainReport`, `DownloadPlan` (+
  `SelectionReason`), `CompatibilityReport`, `ContentStatusReport`, `CohortManifest`,
  `ArtifactManifest`, provenance records. **[Confirmed these exist as engine classes]**
  UI renders unknown/extra fields generically (forward compatibility) and shows the
  contract version it received.
- **API layer:** a thin local service exposing the Python engine (FastAPI-style local
  server or IPC in a desktop shell) with job endpoints (submit/status/events/cancel) and
  streaming progress. **[Assumption — service layer must be built; needs engine-team validation]**
- **Metadata requirements:** every rendered fact carries {value, evidence_status,
  source_ref, as_of (snapshot/hexsha), ingestion_level}. If the engine can't supply one
  of these, the UI shows "unsourced" explicitly rather than dropping the badge.
- **Provenance tracking:** every plan/export embeds dataset id, snapshot tag + hexsha,
  engine version, goal inputs, timestamp. UI displays these read-only and includes them
  in all exports.
- **Reproducibility:** exports are engine-generated (UI passes format only); the UI
  guarantees the on-screen plan and the exported artifact come from the same engine
  response (single response object, no UI-side re-derivation).
- **Auditability:** append-only local activity log of user-initiated engine actions
  (action, params, result ref); viewable in Plans & Runs.
- **Readiness / AI-readiness scoring:** UI never computes or re-weights scores; renders
  engine decomposition verbatim; if the engine marks a dimension unknown, the UI must
  not display an aggregate that hides it (aggregate shown as range or "incomplete").
- **Model compatibility checks:** rendered from `CompatibilityReport` per-check results;
  UI adds no inference.
- **Export formats:** recipe YAML, lockfile, benchmark manifest, CLI command string,
  raw JSON of any report; all copy + file-download.
- **Integration points with Qortex:** engine query/selector API, checks API, plan API,
  fetch/jobs API, compose/harmonize API, compatibility API, artifacts API, store
  status/refresh API. Each Atlas area maps 1:1 to one engine surface — if an engine
  surface is missing, the UI feature waits (no UI-side shims). **[Needs validation:
  which surfaces are already exposed beyond Python, i.e., CLI-only vs importable API]**

---

## 11. UX Risks and Safeguards

| Risk | Where it appears | Safeguard (UI mechanism) |
|---|---|---|
| Score worship | Explore ranking, Overview chips | No bare totals; chip always pairs with top weakness ("73 — labels unknown"); decomposition one interaction away |
| Unknowns read as absence | Evidence tables, facts strip | Unknown badge is visually louder than Confirmed; unknown rows carry resolve-cost + action |
| "Runnable" read as "will perform well" | Compatibility matrix | Verdict wording "contract-compatible"; fixed non-claim caption on every matrix |
| Plan read as guarantee | Plan tab, Compose export | "Based on evidence as of snapshot X; unknowns: n" banner above every plan |
| Stale local data trusted | Whole app | Store status pill + per-dataset as-of stamps + staleness banners on plans |
| Free-text goal misparse | Goal Builder | Mandatory echo of structured interpretation with edit-before-run |
| Aggregated views hiding blockers | Overview, Compare | Blocked items always bubble to Depth 1; Compare shows blocked cells even in "differences only" mode |
| Thumbnails imply data quality | QC tab | Captions state generation source + "preview only, not a quality assessment" where engine says so |
| Engine errors sanitized into mush | All jobs | Verbatim engine error in disclosure under a plain one-liner |
| Beginners misreading jargon | All | Term popovers with plain-language definitions (content sourced from docs, not invented) **[Needs validation: docs source]** |

---

## 12. Final Recommended Sitemap

```text
Qortex Atlas
├── Home                                        [MVP]
│   ├── Store status & refresh
│   ├── Resume (recent datasets / plans / jobs)
│   └── Guided entries (goal / dataset ID / model contract)
├── Explore                                     [MVP]
│   ├── Goal Builder (structured; free-text V1)
│   ├── Results (ranked, evidence dots, facets)
│   ├── Compare (pin tray, ≤4)                  [V1]
│   ├── Saved views                             [V1]
│   └── Gaps / opportunities                    [V2]
├── Datasets
│   └── Dataset Workspace: <dataset-id>@<snapshot>   [MVP]
│       ├── Overview                            [MVP]
│       ├── Evidence                            [MVP]
│       ├── Files & Metadata                    [MVP]
│       │   └── Subjects › Sessions › Recordings (drill + inspector)
│       ├── Readiness & Checks                  [MVP]
│       ├── QC & Summaries                      [V1]
│       ├── Plan (selective download)           [MVP]
│       ├── Compatibility (dataset-side)        [V1]
│       └── Versions & Diff                     [V2]
├── Compose                                     [V1]
│   ├── Compositions list
│   ├── Composer (tray · harmonization checklist · risks)
│   └── Export review (manifest / lockfile / commands)
├── Compatibility                               [V1]
│   ├── Model contracts (registered / paste)
│   ├── Matrix (datasets × models)
│   └── Report detail (per-check, transforms)
├── Plans & Runs                                [MVP]
│   ├── Plans (saved, staleness-aware)
│   ├── Jobs (live progress, per-item status, logs)
│   ├── Artifacts inspector                     [V1]
│   └── Run diff                                [V2]
├── Settings                                    [MVP]
│   ├── Store & cache
│   ├── Ingestion defaults
│   └── Engine info
└── Global
    ├── Command palette / omnisearch (⌘K)       [MVP]
    ├── Pin-to-compare tray                     [V1]
    ├── Evidence drawer (contextual)            [MVP]
    └── Jobs indicator                          [MVP]
```

---

### Open items requiring validation before build
1. Engine service layer: what is exposed beyond Python imports (local API needed). **[blocking MVP]**
2. Snapshot semantic-diff output shape (drives Versions tab feasibility).
3. Deployment target: local web app vs. desktop shell. **[affects file access & jobs UX]**
4. Free-text goal parsing availability and output schema.
5. User tests for: evidence-badge comprehension, Compare table vs. graph map, phone scope.
