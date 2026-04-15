import { describe, it, expect } from "vitest";
import { tcSig, detectStall, buildSigSet } from "../../src/agent/stall.js";
import type { ToolCall } from "../../src/agent/types.js";

function tc(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "1", type: "function", function: { name, arguments: JSON.stringify(args) } };
}

describe("tcSig", () => {
  it("uses path-only for file write actions", () => {
    const sig = tcSig(tc("file", { action: "write", path: "main.py", content: "abc" }));
    expect(sig).toBe("file:main.py");
  });

  it("uses full args for file read actions", () => {
    const sig = tcSig(tc("file", { action: "read", path: "main.py" }));
    expect(sig).toContain("read");
  });

  it("uses full args for non-file tools", () => {
    const sig = tcSig(tc("shell", { cmd: "pytest" }));
    expect(sig).toContain("pytest");
  });
});

describe("detectStall", () => {
  it("detects stall when signatures overlap", () => {
    const calls = [tc("file", { action: "read", path: "foo.js" })];
    const prev = buildSigSet(calls);
    expect(detectStall(calls, prev)).toBe(true);
  });

  it("no stall when signatures differ", () => {
    const prev = buildSigSet([tc("file", { action: "read", path: "a.py" })]);
    const current = [tc("file", { action: "read", path: "b.py" })];
    expect(detectStall(current, prev)).toBe(false);
  });

  it("no stall on first turn (empty prev)", () => {
    expect(detectStall([tc("file", { action: "read", path: "a.py" })], new Set())).toBe(false);
  });
});
