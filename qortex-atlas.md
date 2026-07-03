Qortex Atlas should not be “search OpenNeuro with filters.”

It should be a **local neurodata intelligence graph** that turns OpenNeuro into a queryable, ranked, explainable, refreshable research substrate.

The mature idea:

```text
Qortex Atlas = local-first knowledge graph + catalog + semantic index + research-planning engine over OpenNeuro/BIDS datasets.
```

It should answer questions like:

```text
Which datasets can actually support this research goal?
Which ones look compatible but fail because of labels, companions, timing, leakage, or metadata gaps?
Which datasets are similar enough to combine?
Which datasets are underused but high-potential?
What is the minimum download plan for a benchmark across multiple datasets?
Which models can run on which data sources?
Which transformations are needed before inference or training?
```

That is the meaningful direction.

---

# 1. What Qortex already has that Atlas can build on

The current Qortex code already has the foundations for Atlas.

Qortex already describes itself as a decision layer over OpenNeuro manifests that reads subjects, companions, labels, and signal hours before transfer. It now has two surfaces: the Dataset workflow and the NeuroAI runtime.

The catalog is already normalized. It stores dataset-level metadata separately from repeatable fields such as modalities, tasks, authors, keywords, and file summaries. Search currently uses structured filters plus weighted text ranking.

The current catalog schema already includes:

```text
datasets
dataset_modalities
dataset_tasks
dataset_authors
dataset_keywords
dataset_file_summaries
```

The refresh system already ingests OpenNeuro metadata and can optionally fetch recursive file manifests for deep file-summary ingestion.

Qortex also already has `ResearchGoal` and `DatasetSelector`, which rank datasets using a lazily escalating process: local catalog first, OpenNeuro API second, remote events third.

The newer NeuroAI runtime adds source → model → output contracts, source adapters, model adapters, compatibility checks, preprocessing plans, output adapters, triggers, latency profiling, and provenance.

So Atlas should not be a new unrelated product. It should unify these into a deeper intelligence layer.

---

# 2. The mature product idea

## Qortex Atlas

```text
A local, refreshable OpenNeuro/BIDS intelligence graph for dataset discovery, cross-dataset reasoning, research-goal matching, ML-readiness evaluation, and NeuroAI compatibility planning.
```

Atlas is not only a database.

It is a **research decision system**.

It should combine:

```text
1. OpenNeuro metadata
2. BIDS file manifests
3. BIDS entity parsing
4. sidecar metadata
5. events and labels
6. modality-specific protocol signatures
7. visual/QC summaries
8. readiness reports
9. signal-budget estimates
10. model/source compatibility contracts
11. embedding search
12. graph traversal
13. explainable ranking
```

The output should not only be search results. It should produce **evidence-backed dataset decisions**.

---

# 3. The wrong shallow version

Avoid this:

```text
qortex atlas search --modality eeg --subjects 20
```

That is useful, but not enough.

Also avoid:

```text
semantic search over dataset descriptions only
```

That is weak because OpenNeuro descriptions are inconsistent. Many important facts are not in the text description. They are in:

```text
file paths
BIDS suffixes
events.tsv
channels.tsv
sidecars
participants.tsv
bval/bvec
NIfTI headers
sampling rates
TR
channel counts
task labels
companion completeness
```

The mature version must reason over **structure**, not only text.

---

# 4. The core contribution

Atlas should introduce this abstraction:

```text
Dataset → Snapshot → File → LogicalRecording → Evidence → Fitness → Plan
```

Current Qortex already has `FileRecord`, `BIDSEntities`, `CompanionSet`, and `LogicalRecording`. Those are the right primitives. `FileRecord` already stores path, extension, datatype, suffix, modality, size, URLs, and parsed BIDS entities.

`CompanionSet` already models important companion files such as events, channels, electrodes, coordsystem, scans, bvec, bval, participants, and dataset description.

