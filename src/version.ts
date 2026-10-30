import fs from "fs";

/**
 * The CLI's version marker, surfaced by `--version` and the banner
 * (cli-blueprint.md §2.1). Read once from this package's own `package.json`
 * relative to this module so it can never drift from the published version;
 * both `src/version.ts` and the built `dist/version.js` sit one directory below
 * `package.json`, so the same `../package.json` URL resolves in each. A read
 * failure degrades to `0.0.0`. (Mirrors `coreVersion()` in `@voidrift/core`.)
 */
function readVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    const raw = fs.readFileSync(url, "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const CLI_VERSION = readVersion();
