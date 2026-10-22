/**
 * `/config` renderer unit tests (cli-blueprint.md §7.3). Pure and secret-free:
 * the layers with their paths, the effective config as redacted JSON.
 */
import { describe, it, expect } from "vitest";
import { renderConfigReport, type ConfigPaths } from "./config-command.js";

const paths: ConfigPaths = {
  managed: { path: "/etc/voidrift/managed.json", exists: false },
  global: { path: "/home/u/.config/voidrift/config.json", exists: true },
  project: { path: "/proj/.voidrift/config.json", exists: true },
  session: { path: "(session)", exists: false },
};

describe("§7.3 renderConfigReport", () => {
  it("lists every layer with its path and present/absent state", () => {
    const text = renderConfigReport(paths, {});
    expect(text).toContain("managed  absent   /etc/voidrift/managed.json");
    expect(text).toContain("global   present  /home/u/.config/voidrift/config.json");
    expect(text).toContain("project  present  /proj/.voidrift/config.json");
    expect(text).toContain("session  absent   (session)");
  });

  it("redacts secret-shaped values but keeps the apiKeyEnv NAME", () => {
    const text = renderConfigReport(paths, {
      modelSelected: "local",
      models: { local: { apiKeyEnv: "OPENAI_API_KEY", apiKey: "sk-live-123", token: "t-abc" } },
    });
    expect(text).toContain("OPENAI_API_KEY"); // env-var name is safe
    expect(text).not.toContain("sk-live-123"); // key value redacted
    expect(text).not.toContain("t-abc"); // token value redacted
    expect(text).toContain("«redacted»");
  });

  it("redacts nested and array secret values and sorts keys for a stable render", () => {
    const text = renderConfigReport(paths, {
      zeta: 1,
      alpha: { password: "p", nested: { secret: "s" } },
      headers: [{ authorization: "Bearer x" }],
    });
    expect(text).not.toContain('"p"');
    expect(text).not.toContain('"s"');
    expect(text).not.toContain("Bearer x");
    // alpha sorts before zeta in the rendered JSON.
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zeta"'));
  });

  it("masks URL userinfo in a baseUrl / mcp url / webSearch endpoint (key-name misses it)", () => {
    const text = renderConfigReport(paths, {
      models: { local: { baseUrl: "https://user:p4ssw0rd@host.example/v1" } },
      mcp: { acme: { url: "https://svc:s3cr3t@mcp.example/mcp" } },
      webSearch: { provider: "searxng", endpoint: "https://admin:topsecret@search.example/search" },
    });
    expect(text).not.toContain("p4ssw0rd");
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("topsecret");
    expect(text).toContain("«redacted»@host.example/v1");
    expect(text).toContain("«redacted»@mcp.example/mcp");
    expect(text).toContain("«redacted»@search.example/search");
  });

  it("masks secret-named query parameters in a URL value", () => {
    const text = renderConfigReport(paths, {
      models: { local: { baseUrl: "https://host.example/v1?api_key=sk-live-999&region=us" } },
    });
    expect(text).not.toContain("sk-live-999");
    expect(text).toContain("api_key=«redacted»");
    expect(text).toContain("region=us"); // a non-secret param is kept
  });

  it("redacts Authorization/Cookie header values and an mcp env map of secrets", () => {
    const text = renderConfigReport(paths, {
      mcp: {
        acme: {
          url: "https://x",
          headers: { Authorization: "Bearer sk-live-777", Cookie: "session=abc123" },
          env: { OPENAI_API_KEY: "sk-live-888", GITHUB_TOKEN: "ghp_123" },
        },
      },
    });
    expect(text).not.toContain("sk-live-777");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("sk-live-888");
    expect(text).not.toContain("ghp_123");
  });
});
