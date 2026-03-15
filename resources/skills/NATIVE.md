# Skill: Native (CLI / Linux Apps)

## Tool Selection
- **Bash:** Use for simple automation, single-file scripts, or thin wrappers around system commands. Keep simple tasks simple.
- **Python:** Use for things in the middle — medium complexity scripts requiring library integration, data processing, or rapid prototyping.
- **Rust:** The default for robust, high-performance, or complex system tools. Use for long-term maintainability and memory safety.
- **C++:** A valid alternative to Rust for complex tasks where Rust does not make sense (e.g., legacy integration, specific kernel/hardware drivers, or specific performance profiles).

---

## 🐚 Bash Standards (Simple Automation)
- **Linter:** ShellCheck required.
- **Safety:** Always use `set -euo pipefail` (Strict Mode).
- **Style:** Use `[[ ]]` for tests, local variables in functions, and descriptive exit codes.

## 🐍 Python Standards (Middle Ground)
- **Package Manager:** `uv`.
- **Frameworks:** `typer` (CLI), `pydantic` (Data).
- **Quality:** Strict Type Hinting; Google-style docstrings; `pytest`.

## 🦀 Rust Standards (Complex Tools - Default)
- **Build System:** `cargo`.
- **Quality:** `cargo clippy` (no warnings allowed); `cargo fmt`.
- **Error Handling:** Use `anyhow` for applications or `thiserror` for libraries.
- **Pattern:** Prefer functional style (iterators, pattern matching).

## ⚙️ C++ Standards (Complex Tools - Alternative)
- **Standards:** Modern C++ (C++20 or newer).
- **Build System:** CMake.
- **Quality:** Clang-Tidy; Google C++ Style Guide or LLVM.

---

## Universal Native Rules
- **Interface:** POSIX-compliant CLI (Args/Flags); provide `--help` for all commands.
- **Configuration:** XDG Base Directory Specification (e.g., `~/.config/app`).
- **I/O:** Descriptive stderr for errors; clean stdout for data; standard exit codes.
- **Signals:** Proper handling of Unix signals (SIGINT, SIGTERM).
- **Traceability:** Log process lifecycle (Start/Success/Fail) to syslog or local files.
