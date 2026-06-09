# Release & Maintenance Cheat Sheet

Quick reference for publishing and managing VoidRift.

---

## One-Time Setup

### npm

1. `npm login` (use your npmjs.com account)
2. Enable 2FA: https://www.npmjs.com/settings/~/tfa

### GitHub Secrets

Go to: https://github.com/TylerJPresley/voidrift/settings/secrets/actions

Add:
- `NPM_TOKEN` — Generate at https://www.npmjs.com/settings/~/tokens (type: "Automation")

---

## Publishing a Release

```bash
# 1. Make sure you're on main, clean tree
git checkout main
git pull
git status  # should be clean

# 2. Tests pass
bun test

# 3. Bump version (pick one)
npm version patch   # bug fix: 0.1.0 → 0.1.1
npm version minor   # new feature: 0.1.1 → 0.2.0
npm version major   # breaking change: 0.2.0 → 1.0.0

# 4. Push (tag triggers the publish workflow)
git push --follow-tags
```

That's it. GitHub Actions handles build + publish to npm.

---

## Publishing a Beta

```bash
npm version prerelease --preid=beta   # 0.2.0 → 0.2.1-beta.0
git push --follow-tags
```

Users install with: `npm install -g voidrift@beta`

Promote to stable when ready:
```bash
npm dist-tag add voidrift@0.2.1-beta.3 latest
```

---

## Manual Publish (if CI is broken)

```bash
npm run build
npm publish
```

---

## Checking Package Health

```bash
# What's published
npm info voidrift

# All versions
npm info voidrift versions

# What would be in the package
npm pack --dry-run

# Download stats
# https://www.npmjs.com/package/voidrift
```

---

## Deprecating a Bad Version

```bash
npm deprecate voidrift@0.1.3 "Bug in permission gate. Upgrade to >=0.1.4"
```

---

## Files That Get Published

Only what's in the `files` array in root `package.json`:
- `dist/` — compiled JS from `packages/core/src/`
- `README.md`
- `LICENSE`

Everything else is excluded. Verify with `npm pack --dry-run`.

---

## What the Workflows Do

**`.github/workflows/ci.yml`** — Runs on every push/PR to main:
- Installs deps with Bun
- Runs `tsc --noEmit` (typecheck)
- Runs `bun test`

**`.github/workflows/publish.yml`** — Runs when you push a `v*` tag:
- Same as CI (typecheck + test)
- Builds (`tsc` → copies to root `dist/`)
- Publishes to npm with provenance

---

## Monorepo Notes

- Source lives in `packages/core/src/`
- Build compiles to `packages/core/dist/`, then copies to root `dist/`
- Root `package.json` is what npm publishes (the `voidrift` package)
- `packages/core/package.json` is private — never published directly
- Dependencies are declared in `packages/core/package.json` but hoisted to root `node_modules/`

When adding a dependency:
```bash
cd packages/core
bun add some-package
```

The root `package.json` doesn't list dependencies — they come from the workspace. But npm publish uses the root, so dependencies must also be in root for end users. **TODO: sync deps to root before first real publish.**