`LogicalRecording` already represents one primary file plus companions, modality, datatype, subject, session, task, events, labels, loadability, estimated bytes, and issues.

Atlas should make this graph persistent, queryable, updatable, visualizable, and rankable.

---

# 5. Database architecture

Do not start with Neo4j as the core. It adds operational cost too early.

Use a **hybrid local architecture**:

```text
Atlas Store
├── DuckDB / SQLite
│   ├── structured tables
│   ├── facets
│   ├── metrics
│   ├── file summaries
│   └── query cache
├── Graph edge tables
│   ├── nodes
│   ├── edges
│   ├── evidence
│   └── provenance
├── Vector index
│   ├── dataset text embeddings
│   ├── task/label embeddings
│   ├── protocol embeddings
│   └── query embeddings
└── Artifact cache
    ├── event samples
    ├── sidecar digests
    ├── NIfTI header summaries
    ├── QC summaries
    └── generated reports
```

Recommended storage stages:

| Layer              | Backend                      | Reason                |
| ------------------ | ---------------------------- | --------------------- |
| structured catalog | DuckDB                       | local analytics       |
| fallback           | SQLite                       | zero-dependency       |
| graph              | edge tables first            | simple, portable      |
| advanced graph     | KuzuDB later                 | local graph DB        |
| vectors            | LanceDB / FAISS / sqlite-vec | local semantic search |
| files              | Parquet/JSONL                | reproducible cache    |

First version:

```text
DuckDB + Parquet + edge tables
```

Later:

```text
DuckDB + KuzuDB + LanceDB
```

---

# 6. Atlas data model

## Core node types

```text
Dataset
Snapshot
File
LogicalRecording
Subject
Session
Task
Modality
Datatype
Suffix
Sidecar
EventTable
EventColumn
LabelCandidate
LabelClass
ChannelSet
ElectrodeSet
CoordinateSystem
AcquisitionProtocol
SignalBudget
VisualQC
ReadinessReport
DownloadPlan
Artifact
ModelContract
ResearchGoal
FitnessScore
Paper
Author
License
Institution
```

## Core edge types

```text
Dataset HAS_SNAPSHOT Snapshot
Snapshot CONTAINS_FILE File
File HAS_BIDS_ENTITY Entity
File BELONGS_TO_SUBJECT Subject
File BELONGS_TO_SESSION Session
File BELONGS_TO_TASK Task
File HAS_SUFFIX Suffix
File HAS_MODALITY Modality
LogicalRecording HAS_PRIMARY File
LogicalRecording HAS_COMPANION File
LogicalRecording HAS_EVENT_TABLE EventTable
EventTable HAS_LABEL_COLUMN EventColumn
EventColumn HAS_CLASS LabelClass
LogicalRecording HAS_CHANNEL_SET ChannelSet
LogicalRecording HAS_COORDINATE_SYSTEM CoordinateSystem
Dataset HAS_SIGNAL_BUDGET SignalBudget
Dataset HAS_VISUAL_QC VisualQC
Dataset HAS_READINESS ReadinessReport
Dataset MATCHES_GOAL ResearchGoal
Dataset FAILS_GOAL ResearchGoal
Dataset SIMILAR_TO Dataset
Dataset COMPLEMENTS Dataset
Dataset LEAKAGE_RISK_WITH Dataset
Dataset COMPATIBLE_WITH ModelContract
Dataset NEEDS_TRANSFORM Transform
DownloadPlan MATERIALIZES ResearchGoal
Artifact DERIVED_FROM Dataset
```

This graph lets Qortex answer deeper questions than filters.

---

# 7. Atlas ingestion levels

Atlas should not always fetch everything. It needs selectable depth.

## Level 0 — public catalog

Fast. No file tree.

```text
dataset id
name
authors
license
DOI
modalities
tasks
subject count
snapshot
size
OpenNeuro metadata
```

Use this for broad discovery.

## Level 1 — manifest graph

