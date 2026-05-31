export type BudgetColor = "green" | "yellow" | "red";

export interface BudgetState {
  used: number;
  limit: number;
  percentage: number;
  color: BudgetColor;
}

/**
 * Token Budget Watcher.
 * Tracks real-time token usage against the model's context limit.
 */
export class TokenBudgetWatcher {
  private used = 0;

  constructor(private limit: number) {}

  get state(): BudgetState {
    const percentage = Math.round((this.used / this.limit) * 100);
    return { used: this.used, limit: this.limit, percentage, color: this.resolveColor(percentage) };
  }

  add(tokens: number): void {
    this.used += tokens;
  }

  set(tokens: number): void {
    this.used = tokens;
  }

  reset(): void {
    this.used = 0;
  }

  setLimit(limit: number): void {
    this.limit = limit;
  }

  private resolveColor(pct: number): BudgetColor {
    if (pct < 50) return "green";
    if (pct < 80) return "yellow";
    return "red";
  }
}
