/**
 * WriteContext: file operations with sandboxing, pagination, snapshots (REQ-FSZ-1..5, REQ-SEC-1).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";

export class WriteContext {
  private _projectDir: string;
  private _maxReadLines: number;
  private _maxReadBytes: number;
  private _protectedPaths: Set<string>;
  private _sourceWriteCount = 0;
  private _writtenThisRun = new Set<string>();
  private _sessionFiles: string[] = [];
  private _mtimeRegistry = new Map<string, number>();
  private _readFiles: string[] = [];
  private _snapshots: Map<string, string | null> | null = null;

  constructor(opts: { projectDir: string; maxReadLines?: number; maxReadBytes?: number; protectedPaths?: string[] }) {
    this._projectDir = resolve(opts.projectDir);
    this._maxReadLines = opts.maxReadLines ?? 2000;
    this._maxReadBytes = opts.maxReadBytes ?? 524288;
    this._protectedPaths = new Set(opts.protectedPaths ?? []);
  }

  // -- Sandbox checks --

  private _checkSandbox(path: string, full: string, root: string): string | null {
    const resolved = resolve(full);
    const rootResolved = resolve(root);
    if (!resolved.startsWith(rootResolved + "/") && resolved !== rootResolved) {
      return `Access denied: ${path} resolves outside project root.`;
    }
    return null;
  }

  private _checkProtected(path: string): string | null {
    if (this._protectedPaths.has(path)) return `Access denied: ${path} is a protected path.`;
    return null;
  }

  private _isFrameworkPath(path: string): boolean {
    return path.startsWith(".voidrift/") || path.startsWith(".voidrift\\");
  }

  // -- Read --

  private _readWithGuard(full: string, displayPath: string, offset: number, limit: number | null): string {
    if (!existsSync(full)) return `Error: ${displayPath} not found.`;
    const content = readFileSync(full, "utf-8");
    const lines = content.split("\n");
    const effectiveLimit = limit ?? this._maxReadLines;
    const start = offset;
    const end = Math.min(lines.length, start + effectiveLimit);
    const slice = lines.slice(start, end);
    let result = slice.join("\n");

    // Pagination warning (REQ-FSZ-1)
    if (limit == null && lines.length > effectiveLimit && offset === 0) {
      result = `WARNING: ${displayPath} has ${lines.length} lines. Returning lines 1–${effectiveLimit}. Use offset=${effectiveLimit} to read the next chunk.\n\n` + result;
    }

    // Byte guard (REQ-FSZ-5)
    if (this._maxReadBytes > 0) {
      const bytes = Buffer.byteLength(result, "utf-8");
      if (bytes > this._maxReadBytes) {
        result = Buffer.from(result, "utf-8").subarray(0, this._maxReadBytes).toString("utf-8");
        result += `\n\n[TRUNCATED: ${bytes} bytes total, showing first ${this._maxReadBytes} bytes. Use offset/limit to paginate.]`;
      }
    }

    this._readFiles.push(displayPath);
    return result;
  }

  readSourceFile(path: string, offset = 0, limit: number | null = null): string {
    const full = join(this._projectDir, path);
    const err = this._checkSandbox(path, full, this._projectDir);
    if (err) return err;
    return this._readWithGuard(full, path, offset, limit);
  }

  readFrameworkFile(path: string, offset = 0, limit: number | null = null): string {
    const fwPath = path.startsWith(".voidrift/") ? path : `.voidrift/${path}`;
    const full = join(this._projectDir, fwPath);
    return this._readWithGuard(full, fwPath, offset, limit);
  }

  // -- Write --

  writeSourceFile(path: string, content: string, forceWrite = false): string {
    if (this._isFrameworkPath(path)) return "Access denied: use writeFrameworkFile for .voidrift/ paths.";
    const full = join(this._projectDir, path);
    const err = this._checkSandbox(path, full, this._projectDir) ?? this._checkProtected(path);
    if (err) return err;

    // Size guard (REQ-FSZ-2)
    const lineCount = content.split("\n").length;
    if (lineCount > this._maxReadLines) {
      return `Error: ${path} has ${lineCount} lines, exceeds the max_read_lines limit (${this._maxReadLines}). Decompose into smaller files.`;
    }

    // Mtime check (REQ-D-19)
    if (!forceWrite) {
      const mErr = this._checkMtime(path, full);
      if (mErr) return mErr;
    }

    this._snapshotBeforeWrite(path, full);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
    this._sourceWriteCount++;
    this._writtenThisRun.add(path);
    this._sessionFiles.push(path);
    this._recordMtime(path, full);
    return `Wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${path}`;
  }

  writeFrameworkFile(path: string, content: string): string {
    const fwPath = path.startsWith(".voidrift/") ? path : `.voidrift/${path}`;
    const full = join(this._projectDir, fwPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
    this._sessionFiles.push(fwPath);
    return `Wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${fwPath}`;
  }

  // -- Edit --

  editSourceFile(path: string, oldStr: string, newStr: string): string {
    const full = join(this._projectDir, path);
    const err = this._checkSandbox(path, full, this._projectDir);
    if (err) return err;
    if (!existsSync(full)) return `Error: ${path} not found.`;

    const content = readFileSync(full, "utf-8");
    const count = content.split(oldStr).length - 1;

    if (count === 0) {
      // Try whitespace-normalized match
      const normOld = oldStr.split("\n").map(l => l.trim()).join("\n");
      const normContent = content.split("\n").map(l => l.trim()).join("\n");
      if (normContent.includes(normOld)) {
        // Find the original lines and replace preserving indentation
        const oldLines = oldStr.split("\n");
        const first3 = oldLines.slice(0, 3).join("\n");
        return this._doEdit(full, path, content, oldStr, newStr, true);
      }
      const preview = oldStr.split("\n").slice(0, 3).join("\n");
      return `Error: old_str not found in ${path}. First 3 lines:\n${preview}`;
    }
    if (count > 1) {
      return `Error: old_str appears ${count} times in ${path}. Add surrounding context for uniqueness.`;
    }

    return this._doEdit(full, path, content, oldStr, newStr, false);
  }

  private _doEdit(full: string, path: string, content: string, oldStr: string, newStr: string, normalized: boolean): string {
    let result: string;
    if (normalized) {
      // Whitespace-normalized replacement
      const lines = content.split("\n");
      const oldLines = oldStr.split("\n").map(l => l.trim());
      let startIdx = -1;
      for (let i = 0; i <= lines.length - oldLines.length; i++) {
        let match = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (lines[i + j].trim() !== oldLines[j]) { match = false; break; }
        }
        if (match) { startIdx = i; break; }
      }
      if (startIdx === -1) return `Error: old_str not found in ${path} even after normalization.`;
      const before = lines.slice(0, startIdx);
      const after = lines.slice(startIdx + oldLines.length);
      result = [...before, newStr, ...after].join("\n");
    } else {
      result = content.replace(oldStr, newStr);
    }

    this._snapshotBeforeWrite(path, full);
    writeFileSync(full, result, "utf-8");
    this._sourceWriteCount++;
    this._writtenThisRun.add(path);
    this._sessionFiles.push(path);
    this._recordMtime(path, full);
    const suffix = normalized ? " (whitespace-normalized match)" : "";
    return `Edited ${path} — replaced ${oldStr.length} chars with ${newStr.length} chars${suffix}`;
  }

  // -- Delete --

  deleteSourceFile(path: string): string {
    const full = join(this._projectDir, path);
    const err = this._checkSandbox(path, full, this._projectDir) ?? this._checkProtected(path);
    if (err) return err;
    if (!existsSync(full)) return `Error: ${path} not found.`;
    this._snapshotBeforeWrite(path, full);
    unlinkSync(full);
    this._sessionFiles.push(path);
    return `Deleted ${path}`;
  }

  // -- List --

  listProjectArtifacts(): string {
    const d = join(this._projectDir, ".voidrift");
    if (!existsSync(d)) return "No .voidrift/ directory found.";
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(relative(this._projectDir, full));
      }
    };
    walk(d);
    return files.sort().join("\n");
  }

  // -- Mtime tracking (REQ-D-19) --

  private _checkMtime(path: string, full: string): string | null {
    const recorded = this._mtimeRegistry.get(path);
    if (recorded === undefined) return null;
    if (!existsSync(full)) return null;
    const current = statSync(full).mtimeMs;
    if (Math.abs(current - recorded) > 50) {
      return `Warning: ${path} was modified externally since last write. Use force_write=true to override.`;
    }
    return null;
  }

  private _recordMtime(path: string, full: string): void {
    try { this._mtimeRegistry.set(path, statSync(full).mtimeMs); } catch { /* */ }
  }

  // -- Snapshots (REQ-D-15) --

  private _snapshotBeforeWrite(path: string, full: string): void {
    if (!this._snapshots) return;
    if (this._snapshots.has(path)) return;
    this._snapshots.set(path, existsSync(full) ? readFileSync(full, "utf-8") : null);
  }

  setSnapshots(): void { this._snapshots = new Map(); }
  getSnapshots(): Map<string, string | null> | null { return this._snapshots; }
  clearSnapshots(): void { this._snapshots = null; }

  rollbackSnapshots(): void {
    if (!this._snapshots) return;
    for (const [path, original] of this._snapshots) {
      const full = join(this._projectDir, path);
      if (original === null) {
        if (existsSync(full)) unlinkSync(full);
      } else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, original, "utf-8");
      }
    }
    this._snapshots = null;
  }

  computeDiffStats(): Array<{ path: string; status: string; linesAdded: number; linesRemoved: number }> {
    if (!this._snapshots) return [];
    const stats: Array<{ path: string; status: string; linesAdded: number; linesRemoved: number }> = [];
    for (const [path, original] of this._snapshots) {
      const full = join(this._projectDir, path);
      const current = existsSync(full) ? readFileSync(full, "utf-8") : null;
      if (original === null && current !== null) {
        stats.push({ path, status: "created", linesAdded: current.split("\n").length, linesRemoved: 0 });
      } else if (original !== null && current === null) {
        stats.push({ path, status: "deleted", linesAdded: 0, linesRemoved: original.split("\n").length });
      } else if (original !== null && current !== null && original !== current) {
        const oldLines = new Set(original.split("\n"));
        const newLines = new Set(current.split("\n"));
        const added = [...newLines].filter(l => !oldLines.has(l)).length;
        const removed = [...oldLines].filter(l => !newLines.has(l)).length;
        stats.push({ path, status: "modified", linesAdded: added, linesRemoved: removed });
      }
    }
    return stats;
  }

  // -- Accessors --

  getWriteCount(): number { return this._sourceWriteCount; }
  getSessionFiles(): string[] { return [...this._sessionFiles]; }
  getReadFiles(): string[] { return [...this._readFiles]; }
  resetSessionFiles(): void { this._sessionFiles = []; this._readFiles = []; }
}

