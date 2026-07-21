/**
 * Safe Config Writer — validates against schema before writing.
 *
 * Rule: ALL config mutations must validate a temp copy before applying.
 * No direct writes to config.json — ever.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { ConfigSchema, type VoidRiftConfig } from "./loader.js";

export interface ConfigWriteResult {
  success: boolean;
  error?: string;
}

/**
 * Safely mutate a config file. Reads current content, applies the mutation,
 * validates the result, and only writes if valid.
 */
export function safeConfigWrite(
  configPath: string,
  mutate: (config: Record<string, any>) => void
): ConfigWriteResult {
  // Read current
  let config: Record<string, any> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch (err: any) {
      return { success: false, error: `Failed to parse existing config: ${err.message}` };
    }
  }

  // Apply mutation to a copy
  const copy = JSON.parse(JSON.stringify(config));
  mutate(copy);

  // Validate — check model references if models block exists
  if (copy.modelSelected && copy.models) {
    const validation = ConfigSchema.safeParse(copy);
    if (!validation.success) {
      const issues = validation.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { success: false, error: `Validation failed: ${issues}` };
    }
  }

  // Write
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(copy, null, 2), "utf-8");
  return { success: true };
}
