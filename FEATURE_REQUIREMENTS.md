# Qortex 1-4 feature requirements

This inventory is extracted from `Qortex 1.png` through `Qortex 4.png`. Ownership means where the production responsibility belongs: **Qortex** for reusable typed computation and service contracts, **Atlas** for interactive presentation, and **Both** when the UI must execute or display Qortex behavior.

## Qortex 1 — readiness, cohort metadata, previews, and NeuroAI

| Panel | Requirement | Owner |
|---|---|---|
| 1a | Dataset readiness summary: source identity, status, target/split, subject and recording counts, label-ready count, required download size, trainability thresholds, blocking reasons, and actionable next steps | Both |
| 1b | Participant age-by-sex analysis: valid/invalid accounting, ignored-category disclosure, grouped distributions, median/IQR/range, and overall summary statistics sourced from BIDS participant metadata | Both |
| 1c | BOLD mean-volume preview: axial/coronal/sagittal views, voxel/world coordinates, robust intensity clipping, modality/shape/voxel-size/TR/duration metadata, brain coverage, nonzero fraction, temporal SNR, mean framewise displacement, and outlier-volume count | Both |
| 1d | NeuroAI object detection: public-model identity and provenance, backend, input contract, measured latency, confidence threshold, NMS threshold, typed labels/confidences/boxes, and overlay rendering | Both |
| 1e | NeuroAI segmentation: public-model identity and provenance, multi-planar source/prediction/overlay views, label legend, optional 3-D rendering, and per-class evaluation metrics when ground truth exists | Both |
| 1f | Model inference workspace: runtime-backend availability, searchable model catalog, task/backend/parameter/size metadata, actual prediction outputs and latency, managed model cache, integrity metadata, and offline availability | Both |

## Qortex 2 — analysis, benchmarking, and reproducibility

| Panel | Requirement | Owner |
|---|---|---|
| 2a | Connectivity analysis: ROI correlation matrix, Fisher-z transform, thresholded connectome, positive/negative edge encoding, atlas/parcellation provenance, network-level summaries, graph metrics, and hub ranking | Both |
| 2b | Signal analytics: grouped PSD with uncertainty, time-frequency spectrogram, Higuchi fractal dimension across scales, condition comparison, frequency-band topography when sensor geometry exists, and evidence-linked interpretation | Both |
| 2c | Neuroclassic feature extraction summary: bandpower, connectivity, graph, statistical-moment, complexity/entropy feature groups; feature counts, definitions, engine version, and validation state | Both |
| 2d | Cohort comparison: biomarker distributions by cohort, sample counts, inferential tests, multiple-comparison-aware significance, effect statistics, and explicit missing-data handling | Both |
| 2e | Experiment tracking and benchmarking: ranked runs with pipeline/model/preprocessing identity, task-appropriate metrics, measured runtime/memory, seed, state, logs, and run detail navigation | Both |
| 2f | Reproducibility and provenance: executable pipeline DAG, software/hardware environment, deterministic settings, seed and precision, immutable artifact hashes, run identity, and exports for pipeline, environment, manifest, and report | Both |

## Qortex 3 — viewer, QC, streaming, cache, and annotations

| Panel | Requirement | Owner |
|---|---|---|
| 3a | Interactive neuro viewer: synchronized tri-planar navigation, crosshairs, overlays, opacity/visibility, zoom/pan, interpolation, orientation labels, image metadata, cursor world coordinates/intensity, and display controls | Both |
| 3b | Slice montage and ROI browser: orientation/stride controls, slice grid, ROI atlas selection, region metadata and statistics, intensity histogram, and annotation creation from the current view | Both |
| 3c | fMRI QC timeline: FD, DVARS, global signal, thresholds, exact hover values, retained/deleted counts, flagged-volume rail, scrubbing action, recalculation, and report export | Both |
| 3d | Streaming/cache performance: streamed versus full-download latency/memory/bandwidth comparison, cache-hit rate, bandwidth composition, cache efficiency over time, and real measurement provenance | Both |
| 3e | Download/cache manager: configurable cache path and limit, cleanup policy, offline mode, transfer state, downloaded-study inventory, last access, exact disk usage, orphan handling, and safe per-item/bulk removal | Both |
| 3f | Viewer tools and annotations: distance/angle/shape/text tools, windowing presets, view snapshots, typed layers, visibility controls, saved annotation table, import/export, and destructive-action safeguards | Both |

## Qortex 4 — exploration, validation, structure, and conversion

| Panel | Requirement | Owner |
|---|---|---|
| 4a | Dataset explorer: identity/version/validation state, modality/task inventory, subject/session/run counts, size, BIDS version, license, DOI, and creation/update metadata | Both |
| 4b | Search/filter workspace: composable structured filters for modality, task, acquisition metadata, demographics, label state, and scanner properties; sortable results; pagination; saved searches; and CSV export | Both |
| 4c | Subject-session-run coverage: expected/available/not-expected states derived from BIDS entities, hover detail, aggregate counts, and completeness percentage | Both |
| 4d | Metadata validation report: typed passed/warning/error findings by category, concrete affected-file examples, BIDS profile/tool version, runtime, timestamp, and full-report access | Both |
| 4e | BIDS structure overview: lazy directory tree, content summary, file-type distribution, total counts, and drill-down without downloading unrelated payloads | Both |
| 4f | Conversion/export workflow: selection, typed configuration, conversion, packaging, export, per-output state/size, NIfTI/NumPy/Parquet/WebDataset/report outputs, aggregate size, logs, and output-folder access | Both |

## Atlas-only design requirements across all panels

- Dense scientific dashboards with clear panel hierarchy, accessible tab and keyboard behavior, responsive layouts, progressive loading, empty/error/cancellation states, and units attached to every measurement.
- Every action reflects actual backend capability and state. No decorative success badges, fake progress, static scientific values, illustrative detections, or sample records in production paths.
- Data provenance remains visible near derived results. Raw values, derivation parameters, source files, model versions, and warnings remain inspectable.
- Large trees, tables, matrices, timelines, images, and model catalogs use bounded rendering, pagination, or virtualization rather than loading the full result into the DOM.
