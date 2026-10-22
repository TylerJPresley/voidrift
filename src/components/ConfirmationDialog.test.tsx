/**
 * CLI ConfirmationDialog latch regression (Slice C3c). The Ink input handler can
 * fire more than once before the parent unmounts the dialog (two quick
 * keypresses, or a key plus a racing resolve). The dialog MUST resolve EXACTLY
 * once — a second keypress after the first decision is a no-op (§9.5).
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConfirmationDialog } from "./ConfirmationDialog.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme, resolveGlyphs } from "../render/theme.js";
import type { PendingApproval, ApprovalResponse } from "@voidrift/core";

const caps = detectCapabilities({ NO_COLOR: "1", LANG: "en_US.UTF-8" });
const theme = resolveTheme(caps);
const glyphs = resolveGlyphs(caps);

const request: PendingApproval = {
  id: "r1",
  tool: "write_file",
  args: { path: "a.txt" },
  choices: ["approve", "edit", "reject"],
  rememberable: true,
  inferredPatterns: ["a.txt"],
} as unknown as PendingApproval;

describe("ConfirmationDialog latch (§9.5)", () => {
  it("two quick 'y' keypresses resolve exactly once", async () => {
    const onResolve = vi.fn<(r: ApprovalResponse) => void>();
    const { stdin, unmount } = render(
      <ConfirmationDialog request={request} onResolve={onResolve} theme={theme} glyphs={glyphs} />,
    );
    stdin.write("y");
    stdin.write("y");
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({ requestId: "r1", decision: "approve" });
    unmount();
  });

  it("an approve then a reject keypress still resolves exactly once (first wins)", async () => {
    const onResolve = vi.fn<(r: ApprovalResponse) => void>();
    const { stdin, unmount } = render(
      <ConfirmationDialog request={request} onResolve={onResolve} theme={theme} glyphs={glyphs} />,
    );
    stdin.write("y");
    stdin.write("n");
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({ requestId: "r1", decision: "approve" });
    unmount();
  });
});

describe("ConfirmationDialog exact-only force-ask (owner D2a)", () => {
  const exactShell: PendingApproval = {
    id: "fa1",
    tool: "execute_command",
    args: { command: "git push --force" },
    choices: ["approve", "reject"],
    rememberable: true,
    exactOnly: true,
    forceAskKind: "shell",
    inferredPatterns: ["git push --force"],
  } as unknown as PendingApproval;

  it("shows the four choices plus the exact-command note and persists an exact rule via 'p'", () => {
    const onResolve = vi.fn<(r: ApprovalResponse) => void>();
    const { lastFrame, stdin, unmount } = render(
      <ConfirmationDialog request={exactShell} onResolve={onResolve} theme={theme} glyphs={glyphs} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[s]ession");
    expect(frame).toContain("[p]roject");
    expect(frame).toContain("Saved as this exact command only.");
    expect(frame).toContain('"exact":true');
    stdin.write("p");
    expect(onResolve).toHaveBeenCalledWith({
      requestId: "fa1",
      decision: "approve",
      remember: "project",
      chosenPattern: "git push --force",
    });
    unmount();
  });

  it("adapts the note wording for a host and a package version", () => {
    const host: PendingApproval = { ...exactShell, id: "fa2", tool: "web_fetch", forceAskKind: "ssrf", inferredPatterns: ["127.0.0.1"] } as unknown as PendingApproval;
    const pkg: PendingApproval = { ...exactShell, id: "fa3", tool: "plugins_install", forceAskKind: "plugin-install", inferredPatterns: ["@v/p@1.0.0"] } as unknown as PendingApproval;
    const a = render(<ConfirmationDialog request={host} onResolve={vi.fn()} theme={theme} glyphs={glyphs} />);
    expect(a.lastFrame()).toContain("Saved for this exact host only.");
    a.unmount();
    const b = render(<ConfirmationDialog request={pkg} onResolve={vi.fn()} theme={theme} glyphs={glyphs} />);
    expect(b.lastFrame()).toContain("Saved for this exact package version only.");
    b.unmount();
  });

  it("adapts the note wording for a control-file lift — FILE for a file tool, COMMAND for a shell tool", () => {
    const fileTool: PendingApproval = {
      ...exactShell,
      id: "cf1",
      tool: "write_file",
      args: { path: "AGENTS.md", content: "x" },
      forceAskKind: "control-file",
      inferredPatterns: ["AGENTS.md"],
    } as unknown as PendingApproval;
    const shellTool: PendingApproval = {
      ...exactShell,
      id: "cf2",
      tool: "execute_command",
      args: { command: "echo x > .git/hooks/pre-commit" },
      forceAskKind: "control-file",
      inferredPatterns: ["echo x > .git/hooks/pre-commit"],
    } as unknown as PendingApproval;
    const a = render(<ConfirmationDialog request={fileTool} onResolve={vi.fn()} theme={theme} glyphs={glyphs} />);
    expect(a.lastFrame()).toContain("Saved for this exact file only.");
    a.unmount();
    const b = render(<ConfirmationDialog request={shellTool} onResolve={vi.fn()} theme={theme} glyphs={glyphs} />);
    expect(b.lastFrame()).toContain("Saved as this exact command only.");
    b.unmount();
  });

  it("a NON-rememberable force-ask shows only y/n and the always-asked note; s/p are inert", () => {
    const notRemember: PendingApproval = {
      id: "fa4",
      tool: "web_fetch",
      args: { url: "http://169.254.169.254/" },
      choices: ["approve", "reject"],
      rememberable: false,
      forceAskKind: "ssrf",
    } as unknown as PendingApproval;
    const onResolve = vi.fn<(r: ApprovalResponse) => void>();
    const { lastFrame, stdin, unmount } = render(
      <ConfirmationDialog request={notRemember} onResolve={onResolve} theme={theme} glyphs={glyphs} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("This kind of action is always asked.");
    expect(frame).not.toContain("[s]ession");
    expect(frame).not.toContain("[p]roject");
    stdin.write("s");
    expect(onResolve).not.toHaveBeenCalled();
    stdin.write("n");
    expect(onResolve).toHaveBeenCalledWith({ requestId: "fa4", decision: "reject" });
    unmount();
  });
});

describe("ConfirmationDialog readability (§6.1)", () => {
  const TEST_PROJECT = "/home/user/project";
  // The screenshot case: a long compound command whose node payload is a
  // ~20-line script, with cd/export/node segments.
  const script = Array.from({ length: 40 }, (_, i) => `step${i}();`).join(" ");
  const command = `cd ${TEST_PROJECT} && export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" && node -e "${script}"`;
  const req = (): PendingApproval =>
    ({
      id: "rb1",
      tool: "execute_command",
      args: { command },
      choices: ["approve", "reject"],
      mode: "interactive",
      rememberable: true,
      inferredPatterns: ["cd *"],
      segments: [
        { text: `cd ${TEST_PROJECT}`, decision: "ok" },
        { text: 'export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"', decision: "ask" },
        { text: `node -e "${script}"`, decision: "ask" },
      ],
    }) as unknown as PendingApproval;

  for (const columns of [60, 100, 200]) {
    it(`at width ${columns}: full command wrapped, patterns short, segments marked, save preview unchanged, no control chars`, () => {
      const onReveal = vi.fn<(t: string) => void>();
      const { lastFrame, unmount } = render(
        <ConfirmationDialog request={req()} onResolve={vi.fn()} theme={theme} glyphs={glyphs} columns={columns} onReveal={onReveal} />,
      );
      const frame = lastFrame() ?? "";
      // The whole command is present (wrapped, not sliced to 60 chars): the
      // start and the node payload tail both appear somewhere in the frame once
      // control chars are ignored.
      expect(frame).toContain(`cd ${TEST_PROJECT}`);
      // The patterns line is short — the single inferred pattern, not the script.
      expect(frame).toContain("patterns:");
      expect(frame).toContain("cd *");
      // Segments listed with ask/ok marks; the asking pieces are marked `ask`.
      expect(frame).toContain("ok ");
      expect(frame).toContain("ask");
      // Save preview is the cd glob rule, unchanged.
      expect(frame).toContain("will save to .voidrift/config.json:");
      expect(frame).toContain("cd *");
      // No raw ESC / control bytes survive sanitization.
      expect(frame).not.toMatch(/[\u0000-\u0008\u001b]/);
      unmount();
    });
  }

  it("caps the value at 12 rows with `… N more lines` and offers [v]iew; v reveals the full text", () => {
    // Force many rows by using a narrow width so the long command wraps past 12.
    const onReveal = vi.fn<(t: string) => void>();
    const { lastFrame, stdin, unmount } = render(
      <ConfirmationDialog request={req()} onResolve={vi.fn()} theme={theme} glyphs={glyphs} columns={40} onReveal={onReveal} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/… \d+ more lines?/);
    expect(frame).toContain("[v]iew full");
    stdin.write("v");
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal.mock.calls[0]![0]).toContain("node -e");
    unmount();
  });

  it("caps the patterns line to three entries", () => {
    const many: PendingApproval = {
      ...req(),
      inferredPatterns: ["a *", "a b *", "a b c", "node -e *", "x"],
    } as unknown as PendingApproval;
    const { lastFrame, unmount } = render(
      <ConfirmationDialog request={many} onResolve={vi.fn()} theme={theme} glyphs={glyphs} columns={100} onReveal={vi.fn()} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("a *");
    expect(frame).toContain("a b *");
    expect(frame).toContain("a b c");
    expect(frame).not.toContain("node -e *"); // the 4th pattern is dropped
    unmount();
  });

  it("adds a `covers` note when the first pattern covers a non-asking segment", () => {
    const { lastFrame, unmount } = render(
      <ConfirmationDialog request={req()} onResolve={vi.fn()} theme={theme} glyphs={glyphs} columns={100} onReveal={vi.fn()} />,
    );
    // inferredPatterns[0] is `cd *` (the ok segment); the asking segments are
    // export/node, so the note names `cd`.
    expect(lastFrame() ?? "").toContain("covers `cd` only");
    unmount();
  });
});

describe("ConfirmationDialog auto-deny countdown (§9.5)", () => {
  const req: PendingApproval = {
    id: "ad1",
    tool: "execute_command",
    args: { command: "rm -rf build" },
    choices: ["approve", "reject"],
    mode: "interactive",
  } as unknown as PendingApproval;

  it("shows `auto-deny in Ns` and resolves as reject when the countdown expires", () => {
    vi.useFakeTimers();
    try {
      const onResolve = vi.fn<(r: ApprovalResponse) => void>();
      const { lastFrame, unmount } = render(
        <ConfirmationDialog request={req} onResolve={onResolve} theme={theme} glyphs={glyphs} autoDenySeconds={3} />,
      );
      expect(lastFrame() ?? "").toContain("auto-deny in 3s");
      // Expire: three 1s ticks resolve as reject (deny-and-continue).
      vi.advanceTimersByTime(3000);
      expect(onResolve).toHaveBeenCalledTimes(1);
      expect(onResolve).toHaveBeenCalledWith({ requestId: "ad1", decision: "reject" });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a human keypress before expiry wins; the later auto-deny is a no-op (latch)", () => {
    vi.useFakeTimers();
    try {
      const onResolve = vi.fn<(r: ApprovalResponse) => void>();
      const { stdin, unmount } = render(
        <ConfirmationDialog request={req} onResolve={onResolve} theme={theme} glyphs={glyphs} autoDenySeconds={2} />,
      );
      stdin.write("y");
      expect(onResolve).toHaveBeenCalledWith({ requestId: "ad1", decision: "approve" });
      vi.advanceTimersByTime(5000);
      expect(onResolve).toHaveBeenCalledTimes(1); // the expiry does not fire a second time
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("no countdown line when autoDenySeconds is 0 or absent", () => {
    const a = render(<ConfirmationDialog request={req} onResolve={vi.fn()} theme={theme} glyphs={glyphs} autoDenySeconds={0} />);
    expect(a.lastFrame() ?? "").not.toContain("auto-deny in");
    a.unmount();
    const b = render(<ConfirmationDialog request={req} onResolve={vi.fn()} theme={theme} glyphs={glyphs} />);
    expect(b.lastFrame() ?? "").not.toContain("auto-deny in");
    b.unmount();
  });
});
