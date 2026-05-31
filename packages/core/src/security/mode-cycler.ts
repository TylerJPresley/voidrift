import type { Mode, NodeType } from "../router/index.js";
import { bindTools } from "../tools/binding.js";
import type { ToolSchema } from "../tools/types.js";
import type { EventBus } from "../events/bus.js";

const MODE_ORDER: Mode[] = ["plan", "chat", "vibe"];

export interface ModeChangeEvent {
  previous: Mode;
  current: Mode;
}

/**
 * Stateful Mode Cycler.
 *
 * Cycles through plan → chat → vibe on TAB press.
 * Each mode change:
 * - Updates tool bindings for the active node
 * - Updates permission gate behavior (plan=blocked, chat=gated, vibe=autonomous)
 * - Publishes mode change so context manager can rebuild prompt
 */
export class ModeCycler {
  private index = 1; // Start in "chat"
  private changeListeners: Array<(event: ModeChangeEvent) => void> = [];

  constructor(private bus?: EventBus) {}

  get mode(): Mode {
    return MODE_ORDER[this.index];
  }

  get gateEnabled(): boolean {
    return this.mode === "chat";
  }

  get writesBlocked(): boolean {
    return this.mode === "plan";
  }

  cycle(): Mode {
    const previous = this.mode;
    this.index = (this.index + 1) % MODE_ORDER.length;
    this.notifyChange(previous);
    return this.mode;
  }

  setMode(mode: Mode): void {
    const idx = MODE_ORDER.indexOf(mode);
    if (idx === -1) throw new Error(`Invalid mode: ${mode}`);
    const previous = this.mode;
    this.index = idx;
    if (previous !== mode) this.notifyChange(previous);
  }

  getTools(node: NodeType): ToolSchema[] {
    return bindTools(node, this.mode);
  }

  onModeChange(listener: (event: ModeChangeEvent) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    };
  }

  private notifyChange(previous: Mode): void {
    const event: ModeChangeEvent = { previous, current: this.mode };
    for (const listener of this.changeListeners) {
      listener(event);
    }
  }
}
