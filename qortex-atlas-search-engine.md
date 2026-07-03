# Qortex Atlas — Search & Filtering Engine Design

> Companion to `qortex-atlas.md`. That document defines *what* Atlas is (a local
> neurodata intelligence graph). This document defines *how* the search and
> filtering engine inside it should actually work: the retrieval methods, the
> ranking model, the query-understanding layer, the way filters treat
> uncertainty, and a feasible build order. It is grounded in the current Qortex
> code, and it says explicitly what to keep, what to replace, and why.

---

## 0. Why the current search is "naive" — a precise diagnosis

Before proposing anything, here is exactly what exists today and where it breaks.
This matters: the fix has to target real defects, not a strawman.

**Current retrieval** — `CatalogIndex.search()` (`src/qortex/catalog/index.py`):

1. Apply SQL filters (`modality`, `task`, `author`, `license`, `min_subjects`,
   `max_size_gb`, `has_events`, `has_derivatives`).
2. Score survivors with `_score()`: a hand-weighted **substring token-overlap**
   over text fields (`dataset_id`, `name`, `description`, `tasks`, `keywords`, …).
3. Sort by score, then `n_subjects`, then `n_files`.

**Current "hybrid"** — `/search/hybrid` merges *local catalog* ∪ *live OpenNeuro*
results, tagged by provenance. This is a **source merge**, not a **method fusion**.
The name is misleading and should be disambiguated (see §7).

**Current goal ranking** — `/goal/find` → `DatasetSelector` → `DatasetFitness`
is actually good: it is a transparent, per-dimension, hard-fail-aware scorer. It
is the one piece we keep and promote (see §5).

### The concrete defects

| # | Defect | Consequence |
|---|--------|-------------|
| D1 | **Lexical-literal matching.** `token in text`. | "motor imagery" misses "imagined movement", "MI", "leftHandImagery". "sleep staging" misses "polysomnography". OpenNeuro's task/description text is wildly inconsistent, so recall is poor and silent. |
| D2 | **No IDF / relevance model.** Integer weights, every occurrence counts equally. | "brain" and "MRI" (in nearly every dataset) contribute as much as a rare discriminative term. Ranking is dominated by common words. |
| D3 | **Text-only ranking.** `_score()` never looks at structure. | Atlas's entire thesis (`qortex-atlas.md` §3) is that the decisive facts live in file paths, BIDS suffixes, `events.tsv` columns, sidecars, channel counts, TR — *not* the description. The ranker ignores all of it. |
| D4 | **Brittle filters.** `LOWER(modality)=LOWER(?)`, exact task string equality. | No modality hierarchy (`MRI`→`func/anat/dwi`), no synonym normalization (`bold`/`fmri`/`func`). A dataset tagged `func` is invisible to a `modality=fmri` query. |
| D5 | **No query understanding.** "EEG, ≥40 subjects" is tokenized; "40" and "subjects" become text tokens. | The quantitative constraint is never extracted. Free-text goals degrade to bag-of-words. |
| D6 | **Filters silently drop "unknown."** `has_events = 0/1`. | A dataset whose event-completeness is *unverified* is treated identically to one *confirmed* to have none. This contradicts Qortex's own evidence-state philosophy (`qortex-atlas.md` §18). |
| D7 | **No semantic layer at all.** `searchHybrid` in `app/js/api.js` implies one; none exists. | No paraphrase/concept matching, no "more like this", no cross-dataset neighborhood. |
| D8 | **No typo/fuzzy tolerance, no phrase handling.** | "parkinsons", "schizophrenia" misspelled, or multi-word paradigm names, all silently under-recall. |
| D9 | **No aggregate / negative-space intelligence.** | Cannot answer "42 EEG motor datasets, only 7 ML-ready" (`qortex-atlas.md` §12.1), the single most distinctive feature. |

Everything below is organized to kill D1–D9 specifically, in a feasible order.

---

## 1. Design principles (the non-negotiables)

These follow directly from Qortex's stated philosophy and keep the engine honest.

1. **Evidence-first, text-last.** Text and semantics are *recall* devices (find
   candidates). Structure is the *precision* device (rank and gate them). Free
   text never overrides a confirmed structural fact.
2. **Three-valued everything.** Every constraint resolves to
   `confirmed | inferred | unknown | fail` — never a silent boolean. "Unknown"
   is a first-class result the user can choose to include, with a suggested
   cheapest probe to resolve it. (Kills D6.)