/**
 * Create the file domain handler bound to a WriteContext.
 */
export function makeFileHandler(ctx: WriteContext, projectDir: string): (action: string, path?: string, content?: string, old_str?: string, new_str?: string, offset?: number, limit?: number, force_write?: boolean) => string {
  return (action, path = "", content = "", old_str = "", new_str = "", offset = 0, limit, force_write = false) => {
    if (action === "read") {
      if (!path) return "Error: path is required for read.";
      if (path.startsWith(".voidrift/") || path.startsWith(".voidrift\\")) {
        return ctx.readFrameworkFile(path, offset, limit ?? null);
      }
      return ctx.readSourceFile(path, offset, limit ?? null);
    }
    if (action === "write") {
      if (!path) return "Error: path is required for write.";
      if (path.startsWith(".voidrift/") || path.startsWith(".voidrift\\")) {
        return ctx.writeFrameworkFile(path, content);
      }
      return ctx.writeSourceFile(path, content, force_write);
    }
    if (action === "edit") {
      if (!path) return "Error: path is required for edit.";
      return ctx.editSourceFile(path, old_str, new_str);
    }
    if (action === "delete") {
      if (!path) return "Error: path is required for delete.";
      return ctx.deleteSourceFile(path);
    }
    if (action === "list") return ctx.listProjectArtifacts();
    return `Unknown file action: ${action}`;
  };
}
