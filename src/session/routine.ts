/**
 * Routine Manager — domain logic for repeatable routine items.
 *
 * Routines are standing instructions that persist permanently and get
 * executed on demand. Unlike plans, they have no lifecycle lanes.
 */
import type { RoutineRepository } from "./routine-repository.js";

export interface RoutineItem {
  filename: string;
  description: string;
  body: string;
}

export class RoutineManager {
  constructor(private repo: RoutineRepository) {}

  get dir(): string { return this.repo.dir; }

  all(): RoutineItem[] {
    return this.repo.all();
  }

  get(filename: string): RoutineItem | null {
    return this.repo.get(filename);
  }

  add(name: string, description: string, body = ""): string {
    const filename = `${name}.md`;
    this.repo.save(filename, { description, body });
    return filename;
  }

  remove(filename: string): boolean {
    return this.repo.remove(filename);
  }
}
