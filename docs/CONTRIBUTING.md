# Contributing to VoidRift

Thank you for your interest in contributing to VoidRift! We welcome contributions of all forms, including bug fixes, feature proposals, documentation improvements, and bug reports.

This document outlines the guidelines and steps to help you get started with contributing.

---

## Development Setup

VoidRift is built using TypeScript, React/Ink (for the TUI), and [Bun](https://bun.sh) as the package manager and runtime runner.

### Prerequisites
*   **Node.js**: `^18.0.0` or higher
*   **Bun**: `^1.0.0` or higher

### Step-by-Step Installation

1.  **Fork the Repository**
    Fork the VoidRift repository on GitHub to your own account.

2.  **Clone Your Fork**
    Clone the repository locally:
    ```bash
    git clone https://github.com/YOUR-USERNAME/voidrift.git
    cd voidrift
    ```

3.  **Install Dependencies**
    Install the project dependencies using Bun:
    ```bash
    bun install
    ```

---

## Development Workflow

### Running in Development
To start VoidRift in development mode:
```bash
bun start
```

### Formatting & Code Style
*   Follow the existing codebase conventions and design patterns.
*   Ensure that file names use clean, clear lowercase/kebab-case or matching file structure conventions.
*   Write clear comments in sections containing complex algorithms, orchestration layers, or React state management.

### Typechecking & Testing
All pull requests must pass typechecking and the test suite without any failures.

*   **Run Typechecking:**
    ```bash
    bun run typecheck
    ```
*   **Run Unit Tests:**
    ```bash
    bun run test
    ```
*   **Watch Mode for Tests:**
    ```bash
    bun run test:watch
    ```

---

## Pull Request Guidelines

To keep the review process smooth, please follow these guidelines when opening a PR:

1.  **Keep it Focused**: A pull request should address a single concern, fix, or feature. If you have multiple unrelated changes, submit them as separate PRs.
2.  **Add Tests**: If you are fixing a bug or adding a new feature, write corresponding tests in the `tests/` directory.
3.  **Self-Review**: Review your own changes and ensure no temporary debugging code, console logs (other than configured logging systems), or unused imports are committed.
4.  **Describe the PR**: Fill out the Pull Request template completely, linking any relevant GitHub issues.
5.  **Clean Git History**: Avoid merge commits in your branch. Rebase on `main` if necessary.

---

## Getting Help
If you have questions about the codebase, architecture, or project roadmap, feel free to open a discussion or contact the maintainers.