3. **Explainable by construction.** Every retrieved result carries *why it was
   retrieved* (which retriever, which matched feature) and *why it ranks where it
   does* (per-dimension fitness). No opaque scalar. A learned re-ranker, if ever
   added, is an enhancement on top of the interpretable model — never the source
   of truth. (Reinforces `qortex-atlas.md` §16, §20.4.)
4. **Local-first, tiered escalation.** Cheap signals answer instantly; expensive
   signals (live API, remote header range-reads) are computed lazily and only for
   the top-k that survive fusion. (Matches the existing `DatasetSelector` tiering.)
5. **One engine, many entry points.** `search`, `find`, `explain`, `compare`,
   `neighbors`, `complement`, `gaps`, `compatible-datasets` are the *same
   pipeline* with different query plans and output projections (see §9).
6. **Measurable.** "Production-grade" means an offline eval harness gates every
   change (see §11). We ship a method only if it moves nDCG without hurting
   constraint-precision.

---

## 2. The pipeline (the universal shape)

Every query — structured, natural-language, or a dataset seed — flows through
the same typed stages. Different features light up different stages, but the
contract between stages never changes.

```text
             ┌──────────────────────────────────────────────────────────────┐
  raw query  │  Stage 0  QUERY COMPILER                                       │
  (text /    │    grammar + ontology + (optional) LLM slot-filler            │
   form /    │    → QueryPlan { hard constraints, soft signals,              │
   seed)     │                  semantic intent vec, expanded lexical terms }│
             └───────────────┬──────────────────────────────────────────────┘
                             │
             ┌───────────────▼──────────────────────────────────────────────┐
  Stage 1    │  MULTI-RETRIEVER CANDIDATE GENERATION  (recall)               │
  (parallel) │   1. Structured/faceted  (DuckDB set-filter → admissible set) │
             │   2. Lexical BM25        (FTS inverted index, IDF-weighted)   │
             │   3. Semantic dense      (embeddings over structure-cards)    │
             │   4. Graph expansion     (SIMILAR_TO / SHARES_LABEL_SPACE)    │
             │  each emits (id, score, matched_features+provenance)          │
             └───────────────┬──────────────────────────────────────────────┘
                             │
             ┌───────────────▼──────────────────────────────────────────────┐
  Stage 2    │  FUSION   Reciprocal Rank Fusion (weighted by QueryPlan)      │
             │  → single candidate list (top ~200), provenance preserved     │
             └───────────────┬──────────────────────────────────────────────┘
                             │
             ┌───────────────▼──────────────────────────────────────────────┐
  Stage 3    │  STRUCTURAL RE-RANK   (precision)  = DatasetFitness engine     │
             │  per-dimension, evidence-tagged, hard-fail gating             │
             │  computed only for fused top-k (bounded, cheap)               │
             └───────────────┬──────────────────────────────────────────────┘
                             │
             ┌───────────────▼──────────────────────────────────────────────┐
  Stage 4    │  EVIDENCE-PARTITIONED FILTER + LIVE FACETS                    │
             │  each constraint → {confirmed | inferred | unknown | fail}    │
             │  facet counts recomputed over current admissible set         │
             └───────────────┬──────────────────────────────────────────────┘
                             │
             ┌───────────────▼─────────────┬────────────────────────────────┐
  Stage 5/6  │  PROJECT (per view)         │  EXPLAIN + NEGATIVE-SPACE       │
             │  ranked cards / fitness      │  why / blockers / next probe /  │
             │  report / neighbor graph     │  "N found, M ready, rejected…"  │
             └─────────────────────────────┴────────────────────────────────┘
```

The key insight: **Stages 1–2 are recall (find everything plausibly relevant),
Stage 3 is precision (rank by real fitness), Stage 4 is honesty (partition by
certainty).** The current code collapses all three into one substring score.

---

## 3. Stage 0 — Query compiler (kills D5)

The compiler turns any input into a `QueryPlan`, the shared contract. It
separates **hard constraints** (set operations, must pass) from **soft signals**
(contribute to rank) — a distinction the current flat scorer erases.

```python
@dataclass
class QueryPlan:
    hard: dict[str, Constraint]     # modality∈{eeg}, subjects≥40, license∈open …
    soft: dict[str, float]          # task_intent=motor_imagery(0.9), cross_subject(0.7)
    lexical_terms: list[str]        # expanded, synonym-enriched, for BM25
    semantic_text: str | None       # cleaned free text, for the query embedding
    provenance: dict                # which extractor produced each slot + confidence
```

