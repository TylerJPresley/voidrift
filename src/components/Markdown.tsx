import React from "react";
import { Box, Text } from "ink";
import type { Capabilities } from "../terminal.js";
import type { ThemeTokens } from "../render/theme.js";
import { classifyDiffLine, diffLineColor, hyperlink, displayWidth, contentWidth, cutToWidth, hardBreakChunks } from "../render/theme.js";
import { lexMarkdown, type InlineSeg, type MarkdownBlock } from "../render/markdown.js";

/**
 * Wrap inline segments to `width` display columns, returning one `InlineSeg[]`
 * per output line (§4.1). Wrapping is on word boundaries across segment
 * boundaries; a single word (or URL) wider than `width` is HARD-BROKEN by
 * display column so no row ever overflows and no content is lost. Styles (bold,
 * italic, code, link) are preserved on every fragment. A break never leaves a
 * lone one- or two-character tail pulled off a longer word unless that is the
 * genuine remainder. Measuring and breaking use display width, never `.length`.
 */
function wrapSegments(segs: InlineSeg[], width: number): InlineSeg[][] {
  const w = Math.max(1, width);
  // Tokenize the whole run sequence into word pieces, carrying a flag for a
  // preceding break opportunity (a run of whitespace between two words). The
  // `space` flag is tracked ACROSS segment boundaries so a trailing space on a
  // plain run before a styled run (or vice versa) is never lost (§4.3). A code
  // run is kept atomic — never split on internal whitespace — so a code span is
  // not re-flowed except a hard break at width.
  type Tok = { seg: InlineSeg; space: boolean };
  const toks: Tok[] = [];
  let pendingSpace = false;
  for (const seg of segs) {
    if (seg.code) {
      // A code run is one token (atomic); a leading space from a prior run is a
      // break opportunity, internal spaces stay literal, and a trailing space
      // in the code text itself is content (preserved).
      if (seg.text === "") continue;
      // Leading whitespace of a code run is a boundary space, not content.
      const lead = /^\s/.test(seg.text);
      const trail = /\s$/.test(seg.text);
      const core = seg.text.replace(/^\s+/, "").replace(/\s+$/, "");
      if (core === "") {
        pendingSpace = true;
        continue;
      }
      toks.push({ seg: { ...seg, text: core }, space: pendingSpace || lead });
      pendingSpace = trail;
      continue;
    }
    const parts = seg.text.split(/(\s+)/);
    for (const part of parts) {
      if (part === "") continue;
      if (/^\s+$/.test(part)) {
        pendingSpace = true;
        continue;
      }
      toks.push({ seg: { ...seg, text: part }, space: pendingSpace });
      pendingSpace = false;
    }
  }
  if (toks.length === 0) return [[{ kind: "text", text: "" }]];

  // Group tokens into WORDS: a word is a maximal run of tokens with no space
  // between them (a styled run adjacent to a plain run with no source space —
  // e.g. `**mix**.` → "mix" + "." stay one word). A break opportunity exists
  // only BEFORE a word whose first token had a preceding space. This keeps
  // glued runs together so a line break never separates `mix` from `.` and
  // never injects a spurious space (§4.3).
  type Word = { pieces: InlineSeg[]; space: boolean; width: number };
  const words: Word[] = [];
  for (const tok of toks) {
    if (words.length > 0 && !tok.space) {
      const last = words[words.length - 1]!;
      last.pieces.push(tok.seg);
      last.width += displayWidth(tok.seg.text);
    } else {
      words.push({ pieces: [tok.seg], space: tok.space, width: displayWidth(tok.seg.text) });
    }
  }

  const lines: InlineSeg[][] = [];
  let line: InlineSeg[] = [];
  let lineW = 0;
  const flush = (): void => {
    lines.push(line.length > 0 ? line : [{ kind: "text", text: "" }]);
    line = [];
    lineW = 0;
  };
  const pushSeg = (seg: InlineSeg): void => {
    line.push(seg);
    lineW += displayWidth(seg.text);
  };
  const pushSpace = (): void => {
    line.push({ kind: "text", text: " " });
    lineW += 1;
  };

  for (const word of words) {
    // A word wider than the whole line is HARD-BROKEN by display column across
    // its pieces, filling the current line first so no lone short head is left
    // stranded before it (§4.1). Pieces keep their individual styles.
    if (word.width > w) {
      const sep = word.space && lineW > 0 ? 1 : 0;
      // When a break opportunity precedes it, start the oversized word on a
      // fresh line only if the current line already has content and no usable
      // room remains; otherwise fill the remainder first.
      if (lineW > 0 && sep > 0 && w - lineW - sep < 1) flush();
      else if (lineW > 0 && sep > 0) pushSpace();
      for (const piece of word.pieces) {
        let rest = piece.text;
        while (displayWidth(rest) > 0) {
          const room = w - lineW;
          if (room < 1) {
            flush();
            continue;
          }
          const [head, tail] = cutToWidth(rest, room);
          if (head === "") {
            flush();
            continue;
          }
          pushSeg({ ...piece, text: head });
          rest = tail;
          if (displayWidth(rest) > 0) flush();
        }
      }
      continue;
    }
    // A normal word: wrap to a new line when it would overflow.
    const sep = word.space && lineW > 0 ? 1 : 0;
    if (lineW > 0 && lineW + sep + word.width > w) flush();
    if (lineW > 0 && word.space) pushSpace();
    for (const piece of word.pieces) pushSeg(piece);
  }
  if (line.length > 0) flush();
  return lines.length > 0 ? lines : [[{ kind: "text", text: "" }]];
}

