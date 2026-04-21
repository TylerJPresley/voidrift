/**
 * Tests for REQ-CHAT-16: /exec gateway for lifecycle pipelines.
 *
 * Verifies EXEC_COMMANDS map, /exec routing, help text, and
 * backward-compatible delegation from /gather, /plan, /develop, /verify, /deploy.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const chatSource = readFileSync(join(__dirname, "../../src/commands/chat.ts"), "utf-8");
const helpSource = readFileSync(join(__dirname, "../../src/commands/help.ts"), "utf-8");

// ---------------------------------------------------------------------------
// EXEC_COMMANDS map
// ---------------------------------------------------------------------------

describe("EXEC_COMMANDS (REQ-CHAT-16)", () => {
  it("defines all five lifecycle commands", () => {
    expect(chatSource).toContain("gather: handleGather");
    expect(chatSource).toContain("plan: handlePlan");
    expect(chatSource).toContain("develop: handleDevelop");
    expect(chatSource).toContain("verify: handleVerify");
    expect(chatSource).toContain("deploy: handleDeploy");
  });
});

// ---------------------------------------------------------------------------
// /exec with no args lists commands
// ---------------------------------------------------------------------------

describe("/exec with no args (REQ-CHAT-16)", () => {
  it("lists available /exec commands when no subcommand given", () => {
    expect(chatSource).toContain("Available /exec commands:");
    expect(chatSource).toContain("/exec gather --import");
    expect(chatSource).toContain("/exec plan");
    expect(chatSource).toContain("/exec develop");
    expect(chatSource).toContain("/exec verify");
    expect(chatSource).toContain("/exec deploy");
  });
});

// ---------------------------------------------------------------------------
// /exec unknown shows error
// ---------------------------------------------------------------------------

describe("/exec unknown (REQ-CHAT-16)", () => {
  it("shows error for unknown exec subcommand", () => {
    expect(chatSource).toContain("Unknown exec command:");
    expect(chatSource).toContain("Type /exec for available commands");
  });
});

// ---------------------------------------------------------------------------
// /exec routing in slash command dispatch
// ---------------------------------------------------------------------------

describe("/exec slash command routing (REQ-CHAT-16)", () => {
  it('/exec is handled in slash command dispatch', () => {
    expect(chatSource).toContain('cmd === "/exec"');
    expect(chatSource).toContain("handleExec(cmdArgs)");
  });

  it("handleExec calls wrapCommand for valid subcommands", () => {
    // handleExec dispatches through wrapCommand for busy/mode management
    expect(chatSource).toMatch(/function handleExec[\s\S]*?wrapCommand\(wrap\(handler\)/);
  });
});

// ---------------------------------------------------------------------------
// Backward-compatible delegation: /gather, /plan, /develop, /verify, /deploy
// ---------------------------------------------------------------------------

describe("backward-compatible delegation (REQ-CHAT-16)", () => {
  it("/gather --import delegates to handleExec", () => {
    expect(chatSource).toContain('handleExec(`gather ${cmdArgs}`)');
  });

  it("/gather bare is a mode switch, not exec", () => {
    expect(chatSource).toContain('switchMode("gather")');
  });

  it("/plan with args delegates to handleExec", () => {
    expect(chatSource).toContain('handleExec(`plan ${cmdArgs}`)');
  });

  it("/plan bare is a mode switch, not exec", () => {
    expect(chatSource).toContain('switchMode("plan")');
  });

  it("/develop delegates to handleExec", () => {
    expect(chatSource).toContain('"/develop"');
    expect(chatSource).toContain('handleExec(`develop ${cmdArgs}`)');
  });

  it("/verify delegates to handleExec", () => {
    expect(chatSource).toContain('"/verify"');
    expect(chatSource).toContain('handleExec(`verify ${cmdArgs}`)');
  });

  it("/deploy delegates to handleExec", () => {
    expect(chatSource).toContain('"/deploy"');
    expect(chatSource).toContain('handleExec(`deploy ${cmdArgs}`)');
  });
});

// ---------------------------------------------------------------------------
// Progress appears as system messages (not chat context)
// ---------------------------------------------------------------------------

describe("pipeline progress (REQ-CHAT-16)", () => {
  it("pipeline handlers use content.addSystem/appendSystem for progress", () => {
    expect(chatSource).toContain('c.addSystem("Running plan..."');
    expect(chatSource).toContain('c.addSystem("Running develop..."');
    expect(chatSource).toContain('c.addSystem("Running verify..."');
    expect(chatSource).toContain('c.addSystem("Running deploy..."');
  });

  it("pipeline handlers do not push to agent.messages", () => {
    // The pipeline handlers (handlePlan, handleDevelop, etc.) should not
    // reference agent.messages — they use content region for display only
    const handlePlanBlock = chatSource.match(/const handlePlan = async[\s\S]*?(?=const handle(?:Develop|Verify|Deploy|Gather)|\n  \/\/ Wrap)/)?.[0] ?? "";
    expect(handlePlanBlock).not.toContain("agent.messages");
  });
});

// ---------------------------------------------------------------------------
// Help text shows /exec commands
// ---------------------------------------------------------------------------

describe("help text (REQ-CHAT-16)", () => {
  it("shows /exec commands in Pipelines section", () => {
    expect(helpSource).toContain("Pipelines:");
    expect(helpSource).toContain("/exec gather");
    expect(helpSource).toContain("/exec plan");
    expect(helpSource).toContain("/exec develop");
    expect(helpSource).toContain("/exec verify");
    expect(helpSource).toContain("/exec deploy");
  });

  it("shows mode switches separately from pipelines", () => {
    expect(helpSource).toContain("Mode switches:");
    expect(helpSource).toContain("/chat");
    expect(helpSource).toContain("/gather");
    expect(helpSource).toContain("/plan");
    expect(helpSource).toContain("/idea");
  });

  it("does not list /quit (not implemented)", () => {
    expect(helpSource).not.toContain("/quit");
  });
});