Three extraction layers, cheapest first:

**(a) Deterministic grammar** for quantitative constraints. Regex + unit parsing:
`"at least 40 subjects"` → `subjects≥40`; `"under 20 GB"` → `size≤20e9`;
`"open license"` → `license∈open_set`; `"≥2 classes"` → `n_classes≥2`. No LLM,
fully testable, no hallucination risk. This *is* the "research-goal compiler" of
`qortex-atlas.md` §12.2, and it already has a target type: `ResearchGoal`
(`src/qortex/inspect/selector.py:53`). The compiler's job is to *populate a
`ResearchGoal`* from free text.

**(b) Controlled-vocabulary normalization** via a curated, versioned neuro-ontology
(YAML). This kills D1 and D4 at the source. Three families:

- *Modality* — synonym + hierarchy:
  `{fmri, bold, func, "functional mri"} → func/bold`;
  `{dwi, dti, diffusion} → dwi`; `{ecog, seeg, ieeg} → ieeg`;
  `{fnirs, nirs} → nirs`; `{t1, t1w, anatomical, structural} → anat/T1w`;
  `MRI → {anat, func, dwi, fmap}` (expands to children).
- *Paradigm / task* — synonym clusters:
  `{"motor imagery", MI, "imagined movement", "left/right hand imagery"}`,
  `{"n-back", "working memory", wm}`, `{sleep, polysomnography, psg}`,
  `{"go/no-go", gonogo, "stop signal", inhibition}`, `{oddball, MMN, "mismatch negativity"}`, …
- *Population / clinical* —
  `{children, pediatric, kids, infant, adolescent}`,
  `{patients, clinical, TBI, stroke, parkinson, alzheimer, adhd, schizophrenia, epilepsy}`.

  **The unique-to-OpenNeuro move:** *seed these clusters from OpenNeuro's own
  data.* Mine the real distribution of `task-*` BIDS entity values across every
  indexed dataset, and the real `group`/`diagnosis` columns from
  `participants.tsv`. The synonym map is then grounded in the actual label
  vocabulary scientists use in the corpus, not a generic thesaurus. Unknown query
  terms that returned nothing get logged and become candidate ontology additions
  (§11 feedback loop).

**(c) LLM slot-filler** — *only* for residual free text the grammar+ontology
didn't capture, and it must emit **typed slots with confidence + provenance**,
surfaced to the user for confirm/reject, never silently applied (`qortex-atlas.md`
§15, §20.2). The LLM proposes structure; the deterministic layers and the user
ratify it.

---

## 4. Stage 1 — Multi-retriever candidate generation (kills D1, D2, D7, D8)

Four retrievers run in parallel. Each covers a different failure mode of the
others; that redundancy is the whole point of a hybrid engine.

### 4.1 Structured / faceted retriever (DuckDB)
Applies the QueryPlan's **hard constraints** as set filters over the *normalized
structural tables* (`qortex-atlas.md` §17: `files`, `logical_recordings`,
`label_profiles`, `protocol_profiles`), not just the denormalized dataset row.
Defines the **admissible set** (hard constraints, exact) and — crucially — also
emits the **near-miss set** (fails exactly one hard constraint) to feed
negative-space analysis (§8). Upgrade over today: `has_events` becomes
`EXISTS an events.tsv companion for a primary recording, with evidence status`,
and modality derives from file datatypes/suffixes, not a free-text string.

### 4.2 Lexical BM25 retriever (kills D2, D8)
Replace `_score()`'s substring overlap with a real **inverted index + Okapi
BM25**. Both candidate backends ship this locally with zero services:
**DuckDB FTS extension**, or **SQLite FTS5** (BM25 built in). Index a *fielded*
document per dataset with per-field boosts:

```text
name^6  task_labels^5  keywords^3  description^3  authors^2  readme^1
+ derived structural tokens: modalities-present, suffixes-present,
  has-events, channel-count-bucket, TR-bucket, sfreq-bucket, species
```

IDF now handles D2 for free (rare terms dominate). Add **trigram / Jaro-Winkler**
fuzzy expansion for query terms (both engines support it) to kill D8. Note the
derived structural tokens: this is how lexical search gets a *taste* of structure
cheaply, before the full structural re-rank in Stage 3.

