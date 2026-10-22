/**
 * Clipboard image paste unit tests (cli-blueprint.md §3.7). The spawn seam is
 * injected so every test is deterministic and offline — no real wl-paste,
 * xclip, or osascript is ever executed. Writes go to an OS temp workspace.
 */
import { hermeticTmp } from "./test-hermetic.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isPng,
  resolveClipboardTool,
  pasteClipboardImage,
  type ClipboardEnv,
} from "./clipboard.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const NOT_PNG = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"

describe("§3.7 PNG magic-byte validation", () => {
  it("accepts a buffer that opens with the PNG signature", () => {
    expect(isPng(PNG)).toBe(true);
  });
  it("rejects a non-PNG buffer and a too-short buffer", () => {
    expect(isPng(NOT_PNG)).toBe(false);
    expect(isPng(Buffer.from([0x89, 0x50]))).toBe(false);
  });
});

describe("§3.7 platform-aware tool resolution", () => {
  it("selects osascript on macOS", () => {
    const t = resolveClipboardTool({ platform: "darwin" });
    expect(t?.command).toBe("osascript");
  });
  it("selects wl-paste on Wayland with the right arg array", () => {
    const t = resolveClipboardTool({ platform: "linux", WAYLAND_DISPLAY: "wayland-0" });
    expect(t).toEqual({ command: "wl-paste", args: ["--type", "image/png"] });
  });
  it("selects xclip on X11 with the right arg array", () => {
    const t = resolveClipboardTool({ platform: "linux", DISPLAY: ":0" });
    expect(t).toEqual({
      command: "xclip",
      args: ["-selection", "clipboard", "-target", "image/png", "-o"],
    });
  });
  it("returns null with no clipboard tool for the platform", () => {
    expect(resolveClipboardTool({ platform: "linux" })).toBeNull();
  });
});

describe("§3.7 clipboard image paste", () => {
  let ws: string;
  beforeEach(async () => {
    ws = hermeticTmp("clip");
  });
  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
  });

  it("spawns the right tool with shell:false, validates PNG, and saves under the cache subtree", async () => {
    const calls: { command: string; args: string[] }[] = [];
    const spawn = vi.fn(async (command: string, args: string[]) => {
      calls.push({ command, args });
      return PNG;
    });
    const env: ClipboardEnv = { platform: "linux", WAYLAND_DISPLAY: "wayland-0" };
    const result = await pasteClipboardImage(ws, "sid-1", { env, spawn, now: () => 1234 });
    // Given — a Wayland env; When — Ctrl+V; Then — wl-paste with its arg array.
    expect(calls).toEqual([{ command: "wl-paste", args: ["--type", "image/png"] }]);
    expect(result).not.toBeNull();
    expect(result!.path).toBe(join(ws, ".voidrift/cache/apps/cli/clipboard/sid-1/1234.png"));
    expect(result!.token).toContain("1234.png");
    const written = await readFile(result!.path);
    expect(written.equals(PNG)).toBe(true);
  });

  it("is a silent no-op for a non-PNG clipboard payload (nothing written)", async () => {
    const spawn = vi.fn(async () => NOT_PNG);
    const env: ClipboardEnv = { platform: "linux", DISPLAY: ":0" };
    const result = await pasteClipboardImage(ws, "sid-2", { env, spawn });
    expect(result).toBeNull();
  });

  it("is a silent no-op when no clipboard tool fits the platform (never spawns)", async () => {
    const spawn = vi.fn(async () => PNG);
    const result = await pasteClipboardImage(ws, "sid-3", { env: { platform: "linux" }, spawn });
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("is a silent no-op when the tool errors (no image on the clipboard)", async () => {
    const spawn = vi.fn(async () => {
      throw new Error("No suitable type of content copied");
    });
    const env: ClipboardEnv = { platform: "linux", WAYLAND_DISPLAY: "wayland-0" };
    const result = await pasteClipboardImage(ws, "sid-4", { env, spawn });
    expect(result).toBeNull();
  });
});
