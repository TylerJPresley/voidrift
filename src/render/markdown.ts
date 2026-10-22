/**
 * Hand-rolled markdown mapping (cli-blueprint.md §4.3).
 *
 * A small, line-oriented parser — no `marked`, no `cli-highlight` (§1.3) — so
 * streaming, partial fences, and the exact old look are under the CLI's control.
 * It lexes assistant text into a flat list of render blocks the Ink `Markdown`
 * component paints, and splits inline runs into styled segments (bold, italic,
 * inline code, links). A partial fenced block (no closing fence) renders as a
 * code block in place so a half-streamed block never flashes malformed output
 * (§4.2). All text is sanitized before it reaches a block (§4).
 */
import { sanitize } from "./theme.js";

/**
 * A leaf inline run (§4.3): literal `text` plus the style stack that applies to
 * it. A run can carry several styles at once (a code span inside bold is
 * `{ code: true, bold: true }`, bold+italic is both flags) because the inline
 * tokenizer is a real nested parser flattened to leaves — the hand-rolled regex
 * could not nest. `kind` is the derived dominant style kept for back-compat
 * (code > link > bold > italic > text); style FLAGS are the source of truth the
 * renderer paints from. Every run's boundary whitespace is preserved exactly —
 * a run's `text` is never trimmed — so no space is lost between a plain and a
 * styled run (§4.3). A `code` run holds its content literally (asterisks,
 * underscores, backticks inside are literal) and is never re-flowed except a
 * hard break at width.
 */
export type InlineSeg = {
  kind: "text" | "bold" | "italic" | "code" | "link";
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  url?: string;
};

/** Styles that apply to a span of inline content while parsing (§4.3). */
interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  url?: string;
}

/** Build a leaf run with its derived `kind` (code > link > bold > italic >
 * text) and the style flags that produced it (§4.3). */
function makeSeg(text: string, style: InlineStyle): InlineSeg {
  const kind: InlineSeg["kind"] = style.code
    ? "code"
    : style.url !== undefined
      ? "link"
      : style.bold
        ? "bold"
        : style.italic
          ? "italic"
          : "text";
  const seg: InlineSeg = { kind, text };
  if (style.bold) seg.bold = true;
  if (style.italic) seg.italic = true;
  if (style.code) seg.code = true;
  if (style.url !== undefined) seg.url = style.url;
  return seg;
}

/** A flat render block (§4.3). */
export type MarkdownBlock =
  | { kind: "heading"; segs: InlineSeg[]; depth: number }
  | { kind: "paragraph"; segs: InlineSeg[] }
  | { kind: "bullet"; segs: InlineSeg[]; indent: number }
  | { kind: "ordered"; segs: InlineSeg[]; marker: string; indent: number }
  | { kind: "blockquote"; segs: InlineSeg[] }
  | { kind: "code"; text: string; lang: string | undefined }
  | { kind: "diff"; text: string }
  | { kind: "hr" }
  | { kind: "table"; header: string[]; rows: string[][] };

/** A word character for CommonMark flanking: an emphasis `_`/`*` that sits
 * between two of these is intra-word and opens no emphasis (§4.3). */
const WORD_CH = /[\p{L}\p{N}]/u;

/** True when a single-char emphasis run (`*text*` or `_text_`) is intra-word
 * and must render literally per CommonMark flanking (§4.3): `_` never opens
 * emphasis between two word characters (so `NO_COLOR`, `snake_case` stay
 * literal); `*` is literal only when flanked by word characters on both sides
 * (so `a*b*c` inside a word stays literal) but a word boundary on either side
 * still opens it. */
function isIntraWord(marker: "*" | "_", text: string, start: number, end: number): boolean {
  const before = start > 0 ? (text[start - 1] ?? "") : "";
  const after = end < text.length ? (text[end] ?? "") : "";
  const beforeWord = before !== "" && WORD_CH.test(before);
  const afterWord = after !== "" && WORD_CH.test(after);
  if (marker === "_") return beforeWord || afterWord;
  return beforeWord && afterWord;
}

