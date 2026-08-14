# MatchBASE artifact indexer

Deterministic, read-only indexing for the local product-management dashboard.

## Security contract

- Every source root must be an explicit absolute path with a stable non-sensitive ID.
- Real paths are checked before reads. Traversal and symlink escapes fail closed.
- Paths containing an `MEP` segment are rejected or skipped and never read.
- Sources are never modified. The CLI creates a new output file and refuses overwrite.
- Snapshot records expose `matchbase://<root-id>/<relative-path>` URIs, never host absolute paths.
- Text excerpts are byte-bounded and redacted. Binary/unsupported files emit hashes and `UNKNOWN` state without content.
- Errors contain stable codes only; raw exception messages and source content do not enter snapshots.

## Determinism

The caller supplies `asOf`. Roots, files, view IDs, and JSON keys are sorted. `snapshotId` is the SHA-256 of the canonical snapshot payload. Files are SHA-256 hashed through streams.

## Commands

```powershell
npm run test
npm run typecheck
node dist/src/cli.js C:\absolute\config.json C:\absolute\new-snapshot.json
```

The output path must not exist. A successful CLI run prints only the snapshot ID.
