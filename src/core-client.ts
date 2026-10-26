/**
 * Core client wiring (cli-blueprint.md §1.5 step 4, §7).
 *
 * Builds the core with the consumer-implemented callbacks the CLI owns
 * (`output`, `openPanel`, and interactively `onApproval`) and
 * `installSignalHandlers: false` so the CLI owns its own signals (§3.9, §8.4).
 *
 * Panels ship WITH the CLI (handoff §0.1): the CLI registers its own built-in
 * `PanelDeclaration`s through `core.register.panel` (the same seam a third-party
 * plugin uses) and then reads `registry.panels()` as its single source of truth
 * for which panels exist and their columns/actions. Rows come from DATASETS
 * (§12.7): the CLI reads each declaration's `source` dataset slug(s) through
 * `datasets.rows`, so there is NO per-panel shaping in the client — the core
 * shapes every row. `bindPanels` turns each declaration into the CLI's private
 * `BoundPanel` view-model by binding each dataset slug to a cheap synchronous
 * row snapshot (refreshed on `RESOURCE_CHANGED`) and each action `op` to a
 * handler — so a plugin-registered panel renders with no CLI code change
 * (§7.1). A core-backed getter never awaits inside render; the snapshot is
 * re-read only on an event.
 */
import type { BoundPanel, BoundPanelAction, BoundPanelColumn, BoundPanelPage, BoundPanelRegistry } from "./panels/types.js";
import type { Row } from "./panels/rows.js";
import {
  createCore,
  type CoreAPI,
  type CoreOptions,
  type CoreReady,
  type DatasetField,
  type PanelAction,
  type PanelColumn,
  type PanelDeclaration,
} from "@voidrift/core";

export interface CoreClientOptions extends CoreOptions {
  /** The CLI's `output` callback (prints to the TUI output / headless stdout). */
  output?: (text: string) => void;
  /** The CLI's `openPanel` callback (opens a registered panel by name). */
  openPanel?: (name: string) => void;
}

/** The assembled client: the ready core plus the CLI-owned panel registry. */
export interface CoreClient {
  ready: CoreReady;
  panels: BoundPanelRegistry;
}

/** Construct the core with the CLI callbacks and signal ownership (§1.5 step 4). */
export async function bootCore(opts: CoreClientOptions): Promise<CoreReady> {
  const ready = await createCore({ ...opts, installSignalHandlers: false });
  
  // Register the CLI commands docs directory. A failed registration is a non-fatal
  // problem: log it if needed, but do not stop boot (§7.3, pin 3).
  const { fileURLToPath } = await import("url");
  const docsDir = fileURLToPath(new URL("../docs/", import.meta.url));
  const err = await ready.api.register.docs(docsDir, "cli");
  if (err) {
    // register.docs returns CoreError on failure; log it but continue.
    // The core's error handling layer will surface non-fatal problems
    // the same way it handles other registration issues.
    if (opts.output) {
      opts.output(`Warning: failed to register cli docs: ${err.message ?? String(err)}`);
    }
  }
  
  return ready;
}

const rec = (x: unknown): Record<string, unknown> => (x ?? {}) as Record<string, unknown>;

/**
 * Read one dataset's rows through `datasets.rows` (§12.7). The core shapes and
 * secret-masks every row; the client never reshapes. A NOT_FOUND / error /
 * throwing read yields `[]`, which the host renders as the inline error or the
 * graceful empty state (§7.1). A composed source (array) concatenates each
 * dataset's rows in order, tagging each with its `_source` slug.
 */
async function readDataset(api: CoreAPI, slug: string): Promise<Row[]> {
  try {
    const r = await api.datasets.rows(slug);
    return r && r.ok === true && Array.isArray(r.value) ? (r.value as Row[]) : [];
  } catch {
    return [];
  }
}

async function readSource(api: CoreAPI, source: string | string[]): Promise<Row[]> {
  const slugs = Array.isArray(source) ? source : [source];
  if (slugs.length === 1) return readDataset(api, slugs[0]!);
  const out: Row[] = [];
  for (const slug of slugs) {
    for (const row of await readDataset(api, slug)) out.push({ ...rec(row), _source: slug } as Row);
  }
  return out;
}

/** Default a panel's columns from the dataset's declared `fields` when the
 * declaration omits them (§7.2, pin 2). A composed panel (array source) must
 * declare its own columns — the schema enforces it. */
function defaultColumns(cols: PanelColumn[] | undefined, fields: DatasetField[] | undefined): BoundPanelColumn[] {
  if (cols && cols.length > 0) return cols.map(toColumn);
  return (fields ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    ...(f.format !== undefined ? { format: f.format } : {}),
  }));
}

function toColumn(c: PanelColumn): BoundPanelColumn {
  return {
    key: c.key,
    label: c.label,
    ...(c.width !== undefined ? { width: c.width } : {}),
    ...(c.format !== undefined ? { format: c.format } : {}),
  };
}

/** Bind a declaration's keyed actions to handlers, carrying the confirm prompt
 * verbatim (§7.1, §12.6). */
function bindActions(api: CoreAPI, actions: Record<string, PanelAction> | undefined): Record<string, BoundPanelAction> | undefined {
  if (!actions) return undefined;
  const out: Record<string, BoundPanelAction> = {};
  for (const [hotkey, action] of Object.entries(actions)) {
    out[hotkey] = {
      label: action.label,
      ...(action.confirm !== undefined ? { confirm: action.confirm } : {}),
      handler: (row) => runPanelAction(api, action.op, row),
    };
  }
  return out;
}

