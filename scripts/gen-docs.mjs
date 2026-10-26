#!/usr/bin/env node
/**
 * Generate CLI documentation from the built dist/ files.
 * 
 * Usage: node scripts/gen-docs.mjs
 * 
 * This script:
 * 1. Imports renderCommandsDoc() from dist/commands-doc.js
 * 2. Writes the output to docs/commands.md
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { renderCommandsDoc } from "../dist/commands-doc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
const docsDir = join(projectRoot, "docs");
const commandsDocPath = join(docsDir, "commands.md");

// Ensure docs directory exists
mkdirSync(docsDir, { recursive: true });

// Generate and write the commands documentation
const content = renderCommandsDoc();
writeFileSync(commandsDocPath, content, "utf-8");

console.log(`Generated ${commandsDocPath}`);
