import assert from "node:assert/strict";
import test from "node:test";

import { validateLicenseInventory } from "../scripts/license-policy.mjs";

test("MB-UX-QUALITY-001 L06 admits only the reviewed PDF decompression package", () => {
  assert.equal(
    validateLicenseInventory({
      "(MIT AND Zlib)": [{ name: "pako", versions: ["1.0.11"] }],
    }),
    1,
  );
  for (const entry of [
    { name: "another-package", versions: ["1.0.11"] },
    { name: "pako", versions: ["1.0.12"] },
  ]) {
    assert.throws(
      () => validateLicenseInventory({ "(MIT AND Zlib)": [entry] }),
      /Unreviewed dependency licenses/,
    );
  }
});

test("accepts only the reviewed Linux libvips package and locked version", () => {
  assert.equal(
    validateLicenseInventory({
      MIT: [{ name: "example", versions: ["1.0.0"] }],
      "LGPL-3.0-or-later": [
        {
          name: "@img/sharp-libvips-linux-x64",
          versions: ["1.3.2", "1.3.3"],
        },
      ],
    }),
    2,
  );
});

test("rejects a different package or version under the conditional license", () => {
  for (const entry of [
    { name: "unreviewed-package", versions: ["1.3.2"] },
    { name: "@img/sharp-libvips-linux-x64", versions: ["1.3.4"] },
  ]) {
    assert.throws(
      () =>
        validateLicenseInventory({
          "LGPL-3.0-or-later": [entry],
        }),
      /Unreviewed dependency licenses: LGPL-3.0-or-later/,
    );
  }
});