/**
 * Close (or drop) unterminated inline markers in a partial, streaming string so
 * a raw marker never flashes on screen mid-stream (§4.3). The renderer treats a
 * dangling `**`, `__`, `*`, `_`, backtick, or an incomplete `[label](` link as
 * if it were already closed; when the response completes the final text
 * re-renders once from `TurnResult.text` (§4.2) with the true closures. Balanced
 * markers pass through untouched. Fenced code blocks are handled by the lexer
 * (a partial fence renders as a code block), so this only touches inline text.
 */
export function closeOpenMarkers(src: string): string {
  let out = src;
  // An incomplete link: `[label](partial-url` with no closing `)`, or a bare
  // `[label` / `[label]` with no `(` yet — render just the label text so no
  // `[`, `]`, or `(` marker shows.
  out = out.replace(/\[([^\]]*)\]\([^)]*$/, "$1");
  out = out.replace(/\[([^\]]*)\]$/, "$1");
  out = out.replace(/\[([^\]]*)$/, "$1");
  // An open inline-code span on the tail (odd backtick count): close it so no
  // raw backtick flashes. Completed spans are masked out of emphasis scanning
  // below, so a marker inside a code span is never treated as open (§4.3).
  const tickCount = (out.match(/`/g) ?? []).length;
  if (tickCount % 2 === 1) {
    const lastTick = out.lastIndexOf("`");
    out = lastTick < out.length - 1 ? out + "`" : out.slice(0, lastTick);
  }
  // Paired emphasis markers, longest first so `**`/`__` win over `*`/`_`. A run
  // is counted only outside inline-code spans and, for a single-char `*`/`_`,
  // only when it is not intra-word (CommonMark flanking, §4.3) — so a dangling
  // real emphasis on the tail is closed, but `NO_COLOR`/`snake_case` never gain
  // a spurious closer. A marker with no text after it is dropped.
  for (const marker of ["**", "__", "*", "_"]) {
    const parts = splitOnMarker(out, marker);
    if (parts.open) {
      out = parts.after.length > 0 ? out + marker : out.slice(0, out.length - marker.length);
    }
  }
  return out;
}

/** Mask inline-code span contents (balanced backticks) with spaces of equal
 * length so emphasis scanning never sees a marker inside a code span (§4.3),
 * while keeping string offsets stable. */
function maskCodeSpans(s: string): string {
  return s.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
}

/** Count occurrences of an emphasis marker that act as delimiters — skipping
 * inline-code spans and, for a single-char `*`/`_`, skipping intra-word
 * positions (CommonMark flanking, §4.3). Reports whether the last such run is
 * open (odd count) and the trailing text after the final marker. */
function splitOnMarker(s: string, marker: string): { open: boolean; after: string } {
  const scan = maskCodeSpans(s);
  const single = marker === "*" || marker === "_";
  let count = 0;
  let idx = scan.indexOf(marker);
  let lastEnd = -1;
  while (idx !== -1) {
    const nextFrom = idx + marker.length;
    const skip = single && isIntraWord(marker as "*" | "_", s, idx, nextFrom);
    if (!skip) {
      count += 1;
      lastEnd = nextFrom;
    }
    idx = scan.indexOf(marker, nextFrom);
  }
  const open = count % 2 === 1;
  const after = open && lastEnd >= 0 ? s.slice(lastEnd) : "";
  return { open, after };
}

/**
 * Split an inline string into styled leaf runs (§4.3) with a real nested
 * tokenizer — code spans, emphasis (bold/italic), and links, correctly nested
 * and with the right precedence: a code span wins over emphasis (its content is
 * literal, so `*`/`_`/backtick inside it are never markup), emphasis may
 * contain code spans, links and other emphasis. Produces leaf runs that carry
 * the full style stack and PRESERVE every space exactly — a run's boundary
 * whitespace is never trimmed — so no space is lost at a plain↔styled boundary.
 *
 * Operates on text that is ALREADY final or already tail-closed by the caller:
 * it never closes unterminated markers itself (the streaming-safety pass does
 * that for the live tail only, §4.3). A single-char `*`/`_` that is intra-word
 * (CommonMark flanking) is literal. An escaped marker (`\*`, `\_`, `` \` ``)
 * renders the literal character. A marker with no valid close is literal text.
 */
