import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    root: resolve(__dirname, "packages/cli"),
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "packages/cli/src"),
    },
  },
});
