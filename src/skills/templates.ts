import { existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";

/**
 * Reads boilerplate templates from a skill's templates/ directory.
 * Used by the Engineer agent to accelerate component creation.
 */
export function getSkillTemplates(skillFilePath: string): Array<{ name: string; content: string }> {
  const skillDir = dirname(skillFilePath);
  const templatesDir = join(skillDir, "templates");

  if (!existsSync(templatesDir)) return [];

  return readdirSync(templatesDir)
    .filter((f) => !f.startsWith("."))
    .map((f) => ({
      name: f,
      content: readFileSync(join(templatesDir, f), "utf-8"),
    }));
}

/**
 * Finds matching skill templates for a given file extension or name.
 */
export function findRelevantTemplates(
  skillDirs: string[],
  targetExtension: string
): Array<{ skillName: string; templateName: string; content: string }> {
  const results: Array<{ skillName: string; templateName: string; content: string }> = [];

  for (const dir of skillDirs) {
    if (!existsSync(dir)) continue;
    for (const skillName of readdirSync(dir)) {
      const templatesDir = join(dir, skillName, "templates");
      if (!existsSync(templatesDir)) continue;

      for (const file of readdirSync(templatesDir)) {
        if (file.endsWith(targetExtension) || file.includes(targetExtension.replace(".", ""))) {
          results.push({
            skillName,
            templateName: file,
            content: readFileSync(join(templatesDir, file), "utf-8"),
          });
        }
      }
    }
  }

  return results;
}
