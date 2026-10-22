/**
 * Render tokens and helpers (cli-blueprint.md §4).
 *
 * Pure, side-effect-free helpers the Ink components consume: terminal-escape
 * sanitization (§4), a named palette token table resolved to the detected color
 * depth (§4.9), the glyph set with ASCII fallbacks (§4.9), the braille spinner
 * frame set (§4.2), tool display names / colors / argument shortening / result
 * summaries (§4.4), diff line classification (§4.5), and OSC 8 hyperlink
 * emission gated by capability and scheme (§4.8).
 *
 * The palette is the old implementation's identity, given as 24-bit hex and
 * degraded to a 256/16-color nearest match or a monochrome map by color depth
 * (§4.9). The markdown renderer, the spinner, and the tool/status layouts are
 * the CLI's own Ink components (§1.3) — no third-party formatter.
 */
import type { Capabilities, ColorDepth } from "../terminal.js";

/**
 * True for a Unicode code point the CLI must never render in untrusted text:
 * C0/C1 control bytes, DEL, the bidirectional-override controls (Trojan Source,
 * U+202A–U+202E and U+2066–U+2069), the directional marks (U+200E/U+200F), and
 * the zero-width/format characters used to spoof ASCII-looking identifiers
 * (U+200B–U+200C, U+2060, U+FEFF). Newline and tab are handled by the caller.
 *
 * U+200D (ZWJ) is NOT removed here — it is load-bearing inside emoji sequences
 * (family 👨‍👩‍👧‍👦, profession, flag joiners). A bare ZWJ between ASCII letters
 * is a far weaker spoof than a bidi override and is left intact so legitimate
 * emoji always render.
 */
function isForbiddenCodePoint(code: number): boolean {
  if (code <= 0x1f || code === 0x7f) return true; // C0 + DEL
  if (code >= 0x80 && code <= 0x9f) return true; // C1 (CSI/OSC/DCS/APC single-byte)
  if (code >= 0x202a && code <= 0x202e) return true; // LRE RLE PDF LRO RLO (bidi overrides)
  if (code >= 0x2066 && code <= 0x2069) return true; // LRI RLI FSI PDI
  if (code === 0x200e || code === 0x200f) return true; // LRM / RLM
  if (code >= 0x200b && code <= 0x200c) return true; // ZWSP / ZWNJ
  if (code === 0x2060 || code === 0xfeff) return true; // WORD JOINER / ZWNBSP (BOM)
  return false;
}

/**
 * Strip control bytes, escape introducers, Unicode bidirectional overrides, and
 * the zero-width/format characters used for spoofing, keeping only newline and
 * tab, so untrusted content can never inject a terminal escape sequence, move
 * the cursor, or reorder the display (Trojan Source) (§4). Every renderer that
 * shows text originating outside the CLI applies this filter first.
 */
export function sanitize(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || ch === "\t") {
      out += ch;
      continue;
    }
    if (isForbiddenCodePoint(code)) continue;
    out += ch;
  }
  return out;
}

/** The named palette the UI renders by (§4.9). Each value is a color Ink/chalk
 * accepts (a hex string, a named 16-color, or `undefined` for monochrome). */
export interface ThemeTokens {
  /** purple-blue — the `┃` user bar, streaming cursor, mode tag. */
  brand: string | undefined;
  /** teal — wordmark, markdown headings, active panel tabs. */
  accent: string | undefined;
  /** teal — alias of accent for markdown headings (§4.3). */
  heading: string | undefined;
  /** bright blue — info glyphs, links, the workspace path in the status bar. */
  info: string | undefined;
  /** bright blue — alias of info for links (§4.3). */
  link: string | undefined;
  /** cyan — the git branch segment. */
  branchColor: string | undefined;
  /** warm orange — memory rows, the running-task `⟳` segment. */
  memory: string | undefined;
  /** muted blue — panel borders, section dividers. */
  border: string | undefined;
  /** cyan — inline code spans. */
  code: string | undefined;
  /** gray/dim — fenced code block body. */
  codeBlock: string | undefined;
  /** green — tool success `●`, diff additions. */
  success: string | undefined;
  /** yellow — `⚠` lines, the spinner, context notice/compaction. */
  warning: string | undefined;
  /** red — `✗` lines, diff deletions, overflow. */
  error: string | undefined;
  /** default fg, dimmed — timestamps, summaries, hints, separators. */
  dim: string | undefined;
}

