import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WriteContext } from "../../src/tools/filesystem.js";

describe("WriteContext", () => {
  const tmp = join(tmpdir(), `voidrift-test-fs-${Date.now()}`);
  let ctx: WriteContext;

  beforeEach(() => {
    mkdirSync(tmp, { recursive: true });
    ctx = new WriteContext({ projectDir: tmp, maxReadLines: 10 });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

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
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
      writeFileSync(join(tmp, "big.txt"), lines);
      const result = ctx.readSourceFile("big.txt");
      expect(result).toContain("WARNING");
      expect(result).toContain("20 lines");
      expect(result).toContain("offset=10");
    });

    it("explicit limit suppresses warning", () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
      writeFileSync(join(tmp, "big.txt"), lines);
      const result = ctx.readSourceFile("big.txt", 0, 5);
      expect(result).not.toContain("WARNING");
    });
  });

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
      const big = Array.from({ length: 15 }, () => "x").join("\n");
      const result = ctx.writeSourceFile("big.txt", big);
      expect(result).toContain("exceeds");
    });

    it("creates parent directories", () => {
      ctx.writeSourceFile("sub/dir/file.txt", "nested");
      expect(readFileSync(join(tmp, "sub/dir/file.txt"), "utf-8")).toBe("nested");
    });
  });

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
  });

  describe("deleteSourceFile", () => {
    it("deletes a file", () => {
      writeFileSync(join(tmp, "del.txt"), "bye");
      expect(ctx.deleteSourceFile("del.txt")).toContain("Deleted");
      expect(existsSync(join(tmp, "del.txt"))).toBe(false);
    });

    it("errors on missing file", () => {
      expect(ctx.deleteSourceFile("nope.txt")).toContain("not found");
    });
  });

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
  });

  describe("writeCount", () => {
    it("tracks source writes", () => {
      expect(ctx.getWriteCount()).toBe(0);
      ctx.writeSourceFile("a.txt", "a");
      expect(ctx.getWriteCount()).toBe(1);
      ctx.writeSourceFile("b.txt", "b");
      expect(ctx.getWriteCount()).toBe(2);
    });
  });
});
