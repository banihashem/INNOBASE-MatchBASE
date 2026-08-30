import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: resolve(import.meta.dirname, "../.."),
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "apps/web/src/admin-entitlements-route-core.test.ts",
      "apps/web/src/admin-entitlements.postgres.test.ts",
      "apps/web/src/admin-runs-route-core.test.ts",
      "apps/web/src/admin-runs.postgres.test.ts",
    ],
  },
});
