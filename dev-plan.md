# VoidRift: Context-Gated Agent-Executable Development Plan

This document is a highly structured, step-by-step engineering roadmap for building **VoidRift**. Rather than presenting the entire systems architecture at once—which chokes LLM context windows and causes hallucinations—this plan is broken down into **completely isolated, self-contained micro-steps (Agent Chapters)**.

### How to use this plan with another AI coding model:
1.  **Feed exactly ONE Step at a time** to the coding model.
2.  Do not feed subsequent steps until the coding model has written the file for the current step and passed its dedicated verification command.
3.  Each step contains the exact imports, type interfaces, fully-coded reference implementation, and complete Vitest testing suite needed for that specific file. This isolates the model's cognitive load to a single target workspace file at a time.

---

## Tier 1: Core Foundation & Systems Bootstrapper

This tier establishes the base environment variables parser, the decoupled asynchronous Event Bus, the local filesystem watcher, and the composition root Hook Registry.

---

### Step 1.1: Configuration Schema & Loader
*   **Target File**: `packages/core/src/config/loader.ts`
*   **Context**: Needs to load `.env` variables and validate them against a strict schema using `zod` and `dotenv`.
*   **Verification Command**: `npx vitest run packages/core/tests/config/loader.test.ts`

#### Complete Reference Implementation
```typescript
import * as dotenv from "dotenv";
import * as path from "path";
import { z } from "zod";

export const ConfigSchema = z.object({
  WORKSPACE_ROOT: z.string().min(1),
  ACTIVE_MODEL_PROVIDER: z.enum(["openai", "anthropic", "gemini", "local"]),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  LOCAL_MODEL_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  LOCKS_FILE_PATH: z.string().default(".voidrift/locks.json"),
  QUEUE_FILE_PATH: z.string().default(".voidrift/lock_queue.json"),
});

export type ConfigInterface = z.infer<typeof ConfigSchema>;

export class ConfigLoader {
  public static load(workspacePath?: string): ConfigInterface {
    const targetPath = workspacePath || process.cwd();
    dotenv.config({ path: path.join(targetPath, ".env") });

    const rawConfig = {
      WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || targetPath,
      ACTIVE_MODEL_PROVIDER: process.env.ACTIVE_MODEL_PROVIDER || "local",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      LOCAL_MODEL_BASE_URL: process.env.LOCAL_MODEL_BASE_URL,
      LOCKS_FILE_PATH: process.env.LOCKS_FILE_PATH,
      QUEUE_FILE_PATH: process.env.QUEUE_FILE_PATH,
    };

    const result = ConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      console.error("❌ Invalid VoidRift environment configurations:");
      console.error(JSON.stringify(result.error.format(), null, 2));
      process.exit(1);
    }

    return result.data;
  }
}
```

#### Step 1.1 Test Suite (`packages/core/tests/config/loader.test.ts`)
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigLoader } from "../../src/config/loader";

describe("ConfigLoader Validation", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.WORKSPACE_ROOT;
    delete process.env.ACTIVE_MODEL_PROVIDER;
  });

  it("should successfully validate standard correct environment variables", () => {
    process.env.WORKSPACE_ROOT = "/home/user/workspace";
    process.env.ACTIVE_MODEL_PROVIDER = "openai";

    const config = ConfigLoader.load();
    expect(config.WORKSPACE_ROOT).toBe("/home/user/workspace");
    expect(config.ACTIVE_MODEL_PROVIDER).toBe("openai");
  });

  it("should fail validation and force exit when active provider is invalid", () => {
    process.env.WORKSPACE_ROOT = "/home/user/workspace";
    process.env.ACTIVE_MODEL_PROVIDER = "invalid-provider";

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    ConfigLoader.load();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
```

---

### Step 1.2: Asynchronous Event Bus
*   **Target File**: `packages/core/src/events/bus.ts`
*   **Context**: Registers a lightweight NodeJS `EventEmitter` message broker to coordinate decoupled core modules.
*   **Verification Command**: `npx vitest run packages/core/tests/events/bus.test.ts`

#### Complete Reference Implementation
```typescript
import { EventEmitter } from "events";

export type EventType =
  | "FILE_CREATED"
  | "FILE_MODIFIED"
  | "FILE_DELETED"
  | "LOCKS_UPDATED"
  | "SUBAGENT_SPAWNED"
  | "SUBAGENT_COMPLETED";

export interface EventPayloadMap {
  FILE_CREATED: { path: string };
  FILE_MODIFIED: { path: string };
  FILE_DELETED: { path: string };
  LOCKS_UPDATED: { activeLocks: any[] };
  SUBAGENT_SPAWNED: { subagentId: string; worktreePath: string };
  SUBAGENT_COMPLETED: { subagentId: string; status: "success" | "failed" };
}

export interface VoidRiftEvent<T extends EventType> {
  type: T;
  payload: EventPayloadMap[T];
  timestamp: number;
}

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public subscribe<T extends EventType>(
    type: T,
    listener: (event: VoidRiftEvent<T>) => void | Promise<void>
  ): void {
    this.emitter.on(type, async (event: VoidRiftEvent<T>) => {
      try {
        await listener(event);
      } catch (err) {
        console.error(`[EventBus Error] Listener for ${type} failed:`, err);
      }
    });
  }

  public publish<T extends EventType>(type: T, payload: VoidRiftEvent<T>["payload"]): void {
    const event: VoidRiftEvent<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };
    this.emitter.emit(type, event);
  }
}
```

#### Step 1.2 Test Suite (`packages/core/tests/events/bus.test.ts`)
```typescript
import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/events/bus";

