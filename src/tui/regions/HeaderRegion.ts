import { Region } from "./Region.js";

export class HeaderRegion extends Region {
  modelName = "";
  hasMessages = false;
  interacted = false;

  setModel(name: string): void { this.modelName = name; this.emit(); }
  setHasMessages(v: boolean): void { this.hasMessages = v; this.emit(); }
  setInteracted(): void { this.interacted = true; this.emit(); }
}
