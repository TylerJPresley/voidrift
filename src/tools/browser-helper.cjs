/**
 * Browser helper subprocess for sync tool handlers.
 * Reads JSON command from stdin, executes with Playwright, prints JSON result to stdout.
 * Session state persisted via storageState files in OS temp directory.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

const { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

async function main() {
  // Read command from stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

  const { action, sessionId = "default", url, selector, path: screenshotPath } = input;
  const sessionDir = join(tmpdir(), `voidrift-browser-${sessionId}`);

  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

  const storagePath = join(sessionDir, "storage.json");
  const urlPath = join(sessionDir, "last-url.txt");

  if (action === "close") {
    try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    console.log(JSON.stringify({ closed: sessionId }));
    return;
  }

  const { chromium } = require("playwright");
  const contextOpts = {};
  if (existsSync(storagePath)) contextOpts.storageState = storagePath;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  // Restore last URL for non-navigate actions
  if (action !== "navigate" && existsSync(urlPath)) {
    const lastUrl = readFileSync(urlPath, "utf-8").trim();
    if (lastUrl) {
      try { await page.goto(lastUrl, { timeout: 30000, waitUntil: "domcontentloaded" }); }
      catch { /* page may no longer be available */ }
    }
  }

  try {
    let result;

    switch (action) {
      case "navigate": {
        await page.goto(url, { timeout: 30000, waitUntil: "domcontentloaded" });
        const title = await page.title();
        result = { title, url: page.url() };
        writeFileSync(urlPath, page.url());
        break;
      }
      case "screenshot": {
        const outPath = screenshotPath || join(sessionDir, `screenshot-${Date.now()}.png`);
        await page.screenshot({ path: outPath, fullPage: true });
        result = { path: outPath };
        break;
      }
      case "click": {
        await page.click(selector, { timeout: 10000 });
        try { await page.waitForLoadState("domcontentloaded", { timeout: 5000 }); } catch {}
        result = { clicked: selector, url: page.url() };
        writeFileSync(urlPath, page.url());
        break;
      }
      case "get_text": {
        let text;
        if (selector) {
          const el = await page.$(selector);
          if (!el) { result = { error: `Element not found: ${selector}` }; break; }
          text = (await el.textContent()) || "";
        } else {
          text = (await page.textContent("body")) || "";
        }
        result = { text: text.trim().slice(0, 50000) };
        break;
      }
      default:
        result = { error: `Unknown action: ${action}` };
    }

    // Persist session state (cookies, localStorage)
    await context.storageState({ path: storagePath });
    console.log(JSON.stringify(result));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message || String(e) }));
  } finally {
    await browser.close();
  }
}

main();
