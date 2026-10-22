/**
 * Clipboard image paste (cli-blueprint.md §3.7).
 *
 * `Ctrl+V` reads an image from the clipboard with a platform-aware tool and
 * saves it under the client-owned cache subtree the core never writes or prunes
 * (core §4.5). Everything here is a CLIENT concern (§1.2 clipboard.ts): the CLI
 * owns the clipboard tool, the PNG validation, and the on-disk cache; the saved
 * path becomes ordinary structured input the CLI hands to `session.send`
 * (§3.7, §2.3) — no business logic.
 *
 * Spawn safety: the tool is run through `node:child_process.execFile` with an
 * ARGUMENT ARRAY and `shell: false`, so no clipboard value or environment
 * variable is ever interpreted by a shell. The returned bytes are validated by
 * PNG magic bytes before anything is written; with no tool or no image the
 * paste is a silent no-op (never a crash, never an error dialog).
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The PNG signature: 89 50 4E 47 0D 0A 1A 0A (§3.7). */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** True when the buffer begins with the 8-byte PNG signature (§3.7). */
export function isPng(data: Buffer): boolean {
  return data.length >= PNG_MAGIC.length && data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

/** A spawned clipboard tool: the command plus its argument array (never a shell). */
export interface ClipboardTool {
  command: string;
  args: string[];
}

/** The environment subset tool selection reads (a testable seam, §3.7). */
export interface ClipboardEnv {
  platform: NodeJS.Platform;
  WAYLAND_DISPLAY?: string | undefined;
  DISPLAY?: string | undefined;
}

/**
 * Resolve the platform-aware clipboard tool (§3.7):
 * - macOS (`platform === "darwin"`): `osascript` writing PNG to stdout.
 * - Wayland (`WAYLAND_DISPLAY` set): `wl-paste --type image/png`.
 * - X11 (`DISPLAY` set): `xclip -selection clipboard -target image/png -o`.
 * Returns `null` when no tool fits the platform (a silent no-op upstream).
 */
export function resolveClipboardTool(env: ClipboardEnv): ClipboardTool | null {
  if (env.platform === "darwin") {
    // Emit the clipboard PNG as raw bytes on stdout via AppleScript.
    return {
      command: "osascript",
      args: [
        "-e",
        "set png to (the clipboard as «class PNGf»)",
        "-e",
        "set fp to (open for access (POSIX file \"/dev/stdout\") with write permission)",
        "-e",
        "write png to fp",
        "-e",
        "close access fp",
      ],
    };
  }
  if (env.WAYLAND_DISPLAY) {
    return { command: "wl-paste", args: ["--type", "image/png"] };
  }
  if (env.DISPLAY) {
    return { command: "xclip", args: ["-selection", "clipboard", "-target", "image/png", "-o"] };
  }
  return null;
}

/** The spawn seam: run a tool with an argument array and return its stdout bytes. */
export type SpawnBytes = (command: string, args: string[]) => Promise<Buffer>;

/** The default spawn: `execFile` with `shell: false` and a binary-safe buffer. */
export const defaultSpawnBytes: SpawnBytes = (command, args) =>
  new Promise<Buffer>((resolve, reject) => {
    execFile(
      command,
      args,
      { shell: false, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error instanceof Error ? error : new Error("clipboard tool failed"));
        else resolve(stdout as unknown as Buffer);
      },
    );
  });

export interface ClipboardDeps {
  env?: ClipboardEnv;
  spawn?: SpawnBytes;
  /** Clock seam for the `{timestamp}.png` filename (defaults to `Date.now`). */
  now?: () => number;
}

/** The result of a successful paste: the token for the buffer and the saved path. */
export interface PasteResult {
  token: string;
  path: string;
}

/**
 * Read a clipboard image, validate it, and save it under the client-owned cache
 * subtree `.voidrift/cache/apps/cli/clipboard/{sessionId}/{timestamp}.png`
 * (core §4.5). Returns the reference token and absolute path on success, or
 * `null` on any failure — no tool, no image, a non-PNG payload, or a spawn
 * error — so the caller can treat a miss as a silent no-op (§3.7).
 */
export async function pasteClipboardImage(
  workspaceRoot: string,
  sessionId: string,
  deps: ClipboardDeps = {},
): Promise<PasteResult | null> {
  const env: ClipboardEnv = deps.env ?? {
    platform: process.platform,
    WAYLAND_DISPLAY: process.env["WAYLAND_DISPLAY"],
    DISPLAY: process.env["DISPLAY"],
  };
  const tool = resolveClipboardTool(env);
  if (!tool) return null; // no clipboard tool for this platform — silent no-op

  const spawn = deps.spawn ?? defaultSpawnBytes;
  let data: Buffer;
  try {
    data = await spawn(tool.command, tool.args);
  } catch {
    return null; // tool missing or no image on the clipboard — silent no-op
  }
  if (!data || !isPng(data)) return null; // not a PNG — silent no-op

  const timestamp = (deps.now ?? Date.now)();
  const dir = join(workspaceRoot, ".voidrift", "cache", "apps", "cli", "clipboard", sessionId);
  const path = join(dir, `${timestamp}.png`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, data);
  } catch {
    return null; // cannot write the cache — silent no-op
  }
  return { token: `[image: ${path}]`, path };
}
