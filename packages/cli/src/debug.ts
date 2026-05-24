import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";

const LOG_DIR = join(process.cwd(), ".voidrift");
const LOG_PATH = join(LOG_DIR, "voidrift.log");

let initialized = false;

function init() {
  if (initialized) return;
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(LOG_PATH, `\n${"═".repeat(60)}\n[${new Date().toISOString()}] Session started\n${"═".repeat(60)}\n`);
  initialized = true;
}

export function log(category: string, message: string, data?: unknown) {
  init();
  const ts = new Date().toISOString().slice(11, 23);
  const line = data
    ? `[${ts}] [${category}] ${message} ${JSON.stringify(data).slice(0, 1000)}\n`
    : `[${ts}] [${category}] ${message}\n`;
  appendFileSync(LOG_PATH, line);
}