describe("Asynchronous EventBus", () => {
  it("should successfully subscribe and dispatch payloads to event handlers", async () => {
    const bus = new EventBus();
    const mockListener = vi.fn();

    bus.subscribe("FILE_MODIFIED", mockListener);
    bus.publish("FILE_MODIFIED", { path: "src/main.ts" });

    // Yield macro-task queue for EventEmitter execution
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockListener).toHaveBeenCalled();
    const eventArg = mockListener.mock.calls[0][0];
    expect(eventArg.type).toBe("FILE_MODIFIED");
    expect(eventArg.payload.path).toBe("src/main.ts");
  });
});
```

---

### Step 1.3: Workspace Filesystem Watcher
*   **Target File**: `packages/core/src/watcher/index.ts`
*   **Context**: Uses `chokidar` to monitor local directory files, publishing event notifications on modifications.
*   **Verification Command**: `npx vitest run packages/core/tests/watcher/index.test.ts`

#### Complete Reference Implementation
```typescript
import * as chokidar from "chokidar";
import * as path from "path";
import { EventBus } from "../events/bus";

export class WorkspaceWatcher {
  private watcher!: chokidar.FSWatcher;

  constructor(private workspaceRoot: string, private eventBus: EventBus) {}

  public initialize(): void {
    this.watcher = chokidar.watch(this.workspaceRoot, {
      ignored: [
        /(^|[\/\\])\../, // Ignore dotfiles
        "**/node_modules/**",
        "**/.git/**",
        "**/.voidrift/**",
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher
      .on("add", (filePath) => {
        const relativePath = path.relative(this.workspaceRoot, filePath);
        this.eventBus.publish("FILE_CREATED", { path: relativePath });
      })
      .on("change", (filePath) => {
        const relativePath = path.relative(this.workspaceRoot, filePath);
        this.eventBus.publish("FILE_MODIFIED", { path: relativePath });
      })
      .on("unlink", (filePath) => {
        const relativePath = path.relative(this.workspaceRoot, filePath);
        this.eventBus.publish("FILE_DELETED", { path: relativePath });
      });
  }

  public async close(): Promise<void> {
    await this.watcher.close();
  }
}
```

#### Step 1.3 Test Suite (`packages/core/tests/watcher/index.test.ts`)
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkspaceWatcher } from "../../src/watcher";
import { EventBus } from "../../src/events/bus";
import * as fs from "fs-extra";
import * as path from "path";

describe("WorkspaceWatcher", () => {
  const tmpDir = path.join(process.cwd(), "packages/core/tests/watcher/tmp-watch-test");

  beforeEach(() => {
    fs.ensureDirSync(tmpDir);
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it("should successfully emit FILE_CREATED event when new file is written", async () => {
    const bus = new EventBus();
    const watcher = new WorkspaceWatcher(tmpDir, bus);
    watcher.initialize();

    const mockListener = vi.fn();
    bus.subscribe("FILE_CREATED", mockListener);

    // Create file
    fs.writeFileSync(path.join(tmpDir, "test.txt"), "hello");

    // Wait stability threshold of chokidar loader
    await new Promise(resolve => setTimeout(resolve, 250));
    await watcher.close();

    expect(mockListener).toHaveBeenCalled();
    expect(mockListener.mock.calls[0][0].payload.path).toBe("test.txt");
  });
});
```

---

### Step 1.4: Hook Capability Registry
*   **Target File**: `packages/core/src/registry/core.ts`
*   **Context**: Serves as the microkernel central composition root where Decoupled Plugin Addons register capability hooks.
*   **Verification Command**: `npx vitest run packages/core/tests/registry/core.test.ts`

#### Complete Reference Implementation
```typescript
export interface CapabilityHook {
  name: string;
  trigger: string;
  execute: (args: Record<string, any>) => Promise<any>;
}

export class CoreRegistry {
  private capabilities = new Map<string, CapabilityHook>();

  public registerCapability(hook: CapabilityHook): void {
    if (this.capabilities.has(hook.name)) {
      throw new Error(`Capability ${hook.name} already registered!`);
    }
    this.capabilities.set(hook.name, hook);
  }

  public async invokeCapability(name: string, args: Record<string, any>): Promise<any> {
    const cap = this.capabilities.get(name);
    if (!cap) {
      throw new Error(`Capability ${name} is not registered in the composition root.`);
    }
    return await cap.execute(args);
  }

  public listCapabilities(): string[] {
    return Array.from(this.capabilities.keys());
  }
}
```

#### Step 1.4 Test Suite (`packages/core/tests/registry/core.test.ts`)
```typescript
import { describe, it, expect } from "vitest";
import { CoreRegistry } from "../../src/registry/core";

describe("CoreRegistry", () => {
  it("should register dynamic capability hooks and invoke them successfully", async () => {
    const registry = new CoreRegistry();
    
    registry.registerCapability({
      name: "PLAN-DELTA",
      trigger: "analyze",
      execute: async (args) => `Analyzed gaps for ${args.id}`
    });

    const result = await registry.invokeCapability("PLAN-DELTA", { id: "IDEA-01" });
    expect(result).toBe("Analyzed gaps for IDEA-01");
  });

  it("should throw when registering a capability with duplicate names", () => {
    const registry = new CoreRegistry();
    const cap = { name: "test", trigger: "x", execute: async () => {} };
    
    registry.registerCapability(cap);
    expect(() => registry.registerCapability(cap)).toThrow();
  });
});
```

---

## Tier 2: Model Connectivity & Cache-Optimized Context

This tier constructs the base OpenAI model connectivity adapter and compiles prompts using volatility serialization to optimize LLM API prompt caches.

---

### Step 2.1: OpenAI Streaming Adapter
*   **Target File**: `packages/core/src/adapters/openai.ts`
*   **Context**: standardized wrapper around `@langchain/openai` to stream tokens.
*   **Verification Command**: `npx vitest run packages/core/tests/adapters/openai.test.ts`

#### Complete Reference Implementation
```typescript
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";

export interface StreamChunk {
  text: string;
  elapsedTimeMs: number;
}

export interface ModelResponse {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class OpenAIAdapter {
  private client: ChatOpenAI;

  constructor(apiKey: string, modelName: string = "gpt-4o") {
    this.client = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: modelName,
      streaming: true,
    });
  }

  public async generate(systemPrompt: string, userMessage: string, history: any[]): Promise<ModelResponse> {
    const messages = [
      new SystemMessage(systemPrompt),
      ...history.map(h => h.role === "user" ? new HumanMessage(h.text) : new AIMessage(h.text)),
      new HumanMessage(userMessage)
    ];

    const result = await this.client.invoke(messages);
    const usage = result.additional_kwargs.tokenUsage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    return {
      text: result.content as string,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      }
    };
  }

  public async stream(
    systemPrompt: string,
    userMessage: string,
    history: any[],
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ModelResponse> {
    const messages = [
      new SystemMessage(systemPrompt),
      ...history.map(h => h.role === "user" ? new HumanMessage(h.text) : new AIMessage(h.text)),
      new HumanMessage(userMessage)
    ];

    const startTime = Date.now();
    let text = "";
    const stream = await this.client.stream(messages);

    for await (const chunk of stream) {
      text += chunk.content;
      onChunk({
        text: chunk.content as string,
        elapsedTimeMs: Date.now() - startTime,
      });
    }

    return {
      text,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    };
  }
}
```

#### Step 2.1 Test Suite (`packages/core/tests/adapters/openai.test.ts`)
```typescript
import { describe, it, expect, vi } from "vitest";
import { OpenAIAdapter } from "../../src/adapters/openai";

// Mock LangChain OpenAI client in standard testing contexts
vi.mock("@langchain/openai", () => {
  return {
    ChatOpenAI: vi.fn().mockImplementation(() => {
      return {
        invoke: vi.fn().mockResolvedValue({
          content: "Mocked OpenAI text response",
          additional_kwargs: { tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
        })
      };
    })
  };
});

describe("OpenAIAdapter", () => {
  it("should successfully call invoke and return standard schema response", async () => {
    const adapter = new OpenAIAdapter("mock-key");
    const response = await adapter.generate("System spec", "User request", []);
    
    expect(response.text).toBe("Mocked OpenAI text response");
    expect(response.usage.promptTokens).toBe(10);
  });
});
```

---

### Step 2.2: Context Cache Compiler
*   **Target File**: `packages/core/src/context/compiler.ts`
*   **Context**: Arranges prompts strictly by ascending volatility to maximize provider cache prefix hits.
*   **Verification Command**: `npx vitest run packages/core/tests/context/compiler.test.ts`

#### Complete Reference Implementation
```typescript
export interface PartitionContext {
  governanceRules: string[];
  workspaceRepoMap: string;
  focusedFiles: Array<{ path: string; content: string }>;
  chatHistory: Array<{ role: "user" | "assistant"; text: string }>;
  activeDiagnostics?: string;
}

export class ContextCompiler {
  public static compile(context: PartitionContext): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    // 1. Static Governance (Must be compiled FIRST to preserve cache prefix)
    const governanceString = [
      "# GOVERNANCE RULES AND BEHAVIOR SYSTEM GUIDE",
      ...context.governanceRules,
    ].join("\n");
    messages.push({ role: "system", content: governanceString });

    // 2. Workspace Context (Changes infrequently during active editing sessions)
    const workspaceString = [
      "# WORKSPACE STATE CONTEXT",
      "## AST STRUCTURE MAP",
      context.workspaceRepoMap,
      "## FOCUSED ACTIVE WORK FILES",
      ...context.focusedFiles.map(f => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    ].join("\n");
    messages.push({ role: "system", content: workspaceString });

    // 3. Volatile Work Context (Placed at the absolute tail - invalidates caching boundary)
    const workString = [
      "# ACTIVE SESSION WORK CONTEXT",
      context.activeDiagnostics ? `## ACTIVE EXCEPTIONS & LINTER DIAGNOSTICS\n${context.activeDiagnostics}` : "",
      "## DIALOG CONVERSATION HISTORY"
    ].join("\n");
    messages.push({ role: "system", content: workString });

    for (const msg of context.chatHistory) {
      messages.push({ role: msg.role, content: msg.text });
    }

    return messages;
  }
}
```

#### Step 2.2 Test Suite (`packages/core/tests/context/compiler.test.ts`)
```typescript
import { describe, it, expect } from "vitest";
import { ContextCompiler, PartitionContext } from "../../src/context/compiler";

