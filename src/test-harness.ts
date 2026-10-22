/**
 * The scripted-core test harness (cli-blueprint.md §11.1).
 *
 * Every CLI integration test runs against a real `createCore` driven by a
 * `fakeModel` with the in-memory session storage and config store the core
 * constructs by default — deterministic and offline, no filesystem, no real
 * TTY, no stdin. The harness also exposes an `emit` seam that registers and
 * emits a core event with a session scope, so a test can drive the outward
 * event stream (`TOKEN_STREAM`, `REASONING_STREAM`, `TOOL_STARTED`/
 * `TOOL_FINISHED`, `CONTEXT_*`, `MODEL_*`, `WORKER_STATUS_CHANGED`,
 * `BRANCH_CHANGED`, `HOUSEKEEPING_NOTICE`, …) exactly as the core would. This
 * uses the same public `createCore` seams the core's own suite uses
 * (facade.section2.test.ts).
 */
import { fakeModel } from "@langchain/core/testing";
import { AIMessage } from "@langchain/core/messages";
import type { ApprovalHandler, Config, CoreReady } from "@voidrift/core";
import { createCore, InMemorySessionRepository } from "@voidrift/core";
import { hermeticTmp } from "./test-hermetic.js";

const DEFAULT_SEED: Partial<Config> = {
  models: { test: { model: "test-model", protocol: "openai", contextLimit: 32_000 } },
  modelSelected: "test",
};

export interface HarnessOptions {
  /** The scripted assistant reply the fake model returns (one turn). */
  reply?: string;
  /** Config overrides composed above the session layer (the test seed). */
  seed?: Partial<Config>;
  /** An interactive approval handler, for the approval tests. */
  onApproval?: ApprovalHandler;
  /** The output sink (defaults to a no-op). */
  output?: (text: string) => void;
  /** The openPanel sink (defaults to a no-op). */
  openPanel?: (name: string) => void;
  /** Register the standard seeded top-level agents (research=deny, vibe=allow)
   * programmatically so headless agent selection is deterministic without
   * relying on the on-disk seed. Default true. */
  seedAgents?: boolean;
}

export interface Harness {
  ready: CoreReady;
  /** Register and emit a core/plugin event with an optional session scope. */
  emit: (type: string, payload: unknown, sessionId?: string) => void;
}

/**
 * Build a scripted core for a CLI integration test. The production default
 * session repository is now the durable filesystem store (boot.ts, §5.1), so an
 * offline, filesystem-free, order-independent test injects the in-memory
 * repository seam explicitly — the same discipline the core's own suite uses.
 */
export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const reply = opts.reply ?? "ok";
  const factory = (): ReturnType<typeof fakeModel> => fakeModel().respond(new AIMessage(reply));
  const ready = await createCore({
    workspaceRoot: hermeticTmp("cli"),
    configOverrides: { ...DEFAULT_SEED, ...(opts.seed ?? {}) },
    chatModelFactory: factory,
    sessionRepository: new InMemorySessionRepository(),
    installSignalHandlers: false,
    ...(opts.onApproval ? { onApproval: opts.onApproval } : {}),
    ...(opts.output ? { output: opts.output } : {}),
    ...(opts.openPanel ? { openPanel: opts.openPanel } : {}),
  });
  const emit = (type: string, payload: unknown, sessionId?: string): void => {
    ready.api.events.register(type);
    ready.api.events.emit(type, payload, sessionId ? { session: sessionId } : {});
  };
  // Register the standard seeded top-level agents so Shift+Tab cycling and
  // headless agent selection are deterministic (research=deny, vibe=allow).
  if (opts.seedAgents !== false) {
    await ready.api.agents.create({ name: "research", description: "read-only research", kind: "top-level", systemPrompt: "research", tools: ["read_file", "glob_files", "search_contents", "web_fetch", "web_search", "task"], workers: "all", unlisted: "deny", order: 20, label: "Research" });
    await ready.api.agents.create({ name: "vibe", description: "fan-out, auto-approve", kind: "top-level", systemPrompt: "vibe", tools: ["*"], workers: "all", unlisted: "allow", confirm: true, order: 30, label: "Vibe" });
  }
  return { ready, emit };
}
