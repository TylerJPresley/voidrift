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
import { join, dirname } from "path";
import type { AgentRepository } from "./repository.js";

export type AgentType = "interactive" | "passive";
export type ApprovalMode = "prompt" | "deny" | "autonomous";
// Re-export for external consumers
export type { ApprovalMode as AgentApprovalMode };
export type AgentRole = "utility" | "escalation" | (string & {});

export interface ToolSettings {
  allowedPaths?: string[];
  autoAllowReadonly?: boolean;
}

export interface AgentManifest {
  id: string;
  name: string;
  description: string;
  type: AgentType;
  role: AgentRole;
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
  autoEscalated?: boolean;
  source?: string;
  overrideStatus?: "default" | "global" | "workspace";
  overridePath?: string;
}

export const ALL_TOOLS = [
  "read_file", "glob_files", "workspace_map", "search_contents", "write_file", "edit_file",
  "execute_command", "web_search", "web_fetch",
  "spawn_subagent", "run_task_agent",
  "save_memory", "delete_memory", "list_memory", "list_skills", "schedule", "background_exec", "check_task", "read_plan", "add_plan", "remove_plan", "prioritize_plan", "update_plan",
  "escalate", "deescalate", "search_tools", "load_skill", "load_skill",
  "register_task", "invoke_task", "query_logs",
];

export const READ_TOOLS = [
  "read_file", "glob_files", "workspace_map", "search_contents", "web_search", "web_fetch",
  "deescalate", "search_tools", "load_skill",
];

// ─── Core Agent Prompts (equivalent to prompt.md files) ──────────────────────

const PROMPT_CHAT = `You are a collaborative assistant with full workspace access. You help users accomplish their goals — writing, editing, organizing, researching, or building. Behavioral rules, tool usage guidelines, and domain knowledge are provided separately.

## Change Workflow Trigger

When the user's request involves any of the following, follow the **Change Workflow** below:
- Modifying existing files
- Creating new files
- Deleting files
- Running commands that alter the codebase (build, test, lint, etc.)
- Git operations (commit, push, merge, rebase)

**The Change Workflow does NOT apply to:** reading files, searching, answering questions, exploring, general conversation.

### Change Workflow

1. **Gather Context** — Read affected files, check git status, understand dependencies
2. **Create Plan** — All changes as checklist items in a single plan item (use checklist pattern when subtasks share output)
3. **Present** — Show the plan to the user and wait for approval
4. **Branch** — Create a feature branch (never work on main/master without explicit user confirmation)
5. **Execute** — Work through the checklist on the branch
6. **Summarize** — Present a diff/summary of all changes and wait for approval
7. **Merge** — Only after explicit user approval`;