describe("ContextCompiler Caching Rules", () => {
  it("should compile message blocks with static elements positioned upstream to guarantee cache prefix matches", () => {
    const context: PartitionContext = {
      governanceRules: ["Rule 1: Be concise", "Rule 2: Don't guess"],
      workspaceRepoMap: "src/ -> main.ts",
      focusedFiles: [{ path: "src/main.ts", content: "const x = 5;" }],
      chatHistory: [{ role: "user", text: "Hello" }]
    };

    const firstCompile = ContextCompiler.compile(context);

    // Turn 2: User appends chat turn
    context.chatHistory.push({ role: "assistant", text: "Hi" });
    context.chatHistory.push({ role: "user", text: "Refactor" });

    const secondCompile = ContextCompiler.compile(context);

    // Assert absolute bitwise identity of prefix message blocks
    expect(firstCompile[0].content).toBe(secondCompile[0].content);
    expect(firstCompile[1].content).toBe(secondCompile[1].content);
    
    expect(firstCompile.length).toBe(4);
    expect(secondCompile.length).toBe(6);
  });
});
```

---

## Tier 3: Security Sandboxing & Concurrency Scheduler

This tier implements the isolated Git worktree provisions and registers a persistent file-locking mutex scheduler to block directory write conflicts programmatically.

---

### Step 3.1: Path-Mutex Locking Scheduler
*   **Target File**: `packages/core/src/scheduler/mutex.ts`
*   **Context**: Creates/reads `.voidrift/locks.json` to schedule parallel or queued subagent folder writes.
*   **Verification Command**: `npx vitest run packages/core/tests/scheduler/mutex.test.ts`

#### Complete Reference Implementation
```typescript
import * as fs from "fs-extra";

