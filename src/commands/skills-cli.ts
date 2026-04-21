/**
 * Skills CLI: list, search, install, approve, remove, review (REQ-UTIL-7).
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { listSkills } from "../skills.js";
import { loadConfig, voidriftHome } from "../config.js";

function pendingDir(): string {
  return join(process.cwd(), ".voidrift", "skills", "pending");
}

function projectSkillsDir(): string {
  return join(process.cwd(), ".voidrift", "skills");
}

function domainSkillsDir(): string {
  return join(voidriftHome(), "domain-skills");
}

function cmdList(): void {
  const skills = listSkills();
  if (!skills.length) { console.log("No skills found."); return; }
  const grouped: Record<string, typeof skills> = {};
  for (const s of skills) {
    (grouped[s.layer] ??= []).push(s);
  }
  // Check pending
  const pd = pendingDir();
  const pending = new Set<string>();
  if (existsSync(pd)) {
    for (const f of readdirSync(pd)) pending.add(f.replace(/\.md$/, "").toUpperCase());
  }
  for (const [layer, items] of Object.entries(grouped)) {
    console.log(`\n  ${layer}`);
    console.log("  " + "─".repeat(40));
    for (const s of items) {
      const status = pending.has(s.name) ? " (pending)" : "";
      console.log(`    ${s.name.padEnd(20)} ${s.description}${status}`);
    }
  }
  // Show pending not in main list
  if (pending.size) {
    const listed = new Set(skills.map(s => s.name));
    const onlyPending = [...pending].filter(n => !listed.has(n));
    if (onlyPending.length) {
      console.log(`\n  pending`);
      console.log("  " + "─".repeat(40));
      for (const n of onlyPending) console.log(`    ${n.padEnd(20)} (awaiting approval)`);
    }
  }
  console.log();
}

function cmdSearch(query: string): void {
  let repos: string[] = [];
  try { repos = loadConfig().skills?.repos ?? []; } catch { /* */ }
  if (!repos.length) { console.log("No skill repos configured. Set skills.repos in config.yml."); return; }
  console.log(`Searching ${repos.length} repo(s) for "${query}"...`);
  for (const url of repos) {
    try {
      const res = require("node:child_process").execSync(`curl -sf "${url}"`, { timeout: 10_000, encoding: "utf-8" });
      const lines = res.split("\n").filter((l: string) => l.toLowerCase().includes(query.toLowerCase()));
      if (lines.length) {
        console.log(`\n  ${url}`);
        for (const l of lines) console.log(`    ${l.trim()}`);
      }
    } catch { console.log(`  ⚠ Failed to fetch ${url}`); }
  }
}

function cmdInstall(name: string): void {
  const upper = name.toUpperCase();
  const pd = pendingDir();
  mkdirSync(pd, { recursive: true });
  const path = join(pd, `${upper}.md`);
  if (existsSync(path)) { console.log(`Skill '${upper}' already pending.`); return; }
  writeFileSync(path, `---\nname: ${upper}\ndescription: Pending approval\n---\n\n# ${upper}\n\nInstalled via CLI. Edit content then run 'voidrift skills approve ${name}'.\n`, "utf-8");
  console.log(`Skill '${upper}' installed as pending. Edit then approve.`);
}

function cmdApprove(name: string): void {
  const upper = name.toUpperCase();
  const src = join(pendingDir(), `${upper}.md`);
  if (!existsSync(src)) { console.log(`No pending skill '${upper}' found.`); return; }
  const dest = projectSkillsDir();
  mkdirSync(dest, { recursive: true });
  renameSync(src, join(dest, `${upper}.md`));
  console.log(`Skill '${upper}' approved and active.`);
}

function cmdRemove(name: string): void {
  const upper = name.toUpperCase();
  for (const dir of [projectSkillsDir(), domainSkillsDir()]) {
    const path = join(dir, `${upper}.md`);
    if (existsSync(path)) { unlinkSync(path); console.log(`Removed '${upper}' from ${dir}.`); return; }
  }
  // Check pending
  const path = join(pendingDir(), `${upper}.md`);
  if (existsSync(path)) { unlinkSync(path); console.log(`Removed pending '${upper}'.`); return; }
  console.log(`Skill '${upper}' not found.`);
}

function cmdReview(): void {
  const pd = pendingDir();
  if (!existsSync(pd)) { console.log("No pending skills."); return; }
  const files = readdirSync(pd).filter(f => f.endsWith(".md"));
  if (!files.length) { console.log("No pending skills."); return; }
  console.log("\n  Pending skills:");
  for (const f of files) {
    const content = readFileSync(join(pd, f), "utf-8");
    const desc = content.match(/description:\s*(.+)/)?.[1] ?? "";
    console.log(`    ${f.replace(/\.md$/, "").padEnd(20)} ${desc}`);
  }
  console.log();
}

export function runSkills(subcommand?: string, arg?: string): number {
  if (!subcommand || subcommand === "list") { cmdList(); return 0; }
  if (subcommand === "search") {
    if (!arg) { console.error("Usage: voidrift skills search <query>"); return 1; }
    cmdSearch(arg); return 0;
  }
  if (subcommand === "install") {
    if (!arg) { console.error("Usage: voidrift skills install <name>"); return 1; }
    cmdInstall(arg); return 0;
  }
  if (subcommand === "approve") {
    if (!arg) { console.error("Usage: voidrift skills approve <name>"); return 1; }
    cmdApprove(arg); return 0;
  }
  if (subcommand === "remove") {
    if (!arg) { console.error("Usage: voidrift skills remove <name>"); return 1; }
    cmdRemove(arg); return 0;
  }
  if (subcommand === "review") { cmdReview(); return 0; }
  console.error(`Unknown subcommand: ${subcommand}. Available: list, search, install, approve, remove, review`);
  return 1;
}
