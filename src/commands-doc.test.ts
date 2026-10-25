/**
 * Tests for the CLI commands manual renderer.
 *
 * Verifies that renderCommandsDoc output:
 * - Contains valid YAML frontmatter with required keys
 * - Produces a Markdown table with one row per command
 * - Escapes `|` in descriptions to avoid breaking the table
 * - Conforms to the expected manual format
 */

import { describe, it, expect } from "vitest";
import { renderCommandsDoc } from "./commands-doc.js";
import { BUILTIN_COMMANDS } from "./commands-catalog.js";

describe("renderCommandsDoc", () => {
  it("renders valid frontmatter with required keys (summary, read-when, type)", () => {
    const doc = renderCommandsDoc();
    const lines = doc.split("\n");
    expect(lines[0]).toBe("---");
    const endIdx = lines.indexOf("---", 1);
    expect(endIdx).toBeGreaterThan(1);

    const fm = lines.slice(1, endIdx).join("\n");
    expect(fm).toContain("summary:");
    expect(fm).toContain("read-when:");
    expect(fm).toContain("type: reference");
  });

  it("produces a Markdown table with one row per BUILTIN_COMMANDS entry", () => {
    const doc = renderCommandsDoc();
    const lines = doc.split("\n");
    
    // Find the table start (after the "# Slash commands" header)
    const headerIdx = lines.findIndex((l) => l === "# Slash commands");
    expect(headerIdx).toBeGreaterThan(-1);
    
    // Find table header and separator
    const tableStartIdx = lines.findIndex((l, i) => i > headerIdx && l.includes("Command") && l.includes("What it does"));
    expect(tableStartIdx).toBeGreaterThan(headerIdx);
    expect(lines[tableStartIdx + 1]).toContain("|-");
    
    // Count data rows (exclude header and separator)
    const dataRows = lines.slice(tableStartIdx + 2).filter((l) => l.startsWith("|") && l.endsWith("|"));
    expect(dataRows.length).toBe(BUILTIN_COMMANDS.length);
  });

  it("escapes `|` in descriptions to preserve Markdown table structure", () => {
    const cmdWithPipe = [
      { name: "test-pipe", description: "Description with a | pipe character" },
    ];
    const doc = renderCommandsDoc(cmdWithPipe);
    
    // The table row should contain escaped pipe (\\|)
    expect(doc).toContain("with a \\| pipe");
    
    // Verify the row is still valid Markdown — just check it's in the document
    const lines = doc.split("\n");
    const dataRow = lines.find((l) => l.includes("test-pipe"));
    expect(dataRow).toBeDefined();
    // Row should have pipes at start and end: | /test-pipe | ... |
    expect(dataRow!.startsWith("|")).toBe(true);
    expect(dataRow!.endsWith("|")).toBe(true);
  });

  it("frontmatter contains all expected keys (summary, read-when, type)", () => {
    const doc = renderCommandsDoc();
    const lines = doc.split("\n");
    const endIdx = lines.indexOf("---", 1);
    const fm = lines.slice(1, endIdx).join("\n");
    
    // Verify each required key is present and has a value
    expect(fm).toMatch(/^summary:\s*.+$/m);
    expect(fm).toMatch(/^read-when:\s*.+$/m);
    expect(fm).toMatch(/^type:\s*reference\s*$/m);
  });

  it("body contains the header and intro, then the table", () => {
    const doc = renderCommandsDoc();
    expect(doc).toContain("# Slash commands");
    expect(doc).toContain("| Command | What it does |");
    // At least one command row (e.g., /help)
    expect(doc).toContain("| /help |");
  });

  it("commands appear in the same order as BUILTIN_COMMANDS", () => {
    const doc = renderCommandsDoc();
    const lines = doc.split("\n");
    
    // Find the first data row after the table separator
    const tableStartIdx = lines.findIndex((l) => l.includes("Command") && l.includes("What it does"));
    const sepIdx = tableStartIdx + 1;
    const dataStart = sepIdx + 1;
    
    for (let i = 0; i < BUILTIN_COMMANDS.length; i++) {
      const row = lines[dataStart + i];
      const expected = BUILTIN_COMMANDS[i]!.name;
      // Check that the row contains /${name} (with slash and no space before name)
      expect(row).toContain(`| /${expected} |`);
    }
  });

  it("renders descriptions exactly from the catalog (besides pipe escaping)", () => {
    const doc = renderCommandsDoc();
    
    // Spot-check a few commands
    expect(doc).toContain("| /help | Show the command list |");
    expect(doc).toContain("| /sessions | Open the sessions view |");
    expect(doc).toContain("| /quit | Shut down and leave |");
  });

  it("uses default BUILTIN_COMMANDS when no argument is provided", () => {
    const doc1 = renderCommandsDoc();
    const doc2 = renderCommandsDoc(BUILTIN_COMMANDS);
    expect(doc1).toBe(doc2);
  });
});