/** The 24-bit palette (§4.9) — the old implementation's identity. */
const HEX = {
  brand: "#6a7ec8",
  accent: "#4ec9b0",
  info: "#61afef",
  branchColor: "#00d4ff",
  memory: "#d19a66",
  border: "#5a6aa8",
} as const;

/** The 16-color nearest match for each hex token (§4.9) — used at ansi16. */
const ANSI16 = {
  brand: "blue",
  accent: "cyan",
  info: "blue",
  branchColor: "cyan",
  memory: "yellow",
  border: "blue",
} as const;

function buildTheme(depth: ColorDepth): ThemeTokens {
  if (depth === "none") {
    return {
      brand: undefined, accent: undefined, heading: undefined, info: undefined, link: undefined,
      branchColor: undefined, memory: undefined, border: undefined, code: undefined,
      codeBlock: undefined, success: undefined, warning: undefined, error: undefined, dim: undefined,
    };
  }
  // 24-bit and 256 both take the hex (Ink/chalk downsamples 256); 16 maps to
  // the nearest named color (§4.9).
  const p = depth === "ansi16" ? ANSI16 : HEX;
  return {
    brand: p.brand,
    accent: p.accent,
    heading: p.accent,
    info: p.info,
    link: p.info,
    branchColor: p.branchColor,
    memory: p.memory,
    border: p.border,
    code: "cyan",
    codeBlock: "gray",
    success: "green",
    warning: "yellow",
    error: "red",
    dim: "gray",
  };
}

/**
 * Resolve the theme to the detected capabilities (§4.9). `name` is accepted for
 * the §9.1 `apps.cli.theme` key; only `"default"` is defined and anything else
 * falls back to it.
 */
export function resolveTheme(caps: Capabilities, _name = "default"): ThemeTokens {
  return buildTheme(caps.colorDepth);
}

/** The braille spinner frames and interval (§4.2). The dynamic-region status
 * line repaints its spinner at most every 120 ms so nothing flickers while a
 * turn runs (buffered rendering, §1.4, §4.2). */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_INTERVAL = 120;

/** The glyph set, with ASCII fallbacks when the locale is not UTF-8 (§4.9). */
export interface Glyphs {
  /** `┃` user bar. */ userBar: string;
  /** `●` success / tool success. */ dot: string;
  /** `○` pending. */ pending: string;
  /** `✗` failure / error. */ failure: string;
  /** `•` bullet. */ bullet: string;
  /** `⎇` branch. */ branch: string;
  /** `ℹ` info. */ info: string;
  /** `⚠` warning. */ warn: string;
  /** `⊘` cancelled. */ cancelled: string;
  /** `◎` context meter. */ meter: string;
  /** `⟳` running tasks. */ tasks: string;
  /** `↻` model retry in progress. */ retry: string;
  /** `▊` streaming cursor. */ cursor: string;
  /** `❯` selection marker. */ caret: string;
  /** `⋯` reasoning. */ reasoning: string;
  /** `▾` expanded group caret. */ caretDown: string;
  /** `▸` collapsed group caret. */ caretRight: string;
}

const UNICODE_GLYPHS: Glyphs = {
  userBar: "┃", dot: "●", pending: "○", failure: "✗", bullet: "•", branch: "⎇",
  info: "ℹ", warn: "⚠", cancelled: "⊘", meter: "◎", tasks: "⟳", cursor: "▊",
  caret: "❯", reasoning: "⋯", retry: "↻", caretDown: "▾", caretRight: "▸",
};

