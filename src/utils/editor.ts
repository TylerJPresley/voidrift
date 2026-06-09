import { execSync, spawn, spawnSync } from "child_process";
import type { EditorType } from "../config/loader.js";

/** Platform-specific command resolution for each editor */
const EDITOR_COMMANDS: Record<EditorType, { win32: string; default: string }> = {
  vscode: { win32: "code.cmd", default: "code" },
  code: { win32: "code.cmd", default: "code" },
  cursor: { win32: "cursor.cmd", default: "cursor" },
  windsurf: { win32: "windsurf.cmd", default: "windsurf" },
  zed: { win32: "zed", default: "zed" },
  vim: { win32: "vim", default: "vim" },
  nvim: { win32: "nvim", default: "nvim" },
  neovim: { win32: "nvim", default: "nvim" },
  emacs: { win32: "emacs", default: "emacs" },
  nano: { win32: "nano", default: "nano" },
  subl: { win32: "subl.exe", default: "subl" },
  kate: { win32: "kate", default: "kate" },
};

const TERMINAL_EDITORS: EditorType[] = ["vim", "nvim", "neovim", "emacs", "nano"];

function getCommand(editor: EditorType): string {
  const entry = EDITOR_COMMANDS[editor];
  return process.platform === "win32" ? entry.win32 : entry.default;
}

/** Check if a command exists in PATH */
export function commandExists(cmd: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where.exe ${cmd}` : `command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Validate that the configured editor is available on this system */
export function validateEditor(editor: EditorType): string | null {
  const cmd = getCommand(editor);
  if (!commandExists(cmd)) {
    return `Editor "${editor}" not found. Command "${cmd}" is not in PATH.`;
  }
  return null;
}

/** Open a file in the configured editor. Non-blocking for GUI editors. */
export function openInEditor(filePath: string, editor: EditorType): { success: boolean; error?: string } {
  const cmd = getCommand(editor);

  if (!commandExists(cmd)) {
    return { success: false, error: `"${cmd}" not found in PATH` };
  }

  const isTerminal = TERMINAL_EDITORS.includes(editor);

  if (isTerminal) {
    // Terminal editors need stdio: inherit and block
    const result = spawnSync(cmd, [filePath], { stdio: "inherit" });
    process.stdout.write("\x1B[?25l"); // re-hide cursor after editor restores it
    if (result.error) return { success: false, error: result.error.message };
    return { success: true };
  }

  // GUI editors: fire and forget
  const child = spawn(cmd, [filePath], { stdio: "ignore", detached: true });
  child.unref();
  return { success: true };
}
