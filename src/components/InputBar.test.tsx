/**
 * §3.1/§5.2 InputBar footer layout: while a turn runs the `working… (esc to
 * cancel)` status line REPLACES the input row (no `❯` prompt, no placeholder);
 * when idle the input prompt with its dim placeholder is shown.
 */
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { InputBar, type InputBarProps } from "./InputBar.js";
import { detectCapabilities, type Capabilities } from "../terminal.js";
import { resolveTheme } from "../render/theme.js";

const caps: Capabilities = detectCapabilities(
  { COLORTERM: "truecolor", LANG: "en_US.UTF-8" },
  { columns: 80, rows: 24 },
);
const theme = resolveTheme(caps);

function baseProps(over: Partial<InputBarProps>): InputBarProps {
  return {
    value: "",
    cursor: 0,
    active: false,
    turnActive: false,
    pendingCtrlC: false,
    autocompleteOpen: false,
    candidates: [],
    candidateCursor: 0,
    columns: 80,
    theme,
    placeholder: "ask a question or describe a task",
    onKey: () => {},
    ...over,
  };
}

describe("InputBar footer layout", () => {
  it("shows the dim placeholder and the `❯` prompt when idle with an empty buffer", () => {
    const r = render(<InputBar {...baseProps({ turnActive: false })} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("ask a question or describe a task");
    expect(frame).toContain("❯");
    r.unmount();
  });

  it("hides the placeholder AND the `❯` prompt while a turn runs (§3.1)", () => {
    const r = render(<InputBar {...baseProps({ turnActive: true })} />);
    const frame = r.lastFrame()!;
    expect(frame).not.toContain("ask a question or describe a task");
    expect(frame).not.toContain("❯");
    r.unmount();
  });

  it("the `working…` status line REPLACES the input row while a turn runs (§5.2)", () => {
    const r = render(<InputBar {...baseProps({ turnActive: true })} />);
    const lines = r.lastFrame()!.split("\n").filter((l) => l.trim() !== "");
    // Exactly one visible row: the status line, with no `❯` prompt row at all.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("working… (esc to cancel)");
    expect(lines[0]).not.toContain("❯");
    r.unmount();
  });

  it("the ctrl+c hint REPLACES the input row when a first Ctrl+C is pending", () => {
    const r = render(<InputBar {...baseProps({ turnActive: true, pendingCtrlC: true })} />);
    const frame = r.lastFrame()!;
    expect(frame).toContain("press ctrl+c again to exit");
    expect(frame).not.toContain("❯");
    r.unmount();
  });

  it("shows no status line and the prompt returns when idle", () => {
    const r = render(<InputBar {...baseProps({ turnActive: false })} />);
    const frame = r.lastFrame()!;
    expect(frame).not.toContain("working…");
    expect(frame).toContain("❯");
    r.unmount();
  });
});

describe("InputBar autocomplete dropdown (§3.3)", () => {
  const cmd = (name: string, description?: string): { value: string; label: string; description?: string } => ({
    value: `/${name}`,
    label: `/${name}`,
    ...(description ? { description } : {}),
  });

  it("renders the dim rule, the exact hint line, and the brand ❯ on the selected row", () => {
    const r = render(
      <InputBar
        {...baseProps({
          value: "/",
          active: true,
          autocompleteOpen: true,
          candidates: [cmd("help", "Show the command list"), cmd("model", "Switch the model")],
          candidateCursor: 0,
        })}
      />,
    );
    const frame = r.lastFrame()!;
    expect(frame).toContain("─"); // dim rule
    expect(frame).toContain("❯ /help"); // selected row marked with ❯
    expect(frame).toContain("↑↓ navigate  enter select  tab complete  esc close"); // exact hint
    r.unmount();
  });

  it("shows `(+N more)` when more slash candidates match than the 8-row window holds", () => {
    const many = Array.from({ length: 12 }, (_, i) => cmd(`cmd${i}`, `desc ${i}`));
    const r = render(
      <InputBar {...baseProps({ value: "/", active: true, autocompleteOpen: true, candidates: many, candidateCursor: 0 })} />,
    );
    const frame = r.lastFrame()!;
    expect(frame).toContain("(+4 more)"); // 12 − 8-row window = 4
    expect(frame).not.toContain("↓ 4 more"); // the old form is gone
    r.unmount();
  });

  it("truncates an over-long description with `…` to the terminal width (no wrap)", () => {
    const longDesc = "x".repeat(200);
    const r = render(
      <InputBar
        {...baseProps({ value: "/", active: true, autocompleteOpen: true, columns: 40, candidates: [cmd("help", longDesc)], candidateCursor: 0 })}
      />,
    );
    const frame = r.lastFrame()!;
    expect(frame).toContain("…");
    expect(frame).not.toContain(longDesc); // the full description never renders
    // No row wraps: prompt row + rule + one candidate row + hint ≈ 4 lines.
    const lines = frame.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeLessThanOrEqual(4);
    r.unmount();
  });

  it("sanitizes a candidate label/description so control chars never render (§3.3)", () => {
    const r = render(
      <InputBar
        {...baseProps({
          value: "/",
          active: true,
          autocompleteOpen: true,
          candidates: [{ value: "/evil", label: "/evil\u0007", description: "bad\u001b[31mred" }],
          candidateCursor: 0,
        })}
      />,
    );
    const frame = r.lastFrame()!;
    expect(frame).not.toContain("\u0007");
    expect(frame).not.toContain("\u001b[31m");
    r.unmount();
  });
});

describe("InputBar scroll keys (§3.4/§4.10)", () => {
  it("maps Ctrl+U/Ctrl+D to half-page scroll and PageUp/PageDown/End to the paged scroll", async () => {
    const keys: string[] = [];
    const r = render(<InputBar {...baseProps({ active: true, onKey: (k) => keys.push(k.type) })} />);
    // Ctrl+U = half page up, Ctrl+D = half page down (the raw control bytes).
    r.stdin.write("\x15"); // Ctrl+U
    r.stdin.write("\x04"); // Ctrl+D
    r.stdin.write("\x1b[5~"); // PageUp
    r.stdin.write("\x1b[6~"); // PageDown
    r.stdin.write("\x1b[F"); // End
    await new Promise((res) => setTimeout(res, 20));
    expect(keys).toContain("half_page_up");
    expect(keys).toContain("half_page_down");
    expect(keys).toContain("page_up");
    expect(keys).toContain("page_down");
    expect(keys).toContain("scroll_bottom");
    r.unmount();
  });
});