export function parseInline(src: string): InlineSeg[] {
  const text = sanitize(src);
  const out: InlineSeg[] = [];
  parseRun(text, 0, text.length, {}, out);
  if (out.length === 0) return [{ kind: "text", text: "" }];
  return mergeAdjacent(out);
}

/**
 * Parse `text[start..end)` under the active `style`, appending leaf runs to
 * `out`. Scans left to right; at each marker it finds the matching close and
 * recurses with the added style (code is literal, so it does not recurse). A
 * marker with no valid close is emitted literally. Plain text between markers
 * (including all its spaces) is emitted as one run with the current style.
 */
function parseRun(text: string, start: number, end: number, style: InlineStyle, out: InlineSeg[]): void {
  let i = start;
  let plainStart = start;
  const flushPlain = (upTo: number): void => {
    if (upTo > plainStart) out.push(makeSeg(text.slice(plainStart, upTo), style));
  };
  while (i < end) {
    const ch = text[i]!;

    // Backslash escape of a markup character: emit the escaped char literally.
    if (ch === "\\" && i + 1 < end && "*_`[]\\".includes(text[i + 1]!)) {
      flushPlain(i);
      out.push(makeSeg(text[i + 1]!, style));
      i += 2;
      plainStart = i;
      continue;
    }

    // Inline code span: backtick-delimited, content literal (wins over
    // emphasis). A run of N backticks closes on the next run of exactly N.
    if (ch === "`" && !style.code) {
      const open = tickRun(text, i, end);
      const close = findTickClose(text, open.after, end, open.len);
      if (close !== -1) {
        flushPlain(i);
        // CommonMark: a single leading and trailing space around non-space
        // content is stripped; we keep content otherwise literal (asterisks,
        // underscores inside stay literal).
        const raw = text.slice(open.after, close);
        out.push(makeSeg(stripCodeSpanPadding(raw), { ...style, code: true }));
        i = close + open.len;
        plainStart = i;
        continue;
      }
    }

    // Link: [label](url). The label parses inline under the link style; the url
    // is taken literally (no spaces).
    if (ch === "[" && !style.code) {
      const link = matchLink(text, i, end);
      if (link) {
        flushPlain(i);
        parseRun(text, link.labelStart, link.labelEnd, { ...style, url: link.url }, out);
        i = link.next;
        plainStart = i;
        continue;
      }
    }

    // Emphasis: ** / __ (bold) and * / _ (italic). Code content never reaches
    // here. Longest marker first so `**` wins over `*`.
    if ((ch === "*" || ch === "_") && !style.code) {
      const emph = matchEmphasis(text, i, end, ch as "*" | "_");
      if (emph) {
        flushPlain(i);
        parseRun(text, emph.innerStart, emph.innerEnd, { ...style, ...emph.add }, out);
        i = emph.next;
        plainStart = i;
        continue;
      }
    }

    i += 1;
  }
  flushPlain(end);
}

/** The run of identical backticks starting at `i`. */
function tickRun(text: string, i: number, end: number): { len: number; after: number } {
  let j = i;
  while (j < end && text[j] === "`") j += 1;
  return { len: j - i, after: j };
}

/** The index of the opening of a closing backtick run of exactly `len` ticks at
 * or after `from`, or -1 when none exists. Returns the index of the first tick
 * of that closing run. */
function findTickClose(text: string, from: number, end: number, len: number): number {
  let j = from;
  while (j < end) {
    if (text[j] === "`") {
      const run = tickRun(text, j, end);
      if (run.len === len) return j;
      j = run.after;
    } else {
      j += 1;
    }
  }
  return -1;
}

/** Strip exactly one leading and trailing space from a code span whose content
 * is not all spaces (CommonMark), keeping inner content literal otherwise. */
function stripCodeSpanPadding(s: string): string {
  if (s.length >= 2 && s.startsWith(" ") && s.endsWith(" ") && s.trim() !== "") {
    return s.slice(1, -1);
  }
  return s;
}

/** Match a `[label](url)` link starting at `i` (`text[i] === "["`). The label
 * may contain balanced brackets and inline markup; the url runs to the closing
 * `)` with no whitespace. */
