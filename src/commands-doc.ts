/**
 * Render the CLI commands manual document (cli-blueprint.md §7.3).
 *
 * A pure function that generates the Markdown manual for built-in slash commands
 * from the BUILTIN_COMMANDS catalog, complete with YAML frontmatter that
 * conforms to the core's manual parser. This function runs at runtime so the
 * manual cannot drift from the catalog.
 */

import type { CommandInfo } from "./commands-catalog.js";
import { BUILTIN_COMMANDS } from "./commands-catalog.js";

/**
 * Generate the CLI commands manual markdown with YAML frontmatter.
 * Escapes `|` in descriptions to avoid breaking the Markdown table.
 */
export function renderCommandsDoc(commands: readonly CommandInfo[] = BUILTIN_COMMANDS): string {
  const frontmatter = [
    "summary: Reference for the CLI's built-in slash commands",
    "read-when: when the user asks what a slash command does or which commands exist",
    "type: reference",
  ].join("\n");

  const table = [
    "| Command | What it does |",
    "|---------|-------------|",
    ...commands.map((cmd) => {
      // Escape `|` in descriptions to avoid breaking the table
      const escaped = cmd.description.replace(/\|/g, "\\|");
      return `| /${cmd.name} | ${escaped} |`;
    }),
  ].join("\n");

  const body = [
    "# Slash commands",
    "",
    "Use a slash command to open panels, navigate sessions, switch models, or control the session.",
    "",
    table,
  ].join("\n");

  return `---\n${frontmatter}\n---\n${body}`;
}