### 4.3 Semantic dense retriever (kills D1, D7)
The novel part. **Do not embed the raw description** — `qortex-atlas.md` §3 is
right that descriptions are weak and inconsistent. Instead, synthesize a
**structure-derived semantic card** per dataset and embed *that*:

```text
"EEG motor-imagery dataset. 52 subjects. trial_type labels:
 {left_hand, right_hand, feet, tongue} (4 classes, balanced ~1.1).
 64 channels @ 250 Hz. Events complete for all subjects. Open license (CC0).
 Paradigm: cued limb motor imagery. Session: single."
```

That card is generated deterministically from the structural evidence (plus the
human description appended). Embedding structure-as-prose is what lets a query
like "cross-subject movement decoding" match a dataset whose description says
nothing but whose *labels and protocol* clearly fit. Store vectors in a local
index — **sqlite-vec** (simplest, in the same DB) or **LanceDB** (columnar,
multi-vector, metadata pre-filtering). Use a compact local embedding model
(e.g. a `bge`/`e5`-class sentence encoder) so it is offline and reproducible;
cache vectors keyed by `text_hash` (the `embeddings` table in §17 already has the
column) so re-embedding happens only when the card changes.

Go **multi-vector**: embed the *paradigm* string and the *label-class set*
separately from the whole card, so label-space similarity is a first-class
retrieval signal (directly serves benchmark composition and complements).

Prefer **pre-filtered ANN**: apply the hard-constraint mask, *then* nearest-
neighbor within it — keeps semantics from surfacing inadmissible datasets.

### 4.4 Graph-expansion retriever (enables neighbors/complement)
Seed from datasets already matched by (1)–(3), traverse the Atlas graph edges
(`SIMILAR_TO`, `SHARES_LABEL_SPACE`, `COMPLEMENTS`, `qortex-atlas.md` §6). Pulls
in datasets that are structurally adjacent but lexically/semantically dissimilar
— e.g. the same paradigm from a *different site/authors*, exactly what
cross-dataset generalization and benchmark building need.

Each retriever returns `(dataset_id, retriever_score, matched_features[])` where
each matched feature carries its provenance for the explanation layer.

---

## 5. Stages 2–3 — Fusion, then structural re-rank

### 5.1 Fusion (Stage 2)
Combine the ranked lists with **Reciprocal Rank Fusion (RRF)**:

```text
score(d) = Σ_retrievers  w_r / (k + rank_r(d))          # k≈60, standard
```

RRF is the production-standard way to merge lexical + dense because it is robust
and **scale-free** — BM25 scores and cosine similarities are not comparable, and
RRF never has to make them comparable. Weights `w_r` come from the QueryPlan: a
crisp structured query down-weights semantics; a vague conceptual query
up-weights it. Per-retriever contributions stay attached: *"retrieved because
BM25 term 'imagery' (rank 3) + semantic sim 0.71 (rank 1) + facet modality=eeg."*

### 5.2 Structural re-rank = the Fitness engine (Stage 3) — **reuse, don't rebuild**
The fused top-k (~200, bounded → cheap) is re-ranked by the **existing**
`DatasetFitness` / `DimensionScore` machinery (`src/qortex/inspect/selector.py:131`).
This already is exactly the transparent, per-dimension, hard-fail-aware,
evidence-decomposed re-ranker this design calls for. It computes the fitness
dimensions of `qortex-atlas.md` §16 (modality fit, subject adequacy, label
readiness, event completeness, companion completeness, class balance, split
safety, signal budget, download efficiency, license, QC, model compatibility),
each with `score`, `weight`, `met`, `value`, `target`, `note`.

What changes: today it's invoked only by `/goal/find`. In the new architecture it
becomes **the universal Stage 3 re-ranker for every query type**, fed by the
fused candidate set instead of a raw catalog scan. This is the moment "search"
becomes "dataset fitness" — the core promise of Atlas.

**Hard-fail gating with evidence discipline:** a dataset that violates a hard
constraint with *confirmed* evidence is removed (shunted to near-miss). One that
*might* violate (evidence `unknown`) is **kept and flagged**, never silently
dropped — the exact opposite of today's `has_events=0` behavior (D6).

The re-ranker stays interpretable (transparent weighted sum). A learned LTR model
(LambdaMART / GBDT over the same features, trained on click/download feedback)
can *reorder within* the interpretable tiers later, but never overrides hard
constraints or evidence states.

---

## 6. Stage 4 — Filtering as evidence partitioning (kills D6)

