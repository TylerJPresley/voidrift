import { describe, it, expect } from "vitest";
import { stripAnsi, truncateOutput } from "../../src/output/truncator.js";

describe("Output Truncator", () => {
  it("strips ANSI color codes", () => {
    const input = "\x1B[31mError\x1B[0m: something failed";
    expect(stripAnsi(input)).toBe("Error: something failed");
  });

  it("strips cursor movement codes", () => {
    const input = "\x1B[2K\x1B[1A\x1B[2Kclean line";
    expect(stripAnsi(input)).toBe("clean line");
  });

  it("returns text unchanged when under threshold", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    expect(truncateOutput(lines)).toBe(lines);
  });

  it("truncates long output keeping first and last 50 lines", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const result = truncateOutput(lines.join("\n"));
    expect(result).toContain("line 0");
    expect(result).toContain("line 49");
    expect(result).toContain("(100 lines omitted)");
    expect(result).toContain("line 150");
    expect(result).toContain("line 199");
  });

  it("strips ANSI before truncating", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `\x1B[32mline ${i}\x1B[0m`);
    const result = truncateOutput(lines.join("\n"));
    expect(result).not.toContain("\x1B");
    expect(result).toContain("line 0");
  });
});
