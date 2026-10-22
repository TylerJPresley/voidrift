/**
 * The input index (cli-blueprint.md §3.2, §3.3).
 *
 * One axis places the input line on a single integer index:
 *   - `0` is the live buffer — the text the user types. It changes only when
 *     the user types at `0`; it is kept aside while the index is elsewhere and
 *     shown again, unchanged, on returning to `0`.
 *   - negative indices are history entries (`-1` the newest, `-2` the next, …).
 *     History entries are immutable (owned by `InputHistory`); an edit at a
 *     negative index writes a per-entry SCRATCH copy, discarded when the index
 *     moves away so the entry reads as recorded when visited again.
 *   - positive indices are the slash-command candidates of the live buffer
 *     (`+1` the first dropdown row, §3.3). The candidate list lives in the view
 *     (it is async / filtered); the navigator is told how many rows exist and
 *     clamps to them, and resolves a positive index's preview text from the
 *     supplied labels.
 *
 * `Up` steps 0→-1→-2… and, from a positive index, +n→+(n-1)→0. `Down` steps
 * 0→+1→+2… (only while the dropdown is open, i.e. `candidateCount > 0`) and,
 * from a negative index, -n→-(n-1)→0. Stepping past the oldest entry or the
 * last candidate stays put (clamp). This class is pure (no React, no I/O) and
 * reuses `InputHistory` for storage, the 500-cap, and adjacent-dedupe (§3.2).
 */

import { InputHistory } from "./history.js";

export class InputIndex {
  /** 0 = live buffer; -n = history entry n; +n = candidate row n. */
  private idx = 0;
  /** The live buffer, kept aside while the index is elsewhere. */
  private live = "";
  /** Edited copies of history entries, keyed by (negative) index; cleared on move. */
  private scratch = new Map<number, string>();
  /** How many slash candidates the dropdown currently offers (0 = closed). */
  private candidates = 0;

  constructor(private readonly history: InputHistory = new InputHistory()) {}

  /** The current index value (0 live, -n history, +n candidate). */
  get index(): number {
    return this.idx;
  }

  /** The stored history (view/test helper; storage, cap, dedupe live here). */
  get historyStore(): InputHistory {
    return this.history;
  }

  /** Set how many candidate rows the dropdown offers; clamps a positive index
   * that no longer fits and closes the positive axis when it drops to 0. */
  setCandidateCount(n: number): void {
    this.candidates = Math.max(0, n);
    if (this.idx > this.candidates) this.idx = this.candidates === 0 ? 0 : this.candidates;
  }

  /** Replace the live buffer (a type/edit at index 0). No effect off 0. */
  setLive(text: string): void {
    if (this.idx === 0) this.live = text;
  }

  /** Edit the text shown at the current index: index 0 updates the live buffer;
   * a negative index writes a scratch copy (history stays immutable); a positive
   * index is accepted into the live buffer at 0 by the view before editing, so
   * an edit never lands on a positive index. */
  edit(text: string): void {
    if (this.idx === 0) this.live = text;
    else if (this.idx < 0) this.scratch.set(this.idx, text);
  }

  /** The number of history entries (newest-first). */
  private get historyLen(): number {
    return this.history.size;
  }

  /** The text to show at a negative index (scratch copy if edited, else the
   * recorded entry). `-1` is the newest entry. */
  private historyText(i: number): string {
    const scratched = this.scratch.get(i);
    if (scratched !== undefined) return scratched;
    return this.history.all[-i - 1] ?? "";
  }

  /** The text shown at the current index. Positive indices resolve from the
   * supplied candidate labels (the `/{name}` previews, §3.3). */
  textAt(candidateLabels: readonly string[] = []): string {
    if (this.idx === 0) return this.live;
    if (this.idx < 0) return this.historyText(this.idx);
    return candidateLabels[this.idx - 1] ?? "";
  }

  /** Discard any scratch edits of history entries (on a move off a -n index). */
  private discardScratch(): void {
    this.scratch.clear();
  }

  /**
   * Step `Up`: 0→-1→-2… (clamped at the oldest entry), and +n→+(n-1)→0.
   * Returns the index moved to (unchanged when a clamp blocks the step).
   */
  up(): number {
    if (this.idx > 0) {
      this.idx -= 1; // +n → +(n-1) → 0
      return this.idx;
    }
    // 0 or negative: step toward older history, clamped at the oldest.
    const next = this.idx - 1;
    if (-next > this.historyLen) return this.idx; // past oldest: stay put
    this.discardScratch(); // leaving the current index discards its scratch
    this.idx = next;
    return this.idx;
  }

  /**
   * Step `Down`: 0→+1→+2… only while the dropdown is open (else no-op at 0),
   * and -n→-(n-1)→0. Returns the index moved to (unchanged on a no-op/clamp).
   */
  down(): number {
    if (this.idx < 0) {
      this.idx += 1; // -n → -(n-1) → 0
      if (this.idx === 0) this.discardScratch(); // back at live: drop scratch
      return this.idx;
    }
    // 0 or positive: step toward candidates, only while the dropdown is open.
    if (this.candidates === 0) return this.idx; // no-op at 0 with no dropdown
    const next = this.idx + 1;
    if (next > this.candidates) return this.idx; // past the last candidate
    this.idx = next;
    return this.idx;
  }

  /** Accept a positive-axis candidate into the live buffer at index 0 (§3.3):
   * the view supplies the `/{name}` text; the index returns to 0 holding it. */
  accept(text: string): void {
    this.idx = 0;
    this.live = text;
  }

  /** Return to index 0 with the live buffer restored (Escape at +n, §3.3), or
   * discard scratch when returning from a negative index. */
  toLive(): void {
    if (this.idx < 0) this.discardScratch();
    this.idx = 0;
  }

  /**
   * Submit the text at the current index (§3.2): push it to history (dedupe +
   * cap) and reset to index 0 with an empty live buffer. Returns the submitted
   * text so the view can start the turn. A scratch edit of a history entry is
   * submitted as the edited text.
   */
  submit(candidateLabels: readonly string[] = []): string {
    const text = this.textAt(candidateLabels);
    this.history.push(text);
    this.idx = 0;
    this.live = "";
    this.discardScratch();
    this.candidates = 0;
    return text;
  }
}
