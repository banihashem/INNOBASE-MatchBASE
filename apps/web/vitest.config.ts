import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    fileParallelism: false,
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: [
      "components/**/*.test.tsx",
      "src/authorization-matrix.postgres.test.ts",
      "src/admin-p4-route-core.test.ts",
      "src/artifact-download-route-core.test.ts",
      "src/consultant-route-core.test.ts",
      "src/config.test.ts",
      "src/fetch-runtime.simulator.test.ts",
      "src/gcs-artifact-object-reader.test.ts",
      "src/google-risc-route-core.test.ts",
      "src/bounded-request-body.test.ts",
      "src/origin-admission.test.ts",
      "src/runtime.simulator.postgres.test.ts",
      "src/standard-runtime.postgres.test.ts",
      "src/task074-output-restriction.postgres.test.mjs",
    ],
  },
});
