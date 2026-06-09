# Publishing & Maintaining VoidRift on npm

A guide for publishing, versioning, and maintaining VoidRift as a public npm package.

---

## Initial Setup

### 1. Create an npm Account

```bash
npm adduser
# Follow prompts: username, password, email
# Verify email via the link npm sends
```

### 2. Enable 2FA

npm requires 2FA for publishing. Enable it at https://www.npmjs.com/settings/~/tfa or:

```bash
npm profile enable-2fa auth-and-writes
```

### 3. Login from CLI

```bash
npm login
# Enter credentials + OTP if 2FA is enabled

# Verify you're logged in
npm whoami
```

---

## Preparing the Package

### package.json Requirements

The root `package.json` needs these fields for a publishable package:

```json
{
  "name": "voidrift",
  "version": "0.1.0",
  "description": "A local-first, model-agnostic AI harness for your terminal",
  "license": "MIT",
  "author": "Tyler Presley",
  "repository": {
    "type": "git",
    "url": "https://github.com/TylerJPresley/voidrift.git"
  },
  "homepage": "https://github.com/TylerJPresley/voidrift",
  "bugs": "https://github.com/TylerJPresley/voidrift/issues",
  "keywords": ["ai", "cli", "terminal", "mcp", "llm", "agent", "harness", "tui"],
  "engines": {
    "node": ">=18.0.0",
    "bun": ">=1.0.0"
  },
  "bin": {
    "voidrift": "./dist/main.js"
  },
  "files": [
    "dist/",
    "README.md",
    "LICENSE"
  ],
  "type": "module"
}
```

**Key fields:**
- `name` — must be unique on npm. Check availability: `npm search voidrift`
- `bin` — makes `voidrift` available as a global command after install
- `files` — whitelist of what gets published (keeps package small)
- `engines` — declares runtime requirements

### .npmignore

If you don't use `files` in package.json, create `.npmignore`:

```
src/
tests/
.voidrift/
.kiro/
.git/
node_modules/
*.test.ts
vitest.config.*
tsconfig.json
blueprint.md
amendments.md
mockup/
```

### Build Step

npm publishes what's in the package. You need compiled output:

```json
{
  "scripts": {
    "build": "bun build ./packages/core/src/main.tsx --outdir dist --target bun",
    "prepublishOnly": "npm run build && npm test"
  }
}
```

`prepublishOnly` runs automatically before `npm publish` — ensures you never publish broken code.

### Verify Package Contents

Before publishing, check what will be included:

```bash
npm pack --dry-run
```

This lists every file that would go into the tarball. Review it — no source, no tests, no secrets.

```bash
# Create the tarball locally to inspect
npm pack
tar -tzf voidrift-0.1.0.tgz
```

---

## Publishing

### First Publish

```bash
# Dry run first (does everything except upload)
npm publish --dry-run

# If satisfied, publish for real
npm publish
```

If the package name is unscoped (`voidrift`), it's public by default.

For scoped packages (`@voidrift/core`), add `--access public`:
```bash
npm publish --access public
```

### Verify

```bash
# Check it's live
npm info voidrift

# Test global install
npm install -g voidrift
voidrift --version
```

---

## Versioning

