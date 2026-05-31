import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IndexCache } from "../../src/codemap/cache.js";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-cache-test-" + Date.now());

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("Index Cache System", () => {
  it("initializes an empty cache if no file exists", () => {
    const cache = new IndexCache(TMP);
    const hash = cache.computeHash("hello world");
    expect(cache.get("nonexistent.ts", hash)).toBeNull();
  });

  it("sets and retrieves cached summaries on identical hash", () => {
    const cache = new IndexCache(TMP);
    const content = "export function main() {}";
    const hash = cache.computeHash(content);

    cache.set("src/main.ts", hash, "A summary of main.ts", 10);

    const hit = cache.get("src/main.ts", hash);
    expect(hit).not.toBeNull();
    expect(hit!.summary).toBe("A summary of main.ts");
    expect(hit!.totalLines).toBe(10);
  });

  it("returns null on a hash mismatch (file modified)", () => {
    const cache = new IndexCache(TMP);
    const content1 = "export function main() {}";
    const content2 = "export function main() { console.log('modified'); }";

    const hash1 = cache.computeHash(content1);
    const hash2 = cache.computeHash(content2);

    cache.set("src/main.ts", hash1, "Original summary", 1);

    expect(cache.get("src/main.ts", hash2)).toBeNull();
  });

  it("persists cached summaries to index_cache.json", () => {
    const cache1 = new IndexCache(TMP);
    const hash = cache1.computeHash("some content");

    cache1.set("src/lib.ts", hash, "Library summary", 5);

    const cachePath = join(TMP, ".voidrift", "index_cache.json");
    expect(existsSync(cachePath)).toBe(true);

    // Read index_cache.json directly to check structure
    const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
    expect(raw["src/lib.ts"]).toBeDefined();
    expect(raw["src/lib.ts"].sha256).toBe(hash);

    // Initialize a new cache instance pointing to the same folder
    const cache2 = new IndexCache(TMP);
    const hit = cache2.get("src/lib.ts", hash);
    expect(hit).not.toBeNull();
    expect(hit!.summary).toBe("Library summary");
  });
});