export interface ActiveLock {
  lockId: string;
  subagentId: string;
  pid: number;
  lockedPaths: string[];
  acquiredAt: number;
}

export interface QueuedTask {
  taskId: string;
  subagentId: string;
  requestedPaths: string[];
  queuedAt: number;
  spawnPayload: {
    prompt: string;
    role: string;
    worktreePath: string;
  };
}

export interface LockDatabaseSchema {
  activeLocks: ActiveLock[];
  queue: QueuedTask[];
}

export class MutexScheduler {
  constructor(private dbPath: string) {
    fs.ensureFileSync(this.dbPath);
    const content = fs.readFileSync(this.dbPath, "utf-8").trim();
    if (!content) {
      fs.writeJsonSync(this.dbPath, { activeLocks: [], queue: [] });
    }
  }

  private readDb(): LockDatabaseSchema {
    return fs.readJsonSync(this.dbPath);
  }

  private writeDb(db: LockDatabaseSchema): void {
    fs.writeJsonSync(this.dbPath, db, { spaces: 2 });
  }

  public static isPathIntersection(pathA: string, pathB: string): boolean {
    const partsA = pathA.split("/");
    const partsB = pathB.split("/");
    const minLength = Math.min(partsA.length, partsB.length);
    for (let i = 0; i < minLength; i++) {
      if (partsA[i] !== partsB[i]) return false;
    }
    return true; // Directory ancestor intersection overlap detected
  }

