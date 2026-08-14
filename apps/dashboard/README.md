# MatchBASE PM Control Room

Local, read-only React dashboard for evidence-backed product-management observability.

## Data boundary

The client issues one `GET /current-snapshot.json` request with `cache: no-store`. It contains no mutation request, write action, authentication value, or server-side filesystem access. The artifact indexer owns generation of `public/current-snapshot.json`.

Required top-level fields:

- `schemaVersion`: `"1.0"`
- `generatedAt`: ISO-8601 timestamp
- `mode`: `"READ_ONLY"`
- `views`: records keyed by the 13 values exported in `src/types.ts`

Missing views normalize to `UNKNOWN`. Invalid schemas or failed requests render `ERROR`. Snapshots older than 24 hours render `STALE`. Every item accepts `sourceRefs` with an exact path, optional line range, SHA-256, section, and observation timestamp.

`public/bootstrap-snapshot.json` is the tracked UNKNOWN-only fallback used when the local generated snapshot is absent. `public/current-snapshot.json` is generated from governed local sources, ignored by Git, and required before any dashboard observation is treated as current.

## Local verification

```text
pnpm --filter @matchbase/dashboard check
pnpm --filter @matchbase/dashboard test
pnpm --filter @matchbase/dashboard build
```

The app uses only system fallbacks compatible with Montserrat metrics. It does not bundle the protected brand logo or unverified font files.
