/**
 * Panel: interface for pluggable footer overlays.
 * Implement this to add a new interactive panel (model selector, settings, permissions).
 */

export interface PanelItem {
  label: string;
  value: string;
  marker?: string;
}

export interface Panel {
  readonly title: string;
  readonly items: PanelItem[];
  selectedIndex: number;
  readonly hint: string;

  /** Called when user presses Enter on an item. */
  onSelect(item: PanelItem): void;

  /** Called when user presses Esc. */
  onCancel(): void;
}
