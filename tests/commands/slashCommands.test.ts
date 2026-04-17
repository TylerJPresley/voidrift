import { describe, it, expect } from "vitest";
import { wrapCommand } from "../../src/commands/base.js";
import { ContentRegion } from "../../src/tui/regions/ContentRegion.js";
import { FooterRegion } from "../../src/tui/regions/FooterRegion.js";
import { InputRegion } from "../../src/tui/regions/InputRegion.js";
import type { ModelInterface } from "../../src/models.js";

describe("wrapCommand", () => {
  it("sets busy and mode, resets on completion", async () => {
    const content = new ContentRegion();
    const footer = new FooterRegion();
    const input = new InputRegion();
    const ctx = { content, footer, input } as any;
    let resolved = false;

    async function handleTest(args: string, mc: any, c: any, f: any, i: any) {
      expect(input.busy).toBe(true);
      expect(footer.mode).toBe("/test");
      resolved = true;
    }

    wrapCommand(handleTest, "", {} as ModelInterface, ctx, () => "skip", "");
    await new Promise(r => setTimeout(r, 50));
    expect(resolved).toBe(true);
    expect(input.busy).toBe(false);
    expect(footer.mode).toBe("");
  });

  it("catches errors and adds system message", async () => {
    const content = new ContentRegion();
    const footer = new FooterRegion();
    const input = new InputRegion();
    const ctx = { content, footer, input } as any;

    async function handleBoom() { throw new Error("kaboom"); }

    wrapCommand(handleBoom, "", {} as ModelInterface, ctx, () => "skip", "");
    await new Promise(r => setTimeout(r, 50));
    expect(input.busy).toBe(false);
    expect(content.messages.some(m => m.text.includes("kaboom"))).toBe(true);
  });

  it("derives mode from function name", async () => {
    const content = new ContentRegion();
    const footer = new FooterRegion();
    const input = new InputRegion();
    const ctx = { content, footer, input } as any;
    let capturedMode = "";

    async function handleGather(args: string, mc: any, c: any, f: any, i: any) {
      capturedMode = footer.mode;
    }

    wrapCommand(handleGather, "", {} as ModelInterface, ctx, () => "skip", "");
    await new Promise(r => setTimeout(r, 50));
    expect(capturedMode).toBe("/gather");
  });
});
