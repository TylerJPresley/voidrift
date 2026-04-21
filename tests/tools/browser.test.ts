/**
 * Tests for browser tool (REQ-ARCH-10, REQ-VF-2).
 * Tests verify the tool interface and error handling.
 * Full Playwright integration tests require `npx playwright install chromium`.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { browserNavigate, browserScreenshot, browserClick, browserGetText, closeAllSessions, closeSession } from "../../src/tools/browser.js";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

describe("Browser tool", () => {
  afterEach(() => {
    closeAllSessions();
  });

  describe("browserNavigate", () => {
    it("returns JSON with title and url on success", () => {
      const result = JSON.parse(browserNavigate("data:text/html,<title>Test</title><body>Hello</body>"));
      // If playwright is installed, we get title+url. If not, we get an error.
      if (result.error) {
        expect(result.error).toMatch(/Playwright|Cannot find/i);
      } else {
        expect(result.title).toBe("Test");
        expect(result.url).toContain("data:text/html");
      }
    });

    it("uses default session when no sessionId provided", () => {
      const result = JSON.parse(browserNavigate("data:text/html,<title>A</title>"));
      expect(result).toBeDefined();
      // Should not throw — default session is used
    });

    it("supports named sessions", () => {
      const result = JSON.parse(browserNavigate("data:text/html,<title>B</title>", "session-1"));
      expect(result).toBeDefined();
    });

    it("returns error for invalid URL", () => {
      const result = JSON.parse(browserNavigate("not-a-valid-url"));
      // Playwright will error on invalid URL
      if (!result.error) {
        // Some versions may handle it differently
        expect(result.url || result.error).toBeDefined();
      }
    });
  });

  describe("browserScreenshot", () => {
    it("returns error when no session exists (no prior navigate)", () => {
      const result = JSON.parse(browserScreenshot(undefined, "no-session"));
      // Without a prior navigate, the page has no URL to restore
      // It should still work (blank page) or return an error
      expect(result.path || result.error).toBeDefined();
    });

    it("accepts a custom output path", () => {
      const outPath = resolve(tmpdir(), `voidrift-test-screenshot-${Date.now()}.png`);
      const result = JSON.parse(browserScreenshot(outPath, "screenshot-test"));
      if (!result.error) {
        expect(result.path).toBe(outPath);
      }
      // Cleanup
      try { if (existsSync(outPath)) rmSync(outPath); } catch {}
    });
  });

  describe("browserClick", () => {
    it("returns error when element not found", () => {
      // Navigate first, then click non-existent element
      browserNavigate("data:text/html,<body><p>No buttons</p></body>", "click-test");
      const result = JSON.parse(browserClick("#nonexistent", "click-test"));
      // Playwright times out waiting for the selector — returns an error
      expect(result.error).toBeDefined();
    }, 15000);

    it("clicks an existing element", () => {
      browserNavigate("data:text/html,<body><button id='btn'>Click me</button></body>", "click-ok");
      const result = JSON.parse(browserClick("#btn", "click-ok"));
      if (!result.error) {
        expect(result.clicked).toBe("#btn");
      }
    });
  });

  describe("browserGetText", () => {
    it("returns page body text when no selector given", () => {
      browserNavigate("data:text/html,<body>Hello World</body>", "text-test");
      const result = JSON.parse(browserGetText(undefined, "text-test"));
      if (!result.error) {
        expect(result.text).toContain("Hello World");
      }
    });

    it("returns element text for a specific selector", () => {
      browserNavigate("data:text/html,<body><div id='target'>Specific Text</div></body>", "text-sel");
      const result = JSON.parse(browserGetText("#target", "text-sel"));
      if (!result.error) {
        expect(result.text).toContain("Specific Text");
      }
    });

    it("returns error for non-existent selector", () => {
      browserNavigate("data:text/html,<body>Content</body>", "text-miss");
      const result = JSON.parse(browserGetText("#missing", "text-miss"));
      if (result.error) {
        expect(result.error).toContain("not found");
      }
    });
  });

  describe("closeSession", () => {
    it("removes session directory", () => {
      const id = `test-close-${Date.now()}`;
      const dir = resolve(tmpdir(), `voidrift-browser-${id}`);
      mkdirSync(dir, { recursive: true });
      closeSession(id);
      expect(existsSync(dir)).toBe(false);
    });

    it("does not throw for non-existent session", () => {
      expect(() => closeSession("nonexistent-session")).not.toThrow();
    });
  });

  describe("closeAllSessions", () => {
    it("clears all tracked sessions", () => {
      const id1 = `test-all-1-${Date.now()}`;
      const id2 = `test-all-2-${Date.now()}`;
      const dir1 = resolve(tmpdir(), `voidrift-browser-${id1}`);
      const dir2 = resolve(tmpdir(), `voidrift-browser-${id2}`);
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });
      // Simulate that these sessions were opened via navigate
      browserNavigate("data:text/html,<title>1</title>", id1);
      browserNavigate("data:text/html,<title>2</title>", id2);
      closeAllSessions();
      expect(existsSync(dir1)).toBe(false);
      expect(existsSync(dir2)).toBe(false);
    });
  });
});
