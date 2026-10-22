/**
 * RollbackConflictDialog (cli-blueprint.md §7.5). The confirmation shown when a
 * restore would overwrite paths changed since the move: `y` overwrites, `n`/`Esc`
 * cancels, and the decision LATCHES (a second key is a no-op). The listed paths
 * are control-sanitized and capped at 10 with a `+N more` line. NO_COLOR-safe.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { RollbackConflictDialog } from "./RollbackConflictDialog.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme } from "../render/theme.js";

const caps = detectCapabilities({ NO_COLOR: "1", LANG: "en_US.UTF-8" });
const theme = resolveTheme(caps);

describe("RollbackConflictDialog (§7.5)", () => {
  it("renders the move, the conflicting paths, and the overwrite prompt; NO ANSI", () => {
    const { lastFrame, unmount } = render(
      <RollbackConflictDialog action="undo" movePointer={3} conflicts={["src/users.ts", "src/pager.ts"]} onResolve={vi.fn()} theme={theme} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Rollback conflict");
    expect(frame).toContain("Undo move 3 would overwrite 2 files changed since this move:");
    expect(frame).toContain("src/users.ts");
    expect(frame).toContain("Overwrite them and continue? [y]es  [n]o");
    expect(frame).not.toMatch(/\x1b\[3\dm/); // NO_COLOR: no color SGR
    unmount();
  });

  it("caps the listed paths at 10 with a +N more line", () => {
    const paths = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`);
    const { lastFrame, unmount } = render(
      <RollbackConflictDialog action="goto" movePointer={2} conflicts={paths} onResolve={vi.fn()} theme={theme} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("src/f9.ts");
    expect(frame).not.toContain("src/f10.ts");
    expect(frame).toContain("+2 more");
    unmount();
  });

  it("strips an escape sequence from a hostile path", () => {
    const { lastFrame, unmount } = render(
      <RollbackConflictDialog action="undo" movePointer={1} conflicts={["src/\x1b[31mevil.ts"]} onResolve={vi.fn()} theme={theme} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("src/[31mevil.ts");
    expect(frame).not.toMatch(/\x1b\[31m/);
    unmount();
  });

  it("'y' resolves overwrite=true exactly once (latch)", () => {
    const onResolve = vi.fn<(overwrite: boolean) => void>();
    const { stdin, unmount } = render(
      <RollbackConflictDialog action="undo" movePointer={3} conflicts={["a.ts"]} onResolve={onResolve} theme={theme} />,
    );
    stdin.write("y");
    stdin.write("y");
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(true);
    unmount();
  });

  it("'n' resolves overwrite=false (cancel)", async () => {
    const onN = vi.fn<(overwrite: boolean) => void>();
    const n = render(<RollbackConflictDialog action="undo" movePointer={3} conflicts={["a.ts"]} onResolve={onN} theme={theme} />);
    n.stdin.write("n");
    await new Promise((r) => setTimeout(r, 10));
    expect(onN).toHaveBeenCalledWith(false);
    n.unmount();
  });

  it("a 'y' then 'n' resolves exactly once — the first decision wins (latch)", () => {
    const onResolve = vi.fn<(overwrite: boolean) => void>();
    const { stdin, unmount } = render(
      <RollbackConflictDialog action="undo" movePointer={3} conflicts={["a.ts"]} onResolve={onResolve} theme={theme} />,
    );
    stdin.write("y");
    stdin.write("n");
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(true);
    unmount();
  });
});
