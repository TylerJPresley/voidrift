import { describe, it, expect, vi } from "vitest";
import { directChat } from "../../src/orchestration/graph.js";
import { getPersona, executeNode, type GraphState } from "../../src/orchestration/nodes.js";
import type { StreamChunk } from "../../src/adapters/types.js";

function makeState(overrides?: Partial<GraphState>): GraphState {
  return {
    activePlan: null,
    focusedFiles: [],
    diagnostics: null,
    routingFlag: null,
    messages: [],
    activeMode: "chat",
    activePersona: "",
    ...overrides,
  };
}

function makeMockClient(text: string) {
  const client = {
    stream: vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { content: text };
      },
    }),
    bindTools: vi.fn().mockReturnThis(),
  } as any;
  client.bindTools.mockReturnValue(client);
  return client;
}

describe("Orchestration - Node Personas", () => {
  it("architect persona prohibits writes", () => {
    const persona = getPersona("architect");
    expect(persona).toContain("CANNOT write");
  });

  it("engineer persona executes plan", () => {
    const persona = getPersona("engineer");
    expect(persona).toContain("Execute");
  });

  it("auditor persona verifies", () => {
    const persona = getPersona("auditor");
    expect(persona).toContain("Verify");
  });
});

describe("Orchestration - Direct Chat", () => {
  it("streams a simple response without node transitions", async () => {
    const client = makeMockClient("Hello! How can I help?");
    const chunks: StreamChunk[] = [];

    const result = await directChat({
      userMessage: "hi",
      client,
      systemPrompt: "You are helpful.",
      history: [],
      state: makeState(),
      onChunk: (c) => chunks.push(c),
    });

    expect(result.path).toBe("direct");
    expect(result.response.text).toBe("Hello! How can I help?");
    expect(chunks.some((c) => c.type === "content")).toBe(true);
  });
});

describe("Orchestration - Node Execution", () => {
  it("architect node sets activePlan and transitions to engineer", async () => {
    const client = makeMockClient("Step 1: Create file\nStep 2: Add tests");
    const result = await executeNode("architect", client, [], makeState(), () => {});

    expect(result.stateUpdates.activePlan).toContain("Step 1");
    expect(result.nextNode).toBe("engineer");
  });

  it("architect in plan mode transitions to end", async () => {
    const client = makeMockClient("The plan is ready.");
    const result = await executeNode("architect", client, [], makeState({ activeMode: "plan" }), () => {});

    expect(result.nextNode).toBe("end");
  });

  it("engineer node transitions to auditor", async () => {
    const client = makeMockClient("Done. Edited 'src/main.ts'");
    const result = await executeNode("engineer", client, [], makeState(), () => {});

    expect(result.nextNode).toBe("auditor");
  });

  it("auditor node with pass transitions to end", async () => {
    const client = makeMockClient("All tests pass. Verified successfully.");
    const result = await executeNode("auditor", client, [], makeState(), () => {});

    expect(result.stateUpdates.routingFlag).toBe("pass");
    expect(result.nextNode).toBe("end");
  });

  it("auditor node with rework transitions to engineer", async () => {
    const client = makeMockClient("Test failed with error. Rework needed.");
    const result = await executeNode("auditor", client, [], makeState(), () => {});

    expect(result.stateUpdates.routingFlag).toBe("rework");
    expect(result.nextNode).toBe("engineer");
  });
});
