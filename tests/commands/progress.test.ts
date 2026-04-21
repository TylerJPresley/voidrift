import { describe, it, expect } from "vitest";
import { ctxIcon, ctxColor, statsStr, formatAgentProgress, elapsedStr, tokenStr, italic } from "../../src/commands/progress.js";

describe("ctxIcon", () => {
  it("returns ○ for 0%", () => expect(ctxIcon(0)).toBe("○"));
  it("returns ◔ for 1-25%", () => {
    expect(ctxIcon(1)).toBe("◔");
    expect(ctxIcon(25)).toBe("◔");
  });
  it("returns ◑ for 26-50%", () => {
    expect(ctxIcon(26)).toBe("◑");
    expect(ctxIcon(50)).toBe("◑");
  });
  it("returns ◕ for 51-75%", () => {
    expect(ctxIcon(51)).toBe("◕");
    expect(ctxIcon(75)).toBe("◕");
  });
  it("returns ● for 76-100%", () => {
    expect(ctxIcon(76)).toBe("●");
    expect(ctxIcon(100)).toBe("●");
  });
});

describe("ctxColor", () => {
  it("returns green for 0-50%", () => {
    expect(ctxColor(0)).toBe("#4ec9b0");
    expect(ctxColor(50)).toBe("#4ec9b0");
  });
  it("returns yellow for 51-75%", () => {
    expect(ctxColor(51)).toBe("#e5c07b");
    expect(ctxColor(75)).toBe("#e5c07b");
  });
  it("returns red for 76-100%", () => {
    expect(ctxColor(76)).toBe("#e06c75");
    expect(ctxColor(100)).toBe("#e06c75");
  });
});

describe("statsStr", () => {
  it("returns parts joined by · without parens", () => {
    const result = statsStr(33, 1000, 800, 1, "✓ complete");
    expect(result).toContain("33s");
    expect(result).toContain("↓ 1.0k");
    expect(result).toContain("↑ 800");
    expect(result).toContain("◔");
    expect(result).toContain("1%");
    expect(result).toContain("✓ complete");
    expect(result).not.toContain("tkns:");
    expect(result).not.toContain("(");
  });

  it("omits fields with no data", () => {
    expect(statsStr(0, 0, 0, undefined, "thinking")).toBe("thinking");
  });

  it("includes context icon based on percentage", () => {
    const result = statsStr(10, 0, 0, 50, "✓ complete");
    expect(result).toContain("10s");
    expect(result).toContain("◑");
    expect(result).toContain("50%");
  });
});

describe("formatAgentProgress", () => {
  it("formats cached with italic status", () => {
    const result = formatAgentProgress({ label: "main.py", elapsed: 0, tokensIn: 0, tokensOut: 0, status: "cached" });
    expect(result).toBe(`main.py ${italic("✓ cached")}`);
  });

  it("formats queued with elapsed only", () => {
    const result = formatAgentProgress({ label: "main.py", elapsed: 5, tokensIn: 0, tokensOut: 0, status: "queued" });
    expect(result).toBe(`main.py ${italic("5s · queued")}`);
  });

  it("formats thinking with live stats", () => {
    const result = formatAgentProgress({ label: "main.py", elapsed: 12, tokensIn: 3000, tokensOut: 2800, ctxPct: 3, status: "thinking" });
    expect(result).toContain("main.py");
    expect(result).toContain("12s");
    expect(result).toContain("◔");
    expect(result).toContain("thinking");
  });

  it("formats complete with stats", () => {
    const result = formatAgentProgress({ label: "main.py", elapsed: 12, tokensIn: 3000, tokensOut: 2800, ctxPct: 3, status: "complete" });
    expect(result).toContain("main.py");
    expect(result).toContain("✓ complete");
    expect(result).toContain("◔");
  });

  it("formats failed with stats", () => {
    const result = formatAgentProgress({ label: "main.py", elapsed: 5, tokensIn: 1000, tokensOut: 0, ctxPct: 1, status: "failed" });
    expect(result).toContain("main.py");
    expect(result).toContain("⚠ failed");
    expect(result).toContain("◔");
  });
});

describe("elapsedStr", () => {
  it("formats seconds", () => expect(elapsedStr(45)).toBe("45s"));
  it("formats minutes", () => expect(elapsedStr(125)).toBe("2m 5s"));
});

describe("tokenStr", () => {
  it("formats small numbers", () => expect(tokenStr(500)).toBe("500"));
  it("formats thousands", () => expect(tokenStr(3000)).toBe("3.0k"));
});
