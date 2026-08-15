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
      "src/fetch-runtime.simulator.test.ts",
      "src/runtime.simulator.postgres.test.ts",
      "src/standard-runtime.postgres.test.ts",
    ],
  },
});
