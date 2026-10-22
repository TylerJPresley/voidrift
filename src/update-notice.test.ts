/**
 * The once-per-day interactive startup notice (cli-blueprint.md §5.5; core
 * §13.9.1). Exercises the REAL `maybeShowUpdateNotice` against a scratch config
 * dir with injected clock and check fn: shown once when defaults are out of
 * date, suppressed for the rest of the day via the 0600 state file, and skipped
 * when nothing is out of date.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { maybeShowUpdateNotice, type NoticeDeps } from "./update-notice.js";

describe("maybeShowUpdateNotice (§5.5)", () => {
  let dir: string;
  let err: string;
  const base = (over: Partial<NoticeDeps> = {}): NoticeDeps => ({
    stderr: { write: (s: string) => ((err += s), true) },
    configDir: () => dir,
    today: () => "2026-10-20",
    ...over,
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vr-notice-"));
    err = "";
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("shows a dim ℹ line naming the count and the fix when defaults are out of date", async () => {
    const shown = await maybeShowUpdateNotice(
      base({ check: async () => ({ count: 2, names: ["agents/research/prompt.md", "seeded allow rules"] }) }),
    );
    expect(shown).toBe(true);
    expect(err).toContain("ℹ 2 seeded defaults are out of date");
    expect(err).toContain("voidrift init --update");
    expect(err).toContain("\x1b[2m"); // dim
    // State file written 0600.
    const statePath = path.join(dir, ".update-notice");
    expect(existsSync(statePath)).toBe(true);
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
    expect((await fs.readFile(statePath, "utf8")).trim()).toBe("2026-10-20");
  });

  it("suppresses the notice for the rest of the same day", async () => {
    const check = async () => ({ count: 1, names: ["agents/vibe/prompt.md"] });
    expect(await maybeShowUpdateNotice(base({ check }))).toBe(true);
    err = "";
    expect(await maybeShowUpdateNotice(base({ check }))).toBe(false);
    expect(err).toBe("");
  });

  it("shows again on a new day", async () => {
    const check = async () => ({ count: 1, names: ["agents/vibe/prompt.md"] });
    await maybeShowUpdateNotice(base({ check, today: () => "2026-10-20" }));
    err = "";
    expect(await maybeShowUpdateNotice(base({ check, today: () => "2026-10-21" }))).toBe(true);
    expect(err).toContain("out of date");
  });

  it("skips entirely when nothing is out of date (no state file written)", async () => {
    const shown = await maybeShowUpdateNotice(base({ check: async () => ({ count: 0, names: [] }) }));
    expect(shown).toBe(false);
    expect(err).toBe("");
    expect(existsSync(path.join(dir, ".update-notice"))).toBe(false);
  });

  it("singular wording for one out-of-date default", async () => {
    await maybeShowUpdateNotice(base({ check: async () => ({ count: 1, names: ["agents/research/prompt.md"] }) }));
    expect(err).toContain("ℹ 1 seeded default is out of date");
  });
});
