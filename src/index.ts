#!/usr/bin/env node
/**
 * VoidRift CLI — TypeScript implementation.
 */

import { Command } from "commander";
import { resolveModel, listAliases } from "./models.js";
import { TokenBudget } from "./agent/budget.js";
import { initSystemLog, syslog } from "./utils.js";

const program = new Command();

// Initialize system log (REQ-LOG-4)
initSystemLog();
syslog(`CLI invocation: ${process.argv.slice(2).join(" ")}`);

program
  .name("voidrift")
  .description("Agentic Software Engineering Framework")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// Framework commands
// ---------------------------------------------------------------------------

program
  .command("gather <model>")
  .description("Reverse-engineer requirements from a codebase or idea")
  .option("--path <path>", "Path to codebase directory")
  .option("--idea <id>", "Idea ID to generate requirements from", parseInt)
  .option("--overwrite", "Remove previous gather artifacts")
  .option("--max-input-tokens <n>", "Max input tokens", parseInt)
  .option("--max-output-tokens <n>", "Max output tokens", parseInt)
  .action(async (model, opts) => {
    if (!opts.path && opts.idea == null) {
      console.error("Error: specify --path <dir> or --idea <id>");
      process.exit(1);
    }
    const mc = resolveModel(model);
    const budget = makeBudget(opts.maxInputTokens, opts.maxOutputTokens, mc.config);
    const { runGather } = await import("./commands/gather.js");
    process.exit(await runGather(mc, opts.path, opts.idea, opts.overwrite, budget));
  });

program
  .command("plan <model>")
  .description("Generate architecture and task breakdown")
  .option("--overwrite", "Remove previous plan artifacts")
  .option("--idea <id>", "Scope to a specific idea", parseInt)
  .action(async (model, opts) => {
    const mc = resolveModel(model);
    const { runPlan } = await import("./commands/plan.js");
    process.exit(await runPlan(mc, opts.overwrite, opts.idea));
  });

program
  .command("develop <model> [architect]")
  .description("Execute tasks from the manifest")
  .option("--max-input-tokens <n>", "Max input tokens", parseInt)
  .option("--max-output-tokens <n>", "Max output tokens", parseInt)
  .action(async (model, architect, opts) => {
    const mc = resolveModel(model);
    const arch = architect ? resolveModel(architect) : undefined;
    const budget = makeBudget(opts.maxInputTokens, opts.maxOutputTokens, mc.config);
    const { runDevelop } = await import("./commands/develop.js");
    process.exit(await runDevelop(mc, arch, budget));
  });

program
  .command("deploy <model> [architect]")
  .description("Prepare a release (version, changelog, tag)")
  .action(async (model, architect) => {
    const mc = resolveModel(model);
    const arch = architect ? resolveModel(architect) : undefined;
    const { runDeploy } = await import("./commands/deploy.js");
    process.exit(await runDeploy(mc, arch));
  });

program
  .command("verify <model>")
  .description("Run acceptance tests against requirements")
  .action(async (model) => {
    const mc = resolveModel(model);
    const { runVerify } = await import("./commands/verify.js");
    process.exit(await runVerify(mc));
  });

program
  .command("chat <model>")
  .description("Interactive chat session")
  .option("--doc <path>", "Scope to a .voidrift/ artifact")
  .option("--style <style>", "Output style (verbose/terse/raw)", "verbose")
  .option("--bare", "No skills, git, or project state")
  .option("--system-prompt <path>", "Custom system prompt file")
  .action(async (model, opts) => {
    if (opts.systemPrompt && !opts.bare) {
      console.error("Error: --system-prompt requires --bare");
      process.exit(1);
    }
    const mc = resolveModel(model);
    const { runChat } = await import("./commands/chat.js");
    await runChat(mc, opts);
  });

// ---------------------------------------------------------------------------
// Utility commands
// ---------------------------------------------------------------------------

program
  .command("status")
  .description("Show task status")
  .action(async () => {
    const { runStatus } = await import("./commands/status.js");
    runStatus();
  });