function matchLink(
  text: string,
  i: number,
  end: number,
): { labelStart: number; labelEnd: number; url: string; next: number } | null {
  let depth = 0;
  let j = i;
  for (; j < end; j++) {
    const c = text[j]!;
    if (c === "\\") {
      j += 1;
      continue;
    }
    if (c === "`") {
      // Skip over a code span inside the label so a `]` inside code is literal.
      const run = tickRun(text, j, end);
      const close = findTickClose(text, run.after, end, run.len);
      if (close !== -1) {
        j = close + run.len - 1;
        continue;
      }
    }
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (j >= end || text[j] !== "]") return null;
  const labelEnd = j;
  if (text[j + 1] !== "(") return null;
  let k = j + 2;
  for (; k < end; k++) {
    const c = text[k]!;
    if (c === ")") break;
    if (/\s/.test(c)) return null; // url has no whitespace
  }
  if (k >= end || text[k] !== ")") return null;
  return { labelStart: i + 1, labelEnd, url: text.slice(j + 2, k), next: k + 1 };
}

/** Match an emphasis span starting at `i` (`text[i]` is `*` or `_`). Tries a
 * double marker (bold) then a single (italic). Returns the inner range, the
 * style to add, and the index past the closing marker; null when the marker
 * does not open emphasis (intra-word single `_`/`*`, or no matching close). */
function matchEmphasis(
  text: string,
  i: number,
  end: number,
  marker: "*" | "_",
): { innerStart: number; innerEnd: number; add: InlineStyle; next: number } | null {
  const isDouble = text[i + 1] === marker;
  const mlen = isDouble ? 2 : 1;
  const innerStart = i + mlen;
  if (innerStart >= end) return null;
  // The opener must be followed by non-space (left-flanking).
  if (/\s/.test(text[innerStart]!)) return null;
  const close = findEmphasisClose(text, innerStart, end, marker, mlen);
  if (close === -1) return null;
  // A single-char `*`/`_` whose WHOLE span is intra-word opens no emphasis
  // (CommonMark flanking, §4.3): `_` between two word chars (`NO_COLOR`), `*`
  // flanked by word chars on both sides. The span runs from the opener `i` to
  // just past the closing marker (`close + mlen`).
  if (mlen === 1 && isIntraWord(marker, text, i, close + mlen)) return null;
  return {
    innerStart,
    innerEnd: close,
    add: isDouble ? { bold: true } : { italic: true },
    next: close + mlen,
  };
}

/** The index of the closing marker run for an emphasis opened with `mlen`
 * copies of `marker`, honoring code spans (a marker inside code is literal) and
 * the right-flanking rule (the close must follow non-space). Returns -1 when
 * none exists. */
function findEmphasisClose(text: string, from: number, end: number, marker: "*" | "_", mlen: number): number {
  let j = from;
  while (j < end) {
    const c = text[j]!;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") {
      const run = tickRun(text, j, end);
      const cl = findTickClose(text, run.after, end, run.len);
      if (cl !== -1) {
        j = cl + run.len;
        continue;
      }
    }
    if (c === marker) {
      const run = tickRunOfMarker(text, j, end, marker);
      if (run >= mlen) {
        // Right-flanking: the char before the close must be non-space. The
        // intra-word test for a single marker is applied over the whole span by
        // the caller (`matchEmphasis`).
        if (j > from && !/\s/.test(text[j - 1]!)) return j;
        j += run;
        continue;
      }
      j += run;
      continue;
    }
    j += 1;
  }
  return -1;
}

/** The length of the run of `marker` characters starting at `j`. */
function tickRunOfMarker(text: string, j: number, end: number, marker: "*" | "_"): number {
  let k = j;
  while (k < end && text[k] === marker) k += 1;
  return k - j;
}

/** Merge adjacent leaf runs that carry the same style so the output stays
 * compact (text split only at markup boundaries), without altering any content
 * or whitespace. */
function mergeAdjacent(segs: InlineSeg[]): InlineSeg[] {
  const out: InlineSeg[] = [];
  for (const seg of segs) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.kind === seg.kind &&
      !!prev.bold === !!seg.bold &&
      !!prev.italic === !!seg.italic &&
      !!prev.code === !!seg.code &&
      prev.url === seg.url
    ) {
      prev.text += seg.text;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)\.\s+(.*)$/;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Strip inline markers for table width/alignment math (§4.3) by flattening the
 * nested inline token tree to its visible text — so a code span inside bold, an
 * asterisk inside a code span, and an intra-word underscore all render exactly
 * as they would in prose, with no marker character left. */
