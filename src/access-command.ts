/**
 * `voidrift access` and the `/access` renderer (cli-blueprint.md §2.1, §7.4).
 *
 * `access` is a top-level COMMAND like `init`/`doctor`, bound to the HOST-LEVEL
 * `accessReportConfigHome` the core exports (§7.4): it runs WITHOUT booting a
 * full core, needing a model, or starting a session — the agent is selected by
 * the SAME rule headless uses (first `unlisted: deny` by order, or first
 * `unlisted: allow` with `--enable-write`). It never calls a model and writes
 * nothing.
 *
 * `renderAccessReport` turns the structured, secret-free {@link AccessReport}
 * into the FIXED §7.4 text block. The TUI's `/access` renders the SAME function
 * for the current active agent (as a system message); `voidrift access` prints
 * it to stdout. NO_COLOR-safe: meaning in words and layout alone, no ANSI.
 */
import { accessReportConfigHome, type AccessReport, type AccessAgent, type AccessAllowEntry, type LayerTag } from "@voidrift/core";
import { EXIT } from "./exit-codes.js";
import { sanitize } from "./render/theme.js";

/** The streams/process surface `access` touches, injected so tests drive it. */
export interface AccessDeps {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  cwd: string;
  /** The host access runner (injected for tests; defaults to the core export). */
  run?: typeof accessReportConfigHome;
}

/** Wrap space-separated tokens to a column width, indenting continuation lines. */
function wrapTokens(tokens: readonly string[], indent: string, width = 100): string[] {
  const lines: string[] = [];
  let cur = indent;
  for (const tok of tokens) {
    const candidate = cur === indent ? cur + tok : cur + "  " + tok;
    if (candidate.length > width && cur !== indent) {
      lines.push(cur);
      cur = indent + tok;
    } else {
      cur = candidate;
    }
  }
  if (cur !== indent || lines.length === 0) lines.push(cur);
  return lines;
}

/** The parenthesised source label for an agent row. */
function agentSource(a: AccessAgent): string {
  if (a.source === "builtin") return "(built-in)";
  return `(${a.file ?? a.source})`;
}

/** The `(<layer> <file>)` tag for a rule/unlock line. */
function layerTag(layer: LayerTag, file?: string): string {
  if (file) return `(${layer} ${file})`;
  return `(${layer})`;
}

/** The allow-list display token for one entry (its pattern or tool name). */
function allowToken(e: AccessAllowEntry): string {
  return e.tool === "execute_command" ? (e.pattern ?? "*") : e.tool;
}

/** Sanitize every config-origin string of the report (§4 terminal-escape
 * defence): agent names, tool/pattern/rule values, file paths, worker names,
 * webSearch provider/note, never-list descriptions, unlock ids, and notices all
 * originate OUTSIDE the CLI, so `sanitize` strips ANSI/control/bidi before any
 * of them reaches stdout. Layer tags, decisions, booleans, and orders are
 * CLI-fixed and left untouched. The §7.4 layout is otherwise unchanged. */
