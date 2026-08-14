import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  PathPolicyError,
  assertAllowedPath,
  containsForbiddenMepSegment,
  isWithinRoot,
  redactSensitiveText,
} from "../src/security.js";

test("path policy rejects traversal outside the configured root", () => {
  const root = resolve("test", "fixtures", "source");
  assert.equal(isWithinRoot(root, root), true);
  assert.equal(isWithinRoot(root, resolve(root, "DECISION_REGISTER.md")), true);
  assert.equal(isWithinRoot(root, resolve(root, "..", "outside.md")), false);
  assert.throws(
    () => assertAllowedPath(resolve(root, "..", "outside.md"), [root]),
    PathPolicyError,
  );
});

test("MEP segments are excluded case-insensitively", () => {
  assert.equal(
    containsForbiddenMepSegment(resolve("test", "MEP", "artifact.md")),
    true,
  );
  assert.equal(
    containsForbiddenMepSegment(resolve("test", "MEP_snapshot.pdf")),
    true,
  );
  assert.equal(
    containsForbiddenMepSegment(resolve("test", "product", "artifact.md")),
    false,
  );
});

test("redaction removes credentials and direct identifiers", () => {
  const githubToken = `gh${"p"}_${"a".repeat(24)}`;
  const googleKey = `AI${"za"}${"A".repeat(34)}`;
  const openAiKey = ["sk", "proj", "A".repeat(32)].join("-");
  const openRouterKey = ["sk", "or", "v1", "B".repeat(32)].join("-");
  const awsKey = `AK${"IA"}${"C".repeat(16)}`;
  const slackKey = `xo${"xb"}-${"1".repeat(12)}-${"D".repeat(24)}`;
  const input = [
    "owner=person@example.test",
    `access_token=${githubToken}`,
    `key=${googleKey}`,
    openAiKey,
    openRouterKey,
    awsKey,
    slackKey,
    "phone=+44 20 7946 0958",
    "host=192.0.2.4",
    "url=https://demo:unsafe-password@example.test/path",
  ].join("\n");
  const result = redactSensitiveText(input);
  assert.equal(result.text.includes("person@example.test"), false);
  assert.equal(result.text.includes(githubToken), false);
  assert.equal(result.text.includes(googleKey), false);
  assert.equal(result.text.includes(openAiKey), false);
  assert.equal(result.text.includes(openRouterKey), false);
  assert.equal(result.text.includes(awsKey), false);
  assert.equal(result.text.includes(slackKey), false);
  assert.equal(result.text.includes("unsafe-password"), false);
  assert.ok(result.count >= 9);
});
