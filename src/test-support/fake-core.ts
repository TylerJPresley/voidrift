/**
 * Test helper: a fully-typed fake CoreAPI with sensible defaults.
 * Each test overrides only the members it needs; the helper provides all required fields.
 * This ensures type safety without `any` or casts.
 */

import { type CoreAPI, type Result, type TurnResult } from "@voidrift/core";

const notImplemented = async (): Promise<never> => {
  throw new Error("fakeCoreAPI: method not implemented");
};

const notImplementedSync = (): never => {
  throw new Error("fakeCoreAPI: method not implemented");
};

const stubTurnResult = (): Promise<Result<TurnResult>> =>
  Promise.resolve({
    ok: true as const,
    value: {
      status: "completed",
      text: "",
      toolsUsed: [],
      model: "test",
      usage: { promptTokens: 0, completionTokens: 0, totalMs: 0 },
    },
  });

/**
 * Creates a minimal CoreAPI implementation with realistic defaults.
 * Override specific members in the returned object for your test needs.
 * This is strictly for testing; it does not implement the full CoreAPI contract.
 */
export function fakeCoreAPI(): CoreAPI {
  // Build a minimal CoreAPI test stub. Unimplemented members throw by design.
  const stub: Record<string, unknown> = {
    deps: { dispose: notImplementedSync },
    live: { has: notImplementedSync, get: notImplementedSync },
    launchAgentOverride: undefined,
    launchApprovalOverride: undefined,

    session: {
      send: stubTurnResult,
      confirm: stubTurnResult,
      cancel: notImplemented,
      create: async () =>
        Promise.resolve({
          ok: true as const,
          value: {
            id: "test-sid",
            name: "test",
            summary: "",
            lastActiveAt: new Date().toISOString(),
            sizeBytes: 0,
            workspace: "",
          },
        }),
      resume: notImplemented,
      list: async () => [],
      delete: notImplemented,
      rename: notImplemented,
      clear: notImplemented,
      setMode: notImplemented,
      command: notImplemented,
      listCommands: async () => ({ ok: true as const, value: [] }),
      housekeeping: async () =>
        Promise.resolve({ ok: true as const, value: { idleSessions: 0, idleDays: 0 } }),
      compact: notImplemented,
      loadMessages: notImplemented,
      export: notImplemented,
      setLaunchDefaults: notImplementedSync,
      runInNewSession: notImplemented,
      journal: {
        list: async () => [],
        blob: async () => null,
      },
      rollback: {
        moves: async () => ({ ok: true as const, value: [] }),
        undo: notImplemented,
        redo: notImplemented,
        goto: notImplemented,
      },
      moves: notImplemented,
      undo: notImplemented,
      redo: notImplemented,
      goto: notImplemented,
    },

    models: {
      list: async () => ({ ok: true as const, value: [] }),
      switch: notImplemented,
      stats: notImplemented,
      context: notImplemented,
    },

    config: {
      get: notImplemented,
      set: notImplemented,
      validate: async () => ({ ok: true as const, value: { valid: true, errors: [] } }),
      recover: notImplemented,
      paths: async () =>
        Promise.resolve({
          ok: true as const,
          value: {
            project: { path: "", exists: false },
            global: { path: "", exists: false },
            builtin: { path: "", exists: false },
            managed: { path: "", exists: false },
            session: { path: "", exists: false },
          },
        }),
      limits: async () => ({ ok: true as const, value: { limits: [], warnings: [] } }),
      rejections: async () => ({ ok: true as const, value: [] }),
      warnings: async () => ({ ok: true as const, value: [] }),
      neverList: async () => ({ ok: true as const, value: [] }),
      init: notImplemented,
      access: notImplemented,
    },

    workspace: {
      files: async () => ({ ok: true as const, value: [] }),
      root: async () => ({ ok: true as const, value: "" }),
      map: notImplemented,
      branch: async () => ({ ok: true as const, value: null }),
      diff: notImplemented,
      inject: async () => ({ ok: true as const, value: undefined }),
    },

    permissions: {
      rules: notImplemented,
      approvals: async () => notImplemented(),
      resolve: async () => notImplemented(),
      revoke: notImplemented,
    },

    compliance: {
      status: notImplemented,
      policies: notImplemented,
      decisions: notImplemented,
    },

    events: {
      register: notImplementedSync,
      subscribe: notImplementedSync,
      emit: notImplementedSync,
    },

    register: {
      skill: notImplementedSync,
      agent: notImplementedSync,
      tool: notImplementedSync,
      guardrail: notImplementedSync,
      command: notImplementedSync,
      prompt: notImplementedSync,
      overridePrompt: notImplementedSync,
      extendPrompt: notImplementedSync,
      contextProvider: notImplementedSync,
      panel: notImplementedSync,
      dataset: notImplementedSync,
      modelProvider: notImplementedSync,
      memoryProvider: notImplementedSync,
      planScope: notImplementedSync,
      clearPlanScope: notImplementedSync,
      exporter: notImplementedSync,
      chunker: notImplementedSync,
    },

    contextProviderBlocks: notImplementedSync,
    chunkers: notImplementedSync,

    registry: {
      set: notImplementedSync,
      get: notImplementedSync,
      query: notImplementedSync,
      remove: notImplementedSync,
      panels: notImplementedSync,
    },

    datasets: {
      list: async () => ({ ok: true as const, value: [] }),
      rows: async () => notImplemented(),
    },

    expectations: {
      create: notImplemented,
      update: notImplemented,
      list: notImplemented,
      delete: notImplemented,
      describe: notImplemented,
    },

    dispatchForEngine: notImplemented,

    subagents: {
      dispatch: notImplemented,
      list: async () => notImplemented(),
      status: async () => notImplemented(),
      stream: async () => notImplemented(),
      cancel: notImplemented,
      recoverStaging: async () => notImplemented(),
    },

    memory: {
      list: async () => notImplemented(),
      read: async () => notImplemented(),
      edit: async () => notImplemented(),
      delete: async () => notImplemented(),
      recall: async () => notImplemented(),
      suggestions: {
        list: async () => notImplemented(),
        approve: async () => notImplemented(),
        reject: async () => notImplemented(),
      },
    },

    agents: {
      list: async () => ({ ok: true as const, value: [] }),
      get: async () => notImplemented(),
      activate: notImplemented,
      deactivate: async () => notImplemented(),
      create: async () => notImplemented(),
      reindex: async () => notImplemented(),
      tools: async () => notImplemented(),
    },

    skills: {
      list: async () => ({ ok: true as const, value: [] }),
      get: async () => notImplemented(),
    },

    prompts: {
      list: async () => ({ ok: true as const, value: [] }),
      get: async () => notImplemented(),
      activate: notImplemented,
    },

    activeSessionId: notImplementedSync,
    activeTurnInput: notImplementedSync,
    activeFocusPaths: notImplementedSync,
  };

  // Return cast to CoreAPI. Each test overrides the members it needs.
  // All unimplemented members throw by design when called.
  return stub as unknown as CoreAPI;
}
