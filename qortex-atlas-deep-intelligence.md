# Qortex Atlas — Deep Intelligence Layer

> Part 2. `qortex-atlas-search-engine.md` designed the retrieval/ranking *engine*
> (BM25 + semantic + structured + graph → RRF → `DatasetFitness` re-rank →
> evidence-partitioned filters). That engine is necessary but, on its own, still
> generic — it would work for any dataset catalog. This document answers a
> narrower question: **given the specific data Qortex/OpenNeuro actually has —
> most of it currently unused — what features are only possible here?** It is
> written after an exhaustive capability audit of three codebases (Qortex core,
> Qortex Atlas backend + frontend, and the OpenNeuro GraphQL/BIDS data surface),
> and it is organized the way a CTO and a CIO would actually read it: data asset
> → concrete mechanism → build cost/reuse path, followed by a governance pass.
>
> Ground rule for this document: **no feature is proposed without naming the
> exact field(s) it consumes and the exact formula/algorithm applied to them.**
> "Use ML" or "use embeddings" is not an answer here unless the vector, the
> distance function, and the threshold are specified.

---

## 0. The audit, compressed: what we actually have

Three parallel deep-dives were run. The full inventories are long; what matters
for feature design is the delta between **what's collected** and **what's used**.

### 0.1 Qortex core — already computes far more than Atlas exposes

| Signal | Where it's computed | Cost tier | Currently reaches Atlas UI? |
|---|---|---|---|
| Per-trial event timing: onset/duration/ISI jitter CV, imbalance ratio, cross-subject class consistency | `inspect/label_landscape.py` (`LabelLandscape`, `ISIStats`, `TrialTypeStats`) | R (remote range-read, no download) | Only as a flat "label readiness" boolean in readiness; the rich per-class/per-ISI structure is computed and **thrown away** before the UI |
| Acquisition parameters: sfreq, channel counts by type, TR, discarded volumes, voxel size, fMRI shape | `inspect/signal_budget.py` (`AcquisitionParams`) | R | Only a coarse "signal-budget" hours number surfaces; **not parsed at all**: `MultibandAccelerationFactor`, `MagneticFieldStrength`, `FlipAngle`, `EchoTime`, `PhaseEncodingDirection`, `EEGReference`, `EEGPlacementScheme` — all present in the sidecar JSON that `signal_budget.py` already fetches, simply not extracted |
| Exact NIfTI header (affine, voxel size, TR) and EDF header (per-channel calibration, sampling rate) via byte-range reads | `stream/nifti.py`, `stream/edf.py` | R | Used only for preview rendering, never fed back into search/ranking |
| Cross-dataset demographic harmonization (age/sex/diagnosis/scanner heterogeneity) | `cohort/builder.py` | R | Only used inside the Compose workflow; never used as a *search-time* signal |
| Full NeuroAI compatibility/contract system: source adapters (LSL, BrainFlow, NWB, DICOM streams), output adapters, runtime engine, benchmark harness | `neuroai/` (49 files) | — | Atlas surfaces exactly one entry point (`CompatibilityEngine.check()` against a **3-model hardcoded catalog**); the adapters, runtime, and benchmark harness have zero UI/API surface |
| Empirical operation latency history per `(operation, dataset_id)` | `console/atlas_timing.py` | — | Used only for progress-bar copy; never used as a ranking or planning signal |

### 0.2 OpenNeuro platform — fields requested vs. fields available

Confirmed by reading every GraphQL query string in `client/graphql.py`. Qortex
requests a genuinely rich set already (`species`, `studyDomain`, `studyDesign`,
`grantFunderName`, `EthicsApprovals`, `subjectMetadata{age,sex,group}`,
engagement counts). But several high-value fields are visible in OpenNeuro's
schema and **never queried**:

| Unused field | What it enables |
|---|---|
| `stars[].userId`, `followers[].userId` (Qortex only keeps `len()`) | A real researcher↔dataset bipartite graph — collapsed to a count today, discarding the one thing that makes it a *graph* |
| `metadata.affirmedDefaced`, `metadata.affirmedConsent` | A compliance/re-identification-risk gate — currently absent from `MLReadinessScore` entirely |
| `summary.secondaryModalities`, `summary.pet` | PET and multi-modal datasets are under-described (single flat `modalities` list) |
| Full BIDS-validator payload (`evidence`, `code`, `subCode`, validator version) vs. the 5 fields Qortex takes (`severity, key, reason, files, helpUrl`) | Finer-grained, machine-actionable trust scoring |
| `derivatives/` trees (fMRIPrep, MRIQC, FreeSurfer) — never fetched by any query | **The single biggest miss.** These are pre-computed, standardized QC metrics sitting on OpenNeuro for free (see §2.5) |
| `dataset.uploader`, `dataset.public`, `dataset.draft` | Governance/provenance context |

### 0.3 Raw BIDS file content reachable but unparsed

`RemoteFileGateway` (`client/remote.py`) is a generic byte-range/small-file
fetcher — it has no opinion about *which* fields matter. Concretely unparsed
today: `channels.tsv` (`status` good/bad, `low_cutoff`, `high_cutoff`,
`reference`), `participants.tsv` columns beyond `age/sex/group` (every
dataset-specific column — `handedness`, `IQ`, `MMSE`, `disease_duration`,
`medication`, `scanner_site`, …), `events.tsv` beyond `trial_type`
(`response_time`, `value`, `sample`, HED tags), and derivatives JSON.

### 0.4 Atlas backend — solid infrastructure, thin product surface