Follow [Semantic Versioning](https://semver.org):

| Change Type | Version Bump | Example |
|-------------|-------------|---------|
| Bug fix, no API change | PATCH | 0.1.0 → 0.1.1 |
| New feature, backwards compatible | MINOR | 0.1.1 → 0.2.0 |
| Breaking change | MAJOR | 0.2.0 → 1.0.0 |

### Bumping Versions

```bash
# Automatic version bump + git tag
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.1 → 0.2.0
npm version major   # 0.2.0 → 1.0.0

# With a pre-release tag
npm version prerelease --preid=beta  # 0.2.0 → 0.2.1-beta.0
```

`npm version` automatically:
1. Updates `package.json` version
2. Creates a git commit
3. Creates a git tag (`v0.1.1`)

### Publishing After Version Bump

```bash
npm version patch
git push && git push --tags
npm publish
```

---

## Release Workflow

### Manual Release

```bash
# 1. Ensure clean working directory
git status  # should be clean

# 2. Run tests
bun test

# 3. Bump version
npm version minor -m "Release %s"

# 4. Push commit and tag
git push origin main --follow-tags

# 5. Publish
npm publish
```

### Automated Release (GitHub Actions)

Create `.github/workflows/publish.yml`:

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install
      - run: bun test
      - run: bun run build

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org

      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Setup:**
1. Generate an npm token: https://www.npmjs.com/settings/~/tokens → "Automation" type
2. Add it as `NPM_TOKEN` in GitHub repo settings → Secrets → Actions

Now publishing is: `npm version minor && git push --follow-tags` — CI handles the rest.

---

## Pre-release / Beta Versions

For testing before stable release:

```bash
# Publish a beta
npm version prerelease --preid=beta
npm publish --tag beta
```

Users install beta with:
```bash
npm install -g voidrift@beta
```

The `latest` tag (what people get with `npm install voidrift`) isn't affected.

### Promoting Beta to Stable

```bash
# After testing, promote the beta to latest
npm dist-tag add voidrift@0.2.0-beta.3 latest
```

Or just publish a new stable version that supersedes it.

---

## Maintaining the Package

### Deprecation

If a version has a critical bug:

```bash
npm deprecate voidrift@0.1.3 "Critical bug in permission gate. Upgrade to >=0.1.4"
```

Users see a warning when they install the deprecated version.

### Unpublishing

npm allows unpublishing within 72 hours of publish:

```bash
npm unpublish voidrift@0.1.3
```

After 72 hours, you can only deprecate. This is by design — other packages may depend on yours.

### Listing Versions

```bash
npm info voidrift versions
```

### Checking Download Stats

```bash
npm info voidrift
# Or visit: https://www.npmjs.com/package/voidrift
```

---

## Monorepo Considerations

VoidRift is a monorepo (`packages/core`). You have two publishing strategies:

### Option A: Publish from Root

Build everything into a single distributable at the root level. The root `package.json` is what gets published.

```bash
# Build packages/core into root dist/
bun run build
npm publish  # publishes root package.json
```

### Option B: Publish the Core Package

Publish `packages/core` directly as `@voidrift/core`, and have a thin root package that re-exports it:

```bash
cd packages/core
npm publish --access public
```

**For a CLI tool like VoidRift, Option A is simpler.** Users want `npm install -g voidrift` to give them the `voidrift` command. A single package with a `bin` field does that cleanly.

---

## Checklist Before Every Release

- [ ] All tests pass (`bun test`)
- [ ] TypeScript compiles clean (`npx tsc --noEmit`)
- [ ] `npm pack --dry-run` shows only intended files
- [ ] No secrets in the package (check for `.env`, credential files)
- [ ] README is up to date
- [ ] CHANGELOG has an entry for this version (if you maintain one)
- [ ] Version bump follows semver correctly
- [ ] `bin` entry works after install (`npm install -g . && voidrift`)

---

## Common Issues

**"You must be logged in to publish":**
```bash
npm login
```

**"403 Forbidden — package name too similar":**
- npm rejects names that are confusingly similar to existing packages. Choose a different name or use a scope (`@yourname/voidrift`).

**"402 Payment Required":**
- Scoped packages (`@scope/name`) are private by default. Add `--access public`.

**"Cannot publish over previously published version":**
- You must bump the version. npm doesn't allow overwriting published versions.

**Package is too large:**
- Check `npm pack --dry-run` for unexpected files.
- Use the `files` field in package.json to whitelist only what's needed.
- Ensure `node_modules` isn't being included.

**`bin` command doesn't work after global install:**
- Verify the `bin` path in package.json points to the built file.
- The target file needs a shebang: `#!/usr/bin/env bun` (or `node`).
- The file must be executable: `chmod +x dist/main.js`.
