import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { gitSafeguard, restoreSafeguardStash } from "../../src/safeguards/git.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const TMP = join(tmpdir(), "voidrift-safeguard-test");

describe("Git Safeguard", () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    execSync("git init", { cwd: TMP, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: TMP, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: TMP, stdio: "ignore" });
    writeFileSync(join(TMP, "file.txt"), "initial");
    execSync("git add . && git commit -m init", { cwd: TMP, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("returns wasDirty=false when repo is clean", () => {
    const result = gitSafeguard(TMP);
    expect(result.wasDirty).toBe(false);
    expect(result.stashCreated).toBe(false);
  });

  it("auto-stashes when repo is dirty", () => {
    writeFileSync(join(TMP, "file.txt"), "modified");
    const result = gitSafeguard(TMP);
    expect(result.wasDirty).toBe(true);
    expect(result.stashCreated).toBe(true);
  });

  it("restoreSafeguardStash pops the stash", () => {
    writeFileSync(join(TMP, "file.txt"), "modified");
    gitSafeguard(TMP);
    const restored = restoreSafeguardStash(TMP);
    expect(restored).toBe(true);
  });

  it("handles non-git directory gracefully", () => {
    const nonGit = join(tmpdir(), "voidrift-safeguard-nongit");
    mkdirSync(nonGit, { recursive: true });
    const result = gitSafeguard(nonGit);
    expect(result.wasDirty).toBe(false);
    rmSync(nonGit, { recursive: true, force: true });
  });
});
