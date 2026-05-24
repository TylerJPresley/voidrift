import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

// We need to mock process.cwd for persistence since it uses it
const tmpDir = join(import.meta.dirname, "__tmp_session");
const sessionDir = join(tmpDir, ".voidrift", "sessions");
const sessionFile = join(sessionDir, "current.json");

beforeEach(() => {
  mkdirSync(sessionDir, { recursive: true });
  // Monkey-patch cwd for the module
  const origCwd = process.cwd;
  process.cwd = () => tmpDir;
  return () => { process.cwd = origCwd; };
});

afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("session persistence", () => {
  it("saveSession writes to disk", async () => {
    process.cwd = () => tmpDir;
    const { saveSession } = await import("../../src/session/persistence.ts");
    saveSession([{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }]);
    expect(existsSync(sessionFile)).toBe(true);
    const data = JSON.parse(require("fs").readFileSync(sessionFile, "utf-8"));
    expect(data.messages).toHaveLength(2);
    expect(data.id).toBeDefined();
    expect(data.createdAt).toBeDefined();
  });

  it("loadSession returns null when no file", async () => {
    process.cwd = () => join(tmpDir, "empty");
    const { loadSession } = await import("../../src/session/persistence.ts");
    expect(loadSession()).toBeNull();
  });

  it("clearSession removes the file", async () => {
    process.cwd = () => tmpDir;
    const { saveSession, clearSession } = await import("../../src/session/persistence.ts");
    saveSession([{ role: "user", content: "test" }]);
    expect(existsSync(sessionFile)).toBe(true);
    clearSession();
    expect(existsSync(sessionFile)).toBe(false);
  });
});
