/**
 * Governance layer builder for chat context partition (REQ-CHAT-14, REQ-ARCH-19).
 *
 * The governance layer is the system prompt — never compacted, re-sent on every
 * API call. Contains: START.md, CONTRIBUTING.md, mode personality, skills,
 * memory index, and git snapshot.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";

/** Estimate token count from character length (~4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Load a project-root file if it exists, return empty string otherwise. */
function loadProjectFile(projectDir: string, filename: string): string {
  const p = join(projectDir, filename);
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

export interface GovernanceLayer {
  /** The assembled system prompt string. */
  content: string;
  /** Estimated token count of the governance layer. */
  tokens: number;
}

export interface GovernanceParts {
  /** START.md content (verbatim). */
  startMd?: string;
  /** CONTRIBUTING.md content (verbatim). */
  contributingMd?: string;
  /** Framework context (system.md CONTEXT section). */
  frameworkContext: string;
  /** Active mode personality prompt. */
  personality: string;
  /** Mode skills content. */
  skills?: string;
  /** Memory index (names + descriptions). */
  memoryIndex?: string;
  /** Git snapshot block. */
  gitSnapshot?: string;
  /** Document context (--doc flag). */
  docContext?: string;
  /** Reference codebase context (--ref flag). */
  refContext?: string;
}

/**
 * Build the governance layer from its constituent parts.
 * Returns the assembled content and estimated token count.
 */
export function buildGovernanceLayer(parts: GovernanceParts): GovernanceLayer {
  const sections: string[] = [];

  // Shared governance content (REQ-ARCH-19, REQ-CHAT-14)
  if (parts.startMd) sections.push(parts.startMd);
  if (parts.contributingMd) sections.push(parts.contributingMd);

  // Framework context
  sections.push(parts.frameworkContext);

  // Mode personality
  sections.push(parts.personality);

  // Skills
  if (parts.skills) sections.push(parts.skills);

  // Memory index
  if (parts.memoryIndex) sections.push(parts.memoryIndex);

  // Git snapshot
  if (parts.gitSnapshot) sections.push(parts.gitSnapshot);

  // Document context
  if (parts.docContext) sections.push(parts.docContext);

  // Reference codebase context
  if (parts.refContext) sections.push(parts.refContext);

  const content = sections.filter(Boolean).join("\n\n");
  return { content, tokens: estimateTokens(content) };
}

/**
 * Load START.md and CONTRIBUTING.md from the project root.
 */
export function loadSharedGovernance(projectDir: string): { startMd: string; contributingMd: string } {
  return {
    startMd: loadProjectFile(projectDir, "START.md"),
    contributingMd: loadProjectFile(projectDir, "CONTRIBUTING.md"),
  };
}

/**
 * Get the configured governance token cap. Default: 6144.
 */
export function getGovernanceMaxTokens(): number {
  const cfg = loadConfig();
  const val = (cfg as Record<string, unknown>)["governance_max_tokens"];
  return typeof val === "number" && val > 0 ? val : 6144;
}

/**
 * Check if governance exceeds the configured cap. Returns a warning message
 * or null if within budget.
 */
export function checkGovernanceBudget(
  governanceTokens: number,
): string | null {
  const cap = getGovernanceMaxTokens();
  if (governanceTokens > cap) {
    return `Governance layer uses ~${Math.round(governanceTokens / 1000)}k tokens (cap: ${Math.round(cap / 1000)}k). Consider trimming skills or memory entries.`;
  }
  return null;
}

/**
 * Trim optional governance content (skills) to fit within the cap.
 * Returns a new GovernanceLayer with skills removed if necessary.
 */
export function trimGovernanceToFit(
  parts: GovernanceParts,
): GovernanceLayer {
  const cap = getGovernanceMaxTokens();
  const full = buildGovernanceLayer(parts);
  if (full.tokens <= cap) return full;

  // Trim skills first (optional content)
  const trimmed = buildGovernanceLayer({ ...parts, skills: undefined });
  return trimmed;
}