/** Render inline segments as styled <Text> (§4.3). A run carries a style stack
 * (bold, italic, code color, link) so a code span inside bold renders bold AND
 * in the code color, and bold+italic renders both — the run's flags are the
 * source of truth, not a single `kind`. */
function Inline({
  segs,
  theme,
  caps,
  workspaceRoot,
}: {
  segs: InlineSeg[];
  theme: ThemeTokens;
  caps: Capabilities;
  workspaceRoot?: string | undefined;
}): React.ReactElement {
  return (
    <>
      {segs.map((seg, i) => {
        const color = seg.url !== undefined && theme.link ? theme.link : seg.code && theme.code ? theme.code : undefined;
        const props: Record<string, unknown> = {};
        if (seg.bold) props["bold"] = true;
        if (seg.italic) props["italic"] = true;
        if (seg.url !== undefined) props["underline"] = true;
        if (color) props["color"] = color;
        const content =
          seg.url !== undefined ? hyperlink(seg.text, seg.url, caps, workspaceRoot) : seg.text;
        return (
          <Text key={i} {...props}>
            {content}
          </Text>
        );
      })}
    </>
  );
}

/**
 * Render inline segments WRAPPED to a content width, one styled `<Text>` per
 * output line with no Ink auto-wrap (§4.1). An optional `prefix` leads line 0
 * (e.g. `• ` or a padded ordered marker) and a hanging indent of the prefix's
 * display width leads every continuation line so wrapped rows align under the
 * item text. The text budget is `width - displayWidth(prefix)`; the whole row
 * (prefix + text) never exceeds `width`. Breaking is display-width aware and
 * hard-breaks an over-long word, so no row overflows and no lone stray
 * character is left by an off-by-one.
 */