  public acquireLock(subagentId: string, requestedPaths: string[]): string | null {
    const db = this.readDb();

    // Check overlap collisions
    for (const lock of db.activeLocks) {
      for (const lockedPath of lock.lockedPaths) {
        for (const reqPath of requestedPaths) {
          if (MutexScheduler.isPathIntersection(lockedPath, reqPath)) {
            return null; // Collision detected
          }
        }
      }
    }

    const lockId = `lock-${Date.now()}`;
    const newLock: ActiveLock = {
      lockId,
      subagentId,
      pid: process.pid,
      lockedPaths: requestedPaths,
      acquiredAt: Date.now(),
    };

    db.activeLocks.push(newLock);
    this.writeDb(db);
    return lockId;
  }

  public releaseLock(lockId: string): void {
    const db = this.readDb();
    db.activeLocks = db.activeLocks.filter(l => l.lockId !== lockId);
    this.writeDb(db);
  }
}
```

#### Step 3.1 Test Suite (`packages/core/tests/scheduler/mutex.test.ts`)
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MutexScheduler } from "../../src/scheduler/mutex";
import * as fs from "fs-extra";
import * as path from "path";

describe("MutexScheduler Concurrency Guard", () => {
  const db = path.join(process.cwd(), "packages/core/tests/scheduler/locks-test.json");

  beforeEach(() => {
    fs.removeSync(db);
  });

  afterEach(() => {
    fs.removeSync(db);
  });

  it("should block concurrent lock acquisition on intersecting parent-child paths", () => {
    const scheduler = new MutexScheduler(db);

    const lockA = scheduler.acquireLock("subagent-1", ["src/models"]);
    expect(lockA).not.toBeNull();

    // Intersecting child directory - must block (returns null)
    const lockB = scheduler.acquireLock("subagent-2", ["src/models/user.ts"]);
    expect(lockB).toBeNull();

    // Disjoint folder - must pass
    const lockC = scheduler.acquireLock("subagent-3", ["src/controllers"]);
    expect(lockC).not.toBeNull();
  });
});
```

---

### Step 3.2: Git Worktree Sandboxing Engine
*   **Target File**: `packages/core/src/scheduler/worktree.ts`
*   **Context**: Provision physical checkout directory nodes to execute background tasks safely.
*   **Verification Command**: `npx vitest run packages/core/tests/scheduler/worktree.test.ts`

#### Complete Reference Implementation
```typescript
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs-extra";

const execAsync = promisify(exec);

export class WorktreeEngine {
  public static async provision(uuid: string, workspaceRoot: string): Promise<string> {
    const worktreePath = `${workspaceRoot}/.voidrift/worktrees/${uuid}`;
    const branchName = `subagent-branch-${uuid}`;

    await fs.ensureDirSync(worktreePath);

    // Stash active developer changes to keep root git tree index clean
    await execAsync(`git -C ${workspaceRoot} stash`);
    
    // Create new git worktree checking out Main to the sandboxed path
    await execAsync(`git -C ${workspaceRoot} worktree add -b ${branchName} ${worktreePath} main`);
    return worktreePath;
  }

  public static async teardown(uuid: string, workspaceRoot: string, shouldMerge: boolean): Promise<void> {
    const worktreePath = `${workspaceRoot}/.voidrift/worktrees/${uuid}`;
    const branchName = `subagent-branch-${uuid}`;

    try {
      if (shouldMerge) {
        // Safe, non-fast-forward merge back to main working branch
        await execAsync(`git -C ${workspaceRoot} merge ${branchName} --no-commit --no-ff`);
        await execAsync(`git -C ${workspaceRoot} commit -m "Merge subagent ${uuid} completed work"`);
      }
    } finally {
      // Force prune worktree structures
      await execAsync(`git -C ${workspaceRoot} worktree remove --force ${worktreePath}`);
      await execAsync(`git -C ${workspaceRoot} branch -D ${branchName}`);
      await fs.remove(worktreePath);
      
      // Pop stashed workspace changes back
      await execAsync(`git -C ${workspaceRoot} stash pop`).catch(() => {});
    }
  }
}
```

#### Step 3.2 Test Suite (`packages/core/tests/scheduler/worktree.test.ts`)
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorktreeEngine } from "../../src/scheduler/worktree";
import { execSync } from "child_process";
import * as fs from "fs-extra";
import * as path from "path";

