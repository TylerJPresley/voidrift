/**
 * `renderAccessReport` and `runAccessCommand` (cli-blueprint.md §7.4, §2.1).
 *
 * The renderer turns a structured, secret-free `AccessReport` into the FIXED
 * §7.4 text block (NO_COLOR-safe, fixed-width, no ANSI); the command selects the
 * agent by the headless rule, prints the block, and maps the exit code.
 */
import { describe, it, expect } from "vitest";
import type { AccessReport } from "@voidrift/core";
import { renderAccessReport, runAccessCommand } from "./access-command.js";
import { EXIT } from "./exit-codes.js";

/** A seeded-default-shaped report for the renderer snapshot. */
function seededReport(active = "chat"): AccessReport {
  return {
    activeAgent: active,
    agents: {
      topLevel: [
        { name: "chat", kind: "top-level", tools: ["*"], order: 10, unlisted: "ask", workers: "all", source: "builtin" },
        { name: "research", kind: "top-level", tools: ["read_file"], order: 20, unlisted: "deny", workers: ["researcher", "planner", "reviewer"], source: "global", file: "~/.config/voidrift/agents/research/agent.json" },
        { name: "vibe", kind: "top-level", tools: ["*"], order: 30, unlisted: "allow", confirm: true, workers: "all", source: "global", file: "~/.config/voidrift/agents/vibe/agent.json" },
      ],
      worker: [
        { name: "implementer", kind: "worker", tools: ["read_file", "write_file", "execute_command"], source: "global", file: "~/.config/voidrift/agents/implementer/agent.json", mutates: true },
        { name: "researcher", kind: "worker", tools: ["read_file"], source: "global", file: "~/.config/voidrift/agents/researcher/agent.json", mutates: false },
      ],
    },
    allowList: {
      tools: [
        { ruleId: "allow-read_file", tool: "read_file", layer: "default" },
        { ruleId: "allow-glob", tool: "glob_files", layer: "default" },
      ],
      commands: [
        { ruleId: "allow-exec-0", tool: "execute_command", pattern: "git status*", layer: "default" },
        { ruleId: "allow-exec-1", tool: "execute_command", pattern: "ls*", layer: "default" },
      ],
    },
    unlistedBehaviour: active === "research" ? "are denied" : active === "vibe" ? "run without asking" : "ask first",
    mutatingRunsFreely: active === "vibe",
    webSearch: { provider: "duckduckgo", note: "(default) — your queries are sent there" },
    models: [],
    neverList: [
      { id: "wipe-disk", description: "wipe a disk or filesystem", unlocked: false },
      { id: "power-state", description: "change the machine power state", unlocked: true },
    ],
    alwaysAsks: ["dangerous-but-ordinary commands: rm -rf, …", "to allow one: add an exact-command allow entry"],
    unlock: [{ id: "power-state", layer: "global", file: "~/.config/voidrift/config.json" }],
    rules: [
      { ruleId: "deny-0", tool: "execute_command", pattern: "terraform*", decision: "deny", layer: "project", file: ".voidrift/config.json" },
      { ruleId: "allow-x", tool: "execute_command", pattern: "git push --force-with-lease", exact: true, decision: "allow", layer: "global", file: "~/.config/voidrift/config.json" },
    ],
    workers: [
      { name: "researcher", tools: ["read_file"], mutates: false },
      { name: "implementer", tools: ["read_file", "write_file"], mutates: true },
    ],
    plugins: [
      { id: "@voidrift/plugin-routines", enabled: true, layer: "global", file: "~/.config/voidrift/config.json", hasOptions: false, tools: [], toolsKnown: false },
      { id: "@voidrift/plugin-otel-exporter", enabled: true, layer: "project", file: ".voidrift/config.json", hasOptions: true, tools: [], toolsKnown: false },
    ],
    rollback: { method: "git", snapshotCount: 50, layer: "global", file: "~/.config/voidrift/config.json" },
    notices: { rejections: [], warnings: [] },
  };
}

