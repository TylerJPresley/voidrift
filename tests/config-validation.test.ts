import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { safeConfigWrite } from "../src/config/writer.js";
import { loadConfig } from "../src/config/loader.js";

describe("Configuration Validation Bypass", () => {
  const tempConfigPath = join(tmpdir(), `voidrift-test-config-${Date.now()}.json`);

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      rmSync(tempConfigPath);
    }
  });

  it("should fail to catch invalid fields in safeConfigWrite when tiers is not present", () => {
    // 1. Write an initial valid empty config
    writeFileSync(tempConfigPath, JSON.stringify({}), "utf-8");

    // 2. Perform a safeConfigWrite with an invalid 'editor' value
    // Since 'tiers' is not defined in the mutation copy, Zod validation is completely bypassed!
    const result = safeConfigWrite(tempConfigPath, (config) => {
      config.editor = "not-a-valid-editor-name"; // Should be cursor, vscode, vim, etc.
    });

    // 3. Verify that safeConfigWrite erroneously succeeded because of the bypass
    expect(result.success).toBe(true);

    // 4. Verify that the invalid config was written to the file
    const content = JSON.parse(readFileSync(tempConfigPath, "utf-8"));
    expect(content.editor).toBe("not-a-valid-editor-name");

    // 5. Verify that attempting to load this config throws a validation error
    // Since loadConfig merges the file and runs Zod validation unconditionally, it will crash
    expect(() => {
      loadConfig({ globalConfigPath: tempConfigPath });
    }).toThrow(/Invalid VoidRift config/);
  });
});