This is a genuine departure from every dataset-search UI, and it is the most
Qortex-native idea here. A filter over uncertain data must be **three-valued**,
not boolean. For each constraint, partition the admissible set:

| Partition | Meaning | Example |
|-----------|---------|---------|
| **PASS · confirmed** | Verified from data | `events.tsv` fetched, `trial_type` present with 4 classes |
| **PASS · inferred** | Metadata suggests, unverified | manifest lists an `events.tsv`, columns not yet read |
| **UNKNOWN** | Cannot tell without deeper ingestion | needs a sidecar/header probe |
| **FAIL · confirmed** | Verified violation | no event files exist at all |

The UI filter chip then reads:
`events complete → 120 confirmed · 45 inferred · 30 unknown · 98 no`, and the
user picks a risk posture (strict = confirmed only; permissive = confirmed +
inferred + unknown). Each **UNKNOWN** carries the *cheapest next probe* to resolve
it ("fetch 1 sidecar, ~2 KB"), tying filtering directly to the tiered-ingestion
model.

Alongside: **faceted counts recomputed over the current admissible set**
(e-commerce-style mutually-refining facets), which DuckDB group-bys make trivial.
Every facet value shows how many results selecting it would yield.

---

## 7. Disambiguating "hybrid"

Two orthogonal axes are both called "hybrid" and must be separated:

- **Method fusion** (this document): lexical ∪ semantic ∪ structured ∪ graph, via RRF.
- **Source merge** (today's `/search/hybrid`): local cache ∪ live OpenNeuro.

Keep both, but name them distinctly. Source is a *provenance* concern
(`_source: local|live`, already tagged) that sits *underneath* every retriever —
each retriever can draw from local index and, for the surviving top-k, escalate
to live OpenNeuro. Method fusion sits in Stage 2. Suggested surface:
`/search` (method-fused, the real engine) with a `live=true|false` flag for the
source axis; retire the `/search/hybrid` name or alias it.

---

## 8. Stage 5 — Negative-space & aggregate intelligence (kills D9)

Because Stage 1's structured retriever already produced the near-miss set and
full facet counts, Atlas emits a **second output channel** beside the ranked
list: a diagnostic over the whole corpus slice.

```text
Query: EEG motor imagery, cross-subject
  63 EEG motor-related datasets in scope
  → 9 ML-ready (≥20 subjects, confirmed labels, channel metadata present)
  → 54 rejected:  28 too few subjects
                  14 no confirmed label column
                   8 missing channels.tsv
                   4 events incomplete for ≥1 subject
  → 11 resolvable with one metadata-only probe (currently UNKNOWN on labels)
```

This is `qortex-atlas.md` §12.1 made real, and it is the feature no generic
dataset search offers, because it requires the structural evidence graph plus the
three-valued partitioning to even be expressible.

---

## 9. One engine, many entry points (the "universal pipeline")

All Atlas query verbs are the same pipeline with a different `QueryPlan` and a
different Stage-5 projection:

| Verb | QueryPlan emphasis | Dominant retriever | Projection |
|------|--------------------|--------------------|------------|
| `search` | lexical + facets | BM25 + structured | ranked cards |
| `find` (goal) | compiled `ResearchGoal` (hard+soft) | structured + semantic | full fitness report |
| `explain` | single dataset + goal | — (Stage 3 only) | dimension breakdown + blockers |
| `compare` | N datasets + goal | — (Stage 3 only) | side-by-side matrix |
| `neighbors` | dataset seed vector | graph + semantic | neighborhood graph |
| `complement` | seed + "different site/subjects" | graph expansion | complementary set |
| `gaps` | modality/task slice | structured | negative-space aggregate (§8) |
| `compatible-datasets` | `ModelContract` → hard constraints | structured | compatibility-ranked list |

Building the engine once, correctly, yields all of these. That is the leverage.

---

## 10. Concrete tech choices (local-first, feasible, no new services)

| Concern | Choice | Why |
|---------|--------|-----|
| Store, filters, facets | **DuckDB** (already used), SQLite fallback | columnar group-bys for facets; already the catalog backend |
| Lexical / BM25 | **DuckDB FTS** or **SQLite FTS5** | BM25 in-process, zero services |
| Fuzzy | trigram / `jaro_winkler` in DuckDB | typo tolerance without a spellchecker service |
| Vectors | **sqlite-vec** (simple) or **LanceDB** (multi-vector + metadata pre-filter) | local ANN, reproducible |
| Embeddings | compact local `bge`/`e5` sentence encoder; cache by `text_hash` | offline, reproducible, cheap re-index |
| Fusion | RRF in Python | trivial, scale-free, robust |
| Re-rank | existing `DatasetFitness` (Python) | interpretable, already built; pluggable LTR later |
| Query compiler | regex grammar + YAML ontology + optional LLM slot-filler | deterministic core, no hallucination in the critical path |

Nothing here requires Neo4j, Elasticsearch, or a hosted vector DB. Everything runs
in-process, matching `qortex-atlas.md` §5's local-first storage stages.

---

## 11. Evaluation harness (what "production-grade" actually requires)

A search engine you can't measure is a demo. Before optimizing, build the ruler.

- **Golden set:** 30–50 `(query, relevant-dataset-ids)` pairs from real research
  goals (e.g. "cross-subject EEG motor imagery" → the known-good `ds`s). Seeded by
  hand, grown from the feedback log.
- **Retrieval metrics:** nDCG@10, MRR, Recall@50.
- **Constraint-precision:** fraction of top-k that *actually satisfy the hard
  constraints*. This is the metric that catches D6 — an engine that lets
  "unknown" leak into "pass" scores high on nDCG but low here.
- **Ablations:** substring → BM25 → +synonyms → +semantic → +RRF → +structural
  re-rank. Ship a stage only if it moves nDCG **without** dropping
  constraint-precision.
- **Feedback loop:** log queries + interactions (clicks, profile opens,
  downloads). Two payoffs: (1) mine zero-result queries → missing ontology terms
  (§3b); (2) training data for the optional LTR re-ranker (§5.2).

---

## 12. Build order (feasible, incremental, each phase shippable)

**Phase 1 — Kill the naive core (low risk, high impact).** Touches only
`catalog/index.py` + a synonym YAML.
- Replace `_score()` substring overlap with BM25 (FTS5/DuckDB-FTS). *(D1, D2)*
- Add modality/task normalization + synonym expansion at query and index time. *(D1, D4)*
- Add three-valued partitioning for `has_events` / label filters. *(D6)*
- Stand up the eval harness + golden set (§11) *first*, so Phase 1 is measured.

**Phase 2 — Query understanding + honesty.**
- Build the `QueryPlan` compiler (grammar + ontology); make `/search` and
  `/goal/find` share it (populate `ResearchGoal` from free text). *(D5)*
- Faceted live counts + near-miss set + negative-space output. *(D9)*

**Phase 3 — True method fusion.**
- Synthesize structure-derived semantic cards; build the local embedding index;
  add multi-vector paradigm/label embeddings. *(D7)*
- RRF fusion of structured + BM25 + semantic. Disambiguate "hybrid" (§7).

**Phase 4 — Structural precision + graph.**
- Promote `DatasetFitness` to the universal Stage-3 re-ranker over fused
  candidates (needs Level-1/2 ingestion populated). *(D3)*
- Graph-expansion retriever → `neighbors` / `complement` / `gaps`.
- Optional LTR re-ranker trained on the Phase-1 feedback log.

Each phase is independently valuable and independently measurable. Phase 1 alone
removes the "naive" label; Phases 3–4 deliver the "very unique professional"
multi-method engine.

---

## 13. Summary

The current engine is a single substring scorer wearing a filter. The evolution
is a **staged, multi-method, evidence-first pipeline**:

1. **Compile** the query into typed hard/soft intent (grammar + OpenNeuro-seeded ontology + guarded LLM).
2. **Retrieve** with four complementary methods — structured, BM25-lexical,
   structure-card semantic, graph — for high recall.
3. **Fuse** them scale-free with RRF.
4. **Re-rank** the survivors with the existing transparent `DatasetFitness`
   engine, for structural precision.
5. **Filter** three-valued (confirmed/inferred/unknown/fail), never dropping
   uncertainty silently, with live facet counts.
6. **Project + explain**, and emit negative-space aggregates alongside the ranked
   list.

One engine powers `search`, `find`, `explain`, `compare`, `neighbors`,
`complement`, `gaps`, and `compatible-datasets`. It reuses what Qortex already got
right (`DatasetFitness`, evidence states, tiered escalation, the normalized
catalog) and replaces the one thing it got naive (substring text ranking) with a
real, measurable, hybrid retrieval-and-ranking stack — all local-first, no new
infrastructure.