Fetch recursive file manifest.

```text
files
extensions
datatypes
suffixes
subjects
sessions
tasks
file sizes
derivatives
events existence
metadata files
logical recordings
companion closure
```

This is where Qortex becomes more than search.

## Level 2 — sidecar and table digest

Fetch small metadata files only.

```text
dataset_description.json
participants.tsv/json
events.tsv/json
channels.tsv/json
electrodes.tsv
coordsystem.json
scans.tsv
bval/bvec
sidecar JSON
```

This enables label and protocol intelligence.

## Level 3 — remote header and signal budget

Use bounded reads.

```text
NIfTI shape
TR
voxel size
dimensions
sampling frequency
channel count
recording duration
window estimate
memory estimate
```

The current README already shows remote NIfTI header extraction via 352-byte range reads and signal budget estimation from remote sidecars and headers.

## Level 4 — local visual/QC audit

Requires selected download.

```text
visual thumbnails
fMRI QC
DWI QC
mask overlays
artifact preview
corruption checks
orientation warnings
```

Visual audit already reports manifest completeness, coverage matrix, file cards, and action items.

## Level 5 — model compatibility layer

Use NeuroAI contracts.

```text
source profile
model profile
input contract
axis convention
sampling rate
spatial shape
voxel spacing
coordinate frame
TR
required transforms
memory estimate
runnability
```

The compatibility engine already checks modality, channels, sampling frequency, spatial shape, voxel spacing, dtype, axis convention, coordinate frame, required metadata, memory estimate, and fMRI TR.

---

# 8. Refresh and rebuild strategy

Atlas must support:

```bash
qortex atlas init
qortex atlas refresh
qortex atlas refresh --level catalog
qortex atlas refresh --level manifest --max-datasets 500
qortex atlas refresh --modality eeg --include-file-summary
qortex atlas refresh ds004130 --level deep
qortex atlas rebuild --from-cache
qortex atlas compact
qortex atlas status
```

Refresh modes:

| Mode            | Purpose                          |
| --------------- | -------------------------------- |
| `catalog`       | fast OpenNeuro metadata          |
| `manifest`      | full file tree                   |
| `metadata`      | sidecars/events/channels         |
| `headers`       | NIfTI/signal header summaries    |
| `qc`            | local visual/readiness summaries |
| `compatibility` | source-model contract checks     |
| `full`          | all selected levels              |

Update strategy:

```text
1. use dataset id + snapshot tag + hexsha as identity
2. if snapshot unchanged, skip expensive refresh
3. if metadata changed, update catalog rows
4. if file manifest changed, rebuild file graph
5. if sidecars changed, invalidate label/protocol cache
6. if local data changed, rebuild local QC layer only
```

Qortex already uses snapshot metadata and `hexsha` in its OpenNeuro GraphQL client notes as a stable content hash for cache invalidation.

---

# 9. Selection before building Atlas

User should control scope.

Examples:

```bash
qortex atlas build --all --level catalog

qortex atlas build \
  --modality eeg \
  --min-subjects 20 \
  --has-events \
  --level metadata

qortex atlas build \
  --datasets ds000001 ds004130 ds003768 \
  --level full

qortex atlas build \
  --task motor \
  --modality eeg \
  --max-size-gb 20 \
  --include-events \
  --include-sidecars

qortex atlas build \
  --species "homo sapiens" \
  --license open \
  --level manifest

qortex atlas build \
  --from-file datasets.txt \
  --level headers
```

Python:

```python
from qortex.atlas import Atlas

atlas = Atlas.open("~/.cache/qortex/atlas")
atlas.build(
    modalities=["eeg", "bold"],
    min_subjects=20,
    levels=["catalog", "manifest", "metadata", "headers"],
)
```

---

# 10. Search should become query planning

Basic search:

```bash
qortex atlas search "motor imagery EEG with at least 40 subjects"
```

Good, but not enough.

