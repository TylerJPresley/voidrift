# Skill: System Programming

## Core Standards
- **POSIX:** Adhere to Portable Operating System Interface standards for CLI and system tools.
- **Exit Codes:** Use meaningful exit codes (0 for success, non-zero for specific error types).
- **Signals:** Correct handling of SIGINT, SIGTERM, and SIGHUP for graceful shutdown.

## Implementation Rules
- **Standard I/O:** Use `stdout` for results and `stderr` for errors and status.
- **Concurrency:** Implement thread-safe logic and avoid race conditions using mutexes or channels.
- **Memory Management:** Efficiently manage resources; avoid leaks and minimize allocation overhead.
- **File Descriptors:** Properly open, use, and close files and sockets.
- **Environment:** Access configuration via environment variables or standardized config paths (e.g., `/etc`, `~/.config`).

## System Integration
- **Shell Integration:** Ensure compatibility with Bash/Zsh pipes and redirections.
- **Toolchain:** Utilize platform-native build tools (Make, GCC, Cargo, Go) for performance.
