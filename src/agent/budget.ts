/**
 * Token budget tracking (REQ-ARCH-13).
 */

export class BudgetExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExhaustedError";
  }
}

export class TokenBudget {
  private _maxInput?: number;
  private _maxOutput?: number;
  private _inputTotal = 0;
  private _outputTotal = 0;

  constructor(maxInput?: number, maxOutput?: number) {
    this._maxInput = maxInput;
    this._maxOutput = maxOutput;
  }

  record(input: number, output: number): void {
    this._inputTotal += input;
    this._outputTotal += output;
  }

  checkBefore(): void {
    if (this._maxInput && this._inputTotal >= this._maxInput) {
      throw new BudgetExhaustedError(
        `Input token budget exhausted: ${this._inputTotal}/${this._maxInput}`
      );
    }
    if (this._maxOutput && this._outputTotal >= this._maxOutput) {
      throw new BudgetExhaustedError(
        `Output token budget exhausted: ${this._outputTotal}/${this._maxOutput}`
      );
    }
  }

  get inputTotal(): number { return this._inputTotal; }
  get outputTotal(): number { return this._outputTotal; }

  summary(): string {
    const parts: string[] = [];
    parts.push(`input: ${this._inputTotal}${this._maxInput ? `/${this._maxInput}` : ""}`);
    parts.push(`output: ${this._outputTotal}${this._maxOutput ? `/${this._maxOutput}` : ""}`);
    return parts.join(", ");
  }
}