function sanitizeAccessReport(r: AccessReport): AccessReport {
  const s = sanitize;
  const agent = (a: AccessAgent): AccessAgent => ({
    ...a,
    name: s(a.name),
    tools: a.tools.map(s),
    ...(a.workers !== undefined ? { workers: a.workers === "all" ? "all" : a.workers.map(s) } : {}),
    ...(a.file !== undefined ? { file: s(a.file) } : {}),
  });
  const allow = (e: AccessAllowEntry): AccessAllowEntry => ({
    ...e,
    ruleId: s(e.ruleId),
    tool: s(e.tool),
    ...(e.pattern !== undefined ? { pattern: s(e.pattern) } : {}),
    ...(e.cidr !== undefined ? { cidr: s(e.cidr) } : {}),
    ...(e.file !== undefined ? { file: s(e.file) } : {}),
  });
  return {
    ...r,
    activeAgent: s(r.activeAgent),
    agents: { topLevel: r.agents.topLevel.map(agent), worker: r.agents.worker.map(agent) },
    allowList: { tools: r.allowList.tools.map(allow), commands: r.allowList.commands.map(allow) },
    unlistedBehaviour: s(r.unlistedBehaviour),
    webSearch: { provider: s(r.webSearch.provider), note: s(r.webSearch.note) },
    models: (r.models ?? []).map((m) => ({
      ...m,
      name: s(m.name),
      ...(m.host !== undefined ? { host: s(m.host) } : { host: m.host }),
      ...(m.apiKeyEnv !== undefined ? { apiKeyEnv: s(m.apiKeyEnv) } : { apiKeyEnv: m.apiKeyEnv }),
    })),
    neverList: r.neverList.map((n) => ({ ...n, id: s(n.id), description: s(n.description) })),
    unlock: r.unlock.map((u) => ({ ...u, id: s(u.id), ...(u.file !== undefined ? { file: s(u.file) } : {}) })),
    rollback: { ...r.rollback, ...(r.rollback.file !== undefined ? { file: s(r.rollback.file) } : {}) },
    rules: r.rules.map((rule) => ({
      ...rule,
      ruleId: s(rule.ruleId),
      tool: s(rule.tool),
      ...(rule.pattern !== undefined ? { pattern: s(rule.pattern) } : {}),
      ...(rule.cidr !== undefined ? { cidr: s(rule.cidr) } : {}),
      ...(rule.file !== undefined ? { file: s(rule.file) } : {}),
    })),
    workers: r.workers.map((w) => ({
      ...w,
      name: s(w.name),
      tools: w.tools.map(s),
      ...(w.file !== undefined ? { file: s(w.file) } : {}),
    })),
    plugins: (r.plugins ?? []).map((p) => ({
      ...p,
      id: s(p.id),
      tools: p.tools.map(s),
      ...(p.file !== undefined ? { file: s(p.file) } : {}),
    })),
    notices: {
      rejections: r.notices.rejections.map((n) => ({ ...n, message: s(n.message), ...(n.file !== undefined ? { file: s(n.file) } : {}) })),
      warnings: r.notices.warnings.map((n) => ({ ...n, message: s(n.message), ...(n.file !== undefined ? { file: s(n.file) } : {}) })),
    },
  };
}

