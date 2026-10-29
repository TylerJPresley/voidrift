/**
 * End-to-end test for `voidrift init` with real plugin discovery and template seeding (§13.9.1).
 *
 * Tests the full flow: discovers enabled plugins' agent templates, asks for confirmation,
 * and seeds them into .voidrift/agents/. Uses REAL host functions from @voidrift/core
 * (discoverPluginAgentTemplates, initConfigHome) with injected terminal I/O and isolated
 * hermetic directories.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { runInit, type InitDeps } from "./init-command.js";
import { hermeticTmp } from "./test-hermetic.js";
import { EXIT } from "./exit-codes.js";
import {
  discoverPluginAgentTemplates,
  initConfigHome,
} from "@voidrift/core";

describe("init-plugin-templates (§13.9.1) — real plugin discovery and template seeding", () => {
  let projectDir: string;
  let tmpHome: string;
  let tmpXdg: string;
  let prevHome: string | undefined;
  let prevXdg: string | undefined;

  async function writePkg(
    root: string,
    rel: string,
    pkg: Record<string, unknown>,
    index: string,
  ): Promise<string> {
    const dir = path.join(root, rel);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    await fs.writeFile(path.join(dir, "index.js"), index);
    return dir;
  }

  async function setupFixturePlugin(projectDir: string): Promise<string> {
    const pluginDir = await writePkg(
      projectDir,
      "fx-plugin",
      {
        name: "fx-plugin",
        version: "1.0.0",
        license: "MIT",
        type: "module",
        main: "index.js",
        voidrift: { kind: "plugin", plugin: true },
      },
      `export async function register(core) {
  await 0;
  core.register.agents('./agents');
}`,
    );

    // Inline seed agent template (planner) — valid agent.json + prompt.md
    const agentDir = path.join(pluginDir, "agents", "planner");
    await fs.mkdir(agentDir, { recursive: true });
    const plannerAgentJson = JSON.stringify(
      {
        name: "planner",
        description: "Turns an intent into ordered steps, each with a brief and success checks. Reads and plans — it changes nothing.",
        kind: "worker",
        tools: [
          "read_file",
          "glob_files",
          "search_contents",
          "workspace_map",
          "list_skills",
          "load_skill",
          "read_manual",
        ],
      },
      null,
      2,
    );
    const plannerPrompt =
      "You are a planner. You turn an intent into an ordered set of steps that carry it to completion. You read and plan; you never make changes yourself.\n\nFirst understand the intent and read enough of the surrounding material to ground the plan in what is actually there. Then break the intent into ordered steps. For each step write a brief that states what must be true before the step can run, and success checks that state what must be true after it is done. Make a step small enough that one doer can carry it out and one observer can confirm it.\n\nVerification is itself work: where confirming an outcome takes its own action, emit it as its own step with its own success checks. Prefer a check that can be observed over one that must be taken on trust.\n\nReturn the plan as a goal, ordered steps, and per-step briefs and success checks. Do not carry out the steps.";
    await fs.writeFile(path.join(agentDir, "agent.json"), plannerAgentJson);
    await fs.writeFile(path.join(agentDir, "prompt.md"), plannerPrompt);

    // Create project .voidrift/config.json enabling the plugin
    const voidriftDir = path.join(projectDir, ".voidrift");
    await fs.mkdir(voidriftDir, { recursive: true });
    await fs.writeFile(
      path.join(voidriftDir, "config.json"),
      JSON.stringify(
        {
          plugins: {
            "fx-plugin": { enabled: true, path: pluginDir },
          },
        },
        null,
        2,
      ),
    );

    return pluginDir;
  }

  beforeEach(async () => {
    projectDir = hermeticTmp("init-plugin-templates");
    tmpHome = hermeticTmp("init-plugin-templates-home");
    tmpXdg = hermeticTmp("init-plugin-templates-xdg");
    prevHome = process.env.HOME;
    prevXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = tmpHome;
    process.env.XDG_CONFIG_HOME = tmpXdg;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;

    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(tmpHome, { recursive: true, force: true });
    await fs.rm(tmpXdg, { recursive: true, force: true });
  });

  it("(a) TTY, ask returns 'y': .voidrift/agents/planner/agent.json exists, summary has `seeded: planner`, stderr names fx-plugin", async () => {
    await setupFixturePlugin(projectDir);

    let stdout = "";
    let stderr = "";
    const deps: InitDeps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((stderr += s), true) },
      cwd: projectDir,
      isTty: true,
      readLine: async () => "y\n",
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);

    // Check file exists
    const agentJsonPath = path.join(projectDir, ".voidrift", "agents", "planner", "agent.json");
    const content = await fs.readFile(agentJsonPath, "utf-8");
    expect(content).toContain('"name": "planner"');

    // Check summary
    expect(stdout).toContain("seeded: planner");
    expect(stderr).toContain("fx-plugin"); // stderr names the plugin in confirmation
  });

  it("(b) TTY 'n': no agents/planner, no `seeded:`", async () => {
    await setupFixturePlugin(projectDir);

    let stdout = "";
    let _stderr = "";
    const deps: InitDeps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: true,
      readLine: async () => "n\n",
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    const code = await runInit({}, deps);
    expect(code).toBe(EXIT.COMPLETED);

    // Check file does NOT exist
    const agentDir = path.join(projectDir, ".voidrift", "agents", "planner");
    const exists = await fs.stat(agentDir).then(
      () => true,
      () => false,
    );
    expect(exists).toBe(false);

    // Check no seeded in summary
    expect(stdout).not.toContain("seeded:");
  });

  it("(c) non-TTY without yes: nothing copied, exit 0, ask never called", async () => {
    await setupFixturePlugin(projectDir);

    let readLineCalled = false;
    let stdout = "";
    let _stderr = "";
    const deps: InitDeps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: false,
      readLine: async () => {
        readLineCalled = true;
        return "y\n";
      },
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    const code = await runInit({}, deps);
    expect(code).toBe(EXIT.COMPLETED);

    // Check file does NOT exist
    const agentDir = path.join(projectDir, ".voidrift", "agents", "planner");
    const exists = await fs.stat(agentDir).then(
      () => true,
      () => false,
    );
    expect(exists).toBe(false);

    // readLine should NOT have been called
    expect(readLineCalled).toBe(false);
    expect(stdout).not.toContain("seeded:");
  });

  it("(d) non-TTY with yes:true: copied", async () => {
    await setupFixturePlugin(projectDir);

    let stdout = "";
    let _stderr = "";
    const deps: InitDeps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: false,
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);

    // Check file exists
    const agentJsonPath = path.join(projectDir, ".voidrift", "agents", "planner", "agent.json");
    const content = await fs.readFile(agentJsonPath, "utf-8");
    expect(content).toContain('"name": "planner"');
    expect(stdout).toContain("seeded: planner");
  });

  it("(e) after (a)-style copy, a second run: summary has neither `seeded:` nor `kept:`", async () => {
    await setupFixturePlugin(projectDir);

    // First run: copy templates
    let stdout = "";
    let _stderr = "";
    let deps: InitDeps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: true,
      readLine: async () => "y\n",
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    let code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(stdout).toContain("seeded: planner");

    // Second run: templates already exist (identical), should have no seeded/kept
    stdout = "";
    _stderr = "";
    deps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: false,
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(stdout).not.toContain("seeded:");
    expect(stdout).not.toContain("kept:");
  });

  it("(f) pre-existing DIFFERENT .voidrift/agents/planner/agent.json: summary has a line starting `kept: planner (` and the file bytes are unchanged", async () => {
    await setupFixturePlugin(projectDir);

    // Create a different agent.json
    const agentJsonPath = path.join(projectDir, ".voidrift", "agents", "planner", "agent.json");
    await fs.mkdir(path.dirname(agentJsonPath), { recursive: true });
    const differentContent = JSON.stringify(
      { name: "planner", description: "Different", kind: "custom" },
      null,
      2,
    );
    await fs.writeFile(agentJsonPath, differentContent);

    let stdout = "";
    let _stderr = "";
    const deps: InitDeps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: false,
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    const code = await runInit({ yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);

    // Check file is unchanged
    const finalContent = await fs.readFile(agentJsonPath, "utf-8");
    expect(finalContent).toBe(differentContent);

    // Check summary
    expect(stdout).toMatch(/^kept: planner \(/m);
  });

  it("(g) a run with --reset (reset path, yes:true) never calls discovery (spy by a plugin marker file written in register: absent)", async () => {
    await setupFixturePlugin(projectDir);

    // Create a marker file that would be written if register() is called
    const markerFile = path.join(projectDir, "fx-plugin", "register-called");

    let discoveryWasNotCalled = true;
    const mockDiscover = async () => {
      discoveryWasNotCalled = false;
      throw new Error("discovery was called but should not have been");
    };

    let _stdout = "";
    let _stderr = "";
    const deps: InitDeps = {
      stdout: { write: (s) => ((_stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: false,
      homeDir: tmpHome,
      discover: mockDiscover as any,
      init: initConfigHome,
    };

    const code = await runInit({ reset: "planner", yes: true }, deps);
    expect(code).toBe(EXIT.COMPLETED);
    expect(discoveryWasNotCalled).toBe(true);

    // Marker file should not exist (register was never called)
    const markerExists = await fs.stat(markerFile).then(
      () => true,
      () => false,
    );
    expect(markerExists).toBe(false);
  });

  it("(h) all templates already identical → ask NEVER called on a TTY and no seeded/kept lines", async () => {
    await setupFixturePlugin(projectDir);

    // Pre-seed the template (identical content)
    const agentJsonPath = path.join(projectDir, ".voidrift", "agents", "planner", "agent.json");
    await fs.mkdir(path.dirname(agentJsonPath), { recursive: true });
    const plannerAgentJson = JSON.stringify(
      {
        name: "planner",
        description: "Turns an intent into ordered steps, each with a brief and success checks. Reads and plans — it changes nothing.",
        kind: "worker",
        tools: [
          "read_file",
          "glob_files",
          "search_contents",
          "workspace_map",
          "list_skills",
          "load_skill",
          "read_manual",
        ],
      },
      null,
      2,
    );
    const plannerPrompt =
      "You are a planner. You turn an intent into an ordered set of steps that carry it to completion. You read and plan; you never make changes yourself.\n\nFirst understand the intent and read enough of the surrounding material to ground the plan in what is actually there. Then break the intent into ordered steps. For each step write a brief that states what must be true before the step can run, and success checks that state what must be true after it is done. Make a step small enough that one doer can carry it out and one observer can confirm it.\n\nVerification is itself work: where confirming an outcome takes its own action, emit it as its own step with its own success checks. Prefer a check that can be observed over one that must be taken on trust.\n\nReturn the plan as a goal, ordered steps, and per-step briefs and success checks. Do not carry out the steps.";
    await fs.writeFile(agentJsonPath, plannerAgentJson);
    await fs.writeFile(path.dirname(agentJsonPath) + "/prompt.md", plannerPrompt);

    let readLineCalled = false;
    let stdout = "";
    let _stderr = "";
    const deps: InitDeps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: true, // TTY!
      readLine: async () => {
        readLineCalled = true;
        return "y\n";
      },
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    const code = await runInit({}, deps);
    expect(code).toBe(EXIT.COMPLETED);

    // readLine should NOT have been called (no question asked)
    expect(readLineCalled).toBe(false);
    // No seeded or kept lines (both should be absent)
    expect(stdout).not.toContain("seeded:");
    expect(stdout).not.toContain("kept:");
  });

  it("(i) only a colliding different agent → ask never called, `kept: planner (...)` printed", async () => {
    await setupFixturePlugin(projectDir);

    // Pre-create a DIFFERENT agent.json (collision)
    const agentJsonPath = path.join(projectDir, ".voidrift", "agents", "planner", "agent.json");
    await fs.mkdir(path.dirname(agentJsonPath), { recursive: true });
    const differentContent = JSON.stringify({ name: "planner", description: "Different", kind: "custom" }, null, 2);
    await fs.writeFile(agentJsonPath, differentContent);
    await fs.writeFile(path.dirname(agentJsonPath) + "/prompt.md", "Different prompt\n");

    let readLineCalled = false;
    let stdout = "";
    let _stderr = "";
    const deps: InitDeps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: true, // TTY!
      readLine: async () => {
        readLineCalled = true;
        return "y\n";
      },
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    const code = await runInit({}, deps);
    expect(code).toBe(EXIT.COMPLETED);

    // readLine should NOT have been called (no question asked — collision, not a new template)
    expect(readLineCalled).toBe(false);
    // `kept:` line should be printed
    expect(stdout).toMatch(/^kept: planner \(/m);
    // No seeded line
    expect(stdout).not.toContain("seeded:");
  });

  it("(j) one new + one identical → ask called listing ONLY the new one", async () => {
    // Create a fixture plugin with TWO agents: one new, one identical
    const pluginDir = await writePkg(
      projectDir,
      "fx-plugin-two",
      {
        name: "fx-plugin-two",
        version: "1.0.0",
        license: "MIT",
        type: "module",
        main: "index.js",
        voidrift: { kind: "plugin", plugin: true },
      },
      `export async function register(core) {
  await 0;
  core.register.agents('./agents');
}`,
    );

    // Agent 1: new (not pre-existing)
    const newAgentDir = path.join(pluginDir, "agents", "new-agent");
    await fs.mkdir(newAgentDir, { recursive: true });
    await fs.writeFile(
      path.join(newAgentDir, "agent.json"),
      JSON.stringify({ name: "new-agent", description: "New", kind: "worker", tools: [] }, null, 2),
    );
    await fs.writeFile(path.join(newAgentDir, "prompt.md"), "New agent prompt\n");

    // Agent 2: identical (pre-existing with same content)
    const idAgentJson = JSON.stringify({ name: "identical-agent", description: "Identical", kind: "worker", tools: [] }, null, 2);
    const idAgentDir = path.join(pluginDir, "agents", "identical-agent");
    await fs.mkdir(idAgentDir, { recursive: true });
    await fs.writeFile(path.join(idAgentDir, "agent.json"), idAgentJson);
    await fs.writeFile(path.join(idAgentDir, "prompt.md"), "Identical agent prompt\n");

    // Pre-create the identical agent in .voidrift/agents
    const projectIdAgentDir = path.join(projectDir, ".voidrift", "agents", "identical-agent");
    await fs.mkdir(projectIdAgentDir, { recursive: true });
    await fs.writeFile(path.join(projectIdAgentDir, "agent.json"), idAgentJson);
    await fs.writeFile(path.join(projectIdAgentDir, "prompt.md"), "Identical agent prompt\n");

    // Create project .voidrift/config.json enabling the plugin
    const voidriftDir = path.join(projectDir, ".voidrift");
    await fs.mkdir(voidriftDir, { recursive: true });
    await fs.writeFile(
      path.join(voidriftDir, "config.json"),
      JSON.stringify(
        {
          plugins: {
            "fx-plugin-two": { enabled: true, path: pluginDir },
          },
        },
        null,
        2,
      ),
    );

    let askedAbout: string | null = null;
    let stdout = "";
    let _stderr = "";
    const deps: InitDeps = {
      stdout: { write: (s) => ((stdout += s), true) },
      stderr: { write: (s) => ((_stderr += s), true) },
      cwd: projectDir,
      isTty: true, // TTY!
      readLine: async () => {
        // Capture what was asked
        askedAbout = stdout.slice(stdout.lastIndexOf("Copy"));
        return "n\n"; // decline
      },
      homeDir: tmpHome,
      discover: discoverPluginAgentTemplates,
      init: initConfigHome,
    };

    const code = await runInit({}, deps);
    expect(code).toBe(EXIT.COMPLETED);

    // readLine SHOULD have been called (one new template to ask about)
    expect(askedAbout).not.toBeNull();
    // The question should mention ONLY the new one (1 template), not the identical one
    expect(askedAbout!).toContain("Copy 1 plugin agent template");
    expect(askedAbout!).toContain("new-agent");
    expect(askedAbout!).not.toContain("identical-agent"); // not mentioned in the question
    // No seeded (user said no)
    expect(stdout).not.toContain("seeded:");
    // No kept
    expect(stdout).not.toContain("kept:");
  });
});