Atlas should internally decompose this into:

```text
modality = eeg
task intent = motor imagery
min_subjects = 40
needs_events = true
needs_label_classes >= 2
needs_trials_per_class maybe >= threshold
license preference = open
download budget maybe inferred
```

Then it should return:

```text
ranked datasets
why each matches
what evidence is confirmed
what evidence is inferred
what remains unknown
minimum download plan
expected failure risks
next action
```

This is the difference between search and research planning.

---

# 11. Atlas query types

## A. Find

```bash
qortex atlas find "EEG motor imagery datasets suitable for subject-independent classification"
```

Output:

```text
dataset
fitness score
confirmed evidence
unknown evidence
label readiness
download size
risk flags
minimum download command
```

## B. Explain

```bash
qortex atlas explain ds004130 --goal eeg-classification
```

Answer:

```text
why this dataset is viable
why it may fail
which files matter
which labels exist
which subjects are usable
which companions are missing
```

## C. Compare

```bash
qortex atlas compare ds001 ds002 ds003 --goal fmri-task-classification
```

Output:

```text
best dataset for goal
sample size
labels
events
TR
image shape
license
size
readiness
risk
```

## D. Compose benchmark

```bash
qortex atlas compose-benchmark \
  --goal eeg-motor-imagery \
  --min-datasets 3 \
  --harmonize labels,sfreq,channels
```

Output:

```text
dataset set
common labels
required transformations
split policy
download plan
expected usable windows
benchmark manifest
```

This is a strong unique feature.

## E. Find complements

```bash
qortex atlas complement ds004130 --goal eeg-classification
```

Meaning:

```text
Find datasets with similar enough modality/task/labels/protocol to combine,
but different subjects/authors/acquisition sites to improve generalization.
```

## F. Find gaps

```bash
qortex atlas gaps --modality eeg --task sleep
```

Meaning:

```text
What research areas are overrepresented?
What combinations are missing?
Which datasets have good signal but poor labels?
Which datasets have labels but poor metadata?
```

This is very powerful for research strategy.

## G. Model-data compatibility

```bash
qortex atlas compatible-models ds004130 --source eeg
qortex atlas compatible-datasets --model braindecode/eegnet --task eeg_classification
```

This uses NeuroAI runtime contracts.

---

# 12. The unique ideas that make Atlas non-obvious

## 1. Negative-space search

Most search engines find what exists. Atlas should also show what is **missing**.

Examples:

```text
“There are 42 EEG motor datasets, but only 7 have enough subjects, labels, and channel metadata for subject-independent ML.”
```

```text
“Many fMRI datasets have BOLD files, but only 31% have event tables complete enough for supervised task decoding.”
```

This creates a new research intelligence layer.

## 2. Research-goal compiler

User writes:

```text
I want to train a cross-subject EEG classifier for motor imagery.
```

Atlas compiles this into:

```text
required modality: EEG
required events: yes
required label column: trial_type or equivalent
minimum classes: 2
minimum subjects: user-defined or default
split policy: subject split
leakage rules: no subject overlap
required files: eeg + events + channels + sidecars
optional files: participants
minimum download plan
```

This is much stronger than search.

## 3. Dataset failure prediction

Before download, Atlas predicts likely failure causes:

```text
label risk
event incompleteness
missing companions
too few subjects
class imbalance
huge download size
derivative-only dataset
ambiguous task labels
missing channel metadata
unknown sampling frequency
unsafe split structure
```

This directly matches the Qortex mission.

## 4. Dataset neighborhood graph

Atlas builds a similarity graph:

```text
similar modality
similar task
similar labels
similar acquisition protocol
similar subject count
similar sampling rate
similar BIDS structure
similar paper/domain
```

Then users can ask:

```bash
qortex atlas neighbors ds004130
```

This helps find alternative datasets and build multi-dataset benchmarks.

## 5. Harmonization planner

Instead of only listing datasets, Atlas says:

