/**
 * §2 cli entry routing (cli-blueprint.md §2.1, §2.4). `--help`/`--version` print
 * to stdout and exit 0; a usage error prints to stderr and exits 2; a forced
 * prompt file that cannot be read exits 2 before boot. The interactive `chat`
 * path (Ink render) is covered by cli.startup.test.ts via runTui.
 */
import { hermeticTmp } from "./test-hermetic.js";
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { main } from "./cli.js";
import { EXIT } from "./exit-codes.js";

const WS = hermeticTmp("cli-entry");

function fakeProc(cwd = WS): NodeJS.Process & { out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const ee = new EventEmitter();
  const proc = ee as unknown as NodeJS.Process & { out: () => string; err: () => string };
  (proc as unknown as { stdout: { write: (s: string) => boolean } }).stdout = { write: (s: string) => ((out += s), true) };
  (proc as unknown as { stderr: { write: (s: string) => boolean } }).stderr = { write: (s: string) => ((err += s), true) };
  (proc as unknown as { cwd: () => string }).cwd = () => cwd;
  (proc as unknown as { stdin: { isTTY: boolean } }).stdin = { isTTY: true };
  proc.out = () => out;
  proc.err = () => err;
  return proc;
}

describe("§2 cli entry", () => {
  it("--help prints usage to stdout and exits 0", async () => {
    const proc = fakeProc();
    const code = await main(["--help"], proc);
    expect(code).toBe(EXIT.COMPLETED);
    expect(proc.out()).toContain("Interactive:");
    expect(proc.err()).toBe("");
  });

  it("--version prints the version to stdout and exits 0", async () => {
    const proc = fakeProc();
    const code = await main(["--version"], proc);
    expect(code).toBe(EXIT.COMPLETED);
    expect(proc.out().trim()).toBe("0.0.0");
  });

  it("an unknown flag prints to stderr and exits 2", async () => {
    const proc = fakeProc();
    const code = await main(["chat", "--bogus"], proc);
    expect(code).toBe(EXIT.USAGE);
    expect(proc.err()).toContain("unknown flag");
    expect(proc.err()).toContain("--help");
  });

  it("an illegal mode combination exits 2", async () => {
    const proc = fakeProc();
    expect(await main(["chat", "--routine", "x"], proc)).toBe(EXIT.USAGE);
  });

  it("--prompt @missing (unreadable forced file) exits 2 before boot", async () => {
    const proc = fakeProc("/nonexistent-workspace-xyz");
    const code = await main(["--prompt", "@/nonexistent-workspace-xyz/missing.md"], proc);
    expect(code).toBe(EXIT.USAGE);
    expect(proc.err()).toContain("missing.md");
  });
});
