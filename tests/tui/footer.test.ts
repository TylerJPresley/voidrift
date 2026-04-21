/**
 * Tests for REQ-UI-9: Footer bar fields and color thresholds.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ctxColor, ctxIcon } from "../../src/commands/progress.js";

const footerViewSource = readFileSync(join(__dirname, "../../src/tui/components/FooterView.tsx"), "utf-8");
const footerRegionSource = readFileSync(join(__dirname, "../../src/tui/regions/FooterRegion.ts"), "utf-8");

// ---------------------------------------------------------------------------
// Footer fields (AC1/AC3)
// ---------------------------------------------------------------------------

describe("footer displays required fields (REQ-UI-9)", () => {
  it("shows model name", () => {
    expect(footerViewSource).toContain("region.modelName");
  });

  it("shows context % with icon and color", () => {
    expect(footerViewSource).toContain("ctxIcon(region.contextPct)");
    expect(footerViewSource).toContain("getCtxColor(region.contextPct)");
  });

  it("always shows mode", () => {
    expect(footerViewSource).toContain("region.mode");
  });

  it("shows cwd", () => {
    expect(footerViewSource).toContain("region.cwd");
  });

  it("shows branch when set, omits when empty", () => {
    expect(footerViewSource).toContain("region.branch ?");
  });
});

// ---------------------------------------------------------------------------
// Color thresholds (AC1/AC2)
// ---------------------------------------------------------------------------

describe("context color thresholds (REQ-UI-9)", () => {
  it("23% renders in normal (green) color", () => {
    expect(ctxColor(23)).toBe("#4ec9b0");
  });

  it("50% renders in normal (green) color", () => {
    expect(ctxColor(50)).toBe("#4ec9b0");
  });

  it("60% renders in warning (yellow) color", () => {
    expect(ctxColor(60)).toBe("#e5c07b");
  });

  it("75% renders in warning (yellow) color", () => {
    expect(ctxColor(75)).toBe("#e5c07b");
  });

  it("80% renders in critical (red) color", () => {
    expect(ctxColor(80)).toBe("#e06c75");
  });

  it("85% renders in critical (red) color", () => {
    expect(ctxColor(85)).toBe("#e06c75");
  });

  it("100% renders in critical (red) color", () => {
    expect(ctxColor(100)).toBe("#e06c75");
  });
});

// ---------------------------------------------------------------------------
// Context icon thresholds
// ---------------------------------------------------------------------------

describe("context icon thresholds (REQ-UI-9)", () => {
  it("0% shows empty circle", () => {
    expect(ctxIcon(0)).toBe("○");
  });

  it("23% shows quarter pie", () => {
    expect(ctxIcon(23)).toBe("◔");
  });

  it("50% shows half pie", () => {
    expect(ctxIcon(50)).toBe("◑");
  });

  it("75% shows three-quarter pie", () => {
    expect(ctxIcon(75)).toBe("◕");
  });

  it("85% shows full circle", () => {
    expect(ctxIcon(85)).toBe("●");
  });
});

// ---------------------------------------------------------------------------
// FooterRegion state
// ---------------------------------------------------------------------------

describe("FooterRegion state (REQ-UI-9)", () => {
  it("has all required fields", () => {
    for (const field of ["modelName", "contextPct", "mode", "cwd", "branch", "governanceTokens", "governanceMax"]) {
      expect(footerRegionSource).toContain(field);
    }
  });

  it("imports ctxColor and ctxIcon from progress", () => {
    expect(footerViewSource).toContain("import { ctxIcon, ctxColor");
  });

  it("always shows mode (fallback to /chat)", () => {
    expect(footerViewSource).toContain('region.mode || "/chat"');
  });

  it("shows governance shield when not in /bare", () => {
    expect(footerViewSource).toContain('region.mode !== "/bare"');
    expect(footerViewSource).toContain("🛡");
  });
});