program
  .command("doctor")
  .description("Run diagnostic checks")
  .option("--fix", "Auto-fix where safe")
  .action(async (opts) => {
    const { runChecks, formatResults } = await import("./commands/doctor.js");
    const results = runChecks(opts.fix);
    console.log("\n  VoidRift Doctor\n");
    console.log(formatResults(results));
    const hasFail = results.some(r => r.status === "fail");
    console.log("");
    process.exit(hasFail ? 1 : 0);
  });

program
  .command("log [command]")
  .description("Show command logs")
  .option("-f, --follow", "Follow live output")
  .option("--prune", "Delete log files")
  .action(async (command, opts) => {
    const { existsSync, readdirSync, readFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { voidriftDir } = await import("./utils.js");
    const logDir = join(voidriftDir(), "logs");
    if (!existsSync(logDir)) { console.log("No logs found."); return; }

    if (opts.prune) {
      const files = readdirSync(logDir).filter(f => !command || f.startsWith(command));
      for (const f of files) unlinkSync(join(logDir, f));
      console.log(`Deleted ${files.length} log file(s).`);
      return;
    }

    const files = readdirSync(logDir).filter(f => f.endsWith(".log") && (!command || f.startsWith(command))).sort();
    if (!files.length) { console.log("No matching logs."); return; }
    const latest = join(logDir, files[files.length - 1]);
    if (opts.follow) {
      // Follow mode — tail the file (REQ-U-3)
      const { createReadStream } = await import("node:fs");
      const { createInterface } = await import("node:readline");
      const stream = createReadStream(latest, { encoding: "utf-8", start: 0 });
      const rl = createInterface({ input: stream });
      rl.on("line", (line: string) => console.log(line));
      // Keep watching for new content
      const { watchFile } = await import("node:fs");
      let pos = (await import("node:fs")).statSync(latest).size;
      watchFile(latest, { interval: 500 }, () => {
        const { readFileSync: rf, statSync: ss } = require("node:fs");
        const newSize = ss(latest).size;
        if (newSize > pos) {
          const buf = Buffer.alloc(newSize - pos);
          const fd = require("node:fs").openSync(latest, "r");
          require("node:fs").readSync(fd, buf, 0, buf.length, pos);
          require("node:fs").closeSync(fd);
          process.stdout.write(buf.toString("utf-8"));
          pos = newSize;
        }
      });
      // Block until Ctrl+C
      await new Promise(() => {});
      return;
    }
    const content = readFileSync(latest, "utf-8");
    const lines = content.split("\n");
    console.log(lines.slice(-200).join("\n"));
  });

program
  .command("prune")
  .description("Clean up project/global logs and cache")
  .option("--global", "Prune global framework logs")
  .option("--all", "Remove everything")
  .action(async (opts) => {
    const { existsSync, rmSync, readdirSync, unlinkSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { voidriftDir } = await import("./utils.js");
    const { voidriftHome, getRetention } = await import("./config.js");

    if (opts.global) {
      const globalLogDir = join(voidriftHome(), "logs");
      if (opts.all) {
        if (existsSync(globalLogDir)) rmSync(globalLogDir, { recursive: true });
        console.log("Removed all global logs.");
      } else {
        console.log("Global log pruning by retention not yet implemented.");
      }
      return;
    }

    const d = voidriftDir();
    if (!existsSync(d)) { console.log("No .voidrift directory found."); return; }
    if (opts.all) {
      rmSync(d, { recursive: true });
      console.log("Removed .voidrift/ directory.");
      return;
    }

    // Prune old logs
    const logDir = join(d, "logs");
    if (existsSync(logDir)) {
      const keep = getRetention("project");
      const files = readdirSync(logDir).filter(f => f.endsWith(".log")).sort();
      const toDelete = files.slice(0, Math.max(0, files.length - keep));
      for (const f of toDelete) unlinkSync(join(logDir, f));
      if (toDelete.length) console.log(`Pruned ${toDelete.length} old log(s).`);
    }

    // Prune analysis cache (REQ-U-14)
    const analysisDir = join(d, "analysis");
    if (existsSync(analysisDir)) {
      const { loadConfig } = await import("./config.js");
      const cfg = loadConfig() as Record<string, Record<string, unknown>>;
      const cache = cfg?.cache ?? {};
      const ttlDays = (cache.ttl_days as number) ?? 30;
      const maxEntries = (cache.max_entries as number) ?? 500;
      const ttlMs = (ttlDays as number) * 86400_000;
      const now = Date.now();
      let staleCount = 0, expiredCount = 0, lruCount = 0, freedBytes = 0;

      // Collect all analysis entries
      const entries: Array<{ path: string; mtime: number; size: number; sourceFile: string | null }> = [];
      const walkAnalysis = (dir: string) => {
        for (const f of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, f.name);
          if (f.isDirectory()) { walkAnalysis(full); continue; }
          if (!f.name.endsWith(".md")) continue;
          const st = statSync(full);
          // Parse frontmatter for source file reference
          let sourceFile: string | null = null;
          try {
            const content = require("node:fs").readFileSync(full, "utf-8").slice(0, 500);
            const m = content.match(/^file:\s*(.+)$/m);
            if (m) sourceFile = m[1].trim();
          } catch { /* */ }
          entries.push({ path: full, mtime: st.mtimeMs, size: st.size, sourceFile });
        }
      };
      walkAnalysis(analysisDir);

      // Stage 1: Remove stale (source file no longer exists)
      const remaining = entries.filter(e => {
        if (e.sourceFile && !existsSync(join(d, "..", e.sourceFile))) {
          unlinkSync(e.path); staleCount++; freedBytes += e.size; return false;
        }
        return true;
      });

      // Stage 2: Remove expired (older than ttl_days)
      const afterTtl = remaining.filter(e => {
        if (now - e.mtime > ttlMs) {
          unlinkSync(e.path); expiredCount++; freedBytes += e.size; return false;
        }
        return true;
      });

      // Stage 3: LRU eviction if over max_entries
      if (afterTtl.length > (maxEntries as number)) {
        afterTtl.sort((a, b) => a.mtime - b.mtime);
        const toEvict = afterTtl.slice(0, afterTtl.length - (maxEntries as number));
        for (const e of toEvict) { unlinkSync(e.path); lruCount++; freedBytes += e.size; }
      }

      if (staleCount + expiredCount + lruCount > 0) {
        const freedKb = (freedBytes / 1024).toFixed(1);
        console.log(`Analysis cache: ${staleCount} stale, ${expiredCount} expired, ${lruCount} LRU evicted (${freedKb} KB freed).`);
      }
    }

    // Remove stale lock
    const lock = join(d, ".develop.lock");
    if (existsSync(lock)) { unlinkSync(lock); console.log("Removed stale lock."); }
  });

program
  .command("unlock")
  .description("Remove develop lock and kill process")
  .action(async () => {
    const { existsSync, readFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { voidriftDir } = await import("./utils.js");
    const lock = join(voidriftDir(), ".develop.lock");
    if (!existsSync(lock)) { console.log("No lock file found."); return; }
    const pid = parseInt(readFileSync(lock, "utf-8").split("\n")[0], 10);
    try { process.kill(pid, "SIGTERM"); console.log(`Sent SIGTERM to PID ${pid}.`); } catch { /* */ }
    unlinkSync(lock);
    console.log("Lock removed.");
  });

program
  .command("rollback [turn]")
  .description("Restore working tree to a checkpoint")
  .action(async (turn) => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { voidriftDir } = await import("./utils.js");
    const { GitCheckpointManager } = await import("./git.js");
    const cpPath = join(voidriftDir(), "checkpoints.jsonl");
    const mgr = new GitCheckpointManager(process.cwd());
    mgr.load(cpPath);
    if (!mgr.checkpoints.length) { console.log("No checkpoints available."); return; }
    if (turn == null) {
      for (const cp of mgr.checkpoints) console.log(`  Turn ${cp.turn}: TASK-${cp.taskId} (${cp.timestamp})`);
      return;
    }
    if (mgr.restore(parseInt(turn, 10))) console.log(`Restored to turn ${turn}.`);
    else console.log(`Checkpoint for turn ${turn} not found.`);
  });

program
program
  .command("skills <action> [query]")
  .description("Manage skills (list, search)")
  .action(async (action, query) => {
    const { listSkills } = await import("./skills.js");
    if (action === "list") {
      const skills = listSkills();
      if (!skills.length) { console.log("No skills found."); return; }
      let currentLayer = "";
      for (const s of skills) {
        if (s.layer !== currentLayer) { currentLayer = s.layer; console.log(`\n  ${currentLayer.toUpperCase()}`); }
        console.log(`    ${s.name}: ${s.description}`);
      }
      console.log("");
    } else if (action === "search" && query) {
      const skills = listSkills();
      const q = query.toLowerCase();
      const matches = skills.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
      if (!matches.length) { console.log(`No skills matching "${query}".`); return; }
      for (const s of matches) console.log(`  [${s.layer}] ${s.name}: ${s.description}`);
    } else {
      console.error("Usage: voidrift skills list | voidrift skills search <query>");
    }
  });

program
  .command("completions <shell>")
  .description("Output shell completion script")
  .action(async (shell) => {
    const aliases = listAliases().join(" ");
    const commands = "gather plan develop deploy verify chat status doctor log prune unlock rollback memory skills completions";
    if (shell === "bash") {
      console.log(`# voidrift bash completions
_voidrift() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  local prev=\${COMP_WORDS[COMP_CWORD-1]}
  if [ $COMP_CWORD -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${commands}" -- "$cur") )
  elif [ $COMP_CWORD -eq 2 ]; then
    case "$prev" in
      gather|plan|develop|deploy|verify|chat) COMPREPLY=( $(compgen -W "${aliases}" -- "$cur") ) ;;
    esac
  fi
}
complete -F _voidrift voidrift`);
    } else if (shell === "zsh") {
      console.log(`#compdef voidrift
_voidrift() {
  _arguments '1:command:(${commands})' '2:model:(${aliases})'
}
_voidrift "$@"`);
    } else if (shell === "fish") {
      console.log(`# voidrift fish completions
complete -c voidrift -n '__fish_use_subcommand' -a '${commands}'
for model in ${aliases}; complete -c voidrift -n '__fish_seen_subcommand_from gather plan develop deploy verify chat' -a $model; end`);
    } else {
      console.error("Supported shells: bash, zsh, fish");
      process.exit(1);
    }
  });

program
  .command("memory <action> [name]")
  .description("Manage memory entries")
  .option("--global", "Use global memory")
  .action(async (action, name, opts) => {
    const { MemoryManager } = await import("./memory.js");
    const mm = new MemoryManager(process.cwd());
    if (action === "list") {
      const entries = mm.list();
      if (!entries.length) { console.log("No memory entries."); return; }
      for (const e of entries) console.log(`  [${e.layer}] ${e.name}: ${e.description}`);
    } else if (action === "show" && name) {
      const content = mm.read(name);
      console.log(content ?? `Entry '${name}' not found.`);
    } else if (action === "delete" && name) {
      mm.delete(name, opts.global ? "global" : "project");
      console.log(`Deleted ${name}.`);
    } else if (action === "export") {
      const entries = mm.list();
      for (const e of entries) {
        const content = mm.read(e.name);
        if (content) console.log(`## ${e.name}\n\n${content}\n`);
      }
    } else {
      console.error("Usage: voidrift memory list|show|delete|export [name]");
    }
  });

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

function makeBudget(maxInput?: number, maxOutput?: number, mc?: { maxInputTokens?: number; maxOutputTokens?: number }): TokenBudget | undefined {
  const inp = maxInput ?? mc?.maxInputTokens;
  const out = maxOutput ?? mc?.maxOutputTokens;
  if (inp || out) return new TokenBudget(inp, out);
  return undefined;
}

// Catch unhandled errors — no stack traces to user
process.on("uncaughtException", (e) => {
  syslog(`FATAL: ${e.message}`);
  console.error(`Error: ${e.message}`);
  process.exit(1);
});

program.parse();
