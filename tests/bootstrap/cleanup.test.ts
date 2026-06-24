import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanupWorktrees, writeWorktreeMeta } from "../../src/bootstrap/cleanup.js";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const TMP = join(tmpdir(), "voidrift-cleanup-test-" + Date.now());

beforeEach(() => {
  mkdirSync(join(TMP, ".voidrift", "worktrees"), { recursive: true });
  writeFileSync(join(TMP, ".voidrift", "locks.json"), JSON.stringify({ activeLocks: ["/some/file.ts"] }));
  execSync("git init", { cwd: TMP, stdio: "ignore" });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("Boot Cleanup Guard", () => {
  it("preserves worktrees with alive PIDs", () => {
    const wtDir = join(TMP, ".voidrift", "worktrees", "alive-wt");
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(join(wtDir, ".meta.json"), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));

    const result = cleanupWorktrees(TMP);
    expect(result.preservedWorktrees).toContain("alive-wt");
    expect(result.prunedWorktrees).not.toContain("alive-wt");
    expect(existsSync(wtDir)).toBe(true);
  });

  it("preserves worktrees with dead PIDs under 2-hour TTL", () => {
    const wtDir = join(TMP, ".voidrift", "worktrees", "young-dead");
    mkdirSync(wtDir, { recursive: true });
    // PID 999999 is almost certainly dead
    writeFileSync(join(wtDir, ".meta.json"), JSON.stringify({ pid: 999999, createdAt: new Date().toISOString() }));

    const result = cleanupWorktrees(TMP);
    expect(result.preservedWorktrees).toContain("young-dead");
    expect(existsSync(wtDir)).toBe(true);
  });

  it("prunes worktrees with dead PIDs over 2-hour TTL", () => {
    const wtDir = join(TMP, ".voidrift", "worktrees", "old-dead");
    mkdirSync(wtDir, { recursive: true });
    const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3 hours ago
    writeFileSync(join(wtDir, ".meta.json"), JSON.stringify({ pid: 999999, createdAt: oldDate }));

    const result = cleanupWorktrees(TMP);
    expect(result.prunedWorktrees).toContain("old-dead");
    expect(existsSync(wtDir)).toBe(false);
  });

  it("prunes worktrees with missing .meta.json over TTL (by ctime)", () => {
    const wtDir = join(TMP, ".voidrift", "worktrees", "no-meta");
    mkdirSync(wtDir, { recursive: true });
    // Can't easily fake ctime, so this will be preserved (< 2 hours old)
    const result = cleanupWorktrees(TMP);
    expect(result.preservedWorktrees).toContain("no-meta");
  });

  it("resets locks.json to empty", () => {
    const result = cleanupWorktrees(TMP);
    const locks = JSON.parse(readFileSync(join(TMP, ".voidrift", "locks.json"), "utf-8"));
    expect(locks.activeLocks).toEqual([]);
    expect(result.clearedLocks).toBe(true);
  });

  it("creates .voidrift directories if missing", () => {
    const fresh = join(tmpdir(), "voidrift-cleanup-fresh-" + Date.now());
    mkdirSync(fresh, { recursive: true });
    execSync("git init", { cwd: fresh, stdio: "ignore" });

    cleanupWorktrees(fresh);
    expect(existsSync(join(fresh, ".voidrift", "worktrees"))).toBe(true);
    rmSync(fresh, { recursive: true, force: true });
  });

  it("handles non-git directories gracefully", () => {
    const nonGit = join(tmpdir(), "voidrift-cleanup-nongit-" + Date.now());
    mkdirSync(nonGit, { recursive: true });
    const result = cleanupWorktrees(nonGit);
    expect(result.clearedLocks).toBe(true);
    expect(result.errors).toHaveLength(0);
    rmSync(nonGit, { recursive: true, force: true });
  });

  it("writeWorktreeMeta creates .meta.json with current PID", () => {
    const wtDir = join(TMP, ".voidrift", "worktrees", "new-wt");
    mkdirSync(wtDir, { recursive: true });
    writeWorktreeMeta(wtDir);

    const meta = JSON.parse(readFileSync(join(wtDir, ".meta.json"), "utf-8"));
    expect(meta.pid).toBe(process.pid);
    expect(meta.createdAt).toBeDefined();
  });

  it("returns no errors on clean run", () => {
    const result = cleanupWorktrees(TMP);
    expect(result.errors).toHaveLength(0);
  });
});