describe("WorktreeEngine Sandboxing", () => {
  const mockRepo = path.join(process.cwd(), "packages/core/tests/scheduler/mock-repo");

  beforeEach(() => {
    fs.ensureDirSync(mockRepo);
    execSync(`git -C ${mockRepo} init`);
    execSync(`git -C ${mockRepo} config user.email "test@voidrift.com"`);
    execSync(`git -C ${mockRepo} config user.name "Tester"`);
    fs.writeFileSync(path.join(mockRepo, "main.ts"), "initial");
    execSync(`git -C ${mockRepo} add .`);
    execSync(`git -C ${mockRepo} commit -m "initial commit"`);
  });

  afterEach(() => {
    fs.removeSync(mockRepo);
  });

  it("should safely provision and merge sandboxed git worktree checkouts", async () => {
    const uuid = "test-agent";
    const worktreePath = await WorktreeEngine.provision(uuid, mockRepo);

    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(fs.existsSync(path.join(worktreePath, "main.ts"))).toBe(true);

    // Make safe edits in sandbox
    fs.writeFileSync(path.join(worktreePath, "main.ts"), "subagent-changes");
    execSync(`git -C ${worktreePath} commit -am "subagent work completed"`);

    await WorktreeEngine.teardown(uuid, mockRepo, true);

    const mergedContent = fs.readFileSync(path.join(mockRepo, "main.ts"), "utf-8");
    expect(mergedContent).toBe("subagent-changes");
    expect(fs.existsSync(worktreePath)).toBe(false);
  });
});
```

---

## Tier 4: React/Ink TUI & Operator Interface

This tier implements the console blitting, telemetry headers, spinner tool monitoring panel, footers, and autocomplete engine.

---

### Step 4.1: TUI Footer Component
*   **Target File**: `packages/core/src/tui/components/footer.tsx`
*   **Context**: Standard React component for Ink drawing the active branch, mode details, and HSL context ratio.
*   **Verification Command**: `npx vitest run packages/core/tests/tui/footer.test.tsx`

#### Complete Reference Implementation
```typescript
import React from "react";
import { Box, Text } from "ink";

interface FooterProps {
  mode: "chat" | "plan" | "vibe" | "idea" | "cr" | "dev";
  model: string;
  contextPct: number;
  branch: string;
}

export function Footer({ mode, model, contextPct, branch }: FooterProps) {
  const ctxColor = contextPct < 50 ? "green" : contextPct < 80 ? "yellow" : "red";
  const columns = process.stdout.columns || 80;
  
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{"─".repeat(columns)}</Text>
      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Text color="#6a7ec8" bold>[{mode.toUpperCase()}]</Text>
          <Text> voidrift</Text>
          <Text dimColor> · </Text>
          <Text>{model}</Text>
          <Text dimColor> · </Text>
          <Text color={ctxColor}>◎ {contextPct}%</Text>
          <Text dimColor> · </Text>
          <Text>🛡  4.2k</Text>
        </Box>
        <Box>
          <Text color="#61afef">~/voidrift</Text>
          <Text dimColor> · </Text>
          <Text color="#00d4ff">{branch}</Text>
        </Box>
      </Box>
    </Box>
  );
}
```

#### Step 4.1 Test Suite (`packages/core/tests/tui/footer.test.tsx`)
```typescript
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Footer } from "../../src/tui/components/footer";

describe("TUI Telemetry Footer", () => {
  it("should correctly render active branch and mode details on output streams", () => {
    const { lastFrame } = render(
      <Footer mode="chat" model="local-qwen" contextPct={22} branch="main" />
    );
    
    const frameContent = lastFrame();
    expect(frameContent).toContain("[CHAT]");
    expect(frameContent).toContain("local-qwen");
    expect(frameContent).toContain("main");
  });
});
```

---

### Step 4.2: Tab Autocomplete Engine
*   **Target File**: `packages/core/src/tui/autocomplete.ts`
*   **Context**: Provides inline string additions when the operator hits the `TAB` key inside input lines.
*   **Verification Command**: `npx vitest run packages/core/tests/tui/autocomplete.test.ts`

#### Complete Reference Implementation
```typescript
export class AutocompleteEngine {
  private slashCommands = ["/ideas", "/cr", "/develop", "/verify", "/deploy", "/stats", "/quit", "/clear"];

  constructor(private fileIndexList: string[]) {}

  public getCompletions(inputBuffer: string): string {
    const trimmed = inputBuffer.trim();

    // 1. Match Slash Commands
    if (trimmed.startsWith("/")) {
      const match = this.slashCommands.find(cmd => cmd.startsWith(trimmed));
      return match ? match : inputBuffer;
    }

    // 2. Match File path triggers
    const lastWord = inputBuffer.split(" ").pop() || "";
    if (lastWord.includes("/") || lastWord.endsWith(".ts") || lastWord.endsWith(".md")) {
      const match = this.fileIndexList.find(f => f.startsWith(lastWord));
      if (match) {
        const words = inputBuffer.split(" ");
        words.pop();
        return [...words, match].join(" ");
      }
    }

    return inputBuffer;
  }
}
```

#### Step 4.2 Test Suite (`packages/core/tests/tui/autocomplete.test.ts`)
```typescript
import { describe, it, expect } from "vitest";
import { AutocompleteEngine } from "../../src/tui/autocomplete";

