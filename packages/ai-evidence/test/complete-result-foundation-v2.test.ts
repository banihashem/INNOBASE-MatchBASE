import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_LOW_CONFIDENCE_CAUTION_TEXT,
  type CompleteResultEvidenceV2,
  type TrustedLiveFetchRecordV2,
} from "@matchbase/contracts";
import {
  UNUSED_LIVE_SOURCE_EXCLUSION_REASON,
  buildCompleteResultFoundationV2,
  readStoredCompleteResultDocumentWithoutRewrite,
  sealTrustedLiveFetchLedgerV2,
  validateCompleteResultFoundationV2,
} from "../src/complete-result/foundation-v2.js";
import { buildCompleteResultFoundation } from "../src/complete-result/foundation.js";
import { standardContentSha256 } from "../src/evidence/standard.js";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "../src/research/standard-synthetic-fixtures.js";

function graph() {
  return buildStandardSyntheticEvidenceGraph(
    "RUN-FOUNDATION-V2",
    "many",
    buildStandardSyntheticHardConstraints(),
  );
}

type LiveEvidenceV2 = Extract<
  CompleteResultEvidenceV2,
  { provenance: "live_secure_fetch" }
>;

function liveEvidence(
  source: ReturnType<typeof graph>,
  index = 0,
): LiveEvidenceV2 {
  const basis = source.evidence[index]!;
  const live = {
    ...basis,
    source_kind: "reserved_url",
    exact_url: `https://evidence-${index}.example.org/source`,
    publisher_domain: `evidence-${index}.example.org`,
    accessed_at: `2026-08-25T00:00:0${index}.000Z`,
    content_sha256: String(index + 1).repeat(64),
    provenance: "live_secure_fetch",
    verification_status: "claimed",
    external_verification_basis: {
      kind: "not_externally_verified",
    },
  } as const satisfies LiveEvidenceV2;
  delete (live as unknown as Record<string, unknown>).fixture_identity;
  return live as LiveEvidenceV2;
}

function trustedRecord(
  item: CompleteResultEvidenceV2,
  authorityClass: TrustedLiveFetchRecordV2["authority_class"] = "ordinary_source",
): TrustedLiveFetchRecordV2 {
  assert.equal(item.provenance, "live_secure_fetch");
  assert.ok("exact_url" in item);
  return {
    evidence_id: item.evidence_id,
    canonical_url: item.exact_url,
    publisher_domain: item.publisher_domain,
    retrieved_at: item.accessed_at,
    content_sha256: item.content_sha256,
    bounded_excerpt: item.extract,
    authority_class: authorityClass,
  };
}

const ledger = (records: readonly TrustedLiveFetchRecordV2[]) =>
  sealTrustedLiveFetchLedgerV2(records);

test("derives Demo rationale only from closed mandatory rule outcomes", () => {
  const first = graph();
  const second = structuredClone(first);
  second.candidates.forEach((candidate) => {
    candidate.rationale_extended = "POISON factual supplier claim";
  });
  second.candidates.forEach((candidate) =>
    candidate.dimensions.forEach((dimension) => {
      dimension.score = dimension.score === 0 ? 100 : 0;
    }),
  );
  second.claims.forEach((claim) => {
    claim.text = "POISON citation-backed claim";
  });
  second.evidence.forEach((item) => {
    item.title = "POISON citation title";
    item.extract = "POISON citation body";
    item.content_sha256 = standardContentSha256(item.extract);
  });
  const a = buildCompleteResultFoundationV2(first);
  const b = buildCompleteResultFoundationV2(second);
  assert.deepEqual(a.demo_rationale_sources, b.demo_rationale_sources);
  assert.ok(
    a.demo_rationale_sources.every((item) => Object.keys(item).length === 3),
  );
});

test("rejects missing, unmapped, factual, and extended Demo rationale fields", () => {
  for (const mutate of [
    (value: any) => value.demo_rationale_sources.pop(),
    (value: any) => {
      value.demo_rationale_sources[0].rule_outcome = "score_was_high";
    },
    (value: any) => {
      value.demo_rationale_sources[0].rationale_short =
        "Supplier says it is certified.";
    },
    (value: any) => {
      value.demo_rationale_sources[0].confidence = "high";
    },
  ]) {
    const value: any = structuredClone(
      buildCompleteResultFoundationV2(graph()),
    );
    mutate(value);
    assert.throws(() => validateCompleteResultFoundationV2(value));
  }
});

test("emits exactly one closed top-level low-confidence caution", () => {
  const source = graph();
  const eligible = source.candidates.find((item) =>
    source.eligible_candidate_ids.includes(item.candidate_id),
  );
  assert.ok(eligible);
  eligible.evidence_confidence = "low";
  const value = buildCompleteResultFoundationV2(source);
  assert.deepEqual(value.demo_low_confidence_caution, {
    state: "present",
    text: DEMO_LOW_CONFIDENCE_CAUTION_TEXT,
  });
  const forged: any = structuredClone(value);
  forged.demo_low_confidence_caution = [
    value.demo_low_confidence_caution,
    value.demo_low_confidence_caution,
  ];
  assert.throws(
    () => validateCompleteResultFoundationV2(forged),
    /one top-level object/iu,
  );
});

