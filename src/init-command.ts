/**
 * `voidrift init` — seed/repair the global base and create a project skeleton
 * (cli-blueprint.md §2.1; core-blueprint.md §13.8, §13.9.1).
 *
 * `init` is a top-level COMMAND like `chat`, not a flag and not a model tool: it
 * binds to the HOST-LEVEL `initConfigHome`/`previewInitReset` the core exports
 * (the SAME use-case `core.config.init` delegates to), so it runs WITHOUT
 * booting a core, needing a model, or touching the network (§2.1, §13.9).
 *
 * Plain run (`voidrift init`): ALWAYS ensure the global base — `config.json` and
 * the six seeded agent directories under `~/.config/voidrift/` — AND create the
 * project skeleton in the CURRENT directory (`<cwd>/.voidrift/` with a minimal
 * `config.json` and an empty `agents/`), like `git init`. When the cwd IS the
 * global config directory or the user's home directory itself, the project part
 * is skipped and said so. A plain, grouped summary is printed to STDOUT — one
 * line per non-empty group (`created`, `repaired`, `left alone`) — and the
 * command exits 0; any failure prints the error to STDERR and exits 1.
 *
 * `--reset <name>`: a confirmed restore of one seeded default. The CURRENT
 * file(s) are line-diffed against the seeded template, the diff is printed, and
 * on a TTY the caller is asked `Reset <name> to the default? [y/N]`. Without a
 * TTY the reset REFUSES (exit 2) unless `--yes` is given. An unknown name exits
 * 2 after listing the valid names. The actual write calls the core with
 * `reset: [name], confirmed: true` so the old content is preserved as
 * `<file>.rejected` (§13.9.1).
 */
import os from "node:os";
import path from "node:path";
import {
  initConfigHome,
  previewInitReset,
  previewInitUpdate,
  applyInitUpdate,
  sweepConfigHome,
  initResetNames,
  voidriftConfigDir,
  discoverPluginAgentTemplates,
  classifyPluginAgentTemplates,
  migrateConfigHome,
  vacuumConfigHome,
  type ConfigInitResult,
  type PluginAgentTemplate,
} from "@voidrift/core";
import { EXIT } from "./exit-codes.js";

/** The streams/process surface `init` touches, injected so tests drive it. */
export interface InitDeps {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  cwd: string;
  /** True when stdin is an interactive TTY (drives the reset confirmation). */
  isTty: boolean;
  /** Read one line of confirmation from the user (only called on a TTY). */
  readLine?: () => Promise<string>;
  /** The resolved home directory (injected for testability; defaults to os). */
  homeDir?: string;
  /** Host-level init ops (injected for tests; default to the core exports). */
  init?: typeof initConfigHome;
  preview?: typeof previewInitReset;
  previewUpdate?: typeof previewInitUpdate;
  applyUpdate?: typeof applyInitUpdate;
  sweep?: typeof sweepConfigHome;
  migrate?: typeof migrateConfigHome;
  vacuum?: typeof vacuumConfigHome;
  discover?: typeof discoverPluginAgentTemplates;
  classifyPluginAgents?: typeof classifyPluginAgentTemplates;
  resetNames?: () => string[];
  configDir?: () => string;
}

/** Render an absolute path for display: a path under the home dir shows as
 * `~/…`; everything else is shown verbatim (§13.9.1 summary uses `~`). */
export function displayPath(abs: string, homeDir: string): string {
  const home = path.resolve(homeDir);
  const resolved = path.resolve(abs);
  if (resolved === home) return "~";
  const prefix = home.endsWith(path.sep) ? home : home + path.sep;
  if (resolved.startsWith(prefix)) return "~/" + resolved.slice(prefix.length).split(path.sep).join("/");
  return abs;
}

/**
 * Format a `ConfigInitResult` (paths relative to its ROOT) into the plain
 * summary lines, one per NON-EMPTY group (§13.9.1). `rootLabel` is the display
 * label for the group's root (`~/.config/voidrift` for the global base, the
 * project `.voidrift` for the skeleton), so a reader sees where each change
 * landed. A repaired agent/skill/prompt's old content is set aside under
 * `<root>/backups/<timestamp>/` (an invalid `config.json` keeps its
 * `config.json.rejected` sibling, §13.3). The `seeded` and `kept` groups
 * (plugin agent templates, project init only) are appended after the standard
 * groups when present.
 */
