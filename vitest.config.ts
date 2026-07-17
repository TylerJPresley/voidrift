import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensions: [".js", ".ts", ".tsx", ".json"],
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/main.tsx",
        "src/serve.ts",
        "src/bootstrap/cli.ts",
        "src/bootstrap/headless.ts",
        "src/mcp/oauth.ts",
        "src/mcp/discovery.ts",
        "src/mcp/engine.ts",        // Network-dependent (connect, callTool)
        "src/mcp/credentials.ts",   // Filesystem + crypto
        "src/ui/panels/**",
        "src/ui/chat-components.tsx",
        "src/ui/markdown.tsx",
        "src/ui/raw-input.tsx",
        "src/ui/scroll-view.tsx",
        "src/ui/table.tsx",
        "src/ui/DeclarativePanel.tsx",
        "src/utils/clipboard.ts",
        "src/utils/editor.ts",      // Spawns processes
        "src/types/**",
        "src/infrastructure/**",
        "src/orchestration/graph.ts", // 773-line integration (model calls, tool loop)
        "src/orchestration/goal.ts",  // Requires model
        "src/turn.ts",                // Requires full engine
        "src/plugins/interface.ts",   // Integration facade (tested via panel-actions)
        "src/session/reflector.ts",   // Requires model
        "src/codemap/summarizer.ts",  // Requires model
        "src/index.ts",               // Re-exports only
        "src/panels.tsx",             // Re-exports only
        "src/engine.ts",              // Type-only interface
        "src/version.ts",
      ],
    },
  },
});
