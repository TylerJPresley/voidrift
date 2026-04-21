/**
 * Tests for REQ-LOG-3: Richer iteration reasons in agent loop logging.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const loopSource = readFileSync(join(__dirname, "../../src/agent/loop.ts"), "utf-8");

describe("iteration reason: follow_up (REQ-LOG-3)", () => {
  it("logs ITERATION with reason=follow_up before follow-up continue", () => {
    expect(loopSource).toContain("[ITERATION turn=${turnCount} reason=follow_up]");
  });

  it("follow_up log is after messages push and before continue", () => {
    const pushIdx = loopSource.indexOf("this.messages.push(...followUp.messages)");
    const logIdx = loopSource.indexOf("reason=follow_up]", pushIdx);
    const continueIdx = loopSource.indexOf("continue;", logIdx);
    expect(pushIdx).toBeGreaterThan(-1);
    expect(logIdx).toBeGreaterThan(pushIdx);
    expect(continueIdx).toBeGreaterThan(logIdx);
  });
});

describe("iteration reason: stall_recovery (REQ-LOG-3)", () => {
  it("logs ITERATION with reason=stall_recovery before stall continue", () => {
    expect(loopSource).toContain("[ITERATION turn=${turnCount} reason=stall_recovery]");
  });

  it("stall_recovery log is after stallResult handling", () => {
    const stallIdx = loopSource.indexOf("stallResult.inject");
    const logIdx = loopSource.indexOf("reason=stall_recovery]", stallIdx);
    expect(stallIdx).toBeGreaterThan(-1);
    expect(logIdx).toBeGreaterThan(stallIdx);
  });
});

describe("iteration reason: truncation_recovery (REQ-LOG-3)", () => {
  it("logs ITERATION with reason=truncation_recovery for tool discard path", () => {
    const discardIdx = loopSource.indexOf("MAX_TOKENS_TOOL_DISCARD");
    const logIdx = loopSource.indexOf("reason=truncation_recovery]", discardIdx);
    expect(discardIdx).toBeGreaterThan(-1);
    expect(logIdx).toBeGreaterThan(discardIdx);
  });

  it("logs ITERATION with reason=truncation_recovery for text recovery path", () => {
    const recoveryIdx = loopSource.indexOf("MAX_TOKENS_RECOVERY attempt=");
    const logIdx = loopSource.indexOf("reason=truncation_recovery]", recoveryIdx);
    expect(recoveryIdx).toBeGreaterThan(-1);
    expect(logIdx).toBeGreaterThan(recoveryIdx);
  });
});

describe("existing iteration reasons preserved (REQ-LOG-3)", () => {
  it("still logs reason=tool_call for normal tool execution", () => {
    expect(loopSource).toContain("reason=tool_call tools=");
  });

  it("still logs reason=done_tool when done accepted", () => {
    expect(loopSource).toContain("reason=done_tool tools=");
  });

  it("still logs LOOP_EXIT with turns and token totals", () => {
    expect(loopSource).toContain("LOOP_EXIT reason=natural_stop turns=${turnCount} total_input=${this._inputTotal} total_output=${this._outputTotal}");
  });
});