export function formatSummary(result: ConfigInitResult, rootLabel: string): string[] {
  const lines: string[] = [];
  const join = (rels: string[]): string => rels.map((r) => `${rootLabel}/${r}`).join(", ");
  if (result.created.length > 0) lines.push(`created: ${join(result.created)}`);
  if (result.repaired.length > 0) {
    lines.push(`repaired: ${join(result.repaired)} (the replaced copy is kept under ${rootLabel}/backups/)`);
  }
  if (result.leftAlone.length > 0) lines.push(`left alone: ${result.leftAlone.length} files`);
  if (result.seeded && result.seeded.length > 0) {
    lines.push(`seeded: ${result.seeded.join(", ")}`);
  }
  if (result.kept && result.kept.length > 0) {
    for (const k of result.kept) {
      lines.push(`kept: ${k.name} (${k.reason})`);
    }
  }
  return lines;
}

/**
 * A minimal, dependency-free line diff (§13.9.1 — "a small dependency-free line
 * diff; no new dependency"). A longest-common-subsequence over the two line
 * arrays yields a unified-style listing: ` ` context, `-` removed (current),
 * `+` added (default). `current` of `null` (file absent) diffs against an empty
 * document, so every default line shows as an addition.
 */
export function lineDiff(current: string | null, def: string): string[] {
  const a = current === null ? [] : current.split("\n");
  const b = def.split("\n");
  // LCS length table.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`- ${a[i]}`);
      i++;
    } else {
      out.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) out.push(`- ${a[i++]}`);
  while (j < m) out.push(`+ ${b[j++]}`);
  return out;
}

/** True when `cwd` IS the global config dir or the user's home dir — in which
 * case the project skeleton is skipped (§13.9.1). */
function skipProject(cwd: string, configDir: string, homeDir: string): boolean {
  const c = path.resolve(cwd);
  return c === path.resolve(configDir) || c === path.resolve(homeDir);
}

