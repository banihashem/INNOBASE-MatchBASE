# Optional local model qualification

Activity: MB-ARCH-IMPLEMENT-001 L03.

This isolated service is an engineering qualification environment. The Consultant application does not route research to it. A local model proposes an extraction; a JSON schema and matching quotation alone do not establish commercial correctness. Product activation remains blocked until independent quality and whole-pipeline economic gates pass.

## Isolation

`compose.local-model.yaml` is a separate Compose project, not an overlay on the product deployment. Its qualification profile has a pinned Linux/amd64 Ollama image, non-root user, read-only root filesystem and artifact volume, dropped capabilities, no-new-privileges, internal network, bounded CPU/RAM/processes and one GPU. No model API port is published. The pinned Node fixture runner shares only the isolated inference network namespace. The model receives no repository files. The runner receives only the qualification harness/fixtures read-only and a separate output directory. Neither receives product secrets, database mounts, Docker socket, cloud features or inference egress.

The lifecycle script separately acquires a public model into its dedicated Docker volume without a GPU, host port or inference input. Acquisition refuses to run while the inference service is active. Model manifest and GGUF checksums are checked after acquisition and before startup; the harness also checks the runtime, model and template identities. Changing a registry tag cannot silently change the experiment.

The GPU is shared hardware; Docker does not reserve its VRAM against other applications. Run the bounded experiment serially, then stop/unload it. The service does not auto-start with the product or after a restart. The artifact volume is preserved by `Stop`.

## Commands

Run from the source root in PowerShell:

```powershell
& C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/deployment/local-model/Prepare-LocalModel.ps1 -Action Acquire
& C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/deployment/local-model/Prepare-LocalModel.ps1 -Action Start
node --test test/local-model/*.test.mjs
& C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/deployment/local-model/Qualify-LocalModel.ps1 -Model qwen -Split development
& C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/deployment/local-model/Qualify-LocalModel.ps1 -Model qwen -Split calibration
& C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/deployment/local-model/Prepare-LocalModel.ps1 -Action Stop
```

The wrapper creates a fresh report under the user's local application-data MatchBASE qualification directory. Reports cannot overwrite an existing result and must be outside the source repository. The direct CLI requires an existing output parent, checks path components and canonical junction/symlink targets before inference, and rechecks before exclusive creation. An in-tree directory named `..reports` is not an outside directory. `-Model none` runs the exact-memory/no-generator reference without model calls. `-Model gemma` measures the separately installed, digest-verified Docker Model Runner control; it is not an Ollama-container comparison under an identical backend. Stop Qwen before measuring Gemma, then run `docker model unload gemma3` to free the control's GPU memory.

## Evaluation boundary

The committed `evaluation-contract.json` fixes engineering rejection rules before inference. Development input revision 2 and contract v1.1 remove an answer-specific hint discovered in the original price question. Earlier model records are retained diagnostic measurements with that contaminated task, not outcomes for the corrected prompt. The expected answer and critical-error rules remain unchanged. Development and calibration fixtures are synthetic and use separate source/entity clusters; the separate oracle objects are excluded from model input. Eight cases are not a statistical guarantee, unbiased held-out sample or product acceptance test. A missing output or omitted evidence cannot be hidden by counting only admitted answers.

The deterministic checker rejects invented quotes/dates and reports exact fixture mismatches including units and entity scope. It is deliberately not a universal semantic validator. The no-generator control routes unresolved work to `qualified_cloud_required_not_dispatched`; it does not claim to complete the cloud baseline. All harness routes have zero cloud dispatches. Local energy, validation and maintenance are not recorded as zero monetary cost.

An `acceptance` split is not executable by this engineering harness. Production qualification requires an independently frozen contract, unseen clustered corpus, protected Persian/English and goods/services slices, critical-error rejection, evidence recall, rights/privacy testing, paired qualified-cloud outcomes, uncertainty analysis and total cost/latency including failures, escalation and cold starts. A repair or optimization agent cannot relax that oracle or set activation true. Models for embeddings/reranking need a separate model-specific pooling/scoring experiment; this generator endpoint does not qualify retrieval.

## Adapter contract for future integration

- Input: one authorized bounded evidence projection with unchanged original source text, question, entity scope and temporal constraints. No tools or arbitrary model/API URLs.
- Output: a proposal plus source references, artifact/template/policy hashes and measured duration/token receipt. It is not a verified supplier fact.
- Failure: typed unresolved local work; local unavailability never creates cloud cost authority. A cloud fallback, if independently authorized, receives original evidence and known gaps.
- Admission: current profile/rights/freshness checks before input and at publication; a separately qualified semantic validator; current versioned model qualification. This harness has no product publication capability.
- Accounting: include local execution, validation, all failed attempts and any approved escalation. Compare accepted outcomes with the qualified no-generator/cloud reference before claiming savings.

## Rollback

`Stop` removes only this project's service/network and preserves the external model-artifact volume. The product source/runtime/database remains untouched. No model is automatically substituted into a running Consultant execution.