function WrappedInline({
  segs,
  width,
  theme,
  caps,
  workspaceRoot,
  prefix,
  prefixColor,
  bold,
}: {
  segs: InlineSeg[];
  width: number;
  theme: ThemeTokens;
  caps: Capabilities;
  workspaceRoot?: string | undefined;
  prefix?: string | undefined;
  prefixColor?: { color: string } | undefined;
  bold?: boolean | undefined;
}): React.ReactElement {
  const prefixW = prefix ? displayWidth(prefix) : 0;
  const textWidth = Math.max(1, width - prefixW);
  const lines = wrapSegments(segs, textWidth);
  const hang = " ".repeat(prefixW);
  return (
    <Box flexDirection="column">
      {lines.map((lineSegs, i) => (
        <Box key={i}>
          {prefixW > 0 ? (
            <Text {...(i === 0 && prefixColor ? prefixColor : {})}>{i === 0 ? prefix : hang}</Text>
          ) : null}
          <Text {...(bold ? { bold: true } : {})}>
            <Inline segs={lineSegs} theme={theme} caps={caps} workspaceRoot={workspaceRoot} />
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** Render a unified diff with per-line color, markers preserved (§4.5). */
export function DiffView({
  diff,
  theme,
  maxLines = 20,
}: {
  diff: string;
  theme: ThemeTokens;
  maxLines?: number;
}): React.ReactElement {
  const all = diff.replace(/\n$/, "").split("\n");
  const lines = all.slice(0, maxLines);
  const more = all.length - lines.length;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {lines.map((line, i) => {
        const color = diffLineColor(classifyDiffLine(line), theme);
        return (
          <Text key={i} {...(color ? { color } : {})}>
            {line === "" ? " " : line}
          </Text>
        );
      })}
      {more > 0 ? <Text {...(theme.dim ? { color: theme.dim } : {})}>…{more} more lines</Text> : null}
    </Box>
  );
}

/** Word-wrap a cell's plain text to `width` display columns, never truncating
 * (§4.3): a word longer than the column is hard-broken so no content is lost. */
function wrapCell(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const words = text.split(/\s+/).filter((x) => x.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    while (displayWidth(word) > w) {
      // Hard-break an over-long word by column count.
      let take = "";
      for (const ch of word) {
        if (displayWidth(take + ch) > w) break;
        take += ch;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(take);
      word = word.slice(take.length);
    }
    const cand = line ? `${line} ${word}` : word;
    if (displayWidth(cand) > w) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = cand;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

const MIN_COL = 6;

/**
 * A markdown table with box-drawing borders, a header rule under the bold
 * header, columns fitted to the terminal width, cell text WRAPPED onto extra
 * rows (never ellipsis-truncated), and a stacked `key: value` fallback when the
 * terminal is too narrow for the minimum column widths (§4.3).
 */
function Table({
  header,
  rows,
  theme,
  columns,
}: {
  header: string[];
  rows: string[][];
  theme: ThemeTokens;
  columns?: number | undefined;
}): React.ReactElement {
  const colCount = header.length;
  const termWidth = contentWidth(columns);
  // Natural (unwrapped) width per column.
  const natural = header.map((h) => displayWidth(h));
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) natural[c] = Math.max(natural[c] ?? 0, displayWidth(row[c] ?? ""));
  }
  // Table chrome: a leading `│ `, a ` │ ` between columns, a trailing ` │`.
  const chrome = colCount * 3 + 1;
  const available = termWidth - chrome;
  // Stacked fallback: the terminal cannot fit the minimum column widths.
  if (available < colCount * MIN_COL) {
    // Pre-wrap each `key: value` to the content width (minus the 1-column
    // paddingLeft) so no stacked row overflows (§4.1); the key is bold on the
    // first line, continuation rows hang under the value.
    const stackWidth = Math.max(1, termWidth - 1);
    return (
      <Box flexDirection="column" paddingLeft={1}>
        {rows.map((row, ri) => (
          <Box key={ri} flexDirection="column" marginBottom={ri < rows.length - 1 ? 1 : 0}>
            {header.map((h, c) => {
              const key = `${h}: `;
              const lines = wrapCell(row[c] ?? "", Math.max(1, stackWidth - displayWidth(key)));
              const hang = " ".repeat(displayWidth(key));
              return (
                <Box key={c} flexDirection="column">
                  {lines.map((ln, li) => (
                    <Box key={li}>
                      <Text bold>{li === 0 ? key : hang}</Text>
                      <Text>{ln}</Text>
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    );
  }
  // Fit columns to the available width: start from natural, shrink the widest
  // columns down toward MIN_COL until the row fits, so short columns stay intact
  // and long cells wrap.
  const widths = natural.slice();
  let total = widths.reduce((a, b) => a + b, 0);
  while (total > available) {
    const maxW = Math.max(...widths);
    if (maxW <= MIN_COL) break;
    const i = widths.indexOf(maxW);
    widths[i] = maxW - 1;
    total -= 1;
  }
  const dim = theme.dim ? { color: theme.dim } : {};
  const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - displayWidth(s)));
  const border = (l: string, m: string, r: string): string =>
    l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
  const renderRow = (cells: string[], bold: boolean): React.ReactElement => {
    const wrapped = widths.map((w, c) => wrapCell(cells[c] ?? "", w));
    const height = Math.max(1, ...wrapped.map((x) => x.length));
    const lines: React.ReactElement[] = [];
    for (let r = 0; r < height; r++) {
      lines.push(
        <Text key={r}>
          <Text {...dim}>│ </Text>
          {widths.map((w, c) => (
            <React.Fragment key={c}>
              <Text bold={bold}>{pad(wrapped[c]?.[r] ?? "", w)}</Text>
              <Text {...dim}>{c < colCount - 1 ? " │ " : " │"}</Text>
            </React.Fragment>
          ))}
        </Text>,
      );
    }
    return <>{lines}</>;
  };
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text {...dim}>{border("┌", "┬", "┐")}</Text>
      {renderRow(header, true)}
      <Text {...dim}>{border("├", "┼", "┤")}</Text>
      {rows.map((row, ri) => (
        <React.Fragment key={ri}>{renderRow(row, false)}</React.Fragment>
      ))}
      <Text {...dim}>{border("└", "┴", "┘")}</Text>
    </Box>
  );
}

function BlockView({
  block,
  theme,
  caps,
  workspaceRoot,
  columns,
  gutter,
}: {
  block: MarkdownBlock;
  theme: ThemeTokens;
  caps: Capabilities;
  workspaceRoot?: string | undefined;
  columns?: number | undefined;
  gutter?: number | undefined;
}): React.ReactElement {
  const cw = contentWidth(columns);
  switch (block.kind) {
    case "heading": {
      // Headings are styled by level so they read as distinct from bold inline
      // emphasis (§4.3): h1 and h2 are bold in the accent color; h3+ are bold
      // in the default color. h1 additionally carries a full-width dim rule on
      // the line beneath it (rendered by the caller) — together these make a
      // heading visibly different from `**bold**` emphasis, which is bold-only.
      // The heading text wraps within the content width (§4.1).
      const accent = block.depth <= 2;
      const headingColor = accent && theme.heading ? theme.heading : undefined;
      const lines = wrapSegments(block.segs, cw);
      return (
        <Box flexDirection="column">
          {lines.map((lineSegs, i) => (
            <Text key={i} bold {...(headingColor ? { color: headingColor } : {})}>
              <Inline segs={lineSegs} theme={theme} caps={caps} workspaceRoot={workspaceRoot} />
            </Text>
          ))}
        </Box>
      );
    }
    case "paragraph":
      return (
        <WrappedInline segs={block.segs} width={cw} theme={theme} caps={caps} workspaceRoot={workspaceRoot} />
      );
    case "bullet": {
      // A `• ` marker (exactly one space after the bullet, §4.1) with wrapped
      // continuation rows aligned under the item text. The indent reduces the
      // available content width so the row never exceeds it.
      const pad = Math.round(block.indent / 2) * 2;
      return (
        <Box paddingLeft={pad}>
          <WrappedInline
            segs={block.segs}
            width={Math.max(1, cw - pad)}
            theme={theme}
            caps={caps}
            workspaceRoot={workspaceRoot}
            prefix="• "
          />
        </Box>
      );
    }
    case "ordered": {
      // The number is right-padded into a gutter sized to the widest number in
      // this list so the numbers align (§4.3). `gutter` is the width of the
      // widest `N.` marker; default to this marker's own width. Continuation
      // rows align under the item text (§4.1).
      const label = `${block.marker}.`;
      const width = gutter ?? label.length;
      const padded = label.padStart(width);
      const pad = Math.round(block.indent / 2) * 2;
      return (
        <Box paddingLeft={pad}>
          <WrappedInline
            segs={block.segs}
            width={Math.max(1, cw - pad)}
            theme={theme}
            caps={caps}
            workspaceRoot={workspaceRoot}
            prefix={`${padded} `}
          />
        </Box>
      );
    }
    case "blockquote":
      // A dim left bar down the quoted block; the quoted text in the default
      // color (§4.3), wrapped within the content width with the bar repeated as
      // the continuation prefix (§4.1).
      return (
        <WrappedInline
          segs={block.segs}
          width={cw}
          theme={theme}
          caps={caps}
          workspaceRoot={workspaceRoot}
          prefix="│ "
          {...(theme.dim ? { prefixColor: { color: theme.dim } } : {})}
        />
      );
    case "code": {
      // Code is rendered verbatim but hard-wrapped by display column so a long
      // line never overflows the content width (§4.1); the inner paddingLeft of
      // 2 reduces the budget. No word-wrapping (code is significant whitespace).
      const codeWidth = Math.max(1, cw - 2);
      const rows = block.text.split("\n").flatMap((line) => (line === "" ? [""] : hardBreakChunks(line, codeWidth)));
      return (
        <Box flexDirection="column">
          {block.lang ? <Text {...(theme.dim ? { color: theme.dim } : {})}>── {block.lang} ──</Text> : null}
          <Box flexDirection="column" paddingLeft={2}>
            {rows.map((line, i) => (
              <Text key={i} {...(theme.codeBlock ? { color: theme.codeBlock } : {})}>
                {line === "" ? " " : line}
              </Text>
            ))}
          </Box>
        </Box>
      );
    }
    case "diff":
      return <DiffView diff={block.text} theme={theme} />;
    case "hr":
      return <Text {...(theme.dim ? { color: theme.dim } : {})}>{"─".repeat(cw)}</Text>;
    case "table":
      return <Table header={block.header} rows={block.rows} theme={theme} columns={columns} />;
  }
}

/**
 * Render markdown-mapped assistant text with the hand-rolled renderer (§4.3).
 *
 * Spacing (§4.3): one blank line separates every block from its neighbours,
 * **except** that a list is tight — no blank renders between consecutive list
 * items (bullet or ordered), and a blockquote is tight the same way; a blank
 * renders only before the first item/line and after the last. A heading carries
 * a blank line both before and after it; an `h1` additionally draws a
 * full-width dim rule on the line directly beneath its text (no blank between
 * the two). The leading `·` marker lives on each block, not here.
 */
export function Markdown({
  source,
  theme,
  caps,
  workspaceRoot,
  columns,
  streaming,
}: {
  source: string;
  theme: ThemeTokens;
  caps: Capabilities;
  workspaceRoot?: string | undefined;
  columns?: number | undefined;
  streaming?: boolean | undefined;
}): React.ReactElement {
  const blocks = lexMarkdown(source, streaming ?? false);
  // Group tag used for tight spacing: list items share "list", blockquote lines
  // share "quote"; everything else is unique (one block per group).
  const groupOf = (b: MarkdownBlock | undefined): string | undefined => {
    if (!b) return undefined;
    if (b.kind === "bullet" || b.kind === "ordered") return "list";
    if (b.kind === "blockquote") return "quote";
    return undefined;
  };
  // Gutter width for a contiguous ordered-list run so the numbers align (§4.3):
  // the widest `N.` marker among adjacent ordered items.
  const orderedGutter = (index: number): number => {
    let width = 0;
    // Walk the contiguous list run (bullet/ordered) around `index`.
    let lo = index;
    while (lo > 0 && groupOf(blocks[lo - 1]) === "list") lo--;
    let hi = index;
    while (hi < blocks.length - 1 && groupOf(blocks[hi + 1]) === "list") hi++;
    for (let j = lo; j <= hi; j++) {
      const b = blocks[j];
      if (b && b.kind === "ordered") width = Math.max(width, `${b.marker}.`.length);
    }
    return width;
  };
  const ruleWidth = contentWidth(columns);
  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        const prev = blocks[i - 1];
        const g = groupOf(block);
        const pg = groupOf(prev);
        // Block margins collapse (§4.3): exactly one blank row separates any two
        // adjacent blocks. A single leading spacer per block carries it — a
        // block's "blank after" and the next block's "blank before" are the same
        // row, never two. So a heading emits NO trailing blank of its own; the
        // following block's own leading spacer is the single gap. The spacer is
        // dropped only for the first block and for a block that continues the
        // same tight group (a list or a blockquote) as the previous one.
        const continuesGroup = g !== undefined && g === pg;
        const spacerBefore = i > 0 && !continuesGroup;
        const h1Rule = block.kind === "heading" && block.depth === 1;
        const gutter = block.kind === "ordered" ? orderedGutter(i) : undefined;
        return (
          <React.Fragment key={i}>
            {spacerBefore ? <Text> </Text> : null}
            <BlockView
              block={block}
              theme={theme}
              caps={caps}
              workspaceRoot={workspaceRoot}
              columns={columns}
              gutter={gutter}
            />
            {h1Rule ? (
              <Text {...(theme.dim ? { color: theme.dim } : {})}>{"─".repeat(ruleWidth)}</Text>
            ) : null}
          </React.Fragment>
        );
      })}
    </Box>
  );
}