`atlas_evidence.py` (4-state claim model), `atlas_cache.py` (single-flight TTL
cache), `atlas_jobs.py` (background job registry), `atlas_timing.py` (empirical
ETA) are all **real, generic, reusable infrastructure** — none of it is tied to
today's specific features. Everything proposed below is designed to plug into
these four modules rather than invent parallel ones. That is the single most
important reuse decision in this document.

---

## 1. Design stance: three tiers of feature, not one bucket

Every feature below is tagged by tier, because they have different cost/risk
profiles and a CTO needs to fund them differently:

- **Tier S (Structural)** — deterministic, formula-driven, computed from fields
  Qortex/OpenNeuro already deliver. No ML, no LLM, fully reproducible and
  testable. *Ship first.*
- **Tier D (Derived-statistical)** — still deterministic/rule-based, but
  involves a corpus-wide statistic (percentile, entropy, clustering) that
  changes as the corpus grows. Requires the persisted graph/catalog, not just a
  single dataset's data.
- **Tier L (Learned/optional)** — genuinely benefits from embeddings or a
  trained ranker. Always sits *on top of* a Tier S/D fallback, never replaces
  it, per the evidence-first principle from Part 1.

---

## 2. Deep features — data asset → mechanism → schema

### 2.1 Protocol Fingerprinting (Tier S/D) — acquisition-signature similarity

**Data:** `AcquisitionParams` fields already fetched by `signal_budget.py`, plus
sidecar fields it fetches but currently discards: `MultibandAccelerationFactor`,
`MagneticFieldStrength`, `FlipAngle`, `EchoTime`, `PhaseEncodingDirection`,
`ParallelReductionFactorInPlane` (BOLD); `EEGReference`, `EEGPlacementScheme`,
`PowerLineFrequency` (EEG).

**Mechanism.** Build a per-recording, per-modality **protocol vector** with
mixed numeric and categorical dimensions:

```text
BOLD:  [TR_s, TE_ms, voxel_x_mm, voxel_y_mm, voxel_z_mm, FlipAngle_deg,
        MultibandFactor, ParallelReductionFactor,
        FieldStrength_T (cat: 1.5/3/7), PhaseEncodingDirection (cat)]
EEG:   [sfreq_hz, n_channels, PowerLineFrequency (cat: 50/60),
        EEGReference (cat), montage_hash]
```

Numeric dims are z-scored against the **corpus-wide distribution for that
modality** (mean/std recomputed incrementally as new datasets are ingested —
store running mean/M2 via Welford's algorithm so this is O(1) per new
recording, not a full corpus rescan). Categorical dims use exact match (weight
1) or 0.

Distance is **Gower distance**, not plain cosine — this is the correct tool for
a mixed numeric/categorical feature vector (it's the standard choice in
biostatistics for exactly this reason), and it degrades gracefully when a field
is missing (weight redistributes over present dimensions, so a dataset with
`MultibandFactor` unknown doesn't get discarded, just scored on what's known —
consistent with the evidence-first, three-valued philosophy).

```text
gower(a, b) = (1/|present dims|) · Σ_i  d_i(a_i, b_i) · [dim i present in both]
  numeric:     d_i = |a_i − b_i| / range_i
  categorical: d_i = 0 if equal else 1
```

**New capability:** `qortex atlas neighbors ds004130 --by protocol` — find
datasets acquired with a *matching scanner/sequence configuration*, independent
of task or label similarity. This is the concrete mechanism behind the
"harmonization planner" (`qortex-atlas.md` §12.5): before proposing "resample to
250 Hz, restrict to common channels," Atlas can *quantify* how far apart two
protocols actually are.

**Harmonization risk score**, computed at benchmark-compose time for a proposed
set of K datasets: for each protocol dimension, compute the coefficient of
variation (CV = std/mean) across the K datasets' values; flag dimensions where
CV > 0.15 (numeric) or any categorical mismatch as a **site-effect risk**. This
maps directly onto a known, named remediation in the neuroimaging literature —
statistical batch-effect correction (ComBat/neuroComBat) for the numeric case,
or channel-set restriction for EEG (§2.3) — so the harmonization plan Atlas
emits isn't just "these differ," it names the actual correction technique.

**Schema:** new table `protocol_signatures(recording_id, modality, vector_json,
corpus_zscore_version, computed_at)`; new graph edge
`SIMILAR_PROTOCOL_TO(weight = 1 − gower_distance)`.

**Reuse:** compute lazily, only for recordings that survive Stage-1 structural
filtering (never eagerly for the whole corpus) — cache via `atlas_cache.TTLCache`
keyed by recording id; register as an `atlas_timing` operation
(`"protocol_fingerprint"`) from day one so its cost is measurable immediately.

---

### 2.2 Statistical Paradigm Classification (Tier S) — from event timing, not text

**Data:** `LabelLandscape`'s already-computed `ISIStats` (`jitter_cv`,
`is_jittered`/`is_fixed_rate`), `TrialTypeStats` (class count, per-class
duration), plus previously-unparsed `events.tsv` columns `response_time` and
trial count per run.

**Mechanism — a deterministic decision tree, not a black-box classifier**
(explainability requirement from Part 1 principle 3):

```text
resting_state:     no events.tsv OR (n_events == 0 AND single continuous run)
block_design:      median trial_duration_s ≥ 8  AND  n_events_per_run < 15
event_related:     median trial_duration_s < 8  AND  n_events_per_run ≥ 20
oddball_mmn:       n_classes ∈ {2,3}  AND  imbalance_ratio ≥ 5  AND  is_fixed_rate
go_nogo:           n_classes == 2  AND  imbalance_ratio < 2.5  AND  response_time column present
cued_motor_task:   n_classes ≥ 2  AND  is_jittered  AND  keyword-hint from task label (soft signal only)
```

