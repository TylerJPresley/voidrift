import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  clean: true,
  dts: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["openai", "@anthropic-ai/sdk", "ink", "ink-text-input", "react"],
});
