/**
 * Deploy command: version management, changelog, git tag (REQ-DPL-1..5).
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { AgentLoop } from "../agent/loop.js";
import type { ModelInterface } from "../models.js";
import { loadPrompt } from "../prompts.js";
import { ensureVoidriftDir, bootRun, appendState, checkDiskSpace, checkRequirementsExist } from "../utils.js";
import { getMaxTokens } from "../config.js";
import { buildLocalTools } from "../tools/builder.js";
import { readArchField } from "./verify.js";

export async function runDeploy(worker: ModelInterface, architect?: ModelInterface): Promise<number> {
  checkDiskSpace();
  const d = ensureVoidriftDir();

  if (!checkRequirementsExist()) {
    process.stderr.write("Error: REQUIREMENTS.md not found. Run 'voidrift gather' first.\n");
    return 1;
  }
  if (!existsSync(join(d, "ARCHITECTURE.md"))) {
    process.stderr.write("Error: ARCHITECTURE.md not found. Run 'voidrift plan' first.\n");
    return 1;
  }

  const [log, runId] = bootRun("deploy");
  const projectDir = join(d, "..");

  // Determine last release tag
  let lastTag = "";
  try { lastTag = execSync("git describe --tags --abbrev=0", { cwd: projectDir, encoding: "utf-8", timeout: 5000 }).trim(); } catch { /* */ }
  const currentVersion = lastTag.replace(/^v/, "") || "0.0.0";

  // Read history since last tag
  const historyPath = join(d, "tasks", "history.log");
  let historyLines: string[] = [];
  if (existsSync(historyPath)) {
    historyLines = readFileSync(historyPath, "utf-8").trim().split("\n").filter(Boolean);
  }
  if (!historyLines.length) {
    process.stderr.write("Nothing to deploy — no task history since last release.\n");
    return 0;
  }

  // Version classification (REQ-DPL-1)
  const requirements = readFileSync(join(d, "REQUIREMENTS.md"), "utf-8");
  const versionPrompt = loadPrompt("deploy", "VERSION-CLASSIFY");
  const versionUser = loadPrompt("deploy", "VERSION-USER")
    .replace("{current_version}", currentVersion)
    .replace("{task_summary}", historyLines.join("\n"))
    .replace("{requirements}", requirements);

  const agent = new AgentLoop({
    model: worker, systemPrompt: versionPrompt, tools: [], toolHandlers: {},
    stream: false, maxTokens: getMaxTokens(worker.config, "deploy.version"), logPath: log, showSpinner: false,
  });
  const bumpResponse = (await agent.send(versionUser)).trim().toLowerCase();
  const bump = ["major", "minor", "patch"].includes(bumpResponse) ? bumpResponse : "patch";

  // Compute new version
  const [major, minor, patch] = currentVersion.split(".").map(Number);
  const newVersion = bump === "major" ? `${major + 1}.0.0`
    : bump === "minor" ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;

  // Operator confirmation (REQ-DPL-1)
  process.stderr.write(`Suggested: ${bump} bump → v${newVersion}\n`);
  if (process.stdin.isTTY) {
    const { createInterface } = require("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer: string = await new Promise(resolve => rl.question("Confirm? [Y/n] ", resolve));
    rl.close();
    if (answer.trim().toLowerCase() === "n") { process.stderr.write("Deploy cancelled.\n"); return 0; }
  }

  // Changelog (REQ-DPL-2)
  const changelogEntry = `## v${newVersion}\n\n${historyLines.map(l => `- ${l}`).join("\n")}\n`;
  const changelogPath = join(projectDir, "CHANGELOG.md");
  if (existsSync(changelogPath)) {
    const existing = readFileSync(changelogPath, "utf-8");
    writeFileSync(changelogPath, changelogEntry + "\n" + existing, "utf-8");
  } else {
    writeFileSync(changelogPath, `# Changelog\n\n${changelogEntry}`, "utf-8");
  }

  // Git tag (REQ-DPL-3)
  try {
    execSync(`git tag -a v${newVersion} -m "${changelogEntry.replace(/"/g, '\\"')}"`, { cwd: projectDir, timeout: 10000 });
  } catch (e) {
    process.stderr.write(`Warning: git tag failed: ${e}\n`);
  }

  // History rotation (REQ-TM-8)
  if (existsSync(historyPath)) {
    const rotatedPath = join(d, "tasks", `history-v${newVersion}.log`);
    try {
      const { renameSync } = require("node:fs");
      renameSync(historyPath, rotatedPath);
      writeFileSync(historyPath, "", "utf-8"); // Create new empty history.log
    } catch { /* */ }
  }

  // Optional IaC (REQ-DPL-4)
  const archText = readFileSync(join(d, "ARCHITECTURE.md"), "utf-8");
  if (archText.includes("infrastructure") || archText.includes("IaC")) {
    const [iacTools, iacHandlers] = buildLocalTools("deploy", projectDir);
    const iacPrompt = loadPrompt("deploy", "IAC")
      .replace("{iac_mode}", existsSync(join(projectDir, "infra")) ? "review" : "generate")
      .replace("{architecture}", archText);
    const iacAgent = new AgentLoop({
      model: worker, systemPrompt: iacPrompt, tools: iacTools, toolHandlers: iacHandlers,
      stream: false, maxTokens: getMaxTokens(worker.config, "deploy.iac"), logPath: log, showSpinner: false,
    });
    try { await iacAgent.send(loadPrompt("deploy", "IAC-USER")); } catch { /* */ }
  }

  // Post-deploy hook (REQ-DPL-5)
  const postDeploy = readArchField(d, "post_deploy");
  if (postDeploy) {
    try {
      execSync(postDeploy, { cwd: projectDir, timeout: 120_000, env: { ...process.env, VERSION: newVersion } });
    } catch { process.stderr.write("Warning: post_deploy hook failed.\n"); }
  }

  appendState("deploy", worker.config.alias, `v${newVersion} (${bump})`, [`CHANGELOG.md`]);
  process.stderr.write(`✓ Tagged v${newVersion} (${bump} bump)\n`);
  return 0;
}
