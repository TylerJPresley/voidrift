import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// List of domain files that should have zero I/O imports
const DOMAIN_FILES = [
  "src/session/plan.ts",
  "src/session/memory.ts",
  "src/skills/manager.ts",
  "src/agents/registry.ts",
  "src/session/brain.ts",
  "src/session/context.ts",
];

describe("Clean Architecture - Dependency Rules", () => {
  DOMAIN_FILES.forEach((filePath) => {
    it(`should not import I/O modules or concrete repositories in ${filePath}`, () => {
      const fullPath = join(process.cwd(), filePath);
      expect(existsSync(fullPath)).toBe(true);

      const content = readFileSync(fullPath, "utf-8");

      // Check for forbidden node built-in modules
      const forbiddenModules = ["fs", "child_process", "fs/promises"];
      forbiddenModules.forEach((mod) => {
        const importRegex = new RegExp(`from\\s+['"]${mod}['"]`, "g");
        const requireRegex = new RegExp(`require\\(\\s*['"]${mod}['"]\\s*\\)`, "g");
        
        expect(content).not.toMatch(importRegex);
        expect(content).not.toMatch(requireRegex);
      });

      // Check for forbidden concrete filesystem repositories
      const forbiddenConcreteRepos = [
        "FileSystemPlanRepository",
        "FileSystemMemoryRepository",
        "FileSystemSkillRepository",
        "FileSystemAgentRepository",
        "FileSystemSessionRepository",
      ];
      forbiddenConcreteRepos.forEach((repo) => {
        const repoRegex = new RegExp(`\\b${repo}\\b`, "g");
        expect(content).not.toMatch(repoRegex);
      });
    });
  });
});
