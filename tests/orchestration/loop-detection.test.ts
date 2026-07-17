import { describe, it, expect } from "vitest";
import { createLoopDetection, recordAndCheck } from "../../src/orchestration/loop-detection.js";

describe("Loop Detection", () => {
  it("creates fresh state with default thresholds", () => {
    const state = createLoopDetection();
    expect(state.consecutiveErrors).toBe(0);
    expect(state.maxConsecutiveErrors).toBe(3);
    expect(state.maxToolFailures).toBe(4);
    expect(state.fingerprintWindow).toBe(20);
    expect(state.fingerprintThreshold).toBe(3);
  });

  it("blocks after 3 consecutive errors", () => {
    const state = createLoopDetection();
    recordAndCheck(state, "write_file", '{"path":"a.ts"}', true);
    recordAndCheck(state, "edit_file", '{"path":"b.ts"}', true);
    const result = recordAndCheck(state, "execute_command", '{"command":"npm test"}', true);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("LOOP DETECTED");
  });

  it("resets consecutive errors on success", () => {
    const state = createLoopDetection();
    recordAndCheck(state, "write_file", '{"path":"a.ts"}', true);
    recordAndCheck(state, "write_file", '{"path":"b.ts"}', true);
    recordAndCheck(state, "read_file", '{"path":"c.ts"}', false); // success
    const result = recordAndCheck(state, "write_file", '{"path":"d.ts"}', true);
    expect(result.blocked).toBe(false); // only 1 consecutive error now
  });

  it("blocks after 4 failures of the same tool", () => {
    const state = createLoopDetection();
    recordAndCheck(state, "edit_file", '{"path":"a.ts"}', true);
    recordAndCheck(state, "read_file", '{"path":"x.ts"}', false); // reset consecutive
    recordAndCheck(state, "edit_file", '{"path":"b.ts"}', true);
    recordAndCheck(state, "read_file", '{"path":"y.ts"}', false); // reset consecutive
    recordAndCheck(state, "edit_file", '{"path":"c.ts"}', true);
    recordAndCheck(state, "read_file", '{"path":"z.ts"}', false); // reset consecutive
    const result = recordAndCheck(state, "edit_file", '{"path":"d.ts"}', true);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("edit_file");
  });

  it("blocks on fingerprint doom-loop (identical args 3x in window)", () => {
    const state = createLoopDetection();
    recordAndCheck(state, "read_file", '{"path":"same.ts"}', false);
    recordAndCheck(state, "read_file", '{"path":"same.ts"}', false);
    const result = recordAndCheck(state, "read_file", '{"path":"same.ts"}', false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("DOOM LOOP");
  });

  it("does not doom-loop if args differ", () => {
    const state = createLoopDetection();
    recordAndCheck(state, "read_file", '{"path":"a.ts"}', false);
    recordAndCheck(state, "read_file", '{"path":"b.ts"}', false);
    const result = recordAndCheck(state, "read_file", '{"path":"c.ts"}', false);
    expect(result.blocked).toBe(false);
  });

  it("fingerprint window slides (old entries drop off)", () => {
    const state = createLoopDetection();
    state.fingerprintWindow = 5;
    // Fill window with unique calls
    for (let i = 0; i < 5; i++) {
      recordAndCheck(state, "read_file", `{"path":"file${i}.ts"}`, false);
    }
    // Now add same call twice — window slid, no old match
    recordAndCheck(state, "write_file", '{"path":"target.ts"}', false);
    recordAndCheck(state, "write_file", '{"path":"target.ts"}', false);
    const result = recordAndCheck(state, "write_file", '{"path":"target.ts"}', false);
    // Window is 5 and we have 3 identical in the last 3 — should trigger
    expect(result.blocked).toBe(true);
  });
});
