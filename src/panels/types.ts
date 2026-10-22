/**
 * The CLI's PRIVATE bound-panel view-model (cli-blueprint.md §7.1,
 * panels-blueprint §5).
 *
 * The core defines the pure-data `PanelDeclaration` standard and exports it
 * (core §12.6); a client owns the UI and binds a declaration to data and
 * handlers in its own view-model. This is that view-model for the CLI: the
 * resolved columns (defaulted from the dataset's `fields` when the declaration
 * omits them), each action's resolved handler + confirm prompt, the optional
 * tab pages (each with its own bound rows/columns/actions), and an optional
 * detail view. Rows come from `datasets.rows` (§12.7) — read once on open and
 * re-read on `RESOURCE_CHANGED` into a cheap synchronous `getItems` the host
 * calls per frame (§7.1). The core's `PanelDeclaration` carries no `getItems`
 * and no handlers — those live only here, in the client (panels §2, §5).
 */
import type { PanelFormat } from "@voidrift/core";
import type { Row } from "./rows.js";

/** A single column in a bound panel — mirrors the core's `PanelColumn`. */
export interface BoundPanelColumn {
  key: string;
  label: string;
  width?: number;
  format?: PanelFormat;
}

/** A resolved, bound action: a label, an optional confirm prompt, and the
 * handler the client runs on the selected row (panels §2, §5). */
export interface BoundPanelAction {
  label: string;
  /** When set, the host asks y/n in the notice area before running; a string
   * is the prompt, `true` a default prompt (§7.1, §12.6). */
  confirm?: string | true;
  handler?: (item: unknown) => void | Promise<void>;
}

/** A bound tab page: its effective columns/actions and its own row snapshot
 * (§7.1, §12.6). `columns`/`actions`, when present, replace the panel's while
 * the page is active. */
export interface BoundPanelPage {
  key: string;
  label: string;
  columns?: BoundPanelColumn[];
  actions?: Record<string, BoundPanelAction>;
  getItems: () => Row[];
}

/**
 * A panel the CLI has bound and can render generically (§7.1). The host builds
 * every panel — table, tabs, detail, confirm — from this one shape with NO
 * per-panel code. `getItems` (and each page's) is synchronous and cheap (reads a
 * refreshed snapshot; the re-read runs only on an event, never inside render).
 */
export interface BoundPanel {
  title: string;
  description?: string;
  columns: BoundPanelColumn[];
  getItems: () => Row[];
  actions?: Record<string, BoundPanelAction>;
  pages?: BoundPanelPage[];
  /** When present, a row is selectable and Enter opens a detail view of it. */
  detail?: { title?: string };
}

/** The CLI's registry of bound panels, keyed by panel name. */
export type BoundPanelRegistry = Record<string, BoundPanel>;
