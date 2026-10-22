/**
 * `--prompt` argument resolution (cli-blueprint.md §2.3).
 *
 * The argument is a file path when it names an existing readable file, else
 * literal text. `@<path>` forces a file read (bounded by `workspaceMaxReadLines`);
 * `-` reads stdin; piped stdin is appended to the resolved prompt. A forced file
 * that cannot be read is a usage error (exit 2). File I/O is injected so the
 * resolver is deterministic and offline in tests.
 */

export interface ResolveDeps {
  /** Read a file to a string, or throw when it cannot be read. */
  readFile: (path: string) => Promise<string>;
  /** True when the path names an existing readable file. */
  isReadableFile: (path: string) => Promise<boolean>;
  /** Read all of stdin, or undefined when nothing is piped. */
  readStdin: () => Promise<string | undefined>;
  /** The `workspaceMaxReadLines` bound the core applies to file reads (§8.6). */
  maxReadLines: number;
}

export type ResolveResult =
  | { ok: true; prompt: string }
  | { ok: false; usageError: string };

/** Truncate content to at most `maxLines` lines (§2.3, §8.6). */
export function boundLines(content: string, maxLines: number): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join("\n");
}

/** Append piped stdin to a resolved prompt per the §2.3 contract. */
function withStdin(prompt: string, stdin: string | undefined): string {
  if (stdin === undefined || stdin === "") return prompt;
  return `${prompt}\n\n---\n\n${stdin}`;
}

/** Resolve the `--prompt` argument to the prompt text to send (§2.3). */
export async function resolvePrompt(arg: string, deps: ResolveDeps): Promise<ResolveResult> {
  // Forced file: @<path> — verbatim single path, no glob/shell expansion.
  if (arg.startsWith("@")) {
    const path = arg.slice(1);
    try {
      const content = boundLines(await deps.readFile(path), deps.maxReadLines);
      const stdin = await deps.readStdin();
      return { ok: true, prompt: withStdin(content, stdin) };
    } catch {
      return { ok: false, usageError: `cannot read forced prompt file "${path}"` };
    }
  }

  // stdin: `-`.
  if (arg === "-") {
    const stdin = (await deps.readStdin()) ?? "";
    return { ok: true, prompt: stdin };
  }

  // Existing readable file → file; else literal text.
  if (await deps.isReadableFile(arg)) {
    const content = boundLines(await deps.readFile(arg), deps.maxReadLines);
    const stdin = await deps.readStdin();
    return { ok: true, prompt: withStdin(content, stdin) };
  }

  const stdin = await deps.readStdin();
  return { ok: true, prompt: withStdin(arg, stdin) };
}