```text
These 5 EEG datasets can be combined if you:
- map labels A/B/C
- resample to 250 Hz
- restrict to common channels
- use subject-level split
- exclude two subjects with missing events
```

This is a serious contribution.

## 6. Data-market style potential score

Not a commercial market; a research potential map.

Score datasets by:

```text
scientific relevance
underuse
metadata completeness
label quality
sample size
modality richness
cross-dataset compatibility
download efficiency
license openness
visual/QC health
```

Then:

```bash
qortex atlas opportunities --modality eeg
```

Finds datasets that are high potential but underused.

## 7. Benchmark synthesis

Atlas can create:

```text
benchmark.yaml
datasets.lock
download_plan.json
label_map.json
split_policy.json
harmonization_plan.json
risk_report.md
```

This moves Qortex from “library” to “research infrastructure.”

## 8. Model-readiness graph

Connect OpenNeuro datasets to model contracts.

```text
dataset → source profile → compatible transforms → model contract → output type
```

With this, Atlas can answer:

```text
Which datasets can run with this EEG model?
Which models can run on this DWI dataset?
Which transformations are required?
Will the coordinate frame or axis convention break inference?
```

This is where the NeuroAI runtime becomes strategically important.

---

# 13. Atlas UI idea

The UI should not be a generic dashboard.

It should have five workspaces.

## 1. Atlas Map

A graph-map of datasets.

Nodes:

```text
datasets
tasks
modalities
labels
protocols
models
```

Edges:

```text
similar_to
compatible_with
shares_label_space
needs_transform
has_missing_evidence
```

Visual style:

```text
not force-directed chaos
use curated graph neighborhoods
show one goal-centered graph at a time
```

## 2. Goal Builder

A structured builder:

```text
I want to:
[train model] [classify task] [EEG]
with:
min subjects
min labels
min trials/class
max size
license
split policy
download budget
```

Then Atlas returns ranked candidates.

## 3. Evidence Panel

For each dataset:

```text
Confirmed
Inferred
Unknown
Blocking
Risk
Next check
```

This is critical. Do not only show a score.

## 4. Dataset Card

Each dataset card:

```text
dataset id
name
modalities
subjects
tasks
labels
events completeness
companion completeness
size
license
readiness
signal budget
download plan
similar datasets
compatible models
```

## 5. Benchmark Composer

Drag/rank selected datasets.

Atlas shows:

```text
common labels
common channels
required resampling
compatible split policy
download size
usable sample estimate
risk report
```

Then export:

```text
benchmark.yaml
qortex commands
download lockfile
conversion config
```

---

# 14. CLI design

## Build and refresh

```bash
qortex atlas init
qortex atlas refresh --level catalog
qortex atlas refresh --level manifest --modality eeg
qortex atlas refresh --level metadata --datasets ds004130 ds000117
qortex atlas rebuild --from-cache
qortex atlas status
```

## Discovery

```bash
qortex atlas find "EEG motor imagery, at least 20 subjects, open license"
qortex atlas search --modality eeg --task motor --min-subjects 20
qortex atlas facets
qortex atlas profile ds004130
```

## Intelligence

```bash
qortex atlas explain ds004130 --goal eeg-classification
qortex atlas score ds004130 --goal goal.yaml
qortex atlas why-not ds004130 --goal goal.yaml
qortex atlas neighbors ds004130
qortex atlas complement ds004130 --goal goal.yaml
qortex atlas gaps --modality eeg
```

## Planning

```bash
qortex atlas minimum ds004130 --goal first-batch
qortex atlas compose-benchmark --goal goal.yaml --n 5
qortex atlas harmonize benchmark.yaml
qortex atlas export-plan benchmark.yaml --format qortex
```

## NeuroAI compatibility

```bash
qortex atlas compatible-models ds004130
qortex atlas compatible-datasets --model braindecode/eegnet
qortex atlas runtime-plan ds004130 --model model.yaml
```

