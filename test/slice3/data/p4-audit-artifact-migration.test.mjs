import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const up = new URL(
  "../../../packages/data/migrations/0007_p4_audit_artifact_foundation.up.sql",
  import.meta.url,
);
const down = new URL(
  "../../../packages/data/migrations/0007_p4_audit_artifact_foundation.down.sql",
  import.meta.url,
);

test("P4 audit and artifact foundation is fail-closed, append-only, and reversible", async () => {
  const [upSql, downSql] = await Promise.all([
    readFile(up, "utf8"),
    readFile(down, "utf8"),
  ]);
  for (const required of [
    "ALTER TABLE audit_event ENABLE ALWAYS TRIGGER audit_event_append_only",
    "CREATE TABLE audit_integrity_checkpoint",
    "CREATE TABLE audit_integrity_verification",
    "CREATE TABLE artifact_version",
    "CREATE TABLE artifact_qa_check",
    "CREATE TABLE artifact_access_grant",
    "CREATE TABLE artifact_access_grant_revocation",
    "CREATE TABLE artifact_access_grant_use",
    "artifact release requires all sixteen blocking QA checks to pass",
    "BEFORE INSERT OR UPDATE OF state ON artifact_version",
    "CREATE TRIGGER artifact_version_immutable_guard",
    "Artifact lineage is immutable",
    "Terminal artifact versions are immutable",
    "'render_failed'",
    "REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM PUBLIC",
  ])
    assert.match(
      upSql,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  assert.equal(
    [
      ...upSql.matchAll(
        /'(?:band_label_equals_render_band|wave_separated_from_band|overflow_collision|citation_completeness|prohibited_phrase_scan|weight_fidelity|required_sections_present|template_content_leakage|truncation_disclosure|contradiction_declaration|tagged_structure|doc_title_flag|veraPDF|contrast_ratio|page_geometry_both|hash_and_lineage)'/gu,
      ),
    ].length,
    16,
  );
  for (const table of [
    "artifact_access_grant",
    "artifact_access_grant_use",
    "artifact_access_grant_revocation",
    "artifact_qa_check",
    "artifact_version",
    "artifact",
    "audit_integrity_verification",
    "audit_integrity_checkpoint",
  ])
    assert.match(downSql, new RegExp(`DROP TABLE IF EXISTS ${table}`, "u"));
});
