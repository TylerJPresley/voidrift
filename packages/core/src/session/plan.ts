/**
 * Plan Manager — persistent structured plan with phases and items.
 * Stored at .voidrift/plan.json, always loaded into Orbit partition.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

export interface PlanItem {
  id: string;
  title: string;
  description: string;
  rationale: string;
  status: "backlog" | "active" | "done";
  priority: "now" | "next" | "later";
}

export interface PlanPhase {
  id: string;
  title: string;
  status: "backlog" | "active" | "done";
  items: PlanItem[];
}

export interface PlanData {
  phases: PlanPhase[];
}

export class PlanManager {
  private data: PlanData = { phases: [] };
  private filePath: string;

  constructor(private workspaceRoot: string) {
    this.filePath = join(workspaceRoot, ".voidrift", "plan.json");
    this.load();
  }

  get plan(): PlanData { return this.data; }
  get activeItems(): PlanItem[] {
    return this.data.phases
      .filter(p => p.status === "active")
      .flatMap(p => p.items.filter(i => i.status === "active"));
  }

  /** Compile a context-friendly summary for injection into Orbit */
  compile(): string | null {
    const active = this.data.phases.filter(p => p.status === "active");
    if (active.length === 0) return null;
    const lines: string[] = ["--- Active Plan ---"];
    for (const phase of active) {
      lines.push(`## ${phase.title}`);
      for (const item of phase.items) {
        const check = item.status === "done" ? "x" : " ";
        lines.push(`- [${check}] ${item.title}${item.status === "active" ? " ← current" : ""}`);
      }
    }
    return lines.join("\n");
  }

  addPhase(title: string, status: PlanPhase["status"] = "active"): PlanPhase {
    const phase: PlanPhase = { id: `phase-${Date.now().toString(36)}`, title, status, items: [] };
    this.data.phases.push(phase);
    this.save();
    return phase;
  }

  addItem(phaseId: string, title: string, description = "", rationale = "", priority: PlanItem["priority"] = "now"): PlanItem | null {
    const phase = this.data.phases.find(p => p.id === phaseId);
    if (!phase) return null;
    const item: PlanItem = { id: `item-${Date.now().toString(36)}`, title, description, rationale, status: "active", priority };
    phase.items.push(item);
    this.save();
    return item;
  }

  addItemToActive(title: string, description = "", rationale = "", priority: PlanItem["priority"] = "now"): PlanItem | null {
    let phase = this.data.phases.find(p => p.status === "active");
    if (!phase) phase = this.addPhase("Active");
    return this.addItem(phase.id, title, description, rationale, priority);
  }

  backlog(title: string, description = "", rationale = ""): PlanItem | null {
    let phase = this.data.phases.find(p => p.title === "Backlog" && p.status === "backlog");
    if (!phase) {
      phase = { id: `phase-backlog`, title: "Backlog", status: "backlog", items: [] };
      this.data.phases.push(phase);
    }
    const item: PlanItem = { id: `item-${Date.now().toString(36)}`, title, description, rationale, status: "backlog", priority: "later" };
    phase.items.push(item);
    this.save();
    return item;
  }

  complete(itemId: string): boolean {
    for (const phase of this.data.phases) {
      const item = phase.items.find(i => i.id === itemId);
      if (item) { item.status = "done"; this.save(); return true; }
    }
    return false;
  }

  remove(itemId: string): boolean {
    for (const phase of this.data.phases) {
      const idx = phase.items.findIndex(i => i.id === itemId);
      if (idx !== -1) { phase.items.splice(idx, 1); this.save(); return true; }
    }
    return false;
  }

  removePhase(phaseId: string): boolean {
    const idx = this.data.phases.findIndex(p => p.id === phaseId);
    if (idx !== -1) { this.data.phases.splice(idx, 1); this.save(); return true; }
    return false;
  }

  private load(): void {
    if (existsSync(this.filePath)) {
      try { this.data = JSON.parse(readFileSync(this.filePath, "utf-8")); } catch { this.data = { phases: [] }; }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }
}