const ASCII_GLYPHS: Glyphs = {
  userBar: "|", dot: "*", pending: "o", failure: "x", bullet: "*", branch: "branch:",
  info: "i", warn: "!", cancelled: "/", meter: "O", tasks: "@", cursor: "_",
  caret: ">", reasoning: "...", retry: "~", caretDown: "v", caretRight: ">",
};

/** Select the glyph set for the detected unicode capability (§4.9). */
export function resolveGlyphs(caps: Capabilities): Glyphs {
  return caps.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;
}

/** The block-letter `VoidRift` banner, rendered verbatim in `brand` (§5.1). */
export const BANNER = [
  "██╗   ██╗ ██████╗ ██╗██████╗ ██████╗ ██╗███████╗████████╗",
  "██║   ██║██╔═══██╗██║██╔══██╗██╔══██╗██║██╔════╝╚══██╔══╝",
  "██║   ██║██║   ██║██║██║  ██║██████╔╝██║█████╗     ██║   ",
  "╚██╗ ██╔╝██║   ██║██║██║  ██║██╔══██╗██║██╔══╝     ██║   ",
  " ╚████╔╝ ╚██████╔╝██║██████╔╝██║  ██║██║██║        ██║   ",
  "  ╚═══╝   ╚═════╝ ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ",
];

/** The banner's column width (all rows are equal length) — the threshold below
 * which the welcome falls back to a compact wordmark (§5.1). */
export const BANNER_WIDTH = [...BANNER[0]!].length;

/** The identity column rendered to the right of the banner (`Local-first AI
 * harness`, the widest identity line) and the gap between it and the banner
 * (`marginLeft={2}`), §5.1. */
const BANNER_IDENTITY = "Local-first AI harness";
const BANNER_GAP = 2;

/** The minimum terminal width that fits the full block-letter banner beside the
 * identity column (§5.1). Below it the welcome falls back to a compact
 * wordmark. Derived from the banner width + the gap + the identity column + the
 * one trailing column Ink needs free so a full-width row does not soft-wrap —
 * no magic number. */
export const WELCOME_FULL_MIN_COLUMNS = BANNER_WIDTH + BANNER_GAP + [...BANNER_IDENTITY].length + 1;

/** Whether the welcome renders the full banner at `columns` (§5.1). An unknown
 * width (no measurable terminal) renders the full banner. */
export function welcomeShowsFullBanner(columns: number | undefined): boolean {
  return columns === undefined || columns >= WELCOME_FULL_MIN_COLUMNS;
}

// ─── Display width & prefixed wrapping (§4.1) ────────────────────────────────

/**
 * The terminal display width of one code point: 0 for combining marks and
 * zero-width joiners/variation selectors, 2 for East-Asian wide/fullwidth and
 * emoji, 1 otherwise. A dependency-free approximation sufficient for layout
 * wrapping; it never under-counts a wide glyph, so a wrapped line never
 * overflows the target column.
 */
export function charWidth(cp: number): number {
  if (cp === 0) return 0;
  // Combining marks, zero-width space/joiner, variation selectors.
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff)
  ) {
    return 0;
  }
  // East-Asian wide / fullwidth and emoji ranges render in two cells.
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana..CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff) || // emoji / symbols
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B+
  ) {
    return 2;
  }
  return 1;
}

/** The display width of a string, summing per-code-point widths (§4.1). */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/** The content width every committed row is laid out within (§4.1): the
 * terminal `columns` less a two-column left margin and a two-column right
 * padding (`columns - 4`), floored at 20 so a very narrow terminal still has a
 * usable budget. No rendered row is ever wider than `columns - 2`. The single
 * source of truth for width used by every renderer. */
