/**
 * config-notice: value-free rejection lines + the MODEL_NOT_CONFIGURED hint
 * (Part B of the config-rejection defect). Pure formatting, no core.
 */
import { describe, it, expect } from "vitest";
import type { ConfigRejection, ConfigWarning } from "@voidrift/core";
import {
  formatRejectionLines,
  formatWarningLines,
  modelNotConfiguredHint,
  writeConfigNotice,
} from "./config-notice.js";

const rej = (keys: string[]): ConfigRejection => ({
  layer: "global",
  path: "/home/u/.config/voidrift/config.json",
  rejectedPath: "/home/u/.config/voidrift/config.json.rejected",
  errors: keys.map((k) => ({ key: k, message: `Unrecognized key: "${k}"` })),
});

const warn = (): ConfigWarning => ({
  layer: "project",
  path: "/repo/.voidrift/config.json",
  key: "unlock",
  message:
    '"unlock" in the project layer (/repo/.voidrift/config.json) is ignored; it is honored only from the global or managed layer',
});

describe("formatRejectionLines", () => {
  it("names the file, the first few keys, and the .rejected backup — never values", () => {
    const [line] = formatRejectionLines([rej(["editor", "approvalTimeout", "modelUtility", "modelEscalation"])]);
    expect(line).toContain("/home/u/.config/voidrift/config.json");
    expect(line).toContain("editor");
    expect(line).toContain("approvalTimeout");
    expect(line).toContain("modelUtility");
    // Only the first three keys are named; the rest are summarized.
    expect(line).toContain("(+1 more)");
    expect(line).toContain("config.json.rejected");
    expect(line).toContain("running on defaults");
  });

  it("emits one line per rejected layer and none when clean", () => {
    expect(formatRejectionLines([])).toEqual([]);
    expect(formatRejectionLines([rej(["editor"]), rej(["x"])])).toHaveLength(2);
  });

  it("surfaces the value-free 'not valid JSON' reason when no key is named", () => {
    const parseFail: ConfigRejection = {
      layer: "project",
      path: "/repo/.voidrift/config.json",
      rejectedPath: "/repo/.voidrift/config.json.rejected",
      errors: [{ key: "(root)", message: "file is not valid JSON" }],
    };
    const [line] = formatRejectionLines([parseFail]);
    expect(line).toContain("file is not valid JSON");
    expect(line).toContain("/repo/.voidrift/config.json");
    expect(line).toContain("config.json.rejected");
    // No file content is echoed — only the file path and the reason.
    expect(line).not.toContain("invalid document");
  });
});

describe("formatWarningLines", () => {
  it("prefixes each warning with `voidrift: warning:` and passes the value-free message through", () => {
    const [line] = formatWarningLines([warn()]);
    expect(line).toMatch(/^voidrift: warning: /);
    expect(line).toContain("/repo/.voidrift/config.json");
    expect(line).toContain("unlock");
  });

  it("emits one line per warning and none when clean", () => {
    expect(formatWarningLines([])).toEqual([]);
    expect(formatWarningLines([warn(), warn()])).toHaveLength(2);
  });
});

describe("writeConfigNotice", () => {
  const fakeApi = (rejections: ConfigRejection[], warnings: ConfigWarning[]) =>
    ({
      config: {
        rejections: async () => ({ ok: true, value: rejections }),
        warnings: async () => ({ ok: true, value: warnings }),
      },
    }) as unknown as Parameters<typeof writeConfigNotice>[0];

  it("writes rejections first, then warnings, and logs each warning once", async () => {
    const out: string[] = [];
    const logged: ConfigWarning[] = [];
    const res = await writeConfigNotice(
      fakeApi([rej(["editor"])], [warn()]),
      { write: (s: string) => out.push(s) },
      (w) => logged.push(w),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("was rejected"); // rejection line first
    expect(out[1]).toMatch(/^voidrift: warning: /); // warning line after
    expect(logged).toHaveLength(1);
    expect(logged[0]!.key).toBe("unlock");
    expect(res.rejections).toHaveLength(1);
    expect(res.warnings).toHaveLength(1);
  });

  it("writes nothing and logs nothing when the config is clean", async () => {
    const out: string[] = [];
    const logged: ConfigWarning[] = [];
    await writeConfigNotice(fakeApi([], []), { write: (s: string) => out.push(s) }, (w) => logged.push(w));
    expect(out).toEqual([]);
    expect(logged).toEqual([]);
  });
});

describe("modelNotConfiguredHint", () => {
  it("points at the config file when nothing was rejected", () => {
    const h = modelNotConfiguredHint([], "/g/config.json");
    expect(h).toContain("/g/config.json");
    expect(h).toContain("no model endpoint is configured");
  });

  it("points at the rejection reason when the config was rejected", () => {
    const h = modelNotConfiguredHint([rej(["editor"])], "/g/config.json");
    expect(h).toContain("was rejected");
    expect(h).toContain("/home/u/.config/voidrift/config.json");
  });
});
