/**
 * Region: base class for TUI state regions.
 * Each region owns a slice of state and notifies subscribers on change.
 */

export type Listener = () => void;

export class Region {
  private _listeners: Listener[] = [];

  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  /** Notify all subscribers that state changed. */
  protected emit(): void {
    for (const fn of this._listeners) fn();
  }
}
