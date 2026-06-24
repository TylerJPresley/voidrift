import type { EventBus } from "../events/bus.js";

/**
 * Input Lock (Concurrency Guard).
 * Freezes terminal input during active model streams to prevent
 * overlapping messages that would corrupt session state.
 */
export class InputLock {
  private _locked = false;

  constructor(private bus: EventBus) {
    this.bus.subscribe("USER_INPUT", () => {
      this._locked = true;
    });

    this.bus.subscribe("TURN_COMPLETE", () => {
      this._locked = false;
    });

    this.bus.subscribe("ERROR_OCCURRED", () => {
      this._locked = false;
    });
  }

  get locked(): boolean {
    return this._locked;
  }

  lock(): void {
    this._locked = true;
  }

  release(): void {
    this._locked = false;
  }
}
