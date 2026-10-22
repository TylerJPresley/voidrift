/**
 * §6.4 batched fan-out prompt and agent monitor (cli-blueprint.md §6.2, §6.3).
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { PendingApproval } from "@voidrift/core";
import { FanoutApproval } from "./FanoutApproval.js";
import { AgentMonitor } from "./AgentMonitor.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, resolveGlyphs } from "../render/theme.js";

const caps = detectCapabilities({ LANG: "en_US.UTF-8" }, { columns: 100, rows: 40 });
const theme = resolveTheme(caps);
const glyphs = resolveGlyphs(caps);

const pending: PendingApproval[] = [
  { id: "w1", tool: "write_file", args: { path: "a.ts" }, choices: ["approve", "reject"], mode: "interactive", workerId: "api-worker" },
  { id: "w2", tool: "run_tests", args: { suite: "unit" }, choices: ["approve", "reject"], mode: "interactive", workerId: "db-worker" },
];

describe("§6.2 FanoutApproval", () => {
  it("lists each worker action in full and maps a/f/c/x to the four choices", async () => {
    for (const [key, expected] of [
      ["a", "approve_all"],
      ["f", "approve_all_and_grant"],
      ["c", "review_individually"],
      ["x", "cancel"],
    ] as const) {
      const onChoice = vi.fn();
      const r = render(<FanoutApproval pending={pending} onChoice={onChoice} theme={theme} glyphs={glyphs} />);
      const frame = r.lastFrame()!;
      // §6.2 — the spec header and the four labelled keys (the label line may
      // wrap at the border; assert the stable key fragments).
      expect(frame).toContain("2 tool approvals pending");
      expect(frame).toContain("[a] approve all");
      expect(frame).toContain("[f] approve all + grant");
      expect(frame).toContain("[c] configure individually");
      expect(frame).toContain("[x] exit");
      expect(frame).toContain("write_file");
      expect(frame).toContain("run_tests");
      r.stdin.write(key);
      await new Promise((res) => setTimeout(res, 10));
      expect(onChoice).toHaveBeenCalledWith(expected);
      r.unmount();
    }
  });

  it("shows the auto-deny countdown and cancels the batch at expiry (§9.5)", () => {
    vi.useFakeTimers();
    try {
      const onChoice = vi.fn();
      const r = render(<FanoutApproval pending={pending} onChoice={onChoice} theme={theme} glyphs={glyphs} autoDenySeconds={2} />);
      expect(r.lastFrame() ?? "").toContain("auto-deny in 2s");
      vi.advanceTimersByTime(2000);
      expect(onChoice).toHaveBeenCalledTimes(1);
      expect(onChoice).toHaveBeenCalledWith("cancel");
      r.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("§6.3 AgentMonitor", () => {
  it("numbers workers 1..N, shows a permission banner, and resolves on Enter", async () => {
    const onResolve = vi.fn();
    const workers = [
      { workerId: "api-worker", status: "running", tool: "write_file" },
      { workerId: "db-worker", status: "needs_review", tool: "run_tests" },
    ];
    const r = render(
      <AgentMonitor
        workers={workers}
        selected={1}
        streamLines={[{ workerId: "db-worker", text: "working…" }]}
        onSelect={() => undefined}
        onResolve={onResolve}
        onClose={() => undefined}
        theme={theme}
        glyphs={glyphs}
      />,
    );
    const frame = r.lastFrame()!;
    expect(frame).toContain("1 ");
    expect(frame).toContain("api-worker");
    expect(frame).toContain("needs permission");
    expect(frame).toContain("working…");
    r.stdin.write("\r"); // Enter resolves the selected (needs_review) worker
    await new Promise((res) => setTimeout(res, 10));
    expect(onResolve).toHaveBeenCalledWith("db-worker");
    r.unmount();
  });

  it("a number key selects a worker and Escape closes", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const workers = [
      { workerId: "a", status: "running" },
      { workerId: "b", status: "running" },
    ];
    const r = render(
      <AgentMonitor
        workers={workers}
        selected={0}
        streamLines={[]}
        onSelect={onSelect}
        onResolve={() => undefined}
        onClose={onClose}
        theme={theme}
        glyphs={glyphs}
      />,
    );
    r.stdin.write("2");
    await new Promise((res) => setTimeout(res, 10));
    expect(onSelect).toHaveBeenCalledWith(1);
    r.stdin.write("\u001b");
    await new Promise((res) => setTimeout(res, 40));
    expect(onClose).toHaveBeenCalled();
    r.unmount();
  });
});
