# Domain: Product Strategy (PROD-STRATEGY)

## Core Philosophy
- **Done is Better Than Perfect:** Ship MVPs and iterate based on real-world data; avoid over-engineering.
- **The Boy Scout Rule:** Always leave the code cleaner than you found it.
- **Identity Consistency:** Maintain a unified visual/verbal identity and brand voice (BRANDING).

## Implementation Rules
- **Refactoring:** Improve code in small, verifiable increments; preserve behavior at all times.
- **Integrations:** Wrap third-party APIs/SDKs in local adapters to decouple logic from external changes.
- **Resilience:** Implement Circuit Breakers and Retries for all 3rd-party connections.
- **Tech Writing:** Maintain documentation as code (READMEs, decision rationale, API docs); follow Conventional Commits.

## Communication
- **Clarity & Brevity:** Use simple, direct language in all technical communication.
- **User-Centric Documentation:** Write for the specific reader (Developer, Operator, or User).
- **Onboarding:** Provide clear setup and usage guides for every module.
