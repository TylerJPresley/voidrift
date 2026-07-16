/**
 * Session Repository — persistence interface for session state.
 *
 * The SessionBrain uses this interface for all I/O. Default implementation
 * writes JSON/markdown partition files to .voidrift/sessions/<id>/.
 * Alternative implementations can use databases or in-memory stores (testing).
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  startTime: number;
  turnCount: number;
  lastActivity: number;
}

export interface SessionRepository {
  /** Ensure the session directory exists */
  init(sessionId: string): void;

  /** Check if a session exists */
  exists(sessionId: string): boolean;

  /** Write a JSON partition file */
  writeJson(sessionId: string, filename: string, data: unknown): void;

  /** Write a text partition file */
  writeText(sessionId: string, filename: string, content: string): void;

  /** Read a JSON partition file. Returns null on missing/error. */
  readJson(sessionId: string, filename: string): any | null;

  /** Read a text partition file. Returns null on missing/error. */
  readText(sessionId: string, filename: string): string | null;

  /** List all sessions with metadata */
  listSessions(): SessionInfo[];
}

// ─── Filesystem Implementation ───────────────────────────────────────────────

export class FileSystemSessionRepository implements SessionRepository {
  private sessionsDir: string;

  constructor(workspaceRoot: string) {
    this.sessionsDir = join(workspaceRoot, ".voidrift", "sessions");
  }

  init(sessionId: string): void {
    mkdirSync(join(this.sessionsDir, sessionId), { recursive: true });
  }

  exists(sessionId: string): boolean {
    return existsSync(join(this.sessionsDir, sessionId, "system.metadata.json"));
  }

  writeJson(sessionId: string, filename: string, data: unknown): void {
    writeFileSync(join(this.sessionsDir, sessionId, filename), JSON.stringify(data, null, 2), "utf-8");
  }

  writeText(sessionId: string, filename: string, content: string): void {
    writeFileSync(join(this.sessionsDir, sessionId, filename), content, "utf-8");
  }

  readJson(sessionId: string, filename: string): any | null {
    const path = join(this.sessionsDir, sessionId, filename);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
  }

  readText(sessionId: string, filename: string): string | null {
    const path = join(this.sessionsDir, sessionId, filename);
    if (!existsSync(path)) return null;
    try { return readFileSync(path, "utf-8"); } catch { return null; }
  }

  listSessions(): SessionInfo[] {
    if (!existsSync(this.sessionsDir)) return [];
    const entries: SessionInfo[] = [];
    for (const name of readdirSync(this.sessionsDir)) {
      const metaPath = join(this.sessionsDir, name, "system.metadata.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const turnsPath = join(this.sessionsDir, name, "system.turns.json");
        let lastActivity = meta.startTime || 0;
        if (existsSync(turnsPath)) {
          const turns = JSON.parse(readFileSync(turnsPath, "utf-8"));
          if (turns.length) lastActivity = turns[turns.length - 1].timestamp;
        }
        entries.push({ id: name, startTime: meta.startTime || 0, turnCount: meta.turnCount || 0, lastActivity });
      } catch { continue; }
    }
    return entries.sort((a, b) => b.lastActivity - a.lastActivity);
  }
}

// ─── In-Memory Implementation (Testing) ──────────────────────────────────────

export class InMemorySessionRepository implements SessionRepository {
  private sessions = new Map<string, Map<string, string>>();

  init(sessionId: string): void {
    if (!this.sessions.has(sessionId)) this.sessions.set(sessionId, new Map());
  }

  exists(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.has("system.metadata.json") ?? false;
  }

  writeJson(sessionId: string, filename: string, data: unknown): void {
    this.init(sessionId);
    this.sessions.get(sessionId)!.set(filename, JSON.stringify(data, null, 2));
  }

  writeText(sessionId: string, filename: string, content: string): void {
    this.init(sessionId);
    this.sessions.get(sessionId)!.set(filename, content);
  }

  readJson(sessionId: string, filename: string): any | null {
    const content = this.sessions.get(sessionId)?.get(filename);
    if (!content) return null;
    try { return JSON.parse(content); } catch { return null; }
  }

  readText(sessionId: string, filename: string): string | null {
    return this.sessions.get(sessionId)?.get(filename) ?? null;
  }

  listSessions(): SessionInfo[] {
    const entries: SessionInfo[] = [];
    for (const [id, files] of this.sessions) {
      const meta = files.get("system.metadata.json");
      if (!meta) continue;
      try {
        const parsed = JSON.parse(meta);
        entries.push({ id, startTime: parsed.startTime || 0, turnCount: parsed.turnCount || 0, lastActivity: parsed.startTime || 0 });
      } catch {}
    }
    return entries.sort((a, b) => b.lastActivity - a.lastActivity);
  }
}