/**
 * Run a declaration action's dotted CoreAPI `op` against the selected row
 * (§7.2, §1.1 — one op per action). `mcp.approve` takes the row's `server`;
 * `approve`/`reject`/`resolve`/`delete` take the row `id`; any other op takes
 * the row. A failing action never crashes the render loop.
 */
export async function runPanelAction(api: CoreAPI, op: string, row: unknown): Promise<void> {
  const r = rec(row);
  const id = typeof r["id"] === "string" ? (r["id"] as string) : undefined;
  const fn = resolveOp(api, op);
  if (!fn) return;
  try {
    if (op === "mcp.approve") {
      const server = typeof r["server"] === "string" ? (r["server"] as string) : undefined;
      if (server) await (fn as (x: string) => unknown)(server);
      return;
    }
    if (/\.(approve|reject|resolve|delete)$/.test(op)) {
      if (id) await (fn as (x: string) => unknown)(id);
      return;
    }
    await (fn as (x: unknown) => unknown)(row);
  } catch {
    // A failing action never crashes the render loop (§7.1).
  }
}

/** Resolve a dotted op path to a bound CoreAPI method, or undefined (§7.1). */
function resolveOp(api: CoreAPI, op: string): ((...a: unknown[]) => unknown) | undefined {
  const segs = op.split(".");
  let node: unknown = api;
  for (const seg of segs) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  if (typeof node !== "function") return undefined;
  let parent: unknown = api;
  for (const s of segs.slice(0, -1)) parent = (parent as Record<string, unknown>)[s];
  return (node as (...a: unknown[]) => unknown).bind(parent);
}

/**
 * Bind the registered panel declarations into the CLI's `BoundPanel` registry
 * (§7.1, §7.2). Each `registry.panels()` entry — a built-in the CLI registered
 * or one a third-party plugin registered — becomes a `BoundPanel`: its columns
 * carry through (or default from the dataset's `fields`), its `source`
 * dataset(s) are snapshotted ONCE here into a synchronous `getItems` that is
 * REFRESHED on `RESOURCE_CHANGED` (core §14.2), and each action `op` is bound to
 * a handler. A tabbed declaration binds each page's own source the same way.
 * Because the CLI reads the registry rather than a hardcoded list, a plugin
 * panel shows up with no CLI code change.
 */
export async function bindPanels(
  api: CoreAPI,
  entries: { key: string; value: unknown }[],
): Promise<BoundPanelRegistry> {
  // One listing of dataset fields so a declaration that omits columns can
  // default them (§7.2, pin 2). Read once; absent/failed listing → no defaults.
  const fieldsBySlug = new Map<string, DatasetField[] | undefined>();
  try {
    const listed = await api.datasets.list();
    if (listed && listed.ok === true) {
      for (const d of listed.value as { name: string; fields?: DatasetField[] }[]) {
        fieldsBySlug.set(d.name, d.fields);
      }
    }
  } catch {
    // no field defaults available; declarations that omit columns render empty.
  }
  const firstSlug = (source: string | string[]): string => (Array.isArray(source) ? source[0]! : source);

  // One shared RESOURCE_CHANGED subscription refreshes every open snapshot
  // (§7.1, pin 10): no per-dataset event. Each bound source registers a
  // refresher; the subscription re-reads them all on any RESOURCE_CHANGED.
  const refreshers: (() => void)[] = [];
  api.events.subscribe("RESOURCE_CHANGED", () => {
    for (const refresh of refreshers) refresh();
  });

  /** Snapshot a source into a synchronous getter, refreshed on the event. */
  const bindSource = (source: string | string[], initial: Row[]): (() => Row[]) => {
    let snapshot = initial;
    refreshers.push(() => {
      void readSource(api, source)
        .then((next) => {
          snapshot = next;
        })
        .catch(() => undefined);
    });
    return () => snapshot;
  };

  const registry: BoundPanelRegistry = {};
  for (const entry of entries) {
    const name = entry.key.startsWith("panels.") ? entry.key.slice("panels.".length) : entry.key;
    const decl = entry.value as PanelDeclaration | undefined;
    if (!decl || typeof decl.title !== "string" || decl.source === undefined) continue;

    const panelFields = fieldsBySlug.get(firstSlug(decl.source));
    const columns = defaultColumns(decl.columns, panelFields);
    const getItems = bindSource(decl.source, await readSource(api, decl.source));

    const bound: BoundPanel = { title: decl.title, columns, getItems };
    if (decl.description !== undefined) bound.description = decl.description;
    if (decl.detail !== undefined) bound.detail = { ...(decl.detail.title !== undefined ? { title: decl.detail.title } : {}) };
    const actions = bindActions(api, decl.actions);
    if (actions) bound.actions = actions;

    if (decl.pages && decl.pages.length > 0) {
      const pages: BoundPanelPage[] = [];
      for (const page of decl.pages) {
        const pageSource = page.source ?? decl.source;
        const pageFields = fieldsBySlug.get(firstSlug(pageSource));
        const pageCols = page.columns && page.columns.length > 0 ? page.columns.map(toColumn) : columns.length > 0 ? columns : defaultColumns(undefined, pageFields);
        const p: BoundPanelPage = {
          key: page.key,
          label: page.label,
          getItems: bindSource(pageSource, await readSource(api, pageSource)),
          ...(pageCols.length > 0 ? { columns: pageCols } : {}),
        };
        const pageActions = bindActions(api, page.actions);
        if (pageActions) p.actions = pageActions;
        pages.push(p);
      }
      bound.pages = pages;
    }

    registry[name] = bound;
  }
  return registry;
}
