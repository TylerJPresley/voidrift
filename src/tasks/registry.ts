/**
 * Task Registry — named, repeatable task definitions.
 *
 * A task = instruction template + agent config + output target.
 * Stored as JSON in .voidrift/tasks/<name>.json.
 * Invokable by the model (register_task, run_task tools) or user (/tasks command).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";

export interface TaskDefinition {
  name: string;
  description: string;
  instruction: string;
  output?: string;
  append?: boolean;
  persistent?: boolean;
  role?: "flash" | "utility" | "dense";
  tools?: string[];
  timeout?: number;
}

export class TaskRegistry {
  private dir: string;

  constructor(private workspaceRoot: string) {
    this.dir = join(workspaceRoot, ".voidrift", "tasks");
    mkdirSync(this.dir, { recursive: true });
  }

  register(def: TaskDefinition): string {
    const filename = `${def.name}.json`;
    writeFileSync(join(this.dir, filename), JSON.stringify(def, null, 2), "utf-8");
    return filename;
  }

  get(name: string): TaskDefinition | null {
    const path = join(this.dir, `${name}.json`);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, "utf-8")); }
    catch { return null; }
  }

  list(): TaskDefinition[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try { return JSON.parse(readFileSync(join(this.dir, f), "utf-8")); }
        catch { return null; }
      })
      .filter(Boolean) as TaskDefinition[];
  }

  remove(name: string): boolean {
    const path = join(this.dir, `${name}.json`);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  /** Render instruction template with variables */
  render(name: string, vars: Record<string, string>): string | null {
    const def = this.get(name);
    if (!def) return null;
    let instruction = def.instruction;
    for (const [k, v] of Object.entries(vars)) {
      instruction = instruction.replaceAll(`{{${k}}}`, v);
    }
    return instruction;
  }
}