test("retains unused live fetches as excluded and never infers verification", () => {
  const source = graph();
  const live = {
    ...liveEvidence(source),
    evidence_id: "LIVE-SERVER-EVIDENCE-1",
  } as CompleteResultEvidenceV2;
  source.evidence.push(live as any);
  const binding = trustedRecord(live);
  const trustedLedger = ledger([binding]);
  const value = buildCompleteResultFoundationV2(source, trustedLedger);
  const retained = value.evidence.find(
    (item) => item.evidence_id === live.evidence_id,
  )!;
  assert.equal(retained.verification_status, "claimed");
  assert.equal(retained.verification_disposition, "excluded");
  assert.equal(
    "exclusion_reason" in retained && retained.exclusion_reason,
    UNUSED_LIVE_SOURCE_EXCLUSION_REASON,
  );

  for (const mutate of [
    (item: any) => {
      item.publisher_domain = "attacker.example";
    },
    (item: any) => {
      item.accessed_at = "yesterday";
    },
    (item: any) => {
      item.content_sha256 = "bad";
    },
    (item: any) => {
      item.exact_url = "http://evidence.example.org/source";
    },
    (item: any) => {
      item.server_claimed_verified = true;
    },
  ]) {
    const forged: any = structuredClone(value);
    mutate(
      forged.evidence.find(
        (item: any) => item.evidence_id === live.evidence_id,
      ),
    );
    assert.throws(() =>
      validateCompleteResultFoundationV2(forged, trustedLedger),
    );
  }
});

test("requires an exact independent trusted binding for every live tuple", () => {
  const source = graph();
  const live = liveEvidence(source);
  source.evidence[0] = live as any;
  const binding = trustedRecord(live);
  assert.throws(
    () => buildCompleteResultFoundationV2(source),
    /not bound to its trusted fetch record/iu,
  );
  const trustedLedger = ledger([binding]);
  const value = buildCompleteResultFoundationV2(source, trustedLedger);
  const forged: any = structuredClone(value);
  const item = forged.evidence[0];
  item.exact_url = "https://attacker.example/forged";
  item.publisher_domain = "attacker.example";
  item.accessed_at = "2026-08-25T01:02:03.000Z";
  item.content_sha256 = "f".repeat(64);
  item.extract = "Coordinated forged tuple.";
  assert.throws(
    () => validateCompleteResultFoundationV2(forged, trustedLedger),
    /not bound to its trusted fetch record/iu,
  );
});

test("retains every trusted fetched record and excludes every unrelated unused fetch", () => {
  const source = graph();
  const used = liveEvidence(source);
  const unused = {
    ...liveEvidence(source, 1),
    evidence_id: "LIVE-UNUSED-FETCH",
  } as const satisfies LiveEvidenceV2;
  source.evidence[0] = used as any;
  source.evidence.push(unused as any);
  const bindings = [trustedRecord(used), trustedRecord(unused)] as const;
  const value = buildCompleteResultFoundationV2(source, ledger(bindings));
  const retainedUsed = value.evidence.find(
    (item) => item.evidence_id === used.evidence_id,
  );
  const retainedUnused = value.evidence.find(
    (item) => item.evidence_id === unused.evidence_id,
  );
  assert.ok(retainedUsed);
  assert.ok(retainedUnused);
  assert.equal(retainedUnused.verification_disposition, "excluded");
  assert.equal(
    "exclusion_reason" in retainedUnused &&
      retainedUnused.exclusion_reason.trim().length > 0,
    true,
  );

  const unretainedFetch: TrustedLiveFetchRecordV2 = {
    ...trustedRecord(unused),
    evidence_id: "LIVE-FETCH-NOT-RETAINED",
    canonical_url: "https://unretained.example.org/source",
    publisher_domain: "unretained.example.org",
    content_sha256: "9".repeat(64),
    bounded_excerpt: "Fetched but omitted server record.",
  };
  assert.throws(
    () =>
      buildCompleteResultFoundationV2(
        source,
        ledger([...bindings, unretainedFetch]),
      ),
    /every trusted live fetch record must be retained/iu,
  );
});

test("rejects fabricated ledgers and aliased trusted tuples", () => {
  const source = graph();
  const live = liveEvidence(source);
  source.evidence[0] = live as any;
  const record = trustedRecord(live);
  const fabricated = {
    schema_version: "trusted-live-fetch-ledger.v2",
    record_count: 1,
  } as any;
  assert.throws(
    () => buildCompleteResultFoundationV2(source, fabricated),
    /not server-sealed/iu,
  );
  assert.throws(
    () =>
      sealTrustedLiveFetchLedgerV2([
        record,
        { ...record, evidence_id: "ALIASED-EVIDENCE-ID" },
      ]),
    /multiple evidence IDs/iu,
  );
});

