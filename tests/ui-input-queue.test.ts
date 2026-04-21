/**
 * Tests for REQ-UI-7: Input placeholder, queuing, and auto-dispatch.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const chatSource = readFileSync(join(__dirname, "../src/commands/chat.ts"), "utf-8");
const inputViewSource = readFileSync(join(__dirname, "../src/tui/components/InputView.tsx"), "utf-8");
const inputRegionSource = readFileSync(join(__dirname, "../src/tui/regions/InputRegion.ts"), "utf-8");

// ---------------------------------------------------------------------------
// Auto-dispatch as named function (the gap fix)
// ---------------------------------------------------------------------------

describe("dispatchPendingMessage (REQ-UI-7)", () => {
  it("defines dispatchPendingMessage function", () => {
    expect(chatSource).toContain("function dispatchPendingMessage()");
  });

  it("checks input.pendingMessage", () => {
    expect(chatSource).toMatch(/function dispatchPendingMessage[\s\S]*?input\.pendingMessage/);
  });

  it("clears pending and calls onSubmit", () => {
    expect(chatSource).toMatch(/function dispatchPendingMessage[\s\S]*?input\.setPending\(null\)[\s\S]*?onSubmit\(pending\)/);
  });

  it("is called from finally block", () => {
    expect(chatSource).toContain("dispatchPendingMessage();");
    const finallyIdx = chatSource.indexOf("} finally {");
    const dispatchIdx = chatSource.indexOf("dispatchPendingMessage();", finallyIdx);
    expect(dispatchIdx).toBeGreaterThan(finallyIdx);
  });
});

// ---------------------------------------------------------------------------
// Queuing: only one message (AC2/AC4)
// ---------------------------------------------------------------------------

describe("message queuing (REQ-UI-7)", () => {
  it("queues message when busy and no pending", () => {
    expect(inputViewSource).toContain("region.busy && !region.pendingMessage");
    expect(inputViewSource).toContain("region.setPending(text)");
  });

  it("locks input when already queued", () => {
    expect(inputViewSource).toContain("if (region.busy) return;");
  });
});

// ---------------------------------------------------------------------------
// Up arrow recall (AC3)
// ---------------------------------------------------------------------------

describe("Up arrow recall of queued message (REQ-UI-7)", () => {
  it("recalls pending message on Up arrow", () => {
    expect(inputViewSource).toContain("region.pendingMessage");
    expect(inputViewSource).toContain("setValue(region.pendingMessage)");
  });

  it("clears pending after recall", () => {
    expect(inputViewSource).toContain("region.setPending(null)");
  });
});

// ---------------------------------------------------------------------------
// InputRegion pending state
// ---------------------------------------------------------------------------

describe("InputRegion pending state (REQ-UI-7)", () => {
  it("has pendingMessage field", () => {
    expect(inputRegionSource).toContain("pendingMessage: string | null");
  });

  it("has setPending method", () => {
    expect(inputRegionSource).toContain("setPending(msg: string | null)");
  });
});