const PROMPT_PLAN = `You are operating in **plan mode** — a read-only planning environment. You analyze, design, and produce structured plans. Your output is plans that a separate agent carries out.

## Your Scope
- **Read and research freely** — read documents, search information, use \`web_search\` and \`web_fetch\` to investigate topics, best practices, or relevant context
- **Run read-only commands** — you may use \`execute_command\` for inspection (listing, reading, searching, querying) but never to modify anything
- **Analyze and evaluate** — map dependencies, propose designs, weigh trade-offs
- **Produce plans** — ordered steps, file paths, acceptance criteria

## Constraints
- **No mutations** — you cannot write or edit files, and you cannot run commands that modify state
- **Planning only** — your job is to investigate and plan, not to implement

When the user asks for implementation or changes, acknowledge it's outside your mode and suggest switching to the "Chat" agent for execution.

Your output format:
1. **Objective** — what we're trying to achieve
2. **Analysis** — current state, research findings, what needs to change
3. **Plan** — ordered steps with descriptions and file paths
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
    role: "",
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
    role: "",
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
    role: "",
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
    type: "passive",
    role: "utility",
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
    type: "passive",
    role: "utility",
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
  private _bus?: import("../events/bus.js").EventBus;
  private repo: AgentRepository;

  constructor(bus?: import("../events/bus.js").EventBus, repo?: AgentRepository) {
    this._bus = bus;
    if (!repo) throw new Error("AgentRegistry requires a repository. Inject via bootstrap.");
    this.repo = repo;
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
    const discovered = this.repo.discover(workspaceRoot);
    for (const { manifest } of discovered) {
      if (manifest.id) {
        // If overriding a core/plugin agent, preserve the original source
        const existing = this.agents.get(manifest.id);
        if (existing && existing.source === "core") {
          manifest.source = "core";
        }
        this.agents.set(manifest.id, manifest);
      }
    }
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
  listPassive(): AgentManifest[] {
    return Array.from(this.agents.values())
      .filter(a => a.type === "passive")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** List active task agents (available as tools). */
  listActivePassive(): AgentManifest[] {
    return this.listPassive().filter(a => a.active !== false);
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
    const from = this.activeId;
    this.activeId = id;
    if (this._bus && from !== id) this._bus.publish("AGENT_ACTIVATED", { from, to: id, trigger: "user" } as any);
    return agent;
  }

  /** Cycle to the next active interactive agent. Returns the newly active agent. */
  cycle(): AgentManifest {
    const list = this.listActiveInteractive();
    const currentIdx = list.findIndex(a => a.id === this.activeId);
    const from = this.activeId;
    const nextIdx = (currentIdx + 1) % list.length;
    this.activeId = list[nextIdx].id;
    if (this._bus) this._bus.publish("AGENT_ACTIVATED", { from, to: this.activeId, trigger: "cycle" } as any);
    return this.active;
  }

  /** Activate an agent (sets active: true in its config file). */
  activate(id: string, workspaceRoot: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    const path = this.ensureConfigPath(id, workspaceRoot);
    const raw = this.repo.readManifest(path) || {};
    (raw as any).active = true;
    this.repo.writeManifest(path, raw);
    agent.active = true;
  }

  /** Deactivate an agent (sets active: false in its config file). */
  deactivate(id: string, workspaceRoot: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    const path = this.ensureConfigPath(id, workspaceRoot);
    const raw = this.repo.readManifest(path) || {};
    (raw as any).active = false;
    this.repo.writeManifest(path, raw);
    agent.active = false;
  }

  /** Create a new agent with default scaffolding. Returns path to agent.json. */
  createAgent(id: string, type: AgentType, workspaceRoot: string, scope: "workspace" | "global" = "workspace"): string {
    const base = scope === "workspace"
      ? join(workspaceRoot, ".voidrift", "agents", id)
      : join(process.env.HOME || "", ".config", "voidrift", "agents", id);
    this.repo.ensureDir(base);
    const configPath = join(base, "agent.json");
    const promptPath = join(base, "prompt.md");
    if (!this.repo.exists(configPath)) {
      const config = { id, name: id, description: "", type, role: "", tools: [] as string[], approvalMode: "prompt" as const, allowedTools: [] as string[], active: false };
      this.repo.writeManifest(configPath, config);
    }
    if (!this.repo.exists(promptPath)) {
      this.repo.writePrompt(promptPath, `## Role: ${id}\n\nDescribe this agent's purpose and how it works.\n`);
    }
    return configPath;
  }

  private ensureConfigPath(id: string, workspaceRoot: string): string {
    const wsPath = join(workspaceRoot, ".voidrift", "agents", id, "agent.json");
    if (this.repo.exists(wsPath)) return wsPath;
    const globalPath = join(process.env.HOME || "", ".config", "voidrift", "agents", id, "agent.json");
    if (this.repo.exists(globalPath)) return globalPath;
    // Create workspace config from current state
    const agent = this.agents.get(id)!;
    const copy: Record<string, unknown> = { ...agent };
    delete copy.source; delete copy.overrideStatus; delete copy.overridePath; delete copy.prompt;
    this.repo.writeManifest(wsPath, copy as any);
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
    this.repo.ensureDir(dir);
    if (!this.repo.exists(filePath)) {
      const copy: Record<string, unknown> = { ...agent };
      delete copy.source;
      delete copy.overrideStatus;
      delete copy.overridePath;
      delete copy.prompt;
      this.repo.writeManifest(filePath, copy as any);
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
    this.repo.ensureDir(dir);
    if (!this.repo.exists(filePath)) {
      this.repo.writePrompt(filePath, agent.prompt);
    }
    return filePath;
  }

  /** Delete the override files for an agent. */
  deleteOverride(id: string, scope: "workspace" | "global", workspaceRoot: string): boolean {
    const agent = this.agents.get(id);
    if (agent && agent.overridePath) {
      return this.repo.delete(agent.overridePath);
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
      if (this.repo.delete(filePath)) return true;
    }
    return false;
  }
}