/** Run `voidrift init` and return the process exit code (§2.1, §13.9.1). */
export async function runInit(
  opts: { reset?: string; update?: boolean; sweep?: boolean; migrate?: boolean; vacuum?: boolean; yes?: boolean },
  deps: InitDeps,
): Promise<number> {
  const init = deps.init ?? initConfigHome;
  const preview = deps.preview ?? previewInitReset;
  const names = (deps.resetNames ?? initResetNames)();
  const configDir = (deps.configDir ?? voidriftConfigDir)();
  const homeDir = deps.homeDir ?? os.homedir();

  // ── `--sweep` — move backup/editor leftovers into a fresh backup set (§13.9.1) ──
  if (opts.sweep === true) {
    return runSweep(deps);
  }

  // ── `--migrate` — persist the in-memory retired-key rename (§13.1, §13.9.1) ──
  if (opts.migrate === true) {
    return runMigrate(deps);
  }

  // ── `--vacuum` — convert the checkpoint store to incremental auto-vacuum (§13.9.1, §5.2) ──
  if (opts.vacuum === true) {
    return runVacuum(deps);
  }

  // ── `--update` — refresh seeded defaults to the current shipped set (§13.9.1) ──
  if (opts.update === true) {
    return runUpdate(opts, deps);
  }

  // ── `--reset <name>` — a confirmed restore of one default (§13.9.1) ──
  if (opts.reset !== undefined) {
    const name = opts.reset;
    if (!names.includes(name)) {
      deps.stderr.write(`Error: unknown reset target "${name}". Valid names: ${names.join(", ")}\n`);
      return EXIT.USAGE;
    }
    const previewed = await preview(name);
    if (!previewed.ok) {
      // An unknown name is already handled above; any other preview error is a
      // usage problem naming the valid names.
      deps.stderr.write(`Error: ${previewed.error.message}. Valid names: ${names.join(", ")}\n`);
      return EXIT.USAGE;
    }
    // Show the diff of the current content against the default (§13.9.1).
    for (const file of previewed.value) {
      deps.stdout.write(`--- ${name}: ${file.rel}\n`);
      for (const line of lineDiff(file.current, file.def)) deps.stdout.write(`${line}\n`);
      deps.stdout.write("\n");
    }
    // Confirm: a TTY asks; non-interactively it REFUSES (exit 2) unless --yes.
    let confirmed = opts.yes === true;
    if (!confirmed) {
      if (!deps.isTty) {
        deps.stderr.write(
          `Error: refusing to reset "${name}" without confirmation (stdin is not a TTY); pass --yes to confirm.\n`,
        );
        return EXIT.USAGE;
      }
      deps.stdout.write(`Reset ${name} to the default? [y/N] `);
      const answer = ((await deps.readLine?.()) ?? "").trim().toLowerCase();
      confirmed = answer === "y" || answer === "yes";
      if (!confirmed) {
        deps.stdout.write("left alone: nothing was changed\n");
        return EXIT.COMPLETED;
      }
    }
    const done = await init({ scope: "global", reset: [name], confirmed: true });
    if (!done.ok) {
      deps.stderr.write(`Error: ${done.error.message}\n`);
      return EXIT.FAILED;
    }
    for (const line of formatSummary(done.value, "~/.config/voidrift")) deps.stdout.write(`${line}\n`);
    return EXIT.COMPLETED;
  }

  // ── plain `voidrift init` — global base + project skeleton (§13.9.1) ──
  const global = await init({ scope: "global" });
  if (!global.ok) {
    deps.stderr.write(`Error: ${global.error.message}\n`);
    return EXIT.FAILED;
  }
  for (const line of formatSummary(global.value, "~/.config/voidrift")) deps.stdout.write(`${line}\n`);

  // The project skeleton, unless the cwd IS the config dir or the home dir.
  if (skipProject(deps.cwd, configDir, homeDir)) {
    deps.stdout.write(
      `left alone: the current directory is ${deps.cwd === homeDir ? "your home directory" : "the global config directory"}; skipped the project .voidrift/\n`,
    );
    return EXIT.COMPLETED;
  }

  // Discover enabled plugins' agent templates and ask for confirmation if present (§13.9.1).
  const discover = deps.discover ?? discoverPluginAgentTemplates;
  let pluginAgents: PluginAgentTemplate[] | undefined;
  let keptEntries: { name: string; reason: string }[] = [];
  pluginAgents = undefined;
  const discovered = await discover({ workspaceRoot: deps.cwd });
  if (discovered.ok) {
    const { templates, plugins, warnings } = discovered.value;

    // Print plugin load messages to stderr (§13.9.1).
    for (const plugin of plugins) {
      deps.stderr.write(`voidrift: loaded plugin ${plugin} to read its agent templates\n`);
    }

    // Print any warnings (e.g., license rejects, resolve failures).
    if (warnings) {
      for (const w of warnings) {
        deps.stderr.write(`voidrift: warning: plugin ${w.plugin}: ${w.error}\n`);
      }
    }

    // Classify the templates: which should be copied, which are identical, which are kept
    const classify = deps.classifyPluginAgents ?? classifyPluginAgentTemplates;
    const classified = await classify(templates, deps.cwd);

    // Store kept entries to print later (even if user declines to copy)
    keptEntries = classified.kept;

    // Ask to copy ONLY if at least one template would be newly copied (toCopy is non-empty)
    if (classified.toCopy.length > 0) {
      const names = classified.toCopy.map((t) => t.name);
      const templateList = names.join(", ");

      let copyTemplates = opts.yes === true;
      if (!copyTemplates && deps.isTty) {
        deps.stdout.write(`Copy ${classified.toCopy.length} plugin agent template${classified.toCopy.length === 1 ? "" : "s"} into .voidrift/agents? [${templateList}] [y/N] `);
        const answer = ((await deps.readLine?.()) ?? "").trim().toLowerCase();
        copyTemplates = answer === "y" || answer === "yes";
      }

      if (copyTemplates) {
        pluginAgents = classified.toCopy; // Pass ONLY new templates to copy
      }
    }
  } else {
    // Discovery failure (e.g., can't load config) — log the error but continue.
    deps.stderr.write(`voidrift: warning: could not discover plugin agent templates: ${discovered.error.message}\n`);
  }

  const project = await init(
    pluginAgents !== undefined
      ? {
          scope: "project" as const,
          dir: deps.cwd,
          pluginAgents,
        }
      : { scope: "project" as const, dir: deps.cwd },
  );
  if (!project.ok) {
    deps.stderr.write(`Error: ${project.error.message}\n`);
    return EXIT.FAILED;
  }
  const projectLabel = displayPath(path.join(deps.cwd, ".voidrift"), homeDir);
  for (const line of formatSummary(project.value, projectLabel)) deps.stdout.write(`${line}\n`);
  
  // Print the kept entries separately (those from the classification that we didn't pass to init)
  for (const k of keptEntries) {
    deps.stdout.write(`kept: ${k.name} (${k.reason})\n`);
  }
  
  return EXIT.COMPLETED;
}