Each rule is independently checkable and reports **which criteria matched**
(confidence = fraction of criteria satisfied, not a learned probability) — e.g.
`"oddball_mmn: 3/3 criteria matched"` vs. `"oddball_mmn: 2/3, ISI regularity
unconfirmed"`. This is a genuinely novel differentiator: it classifies the
*actual experimental paradigm* from raw timing statistics, which is robust to
OpenNeuro's notoriously inconsistent free-text task descriptions (the exact
weakness `qortex-atlas.md` §3 already identified but didn't have a mechanism
to fix). A supervised classifier trained on a hand-labeled sample is a valid
**Tier L** upgrade later, but the rule-based version ships first, is fully
auditable, and becomes the training-label source for that later model.

**Schema:** `paradigm_classifications(recording_id, paradigm_class,
criteria_matched_json, ruleset_version)`. `ruleset_version` matters — see
§4.2 (ontology/ruleset versioning).

---

### 2.3 Channel-Level Montage Intelligence (Tier S) — `channels.tsv`, currently unparsed

**Data:** `channels.tsv` per EEG/MEG/iEEG recording: `name`, `type`, `status`
(good/bad), `status_description`, `sampling_frequency`.

**Mechanism.**
1. **Usable channel count** = total channels − count where `status == "bad"`.
   This directly corrects `SignalBudget`'s current raw channel count, which
   today comes from the sidecar's `EEGChannelCount` and has no idea some
   channels are flagged unusable.
2. **Montage hash**: normalize channel names (strip case, strip common prefixes
   like `EEG `, map `T3/T4/T5/T6` ↔ `T7/T8/P7/P8` 10-20 legacy aliases via a
   small lookup table) → sorted frozenset → stable hash. Two recordings with the
   same montage hash are electrode-set-identical.
3. **Cross-dataset channel intersection (the concrete algorithm behind
   "restrict to common channels", `qortex-atlas.md` §12.5):** for a candidate
   set of K EEG datasets, compute `∩ montage_i` (i=1..K). If below a usability
   threshold (e.g. < 8 channels — insufficient for most spatial-filter methods
   like CSP), run a **greedy channel-set-cover drop procedure**: repeatedly
   drop the one dataset whose removal grows the intersection the most, until
   either the threshold is met or a `max_datasets_dropped` budget is exhausted.
   Report the actual trade curve: *"intersection = 6 ch (all 5 datasets) → 19 ch
   (drop ds002; 4 datasets) → 32 ch (drop ds002, ds014; 3 datasets)"* — this is
   the literal, computable content behind the Benchmark Composer's "required
   transformations" output.

**Schema:** `channel_sets(recording_id, montage_hash, n_total, n_bad,
usable_channel_names_json)`. Graph edge
`SHARES_MONTAGE_WITH(weight = |intersection| / |union|)` (Jaccard).

---

### 2.4 Label Topology / Class-Space Unification (Tier D) — corpus-wide

**Data:** `label_column` + `trial_type_stats[].trial_type` from every indexed
dataset's `LabelLandscape`, plus the ontology synonym clusters from Part 1 §3b
(themselves mined from the corpus's real `task-*` values).

**Mechanism.**
1. Normalize every observed label string: lowercase, strip `sub-`/numeric
   suffixes, apply the ontology synonym map (`left_hand ≈ lh ≈ L ≈
   left-hand-imagery`).
2. For each dataset, form its **label set** = normalized trial-type vocabulary
   for a given task/column.
3. Two datasets get a `SHARES_LABEL_SPACE` edge when
   `Jaccard(label_set_a, label_set_b) ≥ 0.6` **and** `|n_classes_a − n_classes_b|
   ≤ 1` (cardinality-compatible — a 2-class and a 7-class task are not
   "sharing a label space" even if one label string matches).
4. Where normalized strings don't match but co-occur in *structurally similar*
   recordings (same paradigm class from §2.2, same modality, similar
   subject/trial counts), propose a **candidate synonym** for human/LLM review
   — this is how the ontology in Part 1 §3b actually grows over time, closing
   the loop between corpus data and the taxonomy that indexes it.

**This is what makes automatic benchmark composition real** rather than
aspirational: `compose-benchmark` can now programmatically find the datasets
that share a class space, rather than relying on a human noticing "these both
have left/right/foot/tongue labels."

**Schema:** `label_clusters(cluster_id, ontology_version, member_labels_json)`,
`dataset_label_membership(dataset_id, task, cluster_id, coverage)`.

---

### 2.5 Derivatives-Aware QC Ingestion (Tier S) — the single highest-leverage gap

**Data:** OpenNeuro hosts pre-computed **MRIQC** and **fMRIPrep** derivative
outputs for a large share of MRI datasets, as sibling files under
`derivatives/mriqc/sub-*/...` — **currently fetched by zero Qortex code path.**
MRIQC's per-subject/session JSON contains standardized Image Quality Metrics
(IQMs):

```text
T1w:   cnr, snr_total, efc (entropy focus criterion), fber,
       fwhm_avg, qi1, qi2, cjv, wm2max
BOLD:  dvars_std, fd_mean (mean framewise displacement),
       fd_num (count of high-motion frames > 0.5mm),
       tsnr, gsr_x, gsr_y, aor, aqi
```

**Why this matters more than anything else in this document:** these are
metrics *the original dataset authors' own QC pipeline already computed*.
Ingesting them costs Qortex nothing but a small JSON fetch per subject
(same R-tier cost as everything else) and converts Atlas from "infers
readiness from file presence" to **"knows the actual measured motion/quality
per subject, with zero local computation."** `fd_mean` in particular is the
single most load-bearing motion-QC gate used in real fMRI ML pipelines — a
dataset search that can filter `"subjects with fd_mean < 0.5mm"` is doing
something no current OpenNeuro-facing tool does at the *subject* level.

**Mechanism:** when Level-1 manifest ingestion detects a `derivatives/mriqc/`
or `derivatives/fmriprep/` prefix, queue a Level-2-equivalent probe (reuse
`atlas_jobs`) to fetch each subject's `*_T1w.json` / `*_bold.json` IQM file.
Populate a `subject_qc` table. Roll up to dataset level: `pct_subjects_passing
motion QC` using literature-standard thresholds (`fd_mean < 0.5mm` is a common
default, exposed as a tunable parameter, not hardcoded dogma — different labs
use different cutoffs).

**Schema:** `subject_qc(dataset_id, subject, session, run, metric_name,
metric_value, source="mriqc", mriqc_version)`. This directly becomes a **new
dimension in `DatasetFitness`/`MLReadinessScore`** (currently weights
events=30/subjects=20/license=15/modality=15/structure=10/companion=10 — a
`qc_confirmed` dimension slots in naturally, and should reduce weight
elsewhere rather than being tacked on to keep the total at 100).

fMRIPrep's confound files (`*_desc-confounds_timeseries.tsv`: per-volume
framewise displacement, aCompCor components, motion parameters) go one level
deeper — they let `SignalBudget.estimate_windows()` be corrected for
**scrubbing** (excluding high-motion volumes), so "signal-hours available" and
"ML-usable signal-hours after motion scrubbing" become two different, both
useful, numbers.

