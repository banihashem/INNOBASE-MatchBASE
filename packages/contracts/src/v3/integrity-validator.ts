import type { ConsultantResearchOutputV3 } from "./consultant-research-output.js";

export interface IntegrityValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly materialClaimCount: number;
  readonly supportedMaterialClaimCount: number;
  readonly unsupportedMaterialClaimCount: number;
  readonly orphanEvidenceReferences: readonly string[];
  readonly orphanClaimReferences: readonly string[];
  readonly lineageCoveragePercentage: number;
}

/**
 * Validates the referential, scoring, and classification integrity of a ConsultantResearchOutputV3 payload.
 * Enforces:
 * - Zero orphan evidence references
 * - Zero orphan claim references
 * - Strict 60-point cap on candidates failing mandatory compliance constraints
 * - Candidate uniqueness
 * - Truthfulness of research mode disclosures
 */
export function validateConsultantOutputV3Integrity(
  output: ConsultantResearchOutputV3,
): IntegrityValidationResult {
  const errors: string[] = [];
  const validEvidenceIds = new Set(
    output.evidence_sources.map((e) => e.evidence_id),
  );
  const validClaimIds = new Set(output.claims.map((c) => c.claim_id));
  const validSupplierEntityIds = new Set(
    output.supplier_candidates.map((s) => s.supplier_entity_id),
  );

  const orphanEvidenceReferences: string[] = [];
  const orphanClaimReferences: string[] = [];

  const checkEvidenceRef = (ref: string, context: string) => {
    if (!validEvidenceIds.has(ref)) {
      orphanEvidenceReferences.push(`${context} -> ${ref}`);
      errors.push(`Orphan evidence ID reference: '${ref}' in ${context}`);
    }
  };

  const checkClaimRef = (ref: string, context: string) => {
    if (!validClaimIds.has(ref)) {
      orphanClaimReferences.push(`${context} -> ${ref}`);
      errors.push(`Orphan claim ID reference: '${ref}' in ${context}`);
    }
  };

  // 1. Candidate ID uniqueness
  const candidateIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const s of output.supplier_candidates) {
    if (candidateIds.has(s.candidate_id)) {
      errors.push(`Duplicate candidate_id found: ${s.candidate_id}`);
    }
    candidateIds.add(s.candidate_id);

    if (entityIds.has(s.supplier_entity_id)) {
      errors.push(
        `Duplicate supplier_entity_id found: ${s.supplier_entity_id}`,
      );
    }
    entityIds.add(s.supplier_entity_id);

    // Check evidence references within supplier
    for (const eid of s.identity_evidence_ids) {
      checkEvidenceRef(eid, `supplier ${s.candidate_id} identity_evidence_ids`);
    }
    for (const eid of s.contacts.contact_evidence_ids) {
      checkEvidenceRef(
        eid,
        `supplier ${s.candidate_id} contacts.contact_evidence_ids`,
      );
    }
    for (const eid of s.offering.product_evidence_ids) {
      checkEvidenceRef(
        eid,
        `supplier ${s.candidate_id} offering.product_evidence_ids`,
      );
    }
    for (const eid of s.commercial.commercial_evidence_ids) {
      checkEvidenceRef(
        eid,
        `supplier ${s.candidate_id} commercial.commercial_evidence_ids`,
      );
    }
    if (s.packaging_and_logistics?.logistics_evidence_ids) {
      for (const eid of s.packaging_and_logistics.logistics_evidence_ids) {
        checkEvidenceRef(
          eid,
          `supplier ${s.candidate_id} packaging_and_logistics.logistics_evidence_ids`,
        );
      }
    }
    for (const cert of s.certifications) {
      for (const eid of cert.evidence_ids) {
        checkEvidenceRef(
          eid,
          `supplier ${s.candidate_id} certification '${cert.certification_name}'`,
        );
      }
    }

    // Check mandatory compliance scoring rules (Charter 5.6 & 16.1)
    for (const mc of s.assessment.mandatory_constraint_results) {
      for (const eid of mc.evidence_ids) {
        checkEvidenceRef(
          eid,
          `supplier ${s.candidate_id} mandatory constraint '${mc.constraint}'`,
        );
      }
      if (mc.satisfied === false) {
        if (s.assessment.compatibility_score > 60) {
          errors.push(
            `Scoring violation for candidate ${s.candidate_id}: Mandatory constraint '${mc.constraint}' failed, but compatibility_score is ${s.assessment.compatibility_score} (must be capped at <= 60).`,
          );
        }
        if (s.assessment.fit_band === "Strong Fit") {
          errors.push(
            `Scoring violation for candidate ${s.candidate_id}: Mandatory constraint '${mc.constraint}' failed, but fit_band is 'Strong Fit' (must be Potential Fit or Low Fit).`,
          );
        }
      }
    }
  }

  // 2. Claim evidence references & subject verification
  let supportedMaterialClaimCount = 0;
  let unsupportedMaterialClaimCount = 0;
  for (const c of output.claims) {
    if (
      c.supplier_entity_id &&
      !validSupplierEntityIds.has(c.supplier_entity_id)
    ) {
      errors.push(
        `Claim ${c.claim_id} references non-existent supplier_entity_id: ${c.supplier_entity_id}`,
      );
    }
    if (c.evidence_ids.length === 0) {
      unsupportedMaterialClaimCount++;
      if (c.status === "externally_verified") {
        errors.push(
          `Claim ${c.claim_id} marked as 'externally_verified' but has zero supporting evidence_ids.`,
        );
      }
    } else {
      supportedMaterialClaimCount++;
      for (const eid of c.evidence_ids) {
        checkEvidenceRef(eid, `claim ${c.claim_id}`);
      }
    }
  }

  // 3. Evidence source references to claims
  for (const es of output.evidence_sources) {
    for (const cid of es.supports_claim_ids) {
      checkClaimRef(
        cid,
        `evidence_source ${es.evidence_id} supports_claim_ids`,
      );
    }
    for (const cid of es.contradicts_claim_ids) {
      checkClaimRef(
        cid,
        `evidence_source ${es.evidence_id} contradicts_claim_ids`,
      );
    }
  }

  // 4. Lineage coverage percentage calculation
  const totalReferences =
    output.claims.reduce((acc, c) => acc + c.evidence_ids.length, 0) +
    output.supplier_candidates.reduce(
      (acc, s) =>
        acc +
        s.identity_evidence_ids.length +
        s.contacts.contact_evidence_ids.length +
        s.offering.product_evidence_ids.length +
        s.commercial.commercial_evidence_ids.length +
        (s.packaging_and_logistics?.logistics_evidence_ids.length ?? 0) +
        s.certifications.reduce(
          (cAcc, cert) => cAcc + cert.evidence_ids.length,
          0,
        ) +
        s.assessment.mandatory_constraint_results.reduce(
          (mAcc, mc) => mAcc + mc.evidence_ids.length,
          0,
        ),
      0,
    );

  const resolvedReferences = totalReferences - orphanEvidenceReferences.length;
  const lineageCoveragePercentage =
    totalReferences === 0
      ? 100
      : Math.max(0, Math.round((resolvedReferences / totalReferences) * 100));

  // 5. Fixture truthfulness
  if (output.research_mode === "fixture") {
    const hasFixtureDisclosure = output.limitations_and_disclosures.some(
      (l) =>
        l.description.includes("Demonstration dataset") ||
        l.description.includes("not live market evidence") ||
        l.description.includes("fixture"),
    );
    if (!hasFixtureDisclosure) {
      errors.push(
        "Fixture mode output must include an explicit demonstration/fixture disclosure in limitations_and_disclosures.",
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    materialClaimCount: output.claims.length,
    supportedMaterialClaimCount,
    unsupportedMaterialClaimCount,
    orphanEvidenceReferences,
    orphanClaimReferences,
    lineageCoveragePercentage,
  };
}

export function assertConsultantOutputV3Integrity(
  output: ConsultantResearchOutputV3,
): void {
  const result = validateConsultantOutputV3Integrity(output);
  if (!result.isValid) {
    throw new Error(
      `Consultant Output V3 Integrity Verification Failed:\n- ${result.errors.join("\n- ")}`,
    );
  }
}
