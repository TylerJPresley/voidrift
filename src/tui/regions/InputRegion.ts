import { Region } from "./Region.js";

export class InputRegion extends Region {
  busy = false;
  mode = "";
  locked = false;
  pendingMessage: string | null = null;
  history: string[] = [];

  setBusy(busy: boolean): void { this.busy = busy; this.emit(); }
  setMode(mode: string): void { this.mode = mode; this.emit(); }
  setLocked(locked: boolean): void { this.locked = locked; this.emit(); }
  setPending(msg: string | null): void { this.pendingMessage = msg; this.emit(); }
  pushHistory(text: string): void { this.history.push(text); }
}
