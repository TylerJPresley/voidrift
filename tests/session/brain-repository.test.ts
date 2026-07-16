import { describe, it, expect } from "vitest";
import { SessionBrain } from "../../src/session/brain.js";
import { InMemorySessionRepository } from "../../src/session/session-repository.js";
import { EventBus } from "../../src/events/bus.js";
import type { SessionContext } from "../../src/session/context.js";

describe("SessionBrain (in-memory)", () => {
  function mockContext(): SessionContext {
    return {
      agent: { activePersona: "Test persona", activeTools: ["read_file", "write_file"], boundSkills: [], skillDiscoveryIndex: [], activeMemoryIndex: [] },
      orbit: { workspaceCodeMap: "", activePlan: "## Plan\n- [ ] Do stuff", activeMemory: ["mem1"], activeSkills: ["skill1"] },
      drift: { focusedFiles: [{ path: "src/main.ts", summary: "Entry point", totalLines: 100, readRanges: [[0, 50]] }], gitStatus: "M src/main.ts" },
      void: { messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }], fullHistory: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }], diagnostics: null, turnContext: [] },
    };
  }

  function create() {
    const repo = new InMemorySessionRepository();
    const bus = new EventBus();
    const brain = new SessionBrain("/fake/workspace", "test-session", bus, repo);
    return { brain, bus, repo };
  }

  it("saves session state", () => {
    const { brain, repo } = create();
    brain.save(mockContext(), "chat");
    expect(repo.exists("test-session")).toBe(true);
    const meta = repo.readJson("test-session", "system.metadata.json");
    expect(meta.sessionId).toBe("test-session");
  });

  it("saves messages", () => {
    const { brain, repo } = create();
    brain.save(mockContext(), "chat");
    const messages = repo.readJson("test-session", "work.messages.json");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
  });

  it("saves plan", () => {
    const { brain, repo } = create();
    brain.save(mockContext(), "chat");
    const plan = repo.readText("test-session", "workspace.plan.md");
    expect(plan).toContain("Do stuff");
  });

  it("saves persona", () => {
    const { brain, repo } = create();
    brain.save(mockContext(), "chat");
    const persona = repo.readText("test-session", "governance.persona.md");
    expect(persona).toBe("Test persona");
  });

  it("load recovers saved state", () => {
    const { brain } = create();
    brain.save(mockContext(), "chat");
    const loaded = brain.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.context.void!.messages).toHaveLength(2);
    expect(loaded!.context.orbit!.activePlan).toContain("Do stuff");
    expect(loaded!.context.agent!.activePersona).toBe("Test persona");
    expect(loaded!.context.agent!.activeTools).toContain("read_file");
  });

  it("load returns null for nonexistent session", () => {
    const repo = new InMemorySessionRepository();
    const bus = new EventBus();
    const brain = new SessionBrain("/fake", "ghost", bus, repo);
    expect(brain.load()).toBeNull();
  });

  it("loadSession switches to a different session", () => {
    const repo = new InMemorySessionRepository();
    const bus = new EventBus();

    // Save first session
    const brain1 = new SessionBrain("/fake", "session-1", bus, repo);
    brain1.save(mockContext(), "chat");

    // Create second brain, load first session
    const brain2 = new SessionBrain("/fake", "session-2", bus, repo);
    const ctx = { setMessages: (m: any[]) => {}, setPlan: (p: any) => {}, setDiagnostics: (d: any) => {} };
    let msgs: any[] = [];
    ctx.setMessages = (m) => { msgs = m; };
    const success = brain2.loadSession("session-1", ctx);
    expect(success).toBe(true);
    expect(msgs).toHaveLength(2);
  });

  it("listSessions returns saved sessions", () => {
    const repo = new InMemorySessionRepository();
    const bus = new EventBus();
    const b1 = new SessionBrain("/fake", "s1", bus, repo);
    b1.save(mockContext(), "chat");
    const b2 = new SessionBrain("/fake", "s2", bus, repo);
    b2.save(mockContext(), "plan");

    const sessions = b1.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("attach auto-saves on TURN_COMPLETE", () => {
    const { brain, bus, repo } = create();
    const ctx = mockContext();
    brain.attach(() => ctx, () => "chat");
    bus.publish("TURN_COMPLETE", { turnId: "t1" });

    // Wait for async subscriber
    setTimeout(() => {
      expect(repo.exists("test-session")).toBe(true);
      expect(brain.turn).toBe(1);
    }, 10);
  });
});
