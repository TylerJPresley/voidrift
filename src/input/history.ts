/**
 * In-memory input history (cli-blueprint.md §3.2).
 *
 * Scoped to the session, never persisted. Stores only submitted (non-empty)
 * inputs, newest first, with adjacent-duplicate dedupe and a 500-entry cap
 * (oldest dropped). The first `Up` saves the current buffer; walking down past
 * the newest entry restores it (§3.2).
 */

const CAP = 500;

export class InputHistory {
  /** Newest first. */
  private readonly entries: string[] = [];
  /** -1 = not navigating (live buffer). */
  private index = -1;
  /** The live buffer saved on the first Up. */
  private saved = "";

  constructor(private readonly cap: number = CAP) {}

  /** All stored entries, newest first (view/test helper). */
  get all(): readonly string[] {
    return this.entries;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Push a submitted input; empty/whitespace is ignored, adjacent dupes collapse. */
  push(input: string): void {
    if (input.trim() === "") return;
    if (this.entries[0] === input) {
      this.resetCursor();
      return;
    }
    this.entries.unshift(input);
    if (this.entries.length > this.cap) this.entries.length = this.cap;
    this.resetCursor();
  }

  /** Reset navigation to the live buffer. */
  resetCursor(): void {
    this.index = -1;
    this.saved = "";
  }

  /**
   * Navigate to an older entry. `current` is the live buffer to save on the
   * first step. Returns the entry to show, or undefined when already at oldest.
   */
  previous(current: string): string | undefined {
    if (this.entries.length === 0) return undefined;
    if (this.index === -1) this.saved = current;
    if (this.index + 1 >= this.entries.length) {
      this.index = this.entries.length - 1;
      return this.entries[this.index];
    }
    this.index += 1;
    return this.entries[this.index];
  }

  /**
   * Navigate to a newer entry. Returns the newer entry, or the saved live
   * buffer when stepping down past the newest, then undefined once restored.
   */
  next(): string | undefined {
    if (this.index === -1) return undefined;
    if (this.index === 0) {
      this.index = -1;
      const saved = this.saved;
      this.saved = "";
      return saved;
    }
    this.index -= 1;
    return this.entries[this.index];
  }
}
