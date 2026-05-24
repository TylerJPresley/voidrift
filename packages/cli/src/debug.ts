import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";

const LOG_DIR = join(process.cwd(), ".voidrift", "logs");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const LOG_PATH = join(LOG_DIR, `${timestamp}.log`);

let initialized = false;

function init() {
  if (initialized) return;
  mkdirSync(LOG_DIR, { recursive: true });
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