/** Render the FIXED §7.4 effective-permissions block (NO_COLOR-safe). */
export function renderAccessReport(report: AccessReport): string {
  report = sanitizeAccessReport(report);
  const L: string[] = [];
  const none = "  (none)";

  // Header.
  L.push(`VoidRift access — active agent: ${report.activeAgent}   (switching: prompt, tools, workers, and what unlisted calls do)`);
  L.push("");

  // Agents.
  L.push("Agents (Shift+Tab cycles top-level by order; worker = a delegation target):");
  L.push("  top-level:");
  if (report.agents.topLevel.length === 0) L.push("    (none)");
  for (const a of report.agents.topLevel) {
    const workers = a.workers === "all" ? "all" : Array.isArray(a.workers) ? a.workers.join(", ") : "—";
    const parts = [
      `    ${a.name}`,
      `order ${a.order ?? 100}`,
      `unlisted: ${a.unlisted ?? "ask"}`,
      `workers: ${workers}`,
    ];
    if (a.confirm === true) parts.push("(confirm)");
    if (a.name === report.activeAgent) parts.push("← active");
    parts.push(agentSource(a));
    L.push(parts.join("  "));
  }
  L.push("  worker:");
  if (report.agents.worker.length === 0) L.push("    (none)");
  for (const a of report.agents.worker) {
    L.push(`    ${a.name}   ${agentSource(a)}`);
  }
  L.push("Switching the active top-level agent changes its system prompt, its tools, the workers it");
  L.push("may delegate to, and what happens to a call off the allow list — nothing else.");
  L.push("");

  // Allow list.
  L.push("Runs without asking (the allow list, exactly as configured):");
  if (report.allowList.tools.length === 0 && report.allowList.commands.length === 0) {
    L.push(none);
  } else {
    for (const line of wrapTokens(report.allowList.tools.map(allowToken), "  ")) L.push(line);
    if (report.allowList.commands.length > 0) {
      const cmdTokens = report.allowList.commands.map(allowToken);
      const wrapped = wrapTokens(cmdTokens, "    ");
      // The first command line carries the `execute_command:` label.
      wrapped[0] = "  execute_command: " + wrapped[0]!.trimStart();
      for (const line of wrapped) L.push(line);
    }
  }
  L.push("");

  // Calls not on the allow list.
  let callLine = `Calls not on the allow list, under this agent (${report.activeAgent}): ${report.unlistedBehaviour}`;
  if (report.mutatingRunsFreely && report.unlistedBehaviour === "run without asking") {
    callLine += " — a mutating tool runs without asking under this agent";
  } else if (report.mutatingRunsFreely) {
    callLine += " — note: a mutating tool runs without asking under this agent";
  }
  L.push(callLine);
  L.push("");

  // Web search.
  L.push(`Web search: ${report.webSearch.provider} ${report.webSearch.note}`);
  L.push("");

  // Models: only shown when a project/session layer redirected an endpoint (or
  // set its key env), so the user sees where their API key is sent (S3).
  if (report.models.length > 0) {
    L.push("Models (a project/session config set the endpoint or key env — your API key is sent there):");
    for (const m of report.models) {
      const host = m.host ?? "the configured endpoint";
      const keyPart = m.apiKeyEnv ? `  key: $${m.apiKeyEnv}` : "";
      L.push(`  ${m.name}   ${host}   (${m.layer})${keyPart}`);
    }
    L.push("");
  }

  // Never list.
  L.push("Always denied (the never list — never asked, under every agent):");
  if (report.neverList.length === 0) {
    L.push(none);
  } else {
    for (const n of report.neverList) {
      L.push(`  ${n.description}${n.unlocked ? "  (unlocked: still asks)" : ""}`);
    }
  }
  L.push("");

  // Always asks.
  L.push("Always asks, even with a wildcard allow entry:");
  for (const line of report.alwaysAsks) L.push(`  ${line}`);
  L.push("");

  // Workers.
  L.push("Workers this agent may delegate to (name · tools):");
  if (report.workers.length === 0) {
    L.push(none);
  } else {
    for (const w of report.workers) {
      L.push(`  ${w.name}   ${w.tools.join(", ")}${w.mutates ? "   (mutates → isolated)" : ""}`);
    }
  }
  L.push("");

  // Your rules.
  L.push("Your rules:");
  if (report.rules.length === 0) {
    L.push(none);
  } else {
    for (const r of report.rules) {
      const value = r.exact
        ? `${r.pattern ?? ""}   exact command`
        : r.cidr !== undefined
          ? `${r.cidr}   host/CIDR`
          : (r.pattern ?? r.tool);
      L.push(`  ${r.decision.padEnd(6)}  ${value}   ${layerTag(r.layer, r.file)}`);
    }
  }
  L.push("");

  // Unlocked never-list entries.
  L.push("Unlocked never-list entries:");
  if (report.unlock.length === 0) {
    L.push(none);
  } else {
    for (const u of report.unlock) {
      L.push(`  ${u.id}   ${layerTag(u.layer, u.file)}`);
    }
  }
  L.push("");

  // Plugins (cli §7.4 spirit): value-free inventory — id, layer + file, whether
  // options were provided, and the tool names it contributes when known.
  L.push("Plugins (id · options · tools it contributes):");
  if (report.plugins.length === 0) {
    L.push(none);
  } else {
    for (const p of report.plugins) {
      const opts = p.hasOptions ? "options: yes" : "options: no";
      const tools = !p.toolsKnown
        ? "tools: (enable to list)"
        : p.tools.length === 0
          ? "tools: (none)"
          : `tools: ${p.tools.join(", ")}`;
      const state = p.enabled ? "" : " (disabled)";
      L.push(`  ${p.id}${state}   ${opts}   ${tools}   ${layerTag(p.layer, p.file)}`);
    }
  }
  L.push("");

  // Rollback (§7.4): method + tracked-move count, or off, with the layer/file
  // of snapshotCount.
  if (report.rollback.method === "off") {
    L.push(`Rollback: off (snapshotCount 0) — set snapshotCount to enable /undo /redo /goto   ${layerTag(report.rollback.layer, report.rollback.file)}`);
  } else {
    const kind = report.rollback.method === "git" ? "git snapshots" : "cache snapshots";
    L.push(`Rollback: ${kind}, tracking the last ${report.rollback.snapshotCount} moves (/undo /redo /goto)   ${layerTag(report.rollback.layer, report.rollback.file)}`);
  }
  L.push("");

  // Notices.
  for (const r of report.notices.rejections) L.push(`notice: ${r.message}`);
  for (const w of report.notices.warnings) L.push(`notice: ${w.message}`);
  if (report.notices.rejections.length > 0 || report.notices.warnings.length > 0) L.push("");

  // Closing line.
  L.push("Deny wins. Every entry above shows the layer and file it came from.");

  return L.join("\n");
}