describe("AutocompleteEngine", () => {
  const index = ["src/main.ts", "src/config/loader.ts", "package.json"];
  const engine = new AutocompleteEngine(index);

  it("should autocomplete registered slash command prefixes", () => {
    expect(engine.getCompletions("/st")).toBe("/stats");
    expect(engine.getCompletions("/cl")).toBe("/clear");
  });

  it("should autocomplete matching workspace file path triggers", () => {
    expect(engine.getCompletions("open file pack")).toBe("open file package.json");
    expect(engine.getCompletions("read src/main")).toBe("read src/main.ts");
  });
});
```

---

## Tier 5: `@voidrift/plugin-dev` Workflow Extensions

This tier registers the customized PM `/ideas` manager, `/cr` dashboard, 5-Agent Planning Pipeline, task execution loops, escalations, and the QA verification suite.

---

### Step 5.1: 5-Agent Planning Pipeline
*   **Target File**: `packages/plugin-dev/src/pipeline/planner.ts`
*   **Context**: Orchestrates the sequential chain of 5 highly specialized, single-purpose LLM planning agents.
*   **Verification Command**: `npx vitest run packages/plugin-dev/tests/pipeline/planner.test.ts`

#### Complete Reference Implementation
```typescript
import { CoreRegistry } from "@voidrift/core/src/registry/core";
import { EventBus } from "@voidrift/core/src/events/bus";

export class PlannerPipeline {
  constructor(private registry: CoreRegistry, private eventBus: EventBus) {}

  public async executePlanningChain(ideaId: string): Promise<void> {
    console.log(`[PlannerPipeline] Starting planning cascade for ${ideaId}...`);

    // 1. GAP ANALYSIS PHASE
    const gaps = await this.registry.invokeCapability("PLAN-DELTA", { ideaId });
    this.eventBus.publish("TURN_COMPLETE", { turnIndex: 1, tokensUsed: 1200 });

    // 2. SYSTEM ARCHITECTURE PHASE
    const arch = await this.registry.invokeCapability("PLAN-ARCH", { gaps });
    this.eventBus.publish("TURN_COMPLETE", { turnIndex: 2, tokensUsed: 2500 });
    
    // 3. MODULE DESIGN PHASE
    const modules = await this.registry.invokeCapability("PLAN-MODULE", { arch });
    this.eventBus.publish("TURN_COMPLETE", { turnIndex: 3, tokensUsed: 3800 });

    // 4. TASK DECOMPOSITION PHASE
    const outline = await this.registry.invokeCapability("PLAN-OUTLINE", { modules });
    this.eventBus.publish("TURN_COMPLETE", { turnIndex: 4, tokensUsed: 4900 });
    
    // 5. DEPENDENCY RESOLUTION
    const deps = await this.registry.invokeCapability("PLAN-DEPS", { outline });

    // 6. TASK TICKET GENERATION PHASE
    await this.registry.invokeCapability("PLAN-TASK", { outline, deps });
    this.eventBus.publish("TURN_COMPLETE", { turnIndex: 5, tokensUsed: 6200 });
    
    console.log(`[PlannerPipeline] Completed. Tasks generated under .voidrift/tasks/active/`);
  }
}
```

#### Step 5.1 Test Suite (`packages/plugin-dev/tests/pipeline/planner.test.ts`)
```typescript
import { describe, it, expect, vi } from "vitest";
import { PlannerPipeline } from "../../src/pipeline/planner";
import { CoreRegistry } from "@voidrift/core/src/registry/core";
import { EventBus } from "@voidrift/core/src/events/bus";

describe("PlannerPipeline Execution Cascade", () => {
  it("should successfully trigger all 5 planning capabilities in sequence", async () => {
    const registry = new CoreRegistry();
    const bus = new EventBus();
    const pipeline = new PlannerPipeline(registry, bus);

    const deltaSpy = vi.fn().mockResolvedValue("gaps");
    const archSpy = vi.fn().mockResolvedValue("arch");
    const modSpy = vi.fn().mockResolvedValue("modules");
    const outSpy = vi.fn().mockResolvedValue("outline");
    const depSpy = vi.fn().mockResolvedValue("deps");
    const taskSpy = vi.fn().mockResolvedValue("task");

    registry.registerCapability({ name: "PLAN-DELTA", trigger: "x", execute: deltaSpy });
    registry.registerCapability({ name: "PLAN-ARCH", trigger: "x", execute: archSpy });
    registry.registerCapability({ name: "PLAN-MODULE", trigger: "x", execute: modSpy });
    registry.registerCapability({ name: "PLAN-OUTLINE", trigger: "x", execute: outSpy });
    registry.registerCapability({ name: "PLAN-DEPS", trigger: "x", execute: depSpy });
    registry.registerCapability({ name: "PLAN-TASK", trigger: "x", execute: taskSpy });

    const busSpy = vi.spyOn(bus, "publish");

    await pipeline.executePlanningChain("IDEA-01");

    expect(deltaSpy).toHaveBeenCalled();
    expect(archSpy).toHaveBeenCalled();
    expect(modSpy).toHaveBeenCalled();
    expect(outSpy).toHaveBeenCalled();
    expect(depSpy).toHaveBeenCalled();
    expect(taskSpy).toHaveBeenCalled();
    expect(busSpy).toHaveBeenCalledTimes(5);
  });
});
```

---

### Step 5.2: Diagnostics Fix-Planner & Escalation
*   **Target File**: `packages/plugin-dev/src/pipeline/developer.ts`
*   **Context**: Gathers compilation linter stderr metrics and invokes high-reasoning Dense models to write fixes.
*   **Verification Command**: `npx vitest run packages/plugin-dev/tests/pipeline/developer.test.ts`

#### Complete Reference Implementation
```typescript
import * as fs from "fs-extra";

