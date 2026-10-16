import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Creates and migrates the dispatch_test database once per run.
    globalSetup: ["./test/global-setup.ts"],
    // Test files share one database, so they run one at a time.
    fileParallelism: false,
  },
});