export function contentWidth(columns: number | undefined): number {
  return Math.max(20, (columns ?? 80) - 4);
}

/** Cut a string to at most `max` display columns, returning the slice and the
 * remainder. Never splits a surrogate pair; a single wide glyph wider than
 * `max` is still taken (so progress is always made). */
export function cutToWidth(s: string, max: number): [string, string] {
  let w = 0;
  let i = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0)!);
    if (w + cw > max && i > 0) break;
    w += cw;
    i += ch.length;
  }
  return [s.slice(0, i), s.slice(i)];
}

/**
 * Hard-break a string into chunks no wider than `width` display columns, with
 * the last two chunks REBALANCED so a lone one- or two-column tail is never
 * left on its own row (§4.1): a couple of columns are pulled up from the
 * penultimate chunk instead. Used by both the markdown inline wrapper and the
 * code-fence wrapper so an over-long word, URL or code line breaks the same way.
 */
export function hardBreakChunks(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const chunks: string[] = [];
  let rest = text;
  while (displayWidth(rest) > w) {
    const [head, tail] = cutToWidth(rest, w);
    chunks.push(head);
    rest = tail;
  }
  if (rest !== "") chunks.push(rest);
  if (chunks.length === 0) return [""];
  if (chunks.length >= 2 && displayWidth(chunks[chunks.length - 1]!) <= 2) {
    const prev = chunks[chunks.length - 2]!;
    const [h, t] = cutToWidth(prev, Math.max(1, displayWidth(prev) - 3));
    chunks[chunks.length - 2] = h;
    chunks[chunks.length - 1] = t + chunks[chunks.length - 1]!;
  }
  return chunks;
}

/**
 * Wrap `text` for a prefixed multi-line block (§4.1): the first line is laid out
 * after a leading glyph (`┃ `, the assistant `│`, …) and every continuation
 * line carries a hanging indent of the same visible width. Wrapping is on word
 * boundaries; a word longer than the available width is hard-broken by display
 * column. The available text width is `columns - indentWidth` (so the whole row
 * including the prefix fits `columns`), never less than 1, and a continuation
 * line is never a single orphaned character pulled off a longer word — the
 * break leaves at least the indent plus content on each line.
 *
 * Returns the content lines WITHOUT the prefix/indent; the caller renders the
 * prefix on line 0 and `" ".repeat(indentWidth)` on the rest. Hard line breaks
 * (`\n`) in the input start a new wrapped paragraph.
 */
export function wrapPrefixed(text: string, columns: number, indentWidth: number): string[] {
  const avail = Math.max(1, columns - indentWidth);
  const out: string[] = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (para === "") {
      out.push("");
      continue;
    }
    // Split on single spaces, preserving nothing fancier (tabs were sanitized
    // out of untrusted text already); runs of spaces collapse at a wrap point.
    const words = para.split(" ");
    let line = "";
    let lineW = 0;
    const flush = (): void => {
      out.push(line);
      line = "";
      lineW = 0;
    };
    for (let word of words) {
      // A word wider than the whole line is hard-broken across lines.
      while (displayWidth(word) > avail) {
        const roomForBreak = lineW > 0 ? avail - lineW - 1 : avail;
        if (roomForBreak <= 0) {
          flush();
          continue;
        }
        if (lineW > 0) {
          const [head, tail] = cutToWidth(word, roomForBreak);
          if (head === "") {
            flush();
            continue;
          }
          line += " " + head;
          flush();
          word = tail;
        } else {
          const [head, tail] = cutToWidth(word, avail);
          line = head;
          flush();
          word = tail;
        }
      }
      const wordW = displayWidth(word);
      if (lineW === 0) {
        line = word;
        lineW = wordW;
      } else if (lineW + 1 + wordW <= avail) {
        line += " " + word;
        lineW += 1 + wordW;
      } else {
        flush();
        line = word;
        lineW = wordW;
      }
    }
    flush();
  }
  // Drop a trailing empty paragraph artifact but keep intentional blank lines.
  return out.length === 0 ? [""] : out;
}

