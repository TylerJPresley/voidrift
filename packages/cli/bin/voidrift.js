#!/usr/bin/env tsx

const args = process.argv.slice(2);
const headlessIdx = args.indexOf("--headless");

if (headlessIdx !== -1) {
  const message = args.slice(headlessIdx + 1).join(" ");
  if (!message) {
    process.stderr.write("Usage: voidrift --headless <message>\n");
    process.exit(1);
  }
  import("../src/headless.js").then(m => m.runHeadless(message));
} else {
  import("../src/app.tsx");
}