describe("renderAccessReport (§7.4)", () => {
  it("renders the fixed block with every section in order, NO ANSI", () => {
    const out = renderAccessReport(seededReport("chat"));
    // No ANSI escape anywhere.
    expect(out).not.toMatch(/\u001B\[/);
    // The header line.
    expect(out).toContain("VoidRift access — active agent: chat   (switching: prompt, tools, workers, and what unlisted calls do)");
    // Agents section, the active marker and built-in source.
    expect(out).toMatch(/chat\s+order 10\s+unlisted: ask\s+workers: all\s+← active\s+\(built-in\)/);
    expect(out).toContain("(confirm)");
    // Allow list labelled.
    expect(out).toContain("Runs without asking (the allow list, exactly as configured):");
    expect(out).toContain("execute_command:");
    // Calls-not-on-allow line.
    expect(out).toContain("Calls not on the allow list, under this agent (chat): ask first");
    // Web search.
    expect(out).toContain("Web search: duckduckgo (default) — your queries are sent there");
    // Never list with an unlocked marker.
    expect(out).toContain("Always denied (the never list — never asked, under every agent):");
    expect(out).toContain("change the machine power state  (unlocked: still asks)");
    // Always asks.
    expect(out).toContain("Always asks, even with a wildcard allow entry:");
    // Workers, with (mutates → isolated).
    expect(out).toContain("Workers this agent may delegate to (name · tools):");
    expect(out).toContain("(mutates → isolated)");
    // Your rules: deny above allow, each with layer+file.
    expect(out).toContain("Your rules:");
    expect(out).toMatch(/deny\s+terraform\*\s+\(project \.voidrift\/config\.json\)/);
    expect(out).toContain("exact command");
    // Unlocked never-list entries.
    expect(out).toContain("Unlocked never-list entries:");
    expect(out).toContain("power-state   (global ~/.config/voidrift/config.json)");
    // Plugins: value-free inventory (id, options yes/no, tools, layer+file).
    expect(out).toContain("Plugins (id · options · tools it contributes):");
    expect(out).toMatch(/@voidrift\/plugin-routines\s+options: no\s+tools: \(enable to list\)\s+\(global ~\/.config\/voidrift\/config\.json\)/);
    expect(out).toMatch(/@voidrift\/plugin-otel-exporter\s+options: yes\s+tools: \(enable to list\)\s+\(project \.voidrift\/config\.json\)/);
    // Rollback line: method + tracked-move count, with the snapshotCount layer/file.
    expect(out).toContain("Rollback: git snapshots, tracking the last 50 moves (/undo /redo /goto)   (global ~/.config/voidrift/config.json)");
    // Closing line.
    expect(out.trimEnd().endsWith("Deny wins. Every entry above shows the layer and file it came from.")).toBe(true);
  });

  it("renders the rollback-off line when snapshotCount is 0", () => {
    const r = seededReport("chat");
    r.rollback = { method: "off", snapshotCount: 0, layer: "global", file: "~/.config/voidrift/config.json" };
    const out = renderAccessReport(r);
    expect(out).toContain("Rollback: off (snapshotCount 0) — set snapshotCount to enable /undo /redo /goto   (global ~/.config/voidrift/config.json)");
  });

  it("renders the cache method when not a git repo", () => {
    const r = seededReport("chat");
    r.rollback = { method: "cache", snapshotCount: 50, layer: "default" };
    const out = renderAccessReport(r);
    expect(out).toContain("Rollback: cache snapshots, tracking the last 50 moves (/undo /redo /goto)   (default)");
  });

  it("empty rules and unlock print (none)", () => {
    const r = seededReport("chat");
    r.rules = [];
    r.unlock = [];
    const out = renderAccessReport(r);
    expect(out).toMatch(/Your rules:\n  \(none\)/);
    expect(out).toMatch(/Unlocked never-list entries:\n  \(none\)/);
  });

  it("no configured plugin prints (none); known tools and a disabled marker render", () => {
    const r = seededReport("chat");
    r.plugins = [];
    expect(renderAccessReport(r)).toMatch(/Plugins \(id · options · tools it contributes\):\n  \(none\)/);
    // A live registry supplying tools renders them; a disabled entry is marked.
    r.plugins = [
      { id: "@voidrift/plugin-retrieval", enabled: true, layer: "global", file: "~/.config/voidrift/config.json", hasOptions: true, tools: ["retrieval_search", "retrieval_related"], toolsKnown: true },
      { id: "@voidrift/plugin-plan", enabled: false, layer: "project", file: ".voidrift/config.json", hasOptions: false, tools: [], toolsKnown: true },
    ];
    const out = renderAccessReport(r);
    expect(out).toContain("tools: retrieval_search, retrieval_related");
    expect(out).toContain("@voidrift/plugin-plan (disabled)   options: no   tools: (none)");
  });

  it("vibe shows the mutating-runs-freely note", () => {
    const out = renderAccessReport(seededReport("vibe"));
    expect(out).toContain("run without asking — a mutating tool runs without asking under this agent");
  });

  it("renders a Models section only when a project/session redirected an endpoint (host + env NAME)", () => {
    const r = seededReport("chat");
    // Default fixture: no project-redirected model → no Models section.
    expect(renderAccessReport(r)).not.toContain("Models (a project/session config");
    r.models = [{ name: "local", host: "attacker.test", apiKeyEnv: "OPENAI_API_KEY", layer: "project" }];
    const out = renderAccessReport(r);
    expect(out).toContain("Models (a project/session config set the endpoint or key env — your API key is sent there):");
    expect(out).toContain("local   attacker.test   (project)  key: $OPENAI_API_KEY");
  });

  it("SANITIZE: ESC and bidi (U+202E) in a rule pattern, an agent name, and a file path never reach stdout", () => {
    const r = seededReport("chat");
    // An agent name, a file path, and a rule pattern all originate OUTSIDE the
    // CLI — a hostile config could carry an ESC CSI or a bidi override.
    r.agents.topLevel[0]!.name = "chat\u001b[2J\u202eevil";
    r.agents.topLevel[0]!.file = "~/.config/\u202evoidrift\u202c/agents/x";
    r.rules[0]!.pattern = "terraform\u001b[31m*\u202edestroy";
    r.workers[0]!.name = "researcher\u200b\u2066spoof";
    r.webSearch.note = "(host)\u001b[2K — sent";
    r.neverList[0]!.description = "wipe\u202edisk";
    const out = renderAccessReport(r);
    // eslint-disable-next-line no-control-regex
    const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;
    expect(FORBIDDEN.test(out.replace(/[\n\t]/g, ""))).toBe(false);
    expect(out).not.toMatch(/\u001B\[/);
  });
});

describe("runAccessCommand (§2.1)", () => {
  function sink(): { out: () => string; err: () => string; stdout: { write(s: string): void }; stderr: { write(s: string): void } } {
    const box = { out: "", err: "" };
    return {
      out: () => box.out,
      err: () => box.err,
      stdout: { write: (s: string) => { box.out += s; } },
      stderr: { write: (s: string) => { box.err += s; } },
    };
  }

  it("prints the deny agent's block and exits 0 (no flag)", async () => {
    const s = sink();
    const code = await runAccessCommand({}, {
      stdout: s.stdout,
      stderr: s.stderr,
      cwd: "/ws",
      run: async (opts) => seededReport(opts?.agent ?? "chat"),
    });
    expect(code).toBe(EXIT.COMPLETED);
    // The first unlisted:deny agent by order is research.
    expect(s.out()).toContain("active agent: research");
  });

  it("--enable-write prints the allow agent's block", async () => {
    const s = sink();
    const code = await runAccessCommand({ enableWrite: true }, {
      stdout: s.stdout,
      stderr: s.stderr,
      cwd: "/ws",
      run: async (opts) => seededReport(opts?.agent ?? "chat"),
    });
    expect(code).toBe(EXIT.COMPLETED);
    expect(s.out()).toContain("active agent: vibe");
  });

  it("no agent with the needed posture → exit 2 refusal naming the agents folder", async () => {
    const s = sink();
    const noDeny = seededReport("chat");
    noDeny.agents.topLevel = noDeny.agents.topLevel.filter((a) => a.unlisted !== "deny");
    const code = await runAccessCommand({}, {
      stdout: s.stdout,
      stderr: s.stderr,
      cwd: "/ws",
      run: async () => noDeny,
    });
    expect(code).toBe(EXIT.USAGE);
    expect(s.err()).toContain("no top-level agent with unlisted: deny");
    expect(s.err()).toContain("voidrift init");
  });
});