/**
 * `voidrift init --update` — bring the seeded defaults up to the current
 * shipped set (§13.9.1). Each stale (unmodified older) default and each missing
 * seeded agent/skill is shown with its diff; after ONE batched confirmation
 * (`--yes` supplies it non-interactively, and without a TTY `--yes` is required)
 * the batch is applied: stale files refreshed (old kept as `<file>.previous`),
 * missing files created, missing seeded allow rules added to config.json.
 * Customized files are left alone and listed with their `init --reset <name>`
 * hint. A grouped summary (`updated:`, `left alone (customized):`, `added:`) is
 * printed and the command exits 0.
 */
async function runUpdate(opts: { yes?: boolean }, deps: InitDeps): Promise<number> {
  const previewUpdate = deps.previewUpdate ?? previewInitUpdate;
  const applyUpdate = deps.applyUpdate ?? applyInitUpdate;

  const plan = await previewUpdate();
  if (!plan.ok) {
    deps.stderr.write(`Error: ${plan.error.message}\n`);
    return EXIT.FAILED;
  }
  const stale = plan.value.files.filter((f) => f.status === "stale");
  const missingFiles = plan.value.files.filter((f) => f.status === "missing");
  const customized = plan.value.files.filter((f) => f.status === "customized");
  const nothingToDo = stale.length === 0 && missingFiles.length === 0 && plan.value.missingAllowRules.length === 0;

  if (nothingToDo) {
    // Nothing to refresh or add; still name any customized files (they are the
    // only reason `--update` touched nothing) so the user knows to use --reset.
    if (customized.length === 0) {
      deps.stdout.write("left alone: everything is up to date\n");
    } else {
      deps.stdout.write(
        `left alone (customized): ${customized.map((f) => `${f.rel} (reset with: voidrift init --reset ${f.resetName})`).join(", ")}\n`,
      );
    }
    return EXIT.COMPLETED;
  }

  // Show the diff for each file that WOULD change (stale + missing).
  for (const f of [...stale, ...missingFiles].sort((a, b) => a.rel.localeCompare(b.rel))) {
    deps.stdout.write(`--- ${f.status}: ${f.rel}\n`);
    for (const line of lineDiff(f.current, f.def)) deps.stdout.write(`${line}\n`);
    deps.stdout.write("\n");
  }
  if (plan.value.missingAllowRules.length > 0) {
    deps.stdout.write(`--- missing seeded allow rules: ${plan.value.missingAllowRules.join(", ")}\n\n`);
  }

  // ONE batched confirmation for the whole update (§13.9.1).
  let confirmed = opts.yes === true;
  if (!confirmed) {
    if (!deps.isTty) {
      deps.stderr.write(
        "Error: refusing to update without confirmation (stdin is not a TTY); pass --yes to confirm.\n",
      );
      return EXIT.USAGE;
    }
    deps.stdout.write("Update these seeded defaults to the current shipped set? [y/N] ");
    const answer = ((await deps.readLine?.()) ?? "").trim().toLowerCase();
    confirmed = answer === "y" || answer === "yes";
    if (!confirmed) {
      deps.stdout.write("left alone: nothing was changed\n");
      return EXIT.COMPLETED;
    }
  }

  const done = await applyUpdate(true);
  if (!done.ok) {
    deps.stderr.write(`Error: ${done.error.message}\n`);
    return EXIT.FAILED;
  }
  const label = "~/.config/voidrift";
  if (done.value.updated.length > 0) {
    deps.stdout.write(`updated: ${done.value.updated.map((r) => `${label}/${r} (the old copy is kept under ${label}/backups/)`).join(", ")}\n`);
  }
  if (done.value.leftAloneCustomized.length > 0) {
    deps.stdout.write(
      `left alone (customized): ${done.value.leftAloneCustomized.map((c) => `${label}/${c.rel} (reset with: voidrift init --reset ${c.resetName})`).join(", ")}\n`,
    );
  }
  if (done.value.added.length > 0) {
    deps.stdout.write(`added: ${done.value.added.map((r) => (r.startsWith("permissions:") ? `allow rule ${r.slice("permissions:".length)}` : `${label}/${r}`)).join(", ")}\n`);
  }
  if (done.value.updated.length === 0 && done.value.added.length === 0 && done.value.leftAloneCustomized.length === 0) {
    deps.stdout.write("left alone: everything is up to date\n");
  }
  return EXIT.COMPLETED;
}

/**
 * `voidrift init --sweep` — move backup/editor-leftover files out of the live
 * resource directories and the config-directory root into a fresh backup set
 * (§13.9.1). It moves exactly the matching files (global and project), never
 * deletes, never touches a canonical file, and is idempotent. The project part
 * is skipped when the cwd IS the config dir or the home dir (like a plain init).
 * A grouped `moved:` summary names each file and where it went; exits 0 (1 on
 * failure).
 */
