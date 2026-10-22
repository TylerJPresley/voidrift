import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    setupFiles: ["./src/test-hermetic.ts"],
    globalSetup: ["./src/test-hermetic.global.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/test-hermetic.global.ts","src/**/*.test.ts", "src/**/*.test.tsx"],
    },
  },
});
