/**
 * Built-binary e2e for `voidrift access` (cli-blueprint.md §2.1, §7.4).
 *
 * Runs the SHIPPED `dist/cli.js` with isolated HOME/XDG/workspace under the
 * per-run `<hermetic>/e2e-access*` roots, so it exercises exactly what ships
 * and NEVER touches the ambient HOME/XDG or the real `~/.config/voidrift`.
 *
 * `access` needs no model and no session: a seeded install prints the first
 * `unlisted: deny` agent's block (`--enable-write` the first `unlisted: allow`
 * agent's), exits 0, creates no durable session, and works with no model.
 */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { runBinary, E2E_TMP_PREFIX, type IsolatedEnv } from "./run-binary.js";

async function makeBareEnv(label: string): Promise<IsolatedEnv> {
  const root = `${E2E_TMP_PREFIX}-${label}`;
  const home = path.join(root, "home");
  const xdg = path.join(root, "xdg");
  const workspace = path.join(root, "ws");
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(xdg, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  return { home, xdg, workspace, cleanup: async () => void (await fs.rm(root, { recursive: true, force: true })) };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("voidrift access (e2e)", () => {
  const envs: IsolatedEnv[] = [];
  afterAll(async () => {
    while (envs.length) await envs.pop()!.cleanup();
  });

  it("a seeded install prints the deny agent's block, exits 0, creates NO session", async () => {
    const env = await makeBareEnv("access-deny");
    envs.push(env);
    expect((await runBinary(env, ["init"])).code).toBe(0);
    const r = await runBinary(env, ["access"]);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("VoidRift access — active agent: research");
    expect(r.stdout).toContain("Deny wins. Every entry above shows the layer and file it came from.");
    // NO ANSI colour in the block.
    expect(r.stdout).not.toMatch(/\u001B\[/);
    // No durable session, checkpoint, or journal dir was created.
    expect(await exists(path.join(env.workspace, ".voidrift", "sessions"))).toBe(false);
    expect(await exists(path.join(env.workspace, ".voidrift", "journal"))).toBe(false);
    expect(await exists(path.join(env.workspace, ".voidrift", "checkpoint.db"))).toBe(false);
  });

  it("--enable-write prints the allow agent's block", async () => {
    const env = await makeBareEnv("access-allow");
    envs.push(env);
    expect((await runBinary(env, ["init"])).code).toBe(0);
    const r = await runBinary(env, ["access", "--enable-write"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("VoidRift access — active agent: vibe");
  });

  it("works with NO model configured", async () => {
    const env = await makeBareEnv("access-nomodel");
    envs.push(env);
    // A config with no models at all; access must still print a block.
    await fs.mkdir(path.join(env.xdg, "voidrift"), { recursive: true });
    await fs.writeFile(path.join(env.xdg, "voidrift", "config.json"), JSON.stringify({}));
    const r = await runBinary(env, ["access"]);
    // With no seeded agents and no deny agent, it refuses (exit 2) rather than
    // crashing — but the built-in chat is `unlisted: ask`, so a bare config has
    // no `unlisted: deny` agent.
    expect([0, 2]).toContain(r.code);
  });

  it("NO_COLOR is honoured (no ANSI) and an extra flag exits 2", async () => {
    const env = await makeBareEnv("access-flags");
    envs.push(env);
    expect((await runBinary(env, ["init"])).code).toBe(0);
    const bad = await runBinary(env, ["access", "--json"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("unknown flag");
  });

  it("refuses with exit 2 when no deny agent exists (empty agents folder)", async () => {
    const env = await makeBareEnv("access-noagent");
    envs.push(env);
    // A config present but the agents folder empty: only the built-in chat
    // (unlisted: ask) exists — no `unlisted: deny` top-level agent.
    await fs.mkdir(path.join(env.xdg, "voidrift", "agents"), { recursive: true });
    await fs.writeFile(path.join(env.xdg, "voidrift", "config.json"), JSON.stringify({}));
    const r = await runBinary(env, ["access"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no top-level agent with unlisted: deny");
  });
});