export interface EscalationState {
  taskId: string;
  errorCode: number;
  stderrLog: string;
  changedDiff: string;
  timestamp: number;
}

export class DevEscalationPipeline {
  public static async escalateAndFix(
    state: EscalationState,
    denseModel: any
  ): Promise<string> {
    console.log(`[ESCALATION] Compiler failure on task ${state.taskId}. Spawning Dense Architect...`);

    const architectPrompt = `
      Role: Architect — diagnose the compilation issue and write a planned fix for the developer.
      
      Active Failure Metadata:
      - Task ID: ${state.taskId}
      - Exit Code: ${state.errorCode}
      - Stderr Output: ${state.stderrLog}
      - Active Git Diff:
      ${state.changedDiff}
    `;

    // Generate fix plan from Dense model
    const response = await denseModel.generate(architectPrompt);
    const fixPlanText = response.text;
    
    // Append Architect plan to bottom of target developer task ticket
    const taskFilePath = `.voidrift/tasks/active/TASK-${state.taskId}.md`;
    const originalContent = await fs.readFile(taskFilePath, "utf-8");
    
    const updatedContent = [
      originalContent,
      "",
      "---",
      `## DIAGNOSTICS ARCHITECT FIX PLAN (${new Date(state.timestamp).toISOString()})`,
      "",
      fixPlanText
    ].join("\n");
    
    await fs.writeFile(taskFilePath, updatedContent, "utf-8");
    return updatedContent;
  }
}
```

#### Step 5.2 Test Suite (`packages/plugin-dev/tests/pipeline/developer.test.ts`)
```typescript
import { describe, it, expect, vi } from "vitest";
import { DevEscalationPipeline, EscalationState } from "../../src/pipeline/developer";
import * as fs from "fs-extra";

vi.mock("fs-extra");

describe("DevEscalationPipeline Diagnostics Fix", () => {
  it("should successfully append fix plans created by the Dense Architect back to TASK-id.md", async () => {
    const state: EscalationState = {
      taskId: "456",
      errorCode: 1,
      stderrLog: "TS2322: Type 'string' is not assignable to type 'number'",
      changedDiff: "+ const num: number = 'hello';",
      timestamp: Date.now()
    };

    const mockDenseModel = {
      generate: vi.fn().mockResolvedValue({
        text: "Change type annotation from number to string on line 1."
      })
    };

    fs.readFile = vi.fn().mockResolvedValue("# TASK-456\n## Acceptance Criteria");
    fs.writeFile = vi.fn().mockResolvedValue(true);

    const result = await DevEscalationPipeline.escalateAndFix(state, mockDenseModel);

    expect(mockDenseModel.generate).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalled();
    expect(result).toContain("DIAGNOSTICS ARCHITECT FIX PLAN");
    expect(result).toContain("Change type annotation from number to string");
  });
});
```

---

## Part 6: Full System Integration & Handshake Verification

To ensure all packages boot and communicate flawlessly, execute the integrated verification suite.

### 1. Integrated Handshake Executor (`packages/core/src/verify-all.ts`)
```typescript
import { ConfigLoader } from "./config/loader";
import { MutexScheduler } from "./scheduler/mutex";
import { AutocompleteEngine } from "./tui/autocomplete";

async function verifyAll() {
  console.log("🔍 Running full systems verification handshake...");

  // 1. Verify Configuration Bootstrapper
  const config = ConfigLoader.load();
  console.log(`✓ Bootstrapper Verified. Provider active: ${config.ACTIVE_MODEL_PROVIDER}`);

  // 2. Verify Concurrency Scheduler
  const scheduler = new MutexScheduler(config.LOCKS_FILE_PATH);
  const lockId = scheduler.acquireLock("subagent-system-test", ["src/main.ts"]);
  if (!lockId) throw new Error("Verification Failed: Unable to acquire basic lock.");
  scheduler.releaseLock(lockId);
  console.log("✓ Path-Mutex Locking System Verified.");

  // 3. Verify Autocomplete
  const engine = new AutocompleteEngine(["package.json"]);
  const completed = engine.getCompletions("/st");
  if (completed !== "/stats") throw new Error("Verification Failed: Autocomplete mismatch.");
  console.log("✓ TUI Autocomplete Engine Verified.");

  console.log("🎉 VoidRift Core Systems Verification Successful. Ready for rollout.");
}

verifyAll().catch(e => {
  console.error("❌ Systems Verification Failed:", e.message);
  process.exit(1);
});
```

---

<!-- GOAL_COMPLETE -->
