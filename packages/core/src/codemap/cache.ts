import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

export interface CacheEntry {
  sha256: string;
  summary: string;
  totalLines: number;
  lastIndexed: number;
}

export class IndexCache {
  private cachePath: string;
  private data: Record<string, CacheEntry> = {};

  constructor(workspaceRoot: string) {
    this.cachePath = join(workspaceRoot, ".voidrift", "index_cache.json");
    this.load();
  }

  private load() {
    if (existsSync(this.cachePath)) {
      try {
        this.data = JSON.parse(readFileSync(this.cachePath, "utf-8"));
      } catch {
        this.data = {};
      }
    }
  }

  private save() {
    const dir = join(this.cachePath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.cachePath, JSON.stringify(this.data, null, 2));
  }

  public computeHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  public get(filePath: string, currentHash: string): CacheEntry | null {
    const entry = this.data[filePath];
    if (entry && entry.sha256 === currentHash) {
      return entry;
    }
    return null;
  }

  public set(filePath: string, sha256: string, summary: string, totalLines: number): void {
    this.data[filePath] = {
      sha256,
      summary,
      totalLines,
      lastIndexed: Date.now(),
    };
    this.save();
  }
}
