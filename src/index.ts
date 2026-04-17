#!/usr/bin/env node
/**
 * VoidRift CLI — chat-first entry point (REQ-ENTRY-1..4).
 *
 * voidrift              → chat TUI
 * voidrift <command>    → headless execution
 */

import { existsSync, readFileSync } from "node:fs";
import { initSystemLog, syslog } from "./utils.js";
import { TokenBudget } from "./agent/budget.js";

// Initialize system log (REQ-LOG-4)
initSystemLog();
syslog(`CLI invocation: ${process.argv.slice(2).join(" ")}`);

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

    // 2. active_container_file
    const containerFile = cfg.activeContainerFile ?? (cfg as Record<string, unknown>)["active_container_file"];
    if (containerFile && existsSync(String(containerFile))) {
      try {
        const alias = readFileSync(String(containerFile), "utf-8").trim();
        if (alias) return resolveModel(alias);
      } catch { /* */ }
    }

    // 3. first alias
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
    gather   --model <m> --path <dir>   Reverse-engineer requirements
    plan     --model <m>                Generate architecture + tasks
    develop  --model <m>                Execute tasks from manifest
    deploy   --model <m>                Prepare release (version, tag)
    verify   --model <m>                Run acceptance tests
    status                              Show task status
    doctor   [--fix]                    Run diagnostic checks
    help                                This message
    completions <shell>                 Output shell completion script

  Chat slash commands: /help, /model, /settings, /gather, /plan,
    /develop, /deploy, /verify, /ask, /idea, /compact, /clear
`);
    return 0;
  }

  if (command === "completions") {
    const { listAliases } = await import("./models.js");
    const shell = args[1];
    const aliases = listAliases().join(" ");
    const commands = "gather plan develop deploy verify status doctor help completions";
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
    const path = getFlag("path");
    if (!path) { console.error("Error: --path required for gather"); return 1; }
    const { runGather } = await import("./commands/gather.js");
    return runGather(mc, path, undefined, hasFlag("overwrite"), budget);
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
    process.exit(code);
  }

  // Chat TUI (REQ-ENTRY-1)
  const model = resolveDefaultModel();
  const { runChat } = await import("./commands/chat.js");
  await runChat(model, {
    doc: getFlag("doc"),
    style: getFlag("style") as "verbose" | "terse" | "raw" | undefined,
    bare: hasFlag("bare"),
    systemPrompt: getFlag("system-prompt"),
  });
}

// Error handling — no stack traces
process.on("uncaughtException", (e) => {
  syslog(`FATAL: ${e.message}`);
  console.error(`Error: ${e.message}`);
  process.exit(1);
});

main();
