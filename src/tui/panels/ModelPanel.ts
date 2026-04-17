/**
 * ModelPanel: model selection panel for the footer.
 */

import type { Panel, PanelItem } from "./Panel.js";

export class ModelPanel implements Panel {
  readonly title = "Model";
  readonly items: PanelItem[];
  selectedIndex: number;
  readonly hint = "←→ · enter · esc";
  private _onSelect: (item: PanelItem) => void;
  private _onCancel: () => void;

  constructor(aliases: string[], current: string, onSelect: (alias: string) => void, onCancel?: () => void) {
    this.items = aliases.map(a => ({ label: a, value: a, marker: a === current ? "◀" : undefined }));
    this.selectedIndex = Math.max(0, aliases.indexOf(current));
    this._onSelect = (item) => onSelect(item.value);
    this._onCancel = onCancel ?? (() => {});
  }

  onSelect(item: PanelItem): void { this._onSelect(item); }
  onCancel(): void { this._onCancel(); }
}