// ─── Tool display (§4.4) ─────────────────────────────────────────────────────

/** The friendly display name a tool's raw name maps to (§4.4). */
const TOOL_LABELS: Record<string, string> = {
  read_file: "Read", write_file: "Write", edit_file: "Edit",
  execute_command: "Run", workspace_map: "Map", glob_files: "Glob",
  search_contents: "Search", web_search: "Search", web_fetch: "Fetch",
  save_memory: "Remember", schedule: "Schedule",
  create_plan: "Plan", read_plan: "Plan", update_plan: "Plan", delete_plan: "Plan",
  add_plan: "Plan", remove_plan: "Plan", prioritize_plan: "Plan",
  escalate: "Escalate", deescalate: "De-escalate",
  task: "Task",
  spawn_subagent: "Subagent", run_task: "Task Agent", check_task: "Task Agent",
  list_memory: "Memories", list_skills: "Skills", load_skill: "Load Skill",
};

/** The semantic token for a tool's color (§4.4, §4.9). */
export type ToolColorRole =
  | "success" | "info" | "warning" | "branchColor" | "memory" | "brand" | "error" | "dim" | "accent";

const TOOL_COLOR_ROLES: Record<string, ToolColorRole> = {
  read_file: "success", search_contents: "success", glob_files: "success", workspace_map: "success",
  list_skills: "success", load_skill: "success",
  write_file: "info", edit_file: "info",
  execute_command: "warning",
  web_search: "branchColor", web_fetch: "branchColor",
  save_memory: "memory", list_memory: "memory", delete_memory: "memory",
  create_plan: "info", read_plan: "info", update_plan: "info", delete_plan: "info",
  add_plan: "info", remove_plan: "info", prioritize_plan: "info",
  escalate: "error", deescalate: "error",
  task: "accent",
  spawn_subagent: "accent", run_task: "accent", check_task: "accent", schedule: "accent",
};

/** The display name for a tool's raw name (§4.4). An MCP tool
 * `mcp_<server>_<tool>` renders `MCP:<server>:<tool>`; an unmapped tool shows
 * its raw name. */
export function toolDisplayName(name: string): string {
  if (name.startsWith("mcp_")) {
    const rest = name.slice(4);
    const idx = rest.indexOf("_");
    return idx >= 0 ? `MCP:${rest.slice(0, idx)}:${rest.slice(idx + 1)}` : `MCP:${rest}`;
  }
  return TOOL_LABELS[name] ?? name;
}

