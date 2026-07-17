import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const SRC_ROOT = join(__dirname, "../../src");
const BUS_PATH = join(SRC_ROOT, "events/bus.ts");

function getDefinedEvents(): string[] {
  const content = readFileSync(BUS_PATH, "utf-8");
  const matches = content.match(/\| "([A-Z][A-Z_]+)"/g) || [];
  return matches.map(m => m.replace('| "', '').replace('"', ''));
}

function getPublishedEvents(): string[] {
  const result = execSync(
    `grep -rn 'publish' src/ --include="*.ts" | grep -v node_modules | grep -v test`,
    { cwd: join(__dirname, "../.."), encoding: "utf-8" }
  );
  const matches = result.match(/"([A-Z][A-Z_]+)"/g) || [];
  return [...new Set(matches.map(m => m.replace(/"/g, '')))];
}

function getSubscribedEvents(): string[] {
  const result = execSync(
    `grep -rn 'subscribe' src/ --include="*.ts" | grep -v node_modules | grep -v test`,
    { cwd: join(__dirname, "../.."), encoding: "utf-8" }
  );
  const matches = result.match(/"([A-Z][A-Z_]+)"/g) || [];
  return [...new Set(matches.map(m => m.replace(/"/g, '')))];
}

describe("Event Coverage", () => {
  const defined = getDefinedEvents();
  const published = getPublishedEvents();

  it("all defined events have typed payloads", () => {
    const content = readFileSync(BUS_PATH, "utf-8");
    for (const event of defined) {
      expect(content).toContain(`${event}:`);
    }
  });

  it("no publish calls use undefined event types", () => {
    const undeclared = published.filter(e => !defined.includes(e) && e !== "USER_INPUT");
    expect(undeclared).toEqual([]);
  });

  it("at least 85% of defined events are actively published", () => {
    const wired = defined.filter(e => published.includes(e));
    const coverage = wired.length / defined.length;
    expect(coverage).toBeGreaterThanOrEqual(0.85);
  });

  it("critical lifecycle events are all published", () => {
    const critical = [
      "SESSION_START", "SESSION_END",
      "TURN_BEFORE", "TURN_AFTER", "TURN_COMPLETE",
      "BEFORE_TOOL_EXECUTE", "AFTER_TOOL_EXECUTE",
      "MODEL_RESOLVED",
    ];
    for (const event of critical) {
      expect(published).toContain(event);
    }
  });

  it("event type count stays within expected range", () => {
    // Guard against event explosion — if someone adds 20 events, this test fails
    // and forces a conversation about whether they're all needed.
    expect(defined.length).toBeGreaterThanOrEqual(40);
    expect(defined.length).toBeLessThanOrEqual(65);
  });
});
