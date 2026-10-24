import React from "react";
import { Box, Static, Text } from "ink";
import type { Capabilities } from "../terminal.js";
import type { ThemeTokens, Glyphs } from "../render/theme.js";
import { sanitize, wrapPrefixed, displayWidth } from "../render/theme.js";
import type { Block, ViewState } from "../state.js";
import { blockLines, blockLineCount } from "../state.js";
import { Markdown } from "./Markdown.js";
import { Welcome, ResumeLine } from "./Footer.js";
import { ScrollView } from "./ScrollView.js";
import { ToolGroup, ReasoningView, ThoughtLine, StatusLine, FanoutGroup, LiveFanout } from "./ToolGroup.js";

/** The dim turn-footer line beneath a committed assistant block (§4.2). */
function FooterLine({
  block,
  theme,
  glyphs,
}: {
  block: Extract<Block, { kind: "assistant" }>;
  theme: ThemeTokens;
  glyphs: Glyphs;
}): React.ReactElement | null {
  if (block.cancelled) {
    return (
      <Text {...(theme.dim ? { color: theme.dim } : {})}>
        {"  "}
        {glyphs.cancelled} cancelled
      </Text>
    );
  }
  // Hidden for a tool-only turn or a zero completion count (§4.2).
  if (block.completionTokens <= 0) return null;
  const cache = block.cacheReadTokens > 0 ? ` » ${block.cacheReadTokens}` : "";
  // §4.2 — a figure the core marked estimated prints with a leading `~`
  // (`↑ ~7204`, `↓ ~24`); a provider-reported figure prints bare.
  const mark = block.estimated ? "~" : "";
  // §4.2 — `$cost` is appended only when the active model carries a configured
  // price (the reducer derived `cost`); omitted entirely otherwise.
  const cost = block.cost !== undefined ? ` · $${block.cost.toFixed(4)}` : "";
  // A sub-0.1s turn can't produce a meaningful tok/s rate; show `<0.1s` and drop
  // the tok/s segment rather than a misleading `0 tok/s · 0s` (§4.2). Otherwise
  // `tok/s` (generation speed) is shown only when measured (the turn streamed);
  // an unstreamed turn drops the segment and shows elapsed alone (§4.2, §10.7).
  const tiny = block.seconds < 0.1;
  const tail = tiny
    ? " · <0.1s"
    : block.tokensPerSecond !== undefined
      ? ` · ${block.tokensPerSecond} tok/s · ${block.seconds}s`
      : ` · ${block.seconds}s`;
  return (
    <Text {...(theme.dim ? { color: theme.dim } : {})}>
      {"  "}· ↑ {mark}
      {block.promptTokens}
      {cache} · ↓ {mark}
      {block.completionTokens}
      {tail}
      {cost}
    </Text>
  );
}

