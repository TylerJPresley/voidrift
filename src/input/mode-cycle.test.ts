/**
 * Data-driven top-level-agent cycling unit tests (cli-blueprint.md §3.5). The
 * pure next-agent advance (order, wrap, project agent included, skip-when-
 * forbidden) and the `cycleMode`/`enterAgent` drivers over a scripted
 * `session.setMode` — the busy refusal, the first-entry confirmation hand-off,
 * and the managed-forbidden skip. Nothing tests for an agent NAME.
 */
import { describe, it, expect } from "vitest";
import type { CoreAPI } from "@voidrift/core";
import { cycleMode, enterAgent, type CycleState } from "./mode-cycle.js";
import { nextAgentName, sortTopAgents, type TopAgent } from "../mode.js";

/** chat(10, ask) → research(20, deny) → vibe(30, allow+confirm); a PROJECT
 * top-level agent `audit`(25, ask) must appear in the cycle too. */
const AGENTS: TopAgent[] = [
  { name: "chat", unlisted: "ask", order: 10 },
  { name: "research", unlisted: "deny", order: 20 },
  { name: "audit", unlisted: "ask", order: 25 },
  { name: "vibe", unlisted: "allow", confirm: true, order: 30 },
];

describe("§3.5 nextAgentName / sortTopAgents (pure)", () => {
  it("sorts by order then name and wraps", () => {
    const sorted = sortTopAgents(AGENTS).map((a) => a.name);
    expect(sorted).toEqual(["chat", "research", "audit", "vibe"]);
    expect(nextAgentName(AGENTS, "chat")).toBe("research");
    expect(nextAgentName(AGENTS, "research")).toBe("audit"); // project agent included
    expect(nextAgentName(AGENTS, "audit")).toBe("vibe");
    expect(nextAgentName(AGENTS, "vibe")).toBe("chat"); // wraps
  });

  it("skips a forbidden agent", () => {
    const forbidden = new Set(["vibe"]);
    expect(nextAgentName(AGENTS, "audit", forbidden)).toBe("chat"); // vibe skipped, wraps
  });

  it("a current agent outside the cycle advances to the first", () => {
    expect(nextAgentName(AGENTS, "gone")).toBe("chat");
  });
});

/** A scripted CoreAPI whose `session.setMode` returns a queued result. */
function apiWith(
  results: Array<{ ok: true; value: { from: string; to: string } } | { ok: false; error: { code: string; message: string } }>,
): { api: CoreAPI; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const api = {
    session: {
      setMode: async (_id: string, mode: string) => {
        calls.push(mode);
        return results[i++] ?? { ok: false as const, error: { code: "UNKNOWN", message: "x" } };
      },
    },
  } as unknown as CoreAPI;
  return { api, calls };
}

const base: CycleState = { current: "chat", forbidden: new Set(), confirmed: new Set() };

describe("§3.5 cycleMode", () => {
  it("chat → research calls setMode(research) and reports changed", async () => {
    const { api, calls } = apiWith([{ ok: true, value: { from: "chat", to: "research" } }]);
    const { outcome, state } = await cycleMode(api, "s", AGENTS, base);
    expect(calls).toEqual(["research"]);
    expect(outcome).toEqual({ kind: "changed", agent: "research" });
    expect(state.current).toBe("research");
  });

  it("includes a PROJECT-defined top-level agent in the cycle", async () => {
    const { api, calls } = apiWith([{ ok: true, value: { from: "research", to: "audit" } }]);
    const { outcome } = await cycleMode(api, "s", AGENTS, { ...base, current: "research" });
    expect(calls).toEqual(["audit"]);
    expect(outcome).toEqual({ kind: "changed", agent: "audit" });
  });

  it("entering a confirm:true agent the FIRST time defers to the dialog, NOT the core", async () => {
    const { api, calls } = apiWith([]);
    const { outcome } = await cycleMode(api, "s", AGENTS, { ...base, current: "audit" });
    expect(calls).toEqual([]);
    expect(outcome.kind).toBe("confirm");
    if (outcome.kind === "confirm") expect(outcome.agent.name).toBe("vibe");
  });

  it("a confirm:true agent already confirmed this session is entered directly", async () => {
    const { api, calls } = apiWith([{ ok: true, value: { from: "audit", to: "vibe" } }]);
    const { outcome } = await cycleMode(api, "s", AGENTS, { ...base, current: "audit", confirmed: new Set(["vibe"]) });
    expect(calls).toEqual(["vibe"]);
    expect(outcome).toEqual({ kind: "changed", agent: "vibe" });
  });

  it("MODE_CHANGE_REFUSED (mid-turn / pending approval) → busy, agent unchanged", async () => {
    const { api } = apiWith([{ ok: false, error: { code: "MODE_CHANGE_REFUSED", message: "busy" } }]);
    const { outcome, state } = await cycleMode(api, "s", AGENTS, base);
    expect(outcome).toEqual({ kind: "busy" });
    expect(state.current).toBe("chat");
  });

  it("AUTO_APPROVE_FORBIDDEN on a confirmed allow agent records it and skips to the next (audit → chat)", async () => {
    // From audit, confirmed vibe → setMode(vibe) refused → skip to the next
    // non-forbidden agent (chat, wrapping).
    const { api, calls } = apiWith([
      { ok: false, error: { code: "AUTO_APPROVE_FORBIDDEN", message: "no" } },
      { ok: true, value: { from: "audit", to: "chat" } },
    ]);
    const { outcome, state } = await cycleMode(api, "s", AGENTS, { ...base, current: "audit", confirmed: new Set(["vibe"]) });
    expect(calls).toEqual(["vibe", "chat"]);
    expect(outcome).toEqual({ kind: "changed", agent: "chat" });
    expect(state.forbidden.has("vibe")).toBe(true);
  });
});

describe("§3.5/§6 enterAgent", () => {
  it("y → setMode(vibe) ok records the confirmation and current=vibe", async () => {
    const { api, calls } = apiWith([{ ok: true, value: { from: "audit", to: "vibe" } }]);
    const { outcome, state } = await enterAgent(api, "s", AGENTS, "vibe", { ...base, current: "audit" });
    expect(calls).toEqual(["vibe"]);
    expect(outcome).toEqual({ kind: "changed", agent: "vibe" });
    expect(state.confirmed.has("vibe")).toBe(true);
    expect(state.current).toBe("vibe");
  });

  it("AUTO_APPROVE_FORBIDDEN marks the agent forbidden and skips on", async () => {
    const { api } = apiWith([
      { ok: false, error: { code: "AUTO_APPROVE_FORBIDDEN", message: "no" } },
      { ok: true, value: { from: "audit", to: "chat" } },
    ]);
    const { outcome, state } = await enterAgent(api, "s", AGENTS, "vibe", { ...base, current: "audit" });
    expect(outcome).toEqual({ kind: "changed", agent: "chat" });
    expect(state.forbidden.has("vibe")).toBe(true);
  });

  it("MODE_CHANGE_REFUSED → busy", async () => {
    const { api } = apiWith([{ ok: false, error: { code: "MODE_CHANGE_REFUSED", message: "busy" } }]);
    const { outcome } = await enterAgent(api, "s", AGENTS, "vibe", { ...base, current: "audit" });
    expect(outcome).toEqual({ kind: "busy" });
  });
});
