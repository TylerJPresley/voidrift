import { describe, it, expect } from "vitest";
import { createState } from "../../src/tui/state.js";
import { wrapCommand } from "../../src/commands/base.js";
import type { ModelInterface } from "../../src/models.js";

describe("wrapCommand", () => {
  it("sets busy and mode, resets on completion", async () => {
    const state = createState("m", ".", "");
    let resolved = false;

    async function handleTest(args: string, mc: any, state: any) {
      expect(state.busy).toBe(true);
      expect(state.mode).toBe("/test");
      resolved = true;
    }

    wrapCommand(handleTest, "", {} as ModelInterface, state, () => "skip", "");
    // Wait for async completion
    await new Promise(r => setTimeout(r, 50));
    expect(resolved).toBe(true);
    expect(state.busy).toBe(false);
    expect(state.mode).toBe("");
  });

  it("catches errors and adds system message", async () => {
    const state = createState("m", ".", "");

    async function handleBoom() {
      throw new Error("kaboom");
    }

    wrapCommand(handleBoom, "", {} as ModelInterface, state, () => "skip", "");
    await new Promise(r => setTimeout(r, 50));
    expect(state.busy).toBe(false);
    expect(state.messages.some(m => m.text.includes("kaboom"))).toBe(true);
  });

  it("derives mode from function name", async () => {
    const state = createState("m", ".", "");
    let capturedMode = "";

    async function handleGather(args: string, mc: any, s: any) {
      capturedMode = s.mode;
    }

    wrapCommand(handleGather, "", {} as ModelInterface, state, () => "skip", "");
    await new Promise(r => setTimeout(r, 50));
    expect(capturedMode).toBe("/gather");
  });
});
