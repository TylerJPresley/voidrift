/**
 * Declarative Panel Schema.
 *
 * Plugins define panels as data — the harness renders them.
 * No React, no Ink, no JSX. Just describe the shape.
 */

// ─── Layout Types ────────────────────────────────────────────────────────────

export interface ListLayout {
  type: "list";
  columns: Array<{
    key: string;
    label: string;
    width?: number;         // fixed width, omit for last column (fills)
    color?: string;         // column content color
  }>;
  getItems: (page?: string) => Array<Record<string, string>>;
  cursor: boolean;          // show selection cursor
  dividers?: boolean;       // row dividers (default true)
}

export interface TextLayout {
  type: "text";
  getContent: (page?: string) => string;
}

export interface KeyValueLayout {
  type: "keyvalue";
  getEntries: (page?: string) => Array<{ label: string; value: string; color?: string }>;
}

export interface ScrollLayout {
  type: "scroll";
  getLines: (page?: string) => Array<{ text: string; color?: string }>;
}

export type PanelLayout = ListLayout | TextLayout | KeyValueLayout | ScrollLayout;

// ─── Actions ─────────────────────────────────────────────────────────────────

export interface ActionContext {
  /** Close the panel */
  close: () => void;
  /** Force re-render (after data mutation) */
  refresh: () => void;
  /** Show a status message at the bottom */
  setMessage: (msg: string) => void;
  /** Open a text input prompt. Resolves with entered text or null on cancel. */
  prompt: (placeholder: string) => Promise<string | null>;
}

export interface PanelAction {
  /** Key binding (single char or "enter", "delete", "escape") */
  key: string;
  /** Display label in footer */
  label: string;
  /** Handler receives the currently selected item, active page, and panel controls */
  handler: (selected?: Record<string, string>, page?: string, ctx?: ActionContext) => void | Promise<void>;
}

// ─── Detail View ─────────────────────────────────────────────────────────────

export interface DetailView {
  /** What triggers detail view (usually "enter" action on a list) */
  getTitle: (selected: Record<string, string>) => string;
  /** Detail layout — can be any layout type */
  layout: PanelLayout | ((selected: Record<string, string>) => PanelLayout);
  /** Actions available in detail view */
  actions?: PanelAction[];
}

// ─── Panel Schema ────────────────────────────────────────────────────────────

export interface PanelSchema {
  /** Unique panel ID */
  id: string;
  /** Display title */
  title: string;
  /** Tab pages (optional — omit for single-page panels) */
  pages?: string[];
  /** Main layout */
  layout: PanelLayout;
  /** Detail view (opened from list selection) */
  detail?: DetailView;
  /** Actions available in the main view */
  actions?: PanelAction[];
  /** Footer hint text (auto-generated from actions if omitted) */
  footer?: string;
  /** Locations hint (shown below content) */
  locations?: Array<{ label: string; path: string }>;
}