function stripInline(s: string): string {
  return parseInline(s)
    .map((seg) => seg.text)
    .join("");
}

/**
 * Lex markdown to render blocks (§4.3). A partial fenced block with no closing
 * fence is still emitted as a code block so a half-streamed block never flashes
 * malformed output (§4.2); the caller re-lexes once the stream closes.
 *
 * `streaming` is set ONLY for the live tail of an open reply: it applies the
 * streaming-safety marker closing (`closeOpenMarkers`) to each inline run so a
 * dangling `**`, `*`, backtick or `[label](` link never flashes raw. A committed
 * block or the final whole-reply render is lexed with `streaming` off, so it is
 * never retouched by that pass (§4.3).
 */
export function lexMarkdown(src: string, streaming = false): MarkdownBlock[] {
  const inline = (s: string): InlineSeg[] => parseInline(streaming ? closeOpenMarkers(s) : s);
  const lines = sanitize(src).split("\n");
  const blocks: MarkdownBlock[] = [];
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length === 0) return;
    const joined = para.join(" ").trim();
    if (joined) blocks.push({ kind: "paragraph", segs: inline(joined) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Fenced code block.
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      flushPara();
      const lang = fence[1]?.trim() || undefined;
      const body: string[] = [];
      i++;
      let closed = false;
      for (; i < lines.length; i++) {
        if (/^\s*```/.test(lines[i] ?? "")) {
          closed = true;
          break;
        }
        body.push(lines[i] ?? "");
      }
      if (!closed) i = lines.length - 1; // partial fence: consume to end (§4.2)
      const text = body.join("\n");
      if (lang === "diff" || isUnifiedDiff(text)) blocks.push({ kind: "diff", text });
      else blocks.push({ kind: "code", text, lang });
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(line)) {
      flushPara();
      blocks.push({ kind: "hr" });
      continue;
    }

    // Heading.
    const h = line.match(HEADING_RE);
    if (h) {
      flushPara();
      blocks.push({ kind: "heading", depth: h[1]!.length, segs: inline(h[2] ?? "") });
      continue;
    }

    // Table: a header row followed by a separator row.
    if (line.includes("|") && TABLE_SEP_RE.test(lines[i + 1] ?? "")) {
      flushPara();
      const header = splitRow(line).map(stripInline);
      const rows: string[][] = [];
      i += 2; // skip header + separator
      for (; i < lines.length; i++) {
        const row = lines[i] ?? "";
        if (!row.includes("|") || row.trim() === "") break;
        rows.push(splitRow(row).map(stripInline));
      }
      i--; // the loop will i++ past the non-table line
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    // Blockquote line (`>` prefix): one block per contiguous quoted run.
    const bq = line.match(BLOCKQUOTE_RE);
    if (bq && /^\s*>/.test(line)) {
      flushPara();
      blocks.push({ kind: "blockquote", segs: inline(bq[1] ?? "") });
      continue;
    }

    // Ordered list item.
    const ol = line.match(ORDERED_RE);
    if (ol) {
      flushPara();
      blocks.push({ kind: "ordered", marker: ol[2]!, indent: ol[1]!.length, segs: inline(ol[3] ?? "") });
      continue;
    }

    // Unordered list item.
    const ul = line.match(BULLET_RE);
    if (ul) {
      flushPara();
      blocks.push({ kind: "bullet", indent: ul[1]!.length, segs: inline(ul[2] ?? "") });
      continue;
    }

    // Blank line ends a paragraph.
    if (line.trim() === "") {
      flushPara();
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

/** True when the text reads as an unfenced unified diff (§4.3, §4.5). */
export function isUnifiedDiff(text: string): boolean {
  const lines = text.split("\n");
  const hasHunk = lines.some((l) => /^@@ .* @@/.test(l));
  const hasHeader = lines.some((l) => l.startsWith("--- ") || l.startsWith("+++ "));
  return hasHunk && hasHeader;
}
