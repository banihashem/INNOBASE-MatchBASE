# Progressive Consultant research

Activity: MB-UX-QUALITY-001 L01/L05. Canonical implementation root: `C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE`. Product authority: `C:/INNOBASE/MatchBASE/PROJECT_START_HERE.md`.

## Round lifecycle

Initial request fields and submission remain natively disabled until the authorized session resolves and the server acknowledges a draft or restores an owned saved request. This also protects server-rendered fields before JavaScript hydration. Draft creation failure shows an explicit retry; the interface never invents a server draft ID. Opening an acknowledged saved draft clears the initialization error and restores its editable state. Switching to another draft is unavailable while initial creation is pending, and original submitted intake remains locked.

The first research round keeps its existing preparation, estimate and approval flow. Every later round, up to round five, accepts an optional buyer question and selected discovery leads. Editing either invalidates the displayed estimate. A fresh estimate prices one AI focus-analysis call together with the research allowance. Saving or editing a question does not invoke a model. Research starts only after cost approval.

The focus planner receives the immutable approved request, all retained lead names and source references, bounded dossier/evidence excerpts, remaining gaps and the buyer follow-up. It creates an English objective, priority lead IDs, source-validation tasks, evidence gaps and scope notes. The raw question is not forwarded to web-search models. The analysis does not establish new supplier facts and cannot change the approved requirements. Unknown lead IDs and oversized immutable context stop before web dispatch; unavoidable oversized context is checked before the planning call. Search requests have their own bounded representation. Complete snapshots are never truncated to fit model context.

## Focus reliability

Focus analysis uses a concise schema and groups common evidence questions instead of repeating each supplier dossier. Its combined reasoning/output limit is at most 12,000 tokens, bounded further by the approved per-call allowance. Every selected lead is retained even when more than twenty are selected; the model's additional priority list is independently limited. Truncated, invalid or transient responses share at most three actual calls, including previous attempts in the same execution. Every dispatched attempt remains in usage accounting. Unknown facts cannot be filled from a truncated response.

The operator-only focus-recovery CLI supports a narrow failure before downstream research. Dry-run is the default; execution requires the reviewed snapshot hash. It checks original ownership, request/plan approval, unchanged completed parent, failed idle job, no later round or downstream work, and remaining original allowances. Requeue preserves the same execution and quote; retained dispatches seed the total-call and focus-attempt guards. It does not create a new cost approval or resume cancelled work. Other failed stages continue to require their existing recovery or fresh-estimate flow.

## Storage and publication

Final comparison sizes the complete messages JSON in UTF-8 with the same 512-byte safety margin as the approved call guard. When that representation exceeds the allowance, only narrative source summaries are shortened, with explicit disclosure to the model. All candidates, complete claims and values, source identities, dates, evidence statuses and claim-source relationships remain intact. Full summaries remain in durable storage. If the immutable inventory still cannot fit, no synthesis request is sent: validated supplier profiles remain available with deterministic ranking and an explicit incomplete AI-comparison notice. This is not full comparative-AI completion, and completed round snapshots are not silently rewritten to rerun a paid stage.

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