test("fails external verification closed until trusted claim support exists", () => {
  const independentSource = graph();
  const independentLive = {
    ...liveEvidence(independentSource),
    verification_status: "externally_verified",
    external_verification_basis: {
      kind: "independent_corroboration",
      independent_evidence_ids: [
        independentSource.evidence[1]!.evidence_id,
        independentSource.evidence[2]!.evidence_id,
      ],
    },
  } as const satisfies CompleteResultEvidenceV2;
  independentSource.evidence[0] = independentLive as any;
  independentSource.claims[0]!.verification_status = "externally_verified";
  independentSource.claims[0]!.high_risk = true;
  independentSource.claims[0]!.evidence_ids = [
    independentLive.evidence_id,
    ...independentLive.external_verification_basis.independent_evidence_ids,
  ];
  independentSource.claims[0]!.corroboration = {
    required: true,
    status: "satisfied",
    independent_evidence_ids: [
      ...independentLive.external_verification_basis.independent_evidence_ids,
    ],
  };
  assert.throws(
    () =>
      buildCompleteResultFoundationV2(
        independentSource,
        ledger([trustedRecord(independentLive)]),
      ),
    /trusted server claim-support registry/iu,
  );

  const forgedSource = graph();
  const forgedLive = {
    ...liveEvidence(forgedSource),
    verification_status: "externally_verified",
  } as unknown as LiveEvidenceV2;
  forgedSource.evidence[0] = forgedLive as any;
  assert.throws(
    () =>
      buildCompleteResultFoundationV2(
        forgedSource,
        ledger([trustedRecord(forgedLive)]),
      ),
    /trusted server claim-support registry/iu,
  );

  const registrySource = graph();
  const registry = {
    ...liveEvidence(registrySource, 1),
    evidence_id: "LIVE-AUTHORITATIVE-REGISTRY",
  } as const satisfies LiveEvidenceV2;
  const registryVerified = {
    ...liveEvidence(registrySource),
    verification_status: "externally_verified",
    external_verification_basis: {
      kind: "authoritative_registry",
      registry_evidence_id: registry.evidence_id,
    },
  } as const satisfies CompleteResultEvidenceV2;
  registrySource.evidence[0] = registryVerified as any;
  registrySource.evidence.push(registry as any);
  registrySource.claims[0]!.verification_status = "externally_verified";
  registrySource.claims[0]!.evidence_ids = [
    registryVerified.evidence_id,
    registry.evidence_id,
  ];
  const registryLedger = ledger([
    trustedRecord(registryVerified),
    trustedRecord(registry, "authoritative_registry"),
  ]);
  assert.throws(
    () => buildCompleteResultFoundationV2(registrySource, registryLedger),
    /trusted server claim-support registry/iu,
  );
  assert.throws(
    () =>
      buildCompleteResultFoundationV2(
        registrySource,
        ledger([trustedRecord(registryVerified), trustedRecord(registry)]),
      ),
    /trusted server claim-support registry/iu,
  );
});

test("rejects corroboration attached only to another candidate claim", () => {
  const source = graph();
  const external = {
    ...liveEvidence(source),
    verification_status: "externally_verified",
    external_verification_basis: {
      kind: "independent_corroboration",
      independent_evidence_ids: [
        source.evidence[1]!.evidence_id,
        source.evidence[2]!.evidence_id,
      ],
    },
  } as const satisfies CompleteResultEvidenceV2;
  source.evidence[0] = external as any;
  const other = source.claims.find(
    (claim) => claim.candidate_id !== source.claims[0]!.candidate_id,
  )!;
  other.verification_status = "externally_verified";
  other.high_risk = true;
  other.evidence_ids = [
    ...external.external_verification_basis.independent_evidence_ids,
  ];
  other.corroboration = {
    required: true,
    status: "satisfied",
    independent_evidence_ids: [
      ...external.external_verification_basis.independent_evidence_ids,
    ],
  };
  source.claims[0]!.verification_status = "externally_verified";
  source.claims[0]!.evidence_ids = [external.evidence_id];
  assert.throws(
    () =>
      buildCompleteResultFoundationV2(
        source,
        ledger([trustedRecord(external)]),
      ),
    /trusted server claim-support registry/iu,
  );
});

test("reads v2, v1 and legacy without rewriting and never falls back", () => {
  const legacy = graph();
  const v1 = buildCompleteResultFoundation(legacy);
  const v2 = buildCompleteResultFoundationV2(legacy);
  for (const [kind, input] of [
    ["foundation_v2", v2],
    ["foundation_v1", v1],
    ["legacy_standard_evidence_graph_v1", legacy],
  ] as const) {
    const before = JSON.stringify(input);
    const read = readStoredCompleteResultDocumentWithoutRewrite(input);
    assert.equal(read.kind, kind);
    assert.equal(JSON.stringify(read.document), before);
  }
  assert.throws(() =>
    readStoredCompleteResultDocumentWithoutRewrite({
      ...legacy,
      schema_version: "future.v9",
    }),
  );
  const extra: any = structuredClone(v2);
  extra.projection = {};
  assert.throws(
    () => validateCompleteResultFoundationV2(extra),
    /invalid fields/iu,
  );
});
