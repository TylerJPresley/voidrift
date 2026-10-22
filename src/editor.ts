/**
 * External editor compose (cli-blueprint.md §3.8).
 *
 * `Ctrl+X` (or `/editor`) composes input in an external editor. This is a
 * CLIENT concern (§1.2 editor.ts): the CLI owns the editor resolution, the temp
 * file, and the Ink suspend/restore; the edited text returns to `InputBar` as
 * ordinary input (§3.8). The editor composes INPUT ONLY and never edits
 * workspace files — the model edits through gated tools (core §9).
 *
 * Spawn safety: the editor is run through `node:child_process` with an ARGUMENT
 * ARRAY (the command and the temp-file path) and `shell: false`, so a path or
 * editor name is never interpreted by a shell. A terminal editor takes over the
 * TTY and runs SYNCHRONOUSLY (`spawnSync`, stdio inherited); a GUI editor is
 * spawned DETACHED and unref'd. The temp file is always cleaned up.
 */
import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Terminal editors that take over the TTY and run synchronously (§3.8). */
const TERMINAL_EDITORS = new Set(["nano", "vim", "nvim", "emacs", "vi", "micro", "ne"]);

/** The environment subset editor resolution reads (a testable seam, §3.8). */
export interface EditorEnv {
  VISUAL?: string | undefined;
  EDITOR?: string | undefined;
}

/** A resolved editor: the command, its arg array, and whether it is terminal. */
export interface ResolvedEditor {
  command: string;
  args: string[];
  terminal: boolean;
}

/**
 * Resolve the editor command: `apps.cli.editor`, then `$VISUAL`, then `$EDITOR`
 * (§3.8, §9.1). The command string is split on whitespace so a configured
 * `"code --wait"` keeps its flags; the first token names the binary and decides
 * whether it is a terminal editor. Returns `null` when nothing is configured.
 */
export function resolveEditor(configured: string | undefined, env: EditorEnv): ResolvedEditor | null {
  const raw = (configured ?? env.VISUAL ?? env.EDITOR ?? "").trim();
  if (raw === "") return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  const command = parts[0]!;
  const args = parts.slice(1);
  // The binary name may carry a path; the basename decides terminal vs GUI.
  const base = command.split(/[\\/]/).pop() ?? command;
  return { command, args, terminal: TERMINAL_EDITORS.has(base) };
}

/** The sync spawn seam (terminal editors): run and block until the editor exits. */
export type RunSync = (command: string, args: string[]) => void;

/** The detached spawn seam (GUI editors): launch and return without waiting. */
export type RunDetached = (command: string, args: string[]) => void;

/** The default sync run: `spawnSync` with inherited stdio and `shell: false`. */
export const defaultRunSync: RunSync = (command, args) => {
  spawnSync(command, args, { stdio: "inherit", shell: false });
};

/** The default detached run: `spawn` detached, stdio ignored, then unref. */
export const defaultRunDetached: RunDetached = (command, args) => {
  const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
  child.unref();
};

/** The Ink suspend/restore hooks the compose flow drives around a terminal editor. */
export interface InkControl {
  /** Suspend Ink before a terminal editor takes over the TTY (§3.8). */
  suspend: () => void;
  /** Resume Ink after the editor returns. */
  resume: () => void;
  /** Re-hide the terminal cursor so Ink's inverse cursor is the only one (§3.8). */
  hideCursor: () => void;
}

export interface EditorDeps {
  env?: EditorEnv;
  runSync?: RunSync;
  runDetached?: RunDetached;
  ink?: InkControl;
}

/**
 * Compose input in an external editor and return the edited buffer (§3.8).
 *
 * The initial buffer is written to a temp file, the editor is executed with an
 * argument array (`[...args, tempPath]`, `shell: false`), and the file is read
 * back and returned. A terminal editor suspends Ink, runs synchronously, then
 * resumes Ink and re-hides the cursor; a GUI editor is spawned detached (the
 * CLI does not wait, so a detached editor returns the unchanged buffer). The
 * temp file is always removed. Returns the original buffer unchanged when no
 * editor is configured (a silent no-op).
 */
export async function composeInEditor(
  initial: string,
  configured: string | undefined,
  deps: EditorDeps = {},
): Promise<string> {
  const env: EditorEnv = deps.env ?? { VISUAL: process.env["VISUAL"], EDITOR: process.env["EDITOR"] };
  const editor = resolveEditor(configured, env);
  if (!editor) return initial; // no editor configured — silent no-op

  const dir = await mkdtemp(join(tmpdir(), "voidrift-compose-"));
  const tempPath = join(dir, "input.txt");
  const args = [...editor.args, tempPath];
  try {
    await writeFile(tempPath, initial);
    if (editor.terminal) {
      const run = deps.runSync ?? defaultRunSync;
      deps.ink?.suspend();
      try {
        run(editor.command, args);
      } finally {
        deps.ink?.resume();
        deps.ink?.hideCursor();
      }
      const edited = await readFile(tempPath, "utf8");
      return edited.replace(/\n$/, ""); // drop the editor's trailing newline
    }
    // GUI editor: spawn detached and return the buffer unchanged (not awaited).
    const runDetached = deps.runDetached ?? defaultRunDetached;
    runDetached(editor.command, args);
    return initial;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Open an EXISTING file at `path` in the external editor (`/config edit`, §7.3).
 * Unlike {@link composeInEditor} this edits a real file in place (it is not
 * input composition and returns no text). A terminal editor suspends Ink, runs
 * synchronously, then resumes Ink and re-hides the cursor; a GUI editor is
 * spawned detached. No editor configured is a silent no-op. Returns whether an
 * editor was launched.
 */
export async function editFile(
  path: string,
  configured: string | undefined,
  deps: EditorDeps = {},
): Promise<boolean> {
  const env: EditorEnv = deps.env ?? { VISUAL: process.env["VISUAL"], EDITOR: process.env["EDITOR"] };
  const editor = resolveEditor(configured, env);
  if (!editor) return false; // no editor configured — silent no-op
  const args = [...editor.args, path];
  if (editor.terminal) {
    const run = deps.runSync ?? defaultRunSync;
    deps.ink?.suspend();
    try {
      run(editor.command, args);
    } finally {
      deps.ink?.resume();
      deps.ink?.hideCursor();
    }
    return true;
  }
  const runDetached = deps.runDetached ?? defaultRunDetached;
  runDetached(editor.command, args);
  return true;
}
