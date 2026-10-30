/**
 * §2.1 — `CLI_VERSION` is derived from this package's own `package.json` at
 * runtime, so `--version` and the banner can never drift from the published
 * version (the former `0.0.0` hardcode regression).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { CLI_VERSION } from "./version.js";

/** Read at test time from package.json — no hardcoded literal. */
const PKG_VERSION = (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

describe("§2.1 CLI_VERSION", () => {
  it("equals the version in package.json", () => {
    expect(CLI_VERSION).toBe(PKG_VERSION);
  });

  it("is not the 0.0.0 placeholder", () => {
    expect(CLI_VERSION).not.toBe("0.0.0");
  });
});
