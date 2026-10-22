/**
 * ConfirmModeDialog provenance (S4 LOW — provenance at the single autonomy
 * gate). The FIRST-entry confirmation into a `confirm: true` top-level agent
 * must name WHERE the agent was defined (`defined by <source>: <file>`) so a
 * cloned-repo `.voidrift/agents/vibe` (or an override of `chat`/`research`) is
 * never silently trusted. The path is sanitized before it is shown.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConfirmModeDialog } from "./ConfirmModeDialog.js";
import { detectCapabilities } from "../terminal.js";
import { resolveTheme } from "../render/theme.js";
import type { TopAgent } from "../mode.js";

const caps = detectCapabilities({ NO_COLOR: "1", LANG: "en_US.UTF-8" });
const theme = resolveTheme(caps);

describe("ConfirmModeDialog provenance (S4)", () => {
  it("shows 'defined by <source>: <file>' for a project agent", () => {
    const vibe: TopAgent = {
      name: "vibe",
      unlisted: "allow",
      confirm: true,
      source: "project",
      file: "/repo/.voidrift/agents/vibe/agent.json",
    };
    const { lastFrame, unmount } = render(<ConfirmModeDialog agent={vibe} onResolve={vi.fn()} theme={theme} />);
    expect(lastFrame()).toContain("defined by project: /repo/.voidrift/agents/vibe/agent.json");
    unmount();
  });

  it("shows source alone when there is no file", () => {
    const sess: TopAgent = { name: "vibe", unlisted: "allow", confirm: true, source: "session" };
    const { lastFrame, unmount } = render(<ConfirmModeDialog agent={sess} onResolve={vi.fn()} theme={theme} />);
    expect(lastFrame()).toContain("defined by session");
    unmount();
  });

  it("omits the provenance line when the source is unknown", () => {
    const unknown: TopAgent = { name: "vibe", unlisted: "allow", confirm: true };
    const { lastFrame, unmount } = render(<ConfirmModeDialog agent={unknown} onResolve={vi.fn()} theme={theme} />);
    expect(lastFrame()).not.toContain("defined by");
    unmount();
  });

  it("strips an escape sequence from the shown path", () => {
    const hostile: TopAgent = {
      name: "vibe",
      unlisted: "allow",
      confirm: true,
      source: "project",
      file: "/repo/\x1b[31mevil/agent.json",
    };
    const { lastFrame, unmount } = render(<ConfirmModeDialog agent={hostile} onResolve={vi.fn()} theme={theme} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("defined by project: /repo/[31mevil/agent.json");
    expect(frame).not.toMatch(/\x1b\[31m/);
    unmount();
  });
});