---

# 15. LLM and embedding layer

Use LLMs carefully. They should not be the source of truth.

## Embeddings should help with:

```text
semantic dataset search
task similarity
label synonym mapping
paper/domain similarity
protocol text similarity
free-text goal parsing
```

## LLM should help with:

```text
natural-language goal parsing
query decomposition
report explanation
label ontology suggestions
benchmark rationale
“why not this dataset?” explanation
```

## LLM must not decide silently.

Every LLM-generated claim needs:

```text
source fields
evidence status
confidence
traceback to dataset/file/table
```

Recommended architecture:

```text
structured graph first
embeddings second
LLM explanation third
```

Not:

```text
LLM reads dataset descriptions and guesses.
```

---

# 16. Scoring system

Every Atlas score should be decomposed.

## Dataset Fitness Score

```text
modality fit
subject count
label readiness
event completeness
companion completeness
signal budget
class balance
split safety
metadata quality
download efficiency
license openness
community signal
visual/QC health
model compatibility
```

The score is useful only if it explains failure.

Example:

```text
Score: 73/100

Strong:
- 42 subjects
- EEG modality confirmed
- trial_type labels present
- open license

Weak:
- channel metadata incomplete
- class imbalance ratio 4.8
- events missing for 3 subjects
- sampling frequency varies across runs

Next action:
qortex download dsXXXX --subjects usable --metadata-only
```

This is the right level.

---

# 17. Schema proposal

## datasets

```text
dataset_id
name
description
doi
license
authors
created
published
latest_snapshot
latest_hexsha
n_subjects
n_sessions
n_tasks
n_files
total_bytes
bids_version
species
data_processed
updated_at
```

## files

```text
dataset_id
snapshot
path
filename
extension
size
datatype
suffix
modality
subject
session
task
run
acquisition
space
direction
echo
part
is_metadata
is_primary
is_derivative
```

## logical_recordings

```text
recording_id
dataset_id
snapshot
primary_path
modality
datatype
subject
session
task
run
has_events
has_channels
has_sidecar
has_labels
estimated_bytes
loadability_status
readiness_status
```

## companions

```text
recording_id
primary_path
companion_path
companion_kind
required
present
evidence_status
```

## event_tables

```text
dataset_id
path
subject
session
task
run
n_rows
columns
duration_total
onset_min
onset_max
has_trial_type
label_columns
```

## label_profiles

```text
dataset_id
event_path
column
n_classes
classes_json
counts_json
imbalance_ratio
missing_rate
is_candidate
is_confirmed
```

## protocol_profiles

```text
dataset_id
recording_id
modality
sampling_frequency
tr
voxel_size
shape
n_channels
channel_names_hash
coordinate_frame
units
```

## graph_edges

```text
src_type
src_id
edge_type
dst_type
dst_id
weight
evidence_status
provenance
```

## embeddings

```text
object_type
object_id
embedding_model
text_hash
vector_ref
created_at
```

## fitness_scores

```text
goal_hash
dataset_id
score
grade
hard_fail_json
dimensions_json
created_at
```

---

# 18. The UI should expose uncertainty

Atlas should never pretend certainty.

Every answer should be marked:

```text
confirmed
inferred
unknown
blocked
requires download
```

This is already philosophically aligned with Qortex’s evidence states. The current README says decision reports use states such as possible, uncertain, and not possible, and readiness reports carry evidence statuses like confirmed, inferred, missing, and unknown.

Atlas should make this visible in the UI.

---

# 19. Practical use cases

## Use case 1 — Find trainable EEG datasets

```text
User:
Find EEG datasets suitable for cross-subject classification.

Atlas:
- filters EEG
- checks subject counts
- checks events
- checks label candidates
- estimates class balance
- checks channel metadata
- ranks by split safety
- returns minimum metadata download plan
```

## Use case 2 — Build a multi-dataset benchmark

