import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryRegistry } from "../../src/session/memory.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-memory-test-" + Date.now());
const MEMORY_DIR = join(TMP, "memory");

const POOL_MEMORY = `---
id: mem-db-pool-01
title: Connection Pool Limit in Serverless Environments
summary: Limits prisma client pool size to 1 to prevent DB exhaustion.
context:
  extensions: [".ts", ".js"]
  files: ["schema.prisma", "prisma.ts"]
  keywords: ["prisma", "pool", "exhaustion", "serverless"]
---
When deploying Prisma to serverless environments (Vercel, Lambda),
always set the connection pool size to 1 to prevent database exhaustion.

\`\`\`typescript
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
\`\`\``;

const REACT_MEMORY = `---
id: mem-react-keys-01
title: React Key Anti-Pattern
summary: Never use array index as key for dynamic lists.
context:
  extensions: [".tsx", ".jsx"]
  keywords: ["react", "key", "list"]
---
Using array index as key causes unnecessary re-renders and state bugs.
Always use a stable unique identifier.`;

beforeEach(() => {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(join(MEMORY_DIR, "db-pool.md"), POOL_MEMORY);
  writeFileSync(join(MEMORY_DIR, "react-keys.md"), REACT_MEMORY);
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("MemoryRegistry", () => {
  it("indexes memory files from directory", () => {
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    expect(reg.all).toHaveLength(2);
    expect(reg.all[0].id).toBe("mem-db-pool-01");
    expect(reg.all[0].title).toBe("Connection Pool Limit in Serverless Environments");
    expect(reg.all[0].summary).toContain("pool size to 1");
  });

  it("ignores non-existent directories", () => {
    const reg = new MemoryRegistry();
    reg.index(["/nonexistent"]);
    expect(reg.all).toHaveLength(0);
  });

  it("Stage 1: discovers memories by file extension", () => {
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    const discovered = reg.discover({ focusedFiles: ["src/db.ts"], userInput: "" });
    expect(discovered).toHaveLength(1);
    expect(discovered[0].id).toBe("mem-db-pool-01");
  });

  it("Stage 1: discovers memories by filename", () => {
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    const discovered = reg.discover({ focusedFiles: ["schema.prisma"], userInput: "" });
    expect(discovered).toHaveLength(1);
    expect(discovered[0].id).toBe("mem-db-pool-01");
  });

  it("Stage 1: discovers memories by keyword in user input", () => {
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    const discovered = reg.discover({ focusedFiles: [], userInput: "fix the prisma pool issue" });
    expect(discovered).toHaveLength(1);
    expect(discovered[0].id).toBe("mem-db-pool-01");
  });

  it("Stage 1: discovers multiple matching memories", () => {
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    const discovered = reg.discover({ focusedFiles: ["component.tsx"], userInput: "prisma connection" });
    expect(discovered).toHaveLength(2);
  });

  it("Stage 1: returns empty when nothing matches", () => {
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    const discovered = reg.discover({ focusedFiles: ["main.go"], userInput: "write a go server" });
    expect(discovered).toHaveLength(0);
  });

  it("Stage 2: loadBody returns full text for valid ID", () => {
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    const body = reg.loadBody("mem-db-pool-01");
    expect(body).toContain("connection pool size to 1");
    expect(body).toContain("PrismaClient");
  });

  it("Stage 2: loadBody returns null for unknown ID", () => {
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    expect(reg.loadBody("nonexistent")).toBeNull();
  });

  it("handles malformed memory files gracefully", () => {
    writeFileSync(join(MEMORY_DIR, "bad.md"), "no frontmatter");
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    expect(reg.all).toHaveLength(2); // only valid ones
  });

  it("handles memory files missing required fields", () => {
    writeFileSync(join(MEMORY_DIR, "incomplete.md"), "---\nid: x\ntitle: y\n---\nbody");
    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR]);
    expect(reg.all).toHaveLength(2); // missing summary → skipped
  });

  it("indexes from multiple directories", () => {
    const dir2 = join(TMP, "global-memory");
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir2, "global.md"), `---
id: mem-global-01
title: Global Pattern
summary: A cross-project pattern.
context:
  keywords: ["global"]
---
Global memory content.`);

    const reg = new MemoryRegistry();
    reg.index([MEMORY_DIR, dir2]);
    expect(reg.all).toHaveLength(3);
  });
});