/** Run `voidrift access [--enable-write]` and return the process exit code
 * (§2.1, §7.4). `enableWrite` selects the first `unlisted: allow` agent; absent,
 * the first `unlisted: deny` agent. No suitable agent → exit 2 refusal. */
export async function runAccessCommand(
  opts: { enableWrite?: boolean },
  deps: AccessDeps,
): Promise<number> {
  const run = deps.run ?? accessReportConfigHome;
  // Build the report with NO agent pin first so the agent set and the global
  // config path are known; then select the agent by the headless rule and
  // rebuild for that agent (cheap, read-only).
  let report: AccessReport;
  try {
    report = await run({ workspaceRoot: deps.cwd });
  } catch (e) {
    deps.stderr.write(`Error: access failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.STARTUP;
  }
  const want: "deny" | "allow" = opts.enableWrite ? "allow" : "deny";
  const selected = report.agents.topLevel
    .filter((a) => (a.unlisted ?? "ask") === want)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name))[0];
  if (!selected) {
    // The SAME exit-2 refusal shape headless uses, naming the agents folder.
    // Derive the agents folder from any discovered agent's file, else the
    // display default (matching headless's fallback).
    const anyFile = report.agents.topLevel.find((a) => a.file)?.file
      ?? report.agents.worker.find((a) => a.file)?.file;
    const folder = anyFile ? anyFile.replace(/[/\\][^/\\]+[/\\]agent\.json$/, "") : "~/.config/voidrift/agents";
    const posture = want === "deny" ? "unlisted: deny (read-only)" : "unlisted: allow (write)";
    deps.stderr.write(
      `voidrift: no top-level agent with ${posture} exists — run \`voidrift init\` to restore the default agents, or add one under ${folder} (an agent.json with "kind": "top-level" and "unlisted": "${want}")\n`,
    );
    return EXIT.USAGE;
  }
  // Rebuild for the selected agent (its name becomes `activeAgent`).
  if (selected.name !== report.activeAgent) {
    try {
      report = await run({ agent: selected.name, workspaceRoot: deps.cwd });
    } catch (e) {
      deps.stderr.write(`Error: access failed: ${e instanceof Error ? e.message : String(e)}\n`);
      return EXIT.STARTUP;
    }
  }
  deps.stdout.write(renderAccessReport(report) + "\n");
  return EXIT.COMPLETED;
}