---

### 2.6 Compliance & Governance Gating (Tier S) — a missing fitness dimension

**Data:** `metadata.affirmedDefaced`, `metadata.affirmedConsent` (confirmed
present in OpenNeuro's schema, never queried by Qortex today).

**Mechanism:** for any dataset containing anatomical MRI (`T1w`/`T2w`),
`affirmedDefaced == false` is a **hard, structural, non-negotiable flag** —
raw (non-defaced) anatomical MRI carries a real facial-reconstruction
re-identification risk. This is not a "nice to have" scoring dimension; it
should behave like a hard-fail unless the user explicitly acknowledges it
(distinct from every other soft fitness dimension). `affirmedConsent == false`
is a softer advisory flag surfaced in the evidence report.

**New fitness dimension:** `compliance` — pass/fail/unknown, weighted 0 in the
numeric score (it should not be averaged away) but rendered as a **blocking
banner**, consistent with the "unknown ≠ pass" principle from Part 1. This is
the one dimension where "unknown" (OpenNeuro simply didn't record the flag)
should default to a *cautious* UI treatment, not a neutral one.

---

### 2.7 Two-Tier Trust Score (Tier S) — platform-reported vs. locally confirmed

**Data:** `GetSnapshotIssues` (`severity`, `key`, `reason`, `helpUrl` — platform
BIDS-validator, unconfirmed locally) vs. Qortex's own post-download
`ValidationReport` (`decision.py`/`checks/`, confirmed locally).

**Mechanism:** two-tier trust, mapped onto the existing evidence vocabulary:

```text
platform_clean + never_downloaded   → inferred (OpenNeuro says OK, unverified)
platform_clean + locally_validated  → confirmed
platform_errors                     → fail (regardless of local state)
never_validated_anywhere            → unknown
```

This is a direct, small extension of `atlas_evidence.py`'s existing
`Claim(group, text, source, cost_hint)` model — a new `group="structural_trust"`
claim category, not a new subsystem.

---

### 2.8 Social/Collaborative Graph (Tier D) — the one field Qortex throws away

**Data:** `stars[].userId`, `followers[].userId` — currently reduced to
`len()` by `client/graphql.py` before the identity is ever used.

**Mechanism.** Store a **salted hash** of `userId` (never the raw platform ID —
see §5.2 for why), building a bipartite `Researcher ↔ Dataset` graph via a
`STARRED_BY` edge. This enables genuine **collaborative filtering**, not just
content similarity:

```text
PMI(d_i, d_j) = log( P(star d_i AND star d_j) / (P(star d_i) · P(star d_j)) )
```

computed over the co-star matrix. A positive, large PMI between two datasets
means researchers star them together *far more than base rates predict* — a
signal completely orthogonal to text/semantic/structural similarity (two
datasets can be scientifically unrelated in content but used together
constantly by the same methodological community, e.g. a benchmark dataset
habitually paired with a normative reference dataset). This becomes a
**fifth retriever** in the Part-1 fusion stage — explicitly a *social-proof*
signal, fused via the same RRF mechanism, never allowed to override structural
hard-fails (per Part 1 principle 1).

**Second-order use:** the same PMI computation over `Researcher → Dataset`
directly powers `qortex atlas opportunities` — a dataset with high
structural quality (§2.5's QC scores, high `MLReadinessScore`) but low
star/download count *relative to its peer group* (not raw count — see the
opportunity formula in §2.10) is a genuine underused-but-high-potential
candidate.

**Schema:** `researcher_dataset_edges(researcher_hash, dataset_id, edge_type ∈
{starred, followed}, observed_at)`. Governance constraints on this table are
covered in §5.2 — this is the one new data asset in this document with a real
privacy dimension.

---

### 2.9 NeuroAI-Native Search (Tier S) — compatibility as a first-class filter, not a details tab

**Data:** the entire `neuroai/` package — `CompatibilityEngine`, `SourceProfile`
/`ModelProfile` contracts, source adapters (`bids`, `brainflow`, `dicom`,
`lsl`, `nwb`, `xdf`), output adapters — is built and tested-shaped, and today
has exactly one thin surface: `/dataset/{id}/compatibility` against a
**3-entry hardcoded model catalog** (`atlas_models.MODEL_CATALOG`).

**Mechanism.** Two concrete upgrades, both mechanical (no new algorithms
needed — the compatibility *logic* already exists, only its *reach* is
limited):

1. **Index compatibility, don't just compute it on click.** For every recording
   that has enough evidence to build a `SourceProfile` (i.e. `signal_budget`
   already ran), pre-compute `CompatibilityReport` against the full model
   catalog as a Level-2-tier batch job (`atlas_jobs`), store
   `compatible_model_ids[]` and `runnable_now: bool` per dataset, and expose
   both as **indexed, filterable, facetable** fields — `search --compatible-with
   braindecode/eegnet` becomes a structured-retriever filter (Stage 1 in Part 1),
   not a per-dataset follow-up call.
2. **Let users register a `ModelProfile` at query time**, not just pick from
   the hardcoded catalog — a JSON/YAML paste box that constructs an
   `InputContract` ad hoc, run through the exact same `CompatibilityEngine`.
   This turns "which of my 40 candidate datasets can run this specific model
   I'm about to fine-tune" from a manual per-dataset check into one search
   query. The engine code for this already exists in `neuroai/contracts.py`;
   what's missing is only the Atlas-side wiring.

**Live-source facet:** because `neuroai/sources/lsl.py` and `brainflow.py`
exist, datasets whose acquisition parameters match a live-streaming replay
profile can be tagged `replayable_via: [lsl, brainflow]` — directly useful for
teams testing a real-time pipeline against recorded data before deploying it
on live hardware.

---

### 2.10 Empirical Cost-Aware Ranking (Tier S) — atlas_timing as a ranking signal, not just UX copy

**Data:** `atlas_timing`'s per-`(operation, dataset_id)` `median_s`/`p90_s`
history — collected today, used only for progress-bar text.

**Mechanism.** Define, for the current unresolved-unknowns set of a candidate
(from Part 1 Stage 4's evidence partitioning), an **evidence latency score**:

```text
latency_to_full_evidence(d) = Σ_{unknown u in d}  atlas_timing.estimate(op(u), d).median_s
                               (fallback to global "*" median if d has no history)
```

Exposed as a literal secondary sort key ("same fitness tier → prefer the
candidate that's cheaper to fully verify") and as a UI badge (`~4s to full
evidence` vs `~40s`). This is a genuinely CTO-flavored feature: it uses
telemetry Qortex is *already collecting for free* and turns it into a
user-facing efficiency signal, at zero new instrumentation cost.

---

### 2.11 Evidence Acquisition Optimizer (Tier S) — probe batching as set cover

**Data:** the "unknown" partition from Part 1 Stage 4, across an entire result
page (not one dataset).

**Mechanism.** This is the natural generalization of §2.10: instead of
resolving unknowns dataset-by-dataset, formalize resolving a *result page's*
unknowns as a **weighted minimum set cover**:

```text
universe U        = { blocking unknowns across the top-k result page }
each candidate probe p covers a subset cover(p) ⊆ U  (e.g. one sidecar fetch
    resolves "events complete?" for every recording sharing that sidecar
    via BIDS inheritance — one probe can cover several unknowns at once)
cost(p)           = atlas_timing-estimated latency/bytes for p
```

Greedy set cover (pick the probe maximizing `|uncovered ∩ cover(p)| / cost(p)`,
repeat) gives the standard `ln(|U|)` approximation guarantee — a real algorithm
with a real bound, not a vague heuristic. Issued as **one batched background
job** via the existing `atlas_jobs` registry. User-facing framing: *"Resolve 11
of 14 unknowns on this page with one batch of 4 probes (~6s, ~40KB)"* — a
single button that turns a page of "unknown" badges into "confirmed"/"fail"
with minimal total cost. This directly operationalizes `qortex-atlas.md` §18's
"the UI should expose uncertainty" into something actionable rather than just
honest.

---

### 2.12 Query-by-Example over a Joint Fingerprint (Tier L)

**Data:** concatenation of §2.1's protocol vector, §2.4's label-cluster
membership, and cohort's demographic summary vector (mean age, sex ratio,
diagnosis-group entropy from `cohort/builder.py`'s `CohortSubject` rows).

**Mechanism.** A fixed (not learned, for v1 — avoids training-data risk) linear
projection concatenating the three normalized sub-vectors, L2-normalized,
searched via cosine in the same local ANN index used for Part 1's semantic
retriever (§4.3 there). `qortex atlas neighbors ds004130 --joint` — "similar in
acquisition protocol AND label space AND population," a strictly stronger and
more specific similarity notion than either text-embedding similarity or
protocol-only similarity alone. A learned metric (e.g. a small contrastive
model trained on the same-PI/same-grant co-occurrence signal from §2.8 as weak
supervision) is a valid Tier-L upgrade path, explicitly deferred.

---

### 2.13 Corpus-Wide Statistical Gap/Opportunity Engine (Tier D) — real formulas

`qortex-atlas.md` §12.1 and §12.6 describe "negative space" and "opportunity"
qualitatively. Here are the actual computations.

**Coverage/gap detection.** Bucket every recording by
`(modality, paradigm_class [§2.2], subject_count_decile)`. Compute the
occupancy distribution `p_i = count(bucket_i) / total`. Shannon entropy
`H = −Σ p_i log(p_i)` over the full bucket space summarizes overall corpus
concentration; buckets with `p_i` below a sparsity threshold (e.g. bottom
decile of nonzero buckets) are reported as literal gaps:
`"EEG × oddball_mmn × 50-100-subjects: 2 datasets in the whole corpus"`.

**Opportunity score** (peer-normalized, not raw popularity — raw counts would
just reward old, well-known datasets):

```text
opportunity(d) = quality(d) · (1 − engagement_percentile(d | peer_group(d)))

quality(d)              = MLReadinessScore(d) / 100          (already computed, §0.1)
peer_group(d)            = datasets sharing modality + paradigm_class
engagement_percentile(d) = percentile rank of (views + downloads + 3·stars)(d)
                            within peer_group(d)
```

A dataset scores high `opportunity` when it's structurally excellent (real
labels, real QC per §2.5, adequate subjects) **and** relatively unused compared
to *its own peers* — the peer normalization is what prevents this from just
re-deriving "old and famous" or "new and unknown."

**Schema:** these are query-time aggregates over already-materialized tables
(`protocol_signatures`, `paradigm_classifications`, `subject_qc`, catalog
engagement fields) — no new persisted table required beyond a materialized
view refreshed on catalog refresh.

---

### 2.14 Incremental, hexsha-Diffed Ingestion (Tier S — architecture, not a "feature," but load-bearing)

**Data:** `SnapshotRef.hexsha` (already the stable content hash Qortex uses for
cache invalidation) + the existing `LocalIndexReport` reconciliation logic
(`missing_remote[]`, `extra_local[]`, `size_mismatches[]`).

**Mechanism.** Every feature above (§2.1–§2.5, §2.9) is only affordable at
corpus scale if re-ingestion is *incremental*. On `atlas refresh`: if
`hexsha` unchanged, skip entirely (already true today for the catalog). If
changed, **diff the old and new file manifest by path** — reusing the exact
comparison logic `LocalIndexReport` already implements for a different purpose
— to get the changed-file set, map it to the affected `LogicalRecording`s via
`ManifestGraph`, and re-run only §2.1/§2.2/§2.3/§2.5's derivations for *those*
recordings. Without this, a snapshot bump on one dataset would force
recomputing protocol fingerprints, paradigm classes, and QC rollups for the
whole corpus — an unnecessary O(corpus) cost turned into O(changed files) for
free, using a diffing capability that already exists for an unrelated purpose.

---

## 3. Updated knowledge-graph schema (additive to `qortex-atlas.md` §6)

**New node types:** `ProtocolSignature`, `ParadigmClass`, `LabelCluster`,
`MontageSet`, `SubjectQCReport`, `ComplianceFlag`, `Researcher` (pseudonymous),
`Paper` (resolved from DOI, optional external enrichment).

**New edge types:**

```text
Recording HAS_PROTOCOL_SIGNATURE ProtocolSignature
ProtocolSignature SIMILAR_PROTOCOL_TO ProtocolSignature   (weight = 1-gower)
Recording CLASSIFIED_AS ParadigmClass                     (+criteria_matched)
Dataset   IN_LABEL_CLUSTER LabelCluster                   (+coverage)
Recording HAS_MONTAGE MontageSet
MontageSet SHARES_MONTAGE_WITH MontageSet                 (weight = jaccard)
Subject   HAS_QC_REPORT SubjectQCReport                   (+source=mriqc/fmriprep)
Dataset   FLAGGED ComplianceFlag                          (+affirmed_defaced/consent)
Researcher STARRED Dataset                                (pseudonymous, opt-in)
Dataset   CO_STARRED_WITH Dataset                          (weight = PMI)
Dataset   CITES / CITED_BY Paper                           (optional enrichment)
```

**New catalog tables:** `protocol_signatures`, `paradigm_classifications`,
`label_clusters`, `dataset_label_membership`, `channel_sets`, `subject_qc`,
`compliance_flags`, `researcher_dataset_edges`, `evidence_probe_costs`.

---

## 4. CTO view — architecture, reuse, cost, risk

### 4.1 Reuse map (do not build parallel infrastructure)

| New capability | Reuses | Why |
|---|---|---|
| All batch/deep ingestion (derivatives, channels.tsv, social graph) | `atlas_jobs.py` | Generic job registry already handles progress, logs, thread-pool bounds — every new "slow op" is a `submit()` call, not new plumbing |
| All expensive per-dataset computation (fingerprints, paradigm class, montage hash) | `atlas_cache.py` | Single-flight TTL cache already solves the thundering-herd problem for concurrent tab loads; reuse the same class, don't reinvent keyed caching |
| All new "unknown/confirmed" claims (compliance, trust tier, QC) | `atlas_evidence.py`'s `Claim(group, source, cost_hint)` | Extending the `group` taxonomy is a few new string constants; a rival evidence model would fragment the UI's single evidence vocabulary — explicitly rejected |
| Cost visibility for every new probe type | `atlas_timing.py` | Register the operation name (`"mriqc_ingest"`, `"channels_tsv_fetch"`, `"protocol_fingerprint"`) at the call site from day one — the evidence-cost optimizer (§2.11) is only as good as the timing data backing it, so instrumentation is not optional/later, it's part of the initial PR |

### 4.2 Ontology and ruleset versioning

Every derived entity that depends on a synonym map or a rule set
(`label_clusters.ontology_version`, `paradigm_classifications.ruleset_version`)
must be **stamped with the version that produced it**. This is not
bureaucracy — it's what makes "we changed the oddball-detection rule and now 40
datasets reclassify" a diffable, auditable event instead of silent drift. Store
ontology/ruleset YAMLs under version control with semver tags; a catalog
refresh records which version ran.

### 4.3 Ingestion cost discipline (the real scaling risk)

OpenNeuro currently hosts on the order of several thousand public datasets.
Every feature in §2 that touches `channels.tsv`, `participants.tsv` beyond
`age/sex/group`, or `derivatives/` is **strictly more expensive** than today's
catalog-only ingestion. The explicit policy, not optional:

```text
Level 0 (catalog)  → eager, whole corpus, cheap (already true today)
Level 1 (manifest) → eager for datasets matching any saved/common facet,
                      lazy otherwise
Level 2+ (this doc)→ NEVER eager for the whole corpus.
                      Triggered only for: (a) datasets surviving a live
                      search's Stage-1 structural filter, (b) datasets a
                      user explicitly opens, (c) a background "deepen the
                      top N% by opportunity score" job run on an operator-
                      set schedule/budget, never unbounded.
```

This is a direct CTO risk call-out: without this tiering, "ingest MRIQC for
every T1w dataset" is an unbounded background cost with no natural stopping
point. The tiering above gives it one.

### 4.4 Storage growth

Participant-level rows, per-subject QC rows, and the social graph are 10–100×
more rows than today's dataset-level catalog. DuckDB handles this locally
without issue, but plan for it explicitly: add a `compact`/prune path (already
named as a CLI verb in `qortex-atlas.md` §8) that drops derived rows whose
source `hexsha` is no longer the latest snapshot and hasn't been queried in N
refreshes — otherwise the local store accumulates zombie evidence from
superseded snapshots forever.

### 4.5 Technical risk register

| Risk | Mitigation |
|---|---|
| Paradigm-classification rules overfit to the datasets used to write them | Ship rule-based (auditable) first; track rule-match rate corpus-wide as a health metric; only train a learned classifier once mismatches are logged at volume |
| Protocol-fingerprint z-scores drift as corpus composition shifts (adding many EEG datasets shifts what "normal" sfreq looks like) | Welford incremental mean/std (already specified in §2.1) recomputes cheaply; version-stamp the z-score baseline like the ontology, so old fingerprints can be flagged stale and lazily recomputed |
| MRIQC/fMRIPrep derivatives are absent for many datasets (community-contributed, not guaranteed) | Treat as **evidence, not requirement** — `subject_qc` rows are simply absent (evidence state `unknown`), never inferred; §2.5 is additive, not a new hard dependency |
| OpenNeuro API rate limits under heavier Level-2 ingestion | Already-existing `RemoteFileGateway` retry/backoff + `_TTLCache` absorb burst load; Level-2 tiering (§4.3) bounds total call volume structurally, which matters more than backoff tuning |

---

## 5. CIO view — governance, privacy, compliance

This section exists because §2.5 and §2.8 introduce genuinely new categories
of sensitive data into a system that, until now, only cached dataset-level
public metadata. That is a material change in Atlas's data-handling posture,
not an incremental one — it deserves its own review, not a footnote.

### 5.1 Aggregation risk on participant-level data

`participants.tsv` fields (age, sex, diagnosis/group, and dataset-specific
columns like `handedness`, `MMSE`, `disease_duration`) are already public on
OpenNeuro *per dataset*. The risk Atlas introduces is **cross-dataset
aggregation** — joining participant rows across many datasets (for cohort
composition, §2.13's peer grouping, or just local caching) can re-identify
individuals in small strata even though no single source dataset does. Policy:

- Apply a **k-anonymity threshold** (k=5 suggested default, operator-tunable)
  before persisting or displaying any aggregate stratified by more than one
  quasi-identifier (e.g. age × diagnosis × site) — below threshold, bucket
  (5-year age bands) or suppress the cell rather than showing exact counts.
- This applies even though OpenNeuro itself is public data — the point is that
  the *cross-dataset join* is a new capability Atlas creates, and the risk
  profile of a join is not the same as the risk profile of its inputs
  considered separately.

### 5.2 Social graph — pseudonymization is not optional

`stars[].userId`/`followers[].userId` are real platform user identities. §2.8's
collaborative-filtering feature must:

- Store only a **salted one-way hash** of `userId`, never the raw platform ID,
  so the graph is useless for re-identifying a specific researcher outside of
  Qortex even if the local store leaked.
- Ship as **opt-in**, gated by an explicit setting (`atlas.social_graph.enabled`)
  — collaborative-filtering value is real (§2.8) but is the one feature in this
  document built on identity data rather than dataset-content data, and
  deserves a higher bar for enablement than everything else here.
- Never surface individual star/follow edges in any UI — only corpus-level
  aggregates (co-star PMI between two *datasets*), never "researcher X starred
  dataset Y" as a rendered fact.

### 5.3 License enforcement at ingestion, not just at display

Today, `license` is a read-time UI facet. That's insufficient once Atlas caches
participant-level or derivative data: a dataset under a restricted-access
license may permit *viewing* metadata on OpenNeuro but not necessarily
persisting derived participant-level data to a third-party local store
indefinitely. Policy: add a `license_gating` table enforced in
`catalog/index.py` at **write time** — non-open licenses (outside the existing
`_OPEN_LICENSES` set already defined in `inspect/selector.py`) restrict which
tables a refresh is allowed to populate (catalog-level metadata always OK;
`subject_qc`/`researcher_dataset_edges`/raw `participants.tsv` columns gated).

### 5.4 Compliance flags are a duty of care, not a UI nicety

§2.6's `affirmedDefaced`/`affirmedConsent` gating exists so Atlas doesn't let a
user unknowingly build a pipeline on non-defaced anatomical MRI without ever
seeing that fact. This is presented in §2.6 as a hard-fail-style blocking
banner specifically because a scoring dimension that can be averaged away
(like every other fitness dimension) is the wrong shape for a re-identification
risk — CIO framing: silence here is a duty-of-care failure, not just a UX gap.

### 5.5 Full provenance on every derived claim

Every new entity type in §3 must carry the same provenance discipline Qortex
already has for `ProvenanceRecord` (`qortex_version`, `created_at`, source
files, operation): `protocol_signatures.corpus_zscore_version`,
`paradigm_classifications.ruleset_version`,
`label_clusters.ontology_version`, `subject_qc.mriqc_version`. Reproducibility
is Atlas's actual product promise to scientists — an unversioned derived claim
is a claim that cannot be reproduced six months later when the ontology or
ruleset has moved on.

### 5.6 Cost governance

Corpus-scale ingestion (§4.3) and any Tier-L embedding/LLM usage (Part 1 §3c,
§4.3) both have real compute/API cost at thousands-of-datasets scale. Policy:
lazy-only ingestion (§4.3) is also a cost control, not just a latency one;
cache `QueryPlan` compilations by normalized query hash so repeated natural-
language queries don't re-spend on LLM slot-filling; track cumulative spend
per operation type via the same `atlas_timing` counters, extended to record a
`cost_hint` (bytes/tokens) alongside duration.

### 5.7 Retention

Derived claims tied to a superseded `hexsha` (§4.4) should have a defined
expiry, not persist as zombie evidence. Recommended: purge derived rows for a
snapshot once N newer refreshes have superseded it, mirroring the compaction
policy already named in §4.4 — retention and storage-growth mitigation are the
same mechanism viewed from two angles (cost engineering vs. data governance).

---

## 6. Revised roadmap (extends Part 1 §12)

Part 1's four-phase build-the-engine roadmap is unchanged as the retrieval/
ranking foundation. This document adds two phases that plug into it:

**Phase 3.5 — Deep evidence mining** (after Part 1 Phase 3's semantic layer,
before Phase 4's full graph promotion):
- §2.1 protocol fingerprints, §2.2 paradigm classification, §2.3 channel/montage
  intersection — all Tier S, all deterministic, all reuse `atlas_cache`/
  `atlas_jobs`/`atlas_timing` per §4.1.
- §2.5 derivatives QC ingestion — the single highest-leverage item in this
  document; should be prioritized first within this phase.
- §2.6 compliance gating, §2.7 two-tier trust — small, high-duty-of-care,
  cheap to ship, extend `atlas_evidence.py`'s claim taxonomy directly.

**Phase 5 — Social graph & corpus intelligence** (after Part 1 Phase 4's graph
retriever is live, since §2.8's social edges plug into the same fusion stage):
- §2.4 label topology clustering (needs a populated corpus graph to be
  meaningful).
- §2.8 social/collaborative graph — ship behind the opt-in gate from §5.2.
- §2.13 corpus-wide gap/opportunity engine — needs §2.2's paradigm buckets and
  §2.5's QC data populated first, so it is necessarily last.
- §2.9's full NeuroAI-native indexing (pre-computed compatibility as a facet)
  can ship earlier, in parallel with Phase 3.5, since it depends only on
  `signal_budget` (already Level-2) and the existing `CompatibilityEngine` —
  it is purely a wiring/indexing task, not a new algorithm, and should not
  wait for Phase 5.
- §2.10/§2.11 (cost-aware ranking, evidence-acquisition set-cover) are
  low-risk, high-polish, and can ship any time after `atlas_timing` has
  accumulated enough samples to be useful — realistically, once Phase 3.5's
  new operations have run enough times to populate real history.

---

## 7. Summary — what actually changed between Part 1 and Part 2

Part 1 designed a hybrid retrieval engine that would be correct for *any*
dataset catalog. Part 2 is the argument that Qortex/OpenNeuro's specific,
mostly-unused data — event-timing statistics, sidecar acquisition parameters,
channel-level QC, MRIQC/fMRIPrep derivatives, star/follow identity, the full
NeuroAI contract system — supports features no generic catalog search could
offer: protocol-fingerprint neighbor search with a real mixed-type distance
metric, deterministic paradigm classification from raw timing data, a
channel-set-cover algorithm that makes "restrict to common channels" a
computed trade curve instead of a suggestion, subject-level motion QC with zero
local computation, a set-cover-optimal evidence-acquisition batcher, and a
peer-normalized opportunity score. Each is specified down to the formula and
the schema, each names exactly which existing Qortex/Atlas infrastructure it
reuses (`atlas_cache`, `atlas_jobs`, `atlas_timing`, `atlas_evidence`), and each
carries an explicit governance treatment where the data is sensitive (§5) or a
scaling discipline where the ingestion is expensive (§4.3). That combination —
real formulas, named reuse, and an explicit governance/cost pass — is what
makes this a build plan rather than a features list.
