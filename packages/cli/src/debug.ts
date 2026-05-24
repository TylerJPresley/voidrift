import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";

const LOG_PATH = join(process.cwd(), ".voidrift", "debug.log");

let enabled = process.env.VOIDRIFT_DEBUG === "1";

export function enableDebug() { enabled = true; }

export function debug(category: string, message: string, data?: unknown) {
  if (!enabled) return;
  mkdirSync(join(process.cwd(), ".voidrift"), { recursive: true });
  const ts = new Date().toISOString().slice(11, 23);
  const line = data
    ? `[${ts}] ${category}: ${message} ${JSON.stringify(data).slice(0, 500)}\n`
    : `[${ts}] ${category}: ${message}\n`;
  appendFileSync(LOG_PATH, line);
}