/** The theme color token for a tool row (§4.4). MCP → magenta (accent). */
export function toolColor(name: string, theme: ThemeTokens): string | undefined {
  if (name.startsWith("mcp_")) return theme.accent;
  const role = TOOL_COLOR_ROLES[name];
  if (!role) return theme.dim;
  return theme[role];
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** The one short, human argument shown on a tool row (§4.4) — never raw JSON. */
export function shortenArg(name: string, args: Record<string, unknown>): string {
  const s = (k: string): string => (typeof args[k] === "string" ? String(args[k]) : "");
  if (name.startsWith("mcp_")) {
    return truncate(Object.values(args).filter((v) => typeof v === "string").join(", "), 60);
  }
  switch (name) {
    case "read_file": {
      const range =
        args["offset"] !== undefined
          ? `:${Number(args["offset"]) + 1}-${Number(args["offset"] ?? 0) + (args["limit"] !== undefined ? Number(args["limit"]) : 0) || "end"}`
          : "";
      return `${s("path") || "file"}${range}`;
    }
    case "write_file":
    case "edit_file":
      return s("path") || "file";
    case "workspace_map": {
      const p = s("path");
      return !p || p === "." || p === "./" ? "(root)" : p;
    }
    case "glob_files":
      return s("pattern") || "pattern";
    case "search_contents":
      return `${s("pattern") || "pattern"}${s("include") ? ` in ${s("include")}` : ""}`;
    case "execute_command":
      return truncate(s("command") || "command", 80);
    case "web_search":
      return truncate(s("query") || "query", 60);
    case "web_fetch":
      return truncate(s("url") || "url", 60);
    case "save_memory":
      return s("title") || "memory";
    case "task": {
      // `● Task <role> <brief>` — the worker role then the one-line brief (§4.4).
      const role = s("role") || s("agent") || s("worker") || "";
      const brief = s("brief") || s("prompt") || s("description") || s("task") || "";
      return truncate([role, brief].filter(Boolean).join(" "), 80);
    }
    default: {
      const val = s("path") || s("command") || s("name") || s("query") || s("pattern");
      return truncate(val, 60);
    }
  }
}

/** Every argument joined, each truncated — shown under `showToolDetails` (§4.4). */
export function fullArgs(args: Record<string, unknown>, width = 60): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${truncate(sanitize(String(v)), width)}`)
    .join("  ");
}

/**
 * A one-line result summary — counts not content (§4.4). The raw tool result
 * is never dumped; a read shows `<n> lines`, Map `<n> files, <n> dirs`, etc.
 * Returns "" when there is nothing worth showing (suppressed for
 * `search_contents` and for errors, which render as error lines, §4.7).
 *
 * `width` caps the single-line form for an unmapped or MCP tool: its first line
 * is truncated to `width`, or shown as `<n> lines` when the result is
 * multi-line (§4.4).
 */
export function summarizeResult(name: string, result: string | undefined, width = 60): string {
  if (!result) return "";
  const r = result.trim();
  if (!r) return "";
  const lineCount = r.split("\n").length;
  switch (name) {
    case "read_file": {
      const m = r.match(/\((\d+)\s+lines?\)/);
      return m ? `${m[1]} lines` : `${lineCount} lines`;
    }
    case "workspace_map": {
      // The core returns a newline list where directory lines end in `/` and
      // file lines do not (`backend.ls`), or `(empty)` for an empty directory.
      if (/^\(empty\)/.test(r) || /^(Empty directory|No )/.test(r)) return r.split("\n")[0] ?? "";
      let dirs = 0;
      let files = 0;
      for (const line of r.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        if (t.endsWith("/")) dirs++;
        else files++;
      }
      const parts: string[] = [];
      if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
      if (dirs) parts.push(`${dirs} dir${dirs === 1 ? "" : "s"}`);
      return parts.join(", ") || `${lineCount} items`;
    }
    case "glob_files": {
      if (/^No files/.test(r)) return "no matches";
      const n = r.split("\n").filter(Boolean).length;
      return `${n} match${n === 1 ? "" : "es"}`;
    }
    case "search_contents":
      return ""; // suppressed (§4.4)
    case "write_file": {
      // Core: `Created <path> (<n> lines)` header (± a diff block) — §4.1
      // "wrote 12 lines". Count from the header; fall back to raw line count.
      const m = r.match(/\((\d+)\s+lines?\)/);
      return `wrote ${m ? m[1] : lineCount} lines`;
    }
    case "edit_file": {
      // Core: `Edited <path>` + a unified-diff block (no count). Derive the
      // changed-line count from the diff's `+`/`-` lines, excluding the
      // `+++`/`---` file headers (§4.4 verb+count form).
      let changed = 0;
      for (const line of r.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+") || line.startsWith("-")) changed++;
      }
      return `edited ${changed} line${changed === 1 ? "" : "s"}`;
    }
    case "execute_command": {
      const m = r.match(/^Exit code (\d+)/);
      return m ? `exit ${m[1]}` : `${lineCount} line${lineCount === 1 ? "" : "s"} out`;
    }
    case "list_memory":
    case "list_skills": {
      if (/^No /.test(r)) return "none";
      const n = r.split("\n").filter((l) => l.trim().startsWith("-")).length;
      return n ? `${n} item${n === 1 ? "" : "s"}` : "";
    }
    case "web_search": {
      const n = r.split("\n\n").filter(Boolean).length;
      return n ? `${n} result${n === 1 ? "" : "s"}` : "";
    }
    default: {
      // Unmapped / MCP tool: first line truncated to `width`, or `<n> lines`
      // when the result spans multiple lines — never the raw body (§4.4).
      if (lineCount > 1) return `${lineCount} lines`;
      return truncate(r, width);
    }
  }
}

// ─── Diff classification (§4.5) ──────────────────────────────────────────────

/** A classified diff line for per-line coloring (§4.5). */
export type DiffLineKind = "add" | "del" | "hunk" | "context";

/** Classify a unified-diff line by its leading marker (§4.5). */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/** The color token for a classified diff line, or undefined for context (§4.5). */
export function diffLineColor(kind: DiffLineKind, theme: ThemeTokens): string | undefined {
  switch (kind) {
    case "add":
      return theme.success;
    case "del":
      return theme.error;
    case "hunk":
      return theme.branchColor;
    case "context":
      return undefined;
  }
}

// ─── Hyperlinks (§4.8) ───────────────────────────────────────────────────────

const OSC8_SCHEMES = /^(https?:|file:)/i;

/**
 * True when path `p` is `root` itself or lies strictly inside it, by path
 * segment — not a raw string prefix. `/root-evil` is NOT inside `/root`
 * (prefix match) but `/root/x` is. A trailing slash on `root` is normalized
 * away so `/root/` and `/root` behave identically.
 */
function isInside(p: string, root: string): boolean {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  if (p === base) return true;
  return p.startsWith(base + "/");
}

/**
 * Build an OSC 8 hyperlink for `url`, gated by capability and scheme (§4.8).
 * Only `http(s):` links and workspace-contained `file:` links become clickable;
 * a `file:` URL emits plain text unless a non-empty `workspaceRoot` is supplied
 * and the target resolves inside it (so an undefined/empty root never produces a
 * `file:///etc/passwd` link).
 *
 * Two further defenses apply to the OSC 8 *target* (not only the visible label):
 * an http(s) URL that carries userinfo (`user:pw@host`) is refused — the
 * credential is never written into the terminal escape, so a hostile link
 * cannot leak it; and the URL itself is passed through `sanitize()` before it is
 * embedded, so a control/ESC byte smuggled into the target (`https://h/a\x1b[2Jb`)
 * can never inject its own terminal sequence. If either check fails the plain
 * label is returned.
 */
export function hyperlink(label: string, url: string, caps: Capabilities, workspaceRoot?: string): string {
  const safeLabel = sanitize(label);
  if (!caps.hyperlinks) return safeLabel;
  if (!OSC8_SCHEMES.test(url)) return safeLabel;
  if (/^https?:/i.test(url)) {
    // Reject any http(s) target carrying userinfo — never emit user:pw@host
    // into the OSC 8 escape (credential leak).
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return safeLabel;
    }
    if (parsed.username !== "" || parsed.password !== "") return safeLabel;
  }
  if (/^file:/i.test(url)) {
    if (!workspaceRoot) return safeLabel; // no root → never emit a file: link
    const p = url.replace(/^file:\/\//i, "");
    if (!isInside(p, workspaceRoot)) return safeLabel;
  }
  // Sanitize the target too: a control/ESC byte in the url must never reach the
  // terminal raw. If sanitization changed the url, a sequence was smuggled in —
  // refuse the link entirely.
  const safeUrl = sanitize(url);
  if (safeUrl !== url) return safeLabel;
  return `\x1b]8;;${safeUrl}\x1b\\${safeLabel}\x1b]8;;\x1b\\`;
}
