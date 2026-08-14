# MatchBASE PM Control Room

Local, read-only React dashboard for evidence-backed product-management observability.

## Data boundary

The client issues one `GET /current-snapshot.json` request with `cache: no-store`. It contains no mutation request, write action, authentication value, or server-side filesystem access. The artifact indexer owns generation of `public/current-snapshot.json`.

Required top-level fields:

- `schemaVersion`: `"1.0"`
- `generatedAt`: ISO-8601 timestamp
- `mode`: `"READ_ONLY"`
- `views`: records keyed by the 13 values exported in `src/types.ts`

Missing or invalid views fail schema validation and render `ERROR`. Empty valid views remain `UNKNOWN`. Failed requests render `ERROR`, and snapshots older than 24 hours render `STALE`. Every item requires `sourceRefs` with an exact path, SHA-256, observation timestamp, and optional line range or section.

`public/bootstrap-snapshot.json` is the tracked UNKNOWN-only fallback used when the local generated snapshot is absent. `public/current-snapshot.json` is generated from governed local sources, ignored by Git, and required before any dashboard observation is treated as current.

## Local verification

```text
pnpm --filter @matchbase/dashboard check
pnpm --filter @matchbase/dashboard test
pnpm --filter @matchbase/dashboard build
```

The app uses only system fallbacks compatible with Montserrat metrics. It does not bundle the protected brand logo or unverified font files.
