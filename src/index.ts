#!/usr/bin/env node
/**
 * VoidRift CLI — chat-first entry point (REQ-ENTRY-1..4).
 *
 * voidrift              → chat TUI
 * voidrift <command>    → headless execution
 */

// Ensure chalk (used by marked-terminal) emits ANSI inside Ink's render cycle.
// Must be set before the dynamic import of chat.ts loads marked-terminal → chalk.
process.env.FORCE_COLOR = process.env.FORCE_COLOR ?? "1";

import { existsSync, readFileSync } from "node:fs";
import { initSystemLog, syslog } from "./utils.js";
import { TokenBudget } from "./agent/budget.js";

// Initialize system log (REQ-LOG-4)
initSystemLog();
const _startTime = Date.now();

// ---------------------------------------------------------------------------
// Model resolution (REQ-ENTRY-2)
// ---------------------------------------------------------------------------

function resolveDefaultModel(): import("./models.js").ModelInterface | null {
  try {
    const { loadConfig } = require("./config.js");
    const { resolveModel, listAliases } = require("./models.js");
    const cfg = loadConfig();

    // 1. current_model from config
    const currentModel = (cfg as Record<string, unknown>).current_model as string | undefined;
    if (currentModel) {
      try { return resolveModel(currentModel); } catch { /* unavailable */ }
    }

    // 2. first alias
    const aliases = listAliases();
    if (aliases.length) {
      try { return resolveModel(aliases[0]); } catch { /* */ }
    }
  } catch { /* config/models not available */ }
  return null;
}

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("-") ? args[0] : null;

// Log invocation with metadata (REQ-LOG-2)
{
  const mi = args.indexOf("--model");
  const m = mi >= 0 && mi + 1 < args.length ? args[mi + 1] : "-";
  syslog(`[${command ?? "chat"}] cwd=${process.cwd()} model=${m} args=${args.join(" ")}`);
}

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
function hasFlag(name: string): boolean { return args.includes(`--${name}`); }

function makeBudget(mc?: { maxInputTokens?: number; maxOutputTokens?: number }): TokenBudget | undefined {
  const inp = getFlag("max-input-tokens") ? parseInt(getFlag("max-input-tokens")!, 10) : mc?.maxInputTokens;
  const out = getFlag("max-output-tokens") ? parseInt(getFlag("max-output-tokens")!, 10) : mc?.maxOutputTokens;
  if (inp || out) return new TokenBudget(inp, out);
  return undefined;
}

// ---------------------------------------------------------------------------
// Headless commands (REQ-ENTRY-3)
// ---------------------------------------------------------------------------