function BlockView({
  block,
  theme,
  glyphs,
  caps,
  workspaceRoot,
  showToolDetails,
  columns,
}: {
  block: Block;
  theme: ThemeTokens;
  glyphs: Glyphs;
  caps: Capabilities;
  workspaceRoot?: string | undefined;
  showToolDetails?: boolean | undefined;
  columns?: number | undefined;
}): React.ReactElement {
  switch (block.kind) {
    case "welcome":
      return (
        <Welcome
          version={block.info.version}
          workspaceRoot={block.info.workspaceRoot}
          sessionId={block.info.sessionId}
          branch={block.info.branch}
          showTips={block.info.showTips}
          columns={block.info.columns}
          theme={theme}
          glyphs={glyphs}
        />
      );
    case "resume":
      return (
        <ResumeLine
          {...(block.summary ? { summary: block.summary } : {})}
          {...(block.pendingCount ? { pendingCount: block.pendingCount } : {})}
          {...(block.staleDocuments ? { staleDocuments: block.staleDocuments } : {})}
          theme={theme}
          glyphs={glyphs}
        />
      );
    case "user": {
      // The user echo: a brand `┃ ` bar, the text bold, no role word (§4.1).
      // Wrap within the content width with a hanging indent of the bar width on
      // every continuation line — never an orphan single character and never a
      // mid-row overflow (§4.1). The `┃ ` bar is the 2-column left marker, so
      // the whole row fits `columns - 2` (a 2-column right padding). `columns`
      // falls back to a wide default when the terminal width is unknown.
      const indent = displayWidth(`${glyphs.userBar} `);
      const lines = wrapPrefixed(sanitize(block.text), (columns ?? 80) - 2, indent);
      return (
        <Box flexDirection="column">
          {lines.map((line, i) => (
            <Box key={i}>
              <Text {...(theme.brand ? { color: theme.brand } : {})}>
                {i === 0 ? `${glyphs.userBar} ` : " ".repeat(indent)}
              </Text>
              <Text bold>{line}</Text>
            </Box>
          ))}
        </Box>
      );
    }
    case "assistant":
      // The committed reply renders flush at a two-space margin (no left rule,
      // no gutter bar), markdown-rendered, led by a dim `Thought for Ns` line
      // when reasoning arrived (§4.1, §4.6). Consecutive assistant messages in a
      // turn are separated by one blank row (the Static item margin). The turn
      // footer line sits beneath.
      return (
        <Box flexDirection="column">
          {block.thoughtMs && block.thoughtMs > 0 ? <ThoughtLine thoughtMs={block.thoughtMs} theme={theme} /> : null}
          <Box flexDirection="column" paddingLeft={2}>
            <Markdown
              source={block.text}
              theme={theme}
              caps={caps}
              workspaceRoot={workspaceRoot}
              columns={columns}
            />
          </Box>
          <FooterLine block={block} theme={theme} glyphs={glyphs} />
        </Box>
      );
    case "toolgroup":
      // A committed tool group is expanded until its turn completes, then
      // auto-collapses (§4.4); an errored group stays expanded. `Ctrl+T`
      // governs the live running group (dynamic region).
      return (
        <Box paddingLeft={1}>
          <ToolGroup
            block={block}
            glyphs={glyphs}
            theme={theme}
            showDetails={showToolDetails}
            expanded={!block.collapsed}
            columns={columns ?? 80}
          />
        </Box>
      );
    case "fanout":
      // §4.4 — a committed fan-out orchestration: the indented `▾/▸ Orchestrated
      // N agents` list, one row per worker, auto-collapsed on turn end unless a
      // failed row holds it expanded. This replaced the single live view in one
      // commit at the batch's completion.
      return (
        <Box paddingLeft={1}>
          <FanoutGroup block={block} glyphs={glyphs} theme={theme} columns={columns ?? 80} />
        </Box>
      );
    case "info": {
      const glyph = block.glyph === "info" ? glyphs.info : block.glyph === "warn" ? glyphs.warn : glyphs.failure;
      const color = block.glyph === "info" ? theme.dim : block.glyph === "warn" ? theme.warning : theme.error;
      return (
        <Text {...(color ? { color } : {})}>
          {glyph} {sanitize(block.text)}
        </Text>
      );
    }
  }
}

/**
 * The output pane: committed scrollback through Ink `<Static>` (never
 * repainted) and a small dynamic region below for the live stream, running
 * tools, and the reasoning indicator (§1.4, §4.1). The welcome banner is the
 * first committed block (§5.1), so `<Static>` prints it once at the top of
 * scrollback and never re-prints it below an answer.
 */
