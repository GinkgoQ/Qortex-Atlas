# Qortex 1-4 implementation plan

## Scope

Treat `Qortex 1.png` through `Qortex 4.png` as product requirements. Audit and extend both repositories:

- `../Qortex`: typed data, analysis, validation, visualization, NeuroAI, model-zoo, caching, provenance, and HTTP service contracts.
- `Qortex-Atlas`: real-data UI workflows consuming Qortex HTTP contracts.

No model training, mock responses, fabricated datasets, placeholder metrics, or hardcoded example results.

## Constraints

- Preserve unrelated user changes already present in both worktrees.
- Use public pretrained models and public datasets for executable verification.
- Every displayed scientific value must be returned by Qortex or computed from selected real files.
- Unsupported operations must be explicit, not represented as successful UI.
- Prefer existing Qortex extension points and current Atlas architecture.

## Work

- [x] Inspect all four product images at original resolution.
- [x] Extract and classify requirements by Qortex, Qortex-Atlas, or both.
- [x] Audit Qortex implementation depth and API exposure for each requirement.
- [x] Audit Atlas implementation depth and real-data binding for each requirement.
- [x] Record an evidence-backed implementation matrix.
- [ ] Implement missing or shallow Qortex domain/API functionality. Completed slices: model zoo/public inference, readiness, demographics, coverage, validation, fMRI QC, signal analysis/connectivity/features, cache inventory, conversion/export.
- [ ] Connect Atlas workflows to Qortex endpoints and mature UI-only interactions. The same completed slices are connected; remaining partial panels stay tracked in `IMPLEMENTATION_AUDIT.md`.
- [ ] Run focused unit, integration, browser, public-dataset, and public-model checks. Public MONAI/BraTS, ds000001, ds000117, API, and live Chrome checks completed for landed slices; final aggregate verification remains.
- [ ] Re-index both repositories and inspect final cross-boundary impact.

## Risks

- The images contain multiple product areas, some of which require substantial scientific pipelines. Implementation will be staged by dependency order while keeping each landed slice complete.
- Public model downloads and real datasets can be large or license-gated. Verification must record exact model, dataset, license state, and artifact provenance.
- Both worktrees already contain user changes. Edits must avoid erasing or rewriting unrelated work.

## Verification

- Focused Qortex pytest suites for changed modules and HTTP contracts.
- Atlas static checks plus browser/runtime interaction against a live Qortex service.
- At least one public dataset flow and one public pretrained model inference flow, with artifacts and provenance.
- No fixtures, synthetic arrays, or static UI data used as evidence of feature completion.