```text
User:
Build a benchmark for fMRI task classification.

Atlas:
- finds BOLD datasets
- checks tasks/events/TR
- filters out incompatible protocols
- groups by similar label spaces
- proposes harmonized split
- exports benchmark.yaml
```

## Use case 3 — Avoid wasting a download

```text
User:
Can I train on dsXXXX?

Atlas:
- checks manifest
- checks sidecars/events remotely where possible
- detects missing labels
- predicts blocker
- recommends metadata-only download or rejection
```

## Use case 4 — Model compatibility

```text
User:
Which OpenNeuro datasets can run with this EEGNet model?

Atlas:
- reads model contract
- checks modality
- checks channels
- checks sampling frequency
- checks window size
- lists required transforms
- ranks compatible datasets
```

## Use case 5 — Research opportunity discovery

```text
User:
Where are high-quality underused datasets?

Atlas:
- finds datasets with good metadata, labels, subjects, open license
- compares downloads/stars/citations
- identifies underused but trainable data
```

---

# 20. Critical evaluation

## Risk 1: Too ambitious

Atlas can become a huge unfinished system.

Fix:

```text
Build it in layers.
Do not start with full graph UI.
Start with persistent evidence graph + CLI.
```

## Risk 2: LLM hallucination

If LLMs summarize datasets, they may invent facts.

Fix:

```text
LLM only explains structured evidence.
LLM output must cite object IDs and fields.
```

## Risk 3: Slow ingestion

Full OpenNeuro deep ingestion can be expensive.

Fix:

```text
tiered refresh
snapshot hash invalidation
user-selected scope
background jobs
cache reuse
manifest-only default
```

## Risk 4: Bad scores

A single magic score can mislead users.

Fix:

```text
always show dimension breakdown
show hard failures
show unknown evidence
show next action
```

## Risk 5: Graph complexity

Graph schema can become uselessly complex.

Fix:

```text
start with 20 core node types and 30 edge types
add new edges only when they answer a real query
```

---

# 21. Refined MVP

The real MVP should not be the UI first.

## MVP 1 — Atlas Core

```text
qortex atlas init
qortex atlas refresh --level catalog
qortex atlas refresh --level manifest --modality eeg
qortex atlas profile ds004130
qortex atlas find --goal goal.yaml
qortex atlas explain ds004130 --goal goal.yaml
```

Data stored:

```text
datasets
files
logical_recordings
companions
events
labels
protocol_profiles
edges
fitness_scores
```

## MVP 2 — Atlas Intelligence

```text
similar datasets
dataset neighborhoods
goal compiler
why-not reports
minimum download plan
benchmark composer
```

## MVP 3 — Atlas UI

```text
dataset map
goal builder
evidence panel
benchmark composer
compatibility explorer
```

## MVP 4 — Semantic/LLM layer

```text
natural language search
semantic task matching
label ontology suggestions
LLM-generated evidence reports
```

---

# 22. Final mature positioning

The strongest positioning:

```text
Qortex Atlas is a local-first intelligence layer for OpenNeuro and BIDS.

It builds a refreshable knowledge graph from public metadata, file manifests, BIDS entities, sidecars, events, labels, protocols, QC summaries, and model contracts.

Instead of asking “which datasets match this filter?”, Atlas asks:

Can this dataset support my scientific or ML goal?
What evidence confirms that?
What is missing?
What will fail?
What is the smallest useful download?
Which datasets can be combined?
Which models can run on this data?
```

That is the mature idea.

The best one-line version:

```text
Qortex Atlas turns OpenNeuro from a dataset archive into a local, queryable research intelligence graph.
```

The best technical identity:

```text
local-first OpenNeuro/BIDS knowledge graph + research-goal compiler + dataset fitness engine + NeuroAI compatibility map
```

The best first implementation target:

```text
Atlas Core: persistent graph-backed catalog with evidence-aware dataset fitness and benchmark planning.
```
