# Domain: Systems Engineering (SYSTEMS-ENG)

## Core Philosophy
- **POSIX Adherence:** Follow Portable Operating System Interface standards for CLI and system tools.
- **Artifact Integrity:** Shared libraries and binaries must be signed, versioned, and reproducible.
- **ABI Stability:** Maintain Application Binary Interface stability to prevent breaking downstream dependencies.

## Implementation Rules
- **Linux Libraries:** Manage `.so` (shared) and `.a` (static) files; correctly handle header installation and `pkg-config`.
- **Packaging:** Build native OS packages (`.deb`, `.rpm`) with proper dependency metadata and installation scripts.
- **Resource Management:** Efficiently manage file descriptors, signals, and memory; avoid heap fragmentation.
- **Standard I/O:** Use `stdout` for results, `stderr` for errors/status; handle SIGINT/SIGTERM gracefully.

## Distribution
- **Registry Standards:** Strictly follow SemVer and registry-specific standards (NPM, PyPI, Cargo, Maven).
- **Integration:** Ensure CLI tools are compatible with shell pipes, redirections, and environment-based configuration.
