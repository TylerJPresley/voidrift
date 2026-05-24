import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { ChatMessage } from "../adapters/openai.js";

const SESSION_DIR = join(process.cwd(), ".voidrift", "sessions");
const CURRENT_FILE = join(SESSION_DIR, "current.json");

interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export function saveSession(messages: ChatMessage[]): void {
  mkdirSync(SESSION_DIR, { recursive: true });
  const existing = loadSession();
  const data: SessionData = {
    id: existing?.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };
  writeFileSync(CURRENT_FILE, JSON.stringify(data, null, 2));
}

export function loadSession(): SessionData | null {
  if (!existsSync(CURRENT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CURRENT_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (existsSync(CURRENT_FILE)) {
    const { unlinkSync } = require("fs");
    unlinkSync(CURRENT_FILE);
  }
}
