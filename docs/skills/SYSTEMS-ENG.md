---
name: SYSTEMS-ENG
description: CLI design, process management, stdout/stderr discipline, signal handling, and POSIX conventions.
triggers:
  extensions: [".sh",".bash"]
  files: []
  keywords: ["cli","posix","signal","stdout","stderr","daemon","process"]
agents: []
active: true
---

# SYSTEMS-ENG

## stdout vs stderr

```bash
# ✅ Results to stdout, status/errors to stderr
echo "$result"           # stdout — pipeable, parseable
echo "Processing..." >&2 # stderr — human feedback, not captured by pipes

# ❌ Mixing output and status on stdout
echo "Loading..."        # breaks: cmd | jq  (jq chokes on "Loading...")
echo "$json_result"
```

- stdout: program output (data). Must be machine-parseable when piped.
- stderr: diagnostics, progress, errors. Never parsed by downstream tools.
- Exit codes: 0 = success, 1 = general error, 2 = usage error

## Signal Handling

```typescript
// ✅ Graceful shutdown on SIGTERM
process.on("SIGTERM", async () => {
  await server.close();     // stop accepting connections
  await db.disconnect();    // clean up resources
  process.exit(0);          // exit cleanly
});

// ❌ No signal handling — orphaned connections, corrupted state
```

- SIGTERM: graceful shutdown (clean up, then exit)
- SIGINT (Ctrl+C): same as SIGTERM for user-facing tools
- SIGHUP: reload configuration (daemons)
- Never ignore SIGTERM in production

## CLI Design

```
✅ voidrift --serve --workspace /path    (flags are explicit)
✅ git commit -m "message"               (established conventions)
❌ voidrift serve /path true false 3     (positional args are cryptic)
```

- Flags over positional arguments for anything optional
- `--help` is mandatory. Short `-h` alias.
- `--version` prints version and exits
- Subcommands for distinct operations: `git commit`, `git push`

## Process Management

- PID files for daemons: write on start, remove on exit
- File locks (flock) for exclusive operations
- Forked children: reap zombies, propagate signals
- Temporary files: use `mktemp`, clean up in trap/signal handler

## Packaging

- Shebang: `#!/usr/bin/env node` (portable across systems)
- Dependencies pinned to exact versions in lockfile
- `bin` field in package.json for global CLI installation
- Test the installed package, not just the source
