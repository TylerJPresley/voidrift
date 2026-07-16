# Security Policy

We take security seriously and want to keep VoidRift safe for everyone. This policy outlines how security vulnerabilities should be handled and reported.

---

## Supported Versions

We actively maintain and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| < 1.0.0 | :white_check_mark: |

---

## Reporting a Vulnerability

If you discover a security vulnerability in VoidRift (such as a command-execution escape, file-sandbox bypass, or sensitive credential leakage), **please do not open a public GitHub issue**. Instead, follow these steps to report the issue responsibly:

1.  **Submit a Report:**
    *   Use the **Private Vulnerability Reporting** feature directly on the GitHub repository (if enabled).
    *   Alternatively, email the details to **tyler@voidrift.ai**.

2.  **What to Include:**
    *   A detailed description of the vulnerability.
    *   A proof-of-concept (PoC) script, list of commands, or step-by-step reproduction instructions.
    *   The environment details (OS version, Node/Bun version, and VoidRift version).

---

## Our Response Process

*   **Acknowledgement:** We will acknowledge receipt of your vulnerability report within 48 hours.
*   **Resolution:** We will investigate the issue and coordinate a patch or mitigation strategy.
*   **Disclosure:** Once resolved, a patch will be released, and we will publish a security advisory outlining the issue and crediting you for the discovery (unless you prefer to remain anonymous).
