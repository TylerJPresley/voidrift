/**
 * Top-level agent string + data helpers (cli-blueprint.md §3.5, §4.4, §5.1,
 * §5.2, §6). The exact confirm-dialog wording is a contract; the bracket label
 * and the allow-posture flag are data-driven from `agents.list()` — never a
 * NAME.
 */
import { describe, it, expect } from "vitest";
import {
  MODE_CHANGE_BUSY_NOTICE,
  MODE_CYCLE_HINT,
  AUTO_APPROVE_TOOL_MARKER,
  agentLabel,
  isAllowPosture,
  confirmDialogText,
  confirmProvenanceLine,
  type TopAgent,
} from "./mode.js";

describe("§3.5/§5.2 strings", () => {
  it("the busy notice, cycle hint and ⚡ marker are stable", () => {
    expect(MODE_CHANGE_BUSY_NOTICE).toBe("finish or cancel the current turn first");
    expect(MODE_CYCLE_HINT).toBe("Shift+Tab to cycle modes.");
    expect(AUTO_APPROVE_TOOL_MARKER).toBe("⚡");
  });
});

describe("§5.2 bracket label (data-driven)", () => {
  it("prefers label over name, falling back when absent", () => {
    expect(agentLabel({ name: "research", label: "Research" })).toBe("Research");
    expect(agentLabel({ name: "research" })).toBe("research");
    expect(agentLabel(undefined)).toBe("chat");
  });

  it("the allow posture is keyed on unlisted, not a name", () => {
    expect(isAllowPosture({ name: "vibe", unlisted: "allow" })).toBe(true);
    expect(isAllowPosture({ name: "vibe", unlisted: "deny" })).toBe(false);
    expect(isAllowPosture({ name: "anything", unlisted: "allow" })).toBe(true);
    expect(isAllowPosture(undefined)).toBe(false);
  });
});

describe("§3.5/§6 confirm dialog text", () => {
  it("an unlisted:allow agent names the approval-prompt disabling", () => {
    const vibe: TopAgent = { name: "vibe", label: "Vibe", unlisted: "allow", confirm: true };
    expect(confirmDialogText(vibe)).toBe(
      "Vibe disables approval prompts for this session. Hard denies, Warden and guardrails still apply. [y] enable  [n] cancel",
    );
  });

  it("any other confirm:true agent uses the generic wording", () => {
    const deploy: TopAgent = { name: "deploy", unlisted: "ask", confirm: true };
    expect(confirmDialogText(deploy)).toBe("deploy asks for confirmation before it starts. [y] enable  [n] cancel");
  });
});

describe("§3.5/§6 confirm provenance line", () => {
  it("names source and sanitized file when both are present", () => {
    const vibe: TopAgent = { name: "vibe", unlisted: "allow", confirm: true, source: "project", file: "/repo/.voidrift/agents/vibe/agent.json" };
    expect(confirmProvenanceLine(vibe)).toBe("defined by project: /repo/.voidrift/agents/vibe/agent.json");
  });

  it("names source alone when there is no file (built-in or session registration)", () => {
    const sess: TopAgent = { name: "vibe", unlisted: "allow", confirm: true, source: "session" };
    expect(confirmProvenanceLine(sess)).toBe("defined by session");
    const builtin: TopAgent = { name: "chat", unlisted: "ask", confirm: true, source: "builtin" };
    expect(confirmProvenanceLine(builtin)).toBe("defined by builtin");
  });

  it("strips ANSI/control/bidi from the file path (a cloned repo cannot inject escapes)", () => {
    const hostile: TopAgent = { name: "vibe", unlisted: "allow", confirm: true, source: "project", file: "/repo/\x1b[31m\u202eevil\x07/agent.json" };
    const line = confirmProvenanceLine(hostile);
    // The ESC introducer, BEL and RLO override are removed; the inert "[31m"
    // text remains (it can no longer act as an escape without its introducer).
    expect(line).toBe("defined by project: /repo/[31mevil/agent.json");
    expect(line).not.toMatch(/[\x00-\x1f\x1b\u202e]/);
  });

  it("returns empty when the source is unknown", () => {
    const unknown: TopAgent = { name: "x", unlisted: "allow", confirm: true };
    expect(confirmProvenanceLine(unknown)).toBe("");
  });
});
