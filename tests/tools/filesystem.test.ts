import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, utimesSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WriteContext } from "../../src/tools/filesystem.js";

function makeLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
}

describe("WriteContext", () => {
  const tmp = join(tmpdir(), `voidrift-test-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let ctx: WriteContext;

  beforeEach(() => {
    mkdirSync(tmp, { recursive: true });
    ctx = new WriteContext({ projectDir: tmp, maxReadLines: 10 });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  // ── Read ──────────────────────────────────────────────────────────────

  describe("readSourceFile", () => {
    it("reads a file", () => {
      writeFileSync(join(tmp, "hello.txt"), "hello world\n");
      expect(ctx.readSourceFile("hello.txt")).toContain("hello world");
    });

    it("returns error for missing file", () => {
      expect(ctx.readSourceFile("nope.txt")).toContain("not found");
    });

    it("blocks path traversal (REQ-SEC-1)", () => {
      expect(ctx.readSourceFile("../../etc/passwd")).toContain("Access denied");
    });

    it("paginates large files (REQ-FSZ-1)", () => {
      writeFileSync(join(tmp, "big.txt"), makeLines(20));
      const result = ctx.readSourceFile("big.txt");
      expect(result).toContain("WARNING");
      expect(result).toContain("20 lines");
      expect(result).toContain("offset=10");
    });

    it("explicit limit suppresses warning", () => {
      writeFileSync(join(tmp, "big.txt"), makeLines(20));
      const result = ctx.readSourceFile("big.txt", 0, 5);
      expect(result).not.toContain("WARNING");
    });

    it("explicit offset suppresses warning", () => {
      writeFileSync(join(tmp, "big.txt"), makeLines(20));
      const result = ctx.readSourceFile("big.txt", 10);
      expect(result).not.toContain("WARNING");
    });

    it("warning contains correct next offset", () => {
      writeFileSync(join(tmp, "big.txt"), makeLines(30));
      const result = ctx.readSourceFile("big.txt");
      expect(result).toContain("offset=10");
    });
  });

  // ── Byte guard (REQ-FSZ-5) ───────────────────────────────────────────

  describe("byte guard", () => {
    it("no truncation at limit", () => {
      const small = new WriteContext({ projectDir: tmp, maxReadBytes: 1024 });
      writeFileSync(join(tmp, "exact.txt"), "x".repeat(1024));
      expect(small.readSourceFile("exact.txt")).not.toContain("TRUNCATED");
    });

    it("truncates over limit", () => {
      const small = new WriteContext({ projectDir: tmp, maxReadBytes: 1024 });
      writeFileSync(join(tmp, "big.txt"), "y".repeat(2048));
      const result = small.readSourceFile("big.txt");
      expect(result).toContain("TRUNCATED");
    });

    it("disabled when zero", () => {
      const noByte = new WriteContext({ projectDir: tmp, maxReadBytes: 0 });
      writeFileSync(join(tmp, "huge.txt"), "z".repeat(100_000));
      expect(noByte.readSourceFile("huge.txt")).not.toContain("TRUNCATED");
    });

    it("utf-8 boundary safe", () => {
      const small = new WriteContext({ projectDir: tmp, maxReadBytes: 100 });
      writeFileSync(join(tmp, "utf8.txt"), "é".repeat(200));
      const result = small.readSourceFile("utf8.txt");
      expect(result).toContain("TRUNCATED");
      // Should not throw on encode
      expect(() => Buffer.from(result, "utf-8")).not.toThrow();
    });
  });

  // ── Write ─────────────────────────────────────────────────────────────

  describe("writeSourceFile", () => {
    it("writes a file", () => {
      const result = ctx.writeSourceFile("out.txt", "content");
      expect(result).toContain("Wrote");
      expect(readFileSync(join(tmp, "out.txt"), "utf-8")).toBe("content");
    });

    it("blocks path traversal", () => {
      expect(ctx.writeSourceFile("../../bad.txt", "x")).toContain("Access denied");
    });

    it("blocks protected paths", () => {
      const pctx = new WriteContext({ projectDir: tmp, protectedPaths: ["pyproject.toml"] });
      expect(pctx.writeSourceFile("pyproject.toml", "x")).toContain("protected");
    });

    it("rejects oversized writes (REQ-FSZ-2)", () => {
      const result = ctx.writeSourceFile("big.txt", makeLines(15));
      expect(result).toContain("exceeds");
    });

    it("boundary at limit succeeds", () => {
      const result = ctx.writeSourceFile("exact.txt", makeLines(10));
      expect(result).toContain("Wrote");
    });

    it("boundary one over limit rejected", () => {
      const result = ctx.writeSourceFile("over.txt", makeLines(11));
      expect(result).toContain("exceeds");
    });

    it("error includes line count and limit", () => {
      const result = ctx.writeSourceFile("big.txt", makeLines(15));
      expect(result).toContain("15");
      expect(result).toContain("10");
    });

    it("creates parent directories", () => {
      ctx.writeSourceFile("sub/dir/file.txt", "nested");
      expect(readFileSync(join(tmp, "sub/dir/file.txt"), "utf-8")).toBe("nested");
    });

    it("rejected write does not create file", () => {
      ctx.writeSourceFile("src/big.py", makeLines(15));
      expect(existsSync(join(tmp, "src/big.py"))).toBe(false);
    });
  });

  // ── Framework file operations ─────────────────────────────────────────

  describe("framework files", () => {
    it("writeFrameworkFile writes to .voidrift/", () => {
      const result = ctx.writeFrameworkFile("REQUIREMENTS.md", "# Reqs\n");
      expect(result).toContain("Wrote");
      expect(existsSync(join(tmp, ".voidrift/REQUIREMENTS.md"))).toBe(true);
    });

    it("readFrameworkFile reads from .voidrift/", () => {
      mkdirSync(join(tmp, ".voidrift"), { recursive: true });
      writeFileSync(join(tmp, ".voidrift/TASKS.md"), "task content");
      expect(ctx.readFrameworkFile("TASKS.md")).toContain("task content");
    });

    it("readFrameworkFile paginates large files", () => {
      mkdirSync(join(tmp, ".voidrift"), { recursive: true });
      writeFileSync(join(tmp, ".voidrift/TASKS.md"), makeLines(20));
      const result = ctx.readFrameworkFile("TASKS.md");
      expect(result).toContain("WARNING");
    });

    it("readFrameworkFile small file no warning", () => {
      mkdirSync(join(tmp, ".voidrift"), { recursive: true });
      writeFileSync(join(tmp, ".voidrift/REQUIREMENTS.md"), makeLines(5));
      expect(ctx.readFrameworkFile("REQUIREMENTS.md")).not.toContain("WARNING");
    });

    it("writeSourceFile blocks .voidrift/ paths", () => {
      const result = ctx.writeSourceFile(".voidrift/hack.md", "x");
      expect(result).toContain("writeFrameworkFile");
    });
  });

  // ── Edit ──────────────────────────────────────────────────────────────

  describe("editSourceFile", () => {
    it("replaces exact match", () => {
      writeFileSync(join(tmp, "edit.txt"), "hello world");
      const result = ctx.editSourceFile("edit.txt", "hello", "goodbye");
      expect(result).toContain("Edited");
      expect(readFileSync(join(tmp, "edit.txt"), "utf-8")).toBe("goodbye world");
    });

    it("errors on multiple matches", () => {
      writeFileSync(join(tmp, "dup.txt"), "aaa\naaa\naaa");
      expect(ctx.editSourceFile("dup.txt", "aaa", "bbb")).toContain("3 times");
    });

    it("errors when not found", () => {
      writeFileSync(join(tmp, "miss.txt"), "hello");
      expect(ctx.editSourceFile("miss.txt", "xyz", "abc")).toContain("not found");
    });

    it("whitespace-normalized match succeeds", () => {
      writeFileSync(join(tmp, "ws.py"), "  x = 1\n  y = 2\n");
      const result = ctx.editSourceFile("ws.py", "x = 1\ny = 2", "x = 42\ny = 99");
      expect(result).toContain("Edited");
      expect(result).toContain("whitespace-normalized");
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────

  describe("deleteSourceFile", () => {
    it("deletes a file", () => {
      writeFileSync(join(tmp, "del.txt"), "bye");
      expect(ctx.deleteSourceFile("del.txt")).toContain("Deleted");
      expect(existsSync(join(tmp, "del.txt"))).toBe(false);
    });

    it("errors on missing file", () => {
      expect(ctx.deleteSourceFile("nope.txt")).toContain("not found");
    });

    it("blocks path traversal", () => {
      expect(ctx.deleteSourceFile("../../etc/passwd")).toContain("Access denied");
    });

    it("blocks protected paths", () => {
      const pctx = new WriteContext({ projectDir: tmp, protectedPaths: ["Makefile"] });
      writeFileSync(join(tmp, "Makefile"), "all:");
      expect(pctx.deleteSourceFile("Makefile")).toContain("protected");
    });
  });

  // ── Mtime guard (REQ-D-19) ───────────────────────────────────────────

  describe("mtime guard", () => {
    it("external modification returns warning", () => {
      ctx.writeSourceFile("src/api.py", "original");
      const f = join(tmp, "src/api.py");
      const future = new Date(Date.now() + 10_000);
      utimesSync(f, future, future);
      const result = ctx.writeSourceFile("src/api.py", "updated");
      expect(result).toContain("modified externally");
    });

    it("no external modification proceeds normally", () => {
      ctx.writeSourceFile("src/api.py", "v1");
      const result = ctx.writeSourceFile("src/api.py", "v2");
      expect(result).toContain("Wrote");
      expect(readFileSync(join(tmp, "src/api.py"), "utf-8")).toBe("v2");
    });

    it("force_write overrides mtime check", () => {
      ctx.writeSourceFile("src/api.py", "original");
      const f = join(tmp, "src/api.py");
      const future = new Date(Date.now() + 10_000);
      utimesSync(f, future, future);
      const result = ctx.writeSourceFile("src/api.py", "forced", true);
      expect(result).toContain("Wrote");
      expect(readFileSync(f, "utf-8")).toBe("forced");
    });

    it("first write never triggers mtime check", () => {
      mkdirSync(join(tmp, "src"), { recursive: true });
      const f = join(tmp, "src/new.py");
      writeFileSync(f, "pre-existing");
      const past = new Date(Date.now() - 100_000);
      utimesSync(f, past, past);
      const result = ctx.writeSourceFile("src/new.py", "agent content");
      expect(result).toContain("Wrote");
    });
  });

  // ── Snapshots (REQ-D-15) ─────────────────────────────────────────────

  describe("snapshots", () => {
    it("rollback restores original content", () => {
      writeFileSync(join(tmp, "snap.txt"), "original");
      ctx.setSnapshots();
      ctx.writeSourceFile("snap.txt", "modified");
      expect(readFileSync(join(tmp, "snap.txt"), "utf-8")).toBe("modified");
      ctx.rollbackSnapshots();
      expect(readFileSync(join(tmp, "snap.txt"), "utf-8")).toBe("original");
    });

    it("rollback deletes newly created files", () => {
      ctx.setSnapshots();
      ctx.writeSourceFile("new.txt", "new content");
      expect(existsSync(join(tmp, "new.txt"))).toBe(true);
      ctx.rollbackSnapshots();
      expect(existsSync(join(tmp, "new.txt"))).toBe(false);
    });

    it("clear after success", () => {
      ctx.setSnapshots();
      expect(ctx.getSnapshots()).not.toBeNull();
      ctx.clearSnapshots();
      expect(ctx.getSnapshots()).toBeNull();
    });

    it("computeDiffStats — created file", () => {
      ctx.setSnapshots();
      ctx.writeSourceFile("src/new.py", "line1\nline2\nline3");
      const stats = ctx.computeDiffStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].status).toBe("created");
      expect(stats[0].linesAdded).toBe(3);
      ctx.clearSnapshots();
    });

    it("computeDiffStats — modified file", () => {
      mkdirSync(join(tmp, "src"), { recursive: true });
      writeFileSync(join(tmp, "src/api.py"), "old line\n");
      ctx.setSnapshots();
      ctx.writeSourceFile("src/api.py", "new line\nextra\n");
      const stats = ctx.computeDiffStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].status).toBe("modified");
      expect(stats[0].linesAdded).toBeGreaterThan(0);
      ctx.clearSnapshots();
    });

    it("computeDiffStats — deleted file", () => {
      writeFileSync(join(tmp, "gone.txt"), "line1\nline2\n");
      ctx.setSnapshots();
      ctx.deleteSourceFile("gone.txt");
      const stats = ctx.computeDiffStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].status).toBe("deleted");
      expect(stats[0].linesRemoved).toBeGreaterThan(0);
      ctx.clearSnapshots();
    });

    it("computeDiffStats — empty when no snapshots", () => {
      expect(ctx.computeDiffStats()).toEqual([]);
    });

    it("delete snapshots for rollback", () => {
      mkdirSync(join(tmp, "src"), { recursive: true });
      writeFileSync(join(tmp, "src/old.py"), "original content");
      ctx.setSnapshots();
      ctx.deleteSourceFile("src/old.py");
      expect(existsSync(join(tmp, "src/old.py"))).toBe(false);
      ctx.rollbackSnapshots();
      expect(existsSync(join(tmp, "src/old.py"))).toBe(true);
      expect(readFileSync(join(tmp, "src/old.py"), "utf-8")).toBe("original content");
    });
  });

  // ── Write count ───────────────────────────────────────────────────────

  describe("writeCount", () => {
    it("tracks source writes", () => {
      expect(ctx.getWriteCount()).toBe(0);
      ctx.writeSourceFile("a.txt", "a");
      expect(ctx.getWriteCount()).toBe(1);
      ctx.writeSourceFile("b.txt", "b");
      expect(ctx.getWriteCount()).toBe(2);
    });
  });

  // ── Symlink detection ─────────────────────────────────────────────────

  describe("symlink handling", () => {
    it("reads through symlink within project", () => {
      writeFileSync(join(tmp, "real.txt"), "real content");
      symlinkSync(join(tmp, "real.txt"), join(tmp, "link.txt"));
      expect(ctx.readSourceFile("link.txt")).toContain("real content");
    });
  });
});
