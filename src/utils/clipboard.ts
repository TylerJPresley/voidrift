/**
 * Clipboard image support.
 * Checks for image data in the system clipboard and saves it to a temp file.
 * Supports Linux (Wayland via wl-paste, X11 via xclip) and macOS.
 */
import { execSync, spawnSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join } from "path";

type ClipboardTool = "wl-paste" | "xclip" | "osascript" | null;

let detectedTool: ClipboardTool | undefined;

function detectTool(): ClipboardTool {
  if (detectedTool !== undefined) return detectedTool;

  if (process.platform === "darwin") {
    detectedTool = "osascript";
    return detectedTool;
  }

  if (process.platform === "linux") {
    const session = process.env.XDG_SESSION_TYPE;
    const tool = session === "wayland" ? "wl-paste" : "xclip";
    try {
      execSync(`command -v ${tool}`, { stdio: "ignore" });
      detectedTool = tool;
    } catch {
      detectedTool = null;
    }
    return detectedTool;
  }

  detectedTool = null;
  return null;
}

export function clipboardHasImage(): boolean {
  const tool = detectTool();
  try {
    if (tool === "wl-paste") {
      const types = execSync("wl-paste --list-types", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return types.includes("image/");
    }
    if (tool === "xclip") {
      const targets = execSync("xclip -selection clipboard -t TARGETS -o", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return targets.includes("image/");
    }
    if (tool === "osascript") {
      const info = execSync("osascript -e 'clipboard info'", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      return /PNGf|TIFF|JPEG/.test(info);
    }
  } catch {}
  return false;
}

export function saveClipboardImage(workspaceRoot: string): string | null {
  const tool = detectTool();
  if (!tool) return null;

  const dir = join(workspaceRoot, ".voidrift", "cache", "clipboard");
  mkdirSync(dir, { recursive: true });
  const filename = `paste-${Date.now()}.png`;
  const filePath = join(dir, filename);

  try {
    if (tool === "wl-paste") {
      const result = spawnSync("wl-paste", ["--no-newline", "--type", "image/png"], { maxBuffer: 10 * 1024 * 1024 });
      if (result.status !== 0 || !result.stdout.length) return null;
      writeFileSync(filePath, result.stdout);
    } else if (tool === "xclip") {
      const result = spawnSync("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"], { maxBuffer: 10 * 1024 * 1024 });
      if (result.status !== 0 || !result.stdout.length) return null;
      writeFileSync(filePath, result.stdout);
    } else if (tool === "osascript") {
      const script = `
        try
          set imageData to the clipboard as «class PNGf»
          set fileRef to open for access POSIX file "${filePath}" with write permission
          write imageData to fileRef
          close access fileRef
          return "success"
        on error
          return "error"
        end try
      `;
      const out = execSync(`osascript -e '${script}'`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (out !== "success") return null;
    }

    // Verify file was written
    if (!existsSync(filePath) || statSync(filePath).size === 0) return null;
    return filePath;
  } catch {
    return null;
  }
}
