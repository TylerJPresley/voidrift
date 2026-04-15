import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { captureGitSnapshot, snapshotToPromptBlock, getBoundedDiff, GitCheckpointManager } from "../src/git.js";

describe("captureGitSnapshot", () => {
  const tmp = join(tmpdir(), `voidrift-test-git-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmp, { recursive: true });
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name Test", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.txt"), "hello");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("captures branch and commits", () => {
    const snap = captureGitSnapshot(tmp);
    expect(snap).not.toBeNull();
    expect(snap!.branch).toBeTruthy();
    expect(snap!.commits.length).toBeGreaterThan(0);
  });

  it("returns null for non-git directory", () => {
    const nonGit = join(tmpdir(), `voidrift-nongit-${Date.now()}`);
    mkdirSync(nonGit, { recursive: true });
    expect(captureGitSnapshot(nonGit)).toBeNull();
    rmSync(nonGit, { recursive: true, force: true });
  });
});

describe("snapshotToPromptBlock", () => {
  it("formats snapshot as markdown", () => {
    const block = snapshotToPromptBlock({ branch: "main", commits: ["abc init"], changedFiles: ["M file.txt"] });
    expect(block).toContain("## Git Context");
    expect(block).toContain("Branch: main");
    expect(block).toContain("abc init");
    expect(block).toContain("M file.txt");
  });
});

describe("getBoundedDiff", () => {
  const tmp = join(tmpdir(), `voidrift-test-diff-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmp, { recursive: true });
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name Test", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.txt"), "line1\nline2\n");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns diff text", () => {
    writeFileSync(join(tmp, "file.txt"), "line1\nline2\nline3\n");
    const result = getBoundedDiff(tmp);
    expect(result.diffText).toContain("line3");
  });

  it("excludes binary files", () => {
    writeFileSync(join(tmp, "image.png"), "binary");
    execSync("git add image.png", { cwd: tmp, stdio: "pipe" });
    const result = getBoundedDiff(tmp);
    expect(result.binaryFiles).toContain("image.png");
  });
});

describe("GitCheckpointManager", () => {
  const tmp = join(tmpdir(), `voidrift-test-checkpoint-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmp, { recursive: true });
    execSync("git init", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: tmp, stdio: "pipe" });
    execSync("git config user.name Test", { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "file.txt"), "original");
    execSync("git add . && git commit -m init", { cwd: tmp, stdio: "pipe" });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("creates checkpoint from dirty tree", () => {
    writeFileSync(join(tmp, "file.txt"), "modified");
    const mgr = new GitCheckpointManager(tmp);
    const cp = mgr.create(1, 1);
    expect(cp).not.toBeNull();
    expect(cp!.ref).toBeTruthy();
  });

  it("returns null for clean tree", () => {
    const mgr = new GitCheckpointManager(tmp);
    expect(mgr.create(1, 1)).toBeNull();
  });

  it("saves and loads checkpoints", () => {
    writeFileSync(join(tmp, "file.txt"), "modified");
    const mgr = new GitCheckpointManager(tmp);
    mgr.create(1, 1);
    mgr.save(join(tmp, "checkpoints.jsonl"));
    const mgr2 = new GitCheckpointManager(tmp);
    mgr2.load(join(tmp, "checkpoints.jsonl"));
    expect(mgr2.checkpoints).toHaveLength(1);
  });
});
