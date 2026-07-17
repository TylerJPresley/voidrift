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
 * Supports both post-response updates and pre-request estimation via LangChain.
 */
export class TokenBudgetWatcher {
  private used = 0;
  private _model: import("@langchain/core/language_models/chat_models").BaseChatModel | null = null;

  constructor(private limit: number) {}

  get state(): BudgetState {
    const percentage = Math.round((this.used / this.limit) * 100);
    return { used: this.used, limit: this.limit, percentage, color: this.resolveColor(percentage) };
  }

  /** Bind a model for accurate token counting */
  bindModel(model: import("@langchain/core/language_models/chat_models").BaseChatModel): void {
    this._model = model;
  }

  /** Count tokens accurately using the bound model's tokenizer */
  async countTokens(text: string): Promise<number> {
    if (!this._model) return Math.ceil(text.length / 4); // fallback estimate
    return this._model.getNumTokens(text);
  }

  /** Check if adding content would exceed a threshold (default 75%) */
  async wouldExceed(text: string, threshold = 0.75): Promise<boolean> {
    const tokens = await this.countTokens(text);
    return (this.used + tokens) > this.limit * threshold;
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

  /** Compute percentage for a specific current usage value (e.g. context window usage). */
  getContextPct(used: number): number {
    return Math.round((used / this.limit) * 100);
  }

  private resolveColor(pct: number): BudgetColor {
    if (pct < 50) return "green";
    if (pct < 80) return "yellow";
    return "red";
  }
}
