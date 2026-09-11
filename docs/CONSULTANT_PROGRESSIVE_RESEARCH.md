# Progressive Consultant research

Activity: MB-UX-QUALITY-001 L01. Canonical implementation root: `C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE`. Product authority: `C:/INNOBASE/MatchBASE/PROJECT_START_HERE.md`.

## Round lifecycle

The first research round keeps its existing preparation, estimate and approval flow. Every later round, up to round five, accepts an optional buyer question and selected discovery leads. Editing either invalidates the displayed estimate. A fresh estimate prices one AI focus-analysis call together with the research allowance. Saving or editing a question does not invoke a model. Research starts only after cost approval.

The focus planner receives the immutable approved request, all retained lead names and source references, bounded dossier/evidence excerpts, remaining gaps and the buyer follow-up. It creates an English objective, priority lead IDs, source-validation tasks, evidence gaps and scope notes. The raw question is not forwarded to web-search models. The analysis does not establish new supplier facts and cannot change the approved requirements. Unknown lead IDs and oversized immutable context stop before web dispatch; unavoidable oversized context is checked before the planning call. Search requests have their own bounded representation. Complete snapshots are never truncated to fit model context.

## Storage and publication

The existing `consultant_research_round` table retains the full output and continuation JSON. Its account, user profile, research run, execution and classification references are checked against the owned session and approved round. Classification points to the existing goods/services taxonomy record; a provisional classification is not promoted to a verified code by this feature.

Continuation includes the complete grounded candidate index, extracted roster, evidence records, retrieved source text and hashes, native citations, accumulated response records and focus analysis. Raw completions are retained as JSON-encoded strings, allowing lossless storage of NUL or unpaired-surrogate text that PostgreSQL jsonb cannot otherwise represent; decode one string to recover a completion. Raw provider checkpoints remain execution-scoped in workflow events, including failed or unparsed calls. Index retention happens before the detailed-dossier scheduling limit. A later round merges new observations into its own snapshot; earlier completed rows are immutable. Failed stages retain their execution checkpoints but are not represented as completed round outputs.

Final round output, continuation, current output and session completion are saved in one transaction. Session/round locks reject cancelled or obsolete executions. The process cache exposes the completed result only after persistence succeeds. No schema migration is required. Existing cost, cancellation, price-date and primary-evidence rules continue to apply.

## Two result views

Documented supplier cards, supplier details and English PDFs continue to use admitted supplier dossiers. A separate research review shows grounded discovery names that lack a documented dossier, source links, missing evidence and any evidence-backed mandatory mismatch. Incomplete evidence is not an exclusion. These leads are not verified suppliers and do not become PDF recommendations merely by being displayed or selected.

Counts distinguish discovered names, documented suppliers, incomplete leads and excluded leads. Round history preserves earlier output; historical lead review is read-only. The buyer can return to the latest completed round to choose the next focus. Names are deduplicated by normalized observed name, not by shared website; corporate aliases still require identity evidence.

Old rounds without a lead inventory are projected from grounded retained candidate-index events along the completed owned parent chain. Account, user profile, research run and classification must match, and round numbers decrease. This is a read-only compatibility projection, not a rewrite of historical output, a new web search or a claim that old prices are current.

## Verification and maintenance

Tests cover five-round database retention, four-ID publication, cancellation/rollback, ancestor recovery, safe public links, incomplete/excluded distinctions, bounded planning/search inputs, AI-before-web ordering, quote invalidation and desktop/mobile review. The existing reporting tests retain English PDF behavior. Provider mocks qualify execution behavior, not commercial coverage or the availability of current supplier prices.

Source relationships: [contracts](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/packages/contracts/src/v3/research-review.ts), [checkpoint boundary](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/packages/data/src/consultant-research-rounds.ts), [projection](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/packages/application/src/research-review.ts), [planner](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/packages/application/src/research-focus-planner.ts), [interface](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/apps/web/components/consultant/ResearchRoundControl.tsx). Update this document when these contracts or approval semantics change.
