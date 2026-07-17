/**
 * Plan Manager — domain logic for plan items.
 *
 * Delegates persistence to a PlanRepository. Handles:
 * - Priority grouping
 * - Context compilation (inject "now" items into Orbit)
 * - Event publishing
 *
 * No filesystem imports. Pure domain logic + repository calls.
 */
import type { PlanRepository } from "./plan-repository.js";

export interface PlanScope {
  /** Glob patterns for files the plan intends to write/edit */
  write?: string[];
  /** Command patterns the plan intends to execute */
  execute?: string[];
}

export interface PlanItem {
  filename: string;
  priority: "now" | "next" | "later" | "complete";
  description: string;
  rationale: string;
  body: string;
  scope?: PlanScope;
}

export class PlanManager {
  private repo: PlanRepository;
  private bus?: import("../events/bus.js").EventBus;

  constructor(repo: PlanRepository, bus?: import("../events/bus.js").EventBus) {
    this.repo = repo;
    this.bus = bus;
  }

  get dir(): string { return this.repo.dir; }

  all(): PlanItem[] {
    return this.repo.all();
  }

  byPriority(priority: PlanItem["priority"]): PlanItem[] {
    return this.all().filter(i => i.priority === priority);
  }

  get(filename: string): PlanItem | null {
    return this.repo.get(filename);
  }

  /** Compile now items into a context-friendly string for Orbit injection */
  compileActivePlanSummary(): string | null {
    const now = this.byPriority("now");
    if (now.length === 0) return null;
    const lines = ["--- Active Plan ---"];
    for (const item of now) {
      lines.push(`• ${item.description}${item.rationale ? ` — ${item.rationale}` : ""}`);
    }
    return lines.join("\n");
  }

  /** Load full body of a plan item (Stage 2 disclosure) */
  loadBody(filename: string): string | null {
    const item = this.repo.get(filename);
    return item ? item.body : null;
  }

  add(name: string, description: string, rationale: string, priority: PlanItem["priority"] = "now", body = ""): string {
    const filename = `${name}.md`;
    this.repo.save(filename, { priority, description, rationale, body });
    this.bus?.publish("PLAN_ITEM_ADDED", { name, priority, description } as any);
    return filename;
  }

  updatePriority(filename: string, priority: PlanItem["priority"]): boolean {
    const item = this.repo.get(filename);
    if (!item) return false;
    this.repo.save(filename, { ...item, priority });
    this.bus?.publish("PLAN_ITEM_UPDATED", { name: filename, field: "priority", oldValue: item.priority, newValue: priority } as any);
    return true;
  }

  remove(filename: string): boolean {
    const removed = this.repo.remove(filename);
    if (removed) {
      this.bus?.publish("PLAN_ITEM_REMOVED", { name: filename } as any);
    }
    return removed;
  }
}