export function OutputPane({
  state,
  theme,
  glyphs,
  caps,
  reduceMotion,
  workspaceRoot,
  showToolDetails,
  scroll,
  columns,
  workerApprovals,
}: {
  state: ViewState;
  theme: ThemeTokens;
  glyphs: Glyphs;
  caps: Capabilities;
  reduceMotion: boolean;
  workspaceRoot?: string | undefined;
  showToolDetails?: boolean | undefined;
  scroll?: { offset: number; height: number; baseline: number } | undefined;
  columns?: number | undefined;
  /** §4.4/§6.2 — pending worker approvals, so a live fan-out row shows
   * `<ToolName> ⚠ tool approval needed` for the matching worker. */
  workerApprovals?: ReadonlyArray<{ workerId?: string | undefined; tool: string }> | undefined;
}): React.ReactElement {
  const scrolled = scroll !== undefined && scroll.offset > 0;
  // §1.4/§4.2 — buffered rendering: while a turn runs the dynamic region shows
  // ONE stable status line (StatusLine) and nothing else. No assistant text, no
  // running tool rows, and no streaming cursor are ever drawn live; every
  // segment commits whole to `<Static>`. The reasoning view (collapsed by
  // default, `Ctrl+O`) is the one extra dim line when reasoning arrived.
  const turnRunning = state.turnStartedAt !== null || state.streamOpen || state.tools.length > 0;
  const reasoningShown = state.reasoningOpen || (state.reasoningExpanded && state.reasoning !== "");
  // §5.2 — one trailing blank row separates the output region from the input
  // region whenever the live dynamic region renders anything, AND in the
  // scrolled-history state (the ScrollView has no Static item margin to supply
  // the gap, so the scrolled idle prompt would otherwise touch the last line).
  const dynamicActive = scrolled || Boolean(reasoningShown || turnRunning || state.retrying);
  return (
    <Box flexDirection="column">
      {scrolled ? (
        <ScrollView
          lines={blockLines(state.blocks)}
          offset={scroll.offset}
          height={scroll.height}
          newLines={Math.max(0, blockLineCount(state.blocks) - scroll.baseline)}
          dim={theme.dim}
        />
      ) : (
        <Static items={state.blocks}>
          {(block, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <BlockView
                block={block}
                theme={theme}
                glyphs={glyphs}
                caps={caps}
                workspaceRoot={workspaceRoot}
                showToolDetails={showToolDetails}
                columns={columns}
              />
            </Box>
          )}
        </Static>
      )}
      {reasoningShown ? (
        <ReasoningView
          reasoning={state.reasoning}
          expanded={state.reasoningExpanded}
          theme={theme}
          {...(state.reasoningStartedAt ? { thoughtMs: Date.now() - state.reasoningStartedAt } : {})}
        />
      ) : null}
      {state.retrying ? (
        <Text {...(theme.dim ? { color: theme.dim } : {})}>
          {glyphs.retry} {sanitize(state.retrying)}
        </Text>
      ) : null}
      {turnRunning ? <StatusLine state={state} theme={theme} reduceMotion={reduceMotion} depth={caps.colorDepth} /> : null}
      {/* §4.2/§4.4 — a fan-out of ≥ 2 workers REPLACES the single status line
          with this live panel: statusLine() returns null while the fan-out runs,
          so `StatusLine` above renders nothing and only `LiveFanout` owns the
          dynamic region (no duplicate header). The panel's indented rows are
          built from live worker events and repaint only when a worker changes
          state (the reducer keeps row objects stable otherwise). Committed in
          one write when every worker finishes (the `fanout` block above). */}
      {turnRunning ? <LiveFanout state={state} theme={theme} glyphs={glyphs} columns={columns ?? 80} reduceMotion={reduceMotion || !caps.color} depth={caps.colorDepth} {...(workerApprovals ? { workerApprovals } : {})} /> : null}
      {/* §5.2 — exactly one blank row separates the output region from the input
          region. A committed block already ends with the `<Static>` item's
          bottom margin, so the idle prompt keeps its gap; the live dynamic
          region (the status line, reasoning, retrying) has no such margin, so it
          emits one trailing blank row here — never doubling the committed
          block's margin. */}
      {dynamicActive ? <Text> </Text> : null}
    </Box>
  );
}
