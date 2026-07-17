# VOIDRIFT-RELEASE

Guardrails for releasing VoidRift — versioning, build, and publish flow.

## What Ships

npm package contains ONLY:
- `dist/` — compiled JS + type declarations
- `README.md`
- `LICENSE`

Controlled by `"files"` field in package.json. Nothing else reaches users.

## What Doesn't Ship

- `src/` — source TypeScript (users get compiled output)
- `tests/` — test files
- `docs/dev/` — internal development skills
- `.voidrift/` — runtime state (gitignored)
- `_internal/` — private docs (gitignored)

## Versioning

- semver: MAJOR.MINOR.PATCH
- Currently pre-1.0 — breaking changes are free
- Bump in `package.json`, the `VERSION` export reads it at runtime via `createRequire`

## Publish Flow

1. Bump version in `package.json`
2. `bun run test` — all tests pass
3. `npm run build` — compiles to `dist/`
4. Tag: `git tag v0.x.x`
5. Push tag → GitHub Actions runs CI → publishes to npm

## Build

- `tsc` — TypeScript compiler, config in `tsconfig.json`
- Output: `dist/` with `.js` + `.d.ts` files
- `"bin": { "voidrift": "./dist/main.js" }` — entry point gets shebang

## Rules

- Never publish without passing tests
- Never include dev skills or internal docs in the package
- `engines.node >= 22` — Ink 7 requirement, enforced
- Pin dependency versions — no open ranges
- README is user-facing. Keep it practical, not developer-focused.

## Docs Updates

Any change that affects behavior, commands, config, or public API must update:
- `README.md` — if it affects getting started, config, or troubleshooting
- `docs/FEATURES.md` — if it adds/changes commands, tools, or capabilities
- `docs/PLUGINS.md` — if it changes the plugin API surface

## Cross-References

- [TESTING](./VOIDRIFT-TESTING.md) — testing framework
- [DEBUGGING](./VOIDRIFT-DEBUGGING.md) — audit logs, diagnostic patterns