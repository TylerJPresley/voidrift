# VOIDRIFT-UI

Guardrails for working on VoidRift's TUI layer.

## Architecture

- `src/main.tsx` — App component, history state, input handling, streaming display
- `src/ui/panels/` — one file per panel, exported through `src/ui/panels/index.ts` and re-exported via `src/panels.tsx`
- `src/ui/raw-input.tsx` — multiline textarea with cursor management
- `src/ui/markdown.tsx` — Ink-native markdown renderer
- `src/ui/table.tsx` — reusable table component
- `src/ui/scroll-view.tsx` — fixed-height scrollable content

## Rules

- Panels are individual files. One component per file. Register in `panels/index.ts`.
- Never put panel state into `<Static>` items. Static items are immutable after render — they're history.
- `<Static>` is for committed history only (user messages, completed assistant responses, finished tool calls).
- In-progress state (streaming, pending tools, thinking) renders BELOW the Static block.
- `useInput` handlers must check `busy` and `panel` state before acting. Input bleeds otherwise.
- The confirmation dialog blocks ALL other input while active. No exceptions.

## Streaming UX

- Model generates in background with "Thinking..." indicator.
- After turn completes, `StreamingResponse` does a progressive reveal animation.
- Never stream raw chunks to display — causes flashing/jumping.
- Tool calls show spinner during execution, settle to ● on complete.

## Footer

- No padding. No prefix characters. Status bar spans full width.
- Shows: mode, model name, context %, task count (scheduler + worktree locks).
- Context color: green <50%, yellow <80%, red ≥80%.

## Panels Pattern

```tsx
export function MyPanel({ deps, onClose }: Props) {
  useInput((ch, key) => {
    if (key.escape) onClose();
    // ... panel-specific input
  });
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#5a6aa8" paddingX={1}>
      <Text bold>Title</Text>
      {/* content */}
      <Text dimColor>keybinds</Text>
    </Box>
  );
}
```

## Ink Constraints

- No DOM. No CSS. Flexbox only.
- `wrap="wrap"` on Text for long content. `wrap="truncate"` for table cells.
- Terminal resize: listen to `process.stdout.on("resize")` and force re-render.
- Hide cursor on startup (`\x1b[?25l`), restore on exit (`\x1b[?25h`).
