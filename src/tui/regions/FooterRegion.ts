import { Region } from "./Region.js";
import type { Panel } from "../panels/Panel.js";

export class FooterRegion extends Region {
  modelName = "";
  contextPct = 0;
  mode = "";
  cwd = "";
  branch = "";
  panel: Panel | null = null;

  setModel(name: string): void { this.modelName = name; this.emit(); }
  setContext(pct: number): void { this.contextPct = pct; this.emit(); }
  setMode(mode: string): void { this.mode = mode; this.emit(); }
  setCwd(cwd: string): void { this.cwd = cwd; this.emit(); }
  setBranch(branch: string): void { this.branch = branch; this.emit(); }

  showPanel(panel: Panel): void { this.panel = panel; this.emit(); }
  closePanel(): void { this.panel = null; this.emit(); }

  get hasPanel(): boolean { return this.panel !== null; }
}