async function runSweep(deps: InitDeps): Promise<number> {
  const sweep = deps.sweep ?? sweepConfigHome;
  const configDir = (deps.configDir ?? voidriftConfigDir)();
  const homeDir = deps.homeDir ?? os.homedir();
  const projectDir = skipProject(deps.cwd, configDir, homeDir) ? undefined : deps.cwd;
  const r = await sweep(projectDir);
  if (!r.ok) {
    deps.stderr.write(`Error: ${r.error.message}\n`);
    return EXIT.FAILED;
  }
  if (r.value.moved.length === 0) {
    deps.stdout.write("left alone: nothing to sweep (the live directories are clean)\n");
    return EXIT.COMPLETED;
  }
  const shown = r.value.moved.map((p) => displayPath(p, homeDir)).join(", ");
  deps.stdout.write(`moved: ${shown}\n`);
  if (r.value.backupSet) {
    deps.stdout.write(`into: ${displayPath(r.value.backupSet, homeDir)}/\n`);
  }
  return EXIT.COMPLETED;
}

/**
 * `voidrift init --migrate` — persist the in-memory key migration (§13.1): for
 * each config layer (global and the project) still naming a retired key, back
 * the original up to the backup tree and rewrite it with the key renamed and its
 * value preserved (§13.9.1). It changes nothing else, leaves a file with no
 * retired key alone, and prints a grouped summary under `migrated:` and
 * `left alone:`; exits 0 (1 on failure). The project part is skipped when the
 * cwd IS the config dir or the home dir.
 */
async function runMigrate(deps: InitDeps): Promise<number> {
  const migrate = deps.migrate ?? migrateConfigHome;
  const configDir = (deps.configDir ?? voidriftConfigDir)();
  const homeDir = deps.homeDir ?? os.homedir();
  const projectDir = skipProject(deps.cwd, configDir, homeDir) ? undefined : deps.cwd;
  const r = await migrate(projectDir);
  if (!r.ok) {
    deps.stderr.write(`Error: ${r.error.message}\n`);
    return EXIT.FAILED;
  }
  if (r.value.migrated.length === 0) {
    deps.stdout.write("left alone: no retired keys to migrate\n");
    return EXIT.COMPLETED;
  }
  const lines = r.value.migrated
    .map((m) => `${displayPath(m.file, homeDir)} (${m.renames.map((x) => `${x.from}→${x.to}`).join(", ")})`)
    .join(", ");
  deps.stdout.write(`migrated: ${lines}\n`);
  if (r.value.backupSet) {
    deps.stdout.write(`backed up to: ${displayPath(r.value.backupSet, homeDir)}/\n`);
  }
  return EXIT.COMPLETED;
}

/** Format a byte count as a short human string (e.g. `1.2 MB`), for the vacuum
 * size report. KiB-based like the rest of the storage reporting. */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/**
 * `voidrift init --vacuum` — convert the workspace checkpoint store from the
 * legacy `auto_vacuum=0` (NONE) to `INCREMENTAL` so it reclaims freed space
 * (§13.9.1, §5.2). Host-level: the core owns the SQLite conversion; this prints
 * the report. It is idempotent (a store already INCREMENTAL reports "nothing to
 * do"); it refuses on a locked store or insufficient disk and on any
 * conversion/verification failure, printing the error to STDERR and exiting
 * non-zero with the original store untouched. On success it names the backup it
 * wrote and the store size before and after. Its own invocation.
 */
async function runVacuum(deps: InitDeps): Promise<number> {
  const vacuum = deps.vacuum ?? vacuumConfigHome;
  const homeDir = deps.homeDir ?? os.homedir();
  const r = await vacuum(deps.cwd);
  if (!r.ok) {
    deps.stderr.write(`Error: ${r.error.message}\n`);
    return EXIT.FAILED;
  }
  if (r.value.nothingToDo) {
    deps.stdout.write("nothing to do: the checkpoint store already reclaims freed space (auto_vacuum=INCREMENTAL)\n");
    return EXIT.COMPLETED;
  }
  deps.stdout.write(
    `vacuumed: checkpoint store ${humanBytes(r.value.sizeBefore)} → ${humanBytes(r.value.sizeAfter)} (auto_vacuum=INCREMENTAL)\n`,
  );
  if (r.value.backup) {
    deps.stdout.write(`backed up to: ${displayPath(r.value.backup, homeDir)} (safe to delete once you confirm the conversion worked)\n`);
  }
  return EXIT.COMPLETED;
}
