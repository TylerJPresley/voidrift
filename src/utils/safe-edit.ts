/**
 * Safe File Editor — edit a temp copy, validate on close, apply only if valid.
 *
 * Same pattern as /config: never corrupt the real file. Validate first, apply second.
 * Used by: memory panel, skills panel, agents panel, templates panel.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync } from "fs";
import { join, dirname, basename } from "path";
import { openInEditor } from "./editor.js";
import type { EditorType } from "../config/loader.js";

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export type FileValidator = (content: string) => ValidationResult;

export interface EditResult {
  success: boolean;
  error?: string;
  changed: boolean;
}

/**
 * Edit a file with validation. Opens a temp copy in the editor,
 * validates on close, and only overwrites the original if valid.
 *
 * @param filePath - The real file to edit
 * @param editor - Editor to open (from config)
 * @param validator - Validation function run on the edited content
 * @param cacheDir - Directory for temp files (default: .voidrift/cache/edit/)
 */
export function editWithValidation(
  filePath: string,
  editor: EditorType,
  validator: FileValidator,
  cacheDir?: string
): EditResult {
  const cache = cacheDir || join(dirname(filePath), "..", "cache", "edit");
  mkdirSync(cache, { recursive: true });
  const tempPath = join(cache, `edit-${basename(filePath)}`);

  // Copy to temp
  if (existsSync(filePath)) {
    copyFileSync(filePath, tempPath);
  } else {
    writeFileSync(tempPath, "", "utf-8");
  }

  // Open in editor (blocks for terminal editors)
  const result = openInEditor(tempPath, editor);
  if (!result.success) {
    try { unlinkSync(tempPath); } catch {}
    return { success: false, error: result.error || "Editor failed", changed: false };
  }

  // Read edited content
  const edited = readFileSync(tempPath, "utf-8");

  // Check if anything changed
  const original = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  if (edited === original) {
    try { unlinkSync(tempPath); } catch {}
    return { success: true, changed: false };
  }

  // Validate
  const validation = validator(edited);
  if (!validation.valid) {
    try { unlinkSync(tempPath); } catch {}
    return { success: false, error: validation.errors?.join("\n") || "Validation failed", changed: false };
  }

  // Apply — overwrite original with validated content
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, edited, "utf-8");

  // Clean up temp
  try { unlinkSync(tempPath); } catch {}

  return { success: true, changed: true };
}

// ─── Common Validators ───────────────────────────────────────────────────────

/**
 * Validates a memory/skill markdown file has proper YAML frontmatter.
 */
export const validateFrontmatter: FileValidator = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return { valid: false, errors: ["Missing YAML frontmatter (--- header ---)"] };
  }

  const header = match[1];
  const errors: string[] = [];

  // Check required fields
  const requiredFields = ["id", "title", "summary"];
  for (const field of requiredFields) {
    if (!header.includes(`${field}:`)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
};

/**
 * Validates a skill markdown file.
 */
export const validateSkillFile: FileValidator = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return { valid: false, errors: ["Missing YAML frontmatter (--- header ---)"] };
  }

  const header = match[1];
  const errors: string[] = [];

  if (!header.includes("name:")) errors.push("Missing required field: name");
  if (!header.includes("description:")) errors.push("Missing required field: description");
  if (!header.includes("triggers:")) errors.push("Missing required field: triggers");
  if (!header.includes("active:")) errors.push("Missing required field: active");

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
};

/**
 * Validates JSON content.
 */
export const validateJSON: FileValidator = (content) => {
  try {
    JSON.parse(content);
    return { valid: true };
  } catch (err: any) {
    return { valid: false, errors: [`Invalid JSON: ${err.message}`] };
  }
};

/**
 * Validates a prompt override file — must have content, frontmatter optional but must parse if present.
 */
export const validatePromptFile: FileValidator = (content) => {
  if (!content.trim()) {
    return { valid: false, errors: ["Prompt file is empty"] };
  }
  // If frontmatter present, check it parses
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (match) {
    const header = match[1];
    if (header.includes("tier:")) {
      const tier = header.match(/tier:\s*(.+)/)?.[1]?.trim();
      if (tier && !["selected", "utility", "escalation"].includes(tier)) {
        return { valid: false, errors: [`Invalid tier "${tier}". Must be selected|utility|escalation.`] };
      }
    }
  }
  return { valid: true };
};

/**
 * Validates a resource file based on its type. Used by the ResourceWatcher
 * to reject invalid edits from GUI editors.
 *
 * Returns null if the file type doesn't require validation (e.g., config — handled separately).
 */
export function validateResourceFile(filePath: string, type: string): ValidationResult | null {
  
  let content: string;
  try { content = readFileSync(filePath, "utf-8"); } catch { return null; }

  switch (type) {
    case "skill":
      return validateSkillFile(content);
    case "agent":
      if (filePath.endsWith(".json")) return validateJSON(content);
      return validatePromptFile(content); // prompt.md
    case "template":
      return validateFrontmatter(content);
    case "prompt":
      return validatePromptFile(content);
    default:
      return null; // No validation for unknown types
  }
}