async function runHeadless(): Promise<number> {
  const { resolveModel } = await import("./models.js");
  const { getModelsFile } = await import("./config.js");
  const modelAlias = getFlag("model");

  // Commands that don't need a model
  if (command === "status") {
    const { runStatus } = await import("./commands/status.js");
    runStatus();
    return 0;
  }

  if (command === "unlock") {
    const { runUnlock } = await import("./commands/unlock.js");
    return runUnlock();
  }

  if (command === "prune") {
    const { runPrune } = await import("./commands/prune.js");
    return runPrune({ all: hasFlag("all"), global: hasFlag("global") });
  }

  if (command === "skills") {
    const { runSkills } = await import("./commands/skills-cli.js");
    return runSkills(args[1], args[2]);
  }

  if (command === "rollback") {
    const { runRollback } = await import("./commands/rollback.js");
    const turn = args[1] ? parseInt(args[1], 10) : undefined;
    return runRollback(turn);
  }

  if (command === "log") {
    const { runLog } = await import("./commands/log.js");
    return runLog({
      command: args[1] && !args[1].startsWith("-") ? args[1] : undefined,
      follow: hasFlag("follow") || args.includes("-f"),
      prune: hasFlag("prune"),
      global: hasFlag("global"),
    });
  }

  if (command === "doctor") {
    const { runChecks, formatResults } = await import("./commands/doctor.js");
    const results = runChecks(hasFlag("fix"));
    console.log("\n  VoidRift Doctor\n");
    console.log(formatResults(results));
    return results.some(r => r.status === "fail") ? 1 : 0;
  }

  if (command === "help") {
    console.log(`
  VoidRift — Agentic Software Engineering Framework

  Usage:
    voidrift                                    Open chat (default)
    voidrift <command> --model <alias> [flags]  Run command headless

  Commands:
    gather   --model <m> --import <dir>  Reverse-engineer requirements
             --model <m> --idea <id>    Requirements from idea
             --model <m> --ref <dir>    Load codebase as chat context
    plan     --model <m>                Generate architecture + tasks
    develop  --model <m>                Execute tasks from manifest
    deploy   --model <m>                Prepare release (version, tag)
    verify   --model <m>                Run acceptance tests
    status                              Show task status
    log [command] [-f] [--prune] [--global]  View/manage logs
    unlock                              Remove develop lock
    prune [--all] [--global]            Remove ephemeral data
    skills [list|search|install|approve|remove|review]  Manage skills
    rollback [turn]                     List/restore checkpoints
    doctor   [--fix]                    Run diagnostic checks
    models                              List available models
    help                                This message
    completions <shell>                 Output shell completion script

  Chat slash commands: /help, /model, /settings, /chat, /gather, /plan,
    /develop, /deploy, /verify, /ask, /idea, /done, /bare, /exec,
    /compact, /clear
`);
    return 0;
  }

  if (command === "models") {
    const { listAliases } = await import("./models.js");
    const aliases = listAliases();
    if (!aliases.length) { console.log("No models configured."); return 0; }
    console.log("\n  Available models:\n");
    for (const a of aliases) console.log(`    ${a}`);
    console.log("");
    return 0;
  }

  if (command === "completions") {
    const { listAliases } = await import("./models.js");
    const shell = args[1];
    const aliases = listAliases().join(" ");
    const commands = "gather plan develop deploy verify status doctor models help";
    if (shell === "bash") {
      console.log(`_voidrift() { local cur=\${COMP_WORDS[COMP_CWORD]}; local prev=\${COMP_WORDS[COMP_CWORD-1]}; if [ $COMP_CWORD -eq 1 ]; then COMPREPLY=( $(compgen -W "${commands}" -- "$cur") ); elif [ $COMP_CWORD -eq 3 ] && [ "$prev" = "--model" ]; then COMPREPLY=( $(compgen -W "${aliases}" -- "$cur") ); fi; }; complete -F _voidrift voidrift`);
    } else if (shell === "zsh") {
      console.log(`#compdef voidrift\n_voidrift() { _arguments '1:command:(${commands})' '--model[Model alias]:model:(${aliases})' }\n_voidrift "$@"`);
    } else if (shell === "fish") {
      console.log(`complete -c voidrift -n '__fish_use_subcommand' -a '${commands}'\nfor m in ${aliases}; complete -c voidrift -l model -a $m; end`);
    } else {
      console.error("Usage: voidrift completions bash|zsh|fish");
      return 1;
    }
    return 0;
  }

  // Commands that need a model
  if (!modelAlias) {
    console.error(`Error: --model <alias> required for '${command}'. Run 'voidrift help' for usage.`);
    return 1;
  }

  // Check models file exists
  const modelsPath = getModelsFile();
  if (!existsSync(modelsPath)) {
    console.error(`Error: Models file not found at ${modelsPath}\nConfigure models_file in ~/.voidrift/config.yml`);
    return 1;
  }

  const mc = resolveModel(modelAlias);
  const budget = makeBudget(mc.config);

  if (command === "gather") {
    const path = getFlag("import");
    const ideaId = getFlag("idea") ? parseInt(getFlag("idea")!, 10) : undefined;
    const ref = getFlag("ref");
    if (!path && !ideaId && !ref) { console.error("Error: --import, --idea, or --ref required for gather"); return 1; }
    if (ref) {
      // --ref: open chat with external codebase as context (REQ-G-1)
      const { runChat } = await import("./commands/chat.js");
      return runChat(mc, { ref }) as Promise<number>;
    }
    const { runGather } = await import("./commands/gather.js");
    return runGather(mc, path, ideaId, hasFlag("overwrite"), budget);
  }

  if (command === "plan") {
    const { runPlan } = await import("./commands/plan.js");
    return runPlan(mc, hasFlag("overwrite"));
  }

  if (command === "develop") {
    const arch = getFlag("architect") ? resolveModel(getFlag("architect")!) : undefined;
    const { runDevelop } = await import("./commands/develop.js");
    return runDevelop(mc, arch, budget);
  }

  if (command === "deploy") {
    const arch = getFlag("architect") ? resolveModel(getFlag("architect")!) : undefined;
    const { runDeploy } = await import("./commands/deploy.js");
    return runDeploy(mc, arch);
  }

  if (command === "verify") {
    const { runVerify } = await import("./commands/verify.js");
    return runVerify(mc);
  }

  console.error(`Unknown command: ${command}. Run 'voidrift help' for usage.`);
  return 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (command) {
    // Headless command
    const code = await runHeadless();
    syslog(`[${command}] exit=${code} elapsed=${((Date.now() - _startTime) / 1000).toFixed(1)}s`);
    process.exit(code);
  }

  // Chat TUI (REQ-ENTRY-1)
  const model = resolveDefaultModel();
  const { runChat } = await import("./commands/chat.js");
  await runChat(model, {
    doc: getFlag("doc"),
    bare: hasFlag("bare"),
    systemPrompt: getFlag("system-prompt"),
  });
  syslog(`[chat] exit=0 elapsed=${((Date.now() - _startTime) / 1000).toFixed(1)}s`);
}

// Error handling — no stack traces
process.on("uncaughtException", (e) => {
  syslog(`[${command ?? "chat"}] FATAL: ${e.message} elapsed=${((Date.now() - _startTime) / 1000).toFixed(1)}s`);
  console.error(`Error: ${e.message}`);
  process.exit(1);
});

main();
