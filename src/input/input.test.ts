/**
 * §3.9 integration test — text input, history, and autocomplete
 * (cli-blueprint.md §3.9). Clipboard (§3.7) and editor (§3.8) are Slice C.
 */
import { describe, it, expect } from "vitest";
import { InputHistory } from "./history.js";
import { completeCommands, completeFiles, windowFor, lastWord, COMMAND_WINDOW, WINDOW } from "./autocomplete.js";

describe("§3.2 input history", () => {
  it("stores submitted inputs newest-first and dedupes adjacent duplicates", () => {
    const h = new InputHistory();
    h.push("one");
    h.push("two");
    h.push("two"); // adjacent duplicate collapses
    expect(h.all).toEqual(["two", "one"]);
  });

  it("ignores empty / whitespace submits", () => {
    const h = new InputHistory();
    h.push("   ");
    h.push("");
    expect(h.size).toBe(0);
  });

  it("caps at 500 entries, dropping the oldest", () => {
    const h = new InputHistory(500);
    for (let i = 0; i < 600; i++) h.push(`cmd${i}`);
    expect(h.size).toBe(500);
    expect(h.all[0]).toBe("cmd599");
    expect(h.all[499]).toBe("cmd100");
  });

  it("Up saves the live buffer and Down past newest restores it", () => {
    const h = new InputHistory();
    h.push("first");
    h.push("second");
    expect(h.previous("draft")).toBe("second");
    expect(h.previous("draft")).toBe("first");
    expect(h.previous("draft")).toBe("first"); // clamped at oldest
    expect(h.next()).toBe("second");
    expect(h.next()).toBe("draft"); // restores the saved live buffer
  });
});

describe("§3.3 autocomplete", () => {
  it("completes a / prefix case-insensitively against the command list", () => {
    const c = completeCommands("/He", ["help", "sessions", "model"]);
    expect(c.map((x) => x.value)).toEqual(["/help"]);
  });

  it("a bare / lists all commands uncapped (§3.3 — slash results are not capped)", () => {
    const commands = Array.from({ length: 12 }, (_, i) => `cmd${i}`);
    // 12 plugin commands + the 31 built-ins, all present — no 10-cap.
    const all = completeCommands("/", commands);
    expect(all.length).toBeGreaterThan(10);
    for (const name of commands) expect(all.map((x) => x.value)).toContain(`/${name}`);
  });

  it("a slash candidate carries the built-in command's description (§3.3)", () => {
    const c = completeCommands("/help", []);
    expect(c[0]).toMatchObject({ value: "/help", label: "/help", description: "Show the command list" });
  });

  it("built-in commands complete even when session.listCommands is empty (§7.3)", () => {
    // Built-ins resolve from the catalog, not from session.listCommands.
    expect(completeCommands("/help", []).map((x) => x.value)).toContain("/help");
    expect(completeCommands("/sess", []).map((x) => x.value)).toContain("/sessions");
  });

  it("matches file paths by prefix first then substring against path or basename", () => {
    const files = ["src/app.ts", "src/index.ts", "lib/app.test.ts"];
    const c = completeFiles("app", files);
    expect(c[0]!.value).toBe("src/app.ts"); // basename prefix match ranks first
    expect(c.map((x) => x.value)).toContain("lib/app.test.ts"); // substring match
  });

  it("lastWord targets the last whitespace-separated word", () => {
    expect(lastWord("edit src/ap")).toBe("src/ap");
  });

  it("scrolls the 5-item window with the cursor so a late selection stays visible", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => ({ value: `f${i}`, label: `f${i}` }));
    const win = windowFor(candidates, 6);
    expect(win.visible.map((c) => c.value)).toEqual(["f2", "f3", "f4", "f5", "f6"]);
    expect(win.more).toBe(1);
  });

  it("windows slash commands in an 8-row view (COMMAND_WINDOW), files in 5 (§3.3)", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => ({ value: `c${i}`, label: `c${i}` }));
    const win = windowFor(candidates, 9, COMMAND_WINDOW);
    expect(win.visible).toHaveLength(8);
    expect(win.visible.map((c) => c.value)).toEqual(["c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"]);
    expect(win.more).toBe(2);
    // The same candidates in the file window show only 5 rows.
    expect(windowFor(candidates, 0, WINDOW).visible).toHaveLength(5);
  });
});
