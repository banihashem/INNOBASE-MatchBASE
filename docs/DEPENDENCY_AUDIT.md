# Dependency audit gate

Activity: MB-SEC-DEPENDENCIES-001 L01.

`pnpm run dependency:audit` always runs the registry audit and prints its raw JSON.
The acceptance threshold remains High/Critical; lower findings stay visible.
Transport errors, invalid/incomplete reports, or unknown High/Critical findings
fail the command. The gate is not a replacement for frozen installation or the
rest of the source, license, and runtime qualification checks.

The sole temporary mitigation is `GHSA-vfj7-8cjw-p6xm`, `braces@3.0.3`, reached
through the three exact development-only Tailwind dependency paths encoded in
`scripts/dependency-audit.mjs`. The registry still reports this High finding.
The gate labels it **MITIGATED**, never clean or ignored, only after checking:

- The exact advisory, version, exposure, dependency paths and expiry
  (`2026-10-17T00:00:00Z`, exclusive).
- SHA-256 pins for the patch, manifests, workspace settings, lockfile and
  installed-package regression test, against both working files and regular Git
  index blobs. Working text uses LF normalization to match the tracked source;
  installed package bytes use exact hashes.
- The installed lockfile against the separately pinned native pnpm 11.19.0
  frozen-install serialization or the pinned repository serialization. These
  are two reviewed SHA-256 values for the same graph; arbitrary reserialization
  or graph changes fail. It also checks all three dependency resolutions and
  every file in the installed braces package. Missing, extra, modified or symlinked source
  fails qualification.
- A timeout-bound regression against the installed package, with provider,
  database, Node injection and package-manager override variables removed.

The pinned source must be staged or committed before this mitigation can pass.
There is no command-line or environment switch to update pins or extend expiry.
Changing qualified inputs requires independent review and explicit acceptance of
the new evidence. Remove this temporary protocol when a qualified upstream fix
replaces the local patch. The
[upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) listed no
patched release on 2026-10-03; the registry's suggested `>=3.0.4` range does not
establish that such a release exists.

Run `pnpm run test:security` for the audit-gate failure cases and installed-patch
regressions. A passing synthetic gate test alone does not qualify the mitigation;
the actual registry audit, installed-source verification and independent review
remain required.
