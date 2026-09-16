import { createHash } from "node:crypto";

// MB-ARCH-IMPLEMENT-001 L05. This control plane produces proposals, never runtime authority.
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const REPAIR_CONTRACT = Object.freeze({
  version: "isolated-repair.v1",
  network: "none",
  model_calls: 0,
  may_deploy: false,
  may_change_oracle: false,
  may_read_runtime_credentials: false,
  max_files: 8,
  max_patch_bytes: 65536,
  release_state: "independent-review-and-authorized-release-required",
});
const dispositions = new Set([
  "cancelled",
  "blocked_by_authority",
  "outcome_unknown",
  "bounded_retry",
  "bounded_content_repair",
  "incident_required",
]);
const stages = new Set(["prepare", "research"]);
export function validateIncidentPacket(packet) {
  if (
    !packet ||
    typeof packet !== "object" ||
    Array.isArray(packet) ||
    Object.keys(packet).some(
      (key) =>
        ![
          "version",
          "fault_code",
          "disposition",
          "stage",
          "playbook_version",
          "reproduction",
          "authority",
        ].includes(key),
    ) ||
    packet.version !== "research-incident-packet.v1" ||
    !dispositions.has(packet.disposition) ||
    !stages.has(packet.stage) ||
    !/^(?:UNCLASSIFIED|MB-[0-9]{3}-[A-Z0-9-]{1,55}|execution-lease-lost|execution-interrupted|user-cancelled)$/u.test(
      packet.fault_code ?? "",
    ) ||
    packet.playbook_version !== "research-recovery.v1" ||
    packet.reproduction !== "synthetic-fixture-required" ||
    JSON.stringify(packet.authority) !==
      JSON.stringify({
        tools: [],
        model_calls: 0,
        may_deploy: false,
        may_change_oracle: false,
      })
  )
    throw new Error(
      "Only the redacted, authority-free incident packet is accepted.",
    );
  return Object.freeze(structuredClone(packet));
}
export function repairOrganization(packet) {
  const safe = validateIncidentPacket(packet);
  return Object.freeze({
    contract: REPAIR_CONTRACT,
    incident: safe,
    roles: [
      {
        role: "controller",
        action: "contain-and-select-versioned-playbook",
        authority: "existing-approval-only",
      },
      {
        role: "diagnostician",
        action:
          "research-public-documentation-and-reproduce-with-synthetic-data",
        authority: "read-only; separately-authorized-tools",
      },
      {
        role: "repair_executor",
        action: "propose-bounded-source-patch",
        authority: "isolated-candidate-directory-only",
      },
      {
        role: "independent_evaluator",
        action: "run-protected-regression-and-acceptance-contract",
        authority:
          "bounded-candidate-observations-only; no-candidate-code; no-release",
      },
      {
        role: "release_controller",
        action: "verify-exact-candidate-review-and-release-authorization",
        authority: "external-to-repair-agent",
      },
    ],
  });
}
export function validateRepairProposal(proposal, baseline, allowedPaths) {
  if (
    !proposal ||
    proposal.version !== "repair-proposal.v1" ||
    Object.keys(proposal).some(
      (key) => !["version", "changes"].includes(key),
    ) ||
    !Array.isArray(proposal.changes) ||
    !proposal.changes.length ||
    proposal.changes.length > REPAIR_CONTRACT.max_files ||
    Buffer.byteLength(JSON.stringify(proposal), "utf8") >
      REPAIR_CONTRACT.max_patch_bytes
  )
    throw new Error("The repair proposal exceeds its bounded contract.");
  const paths = new Set();
  for (const change of proposal.changes) {
    if (
      !change ||
      Object.keys(change).some(
        (key) => !["path", "original_sha256", "content"].includes(key),
      ) ||
      typeof change.path !== "string" ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/u.test(change.path) ||
      change.path.split("/").some((part) => [".", ".."].includes(part)) ||
      /(?:^|\/)(?:test|tests|fixtures|\.github|deployment|migrations)(?:\/|$)|oracle|acceptance|credential|authorization|secret|release|eval(?:uation)?-contract/iu.test(
        change.path,
      ) ||
      !allowedPaths.includes(change.path) ||
      paths.has(change.path) ||
      typeof change.content !== "string" ||
      !Object.hasOwn(baseline, change.path) ||
      sha256(baseline[change.path]) !== change.original_sha256
    )
      throw new Error(
        "A repair may modify only its exact allowed source baseline.",
      );
    paths.add(change.path);
  }
  return {
    version: "validated-repair-proposal.v1",
    candidate_sha256: sha256(JSON.stringify(proposal)),
    contract_sha256: sha256(JSON.stringify(REPAIR_CONTRACT)),
    files: [...paths],
    release_state: REPAIR_CONTRACT.release_state,
    may_deploy: false,
  };
}
