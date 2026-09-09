# Autonomous operating model

## Control loop

1. Read current governing artifacts and machine-readable registers.
2. Bound one vertical slice and declare exclusions.
3. Assign non-overlapping discipline work.
4. Implement only inside the declared targets.
5. Run deterministic validation and capture exact evidence.
6. Run a discipline-independent audit against current bytes.
7. Correct every critical, major, and minor defect.
8. Submit the slice to independent Role 2. Do not advance while that gate is unresolved.
9. Append the immutable execution record to the product-management loop log.

## Authority

The product owner retains unified human accountability. Agents may execute the bounded overlay but cannot authorize public release, new legal terms, irreversible external changes, production deletion, repository replacement, or acceptance of residual defects. An implementer status string is never sufficient evidence for PASS.

## Separation of duties

- The orchestrator owns scope, reconciliation, and evidence integrity.
- Implementers own non-overlapping code or document targets.
- Security, QA, platform, release-safety, and SRE reviewers inspect current bytes independently.
- The integration critic evaluates the assembled slice without relying solely on implementer claims.
- Role 2 is the independent release gate for advancing to the next slice.

## Evidence contract

Every material claim requires an exact artifact path or external read, observation time, command or method, exit result, and SHA-256 where applicable. Missing evidence yields `UNKNOWN`, `STALE`, `ERROR`, or `BLOCKED`, never inferred PASS.

## Stop conditions

Stop at a missing credential, ambiguous target, new legal/licensing decision, destructive action, inaccessible independent review, failed protection boundary, or unresolved defect. Preserve recoverable state and record the blocker.
