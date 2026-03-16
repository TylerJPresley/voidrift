# Skill: Package & Distribution

## Core Philosophy
- **Artifact Integrity:** Ensure every distributed artifact (library, binary, package) is signed, versioned, and reproducible.
- **ABI Stability:** Maintain Application Binary Interface stability for Linux libraries to prevent breaking downstream dependencies.
- **Registry Standards:** Follow the canonical standards for the target registry (NPM, PyPI, Cargo, Crates.io, Maven Central).

## Implementation Rules
- **Linux Libraries:** Manage `.so` (shared object) and `.a` (static) files; correctly handle header installation (`/usr/include`) and `pkg-config` files.
- **OS Packaging:** Build native OS packages (`.deb` for Debian/Ubuntu, `.rpm` for Fedora/RHEL) with proper dependency metadata.
- **Semantic Versioning:** Strictly adhere to SemVer (Major.Minor.Patch) for all releases.
- **Release Automation:** Automate the publishing process to registries via CI/CD; include automated changelog generation.
- **License Compliance:** Bundle required license files with every distribution.

## Documentation
- **Onboarding:** Provide clear installation and usage guides for consumers of the package.
- **API Surface:** Explicitly document the public API and mark internal/private symbols as such.
