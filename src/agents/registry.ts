/**
 * Agent Registry.
 *
 * Discovers, resolves, and manages agent manifests from three sources:
 * 1. Core defaults (hardcoded)
 * 2. Plugin registrations (runtime)
 * 3. Filesystem (workspace + global auto-discovery)
 *
 * Resolution cascade: workspace override → global override → plugin → core default.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from "fs";
import { join, dirname } from "path";

export type AgentType = "interactive" | "task";
export type ApprovalMode = "prompt" | "deny" | "autonomous";
export type ModelTier = "flash" | "utility" | "dense" | "auto" | (string & {});

export interface ToolSettings {
  allowedPaths?: string[];
  autoAllowReadonly?: boolean;
}

export interface AgentManifest {
  id: string;
  name: string;
  description: string;
  type: AgentType;
  modelTier: ModelTier;
  prompt: string;
  tools: string[];
  approvalMode: ApprovalMode;
  allowedTools: string[];
  toolsSettings?: Record<string, ToolSettings>;
  skills?: string[];
  templates?: string[];
  resources?: string[];
  welcomeMessage?: string;
  async?: boolean;
  active?: boolean;
  source?: string;
  overrideStatus?: "default" | "global" | "workspace";
  overridePath?: string;
}

export const ALL_TOOLS = [
  "read_file", "glob_files", "workspace_map", "search_contents", "write_file", "edit_file",
  "execute_command", "web_search", "web_fetch",
  "spawn_subagent", "run_task_agent",
  "save_memory", "delete_memory", "list_memory", "list_skills", "schedule", "background_exec", "check_task", "read_plan", "add_plan", "remove_plan", "prioritize_plan", "update_plan",
  "escalate", "deescalate",
];

export const READ_TOOLS = [
  "read_file", "glob_files", "workspace_map", "search_contents", "web_search", "web_fetch",
  "deescalate",
];

// ─── Core Agent Prompts (equivalent to prompt.md files) ──────────────────────

const PROMPT_CHAT = `You are a collaborative assistant with full workspace access. You help users accomplish their goals — writing, editing, organizing, researching, or building. Behavioral rules, tool usage guidelines, and domain knowledge are provided separately.`;

const PROMPT_PLAN = `You are an architect and planner. You analyze, design, and produce structured implementation plans. You do NOT write or edit workspace files — you produce plans that others implement.

Your output format:
1. **Objective** — what we're trying to achieve
2. **Analysis** — current state and what needs to change
3. **Plan** — ordered steps with file paths and descriptions
4. **Acceptance Criteria** — how to verify the work is complete`;

const PROMPT_VIBE = `You are operating in fully autonomous mode. All tool calls execute immediately without operator approval. You have complete workspace control. Act decisively, verify your work, and keep going until the task is complete.`;

const PROMPT_INDEXER = `## Role: Codebase Indexer

You are the Indexer. Your purpose is to parse files, generate search indices, and summarize codebase files for context discovery.`;

const PROMPT_SUMMARIZER = `## Role: Content Summarizer

You receive content and a question or instruction. Your purpose is to extract and summarize the relevant information concisely.

### How you work:
- Read the provided content carefully
- Extract only what's relevant to the instruction
- Return a structured, dense summary
- Preserve key details: names, values, code snippets, URLs
- Omit filler, navigation, boilerplate

### Output:
- Direct answer to the instruction
- Bullet points for multiple items
- Code blocks for code snippets
- Keep under 500 words unless explicitly asked for more`;

// ─── Core Agent Configs ──────────────────────────────────────────────────────

const CORE_AGENTS: AgentManifest[] = [
  {
    id: "chat",
    name: "Chat",
    description: "General-purpose assistant with full tool access",
    type: "interactive",
    modelTier: "auto",
    prompt: PROMPT_CHAT,
    tools: ALL_TOOLS,
    approvalMode: "prompt",
    allowedTools: READ_TOOLS,
    welcomeMessage: "How can I help?",
    active: true,
  },
  {
    id: "plan",
    name: "Plan",
    description: "Read-only planning and architecture mode",
    type: "interactive",
    modelTier: "auto",
    prompt: PROMPT_PLAN,
    tools: [...READ_TOOLS, "read_plan", "add_plan", "remove_plan", "prioritize_plan", "update_plan"],
    approvalMode: "deny",
    allowedTools: [...READ_TOOLS, "read_plan", "add_plan", "remove_plan", "prioritize_plan", "update_plan"],
    welcomeMessage: "What would you like to plan?",
    active: true,
  },
  {
    id: "vibe",
    name: "Vibe",
    description: "Autonomous execution with no approval gates",
    type: "interactive",
    modelTier: "auto",
    prompt: PROMPT_VIBE,
    tools: ALL_TOOLS,
    approvalMode: "autonomous",
    allowedTools: ALL_TOOLS,
    welcomeMessage: "Vibe mode — running autonomously.",
    active: true,
  },
  {
    id: "indexer",
    name: "Indexer",
    description: "Codebase indexer and search model",
    type: "task",
    modelTier: "utility",
    prompt: PROMPT_INDEXER,
    tools: READ_TOOLS,
    approvalMode: "autonomous",
    allowedTools: READ_TOOLS,
    async: true,
    active: true,
  },
  {
    id: "summarizer",
    name: "Summarizer",
    description: "Summarizes content — web pages, files, or any text block",
    type: "task",
    modelTier: "utility",
    prompt: PROMPT_SUMMARIZER,
    tools: READ_TOOLS,
    approvalMode: "autonomous",
    allowedTools: READ_TOOLS,
    async: true,
    active: true,
  }
];

export class AgentRegistry {
  private agents = new Map<string, AgentManifest>();
  private pluginAgents = new Map<string, AgentManifest>();
  private activeId = "chat";

  constructor() {
    this.resetToBase();
  }

  private resetToBase(): void {
    this.agents.clear();
    for (const agent of CORE_AGENTS) {
      this.agents.set(agent.id, { ...agent, source: "core", overrideStatus: "default" });
    }
    for (const [id, agent] of this.pluginAgents.entries()) {
      this.agents.set(id, agent);
    }
  }

  /** Register an agent from a plugin. */
  register(manifest: AgentManifest, sourcePlugin?: string): void {
    const source = sourcePlugin || manifest.source || "plugin";
    const agent = { ...manifest, source, overrideStatus: "default" as const };
    this.pluginAgents.set(manifest.id, agent);
    this.agents.set(manifest.id, agent);
  }

  /** Discover agents from workspace and global filesystem directories. */
  discover(workspaceRoot: string): void {
    this.resetToBase();
    const dirs = [
      { path: join(process.env.HOME || "", ".config", "voidrift", "agents"), scope: "global" as const },
      { path: join(workspaceRoot, ".voidrift", "agents"), scope: "workspace" as const },
    ];

    for (const { path: dir, scope } of dirs) {
      if (!existsSync(dir)) continue;
      let entries: string[];
      try { entries = readdirSync(dir); } catch { continue; }

      for (const entry of entries) {
        const filePath = join(dir, entry);
        let stat;
        try { stat = statSync(filePath); } catch { continue; }

        if (stat.isFile() && entry.endsWith(".json")) {
          // Flat manifest file, e.g. chat.json
          this.loadManifestFile(filePath, scope);
        } else if (stat.isDirectory()) {
          // Could be a namespaced directory or a folder-nested agent (e.g. my-agent/agent.json)
          const nestedAgent = join(filePath, "agent.json");
          if (existsSync(nestedAgent)) {
            this.loadManifestFile(nestedAgent, scope);
          } else {
            // Scan for namespaced json files, e.g., core/chat.json
            let subEntries: string[];
            try { subEntries = readdirSync(filePath); } catch { continue; }
            for (const subEntry of subEntries) {
              const subFilePath = join(filePath, subEntry);
              if (subEntry.endsWith(".json")) {
                this.loadManifestFile(subFilePath, scope, entry);
              }
            }
          }
        }
      }
    }
  }

  private loadManifestFile(path: string, scope?: "global" | "workspace", namespace?: string): void {
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      
      const approvalMode = ["prompt", "deny", "autonomous"].includes(raw.approvalMode)
        ? raw.approvalMode
        : "prompt";

      const modelTier = ["flash", "utility", "dense", "auto"].includes(raw.modelTier)
        ? raw.modelTier
        : "auto";

      const existing = this.agents.get(raw.id || "");
      const source = namespace 
        ? namespace 
        : existing 
          ? (existing.source || "core") 
          : "custom";
      const overrideStatus = existing ? scope : "default";

      // Check for prompt.md alongside agent.json
      const promptPath = join(dirname(path), "prompt.md");
      const prompt = existsSync(promptPath)
        ? readFileSync(promptPath, "utf-8")
        : (raw.prompt || "");

      const manifest: AgentManifest = {
        id: raw.id || "",
        name: raw.name || raw.id || "",
        description: raw.description || "",
        type: raw.type === "task" ? "task" : "interactive",
        modelTier,
        prompt,
        tools: raw.tools || [],
        approvalMode,
        allowedTools: raw.allowedTools || [],
        toolsSettings: raw.toolsSettings,
        resources: raw.resources,
        welcomeMessage: raw.welcomeMessage,
        active: raw.active !== false,
        source,
        overrideStatus,
        overridePath: path,
      };
      if (manifest.id) {
        this.agents.set(manifest.id, manifest);
      }
    } catch {}
  }

  /** Get an agent by id. */
  get(id: string): AgentManifest | undefined {
    return this.agents.get(id);
  }

  /** List interactive agents. Alphabetical, chat always first. */
  listInteractive(): AgentManifest[] {
    const interactive = Array.from(this.agents.values()).filter(a => a.type === "interactive");
    return interactive.sort((a, b) => {
      if (a.id === "chat") return -1;
      if (b.id === "chat") return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** List active interactive agents (for SHIFT+TAB cycling). */
  listActiveInteractive(): AgentManifest[] {
    return this.listInteractive().filter(a => a.active !== false);
  }

  /** List task agents. Alphabetical. */
  listTask(): AgentManifest[] {
    return Array.from(this.agents.values())
      .filter(a => a.type === "task")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** List active task agents (available as tools). */
  listActiveTask(): AgentManifest[] {
    return this.listTask().filter(a => a.active !== false);
  }

  /** Get the active interactive agent. */
  get active(): AgentManifest {
    return this.agents.get(this.activeId) || CORE_AGENTS[0];
  }

  /** Set the active interactive agent by id. */
  setActive(id: string): AgentManifest {
    const agent = this.agents.get(id);
    if (!agent || agent.type !== "interactive") {
      throw new Error(`Agent "${id}" not found or not interactive`);
    }
    this.activeId = id;
    return agent;
  }

  /** Cycle to the next active interactive agent. Returns the newly active agent. */
  cycle(): AgentManifest {
    const list = this.listActiveInteractive();
    const currentIdx = list.findIndex(a => a.id === this.activeId);
    const nextIdx = (currentIdx + 1) % list.length;
    this.activeId = list[nextIdx].id;
    return this.active;
  }

  /** Activate an agent (sets active: true in its config file). */
  activate(id: string, workspaceRoot: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    const path = this.ensureConfigPath(id, workspaceRoot);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    raw.active = true;
    writeFileSync(path, JSON.stringify(raw, null, 2), "utf-8");
    agent.active = true;
  }

  /** Deactivate an agent (sets active: false in its config file). */
  deactivate(id: string, workspaceRoot: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    const path = this.ensureConfigPath(id, workspaceRoot);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    raw.active = false;
    writeFileSync(path, JSON.stringify(raw, null, 2), "utf-8");
    agent.active = false;
  }

  /** Create a new agent with default scaffolding. Returns path to agent.json. */
  createAgent(id: string, type: AgentType, workspaceRoot: string, scope: "workspace" | "global" = "workspace"): string {
    const base = scope === "workspace"
      ? join(workspaceRoot, ".voidrift", "agents", id)
      : join(process.env.HOME || "", ".config", "voidrift", "agents", id);
    mkdirSync(base, { recursive: true });
    const configPath = join(base, "agent.json");
    const promptPath = join(base, "prompt.md");
    if (!existsSync(configPath)) {
      const config = { id, name: id, description: "", type, modelTier: "auto", tools: [] as string[], approvalMode: "prompt", allowedTools: [] as string[], active: false };
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    }
    if (!existsSync(promptPath)) {
      writeFileSync(promptPath, `## Role: ${id}\n\nDescribe this agent's purpose and how it works.\n`, "utf-8");
    }
    return configPath;
  }

  private ensureConfigPath(id: string, workspaceRoot: string): string {
    const wsPath = join(workspaceRoot, ".voidrift", "agents", id, "agent.json");
    if (existsSync(wsPath)) return wsPath;
    const globalPath = join(process.env.HOME || "", ".config", "voidrift", "agents", id, "agent.json");
    if (existsSync(globalPath)) return globalPath;
    // Create workspace config from current state
    const agent = this.agents.get(id)!;
    const dir = dirname(wsPath);
    mkdirSync(dir, { recursive: true });
    const copy: Record<string, unknown> = { ...agent };
    delete copy.source; delete copy.overrideStatus; delete copy.overridePath; delete copy.prompt;
    writeFileSync(wsPath, JSON.stringify(copy, null, 2), "utf-8");
    return wsPath;
  }

  /** Create an override config file for an agent. Returns path to agent.json. */
  createOverride(id: string, scope: "workspace" | "global", workspaceRoot: string): string {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent "${id}" not found`);

    const dir = scope === "workspace"
      ? join(workspaceRoot, ".voidrift", "agents", id)
      : join(process.env.HOME || "", ".config", "voidrift", "agents", id);

    const filePath = join(dir, "agent.json");
    mkdirSync(dir, { recursive: true });
    if (!existsSync(filePath)) {
      const copy: Record<string, unknown> = { ...agent };
      delete copy.source;
      delete copy.overrideStatus;
      delete copy.overridePath;
      delete copy.prompt; // prompt lives in prompt.md
      writeFileSync(filePath, JSON.stringify(copy, null, 2), "utf-8");
    }
    return filePath;
  }

  /** Create an override prompt file for an agent. Returns path to prompt.md. */
  createPromptOverride(id: string, scope: "workspace" | "global", workspaceRoot: string): string {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent "${id}" not found`);

    const dir = scope === "workspace"
      ? join(workspaceRoot, ".voidrift", "agents", id)
      : join(process.env.HOME || "", ".config", "voidrift", "agents", id);

    const filePath = join(dir, "prompt.md");
    mkdirSync(dir, { recursive: true });
    if (!existsSync(filePath)) {
      writeFileSync(filePath, agent.prompt, "utf-8");
    }
    return filePath;
  }

  /** Delete the override files for an agent. */
  deleteOverride(id: string, scope: "workspace" | "global", workspaceRoot: string): boolean {
    const agent = this.agents.get(id);
    if (agent && agent.overridePath && existsSync(agent.overridePath)) {
      unlinkSync(agent.overridePath);
      return true;
    }

    const subdir = "agents";
    const dir = scope === "workspace"
      ? join(workspaceRoot, ".voidrift", subdir)
      : join(process.env.HOME || "", ".config", "voidrift", subdir);

    const paths = [
      agent && agent.source && agent.source !== "custom" ? join(dir, agent.source, `${id}.json`) : "",
      join(dir, `${id}.json`)
    ].filter(Boolean);

    for (const filePath of paths) {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        return true;
      }
    }
    return false;
  }
}
